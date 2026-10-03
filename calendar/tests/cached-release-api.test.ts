import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../app/collection/release-api.ts";
import type { ReleaseApiPayload } from "../app/collection/repository.ts";

const payload = (cached = false): ReleaseApiPayload => ({
  releases: cached ? [{ id: "cached" } as ReleaseApiPayload["releases"][number]] : [],
  sources: {}, reviewCount: 0,
});
const createHandler = (input: unknown) => {
  const factory = (api as Record<string, unknown>).createCachedReleaseGetHandler;
  assert.equal(typeof factory, "function");
  return (factory as (input: unknown) => () => Promise<Response>)(input);
};

test("cache-first API returns pending empty cache successfully without caching the pending state", async () => {
  const response = await createHandler({
    startRefresh: async () => ({ status: "stale", message: "Refreshing", pendingSources: 47 }),
    readReleaseApiPayload: async () => payload(), configuredSourceKeys: ["nike"],
  })();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual((await response.json()).collection, { status: "stale", message: "Refreshing", pendingSources: 47 });
});

test("cache-first API caches a settled successful snapshot", async () => {
  const response = await createHandler({
    startRefresh: async () => ({ status: "current", message: null, pendingSources: 0 }),
    readReleaseApiPayload: async () => payload(true), configuredSourceKeys: ["nike"],
  })();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=60");
});

test("cache-first API preserves saved releases on refresh failure and sanitizes the error", async () => {
  const response = await createHandler({
    startRefresh: async () => { throw new Error("private SQL and claim token"); },
    readReleaseApiPayload: async () => payload(true), configuredSourceKeys: ["nike"],
  })();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(body.releases[0].id, "cached");
  assert.deepEqual(body.collection, { status: "failed", message: "Release collection is temporarily unavailable.", pendingSources: 0 });
  assert.equal(JSON.stringify(body).includes("private SQL"), false);
});

test("cache-first API reports terminal failure with no cached schedules", async () => {
  const response = await createHandler({
    startRefresh: async () => ({ status: "failed", message: "Collection unavailable", pendingSources: 0 }),
    readReleaseApiPayload: async () => payload(), configuredSourceKeys: ["nike"],
  })();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("cache-first API returns a sanitized cache failure", async () => {
  const response = await createHandler({
    startRefresh: async () => ({ status: "stale", message: "Refreshing", pendingSources: 1 }),
    readReleaseApiPayload: async () => { throw new Error("private DB query"); }, configuredSourceKeys: ["nike"],
  })();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Release cache is temporarily unavailable." });
});
