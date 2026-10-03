import assert from "node:assert/strict";
import test from "node:test";
import { legacyReleaseToCollected } from "../app/collection/legacy.ts";

test("maps legacy releases into the current catalog shape", () => {
  const release = legacyReleaseToCollected(
    {
      id: 42,
      externalId: "old-42",
      title: "Legacy Runner",
      brand: "NIKE",
      category: "응모",
      releaseDate: "2026-08-20",
      releaseTime: "10:00",
      channel: "Nike SNKRS Korea",
      sourceName: "NIKE SNKRS",
      sourceUrl: "https://www.nike.com/kr/launch/upcoming",
      retailer: "Nike SNKRS Korea",
      priceLabel: null,
      styleCode: "OLD-42",
      productUrl: "https://www.nike.com/kr/launch/t/old-42",
    },
    "2026-08-12T00:00:00.000Z",
  );
  assert.equal(release.sourceKey, "legacy:nike");
  assert.equal(release.externalId, "legacy:42:old-42");
  assert.equal(release.releaseKind, "raffle");
  assert.equal(release.category, "sneakers");
});
