import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "../db/schema.ts";

type SavedReleaseRepository = {
  listReleaseIds(userEmail: string): Promise<string[]>;
  save(
    userEmail: string,
    releaseId: string,
    createdAt: string,
  ): Promise<boolean>;
  remove(userEmail: string, releaseId: string): Promise<void>;
};

type SavedReleaseHandlers = {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  DELETE(request: Request): Promise<Response>;
};

type SavedReleaseModule = {
  createSavedReleaseRepositoryWithDb?: (
    db: ReturnType<typeof drizzle>,
  ) => SavedReleaseRepository;
  createSavedReleaseHandlers?: (dependencies: {
    getUser: () => Promise<{ email: string } | null>;
    repository: SavedReleaseRepository;
    now?: () => string;
  }) => SavedReleaseHandlers;
};

const savedReleaseModule = (await import("../app/saved-releases.ts").catch(
  () => ({}),
)) as SavedReleaseModule;
const savedReleaseButtonModule = (await import(
  "../app/saved-release-button.tsx"
).catch(() => ({}))) as {
  SavedReleaseButton?: ComponentType<{
    releaseId: string;
    saved: boolean;
    pending: boolean;
    disabled: boolean;
    error: string | null;
    onToggle: (releaseId: string) => void;
  }>;
};
const releaseFilterModule = await import("../app/release-filters.tsx");

type SqliteValue = null | number | string | Uint8Array;

class SQLiteStatement {
  constructor(
    private readonly owner: SQLiteD1,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SQLiteStatement(this.owner, this.sql, params);
  }

  async raw() {
    const prepared = this.owner.database.prepare(this.sql);
    prepared.setReturnArrays(true);
    return prepared.all(
      ...(this.params as SqliteValue[]),
    ) as unknown as unknown[][];
  }

  async all() {
    return {
      results: this.owner.database
        .prepare(this.sql)
        .all(...(this.params as SqliteValue[])) as Record<string, unknown>[],
    };
  }

  async run() {
    const result = this.owner.database
      .prepare(this.sql)
      .run(...(this.params as SqliteValue[]));
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes),
        changed_db: Number(result.changes) > 0,
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class SQLiteD1 {
  readonly database = new DatabaseSync(":memory:");
  readonly preparedSql: string[] = [];

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
    const migration = readFileSync(
      new URL("../drizzle/0001_collaboration_release_cache.sql", import.meta.url),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) this.database.exec(statement);
    }
  }

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new SQLiteStatement(this, sql);
  }

  seedCatalog(...releaseIds: string[]) {
    const statement = this.database.prepare(
      `INSERT INTO release_catalog (
        id, canonical_key, title, status, confidence, first_seen_at, updated_at
      ) VALUES (?, ?, ?, 'active', 100, ?, ?)`,
    );
    for (const releaseId of releaseIds) {
      statement.run(
        releaseId,
        `key:${releaseId}`,
        `Release ${releaseId}`,
        "2026-07-31T00:00:00.000Z",
        "2026-07-31T00:00:00.000Z",
      );
    }
  }

  savedRows() {
    return this.database
      .prepare(
        "SELECT user_email AS userEmail, release_id AS releaseId FROM saved_releases ORDER BY user_email, release_id",
      )
      .all()
      .map((row) => ({ ...row }));
  }
}

function requireSavedReleaseModule() {
  assert.equal(
    typeof savedReleaseModule.createSavedReleaseRepositoryWithDb,
    "function",
    "createSavedReleaseRepositoryWithDb must be exported",
  );
  assert.equal(
    typeof savedReleaseModule.createSavedReleaseHandlers,
    "function",
    "createSavedReleaseHandlers must be exported",
  );
  return {
    createRepository:
      savedReleaseModule.createSavedReleaseRepositoryWithDb!,
    createHandlers: savedReleaseModule.createSavedReleaseHandlers!,
  };
}

function testContext(email: string | null = "alice@example.com") {
  const { createRepository, createHandlers } = requireSavedReleaseModule();
  const d1 = new SQLiteD1();
  const repository = createRepository(
    drizzle(d1 as never, { schema }) as ReturnType<typeof drizzle>,
  );
  const handlers = createHandlers({
    getUser: async () => (email ? { email } : null),
    repository,
    now: () => "2026-07-31T09:00:00.000Z",
  });
  return { d1, handlers, repository, createHandlers };
}

