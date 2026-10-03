import assert from "node:assert/strict";
import test from "node:test";
import { createSnsPostHandler } from "../app/api/admin/sns/route.ts";
import { AdminAccessError } from "../app/admin-auth.ts";

const body = {
  postUrl: "https://www.instagram.com/p/ABC123/?igsh=x",
  handle: "nike",
  title: "Air Example",
  brand: "Nike",
  category: "sneakers",
  releaseDate: "2026-08-20",
  releaseTime: null,
  kind: "announcement",
  styleCode: null,
};

function request(payload = body): Request {
  return new Request("https://example.test/api/admin/sns", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.test",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(payload),
  });
}

test("admin SNS POST rejects unauthenticated requests", async () => {
  const handler = await createSnsPostHandler({
    requireAdmin: async () => {
      throw new AdminAccessError(401, "Authentication required.");
    },
    repository: {},
  } as never);
  const response = await handler(request());
  assert.equal(response.status, 401);
});

test("admin SNS POST publishes a normalized official permalink", async () => {
  const handler = await createSnsPostHandler({
    requireAdmin: async () => ({ email: "owner@example.com" }),
    repository: {
      persistManualSnsRelease: async () => ({
        status: "published",
        releaseId: "cached:style:airexample",
        externalId: "ABC123",
      }),
      createManualSnsReview: async () => ({
        status: "review",
        reviewId: 1,
        externalId: "ABC123",
      }),
    },
  } as never);
  const response = await handler(request());
  assert.equal(response.status, 201);
  assert.equal((await response.json()).status, "published");
});

test("admin SNS POST routes missing dates to review", async () => {
  const handler = await createSnsPostHandler({
    requireAdmin: async () => ({ email: "owner@example.com" }),
    repository: {
      persistManualSnsRelease: async () => ({
        status: "published",
        releaseId: "cached:style:airexample",
        externalId: "ABC124",
      }),
      createManualSnsReview: async () => ({
        status: "review",
        reviewId: 7,
        externalId: "ABC124",
      }),
    },
  } as never);
  const response = await handler(request({ ...body, postUrl: "https://www.instagram.com/p/ABC124/", releaseDate: null }));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, "review");
});
