import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { drizzle } from "drizzle-orm/d1";
import {
  createCollectionRepositoryWithDb,
  readReleaseApiPayload,
  ReviewResolutionError,
  type CachedRelease,
  type CollectionRepository,
  type PersistSourceOutcome,
  type PersistSourceResult,
  type ResolveReviewInput,
  type ReviewItem,
  type SlotClaimOutcome,
  type SourceHealth,
} from "../app/collection/repository.ts";
import { runCollection } from "../app/collection/run.ts";
import type { ReleaseSourceAdapter } from "../app/collection/registry.ts";
import {
  changedFields,
  groupCollectedReleases,
  type ReleaseGroup,
} from "../app/collection/dedupe.ts";
import type {
  AdapterReleaseInput,
  CollectedRelease,
  ReleaseKind,
} from "../app/collection/types.ts";
import * as schema from "../db/schema.ts";

const collectedAt = "2026-07-31T00:00:00.000Z";
const t0 = "2026-07-31T01:00:00.000Z";
const t1 = "2026-07-31T01:01:00.000Z";
const t5 = "2026-07-31T01:05:00.000Z";
const t15 = "2026-07-31T01:15:00.000Z";
const t16 = "2026-07-31T01:16:00.000Z";

const baseRelease: CollectedRelease = {
  sourceKey: "official",
  externalId: "release-1",
  title: "Air Example",
  brand: "Nike",
  category: "sneakers",
  releaseKind: "general",
  releaseDate: "2026-08-01",
  releaseTime: "10:00",
  priceLabel: "₩179,000",
  styleCode: "DD-1399-100",
  retailer: "Official Store",
  productUrl: "https://store.example.com/products/air-example",
  sourceUrl: "https://store.example.com/calendar",
  collectedAt,
};

test("cached collection preserves a raffle's closing time, original SKU and overseas scope", async () => {
  const repository = productionRepository(new SQLiteD1());
  const release = {...baseRelease, startAt:"2026-07-31T10:00:00+09:00", endAt:"2026-08-01T18:00:00+09:00", region:"일본", marketScope:"overseas" as const};
  await repository.persistSourceResult(sourceResult({groups:[releaseGroup(release)]}));
  const [cached] = await repository.listCachedReleases();
  assert.equal(cached.channels[0].startAt,"2026-07-31T10:00:00+09:00");
  assert.equal(cached.channels[0].endAt,"2026-08-01T18:00:00+09:00");
  assert.equal(cached.channels[0].styleCode,"DD-1399-100");
  assert.equal(cached.channels[0].marketScope,"overseas");
});

test("public API preserves schedule details, note and original method on every channel", async () => {
  const repository = productionRepository(new SQLiteD1());
  const release = {...baseRelease, releaseKind:"raffle" as const, startAt:"2026-07-31T10:00:00+09:00", endAt:"2026-08-01T18:00:00+09:00", announcementAt:"2026-08-02T10:00:00+09:00", note:"본인 인증 후 응모", releaseMethod:"온라인 드로우", region:"일본", marketScope:"overseas" as const};
  await repository.persistSourceResult(sourceResult({groups:[releaseGroup(release)]}));
  const [published] = (await readReleaseApiPayload(repository)).releases;
  assert.equal(published.note,release.note);
  assert.equal(published.releaseMethod,release.releaseMethod);
  assert.equal(published.channels[0].externalId,release.externalId);
  assert.equal(published.channels[0].endAt,release.endAt);
  assert.equal(published.channels[0].announcementAt,release.announcementAt);
});

test("cached same-market SKU peers still detect conflicting schedules", async () => {
  const repository = productionRepository(new SQLiteD1());
  const first={...baseRelease, sourceKey:"newBalanceUS", retailer:"US Store", releaseTime:"10:00"};
  const second={...first,sourceKey:"asicsUS",externalId:"second",releaseTime:"11:00"};
  await repository.persistSourceResult(sourceResult({sourceKey:first.sourceKey,groups:groupCollectedReleases([first])}));
  await repository.persistSourceResult(sourceResult({sourceKey:second.sourceKey,groups:groupCollectedReleases([second])}));
  assert.deepEqual((await repository.listReviewItems()).filter(item=>item.reason==="conflicting_schedule").map(item=>item.sourceKey).sort(),[first.sourceKey,second.sourceKey].sort());
});

test("legacy channels backfill note and SKU without overwriting catalog edits", async () => {
  const d1=new SQLiteD1();
  d1.execute(readFileSync(new URL("../drizzle/0000_talented_millenium_guard.sql",import.meta.url),"utf8"));
  const db=drizzle(d1 as never,{schema});
  await db.insert(schema.releases).values({title:"Manual release",brand:"Nike",category:"응모",releaseDate:"2026-08-01",channel:"Nike",sourceName:"Nike",status:"예정",confidence:100,note:"학생용 안내",isFeatured:false,styleCode:"DD-1399-100",releaseMethod:"앱 응모"});
  const repository=createCollectionRepositoryWithDb(db);
  await repository.listCachedReleases();
  d1.execute("update release_channels set details_json = NULL");
  d1.execute("update release_catalog set title = 'Edited title'");
  const [cached]=await repository.listCachedReleases();
  assert.equal(cached.title,"Edited title");
  assert.equal(cached.channels[0].styleCode,"DD-1399-100");
  assert.equal(cached.channels[0].note,"학생용 안내");
  assert.equal(cached.channels[0].releaseMethod,"앱 응모");
});

function releaseGroup(
  release: CollectedRelease = baseRelease,
  reviewReason: ReleaseGroup["reviewReason"] = null,
): ReleaseGroup {
  return {
    canonicalKey: "style:dd1399100",
    release,
    channels: [release],
    reviewReason,
  };
}

function indexedReleaseGroup(index: number): ReleaseGroup {
  const suffix = String(index).padStart(3, "0");
  const release = {
    ...baseRelease,
    externalId: `release-${suffix}`,
    title: `Air Example ${suffix}`,
    styleCode: `STYLE-${suffix}`,
    productUrl: `https://store.example.com/products/air-example-${suffix}`,
  };
  return {
    ...releaseGroup(release),
    canonicalKey: `style:style${suffix}`,
  };
}

function sourceResult(
  overrides: Partial<PersistSourceResult> = {},
): PersistSourceResult {
  return {
    sourceKey: "official",
    status: "connected",
    groups: [releaseGroup()],
    collectedAt,
    message: "connected",
    confirmedEmpty: false,
    ...overrides,
  };
}

class InMemoryCollectionRepository implements CollectionRepository {
  readonly events: string[] = [];
  private readonly slots = new Map<
    string,
    { state: "running"; claimToken: string } | { state: "completed" | "failed" }
  >();
  private readonly groups = new Map<string, ReleaseGroup>();

  async claimSlot(
    slotKey: string,
    _startedAt: string,
    claimToken: string,
    _staleBefore: string,
  ): Promise<SlotClaimOutcome> {
    const slot = this.slots.get(slotKey);
    if (slot?.state === "running") return { state: "in_progress" };
    if (slot?.state === "completed") return { state: "completed" };
    if (slot?.state === "failed") return { state: "failed" };
    this.slots.set(slotKey, { state: "running", claimToken });
    return { state: "claimed", claimToken, reclaimed: false };
  }

  async completeSlot(
    slotKey: string,
    claimToken: string,
    _completedAt: string,
  ): Promise<boolean> {
    const slot = this.slots.get(slotKey);
    if (slot?.state !== "running" || slot.claimToken !== claimToken) {
      return false;
    }
    this.slots.set(slotKey, { state: "completed" });
    return true;
  }

  async failSlot(
    slotKey: string,
    claimToken: string,
    _completedAt: string,
  ): Promise<boolean> {
    const slot = this.slots.get(slotKey);
    if (slot?.state !== "running" || slot.claimToken !== claimToken) {
      return false;
    }
    this.slots.set(slotKey, { state: "failed" });
    return true;
  }

  async listCachedReleases(): Promise<CachedRelease[]> {
    return [...this.groups.values()].map(({ canonicalKey, release, channels }) => ({
      id: canonicalKey,
      canonicalKey,
      title: release.title,
      brand: release.brand,
      category: release.category,
      releaseKind: release.releaseKind,
      releaseDate: release.releaseDate,
      releaseTime: release.releaseTime,
      changedAt: null,
      lastVerifiedAt: release.collectedAt,
      channels: channels.map((channel) => ({
        sourceKey: channel.sourceKey,
        retailer: channel.retailer,
        productUrl: channel.productUrl,
        sourceUrl: channel.sourceUrl,
        priceLabel: channel.priceLabel,
        releaseDate: channel.releaseDate,
        releaseTime: channel.releaseTime,
      })),
    }));
  }

  async persistSourceResult(
    result: PersistSourceResult,
  ): Promise<PersistSourceOutcome> {
    if (result.status !== "connected") {
      return { reviewItemsCreated: 0 };
    }

    if (result.groups.length === 0) {
      if (
        !result.confirmedEmpty ||
        result.authoritativeSnapshot !== true
      ) {
        return { reviewItemsCreated: 0 };
      }

      for (const [key, group] of this.groups) {
        const channels = group.channels.filter(
          ({ sourceKey }) => sourceKey !== result.sourceKey,
        );
        if (channels.length === 0) {
          this.groups.delete(key);
        } else {
          this.groups.set(key, { ...group, channels });
        }
      }
      return { reviewItemsCreated: 0 };
    }

    for (const group of result.groups) {
      if (group.reviewReason) continue;
      const previous = this.groups.get(group.canonicalKey);
      if (previous) {
        for (const change of changedFields(previous.release, group.release)) {
          this.events.push(`change:${change.field}`);
        }
      }
      this.events.push(`catalog:${previous ? "update" : "insert"}`);
      this.groups.set(group.canonicalKey, group);
    }
    return { reviewItemsCreated: 0 };
  }

  async listSourceHealth(): Promise<SourceHealth[]> {
    return [];
  }

  async listReviewItems(): Promise<ReviewItem[]> {
    return [];
  }

  async countPendingReviewItems(): Promise<number> {
    return 0;
  }

  async listPendingNikeMissingDateReviews(): Promise<ReviewItem[]> {
    return [];
  }

  async resolveReview(_input: ResolveReviewInput): Promise<void> {}
}

test("only one repository caller can claim the same collection slot", async () => {
  const repository = new InMemoryCollectionRepository();

  const claims = await Promise.all([
    repository.claimSlot(
      "2026-07-31@09:30",
      collectedAt,
      "owner-a",
      "2026-07-30T23:45:00.000Z",
    ),
    repository.claimSlot(
      "2026-07-31@09:30",
      collectedAt,
      "owner-b",
      "2026-07-30T23:45:00.000Z",
    ),
  ]);

  assert.deepEqual(claims, [
    { state: "claimed", claimToken: "owner-a", reclaimed: false },
    { state: "in_progress" },
  ]);
});

