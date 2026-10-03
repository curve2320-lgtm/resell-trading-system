import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * 관리자 '일정 등록'으로 직접 저장하는 자체 일정 테이블.
 * (외부 출처에서 자동 수집되는 일정은 DB에 저장하지 않고 접속 시마다 새로 불러옵니다.)
 */
export const releases = sqliteTable("releases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  externalId: text("external_id"),
  title: text("title").notNull(),
  brand: text("brand").notNull(),
  category: text("category").notNull(),
  releaseDate: text("release_date").notNull(),
  releaseTime: text("release_time"),
  channel: text("channel").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull(),
  note: text("note").notNull(),
  isFeatured: integer("is_featured", { mode: "boolean" }).notNull(),
  createdBy: text("created_by"),
  retailer: text("retailer"),
  releaseMethod: text("release_method"),
  priceLabel: text("price_label"),
  styleCode: text("style_code"),
  productUrl: text("product_url"),
});

export const releaseCatalog = sqliteTable(
  "release_catalog",
  {
    id: text("id").primaryKey(),
    canonicalKey: text("canonical_key").notNull(),
    title: text("title").notNull(),
    brand: text("brand"),
    category: text("category"),
    releaseKind: text("release_kind"),
    releaseDate: text("release_date"),
    releaseTime: text("release_time"),
    status: text("status").notNull(),
    confidence: integer("confidence").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastVerifiedAt: text("last_verified_at"),
    changedAt: text("changed_at"),
  },
  (table) => [uniqueIndex("release_catalog_canonical_key_unique").on(table.canonicalKey)],
);

export const releaseChannels = sqliteTable(
  "release_channels",
  {
    id: text("id").primaryKey(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releaseCatalog.id),
    sourceKey: text("source_key").notNull(),
    externalId: text("external_id").notNull(),
    retailer: text("retailer"),
    productUrl: text("product_url"),
    sourceUrl: text("source_url"),
    priceLabel: text("price_label"),
    releaseDate: text("release_date"),
    releaseTime: text("release_time"),
    collectedAt: text("collected_at").notNull(),
    detailsJson: text("details_json"),
  },
  (table) => [
    uniqueIndex("release_channels_source_external_unique").on(
      table.sourceKey,
      table.externalId,
    ),
  ],
);

export const releaseSources = sqliteTable("release_sources", {
  sourceKey: text("source_key").primaryKey(),
  status: text("status").notNull(),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  consecutiveFailures: integer("consecutive_failures").notNull(),
  sourceCount: integer("source_count").notNull(),
  newCount: integer("new_count").notNull(),
  mergedCount: integer("merged_count").notNull(),
  reviewCount: integer("review_count").notNull(),
  message: text("message"),
  resultRevisionAt: text("result_revision_at"),
  resultClaimToken: text("result_claim_token"),
  resultClaimedAt: text("result_claimed_at"),
});

export const collectionSlots = sqliteTable("collection_slots", {
  slotKey: text("slot_key").primaryKey(),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  claimToken: text("claim_token"),
});

export const releaseChanges = sqliteTable("release_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  releaseId: text("release_id")
    .notNull()
    .references(() => releaseCatalog.id),
  field: text("field").notNull(),
  previousValue: text("previous_value"),
  nextValue: text("next_value"),
  changedAt: text("changed_at").notNull(),
});

export const reviewItems = sqliteTable("review_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceKey: text("source_key").notNull(),
  externalId: text("external_id").notNull(),
  reason: text("reason").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolvedBy: text("resolved_by"),
  claimToken: text("claim_token"),
  claimedAt: text("claimed_at"),
});

export const savedReleases = sqliteTable(
  "saved_releases",
  {
    userEmail: text("user_email").notNull(),
    releaseId: text("release_id")
      .notNull()
      .references(() => releaseCatalog.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("saved_releases_user_release_unique").on(
      table.userEmail,
      table.releaseId,
    ),
  ],
);
