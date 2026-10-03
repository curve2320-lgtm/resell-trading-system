import assert from "node:assert/strict";
import test from "node:test";
import { collectionSlotKey } from "../app/collection/slots.ts";

test("maps Seoul time to the latest daily collection slot", () => {
  assert.equal(
    collectionSlotKey(new Date("2026-07-31T00:29:00.000Z")),
    "2026-07-31@07:30",
  );
  assert.equal(
    collectionSlotKey(new Date("2026-07-31T00:31:00.000Z")),
    "2026-07-31@09:30",
  );
  assert.equal(
    collectionSlotKey(new Date("2026-07-30T21:00:00.000Z")),
    "2026-07-30@22:30",
  );
});
