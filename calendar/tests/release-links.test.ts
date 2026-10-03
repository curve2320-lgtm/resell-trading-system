import assert from "node:assert/strict";
import test from "node:test";
import * as releaseLinks from "../app/release-links.ts";
import { safeRetailerUrl } from "../app/release-links.ts";

test("retailer URL validator accepts configured hosts and their subdomains", () => {
  assert.equal(
    safeRetailerUrl("https://www.nike.com/kr/launch/t/example"),
    "https://www.nike.com/kr/launch/t/example",
  );
  assert.equal(
    safeRetailerUrl("https://grandstage.a-rt.com/display/calendar"),
    "https://grandstage.a-rt.com/display/calendar",
  );
  assert.equal(
    safeRetailerUrl("https://news.adidas.com/releases/example"),
    "https://news.adidas.com/releases/example",
  );
  assert.equal(
    safeRetailerUrl(
      "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
    ),
    "https://www.thenorthfacekorea.co.kr/product/NS97S22B",
  );
  assert.equal(
    safeRetailerUrl(
      "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=1",
    ),
    "https://palaceskateboards.seoul.kr/waitingStore?waitingStoreId=1",
  );
});

test("retailer URL validator rejects unsafe schemes, credentials, and ports", () => {
  for (const value of [
    "http://www.nike.com/kr/launch",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:pass@www.nike.com/kr/launch",
    "https://www.nike.com:8443/kr/launch",
  ]) {
    assert.equal(safeRetailerUrl(value), null, value);
  }
});

test("retailer URL validator rejects malformed and lookalike hosts", () => {
  for (const value of [
    "not a URL",
    "https://nike.com.evil.test/launch",
    "https://evilnike.com/launch",
    "https://a-rt.com.evil.test/calendar",
    "",
  ]) {
    assert.equal(safeRetailerUrl(value), null, value);
  }
  assert.equal(safeRetailerUrl(null), null);
  assert.equal(safeRetailerUrl(undefined), null);
});

test("release destination ignores an unsafe product URL and falls back safely", () => {
  const releaseDestination = (
    releaseLinks as {
      releaseDestination?: (release: {
        productUrl?: string | null;
        sourceUrl?: string | null;
      }) => string | null;
    }
  ).releaseDestination;
  assert.equal(typeof releaseDestination, "function");
  assert.equal(
    releaseDestination!({
      productUrl: "javascript:alert(1)",
      sourceUrl: "https://www.nike.com/kr/launch/upcoming",
    }),
    "https://www.nike.com/kr/launch/upcoming",
  );
  assert.equal(
    releaseDestination!({
      productUrl: "data:text/html,unsafe",
      sourceUrl: "https://nike.com.evil.test/source",
    }),
    null,
  );
});
