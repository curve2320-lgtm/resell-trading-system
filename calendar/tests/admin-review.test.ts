import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  CachedRelease,
  CollectionRepository,
  PersistSourceOutcome,
  PersistSourceResult,
  ResolveReviewInput,
  ReviewItem,
  SourceHealth,
} from "../app/collection/repository.ts";

type AdminAuthModule = typeof import("../app/admin-auth.ts");
type AdminApiModule = typeof import("../app/admin-api.ts");
type AdminControllerModule =
  typeof import("../app/admin-dashboard-controller.ts");
type AdminDashboardModule =
  typeof import("../app/admin/admin-dashboard.tsx");
type AdminCacheModule = typeof import("../app/admin-cache.ts");

let adminAuthModule: Partial<AdminAuthModule> = {};
let adminApiModule: Partial<AdminApiModule> = {};
let adminControllerModule: Partial<AdminControllerModule> = {};
let adminDashboardModule: Partial<AdminDashboardModule> = {};
let adminCacheModule: Partial<AdminCacheModule> = {};

try {
  adminAuthModule = await import("../app/admin-auth.ts");
} catch {
  // RED: the production module does not exist yet.
}
try {
  adminApiModule = await import("../app/admin-api.ts");
} catch {
  // RED: the production module does not exist yet.
}
try {
  adminControllerModule = await import(
    "../app/admin-dashboard-controller.ts"
  );
} catch {
  // RED: the production module does not exist yet.
}
try {
  adminDashboardModule = await import(
    "../app/admin/admin-dashboard.tsx"
  );
} catch {
  // RED: the production module does not exist yet.
}
try {
  adminCacheModule = await import("../app/admin-cache.ts");
} catch {
  // RED: the production module does not exist yet.
}

function required<T>(value: T | undefined, name: string): T {
  assert.notEqual(value, undefined, `${name} must be exported`);
  return value!;
}

const candidatePayload = JSON.stringify({
  canonicalKey: "style:dd1399100",
  release: {
    sourceKey: "nike",
    externalId: "candidate-1",
    title: "</script><script>alert('xss')</script>",
    brand: "Nike",
    category: "sneakers",
    releaseKind: "raffle",
    releaseDate: "2026-08-02",
    releaseTime: "11:00",
    priceLabel: "₩189,000",
    styleCode: "DD-1399-100",
    retailer: "Nike Korea",
    productUrl: "https://www.nike.com/kr/launch/t/example",
    sourceUrl: "https://www.nike.com/kr/launch/",
    collectedAt: "2026-07-31T02:00:00.000Z",
    secret: "must-not-cross-the-api-boundary",
  },
  channels: [],
  reviewReason: "conflicting_schedule",
  secret: "must-not-cross-the-api-boundary",
});

const reviewItem: ReviewItem = {
  id: 7,
  sourceKey: "nike",
  externalId: "candidate-1",
  reason: "conflicting_schedule",
  payloadJson: candidatePayload,
  status: "pending",
};

const sourceHealth: SourceHealth = {
  sourceKey: "nike",
  status: "error",
  lastSuccessAt: "2026-07-29T00:00:00.000Z",
  lastFailureAt: "2026-07-31T00:00:00.000Z",
  consecutiveFailures: 3,
  sourceCount: 12,
  newCount: 2,
  mergedCount: 4,
  reviewCount: 1,
  message: "Upstream timeout",
};

const cachedRelease: CachedRelease = {
  id: "cached:style:dd1399100",
  canonicalKey: "style:dd1399100",
  title: "Air Example",
  brand: "Nike",
  category: "sneakers",
  releaseKind: "general",
  releaseDate: "2026-08-01",
  releaseTime: "10:00",
  changedAt: null,
  lastVerifiedAt: "2026-07-30T00:00:00.000Z",
  channels: [],
};

