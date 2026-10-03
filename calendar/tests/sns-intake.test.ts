import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSnsIntake,
  type SnsIntakeInput,
} from "../app/collection/sns-intake.ts";

const baseInput: SnsIntakeInput = {
  postUrl: "https://www.instagram.com/p/ABC123/?igsh=x",
  handle: "nike",
  title: "Air Example",
  brand: "Nike",
  category: "sneakers",
  releaseDate: "2026-08-20",
  releaseTime: null,
  kind: "raffle",
  styleCode: "BR-123",
};

test("normalizes an official dated post into an SNS announcement channel", () => {
  const result = normalizeSnsIntake(baseInput, "2026-08-11T00:00:00.000Z");
  assert.equal(result.kind, "publish");
  if (result.kind === "publish") {
    assert.equal(result.release.sourceKey, "sns");
    assert.equal(result.release.productUrl, null);
    assert.equal(result.release.sourceUrl, "https://www.instagram.com/p/ABC123/");
    assert.equal(result.release.releaseKind, "raffle");
  }
});

test("routes missing dates to review without creating a live release", () => {
  const result = normalizeSnsIntake(
    { ...baseInput, postUrl: "https://www.instagram.com/p/ABC124/", releaseDate: null },
    "2026-08-11T00:00:00.000Z",
  );
  assert.equal(result.kind, "review");
  if (result.kind === "review") assert.equal(result.reason, "missing_date");
});

test("rejects unofficial accounts and never calls the network", () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("SNS intake must not fetch");
  }) as typeof fetch;
  try {
    const result = normalizeSnsIntake(
      { ...baseInput, handle: "unverified-account" },
      "2026-08-11T00:00:00.000Z",
    );
    assert.deepEqual(result, { kind: "reject", reason: "unofficial_account" });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