test("failed source persistence preserves the last successful cached releases", async () => {
  const repository = new InMemoryCollectionRepository();
  await repository.persistSourceResult(sourceResult());

  await repository.persistSourceResult(
    sourceResult({
      status: "error",
      groups: [],
      message: "network error",
    }),
  );

  assert.equal((await repository.listCachedReleases()).length, 1);
});

test("an unconfirmed empty success preserves cached releases", async () => {
  const repository = new InMemoryCollectionRepository();
  await repository.persistSourceResult(sourceResult());

  await repository.persistSourceResult(
    sourceResult({ groups: [], confirmedEmpty: false }),
  );

  assert.equal((await repository.listCachedReleases()).length, 1);
});

test("confirmed empty cleanup requires explicit authority", async () => {
  for (const authority of [undefined, false]) {
    const repository = new InMemoryCollectionRepository();
    await repository.persistSourceResult(sourceResult());

    await repository.persistSourceResult(
      sourceResult({
        groups: [],
        confirmedEmpty: true,
        authoritativeSnapshot: authority,
      }),
    );

    assert.equal((await repository.listCachedReleases()).length, 1);
  }

  const repository = new InMemoryCollectionRepository();
  await repository.persistSourceResult(sourceResult());

  await repository.persistSourceResult(
    sourceResult({
      groups: [],
      confirmedEmpty: true,
      authoritativeSnapshot: true,
    }),
  );

  assert.deepEqual(await repository.listCachedReleases(), []);
});

test("change records are written before catalog updates", async () => {
  const repository = new InMemoryCollectionRepository();
  await repository.persistSourceResult(sourceResult());
  repository.events.length = 0;

  await repository.persistSourceResult(
    sourceResult({
      groups: [
        releaseGroup({
          ...baseRelease,
          releaseDate: "2026-08-02",
          releaseTime: "11:00",
        }),
      ],
    }),
  );

  assert.deepEqual(repository.events, [
    "change:releaseDate",
    "change:releaseTime",
    "catalog:update",
  ]);
});

type RecordedStatement = {
  sql: string;
  params: unknown[];
};

class RecordingStatement {
  constructor(
    private readonly owner: RecordingD1,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new RecordingStatement(this.owner, this.sql, params);
  }

  async raw() {
    return this.owner.raw(this);
  }

  async all() {
    return { results: [] };
  }

  async run() {
    return { success: true, results: [], meta: {} };
  }
}

class RecordingD1 {
  readonly batchCalls: RecordedStatement[][] = [];
  readonly claimedSlots = new Set<string>();
  readonly preparedSql: string[] = [];
  readonly executedStatements: RecordedStatement[] = [];
  catalogRows: unknown[][] = [];
  channelRows: unknown[][] = [];

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new RecordingStatement(this, sql);
  }

  async raw(statement: RecordingStatement): Promise<unknown[][]> {
    this.executedStatements.push({
      sql: statement.sql,
      params: [...statement.params],
    });
    if (
      statement.sql.includes('insert into "release_sources"') &&
      statement.sql.includes("returning")
    ) {
      const token = statement.params.find(
        (param) =>
          typeof param === "string" &&
          param.startsWith("source-claim:"),
      );
      return token ? [[token]] : [];
    }
    if (statement.sql.includes('insert into "collection_slots"')) {
      const slotKey = String(statement.params[0]);
      if (this.claimedSlots.has(slotKey)) {
        if (!statement.sql.includes("on conflict")) {
          throw new Error("UNIQUE constraint failed: collection_slots.slot_key");
        }
        return [];
      }
      this.claimedSlots.add(slotKey);
      return [[slotKey]];
    }
    if (statement.sql.includes('from "release_catalog"')) {
      return this.catalogRows;
    }
    if (statement.sql.includes('from "release_channels"')) {
      return this.channelRows;
    }
    return [];
  }

  async batch(statements: RecordingStatement[]) {
    this.batchCalls.push(
      statements.map(({ sql, params }) => ({ sql, params: [...params] })),
    );
    return statements.map(() => ({ success: true, results: [], meta: {} }));
  }
}

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
    return this.owner.raw(this);
  }

  async all() {
    return { results: this.owner.all(this) };
  }

  async run() {
    return this.owner.run(this);
  }
}

class SQLiteD1 {
  readonly database = new DatabaseSync(":memory:");
  readonly parameterCounts: number[] = [];
  readonly preparedSql: string[] = [];

