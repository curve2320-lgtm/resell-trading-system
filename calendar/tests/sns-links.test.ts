import assert from "node:assert/strict";
import test from "node:test";
import { safeRetailerUrl } from "../app/release-links.ts";
import {
  canonicalizeInstagramPostUrl,
  safeAnnouncementUrl,
} from "../app/sns-links.ts";

test("canonicalizes an Instagram post permalink and strips query tracking", () => {
  assert.equal(
    canonicalizeInstagramPostUrl(
      "https://www.instagram.com/p/ABC123/?igsh=tracking",
    ),
    "https://www.instagram.com/p/ABC123/",
  );
});

test("rejects login redirects, non-post paths, and non-Instagram hosts", () => {
  assert.equal(safeAnnouncementUrl("https://instagram.com/accounts/login/"), null);
  assert.equal(safeAnnouncementUrl("https://instagram.com/explore/"), null);
  assert.equal(safeAnnouncementUrl("https://example.com/p/ABC123/"), null);
  assert.equal(safeAnnouncementUrl("http://instagram.com/p/ABC123/"), null);
});

test("does not make Instagram a safe retailer CTA", () => {
  assert.equal(safeRetailerUrl("https://www.instagram.com/p/ABC123/"), null);
});

