import assert from "node:assert/strict";
import test from "node:test";
import {
  changedFields,
  groupCollectedReleases,
} from "../app/collection/dedupe.ts";
import type { CollectedRelease } from "../app/collection/types.ts";

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
  styleCode: null,
  retailer: "Official Store",
  productUrl: "https://store.example.com/products/air-example",
  sourceUrl: "https://store.example.com/calendar",
  collectedAt: "2026-07-31T00:00:00.000Z",
};

test("groups matching style codes on the same date into retailer channels", () => {
  const official = { ...baseRelease, styleCode: "DD-1399-100" };
  const retailer = {
    ...official,
    sourceKey: "retailer",
    externalId: "release-2",
    retailer: "Retailer Store",
    productUrl: "https://retailer.example.com/products/air-example",
    styleCode: "dd 1399 100",
  };

  const groups = groupCollectedReleases([retailer, official]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].canonicalKey, "style:dd1399100");
  assert.equal(groups[0].release, official);
  assert.deepEqual(groups[0].channels, [official, retailer]);
  assert.equal(groups[0].reviewReason, null);
});

test("groups normalized title, brand, and date when style codes are absent", () => {
  const official = { ...baseRelease, title: "Air   Example!", brand: " NIKE " };
  const retailer = {
    ...baseRelease,
    sourceKey: "retailer",
    externalId: "release-2",
    retailer: "Retailer Store",
    productUrl: "https://retailer.example.com/products/air-example",
  };

  const groups = groupCollectedReleases([retailer, official]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].canonicalKey, "release:nike:air-example:2026-08-01");
  assert.deepEqual(groups[0].channels, [official, retailer]);
  assert.equal(groups[0].reviewReason, null);
});

test("keeps releases with the same title on different dates separate", () => {
  const firstDate = baseRelease;
  const secondDate = {
    ...baseRelease,
    externalId: "release-2",
    releaseDate: "2026-08-02",
  };

  const groups = groupCollectedReleases([secondDate, firstDate]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.release.releaseDate),
    ["2026-08-01", "2026-08-02"],
  );
});

test("keeps date groups separate without changing the stable style identity", () => {
  const firstDate = { ...baseRelease, styleCode: "DD-1399-100" };
  const secondDate = {
    ...firstDate,
    externalId: "release-2",
    releaseDate: "2026-08-02",
  };

  const groups = groupCollectedReleases([secondDate, firstDate]);

  assert.deepEqual(
    groups.map(({ canonicalKey }) => canonicalKey),
    ["style:dd1399100", "style:dd1399100"],
  );
  assert.deepEqual(
    groups.map(({ reviewReason }) => reviewReason),
    [null, null],
  );
});

test("routes distinct-source date and known-time disagreements to source-scoped conflict review", () => {
  const official = { ...baseRelease, styleCode: "DD-1399-100" };
  const differentDate = {
    ...official,
    sourceKey: "retailer",
    externalId: "release-2",
    releaseDate: "2026-08-02",
  };
  const differentTime = {
    ...official,
    sourceKey: "retailer",
    externalId: "release-3",
    releaseTime: "11:00",
  };

  const dateGroups = groupCollectedReleases([official, differentDate]);
  const timeGroups = groupCollectedReleases([official, differentTime]);

  assert.deepEqual(
    dateGroups.map(({ canonicalKey, release, channels, reviewReason }) => ({
      canonicalKey,
      sourceKey: release.sourceKey,
      externalId: release.externalId,
      channelCount: channels.length,
      reviewReason,
    })),
    [
      {
        canonicalKey: "style:dd1399100",
        sourceKey: "official",
        externalId: "release-1",
        channelCount: 1,
        reviewReason: "conflicting_schedule",
      },
      {
        canonicalKey: "style:dd1399100",
        sourceKey: "retailer",
        externalId: "release-2",
        channelCount: 1,
        reviewReason: "conflicting_schedule",
      },
    ],
  );
  assert.deepEqual(
    timeGroups.map(({ release, channels, reviewReason }) => ({
      sourceKey: release.sourceKey,
      externalId: release.externalId,
      channelCount: channels.length,
      reviewReason,
    })),
    [
      {
        sourceKey: "official",
        externalId: "release-1",
        channelCount: 1,
        reviewReason: "conflicting_schedule",
      },
      {
        sourceKey: "retailer",
        externalId: "release-3",
        channelCount: 1,
        reviewReason: "conflicting_schedule",
      },
    ],
  );
});