  constructor(
    private readonly beforeRaw?: (statement: SQLiteStatement) => void,
  ) {
    this.database.exec("PRAGMA foreign_keys = ON");
    for (const migration of [
      "../drizzle/0001_collaboration_release_cache.sql",
      "../drizzle/0002_handy_wendigo.sql",
      "../drizzle/0003_collection_slot_claim_token.sql",
      "../drizzle/0004_channel_schedule_metadata.sql",
    ]) {
      const sql = readFileSync(new URL(migration, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        if (statement.trim()) this.database.exec(statement);
      }
    }
  }

  prepare(sql: string) {
    this.preparedSql.push(sql);
    return new SQLiteStatement(this, sql);
  }

  private boundParams(statement: SQLiteStatement): SqliteValue[] {
    this.parameterCounts.push(statement.params.length);
    assert.ok(
      statement.params.length <= 100,
      `D1 parameter limit exceeded: ${statement.params.length}`,
    );
    return statement.params as SqliteValue[];
  }

  raw(statement: SQLiteStatement): unknown[][] {
    this.beforeRaw?.(statement);
    const prepared = this.database.prepare(statement.sql);
    prepared.setReturnArrays(true);
    return prepared.all(...this.boundParams(statement)) as unknown[][];
  }

  all(statement: SQLiteStatement): Record<string, unknown>[] {
    return this.database
      .prepare(statement.sql)
      .all(...this.boundParams(statement)) as Record<string, unknown>[];
  }

  run(statement: SQLiteStatement) {
    const result = this.database
      .prepare(statement.sql)
      .run(...this.boundParams(statement));
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

  async batch(statements: SQLiteStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        if (
          /^\s*(select|with)\b/i.test(statement.sql) ||
          /\breturning\b/i.test(statement.sql)
        ) {
          const rows = this.all(statement);
          return {
            success: true,
            results: rows,
            meta: {
              changes: rows.length,
              changed_db: rows.length > 0,
              last_row_id: 0,
            },
          };
        }
        return this.run(statement);
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  execute(sql: string, ...params: SqliteValue[]) {
    return this.database.prepare(sql).run(...params);
  }

  rows<T extends Record<string, unknown>>(
    sql: string,
    ...params: SqliteValue[]
  ): T[] {
    return this.database
      .prepare(sql)
      .all(...params)
      .map((row) => ({ ...row })) as T[];
  }
}

function productionRepository(d1: RecordingD1 | SQLiteD1) {
  return createCollectionRepositoryWithDb(
    drizzle(d1 as never, { schema }),
  );
}

function integrationAdapter(
  sourceKey: string,
  options: {
    styleCode: string;
    externalId: string;
    title: string;
    releaseDate: string;
    releaseTime: string | null;
    releaseKind?: ReleaseKind;
  },
): ReleaseSourceAdapter {
  const release: AdapterReleaseInput = {
    sourceKey,
    externalId: options.externalId,
    title: options.title,
    brand: "Example",
    releaseDate: options.releaseDate,
    releaseTime: options.releaseTime,
    priceLabel: null,
    styleCode: options.styleCode,
    retailer: `${sourceKey} Store`,
    productUrl: `https://${sourceKey}.example/products/${options.externalId}`,
    sourceUrl: `https://${sourceKey}.example/calendar`,
    collectedAt: "",
    allowedDomains: [`${sourceKey}.example`],
    releaseKindHint: options.releaseKind ?? "general",
  };
  return {
    key: sourceKey,
    retailer: `${sourceKey} Store`,
    allowedDomains: [`${sourceKey}.example`],
    async collect() {
      return {
        sourceKey,
        status: "connected",
        releases: [release],
        message: `${sourceKey} connected`,
        confirmedEmpty: false,
      };
    },
  };
}

function pendingConflictBreakdown(d1: SQLiteD1, canonicalKey: string) {
  return d1
    .rows<{
      id: number;
      source_key: string;
      external_id: string;
      reason: string;
      payload_json: string;
    }>(
      `select id, source_key, external_id, reason, payload_json
       from review_items
       where status = 'pending'
       order by source_key, external_id`,
    )
    .flatMap((row) => {
      const payload = JSON.parse(row.payload_json) as ReleaseGroup;
      return payload.canonicalKey === canonicalKey
        ? [{
            id: row.id,
            sourceKey: row.source_key,
            externalId: row.external_id,
            reason: row.reason,
            canonicalKey: payload.canonicalKey,
            payloadIdentities: payload.channels.map(
              (channel) => `${channel.sourceKey}:${channel.externalId}`,
            ),
          }]
        : [];
    });
}

function normalizedSql(statements: RecordedStatement[]) {
  return statements.map(({ sql }) => sql.replace(/\s+/g, " ").trim());
}

function sourceExternalIds(d1: SQLiteD1) {
  return d1
    .rows<{ external_id: string }>(
      "select external_id from release_channels where source_key = ? order by external_id",
      "official",
    )
    .map(({ external_id }) => external_id);
}

async function seedCachedSourceChannels() {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const keptRelease = {
    ...baseRelease,
    externalId: "kept",
    title: "Kept Release",
    styleCode: "KEPT-100",
    productUrl: "https://store.example.com/products/kept",
  };
  const omittedRelease = {
    ...baseRelease,
    externalId: "omitted",
    title: "Omitted Release",
    styleCode: "OMITTED-100",
    productUrl: "https://store.example.com/products/omitted",
  };
  const keptGroup = {
    ...releaseGroup(keptRelease),
    canonicalKey: "style:kept100",
  };

  await repository.persistSourceResult(
    sourceResult({
      groups: [
        keptGroup,
        {
          ...releaseGroup(omittedRelease),
          canonicalKey: "style:omitted100",
        },
      ],
      authoritativeSnapshot: true,
    }),
  );
  const omittedReleaseId = d1.rows<{ release_id: string }>(
    "select release_id from release_channels where source_key = ? and external_id = ?",
    "official",
    "omitted",
  )[0].release_id;
  d1.execute(
    "insert into saved_releases (user_email, release_id, created_at) values (?, ?, ?)",
    "saved@example.com",
    omittedReleaseId,
    collectedAt,
  );
  d1.execute(
    `insert into release_changes (
      release_id, field, previous_value, next_value, changed_at
    ) values (?, ?, ?, ?, ?)`,
    omittedReleaseId,
    "priceLabel",
    null,
    omittedRelease.priceLabel,
    collectedAt,
  );

  return { d1, repository, keptGroup, omittedReleaseId };
}

function allRecordedStatements(d1: RecordingD1): RecordedStatement[] {
  return [...d1.executedStatements, ...d1.batchCalls.flat()];
}

test("production slot claims use one conflict-safe insert", async () => {
  const d1 = new RecordingD1();
  const repository = productionRepository(d1);

  const claim = await repository.claimSlot(
    "2026-07-31@09:30",
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  assert.deepEqual(claim, {
    state: "claimed",
    claimToken: "owner-a",
    reclaimed: false,
  });
  assert.equal(d1.claimedSlots.size, 1);
  const claimSql = d1.preparedSql.filter((sql) =>
    sql.includes('insert into "collection_slots"'),
  );
  assert.equal(claimSql.length, 1);
  assert.ok(
    claimSql.every(
      (sql) => sql.includes("on conflict") && sql.includes("do nothing"),
    ),
  );
});

test("production API review reads use one count and one narrow Nike pending query", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const payloadJson = JSON.stringify(releaseGroup());
  const rows = [
    ["nike", "nike-pending", "missing_date", payloadJson, "pending"],
    ["nike", "nike-approved", "missing_date", payloadJson, "approved"],
    ["nike", "nike-duplicate", "possible_duplicate", payloadJson, "pending"],
    ["asics", "asics-pending", "missing_date", payloadJson, "pending"],
    ["nike", "nike-malformed", "missing_date", "{not-json", "pending"],
  ] as const;

  for (const [sourceKey, externalId, reason, payload, status] of rows) {
    d1.execute(
      `insert into review_items (
        source_key, external_id, reason, payload_json, status, created_at
      ) values (?, ?, ?, ?, ?, ?)`,
      sourceKey,
      externalId,
      reason,
      payload,
      status,
      collectedAt,
    );
  }

  const sqlBefore = d1.preparedSql.length;
  const paramsBefore = d1.parameterCounts.length;
  assert.equal(typeof repository.countPendingReviewItems, "function");
  assert.equal(
    typeof repository.listPendingNikeMissingDateReviews,
    "function",
  );
  if (
    typeof repository.countPendingReviewItems !== "function" ||
    typeof repository.listPendingNikeMissingDateReviews !== "function"
  ) {
    return;
  }
  const pendingCount = await repository.countPendingReviewItems();
  const nikeReviews =
    await repository.listPendingNikeMissingDateReviews();

  assert.equal(pendingCount, 4);
  assert.deepEqual(
    nikeReviews.map(({ externalId, status, reason }) => ({
      externalId,
      status,
      reason,
    })),
    [
      {
        externalId: "nike-malformed",
        status: "pending",
        reason: "missing_date",
      },
      {
        externalId: "nike-pending",
        status: "pending",
        reason: "missing_date",
      },
    ],
  );
  assert.equal(d1.preparedSql.length - sqlBefore, 2);
  assert.deepEqual(
    d1.parameterCounts.slice(paramsBefore).sort((left, right) => left - right),
    [1, 3],
  );
});

for (const result of [
  sourceResult({ status: "error", groups: [], message: "network error" }),
  sourceResult({ groups: [], confirmedEmpty: false }),
]) {
  test(`${result.status === "error" ? "failed" : "unconfirmed empty"} production persistence updates health without deleting cache rows`, async () => {
    const d1 = new RecordingD1();
    const repository = productionRepository(d1);

    await repository.persistSourceResult(result);

    assert.equal(d1.batchCalls.length, 1);
    const sql = normalizedSql(d1.batchCalls[0]);
    assert.ok(sql.some((query) => query.includes('update "release_sources"')));
    assert.ok(
      d1.executedStatements.some(({ sql }) =>
        sql.includes('insert into "release_sources"'),
      ),
    );
    assert.ok(sql.every((query) => !query.includes('delete from "release_channels"')));
    assert.ok(sql.every((query) => !query.includes('"release_catalog"')));
  });
}

test("confirmed empty production persistence clears source channels but retains catalog history", async () => {
  const d1 = new RecordingD1();
  const repository = productionRepository(d1);

  await repository.persistSourceResult(
    sourceResult({
      groups: [],
      confirmedEmpty: true,
      authoritativeSnapshot: true,
    }),
  );

  assert.equal(d1.batchCalls.length, 1);
  const sql = normalizedSql(d1.batchCalls[0]);
  assert.ok(sql.some((query) => query.includes('delete from "release_channels"')));
  assert.ok(sql.some((query) => query.includes('update "release_sources"')));
  assert.ok(sql.every((query) => !query.includes('delete from "release_catalog"')));
});

test("partial connected persistence retains omitted cached source identities", async () => {
  const d1 = new RecordingD1();
  d1.channelRows = [
    [
      "release-existing",
      "official",
      "release-1",
      "2026-08-01",
      "10:00",
      "₩179,000",
      "https://store.example.com/products/air-example",
    ],
    [
      "release-omitted",
      "official",
      "release-omitted",
      "2026-08-02",
      "11:00",
      "₩189,000",
      "https://store.example.com/products/omitted",
    ],
  ];
  const repository = productionRepository(d1);

  await repository.persistSourceResult(
    sourceResult({ authoritativeSnapshot: false } as Partial<PersistSourceResult>),
  );

  const sql = normalizedSql(d1.batchCalls[0]);
  assert.ok(
    sql.every((query) => !query.includes('delete from "release_channels"')),
  );
});

test("partial snapshots without explicit authority retain omitted cached source channels", async () => {
  for (const authority of [undefined, false]) {
    const { d1, repository, keptGroup } = await seedCachedSourceChannels();

    const outcome = await repository.persistSourceResult(
      sourceResult({
        groups: [keptGroup],
        authoritativeSnapshot: authority,
        collectedAt: "2026-07-31T01:00:00.000Z",
      }),
    );

    assert.deepEqual(sourceExternalIds(d1), ["kept", "omitted"]);
    assert.equal(outcome.reviewItemsCreated, 0);
  }
});

test("explicit authoritative partial snapshots remove omitted channels but preserve catalog relationships", async () => {
  const { d1, repository, keptGroup, omittedReleaseId } =
    await seedCachedSourceChannels();

  const outcome = await repository.persistSourceResult(
    sourceResult({
      groups: [keptGroup],
      authoritativeSnapshot: true,
      collectedAt: "2026-07-31T01:00:00.000Z",
    }),
  );

  assert.deepEqual(sourceExternalIds(d1), ["kept"]);
  assert.equal(outcome.reviewItemsCreated, 0);
  assert.deepEqual(
    d1.rows<{ id: string }>(
      "select id from release_catalog where id = ?",
      omittedReleaseId,
    ),
    [{ id: omittedReleaseId }],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from saved_releases where release_id = ?",
      omittedReleaseId,
    ),
    [{ release_id: omittedReleaseId }],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from release_changes where release_id = ?",
      omittedReleaseId,
    ),
    [{ release_id: omittedReleaseId }],
  );
  assert.deepEqual(d1.rows("PRAGMA foreign_key_check"), []);
});

test("one production source result batches changes before catalog updates with channels, health, and reviews", async () => {
  const d1 = new RecordingD1();
  d1.catalogRows = [
    [
      "release-existing",
      "style:dd1399100",
      "Air Example",
      "Nike",
      "2026-08-01",
      "10:00",
    ],
  ];
  d1.channelRows = [
    [
      "release-existing",
      "official",
      "release-1",
      "2026-08-01",
      "10:00",
      "₩179,000",
      "https://store.example.com/products/air-example",
    ],
    [
      "release-review-existing",
      "official",
      "release-review",
      "2026-08-01",
      "10:00",
      "₩179,000",
      "https://store.example.com/products/air-example-premium",
    ],
    [
      "release-stale",
      "official",
      "release-stale",
      "2026-08-01",
      "10:00",
      "₩179,000",
      "https://store.example.com/products/stale",
    ],
  ];
  const repository = productionRepository(d1);
  const changedRelease = {
    ...baseRelease,
    releaseDate: "2026-08-02",
    releaseTime: "11:00",
    priceLabel: "₩189,000",
  };
  const reviewRelease = {
    ...baseRelease,
    externalId: "release-review",
    title: "Air Example Premium",
    productUrl: "https://store.example.com/products/air-example-premium",
  };

  await repository.persistSourceResult(
    sourceResult({
      groups: [
        releaseGroup(changedRelease),
        {
          ...releaseGroup(reviewRelease, "possible_duplicate"),
          canonicalKey: "style:review",
        },
      ],
      authoritativeSnapshot: true,
    }),
  );

  assert.equal(d1.batchCalls.length, 1);
  const sql = normalizedSql(d1.batchCalls[0]);
  const changeIndex = sql.findIndex((query) =>
    query.includes('insert into "release_changes"'),
  );
  const catalogUpdateIndex = sql.findIndex((query) =>
    query.includes('update "release_catalog"'),
  );
  assert.ok(changeIndex >= 0);
  assert.ok(catalogUpdateIndex > changeIndex);
  assert.ok(
    sql.some(
      (query) =>
        query.includes('insert into "release_channels"') &&
        query.includes("on conflict") &&
        query.includes('"release_channels"."source_key"') &&
        query.includes('"release_channels"."external_id"') &&
        query.includes("do nothing"),
    ),
  );
  assert.ok(sql.some((query) => query.includes('update "release_sources"')));
  assert.ok(sql.some((query) => query.includes('insert into "review_items"')));
  const staleChannelDelete = d1.batchCalls[0].find(({ sql: query }) =>
    query.includes('delete from "release_channels"'),
  );
  assert.ok(staleChannelDelete);
  assert.ok(staleChannelDelete.params.includes("release-stale"));
  assert.ok(!staleChannelDelete.params.includes("release-1"));
  assert.ok(!staleChannelDelete.params.includes("release-review"));
});

for (const groupCount of [100, 101]) {
  test(`production persistence keeps every statement within D1's parameter cap for ${groupCount} source identities`, async () => {
    const d1 = new RecordingD1();
    const repository = productionRepository(d1);

    await repository.persistSourceResult(
      sourceResult({
        groups: Array.from({ length: groupCount }, (_, index) =>
          indexedReleaseGroup(index),
        ),
      }),
    );

    const statements = allRecordedStatements(d1);
    assert.ok(statements.length > 0);
    assert.ok(
      statements.every(({ params }) => params.length <= 100),
      `parameter counts: ${statements.map(({ params }) => params.length).join(", ")}`,
    );
  });
}

for (const staleCount of [98, 100, 101, 195]) {
  test(`production persistence chunks deletion of ${staleCount} stale source channels`, async () => {
    const d1 = new RecordingD1();
    d1.channelRows = [
      [
        "release-existing",
        "official",
        "release-000",
        "2026-08-01",
        "10:00",
        "₩179,000",
        "https://store.example.com/products/air-example-000",
      ],
      ...Array.from({ length: staleCount }, (_, index) => [
        `stale-catalog-${index}`,
        "official",
        `stale-${index}`,
        "2026-08-01",
        "10:00",
        "₩179,000",
        `https://store.example.com/products/stale-${index}`,
      ]),
    ];
    const repository = productionRepository(d1);

    await repository.persistSourceResult(
      sourceResult({
        groups: [indexedReleaseGroup(0)],
        authoritativeSnapshot: true,
      }),
    );

    const deletes = d1.batchCalls[0].filter(({ sql }) =>
      sql.includes('delete from "release_channels"'),
    );
    assert.equal(deletes.length, Math.ceil(staleCount / 97));
    assert.ok(
      deletes.every(
        ({ params }) => params.length <= 100 && params.includes("official"),
      ),
    );
    assert.deepEqual(
      new Set(
        deletes
          .flatMap(({ params }) => params)
          .filter(
            (param) =>
              param !== "official" &&
              !(
                typeof param === "string" &&
                param.startsWith("source-claim:")
              ),
          ),
      ),
      new Set(Array.from({ length: staleCount }, (_, index) => `stale-${index}`)),
    );
  });
}

test("production persistence chunks more than twenty five-field change records", async () => {
  const changeCount = 21;
  const d1 = new RecordingD1();
  d1.catalogRows = Array.from({ length: changeCount }, (_, index) => {
    const group = indexedReleaseGroup(index);
    return [
      `release-existing-${index}`,
      group.canonicalKey,
      group.release.title,
      group.release.brand,
      "2026-08-01",
      "10:00",
    ];
  });
  d1.channelRows = Array.from({ length: changeCount }, (_, index) => {
    const group = indexedReleaseGroup(index);
    return [
      `release-existing-${index}`,
      "official",
      group.release.externalId,
      "2026-08-01",
      "10:00",
      "₩179,000",
      group.release.productUrl,
    ];
  });
  const repository = productionRepository(d1);
  const groups = Array.from({ length: changeCount }, (_, index) => {
    const group = indexedReleaseGroup(index);
    const changed = {
      ...group.release,
      releaseDate: "2026-08-02",
    };
    return { ...group, release: changed, channels: [changed] };
  });

  await repository.persistSourceResult(sourceResult({ groups }));

  const changeInserts = d1.batchCalls[0].filter(({ sql }) =>
    sql.includes('insert into "release_changes"'),
  );
  assert.equal(changeInserts.length, 2);
  assert.ok(changeInserts.every(({ params }) => params.length <= 100));
});

test("a new slot claim persists its ownership token", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  assert.deepEqual(
    await repository.claimSlot(
      slot,
      t0,
      "owner-a",
      "2026-07-31T00:45:00.000Z",
    ),
    { state: "claimed", claimToken: "owner-a", reclaimed: false },
  );

  assert.deepEqual(
    d1.rows<{
      status: string;
      started_at: string;
      completed_at: string | null;
      claim_token: string | null;
    }>(
      `select status, started_at, completed_at, claim_token
       from collection_slots where slot_key = ?`,
      slot,
    ),
    [
      {
        status: "running",
        started_at: t0,
        completed_at: null,
        claim_token: "owner-a",
      },
    ],
  );
});

