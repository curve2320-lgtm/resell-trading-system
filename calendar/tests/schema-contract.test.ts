import assert from "node:assert/strict";
import test from "node:test";
import {
  collectionSlots,
  releaseCatalog,
  releaseChanges,
  releaseChannels,
  releaseSources,
  reviewItems,
  savedReleases,
} from "../db/schema.ts";

const schemaContracts = [
  ["releaseCatalog", releaseCatalog, ["id", "canonicalKey", "title", "brand", "category", "releaseKind", "releaseDate", "releaseTime", "status", "confidence", "firstSeenAt", "updatedAt", "lastVerifiedAt", "changedAt"]],
  ["releaseChannels", releaseChannels, ["id", "releaseId", "sourceKey", "externalId", "retailer", "productUrl", "sourceUrl", "priceLabel", "releaseDate", "releaseTime", "collectedAt"]],
  ["releaseSources", releaseSources, ["sourceKey", "status", "lastSuccessAt", "lastFailureAt", "consecutiveFailures", "sourceCount", "newCount", "mergedCount", "reviewCount", "message", "resultRevisionAt", "resultClaimToken", "resultClaimedAt"]],
  ["collectionSlots", collectionSlots, ["slotKey", "status", "startedAt", "completedAt", "claimToken"]],
  ["releaseChanges", releaseChanges, ["id", "releaseId", "field", "previousValue", "nextValue", "changedAt"]],
  ["reviewItems", reviewItems, ["id", "sourceKey", "externalId", "reason", "payloadJson", "status", "createdAt", "resolvedAt", "resolvedBy", "claimToken", "claimedAt"]],
  ["savedReleases", savedReleases, ["userEmail", "releaseId", "createdAt"]],
] as const;

for (const [tableName, table, columns] of schemaContracts) {
  test(`${tableName} exposes its cache schema columns`, () => {
    for (const column of columns) {
      assert.ok(column in table, `${tableName}.${column} must be exported`);
    }
  });
}