test("does not conflict on null versus known time or same-source duplicates", () => {
  const official = {
    ...baseRelease,
    styleCode: "DD-1399-100",
    releaseTime: null,
  };
  const knownTime = {
    ...official,
    sourceKey: "retailer",
    externalId: "release-2",
    releaseTime: "11:00",
  };
  const sameSourceDifferentDate = {
    ...official,
    externalId: "release-3",
    releaseDate: "2026-08-02",
  };

  const nullAndKnown = groupCollectedReleases([official, knownTime]);
  const sameSource = groupCollectedReleases([
    official,
    sameSourceDifferentDate,
  ]);

  assert.equal(nullAndKnown.length, 1);
  assert.equal(nullAndKnown[0].reviewReason, null);
  assert.deepEqual(
    sameSource.map(({ canonicalKey, reviewReason }) => ({
      canonicalKey,
      reviewReason,
    })),
    [
      { canonicalKey: "style:dd1399100", reviewReason: null },
      { canonicalKey: "style:dd1399100", reviewReason: null },
    ],
  );
});

test("does not conflict clearly different raffle or offline release stages", () => {
  const online = { ...baseRelease, styleCode: "DD-1399-100" };
  const raffle = {
    ...online,
    sourceKey: "raffle-source",
    externalId: "raffle-release",
    releaseKind: "raffle" as const,
    releaseDate: "2026-08-02",
  };
  const offline = {
    ...online,
    sourceKey: "offline-source",
    externalId: "offline-release",
    releaseKind: "offline" as const,
    releaseDate: "2026-08-03",
  };

  const groups = groupCollectedReleases([online, raffle, offline]);

  assert.deepEqual(
    groups.map(({ release, reviewReason }) => ({
      sourceKey: release.sourceKey,
      releaseKind: release.releaseKind,
      reviewReason,
    })),
    [
      {
        sourceKey: "official",
        releaseKind: "general",
        reviewReason: null,
      },
      {
        sourceKey: "raffle-source",
        releaseKind: "raffle",
        reviewReason: null,
      },
      {
        sourceKey: "offline-source",
        releaseKind: "offline",
        reviewReason: null,
      },
    ],
  );
});

test("routes fuzzy titles without style codes to review without merging them", () => {
  const original = { ...baseRelease, title: "Air Example Retro" };
  const similar = {
    ...baseRelease,
    sourceKey: "retailer",
    externalId: "release-2",
    title: "Air Example Retro Premium",
    retailer: "Retailer Store",
    productUrl: "https://retailer.example.com/products/air-example-retro-premium",
  };

  const groups = groupCollectedReleases([similar, original]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.release.title),
    ["Air Example Retro", "Air Example Retro Premium"],
  );
  assert.deepEqual(
    groups.map((group) => group.reviewReason),
    ["possible_duplicate", "possible_duplicate"],
  );
});

test("uses canonical brand normalization and empty-normalized style codes for fuzzy review", () => {
  const original = {
    ...baseRelease,
    title: "Air Example Retro",
    brand: " Nike   Inc. ",
    styleCode: " — ",
  };
  const similar = {
    ...baseRelease,
    sourceKey: "retailer",
    externalId: "release-2",
    title: "Air Example Retro Premium",
    brand: "NIKE Inc",
    retailer: "Retailer Store",
    productUrl: "https://retailer.example.com/products/air-example-retro-premium",
  };

  const groups = groupCollectedReleases([original, similar]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.reviewReason),
    ["possible_duplicate", "possible_duplicate"],
  );
});