test("a young running slot remains in progress", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  assert.deepEqual(
    await repository.claimSlot(
      slot,
      t5,
      "owner-b",
      "2026-07-31T00:50:00.000Z",
    ),
    { state: "in_progress" },
  );
  assert.deepEqual(
    d1.rows<{ started_at: string; claim_token: string | null }>(
      "select started_at, claim_token from collection_slots where slot_key = ?",
      slot,
    ),
    [{ started_at: t0, claim_token: "owner-a" }],
  );
});

test("a running slot is reclaimable exactly at the stale cutoff", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  assert.deepEqual(
    await repository.claimSlot(slot, t15, "owner-b", t0),
    { state: "claimed", claimToken: "owner-b", reclaimed: true },
  );
  assert.deepEqual(
    d1.rows<{
      started_at: string;
      completed_at: string | null;
      claim_token: string | null;
    }>(
      `select started_at, completed_at, claim_token
       from collection_slots where slot_key = ?`,
      slot,
    ),
    [{ started_at: t15, completed_at: null, claim_token: "owner-b" }],
  );
});

test("only one contender wins a stale running slot reclaim", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  const outcomes = await Promise.all([
    repository.claimSlot(slot, t16, "owner-b", t0),
    repository.claimSlot(slot, t16, "owner-c", t0),
  ]);
  const winners = outcomes.filter(({ state }) => state === "claimed");

  assert.equal(winners.length, 1);
  assert.deepEqual(
    outcomes.filter(({ state }) => state !== "claimed"),
    [{ state: "in_progress" }],
  );
  assert.deepEqual(
    d1.rows<{ started_at: string; claim_token: string | null }>(
      "select started_at, claim_token from collection_slots where slot_key = ?",
      slot,
    ),
    [
      {
        started_at: t16,
        claim_token:
          winners[0].state === "claimed" ? winners[0].claimToken : null,
      },
    ],
  );
});

test("a reclaim loses CAS when ownership changes at the observed start time", async () => {
  const slot = "2026-07-31@09:30";
  let ownershipChanged = false;
  let d1!: SQLiteD1;
  d1 = new SQLiteD1((statement) => {
    if (
      ownershipChanged ||
      !statement.sql.includes(
        'update "collection_slots" set "started_at"',
      )
    ) {
      return;
    }
    ownershipChanged = true;
    const changed = d1.execute(
      `update collection_slots set claim_token = ?
       where slot_key = ? and status = ? and started_at = ? and claim_token = ?`,
      "owner-b",
      slot,
      "running",
      t0,
      "owner-a",
    );
    assert.equal(Number(changed.changes), 1);
  });
  const repository = productionRepository(d1);

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  assert.deepEqual(
    await repository.claimSlot(slot, t16, "owner-c", t0),
    { state: "in_progress" },
  );
  assert.equal(ownershipChanged, true);
  assert.deepEqual(
    d1.rows<{ started_at: string; claim_token: string | null }>(
      "select started_at, claim_token from collection_slots where slot_key = ?",
      slot,
    ),
    [{ started_at: t0, claim_token: "owner-b" }],
  );
});

test("a sequential claimant cannot steal a fresh reclaim winner", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );
  assert.deepEqual(
    await repository.claimSlot(slot, t15, "owner-b", t0),
    { state: "claimed", claimToken: "owner-b", reclaimed: true },
  );

  assert.deepEqual(
    await repository.claimSlot(slot, t16, "owner-c", t1),
    { state: "in_progress" },
  );
  assert.deepEqual(
    d1.rows<{ started_at: string; claim_token: string | null }>(
      "select started_at, claim_token from collection_slots where slot_key = ?",
      slot,
    ),
    [{ started_at: t15, claim_token: "owner-b" }],
  );
});

test("a young migrated running slot with no claim token remains in progress", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";
  d1.execute(
    `insert into collection_slots (
      slot_key, status, started_at, completed_at, claim_token
    ) values (?, ?, ?, ?, ?)`,
    slot,
    "running",
    t0,
    null,
    null,
  );

  assert.deepEqual(
    await repository.claimSlot(
      slot,
      t5,
      "owner-b",
      "2026-07-31T00:50:00.000Z",
    ),
    { state: "in_progress" },
  );
  assert.deepEqual(
    d1.rows<{ started_at: string; claim_token: string | null }>(
      "select started_at, claim_token from collection_slots where slot_key = ?",
      slot,
    ),
    [{ started_at: t0, claim_token: null }],
  );
});

test("a stale migrated running slot with no claim token is reclaimable", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";
  d1.execute(
    `insert into collection_slots (
      slot_key, status, started_at, completed_at, claim_token
    ) values (?, ?, ?, ?, ?)`,
    slot,
    "running",
    t0,
    null,
    null,
  );

  assert.deepEqual(
    await repository.claimSlot(slot, t15, "owner-b", t0),
    { state: "claimed", claimToken: "owner-b", reclaimed: true },
  );
  assert.equal(await repository.completeSlot(slot, "owner-b", t16), true);
  assert.deepEqual(
    d1.rows<{
      status: string;
      started_at: string;
      completed_at: string | null;
      claim_token: string | null;
    }>(
      `select status, started_at, completed_at, claim_token
       from collection_slots where slot_key = ?`,
      slot,
    ),
    [
      {
        status: "completed",
        started_at: t15,
        completed_at: t16,
        claim_token: "owner-b",
      },
    ],
  );
});

test("completed slots remain terminal on later claims", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  assert.equal(await repository.completeSlot(slot, "owner-a", t16), true);
  assert.equal(await repository.failSlot(slot, "owner-a", t16), false);
  assert.deepEqual(
    await repository.claimSlot(slot, t16, "owner-b", t0),
    { state: "completed" },
  );
});

test("failed slots remain terminal on later claims", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );

  assert.equal(await repository.failSlot(slot, "owner-a", t16), true);
  assert.equal(await repository.completeSlot(slot, "owner-a", t16), false);
  assert.deepEqual(
    await repository.claimSlot(slot, t16, "owner-b", t0),
    { state: "failed" },
  );
});

test("a reclaimed slot rejects the previous owner's terminal transitions", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const slot = "2026-07-31@09:30";

  await repository.claimSlot(
    slot,
    t0,
    "owner-a",
    "2026-07-31T00:45:00.000Z",
  );
  await repository.claimSlot(slot, t15, "owner-b", t0);

  assert.equal(await repository.completeSlot(slot, "owner-a", t16), false);
  assert.equal(await repository.failSlot(slot, "owner-a", t16), false);
  assert.equal(await repository.completeSlot(slot, "owner-b", t16), true);

  assert.deepEqual(
    d1.rows<{
      status: string;
      completed_at: string | null;
      claim_token: string | null;
    }>(
      `select status, completed_at, claim_token
       from collection_slots where slot_key = ?`,
      slot,
    ),
    [
      {
        status: "completed",
        completed_at: t16,
        claim_token: "owner-b",
      },
    ],
  );
});

