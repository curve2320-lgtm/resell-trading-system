import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseFeedLoader, releaseFeedCountLabel } from "../app/release-feed-loader.ts";

function clock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    schedule(callback: () => void, delay: number) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel(handle: unknown) { timers.delete(handle as number); },
    advance(delay: number) {
      now += delay;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
    delays() { return [...timers.values()].map(timer => timer.at - now); },
  };
}
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const payload = (status: "stale" | "current" = "stale", releases: unknown[] = []) =>
  Response.json({ releases, sources: { database: { count: releases.length } }, collection: { status, message: status === "stale" ? "in progress" : null } });

test("calendar navigation requests its actual month so uncached history is collected", async () => {
  const urls:string[]=[];
  const loader=createReleaseFeedLoader({month:"2026-09",request:async url=>{urls.push(url);return payload("current");},onResponse:()=>{},onError:()=>assert.fail()});
  loader.start();await settle();loader.stop();assert.deepEqual(urls,["/api/releases?month=2026-09"]);
});

test("the request callback is unbound so native browser fetch has no invalid receiver", async () => {
  const timer = clock(); let received = 0;
  const loader = createReleaseFeedLoader({
    request: async function(this: unknown) { assert.equal(this, undefined); return payload("current"); },
    onResponse: () => { received++; }, onError: () => assert.fail("invalid request receiver"),
    schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); await settle(); assert.equal(received, 1); loader.stop();
});

test("stale cached data polls after four seconds and stops once current", async () => {
  const timer = clock();
  const received: unknown[] = [];
  let calls = 0;
  const loader = createReleaseFeedLoader({
    request: async () => { calls++; return payload(calls === 1 ? "stale" : "current", [{ id: "cached" }]); },
    onResponse: value => received.push(value), onError: () => assert.fail("unexpected failure"),
    schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); await settle();
  assert.equal(calls, 1); assert.deepEqual(timer.delays(), [4000]);
  timer.advance(3999); await settle(); assert.equal(calls, 1);
  timer.advance(1); await settle();
  assert.equal(calls, 2); assert.equal(received.length, 2); assert.deepEqual(timer.delays(), []);
  loader.stop();
});

test("an empty pending response is accepted and automatically retried", async () => {
  const timer = clock();
  const received: unknown[] = [];
  const loader = createReleaseFeedLoader({ request: async () => payload(), onResponse: value => received.push(value), onError: () => assert.fail(), schedule: timer.schedule, cancel: timer.cancel });
  loader.start(); await settle();
  assert.equal(received.length, 1); assert.deepEqual(timer.delays(), [4000]);
  loader.stop(); assert.deepEqual(timer.delays(), []);
});

test("a hung request aborts after fifteen seconds and retries", async () => {
  const timer = clock();
  let signal: AbortSignal | undefined;
  const failures: unknown[] = [];
  const loader = createReleaseFeedLoader({
    request: (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(() => {}); },
    onResponse: () => assert.fail(), onError: error => failures.push(error), schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); assert.deepEqual(timer.delays(), [15000]);
  timer.advance(15000); await settle();
  assert.equal(signal?.aborted, true); assert.equal(failures.length, 1); assert.deepEqual(timer.delays(), [4000]);
  loader.stop();
});

test("stopping aborts a request and prevents responses or further polling", async () => {
  const timer = clock();
  let signal: AbortSignal | undefined;
  let resolve!: (response: Response) => void;
  const loader = createReleaseFeedLoader({
    request: (_url, init) => { signal = init?.signal as AbortSignal; return new Promise<Response>(done => { resolve = done; }); },
    onResponse: () => assert.fail("unmounted response"), onError: () => assert.fail("unmounted error"), schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); loader.stop(); resolve(payload()); await settle();
  assert.equal(signal?.aborted, true); assert.deepEqual(timer.delays(), []);
});

test("temporary poll failures do not replace the last successful response", async () => {
  const timer = clock();
  const received: unknown[] = [];
  let errors = 0;
  let calls = 0;
  const loader = createReleaseFeedLoader({
    request: async () => { calls++; if (calls === 2) throw new Error("temporary"); return payload(calls === 1 ? "stale" : "current", [{ id: "kept" }]); },
    onResponse: value => received.push(value), onError: () => { errors++; }, schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); await settle(); timer.advance(4000); await settle();
  assert.equal(received.length, 1); assert.equal(errors, 1); assert.deepEqual(timer.delays(), [4000]);
  timer.advance(4000); await settle(); assert.equal(received.length, 2); assert.deepEqual(timer.delays(), []);
  loader.stop();
});

test("invalid success JSON becomes a retryable error instead of endless loading", async () => {
  const timer = clock(); let errors = 0;
  const loader = createReleaseFeedLoader({ request: async () => Response.json({ sources: {} }), onResponse: () => assert.fail(), onError: () => { errors++; }, schedule: timer.schedule, cancel: timer.cancel });
  loader.start(); await settle(); assert.equal(errors, 1); assert.deepEqual(timer.delays(), [4000]); loader.stop();
});

test("finished failed collections keep their cached response and stop automatic polling", async () => {
  const timer = clock(); const received: unknown[] = [];
  const loader = createReleaseFeedLoader({
    request: async () => Response.json({ releases: [{ id: "kept" }], collection: { status: "failed", message: "failed", pendingSources: 0 } }),
    onResponse: value => received.push(value), onError: () => assert.fail(), schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); await settle(); assert.equal(received.length, 1); assert.deepEqual(timer.delays(), []); loader.stop();
});

test("a structured 503 with a terminal empty collection is consumed and stops polling", async () => {
  const timer = clock(); const received: unknown[] = []; let errors = 0;
  const loader = createReleaseFeedLoader({
    request: async () => Response.json({ releases: [], collection: { status: "failed", message: "unavailable", pendingSources: 0 } }, { status: 503 }),
    onResponse: value => received.push(value), onError: () => { errors++; }, schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); await settle(); assert.equal(errors, 0); assert.equal(received.length, 1); assert.deepEqual(timer.delays(), []); loader.stop();
});

test("generic and nonterminal 503 failures remain retryable errors", async () => {
  for (const body of [
    { error: "unavailable" },
    { releases: [], collection: { status: "failed", pendingSources: 1 } },
    { releases: [], collection: { status: "current", pendingSources: 0 } },
    { releases: [], collection: { status: "failed" } },
  ]) {
    const timer = clock(); let errors = 0;
    const loader = createReleaseFeedLoader({
      request: async () => Response.json(body, { status: 503 }), onResponse: () => assert.fail("invalid terminal payload"),
      onError: () => { errors++; }, schedule: timer.schedule, cancel: timer.cancel,
    });
    loader.start(); await settle(); assert.equal(errors, 1); assert.deepEqual(timer.delays(), [4000]); loader.stop();
  }
});

test("repeated network failures back off without discarding the cached data", async () => {
  const timer = clock(); let calls = 0; const received: unknown[] = [];
  const loader = createReleaseFeedLoader({
    request: async () => { calls++; if (calls > 1) throw new Error("temporary"); return payload("stale", [{ id: "kept" }]); },
    onResponse: value => received.push(value), onError: () => {}, schedule: timer.schedule, cancel: timer.cancel,
  });
  loader.start(); await settle(); timer.advance(4000); await settle(); assert.deepEqual(timer.delays(), [4000]);
  timer.advance(4000); await settle(); assert.deepEqual(timer.delays(), [8000]);
  timer.advance(8000); await settle(); assert.deepEqual(timer.delays(), [16000]);
  timer.advance(16000); await settle(); assert.deepEqual(timer.delays(), [30000]);
  assert.equal(received.length, 1); loader.stop();
});

test("unconfirmed zero counts show a dash while existing counts remain visible", () => {
  assert.equal(releaseFeedCountLabel(0, false), "—");
  assert.equal(releaseFeedCountLabel(0, false, true), "—");
  assert.equal(releaseFeedCountLabel(0, true, true), "00");
  assert.equal(releaseFeedCountLabel(4, false), "4");
  assert.equal(releaseFeedCountLabel(4, false, true), "04");
});