test("selects representatives and channels independently of input order under primary comparator ties", () => {
  const earlier = {
    ...baseRelease,
    category: "fashion" as const,
    releaseKind: "collab" as const,
    releaseTime: "09:00",
    priceLabel: "₩169,000",
    sourceUrl: "https://store.example.com/earlier",
    collectedAt: "2026-07-30T00:00:00.000Z",
  };
  const later = {
    ...baseRelease,
    category: "lifestyle" as const,
    releaseKind: "raffle" as const,
    releaseTime: "11:00",
    priceLabel: "₩189,000",
    sourceUrl: "https://store.example.com/later",
    collectedAt: "2026-07-31T00:00:00.000Z",
  };

  const forward = groupCollectedReleases([earlier, later]);
  const reversed = groupCollectedReleases([later, earlier]);

  assert.deepEqual(reversed, forward);
  assert.equal(forward[0].release, earlier);
  assert.deepEqual(forward[0].channels, [earlier, later]);
});

test("keeps normalization-empty titles in separate conservative-review groups", () => {
  const first = { ...baseRelease, title: " !!! " };
  const second = {
    ...baseRelease,
    sourceKey: "retailer",
    externalId: "release-2",
    title: "???",
    retailer: "Retailer Store",
    productUrl: "https://retailer.example.com/products/unknown",
  };

  const groups = groupCollectedReleases([second, first]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => group.channels.length),
    [1, 1],
  );
  assert.equal(new Set(groups.map((group) => group.canonicalKey)).size, 2);
  assert.ok(groups.every((group) => group.canonicalKey.startsWith("degenerate:")));
  assert.deepEqual(
    groups.map((group) => group.reviewReason),
    ["possible_duplicate", "possible_duplicate"],
  );
});

test("records only changed schedule and channel fields", () => {
  const changes = changedFields(
    {
      releaseDate: "2026-08-01",
      releaseTime: "10:00",
      priceLabel: "₩179,000",
      productUrl: "https://store.example.com/products/air-example",
    },
    {
      ...baseRelease,
      releaseDate: "2026-08-02",
      releaseTime: "11:00",
      priceLabel: "₩189,000",
      productUrl: "https://store.example.com/products/air-example-v2",
    },
  );

  assert.deepEqual(changes, [
    {
      field: "releaseDate",
      previousValue: "2026-08-01",
      nextValue: "2026-08-02",
    },
    {
      field: "releaseTime",
      previousValue: "10:00",
      nextValue: "11:00",
    },
    {
      field: "priceLabel",
      previousValue: "₩179,000",
      nextValue: "₩189,000",
    },
    {
      field: "productUrl",
      previousValue: "https://store.example.com/products/air-example",
      nextValue: "https://store.example.com/products/air-example-v2",
    },
  ]);
});

test("omits unchanged fields from change detection", () => {
  const unchanged = {
    releaseDate: baseRelease.releaseDate,
    releaseTime: baseRelease.releaseTime,
    priceLabel: baseRelease.priceLabel,
    productUrl: baseRelease.productUrl,
  };

  assert.deepEqual(changedFields(unchanged, baseRelease), []);
});

test("records null and string transitions in both directions", () => {
  const nullToString = changedFields(
    {
      releaseDate: baseRelease.releaseDate,
      releaseTime: null,
      priceLabel: null,
      productUrl: baseRelease.productUrl,
    },
    baseRelease,
  );
  const stringToNull = changedFields(
    {
      releaseDate: baseRelease.releaseDate,
      releaseTime: baseRelease.releaseTime,
      priceLabel: baseRelease.priceLabel,
      productUrl: baseRelease.productUrl,
    },
    { ...baseRelease, releaseTime: null, priceLabel: null },
  );

  assert.deepEqual(nullToString, [
    { field: "releaseTime", previousValue: null, nextValue: "10:00" },
    { field: "priceLabel", previousValue: null, nextValue: "₩179,000" },
  ]);
  assert.deepEqual(stringToNull, [
    { field: "releaseTime", previousValue: "10:00", nextValue: null },
    { field: "priceLabel", previousValue: "₩179,000", nextValue: null },
  ]);
});