function collectionRepository(
  overrides: Partial<CollectionRepository> = {},
): CollectionRepository {
  return {
    async claimSlot(_slotKey, _startedAt, claimToken) {
      return { state: "claimed", claimToken, reclaimed: false };
    },
    async completeSlot() {
      return true;
    },
    async failSlot() {
      return true;
    },
    async listCachedReleases() {
      return [cachedRelease];
    },
    async persistSourceResult(
      _result: PersistSourceResult,
    ): Promise<PersistSourceOutcome> {
      return { reviewItemsCreated: 0 };
    },
    async listSourceHealth() {
      return [sourceHealth];
    },
    async listReviewItems() {
      return [reviewItem];
    },
    async countPendingReviewItems() {
      return 1;
    },
    async listPendingNikeMissingDateReviews() {
      return [];
    },
    async resolveReview(_input: ResolveReviewInput) {},
    ...overrides,
  };
}

function browserMutation(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Request {
  return new Request(`https://internal.worker${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://calendar.example",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function adminData() {
  const {
    message: _message,
    ...projectedSourceHealth
  } = sourceHealth;
  return {
    pendingCount: 1,
    reviews: [
      {
        id: 7,
        sourceKey: "nike",
        externalId: "candidate-1",
        reason: "conflicting_schedule" as const,
        previous: {
          title: "Air Example",
          releaseDate: "2026-08-01",
          releaseTime: "10:00",
        },
        candidate: {
          title: "</script><script>alert('xss')</script>",
          releaseDate: "2026-08-02",
          releaseTime: "11:00",
          retailer: "Nike Korea",
          productUrl: "https://www.nike.com/kr/launch/t/example",
          sourceUrl: "https://www.nike.com/kr/launch/",
        },
      },
    ],
    sourceHealth: [
      {
        ...projectedSourceHealth,
        statusLabel: "Error" as const,
        operatorMessage:
          "Collection failed. Refresh this source or inspect worker logs.",
      },
    ],
    mergeTargets: [
      {
        id: cachedRelease.id,
        title: cachedRelease.title,
        releaseDate: cachedRelease.releaseDate,
      },
    ],
  };
}

function adminDataVersion(title: string) {
  const data = adminData();
  return {
    ...data,
    reviews: data.reviews.map((review) => ({
      ...review,
      candidate: { ...review.candidate, title },
    })),
  };
}

test("ADMIN_EMAILS parsing trims entries and matches email case-insensitively", async () => {
  const requireAdmin = required(
    adminAuthModule.requireAdmin,
    "requireAdmin",
  );

  const user = await requireAdmin({
    getUser: async () => ({
      displayName: "Owner",
      email: "  OWNER@Example.COM ",
      fullName: "Owner",
    }),
    adminEmails: " other@example.com, owner@example.com ,,",
    nodeEnv: "production",
  });

  assert.equal(user.email, "  OWNER@Example.COM ");
});

test("production rejects authenticated users when ADMIN_EMAILS is missing", async () => {
  const requireAdmin = required(
    adminAuthModule.requireAdmin,
    "requireAdmin",
  );
  const AdminAccessError = required(
    adminAuthModule.AdminAccessError,
    "AdminAccessError",
  );

  await assert.rejects(
    requireAdmin({
      getUser: async () => ({
        displayName: "Owner",
        email: "owner@example.com",
        fullName: "Owner",
      }),
      adminEmails: " , ",
      nodeEnv: "production",
    }),
    (error: unknown) =>
      error instanceof AdminAccessError && error.status === 503,
  );
});

test("request-scoped Cloudflare ADMIN_EMAILS works without process env and grants only normalized admins", async () => {
  const requireAdmin = required(
    adminAuthModule.requireAdmin,
    "requireAdmin",
  );
  const AdminAccessError = required(
    adminAuthModule.AdminAccessError,
    "AdminAccessError",
  );
  const originalProcessValue = process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_EMAILS;
  const resolveAdminEmails = async () =>
    " owner@example.com, SECOND@example.com ";

  try {
    const owner = await requireAdmin({
      getUser: async () => ({
        displayName: "Owner",
        email: "OWNER@EXAMPLE.COM",
        fullName: "Owner",
      }),
      resolveAdminEmails,
      nodeEnv: "production",
    });
    assert.equal(owner.email, "OWNER@EXAMPLE.COM");

    await assert.rejects(
      requireAdmin({
        getUser: async () => ({
          displayName: "Not Admin",
          email: "third@example.com",
          fullName: "Not Admin",
        }),
        resolveAdminEmails,
        nodeEnv: "production",
      }),
      (error: unknown) =>
        error instanceof AdminAccessError && error.status === 403,
    );
  } finally {
    if (originalProcessValue === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalProcessValue;
    }
  }
});

test("production does not fall back to process ADMIN_EMAILS when the request binding is missing", async () => {
  const requireAdmin = required(
    adminAuthModule.requireAdmin,
    "requireAdmin",
  );
  const AdminAccessError = required(
    adminAuthModule.AdminAccessError,
    "AdminAccessError",
  );
  const originalProcessValue = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "owner@example.com";
  try {
    await assert.rejects(
      requireAdmin({
        getUser: async () => ({
          displayName: "Owner",
          email: "owner@example.com",
          fullName: "Owner",
        }),
        resolveAdminEmails: async () => undefined,
        nodeEnv: "production",
      }),
      (error: unknown) =>
        error instanceof AdminAccessError && error.status === 503,
    );
  } finally {
    if (originalProcessValue === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalProcessValue;
    }
  }
});

test("admin authorization rejects unauthenticated requests before allowlist checks", async () => {
  const requireAdmin = required(
    adminAuthModule.requireAdmin,
    "requireAdmin",
  );
  const AdminAccessError = required(
    adminAuthModule.AdminAccessError,
    "AdminAccessError",
  );

  await assert.rejects(
    requireAdmin({
      getUser: async () => null,
      adminEmails: "owner@example.com",
      nodeEnv: "production",
    }),
    (error: unknown) =>
      error instanceof AdminAccessError && error.status === 401,
  );
});

test("every admin API method authorizes before reading or mutating data", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const AdminAccessError = required(
    adminAuthModule.AdminAccessError,
    "AdminAccessError",
  );
  let repositoryCalls = 0;
  let collectionCalls = 0;
  const repository = collectionRepository({
    async listReviewItems() {
      repositoryCalls += 1;
      return [];
    },
    async resolveReview() {
      repositoryCalls += 1;
    },
  });
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => {
      throw new AdminAccessError(403, "Administrator access required.");
    },
    repository,
    configuredSourceKeys: ["nike"],
    async collectSource() {
      collectionCalls += 1;
      throw new Error("must not collect");
    },
  });

  const responses = await Promise.all([
    handlers.GET(),
    handlers.POST(
      browserMutation("/api/admin/collect", "POST", {
        sourceKey: "nike",
      }),
    ),
    handlers.PATCH(
      browserMutation("/api/admin/reviews/7", "PATCH", {
        action: "ignore",
      }),
      "7",
    ),
  ]);

  assert.deepEqual(
    responses.map(({ status }) => status),
    [403, 403, 403],
  );
  assert.equal(repositoryCalls, 0);
  assert.equal(collectionCalls, 0);
  for (const response of responses) {
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      error: "Administrator access required.",
    });
  }
});

test("admin review GET returns only projected pending data with no-store", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "owner@example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository(),
    configuredSourceKeys: ["nike"],
    async collectSource() {
      throw new Error("not used");
    },
  });

  const response = await handlers.GET();
  const rawBody = await response.text();
  const body = JSON.parse(rawBody);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(body.pendingCount, 1);
  assert.equal(body.reviews[0].candidate.title.includes("script"), true);
  assert.deepEqual(body.reviews[0].previous, {
    title: "Air Example",
    releaseDate: "2026-08-01",
    releaseTime: "10:00",
  });
  assert.equal(rawBody.includes("payloadJson"), false);
  assert.equal(rawBody.includes("must-not-cross-the-api-boundary"), false);
  assert.equal(rawBody.includes("owner@example.com"), false);
});

test("admin source health uses an explicit operator-safe DTO and drops repository diagnostics", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const unsafeDiagnostic =
    "postgres://worker:secret@internal/db https://internal.example at collect (repository.ts:42)";
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "owner@example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository({
      async listSourceHealth() {
        return [{ ...sourceHealth, message: unsafeDiagnostic }];
      },
    }),
    configuredSourceKeys: ["nike"],
    async collectSource() {
      throw new Error("not used");
    },
  });

  const response = await handlers.GET();
  const rawBody = await response.text();
  const body = JSON.parse(rawBody);

  assert.deepEqual(body.sourceHealth, [
    {
      sourceKey: "nike",
      status: "error",
      statusLabel: "Error",
      operatorMessage:
        "Collection failed. Refresh this source or inspect worker logs.",
      lastSuccessAt: "2026-07-29T00:00:00.000Z",
      lastFailureAt: "2026-07-31T00:00:00.000Z",
      consecutiveFailures: 3,
      sourceCount: 12,
      newCount: 2,
      mergedCount: 4,
      reviewCount: 1,
    },
  ]);
  assert.equal(rawBody.includes("postgres://"), false);
  assert.equal(rawBody.includes("secret"), false);
  assert.equal(rawBody.includes("https://internal.example"), false);
  assert.equal(rawBody.includes("repository.ts"), false);
  assert.equal(rawBody.includes("message\":"), false);
});

test("manual collection accepts exactly one registered source key and no arbitrary URL", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const collected: string[] = [];
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "owner@example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository(),
    configuredSourceKeys: ["nike", "asics"],
    async collectSource(sourceKey: string) {
      collected.push(sourceKey);
      return {
        slotKey: "must-not-be-returned",
        sourcesRun: 1,
        sourcesSucceeded: 1,
        sourcesFailed: 0,
        releasesCollected: 3,
        reviewItemsCreated: 1,
      };
    },
  });

  const invalidKey = await handlers.POST(
    browserMutation("/api/admin/collect", "POST", {
      sourceKey: "unknown",
    }),
  );
  const arbitraryUrl = await handlers.POST(
    browserMutation("/api/admin/collect", "POST", {
      sourceKey: "nike",
      url: "https://attacker.example/feed",
    }),
  );
  const valid = await handlers.POST(
    browserMutation("/api/admin/collect", "POST", {
      sourceKey: "asics",
    }),
  );
  const validBody = await valid.json();

  assert.equal(invalidKey.status, 400);
  assert.equal(arbitraryUrl.status, 400);
  assert.equal(valid.status, 200);
  assert.deepEqual(collected, ["asics"]);
  assert.deepEqual(validBody, {
    sourceKey: "asics",
    sourcesRun: 1,
    sourcesSucceeded: 1,
    sourcesFailed: 0,
    releasesCollected: 3,
    reviewItemsCreated: 1,
  });
});

test("review actions reject malformed IDs, unknown fields, dates, times, and actions", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  let resolutionCalls = 0;
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "owner@example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository({
      async resolveReview() {
        resolutionCalls += 1;
      },
    }),
    configuredSourceKeys: ["nike"],
    async collectSource() {
      throw new Error("not used");
    },
  });
  const invalidCases: Array<[string, unknown]> = [
    ["0", { action: "approve" }],
    ["7x", { action: "approve" }],
    ["7", { action: "delete" }],
    ["7", { action: "approve", releaseId: "hidden" }],
    ["7", { action: "merge" }],
    ["7", { action: "merge", releaseId: " target " }],
    [
      "7",
      {
        action: "edit",
        title: "Air Example",
        releaseDate: "2026-02-30",
        releaseTime: "10:00",
      },
    ],
    [
      "7",
      {
        action: "edit",
        title: "",
        releaseDate: "2026-08-02",
        releaseTime: "24:00",
      },
    ],
  ];

  for (const [id, body] of invalidCases) {
    const response = await handlers.PATCH(
      browserMutation(`/api/admin/reviews/${id}`, "PATCH", body),
      id,
    );
    assert.equal(response.status, 400);
  }
  assert.equal(resolutionCalls, 0);
});

test("approve, edit, ignore, and merge pass strict transitions with the admin identity", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const resolutions: ResolveReviewInput[] = [];
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "Owner@Example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository({
      async resolveReview(input) {
        resolutions.push(input);
      },
    }),
    configuredSourceKeys: ["nike"],
    async collectSource() {
      throw new Error("not used");
    },
  });
  const actions = [
    { action: "approve" },
    {
      action: "edit",
      title: "Edited Release",
      releaseDate: "2026-08-03",
      releaseTime: null,
    },
    { action: "ignore" },
    { action: "merge", releaseId: "cached:target" },
  ];

  for (const action of actions) {
    const response = await handlers.PATCH(
      browserMutation("/api/admin/reviews/7", "PATCH", action),
      "7",
    );
    assert.equal(response.status, 200);
  }

  assert.deepEqual(resolutions, [
    { id: 7, action: "approve", resolvedBy: "Owner@Example.com" },
    {
      id: 7,
      action: "edit",
      title: "Edited Release",
      releaseDate: "2026-08-03",
      releaseTime: null,
      resolvedBy: "Owner@Example.com",
    },
    { id: 7, action: "ignore", resolvedBy: "Owner@Example.com" },
    {
      id: 7,
      action: "merge",
      releaseId: "cached:target",
      resolvedBy: "Owner@Example.com",
    },
  ]);
});

test("resolved reviews are immutable and missing merge targets return precise safe statuses", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const ReviewResolutionError = required(
    adminApiModule.ReviewResolutionError,
    "ReviewResolutionError",
  );
  let errorCode: "not_pending" | "merge_target_not_found" =
    "not_pending";
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "owner@example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository({
      async resolveReview() {
        throw new ReviewResolutionError(errorCode);
      },
    }),
    configuredSourceKeys: ["nike"],
    async collectSource() {
      throw new Error("not used");
    },
  });

  const resolvedResponse = await handlers.PATCH(
    browserMutation("/api/admin/reviews/7", "PATCH", {
      action: "approve",
    }),
    "7",
  );
  errorCode = "merge_target_not_found";
  const missingTargetResponse = await handlers.PATCH(
    browserMutation("/api/admin/reviews/7", "PATCH", {
      action: "merge",
      releaseId: "cached:missing",
    }),
    "7",
  );

  assert.equal(resolvedResponse.status, 409);
  assert.deepEqual(await resolvedResponse.json(), {
    error: "Review item is no longer pending.",
  });
  assert.equal(missingTargetResponse.status, 404);
  assert.deepEqual(await missingTargetResponse.json(), {
    error: "Merge target was not found.",
  });
});

test("proxy-safe CSRF rejects missing and cross-site mutation origins", async () => {
  const createAdminApiHandlers = required(
    adminApiModule.createAdminApiHandlers,
    "createAdminApiHandlers",
  );
  const handlers = createAdminApiHandlers({
    requireAdmin: async () => ({
      displayName: "Owner",
      email: "owner@example.com",
      fullName: "Owner",
    }),
    repository: collectionRepository(),
    configuredSourceKeys: ["nike"],
    async collectSource() {
      throw new Error("must not run");
    },
  });
  const missingOrigin = new Request(
    "https://internal.worker/api/admin/collect",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceKey: "nike" }),
    },
  );
  const crossSite = new Request(
    "https://internal.worker/api/admin/reviews/7",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ action: "ignore" }),
    },
  );

  const responses = await Promise.all([
    handlers.POST(missingOrigin),
    handlers.PATCH(crossSite, "7"),
  ]);

  assert.deepEqual(
    responses.map(({ status }) => status),
    [403, 403],
  );
});

test("dashboard controller coalesces duplicate review and source actions", async () => {
  const createAdminDashboardController = required(
    adminControllerModule.createAdminDashboardController,
    "createAdminDashboardController",
  );
  const pendingResponses: Array<(response: Response) => void> = [];
  const requests: Array<{ url: string; method: string }> = [];
  const controller = createAdminDashboardController({
    initialData: adminData(),
    request: async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
      });
      return new Promise<Response>((resolve) => {
        pendingResponses.push(resolve);
      });
    },
  });
  async function resolveNextResponse(response: Response) {
    for (
      let turn = 0;
      turn < 10 && pendingResponses.length === 0;
      turn += 1
    ) {
      await Promise.resolve();
    }
    const resolve = pendingResponses.shift();
    assert.ok(resolve, "controller must issue the expected request");
    resolve(response);
  }

  const firstReview = controller.resolveReview(7, { action: "approve" });
  const duplicateReview = controller.resolveReview(7, {
    action: "ignore",
  });
  assert.equal(controller.getSnapshot().pendingReviewIds.has(7), true);
  assert.deepEqual(requests, [
    { url: "/api/admin/reviews/7", method: "PATCH" },
  ]);
  await resolveNextResponse(
    Response.json({ id: 7, status: "approved" }),
  );
  await resolveNextResponse(Response.json(adminData()));
  await Promise.all([firstReview, duplicateReview]);

  const firstSource = controller.collectSource("nike");
  const duplicateSource = controller.collectSource("nike");
  assert.equal(
    controller.getSnapshot().pendingSourceKeys.has("nike"),
    true,
  );
  assert.equal(
    requests.filter(({ method }) => method === "POST").length,
    1,
  );
  await resolveNextResponse(
    Response.json({
      sourceKey: "nike",
      sourcesRun: 1,
      sourcesSucceeded: 1,
      sourcesFailed: 0,
      releasesCollected: 2,
      reviewItemsCreated: 0,
    }),
  );
  await resolveNextResponse(Response.json(adminData()));
  await Promise.all([firstSource, duplicateSource]);

  assert.equal(controller.getSnapshot().pendingReviewIds.size, 0);
  assert.equal(controller.getSnapshot().pendingSourceKeys.size, 0);
  assert.equal(requests.length, 4);
});

test("a later mutation schedules exactly one trailing refresh after an older mutation refresh", async () => {
  const createAdminDashboardController = required(
    adminControllerModule.createAdminDashboardController,
    "createAdminDashboardController",
  );
  const pending: Array<{
    url: string;
    method: string;
    resolve(response: Response): void;
  }> = [];
  const controller = createAdminDashboardController({
    initialData: adminDataVersion("initial"),
    request: async (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        pending.push({
          url: String(input),
          method: init?.method ?? "GET",
          resolve,
        });
      }),
  });
  async function waitForRequests(count: number) {
    for (let turn = 0; turn < 20 && pending.length < count; turn += 1) {
      await Promise.resolve();
    }
    assert.equal(pending.length, count);
  }

  const mutationA = controller.resolveReview(7, { action: "approve" });
  await waitForRequests(1);
  pending[0].resolve(Response.json({ id: 7, status: "approved" }));
  await waitForRequests(2);
  assert.deepEqual(
    pending.map(({ method }) => method),
    ["PATCH", "GET"],
  );

  const mutationB = controller.collectSource("nike");
  await waitForRequests(3);
  pending[2].resolve(
    Response.json({
      sourceKey: "nike",
      sourcesRun: 1,
      sourcesSucceeded: 1,
      sourcesFailed: 0,
      releasesCollected: 1,
      reviewItemsCreated: 0,
    }),
  );
  pending[1].resolve(Response.json(adminDataVersion("after A")));
  await waitForRequests(4);
  assert.deepEqual(
    pending.map(({ method }) => method),
    ["PATCH", "GET", "POST", "GET"],
  );
  pending[3].resolve(Response.json(adminDataVersion("after B")));

  await Promise.all([mutationA, mutationB]);
  assert.equal(
    controller.getSnapshot().data.reviews[0].candidate.title,
    "after B",
  );
  assert.equal(
    pending.filter(({ method }) => method === "GET").length,
    2,
  );
});

test("a mutation overlapping a manual refresh receives one trailing authoritative refresh", async () => {
  const createAdminDashboardController = required(
    adminControllerModule.createAdminDashboardController,
    "createAdminDashboardController",
  );
  const pending: Array<{
    url: string;
    method: string;
    resolve(response: Response): void;
  }> = [];
  const controller = createAdminDashboardController({
    initialData: adminDataVersion("initial"),
    request: async (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        pending.push({
          url: String(input),
          method: init?.method ?? "GET",
          resolve,
        });
      }),
  });
  async function waitForRequests(count: number) {
    for (let turn = 0; turn < 20 && pending.length < count; turn += 1) {
      await Promise.resolve();
    }
    assert.equal(pending.length, count);
  }

  const manualRefresh = controller.refresh();
  await waitForRequests(1);
  const mutation = controller.resolveReview(7, { action: "ignore" });
  await waitForRequests(2);
  pending[1].resolve(Response.json({ id: 7, status: "ignored" }));
  pending[0].resolve(Response.json(adminDataVersion("manual stale")));
  await waitForRequests(3);
  pending[2].resolve(Response.json(adminDataVersion("mutation current")));

  await Promise.all([manualRefresh, mutation]);
  assert.equal(
    controller.getSnapshot().data.reviews[0].candidate.title,
    "mutation current",
  );
  assert.equal(
    pending.filter(({ method }) => method === "GET").length,
    2,
  );
});

test("failed dashboard mutations clear central pending state and permit retry", async () => {
  const createAdminDashboardController = required(
    adminControllerModule.createAdminDashboardController,
    "createAdminDashboardController",
  );
  let requests = 0;
  const controller = createAdminDashboardController({
    initialData: adminData(),
    request: async () => {
      requests += 1;
      return Response.json(
        { error: "Review item is no longer pending." },
        { status: 409 },
      );
    },
  });

  assert.equal(
    await controller.resolveReview(7, { action: "approve" }),
    false,
  );
  assert.equal(controller.getSnapshot().pendingReviewIds.has(7), false);
  assert.equal(
    await controller.resolveReview(7, { action: "ignore" }),
    false,
  );
  assert.equal(requests, 2);
});

test("dashboard controller rejects raw repository health rows at the client boundary", async () => {
  const createAdminDashboardController = required(
    adminControllerModule.createAdminDashboardController,
    "createAdminDashboardController",
  );
  const initialData = adminDataVersion("initial");
  const controller = createAdminDashboardController({
    initialData,
    request: async () =>
      Response.json({
        ...adminDataVersion("unsafe"),
        sourceHealth: [sourceHealth],
      }),
  });

  assert.equal(await controller.refresh(), false);
  assert.equal(
    controller.getSnapshot().data.reviews[0].candidate.title,
    "initial",
  );
  assert.equal(
    controller.getSnapshot().error,
    "The administration response was invalid.",
  );
});

test("dashboard SSR escapes candidate payloads and shows exception health warnings", () => {
  const AdminDashboard = required(
    adminDashboardModule.AdminDashboard,
    "AdminDashboard",
  );

  const html = renderToStaticMarkup(
    React.createElement(AdminDashboard, {
      initialData: adminData(),
      now: "2026-07-31T12:00:00.000Z",
    }),
  );

  assert.equal(html.includes("<script>alert"), false);
  assert.equal(
    html.includes("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;"),
    true,
  );
  assert.match(html, /3 consecutive failures/i);
  assert.match(html, /24 hours without a successful collection/i);
  assert.match(html, /Approve/);
  assert.match(html, /Edit/);
  assert.match(html, /Ignore/);
  assert.match(html, /Merge/);
  assert.match(html, /Refresh Nike/);
});

test("source health warning crosses 24 hours deterministically and rejects ambiguous timestamps", () => {
  const sourceHealthWarnings = required(
    adminDashboardModule.sourceHealthWarnings,
    "sourceHealthWarnings",
  );
  const healthy = {
    ...sourceHealth,
    consecutiveFailures: 0,
    lastSuccessAt: "2026-07-30T12:00:00.000Z",
  };

  assert.deepEqual(
    sourceHealthWarnings(healthy, "2026-07-31T11:59:59.999Z"),
    [],
  );
  assert.deepEqual(
    sourceHealthWarnings(healthy, "2026-07-31T12:00:00.000Z"),
    ["24 hours without a successful collection"],
  );
  assert.deepEqual(
    sourceHealthWarnings(
      { ...healthy, lastSuccessAt: "2026-07-30 12:00:00" },
      "2026-07-31T11:00:00.000Z",
    ),
    ["24 hours without a successful collection"],
  );
});

test("merge target reconciliation preserves valid targets and follows option removal or appearance", () => {
  const reconcileMergeTarget = required(
    adminDashboardModule.reconcileMergeTarget,
    "reconcileMergeTarget",
  );
  const first = { id: "release-a", title: "A", releaseDate: "2026-08-01" };
  const second = { id: "release-b", title: "B", releaseDate: "2026-08-02" };

  assert.equal(
    reconcileMergeTarget("release-b", [first, second]),
    "release-b",
  );
  assert.equal(
    reconcileMergeTarget("release-b", [first]),
    "release-a",
  );
  assert.equal(reconcileMergeTarget("", [second]), "release-b");
  assert.equal(reconcileMergeTarget("release-a", []), "");
});

test("worker responses make every admin page and API path no-store without affecting lookalikes", () => {
  const withAdminPageNoStore = required(
    adminCacheModule.withAdminPageNoStore,
    "withAdminPageNoStore",
  );
  const adminResponse = withAdminPageNoStore(
    new Request("https://calendar.example/admin"),
    new Response("denied", {
      status: 404,
      headers: { "x-existing": "kept" },
    }),
  );
  const nestedAdminResponse = withAdminPageNoStore(
    new Request("https://calendar.example/admin/history"),
    new Response("history"),
  );
  const adminApiResponses = [
    ["GET", "/api/admin/reviews", 200],
    ["POST", "/api/admin/collect", 405],
    ["OPTIONS", "/api/admin/reviews/7", 204],
    ["GET", "/api/admin/missing", 404],
  ].map(([method, pathname, status]) =>
    withAdminPageNoStore(
      new Request(`https://calendar.example${pathname}`, {
        method: String(method),
      }),
      new Response(status === 204 ? null : String(status), {
        status: Number(status),
      }),
    ),
  );
  const publicResponse = withAdminPageNoStore(
    new Request("https://calendar.example/administrator"),
    new Response("public", {
      headers: { "Cache-Control": "public, max-age=60" },
    }),
  );

  assert.equal(
    adminResponse.headers.get("Cache-Control"),
    "private, no-store",
  );
  assert.equal(adminResponse.headers.get("x-existing"), "kept");
  assert.equal(adminResponse.status, 404);
  assert.equal(
    nestedAdminResponse.headers.get("Cache-Control"),
    "private, no-store",
  );
  for (const response of adminApiResponses) {
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, no-store",
    );
  }
  assert.equal(
    publicResponse.headers.get("Cache-Control"),
    "public, max-age=60",
  );
});