function mutationRequest(
  method: "POST" | "DELETE",
  input: {
    releaseId?: string;
    body?: Record<string, unknown> | string;
    origin?: string | null;
    fetchSite?: string;
    requestUrl?: string;
  } = {},
) {
  const url = new URL(
    input.requestUrl ??
      "https://calendar.example/api/saved-releases",
  );
  if (method === "DELETE" && input.releaseId !== undefined) {
    url.searchParams.set("releaseId", input.releaseId);
  }
  const headers = new Headers();
  if (input.origin !== null) {
    headers.set("origin", input.origin ?? "https://calendar.example");
  }
  if (input.fetchSite) {
    headers.set("sec-fetch-site", input.fetchSite);
  }
  if (method === "POST") headers.set("content-type", "application/json");
  const body =
    method === "POST"
      ? typeof input.body === "string"
        ? input.body
        : JSON.stringify(input.body ?? { releaseId: input.releaseId })
      : undefined;
  return new Request(url, { method, headers, body });
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

test("saved release API rejects anonymous reads and mutations", async () => {
  const { handlers } = testContext(null);

  for (const response of [
    await handlers.GET(
      new Request("https://calendar.example/api/saved-releases"),
    ),
    await handlers.POST(
      mutationRequest("POST", { releaseId: "release-a" }),
    ),
    await handlers.DELETE(
      mutationRequest("DELETE", { releaseId: "release-a" }),
    ),
  ]) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await responseJson(response), {
      error: "Authentication required.",
    });
  }
});

test("saved release API isolates rows by authenticated email and ignores request identity", async () => {
  const { d1, repository, createHandlers } = testContext();
  d1.seedCatalog("release-a");
  const alice = createHandlers({
    getUser: async () => ({ email: "alice@example.com" }),
    repository,
    now: () => "2026-07-31T09:00:00.000Z",
  });
  const bob = createHandlers({
    getUser: async () => ({ email: "bob@example.com" }),
    repository,
    now: () => "2026-07-31T09:00:00.000Z",
  });

  const saveResponse = await alice.POST(
    mutationRequest("POST", {
      body: {
        releaseId: "release-a",
        email: "bob@example.com",
        userEmail: "bob@example.com",
      },
    }),
  );
  const aliceResponse = await alice.GET(
    new Request("https://calendar.example/api/saved-releases"),
  );
  const bobResponse = await bob.GET(
    new Request("https://calendar.example/api/saved-releases"),
  );

  assert.equal(saveResponse.status, 200);
  assert.deepEqual(await responseJson(saveResponse), {
    releaseId: "release-a",
  });
  assert.deepEqual(await responseJson(aliceResponse), {
    releaseIds: ["release-a"],
  });
  assert.deepEqual(await responseJson(bobResponse), { releaseIds: [] });
  assert.deepEqual(d1.savedRows(), [
    { userEmail: "alice@example.com", releaseId: "release-a" },
  ]);
});

