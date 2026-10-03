import assert from "node:assert/strict";
import test from "node:test";
import type { AdapterReleaseInput } from "../app/collection/types.ts";
import { classifyRelease } from "../app/collection/classify.ts";

const baseInput: AdapterReleaseInput = {
  sourceKey: "official",
  externalId: "release-1",
  title: "Air Example",
  brand: "Nike",
  releaseDate: "2026-08-01",
  releaseTime: null,
  priceLabel: null,
  styleCode: null,
  retailer: "Official Store",
  productUrl: "https://store.example.com/products/air-example",
  sourceUrl: "https://store.example.com/calendar",
  collectedAt: "2026-07-31T00:00:00.000Z",
  allowedDomains: ["store.example.com"],
};

for (const separator of ["x", "협업", "X"]) {
  test(`classifies ${separator} collaboration markers as collab`, () => {
    const result = classifyRelease({
      ...baseInput,
      title: `Brand ${separator} Partner`,
    });

    assert.equal(result.reviewReason, null);
    assert.equal(result.release?.releaseKind, "collab");
  });
}

for (const title of ["나이키 x 사카이", "나이키 X 사카이"]) {
  test(`classifies Korean partner names in ${title} as collab`, () => {
    const result = classifyRelease({ ...baseInput, title });

    assert.equal(result.reviewReason, null);
    assert.equal(result.release?.releaseKind, "collab");
  });
}

for (const title of ["Model X 100", "Size X Large"]) {
  test(`does not treat ${title} as a collaboration`, () => {
    const result = classifyRelease({ ...baseInput, title });

    assert.equal(result.reviewReason, null);
    assert.equal(result.release?.releaseKind, "general");
  });
}

for (const marker of ["RAFFLE", "래플", "추첨"]) {
  test(`classifies ${marker} markers as raffle`, () => {
    const result = classifyRelease({
      ...baseInput,
      title: `Air Example ${marker}`,
    });

    assert.equal(result.reviewReason, null);
    assert.equal(result.release?.releaseKind, "raffle");
  });
}

test("routes a missing date to review without inferring one", () => {
  const result = classifyRelease({ ...baseInput, releaseDate: "" });

  assert.equal(result.release, null);
  assert.equal(result.reviewReason, "missing_date");
});

test("routes product URLs outside the adapter domains to review", () => {
  const result = classifyRelease({
    ...baseInput,
    productUrl: "https://untrusted.example.net/products/air-example",
  });

  assert.equal(result.release, null);
  assert.equal(result.reviewReason, "invalid_source_url");
});

test("accepts a product URL on an allowed subdomain", () => {
  const result = classifyRelease({
    ...baseInput,
    productUrl: "https://seoul.store.example.com/products/air-example",
  });

  assert.equal(result.reviewReason, null);
  assert.equal(result.release?.productUrl, "https://seoul.store.example.com/products/air-example");
});

test("rejects a hostile lookalike of an allowed domain", () => {
  const result = classifyRelease({
    ...baseInput,
    productUrl: "https://store.example.com.attacker.example/products/air-example",
  });

  assert.equal(result.release, null);
  assert.equal(result.reviewReason, "invalid_source_url");
});

test("normalizes scheme, port, and Unicode IDN allowed-domain declarations", () => {
  const result = classifyRelease({
    ...baseInput,
    allowedDomains: ["https://BÜCHER.example:8443"],
    productUrl: "https://xn--bcher-kva.example/products/air-example",
  });

  assert.equal(result.reviewReason, null);
  assert.equal(result.release?.productUrl, "https://xn--bcher-kva.example/products/air-example");
});

test("treats a trailing DNS dot as equivalent on allowed domains and product URLs", () => {
  const result = classifyRelease({
    ...baseInput,
    allowedDomains: ["https://store.example.com.:8443"],
    productUrl: "https://store.example.com/products/air-example",
  });

  assert.equal(result.reviewReason, null);
  assert.equal(result.release?.productUrl, "https://store.example.com/products/air-example");
});