test("cached aggregate schedule comes from deterministic surviving channels after source removal", async () => {
  const d1 = new SQLiteD1();
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "release-shared",
    "style:shared",
    "Shared Release",
    "Nike",
    "sneakers",
    "collab",
    "2026-08-01",
    "10:00",
    "published",
    100,
    collectedAt,
    collectedAt,
    collectedAt,
    null,
  );
  for (const channel of [
    {
      id: "official:shared",
      sourceKey: "official",
      externalId: "shared-official",
      retailer: "Official Store",
      releaseDate: "2026-08-01",
      releaseTime: "10:00",
    },
    {
      id: "retailer:shared",
      sourceKey: "retailer",
      externalId: "shared-retailer",
      retailer: "Retailer Store",
      releaseDate: "2026-08-02",
      releaseTime: "11:00",
    },
  ]) {
    d1.execute(
      `insert into release_channels (
        id, release_id, source_key, external_id, retailer,
        product_url, source_url, price_label,
        release_date, release_time, collected_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      channel.id,
      "release-shared",
      channel.sourceKey,
      channel.externalId,
      channel.retailer,
      `https://store.example.com/${channel.externalId}`,
      "https://store.example.com/calendar",
      null,
      channel.releaseDate,
      channel.releaseTime,
      collectedAt,
    );
  }
  const repository = productionRepository(d1);

  await repository.persistSourceResult(
    sourceResult({
      sourceKey: "official",
      groups: [],
      collectedAt: "2026-07-31T01:00:00.000Z",
      confirmedEmpty: true,
      authoritativeSnapshot: true,
    }),
  );
  const [cached] = await repository.listCachedReleases();

  assert.equal(cached.releaseDate, "2026-08-02");
  assert.equal(cached.releaseTime, "11:00");
  assert.deepEqual(
    cached.channels.map(({ sourceKey }) => sourceKey),
    ["retailer"],
  );
});

test("source channel identity preserves catalog ID and history across no-style title and date changes", async () => {
  const d1 = new SQLiteD1();
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "release-existing",
    "release:nike:air-example:2026-08-01",
    "Air Example",
    "Nike",
    "sneakers",
    "general",
    "2026-08-01",
    "10:00",
    "published",
    100,
    "2026-07-30T00:00:00.000Z",
    collectedAt,
    collectedAt,
    null,
  );
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "official:release-1",
    "release-existing",
    "official",
    "release-1",
    "Official Store",
    baseRelease.productUrl,
    baseRelease.sourceUrl,
    baseRelease.priceLabel,
    "2026-08-01",
    "10:00",
    collectedAt,
  );
  const repository = productionRepository(d1);
  const changedRelease = {
    ...baseRelease,
    title: "Air Example Updated",
    styleCode: null,
    releaseDate: "2026-08-02",
    collectedAt: "2026-07-31T02:00:00.000Z",
  };

  await repository.persistSourceResult(
    sourceResult({
      groups: [
        {
          ...releaseGroup(changedRelease),
          canonicalKey:
            "release:nike:air-example-updated:2026-08-02",
        },
      ],
      collectedAt: changedRelease.collectedAt,
    }),
  );

  assert.deepEqual(
    d1.rows<{
      id: string;
      canonical_key: string;
      title: string;
      release_date: string;
    }>(
      "select id, canonical_key, title, release_date from release_catalog order by id",
    ),
    [
      {
        id: "release-existing",
        canonical_key:
          "release:nike:air-example-updated:2026-08-02",
        title: "Air Example Updated",
        release_date: "2026-08-02",
      },
    ],
  );
  assert.equal(
    d1.rows<{ release_id: string }>(
      "select release_id from release_channels where source_key = ? and external_id = ?",
      "official",
      "release-1",
    )[0].release_id,
    "release-existing",
  );
  assert.deepEqual(
    d1
      .rows<{ release_id: string; field: string }>(
        "select release_id, field from release_changes order by id",
      )
      .map(({ release_id, field }) => ({ release_id, field })),
    [
      { release_id: "release-existing", field: "title" },
      { release_id: "release-existing", field: "releaseDate" },
    ],
  );
});

test("style schedule correction preserves stable catalog identity and every SQLite foreign key", async () => {
  const d1 = new SQLiteD1();
  const stableId = "release-stable-style";
  const originalAt = "2026-07-30T00:00:00.000Z";
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stableId,
    "style:dd1399100",
    baseRelease.title,
    baseRelease.brand,
    baseRelease.category,
    baseRelease.releaseKind,
    baseRelease.releaseDate,
    baseRelease.releaseTime,
    "published",
    100,
    originalAt,
    originalAt,
    originalAt,
    null,
  );
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "official:release-1",
    stableId,
    baseRelease.sourceKey,
    baseRelease.externalId,
    baseRelease.retailer,
    baseRelease.productUrl,
    baseRelease.sourceUrl,
    baseRelease.priceLabel,
    baseRelease.releaseDate,
    baseRelease.releaseTime,
    originalAt,
  );
  d1.execute(
    "insert into saved_releases (user_email, release_id, created_at) values (?, ?, ?)",
    "saved@example.com",
    stableId,
    originalAt,
  );
  d1.execute(
    `insert into release_changes (
      release_id, field, previous_value, next_value, changed_at
    ) values (?, ?, ?, ?, ?)`,
    stableId,
    "priceLabel",
    null,
    baseRelease.priceLabel,
    originalAt,
  );
  const repository = productionRepository(d1);
  const correctedAt = "2026-07-31T02:00:00.000Z";
  const correctedRelease = {
    ...baseRelease,
    releaseDate: "2026-08-02",
    releaseTime: "11:00",
    collectedAt: correctedAt,
  };

  await repository.persistSourceResult(
    sourceResult({
      groups: groupCollectedReleases([correctedRelease]),
      collectedAt: correctedAt,
    }),
  );

  assert.deepEqual(
    d1.rows<{
      id: string;
      canonical_key: string;
      release_date: string;
      release_time: string | null;
    }>(
      "select id, canonical_key, release_date, release_time from release_catalog",
    ),
    [
      {
        id: stableId,
        canonical_key: "style:dd1399100",
        release_date: "2026-08-02",
        release_time: "11:00",
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{
      release_id: string;
      release_date: string;
      release_time: string | null;
    }>(
      "select release_id, release_date, release_time from release_channels",
    ),
    [
      {
        release_id: stableId,
        release_date: "2026-08-02",
        release_time: "11:00",
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from saved_releases",
    ),
    [{ release_id: stableId }],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string; field: string }>(
      "select release_id, field from release_changes order by id",
    ),
    [
      { release_id: stableId, field: "priceLabel" },
      { release_id: stableId, field: "releaseDate" },
      { release_id: stableId, field: "releaseTime" },
    ],
  );
  assert.deepEqual(d1.rows("PRAGMA foreign_key_check"), []);
});