test("duplicate saves are idempotent and saved ID reads use one query", async () => {
  const { d1, handlers } = testContext();
  d1.seedCatalog("release-b", "release-a");

  for (const releaseId of ["release-b", "release-a", "release-a"]) {
    const response = await handlers.POST(
      mutationRequest("POST", { releaseId }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await responseJson(response), { releaseId });
  }

  const queryCountBeforeGet = d1.preparedSql.length;
  const response = await handlers.GET(
    new Request("https://calendar.example/api/saved-releases"),
  );

  assert.deepEqual(await responseJson(response), {
    releaseIds: ["release-a", "release-b"],
  });
  assert.equal(d1.preparedSql.length - queryCountBeforeGet, 1);
  assert.deepEqual(d1.savedRows(), [
    { userEmail: "alice@example.com", releaseId: "release-a" },
    { userEmail: "alice@example.com", releaseId: "release-b" },
  ]);
});

test("save validates release IDs and requires an existing catalog release", async () => {
  const { handlers } = testContext();

  for (const request of [
    mutationRequest("POST", { body: {} }),
    mutationRequest("POST", { body: { releaseId: 42 } }),
    mutationRequest("POST", { releaseId: " release-a " }),
    mutationRequest("POST", { releaseId: "x".repeat(257) }),
    mutationRequest("POST", { body: "{not-json" }),
  ]) {
    const response = await handlers.POST(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await responseJson(response), {
      error: "A valid releaseId is required.",
    });
  }

  const missing = await handlers.POST(
    mutationRequest("POST", { releaseId: "missing-release" }),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await responseJson(missing), {
    error: "Release not found.",
  });
});

test("delete removes only the authenticated user's matching release", async () => {
  const { d1, repository, createHandlers } = testContext();
  d1.seedCatalog("shared-release");
  const alice = createHandlers({
    getUser: async () => ({ email: "alice@example.com" }),
    repository,
  });
  const bob = createHandlers({
    getUser: async () => ({ email: "bob@example.com" }),
    repository,
  });
  await alice.POST(
    mutationRequest("POST", { releaseId: "shared-release" }),
  );
  await bob.POST(
    mutationRequest("POST", { releaseId: "shared-release" }),
  );

  const firstDelete = await alice.DELETE(
    mutationRequest("DELETE", { releaseId: "shared-release" }),
  );
  const duplicateDelete = await alice.DELETE(
    mutationRequest("DELETE", { releaseId: "shared-release" }),
  );

  assert.equal(firstDelete.status, 204);
  assert.equal(duplicateDelete.status, 204);
  assert.deepEqual(d1.savedRows(), [
    { userEmail: "bob@example.com", releaseId: "shared-release" },
  ]);
});

test("mutations reject missing or cross-site request origins", async () => {
  const { d1, handlers } = testContext();
  d1.seedCatalog("release-a");

  for (const request of [
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: null,
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: "https://attacker.example",
    }),
    mutationRequest("DELETE", {
      releaseId: "release-a",
      origin: "https://attacker.example",
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: "https://calendar.example",
      fetchSite: "same-site",
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: "https://calendar.example",
      fetchSite: "cross-site",
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: "https://calendar.example",
      fetchSite: "none",
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: null,
      fetchSite: "same-origin",
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: "not-an-origin",
      fetchSite: "same-origin",
    }),
    mutationRequest("POST", {
      releaseId: "release-a",
      origin: "http://calendar.example",
      fetchSite: "same-origin",
    }),
  ]) {
    const response =
      request.method === "POST"
        ? await handlers.POST(request)
        : await handlers.DELETE(request);
    assert.equal(response.status, 403);
    assert.deepEqual(await responseJson(response), {
      error: "Request origin is not allowed.",
    });
  }
  assert.deepEqual(d1.savedRows(), []);
});

