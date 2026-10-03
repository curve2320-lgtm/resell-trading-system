import assert from "node:assert/strict";
import test from "node:test";
import type { CollectedRelease } from "../app/collection/types.ts";
import { canonicalReleaseKey } from "../app/collection/normalize.ts";

const baseRelease: CollectedRelease = {
  sourceKey: "official",
  externalId: "release-1",
  title: "Air Example",
  brand: "Nike",
  category: "sneakers",
  releaseKind: "general",
  releaseDate: "2026-08-01",
  releaseTime: null,
  priceLabel: null,
  styleCode: null,
  retailer: "Official Store",
  productUrl: "https://store.example.com/products/air-example",
  sourceUrl: "https://store.example.com/calendar",
  collectedAt: "2026-07-31T00:00:00.000Z",
};

test("canonicalReleaseKey normalizes style-code case and punctuation", () => {
  assert.equal(
    canonicalReleaseKey({ ...baseRelease, styleCode: "  dd-1399 / 100 " }),
    "style:dd1399100",
  );
});

test("canonicalReleaseKey falls back to normalized brand, title, and release date", () => {
  assert.equal(
    canonicalReleaseKey({
      ...baseRelease,
      brand: "  NIKE ",
      title: "Air   Example!",
    }),
    "release:nike:air-example:2026-08-01",
  );
});

test("canonicalReleaseKey treats composed and decomposed Korean text as equivalent", () => {
  const composed = canonicalReleaseKey({ ...baseRelease, title: "나이키" });
  const decomposed = canonicalReleaseKey({ ...baseRelease, title: "나이키" });

  assert.equal(composed, "release:nike:나이키:2026-08-01");
  assert.equal(decomposed, composed);
});

test("canonicalReleaseKey treats full-width and ASCII style codes as equivalent", () => {
  const ascii = canonicalReleaseKey({ ...baseRelease, styleCode: "ABC-123" });
  const fullWidth = canonicalReleaseKey({ ...baseRelease, styleCode: "ＡＢＣ－１２３" });

  assert.equal(ascii, "style:abc123");
  assert.equal(fullWidth, ascii);
});