test("incoming schedule conflict with cached peer atomically reviews both identities without cache leakage", async () => {
  const d1 = new SQLiteD1();
  const stableId = "release-cached-peer";
  const stableKey = "style:peer100";
  const cachedAt = "2026-07-30T00:00:00.000Z";
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stableId,
    stableKey,
    "Peer release",
    "Example",
    "sneakers",
    "general",
    "2026-08-01",
    "10:00",
    "published",
    100,
    cachedAt,
    cachedAt,
    cachedAt,
    null,
  );
  for (const [sourceKey, externalId, retailer] of [
    ["alpha", "alpha-release", "Alpha Store"],
    ["beta", "beta-release", "Beta Store"],
  ]) {
    d1.execute(
      `insert into release_channels (
        id, release_id, source_key, external_id, retailer,
        product_url, source_url, price_label,
        release_date, release_time, collected_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `${sourceKey}:${externalId}`,
      stableId,
      sourceKey,
      externalId,
      retailer,
      `https://${sourceKey}.example/products/peer`,
      `https://${sourceKey}.example/calendar`,
      null,
      "2026-08-01",
      "10:00",
      cachedAt,
    );
    d1.execute(
      `insert into release_sources (
        source_key, status, last_success_at, last_failure_at,
        consecutive_failures, source_count, new_count, merged_count,
        review_count, message, result_revision_at,
        result_claim_token, result_claimed_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sourceKey,
      "connected",
      cachedAt,
      null,
      0,
      1,
      0,
      1,
      0,
      `${sourceKey} cached`,
      cachedAt,
      null,
      null,
    );
  }
  const repository = productionRepository(d1);
  const firstAt = "2026-07-31T01:00:00.000Z";
  const incoming = {
    ...baseRelease,
    sourceKey: "alpha",
    externalId: "alpha-release",
    title: "Peer release",
    brand: "Example",
    styleCode: "PEER-100",
    retailer: "Alpha Store",
    productUrl: "https://alpha.example/products/peer",
    sourceUrl: "https://alpha.example/calendar",
    releaseDate: "2026-08-02",
    releaseTime: "10:00",
    collectedAt: firstAt,
  };

  const firstOutcome = await repository.persistSourceResult({
    sourceKey: "alpha",
    status: "connected",
    groups: groupCollectedReleases([incoming]),
    collectedAt: firstAt,
    message: "alpha incoming conflict",
    confirmedEmpty: false,
  });

  assert.deepEqual(firstOutcome, { reviewItemsCreated: 2 });
  assert.deepEqual(
    d1.rows<{
      source_key: string;
      external_id: string;
      reason: string;
      payload_json: string;
    }>(
      `select source_key, external_id, reason, payload_json
       from review_items
       where status = 'pending'
       order by source_key, external_id`,
    ).map(({ source_key, external_id, reason, payload_json }) => {
      const payload = JSON.parse(payload_json) as ReleaseGroup;
      return {
        sourceKey: source_key,
        externalId: external_id,
        reason,
        canonicalKey: payload.canonicalKey,
        payloadIdentity: payload.channels.map(
          (channel) => `${channel.sourceKey}:${channel.externalId}`,
        ),
      };
    }),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-release",
        reason: "conflicting_schedule",
        canonicalKey: stableKey,
        payloadIdentity: ["alpha:alpha-release"],
      },
      {
        sourceKey: "beta",
        externalId: "beta-release",
        reason: "conflicting_schedule",
        canonicalKey: stableKey,
        payloadIdentity: ["beta:beta-release"],
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{
      source_key: string;
      external_id: string;
      release_date: string;
      release_time: string | null;
    }>(
      `select source_key, external_id, release_date, release_time
       from release_channels
       order by source_key`,
    ),
    [
      {
        source_key: "alpha",
        external_id: "alpha-release",
        release_date: "2026-08-01",
        release_time: "10:00",
      },
      {
        source_key: "beta",
        external_id: "beta-release",
        release_date: "2026-08-01",
        release_time: "10:00",
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{ release_date: string; release_time: string | null }>(
      "select release_date, release_time from release_catalog",
    ),
    [{ release_date: "2026-08-01", release_time: "10:00" }],
  );
  const betaHealthBeforeRetry = d1.rows(
    "select * from release_sources where source_key = 'beta'",
  );

  const retryAt = "2026-07-31T02:00:00.000Z";
  const retryOutcome = await repository.persistSourceResult({
    sourceKey: "alpha",
    status: "connected",
    groups: groupCollectedReleases([
      { ...incoming, collectedAt: retryAt },
    ]),
    collectedAt: retryAt,
    message: "alpha retry",
    confirmedEmpty: false,
  });

  assert.deepEqual(retryOutcome, { reviewItemsCreated: 2 });
  assert.equal(
    d1.rows<{ count: number }>(
      "select count(*) as count from review_items where status = 'pending'",
    )[0].count,
    2,
  );
  assert.deepEqual(
    d1.rows("select * from release_sources where source_key = 'beta'"),
    betaHealthBeforeRetry,
  );
  assert.deepEqual(d1.rows("PRAGMA foreign_key_check"), []);
});

test("an older incoming conflict cannot supersede a newer cached-peer review", async () => {
  const d1 = new SQLiteD1();
  const stableId = "release-newer-peer-review";
  const stableKey = "style:newerpeer100";
  const cachedAt = "2026-07-30T00:00:00.000Z";
  const incomingAt = "2026-07-31T02:00:00.000Z";
  const newerPeerReviewAt = "2026-07-31T03:00:00.000Z";
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stableId,
    stableKey,
    "Newer peer release",
    "Example",
    "sneakers",
    "general",
    "2026-08-01",
    "10:00",
    "published",
    100,
    cachedAt,
    cachedAt,
    cachedAt,
    null,
  );
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "beta:beta-newer-peer",
    stableId,
    "beta",
    "beta-newer-peer",
    "Beta Store",
    "https://beta.example/products/newer-peer",
    "https://beta.example/calendar",
    null,
    "2026-08-01",
    "10:00",
    cachedAt,
  );
  const newerPeerRelease = {
    ...baseRelease,
    sourceKey: "beta",
    externalId: "beta-newer-peer",
    title: "Newer peer review payload",
    brand: "Example",
    styleCode: "NEWER-PEER-100",
    releaseDate: "2026-08-01",
    releaseTime: "10:00",
    retailer: "Beta Store",
    productUrl: "https://beta.example/products/newer-peer",
    sourceUrl: "https://beta.example/calendar",
    collectedAt: newerPeerReviewAt,
  };
  d1.execute(
    `insert into review_items (
      source_key, external_id, reason, payload_json, status,
      created_at, resolved_at, resolved_by, claim_token, claimed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "beta",
    "beta-newer-peer",
    "conflicting_schedule",
    JSON.stringify({
      canonicalKey: stableKey,
      release: newerPeerRelease,
      channels: [newerPeerRelease],
      reviewReason: "conflicting_schedule",
    } satisfies ReleaseGroup),
    "pending",
    newerPeerReviewAt,
    null,
    null,
    null,
    null,
  );
  const repository = productionRepository(d1);
  const incoming = {
    ...baseRelease,
    sourceKey: "alpha",
    externalId: "alpha-older-incoming",
    title: "Newer peer release",
    brand: "Example",
    styleCode: "NEWER-PEER-100",
    releaseDate: "2026-08-02",
    releaseTime: "10:00",
    retailer: "Alpha Store",
    productUrl: "https://alpha.example/products/newer-peer",
    sourceUrl: "https://alpha.example/calendar",
    collectedAt: incomingAt,
  };

  const outcome = await repository.persistSourceResult({
    sourceKey: "alpha",
    status: "connected",
    groups: groupCollectedReleases([incoming]),
    collectedAt: incomingAt,
    message: "older incoming conflict",
    confirmedEmpty: false,
  });

  assert.deepEqual(outcome, { reviewItemsCreated: 1 });
  assert.deepEqual(
    d1.rows<{
      source_key: string;
      external_id: string;
      created_at: string;
      payload_json: string;
    }>(
      `select source_key, external_id, created_at, payload_json
       from review_items
       where status = 'pending'
       order by source_key`,
    ).map(({ source_key, external_id, created_at, payload_json }) => ({
      sourceKey: source_key,
      externalId: external_id,
      createdAt: created_at,
      title: (JSON.parse(payload_json) as ReleaseGroup).release.title,
    })),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-older-incoming",
        createdAt: incomingAt,
        title: "Newer peer release",
      },
      {
        sourceKey: "beta",
        externalId: "beta-newer-peer",
        createdAt: newerPeerReviewAt,
        title: "Newer peer review payload",
      },
    ],
  );
});

test("runCollection through the production repository preserves source-scoped schedule conflicts in real SQLite", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const dateKey = "style:run100";
  const dateAdapters = [
    integrationAdapter("alpha", {
      styleCode: "RUN-100",
      externalId: "alpha-date",
      title: "Run integration release",
      releaseDate: "2026-08-01",
      releaseTime: "10:00",
    }),
    integrationAdapter("beta", {
      styleCode: "RUN-100",
      externalId: "beta-date",
      title: "Run integration release",
      releaseDate: "2026-08-02",
      releaseTime: "10:00",
    }),
  ];

  const { summary: firstSummary } = await runCollection({
    repository,
    adapters: dateAdapters,
    now: new Date("2026-07-31T01:00:00.000Z"),
  });

  assert.equal(firstSummary.reviewItemsCreated, 2);
  assert.deepEqual(pendingConflictBreakdown(d1, dateKey), [
    {
      id: 1,
      sourceKey: "alpha",
      externalId: "alpha-date",
      reason: "conflicting_schedule",
      canonicalKey: dateKey,
      payloadIdentities: ["alpha:alpha-date"],
    },
    {
      id: 2,
      sourceKey: "beta",
      externalId: "beta-date",
      reason: "conflicting_schedule",
      canonicalKey: dateKey,
      payloadIdentities: ["beta:beta-date"],
    },
  ]);
  assert.equal(
    d1.rows<{ count: number }>(
      "select count(*) as count from release_catalog",
    )[0].count,
    0,
  );
  assert.equal(
    d1.rows<{ count: number }>(
      "select count(*) as count from release_channels",
    )[0].count,
    0,
  );

  const { summary: retrySummary } = await runCollection({
    repository,
    adapters: dateAdapters,
    now: new Date("2026-07-31T04:00:00.000Z"),
  });

  assert.equal(retrySummary.reviewItemsCreated, 2);
  assert.deepEqual(
    pendingConflictBreakdown(d1, dateKey).map(
      ({ sourceKey, externalId, reason, payloadIdentities }) => ({
        sourceKey,
        externalId,
        reason,
        payloadIdentities,
      }),
    ),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-date",
        reason: "conflicting_schedule",
        payloadIdentities: ["alpha:alpha-date"],
      },
      {
        sourceKey: "beta",
        externalId: "beta-date",
        reason: "conflicting_schedule",
        payloadIdentities: ["beta:beta-date"],
      },
    ],
  );
  assert.deepEqual(
    d1
      .rows<{ status: string; payload_json: string }>(
        "select status, payload_json from review_items order by id",
      )
      .flatMap(({ status, payload_json }) => {
        const payload = JSON.parse(payload_json) as ReleaseGroup;
        return payload.canonicalKey === dateKey ? [status] : [];
      })
      .sort(),
    ["ignored", "ignored", "pending", "pending"],
  );

  const timeKey = "style:time100";
  const { summary: timeSummary } = await runCollection({
    repository,
    adapters: [
      integrationAdapter("alpha", {
        styleCode: "TIME-100",
        externalId: "alpha-time",
        title: "Time integration release",
        releaseDate: "2026-08-03",
        releaseTime: "10:00",
      }),
      integrationAdapter("beta", {
        styleCode: "TIME-100",
        externalId: "beta-time",
        title: "Time integration release",
        releaseDate: "2026-08-03",
        releaseTime: "11:00",
      }),
    ],
    now: new Date("2026-07-31T09:00:00.000Z"),
  });

  assert.equal(timeSummary.reviewItemsCreated, 2);
  assert.deepEqual(
    pendingConflictBreakdown(d1, timeKey).map(
      ({ sourceKey, externalId, reason, payloadIdentities }) => ({
        sourceKey,
        externalId,
        reason,
        payloadIdentities,
      }),
    ),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-time",
        reason: "conflicting_schedule",
        payloadIdentities: ["alpha:alpha-time"],
      },
      {
        sourceKey: "beta",
        externalId: "beta-time",
        reason: "conflicting_schedule",
        payloadIdentities: ["beta:beta-time"],
      },
    ],
  );
  assert.equal(
    d1.rows<{ count: number }>(
      "select count(*) as count from release_catalog",
    )[0].count,
    0,
  );

  const stableId = "release-stale-integration";
  const staleKey = "style:stale100";
  const staleAt = "2026-07-30T00:00:00.000Z";
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stableId,
    staleKey,
    "Stale cached release",
    "Example",
    "sneakers",
    "general",
    "2026-08-04",
    "10:00",
    "published",
    100,
    staleAt,
    staleAt,
    staleAt,
    null,
  );
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "beta:beta-stale",
    stableId,
    "beta",
    "beta-stale",
    "beta Store",
    "https://beta.example/products/beta-stale",
    "https://beta.example/calendar",
    null,
    "2026-08-04",
    "10:00",
    staleAt,
  );
  d1.execute(
    "insert into saved_releases (user_email, release_id, created_at) values (?, ?, ?)",
    "integration@example.com",
    stableId,
    staleAt,
  );
  d1.execute(
    `insert into release_changes (
      release_id, field, previous_value, next_value, changed_at
    ) values (?, ?, ?, ?, ?)`,
    stableId,
    "priceLabel",
    null,
    "seeded-history",
    staleAt,
  );
  const betaHealthBeforeStaleConflict = d1.rows(
    "select * from release_sources where source_key = 'beta'",
  );

  const { summary: staleSummary } = await runCollection({
    repository,
    adapters: [
      integrationAdapter("alpha", {
        styleCode: "STALE-100",
        externalId: "alpha-stale",
        title: "Stale cached release",
        releaseDate: "2026-08-05",
        releaseTime: "10:00",
      }),
    ],
    now: new Date("2026-07-31T13:30:00.000Z"),
  });

  assert.equal(staleSummary.reviewItemsCreated, 2);
  assert.deepEqual(
    pendingConflictBreakdown(d1, staleKey).map(
      ({ sourceKey, externalId, reason, payloadIdentities }) => ({
        sourceKey,
        externalId,
        reason,
        payloadIdentities,
      }),
    ),
    [
      {
        sourceKey: "alpha",
        externalId: "alpha-stale",
        reason: "conflicting_schedule",
        payloadIdentities: ["alpha:alpha-stale"],
      },
      {
        sourceKey: "beta",
        externalId: "beta-stale",
        reason: "conflicting_schedule",
        payloadIdentities: ["beta:beta-stale"],
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{
      source_key: string;
      external_id: string;
      release_date: string;
    }>(
      `select source_key, external_id, release_date
       from release_channels
       where release_id = ?
       order by source_key`,
      stableId,
    ),
    [
      {
        source_key: "beta",
        external_id: "beta-stale",
        release_date: "2026-08-04",
      },
    ],
  );
  assert.deepEqual(
    d1.rows("select * from release_sources where source_key = 'beta'"),
    betaHealthBeforeStaleConflict,
  );

  const staleReviews = pendingConflictBreakdown(d1, staleKey);
  const alphaReview = staleReviews.find(
    ({ sourceKey }) => sourceKey === "alpha",
  )!;
  const betaReview = staleReviews.find(
    ({ sourceKey }) => sourceKey === "beta",
  )!;
  await repository.resolveReview({
    id: betaReview.id,
    action: "approve",
    resolvedBy: "reviewer@example.com",
  });
  await repository.resolveReview({
    id: alphaReview.id,
    action: "edit",
    title: "Stale cached release",
    releaseDate: "2026-08-04",
    releaseTime: "10:00",
    resolvedBy: "reviewer@example.com",
  });

  assert.deepEqual(
    d1.rows<{ id: string; canonical_key: string }>(
      "select id, canonical_key from release_catalog where id = ?",
      stableId,
    ),
    [{ id: stableId, canonical_key: staleKey }],
  );
  assert.deepEqual(
    d1.rows<{
      source_key: string;
      external_id: string;
      release_id: string;
      release_date: string;
      release_time: string | null;
    }>(
      `select source_key, external_id, release_id, release_date, release_time
       from release_channels
       where release_id = ?
       order by source_key`,
      stableId,
    ),
    [
      {
        source_key: "alpha",
        external_id: "alpha-stale",
        release_id: stableId,
        release_date: "2026-08-04",
        release_time: "10:00",
      },
      {
        source_key: "beta",
        external_id: "beta-stale",
        release_id: stableId,
        release_date: "2026-08-04",
        release_time: "10:00",
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from saved_releases where user_email = ?",
      "integration@example.com",
    ),
    [{ release_id: stableId }],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from release_changes where release_id = ?",
      stableId,
    ),
    [{ release_id: stableId }],
  );
  assert.deepEqual(d1.rows("PRAGMA foreign_key_check"), []);
});