test("same-origin Fetch Metadata accepts a public HTTPS origin behind a rewritten proxy URL", async () => {
  const { d1, handlers } = testContext();
  d1.seedCatalog("release-a");

  const response = await handlers.POST(
    mutationRequest("POST", {
      releaseId: "release-a",
      requestUrl: "http://internal-service:8787/api/saved-releases",
      origin: "https://calendar.example",
      fetchSite: "same-origin",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), {
    releaseId: "release-a",
  });
  assert.deepEqual(d1.savedRows(), [
    { userEmail: "alice@example.com", releaseId: "release-a" },
  ]);
});

test("clients without Fetch Metadata require exact request URL origin", async () => {
  const { d1, handlers } = testContext();
  d1.seedCatalog("release-a");

  const accepted = await handlers.POST(
    mutationRequest("POST", {
      releaseId: "release-a",
      requestUrl: "http://localhost:3010/api/saved-releases",
      origin: "http://localhost:3010",
    }),
  );
  const rejected = await handlers.DELETE(
    mutationRequest("DELETE", {
      releaseId: "release-a",
      requestUrl: "http://internal-service:8787/api/saved-releases",
      origin: "https://calendar.example",
    }),
  );

  assert.equal(accepted.status, 200);
  assert.equal(rejected.status, 403);
  assert.deepEqual(d1.savedRows(), [
    { userEmail: "alice@example.com", releaseId: "release-a" },
  ]);
});

test("unexpected repository failures return sanitized no-store errors", async () => {
  const { createHandlers } = requireSavedReleaseModule();
  const repository: SavedReleaseRepository = {
    async listReleaseIds() {
      throw new Error("secret select from saved_releases");
    },
    async save() {
      throw new Error("secret insert into saved_releases");
    },
    async remove() {
      throw new Error("secret delete from saved_releases");
    },
  };
  const handlers = createHandlers({
    getUser: async () => ({ email: "alice@example.com" }),
    repository,
  });

  for (const response of [
    await handlers.GET(
      new Request("https://calendar.example/api/saved-releases"),
    ),
    await handlers.POST(
      mutationRequest("POST", { releaseId: "release-a" }),
    ),
    await handlers.DELETE(
      mutationRequest("DELETE", { releaseId: "release-a" }),
    ),
  ]) {
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const body = await responseJson(response);
    assert.deepEqual(body, {
      error: "Saved releases are temporarily unavailable.",
    });
    assert.equal(JSON.stringify(body).includes("secret"), false);
  }
});

test("bookmark control exposes a keyboard button with its pressed state", () => {
  const SavedReleaseButton = savedReleaseButtonModule.SavedReleaseButton;
  assert.equal(typeof SavedReleaseButton, "function");

  const unsavedMarkup = renderToStaticMarkup(
    createElement(SavedReleaseButton!, {
      releaseId: "release-a",
      saved: false,
      pending: false,
      disabled: false,
      error: null,
      onToggle: () => {},
    }),
  );
  const savedMarkup = renderToStaticMarkup(
    createElement(SavedReleaseButton!, {
      releaseId: "release-a",
      saved: true,
      pending: false,
      disabled: false,
      error: null,
      onToggle: () => {},
    }),
  );

  assert.match(
    unsavedMarkup,
    /<button[^>]+type="button"[^>]+aria-label="관심 발매에 저장"[^>]+aria-pressed="false"/,
  );
  assert.match(
    savedMarkup,
    /<button[^>]+type="button"[^>]+aria-label="관심 발매에서 삭제"[^>]+aria-pressed="true"/,
  );
  assert.doesNotMatch(unsavedMarkup, /example\.com|email/i);
});

test("saved-only filtering uses the one loaded ID set", () => {
  const filterReleases = (
    releaseFilterModule as {
      filterReleases: (
        releases: { id: string }[],
        filter: string,
        savedReleaseIds?: ReadonlySet<string>,
      ) => { id: string }[];
    }
  ).filterReleases;
  const releases = [
    {
      id: "release-a",
      title: "A",
      releaseDate: "2026-08-01",
      releaseTime: null,
    },
    {
      id: "release-b",
      title: "B",
      releaseDate: "2026-08-02",
      releaseTime: null,
    },
  ];

  assert.deepEqual(
    filterReleases(
      releases,
      "saved",
      new Set(["release-b"]),
    ).map((release) => release.id),
    ["release-b"],
  );
  assert.deepEqual(filterReleases(releases, "saved"), []);
});

test("market scope filtering composes saved results from the loaded ID set", () => {
  const filterReleases = (
    releaseFilterModule as {
      filterReleases: (
        releases: { id: string }[],
        filter: string,
        savedReleaseIds?: ReadonlySet<string>,
      ) => { id: string }[];
    }
  ).filterReleases;
  const filterReleasesByMarketScope = (
    releaseFilterModule as {
      filterReleasesByMarketScope?: (
        releases: {
          id: string;
          marketScope?: "korea" | "overseas";
        }[],
        overseasOnly: boolean,
      ) => { id: string }[];
    }
  ).filterReleasesByMarketScope;
  assert.equal(typeof filterReleasesByMarketScope, "function");

  const releases = [
    {
      id: "saved-domestic",
      title: "Saved Domestic",
      releaseDate: "2026-08-01",
      releaseTime: null,
      marketScope: "korea" as const,
    },
    {
      id: "saved-overseas",
      title: "Saved Overseas",
      releaseDate: "2026-08-02",
      releaseTime: null,
      marketScope: "overseas" as const,
    },
    {
      id: "unsaved-overseas",
      title: "Unsaved Overseas",
      releaseDate: "2026-08-03",
      releaseTime: null,
      marketScope: "overseas" as const,
    },
  ];

  assert.deepEqual(
    filterReleasesByMarketScope!(
      filterReleases(releases, "saved", new Set(["saved-domestic", "saved-overseas"])),
      true,
    ).map(({ id }) => id),
    ["saved-overseas"],
  );
});

test("내 관심 발매 filter is rendered only for signed-in users", () => {
  const ReleaseFilters = releaseFilterModule.ReleaseFilters as ComponentType<{
    value: string;
    onChange: (value: string) => void;
    showSaved?: boolean;
    savedLoading?: boolean;
    showOverseas?: boolean;
    overseasOnly?: boolean;
    onOverseasChange?: (value: boolean) => void;
  }>;

  const signedOutMarkup = renderToStaticMarkup(
    createElement(ReleaseFilters, {
      value: "all",
      onChange: () => {},
      showSaved: false,
    }),
  );
  const signedInMarkup = renderToStaticMarkup(
    createElement(ReleaseFilters, {
      value: "saved",
      onChange: () => {},
      showSaved: true,
      savedLoading: true,
    }),
  );

  assert.doesNotMatch(signedOutMarkup, /내 관심 발매/);
  assert.doesNotMatch(signedOutMarkup, />해외<\/button>/);
  assert.match(
    signedInMarkup,
    /<button[^>]+type="button"[^>]+aria-pressed="true"[^>]+aria-busy="true"[^>]*>내 관심 발매<\/button>/,
  );
  assert.doesNotMatch(signedInMarkup, />해외<\/button>/);
});