test("an older source result is a no-op after a newer revision has persisted", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const newerCollectedAt = "2026-07-31T03:00:00.000Z";
  const newerRelease = {
    ...baseRelease,
    releaseDate: "2026-08-03",
    collectedAt: newerCollectedAt,
  };
  const olderCollectedAt = "2026-07-31T02:00:00.000Z";
  const olderRelease = {
    ...baseRelease,
    releaseDate: "2026-08-02",
    collectedAt: olderCollectedAt,
  };

  await repository.persistSourceResult(
    sourceResult({
      groups: [releaseGroup(newerRelease)],
      collectedAt: newerCollectedAt,
      message: "newer",
    }),
  );
  await repository.persistSourceResult(
    sourceResult({
      groups: [releaseGroup(olderRelease)],
      collectedAt: olderCollectedAt,
      message: "older",
    }),
  );

  assert.deepEqual(
    d1.rows<{
      release_date: string;
      collected_at: string;
    }>(
      "select release_date, collected_at from release_channels where source_key = ? and external_id = ?",
      "official",
      "release-1",
    ),
    [
      {
        release_date: "2026-08-03",
        collected_at: newerCollectedAt,
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{
      release_date: string;
      last_verified_at: string;
    }>(
      "select release_date, last_verified_at from release_catalog",
    ),
    [
      {
        release_date: "2026-08-03",
        last_verified_at: newerCollectedAt,
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{
      status: string;
      last_success_at: string;
      message: string;
      result_revision_at: string | null;
    }>(
      "select status, last_success_at, message, result_revision_at from release_sources where source_key = ?",
      "official",
    ),
    [
      {
        status: "connected",
        last_success_at: newerCollectedAt,
        message: "newer",
        result_revision_at: newerCollectedAt,
      },
    ],
  );
});

test("a newer review candidate supersedes pending duplicates for the same source identity", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const firstAt = "2026-07-31T01:00:00.000Z";
  const secondAt = "2026-07-31T02:00:00.000Z";
  const firstRelease = {
    ...baseRelease,
    title: "First Review Candidate",
    collectedAt: firstAt,
  };
  const secondRelease = {
    ...baseRelease,
    title: "Newest Review Candidate",
    collectedAt: secondAt,
  };

  const firstResult = sourceResult({
    groups: [releaseGroup(firstRelease, "possible_duplicate")],
    collectedAt: firstAt,
  });
  const firstOutcome = await repository.persistSourceResult(firstResult);
  const repeatedOutcome = await repository.persistSourceResult(firstResult);
  const newerOutcome = await repository.persistSourceResult(
    sourceResult({
      groups: [releaseGroup(secondRelease, "possible_duplicate")],
      collectedAt: secondAt,
    }),
  );

  assert.deepEqual(firstOutcome, { reviewItemsCreated: 1 });
  assert.deepEqual(repeatedOutcome, { reviewItemsCreated: 0 });
  assert.deepEqual(newerOutcome, { reviewItemsCreated: 1 });
  const pending = d1.rows<{
    status: string;
    created_at: string;
    payload_json: string;
  }>(
    "select status, created_at, payload_json from review_items where source_key = ? and external_id = ? and status = 'pending'",
    "official",
    "release-1",
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].created_at, secondAt);
  assert.equal(
    (JSON.parse(pending[0].payload_json) as ReleaseGroup).release.title,
    "Newest Review Candidate",
  );
});

test("a newer accepted result closes stale pending review items", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const reviewAt = "2026-07-31T01:00:00.000Z";
  const acceptedAt = "2026-07-31T02:00:00.000Z";

  await repository.persistSourceResult(
    sourceResult({
      groups: [
        releaseGroup(
          { ...baseRelease, collectedAt: reviewAt },
          "possible_duplicate",
        ),
      ],
      collectedAt: reviewAt,
    }),
  );
  const reviewId = d1.rows<{ id: number }>(
    "select id from review_items where status = 'pending'",
  )[0].id;
  await repository.persistSourceResult(
    sourceResult({
      groups: [
        releaseGroup({ ...baseRelease, collectedAt: acceptedAt }),
      ],
      collectedAt: acceptedAt,
    }),
  );

  assert.deepEqual(
    d1.rows<{
      status: string;
      resolved_at: string | null;
      resolved_by: string | null;
    }>(
      "select status, resolved_at, resolved_by from review_items where id = ?",
      reviewId,
    ),
    [
      {
        status: "ignored",
        resolved_at: acceptedAt,
        resolved_by: "collector:official",
      },
    ],
  );
  await assert.rejects(
    repository.resolveReview({
      id: reviewId,
      action: "approve",
      resolvedBy: "admin@example.com",
    }),
    /not found|not pending|claimed/i,
  );
});

test("only the affected-row winner of a review claim may mutate catalog data", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const reviewAt = "2026-07-31T01:00:00.000Z";
  await repository.persistSourceResult(
    sourceResult({
      groups: [
        releaseGroup(
          { ...baseRelease, collectedAt: reviewAt },
          "possible_duplicate",
        ),
      ],
      collectedAt: reviewAt,
    }),
  );
  const reviewId = d1.rows<{ id: number }>(
    "select id from review_items where status = 'pending'",
  )[0].id;

  const results = await Promise.allSettled([
    repository.resolveReview({
      id: reviewId,
      action: "approve",
      resolvedBy: "approver@example.com",
    }),
    repository.resolveReview({
      id: reviewId,
      action: "edit",
      title: "Edited Winner",
      releaseDate: "2026-08-02",
      releaseTime: "11:00",
      resolvedBy: "editor@example.com",
    }),
  ]);

  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(({ status }) => status === "rejected").length,
    1,
  );
  const winningTitle =
    results[0].status === "fulfilled" ? "Air Example" : "Edited Winner";
  assert.deepEqual(
    d1.rows<{ title: string }>("select title from release_catalog"),
    [{ title: winningTitle }],
  );
  assert.deepEqual(
    d1.rows<{
      status: string;
      resolved_by: string;
      claim_token: string | null;
      claimed_at: string | null;
    }>(
      "select status, resolved_by, claim_token, claimed_at from review_items where id = ?",
      reviewId,
    ),
    [
      {
        status: "approved",
        resolved_by:
          results[0].status === "fulfilled"
            ? "approver@example.com"
            : "editor@example.com",
        claim_token: null,
        claimed_at: null,
      },
    ],
  );
});

test("review edits preserve an existing stable style ID, key, history, and saved foreign key", async () => {
  const d1 = new SQLiteD1();
  const stableId = "release-reviewed-style";
  const originalAt = "2026-07-30T00:00:00.000Z";
  const reviewAt = "2026-07-31T01:00:00.000Z";
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stableId,
    "style:dd1399100",
    baseRelease.title,
    baseRelease.brand,
    baseRelease.category,
    baseRelease.releaseKind,
    baseRelease.releaseDate,
    baseRelease.releaseTime,
    "published",
    100,
    originalAt,
    originalAt,
    originalAt,
    null,
  );
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "official:release-1",
    stableId,
    baseRelease.sourceKey,
    baseRelease.externalId,
    baseRelease.retailer,
    baseRelease.productUrl,
    baseRelease.sourceUrl,
    baseRelease.priceLabel,
    baseRelease.releaseDate,
    baseRelease.releaseTime,
    originalAt,
  );
  d1.execute(
    "insert into saved_releases (user_email, release_id, created_at) values (?, ?, ?)",
    "reviewer@example.com",
    stableId,
    originalAt,
  );
  d1.execute(
    `insert into release_changes (
      release_id, field, previous_value, next_value, changed_at
    ) values (?, ?, ?, ?, ?)`,
    stableId,
    "priceLabel",
    null,
    baseRelease.priceLabel,
    originalAt,
  );
  const repository = productionRepository(d1);
  await repository.persistSourceResult(
    sourceResult({
      groups: [
        {
          ...releaseGroup(
            { ...baseRelease, collectedAt: reviewAt },
            "conflicting_schedule",
          ),
          canonicalKey: "style:dd1399100",
        },
      ],
      collectedAt: reviewAt,
    }),
  );
  const reviewId = d1.rows<{ id: number }>(
    "select id from review_items where status = 'pending'",
  )[0].id;

  await repository.resolveReview({
    id: reviewId,
    action: "edit",
    title: "Edited schedule",
    releaseDate: "2026-08-02",
    releaseTime: "11:00",
    resolvedBy: "editor@example.com",
  });

  assert.deepEqual(
    d1.rows<{
      id: string;
      canonical_key: string;
      title: string;
      release_date: string;
      release_time: string | null;
    }>(
      "select id, canonical_key, title, release_date, release_time from release_catalog",
    ),
    [
      {
        id: stableId,
        canonical_key: "style:dd1399100",
        title: "Edited schedule",
        release_date: "2026-08-02",
        release_time: "11:00",
      },
    ],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from release_channels",
    ),
    [{ release_id: stableId }],
  );
  assert.deepEqual(
    d1.rows<{ release_id: string }>(
      "select release_id from saved_releases",
    ),
    [{ release_id: stableId }],
  );
  assert.equal(
    d1.rows<{ release_id: string }>(
      "select release_id from release_changes where release_id = ?",
      stableId,
    ).every(({ release_id }) => release_id === stableId),
    true,
  );
  assert.deepEqual(d1.rows("PRAGMA foreign_key_check"), []);
});

test("review schedule edit never recomputes a title-fallback canonical identity", async () => {
  const d1 = new SQLiteD1();
  const stableId = "release-reviewed-title";
  const stableKey = "release:nike:air-example:2026-08-01";
  const originalAt = "2026-07-30T00:00:00.000Z";
  const reviewAt = "2026-07-31T01:00:00.000Z";
  const titleRelease = {
    ...baseRelease,
    externalId: "title-review",
    styleCode: null,
    collectedAt: reviewAt,
  };
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    stableId,
    stableKey,
    titleRelease.title,
    titleRelease.brand,
    titleRelease.category,
    titleRelease.releaseKind,
    titleRelease.releaseDate,
    titleRelease.releaseTime,
    "published",
    100,
    originalAt,
    originalAt,
    originalAt,
    null,
  );
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "official:title-review",
    stableId,
    titleRelease.sourceKey,
    titleRelease.externalId,
    titleRelease.retailer,
    titleRelease.productUrl,
    titleRelease.sourceUrl,
    titleRelease.priceLabel,
    titleRelease.releaseDate,
    titleRelease.releaseTime,
    originalAt,
  );
  const repository = productionRepository(d1);
  await repository.persistSourceResult(
    sourceResult({
      groups: [
        {
          canonicalKey: stableKey,
          release: titleRelease,
          channels: [titleRelease],
          reviewReason: "conflicting_schedule",
        },
      ],
      collectedAt: reviewAt,
    }),
  );
  const reviewId = d1.rows<{ id: number }>(
    "select id from review_items where status = 'pending'",
  )[0].id;

  await repository.resolveReview({
    id: reviewId,
    action: "edit",
    title: titleRelease.title,
    releaseDate: "2026-08-02",
    releaseTime: "11:00",
    resolvedBy: "editor@example.com",
  });

  assert.deepEqual(
    d1.rows<{
      id: string;
      canonical_key: string;
      release_date: string;
      release_time: string | null;
    }>(
      "select id, canonical_key, release_date, release_time from release_catalog",
    ),
    [
      {
        id: stableId,
        canonical_key: stableKey,
        release_date: "2026-08-02",
        release_time: "11:00",
      },
    ],
  );
});

test("review approval budgets change chunks for the review guard's actual bindings", async () => {
  const d1 = new SQLiteD1();
  const reviewAt = "2026-07-31T01:00:00.000Z";
  d1.execute(
    `insert into release_catalog (
      id, canonical_key, title, brand, category, release_kind,
      release_date, release_time, status, confidence,
      first_seen_at, updated_at, last_verified_at, changed_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "release-review-many",
    "style:review-many",
    "Many Channel Review",
    "Nike",
    "sneakers",
    "general",
    "2026-08-01",
    "10:00",
    "published",
    100,
    collectedAt,
    collectedAt,
    collectedAt,
    null,
  );
  const oldChannels = Array.from({ length: 13 }, (_, index) => ({
    ...baseRelease,
    externalId: `review-many-${index}`,
    title: "Many Channel Review",
    styleCode: "REVIEW-MANY",
    productUrl: `https://store.example.com/review-many-${index}`,
    releaseDate: "2026-08-01",
    collectedAt,
  }));
  for (const channel of oldChannels) {
    d1.execute(
      `insert into release_channels (
        id, release_id, source_key, external_id, retailer,
        product_url, source_url, price_label,
        release_date, release_time, collected_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `official:${channel.externalId}`,
      "release-review-many",
      channel.sourceKey,
      channel.externalId,
      channel.retailer,
      channel.productUrl,
      channel.sourceUrl,
      channel.priceLabel,
      channel.releaseDate,
      channel.releaseTime,
      channel.collectedAt,
    );
  }
  const changedChannels = oldChannels.map((channel) => ({
    ...channel,
    releaseDate: "2026-08-02",
    collectedAt: reviewAt,
  }));
  const group: ReleaseGroup = {
    canonicalKey: "style:review-many",
    release: changedChannels[0],
    channels: changedChannels,
    reviewReason: "possible_duplicate",
  };
  d1.execute(
    `insert into review_items (
      source_key, external_id, reason, payload_json,
      status, created_at, resolved_at, resolved_by
    ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    "official",
    changedChannels[0].externalId,
    "possible_duplicate",
    JSON.stringify(group),
    "pending",
    reviewAt,
    null,
    null,
  );
  const reviewId = d1.rows<{ id: number }>(
    "select id from review_items",
  )[0].id;
  const repository = productionRepository(d1);

  await repository.resolveReview({
    id: reviewId,
    action: "approve",
    resolvedBy: "admin@example.com",
  });

  assert.ok(d1.parameterCounts.every((count) => count <= 100));
  assert.equal(
    d1.rows<{ count: number }>(
      "select count(*) as count from release_changes",
    )[0].count,
    13,
  );
});

test("canonical collision preserves both catalogs and routes the incoming identity to review", async () => {
  const d1 = new SQLiteD1();
  const catalogRows = [
    {
      id: "catalog-a",
      canonicalKey: "release:nike:original-a:2026-08-01",
      title: "Original A",
      releaseDate: "2026-08-01",
    },
    {
      id: "catalog-b",
      canonicalKey: "release:nike:collision-b:2026-08-02",
      title: "Collision B",
      releaseDate: "2026-08-02",
    },
  ];
  for (const row of catalogRows) {
    d1.execute(
      `insert into release_catalog (
        id, canonical_key, title, brand, category, release_kind,
        release_date, release_time, status, confidence,
        first_seen_at, updated_at, last_verified_at, changed_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.canonicalKey,
      row.title,
      "Nike",
      "sneakers",
      "general",
      row.releaseDate,
      "10:00",
      "published",
      100,
      collectedAt,
      collectedAt,
      collectedAt,
      null,
    );
  }
  d1.execute(
    `insert into release_channels (
      id, release_id, source_key, external_id, retailer,
      product_url, source_url, price_label,
      release_date, release_time, collected_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "official:collision",
    "catalog-a",
    "official",
    "collision-external",
    "Official Store",
    "https://store.example.com/collision",
    baseRelease.sourceUrl,
    baseRelease.priceLabel,
    "2026-08-01",
    "10:00",
    collectedAt,
  );
  const repository = productionRepository(d1);
  const incoming = {
    ...baseRelease,
    externalId: "collision-external",
    title: "Incoming Collision",
    styleCode: null,
    releaseDate: "2026-08-02",
    productUrl: "https://store.example.com/collision",
    collectedAt: "2026-07-31T02:00:00.000Z",
  };

  await repository.persistSourceResult(
    sourceResult({
      groups: [
        {
          canonicalKey: "release:nike:collision-b:2026-08-02",
          release: incoming,
          channels: [incoming],
          reviewReason: null,
        },
      ],
      collectedAt: incoming.collectedAt,
    }),
  );

  assert.deepEqual(
    d1.rows<{
      id: string;
      canonical_key: string;
      title: string;
      release_date: string;
    }>(
      "select id, canonical_key, title, release_date from release_catalog order by id",
    ),
    catalogRows.map(({ id, canonicalKey, title, releaseDate }) => ({
      id,
      canonical_key: canonicalKey,
      title,
      release_date: releaseDate,
    })),
  );
  assert.deepEqual(
    d1.rows<{ release_id: string; release_date: string }>(
      "select release_id, release_date from release_channels where source_key = ? and external_id = ?",
      "official",
      "collision-external",
    ),
    [{ release_id: "catalog-a", release_date: "2026-08-01" }],
  );
  const pending = d1.rows<{
    reason: string;
    payload_json: string;
  }>(
    "select reason, payload_json from review_items where status = 'pending'",
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].reason, "possible_duplicate");
  assert.equal(
    (JSON.parse(pending[0].payload_json) as ReleaseGroup).release.title,
    "Incoming Collision",
  );
});

test("review resolution requires an existing merge target and keeps resolved items immutable", async () => {
  const d1 = new SQLiteD1();
  const repository = productionRepository(d1);
  const reviewAt = "2026-07-31T03:00:00.000Z";
  await repository.persistSourceResult(
    sourceResult({
      groups: [
        releaseGroup(
          { ...baseRelease, collectedAt: reviewAt },
          "possible_duplicate",
        ),
      ],
      collectedAt: reviewAt,
    }),
  );
  const reviewId = d1.rows<{ id: number }>(
    "select id from review_items where status = 'pending'",
  )[0].id;

  await assert.rejects(
    repository.resolveReview({
      id: reviewId,
      action: "merge",
      releaseId: "cached:missing",
      resolvedBy: "admin@example.com",
    }),
    (error: unknown) =>
      error instanceof ReviewResolutionError &&
      error.code === "merge_target_not_found",
  );
  assert.deepEqual(
    d1.rows<{
      status: string;
      claim_token: string | null;
      claimed_at: string | null;
    }>(
      "select status, claim_token, claimed_at from review_items where id = ?",
      reviewId,
    ),
    [{ status: "pending", claim_token: null, claimed_at: null }],
  );

  await repository.resolveReview({
    id: reviewId,
    action: "ignore",
    resolvedBy: "admin@example.com",
  });
  await assert.rejects(
    repository.resolveReview({
      id: reviewId,
      action: "approve",
      resolvedBy: "second-admin@example.com",
    }),
    (error: unknown) =>
      error instanceof ReviewResolutionError &&
      error.code === "not_pending",
  );
  assert.deepEqual(
    d1.rows<{ status: string; resolved_by: string }>(
      "select status, resolved_by from review_items where id = ?",
      reviewId,
    ),
    [{ status: "ignored", resolved_by: "admin@example.com" }],
  );
});
