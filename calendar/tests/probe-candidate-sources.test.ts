import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSourceHtml,
  candidateSources,
  fetchOfficialPage,
  probeSource,
  runProbe,
} from "../scripts/probe-candidate-sources.mjs";

const NOW = new Date("2026-07-31T00:00:00.000Z");

function source(key: string) {
  const value = candidateSources.find((item) => item.key === key);
  assert.ok(value, `missing ${key} source`);
  return value;
}

function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

test("Kith counts only unique official release evidence and keeps malformed and old rows separate", () => {
  const assessment = assessSourceHtml(
    source("kith-seoul"),
    `
      <h1>News</h1>
      <a href="/blogs/news/seoul-raffle">Kith Seoul raffle <time>August 2, 2026</time></a>
      <a href="/blogs/news/seoul-raffle">Kith Seoul raffle duplicate <time>August 2, 2026</time></a>
      <a href="/blogs/news/summer-campaign">Summer campaign <time>August 3, 2026</time></a>
      <a href="/blogs/news/release-rules">Release rules</a>
      <a href="/blogs/news/bad-raffle">Raffle <time>February 31, 2026</time></a>
      <a href="/blogs/news/old-raffle">Raffle <time>May 1, 2026</time></a>
    `,
    "https://kr.kith.com/blogs/news",
    NOW,
  );

  assert.equal(assessment.structuralStatus, "valid");
  assert.equal(assessment.officialLinkVerified, true);
  assert.equal(assessment.totalRelevantRows, 4);
  assert.equal(assessment.validInWindowCandidates, 1);
  assert.equal(assessment.malformedRelevantRows, 2);
  assert.equal(assessment.outOfWindowValidRows, 1);
  assert.equal(assessment.duplicateEstimate, 0);
});

test("EQL verifies an official release anchor only from its fetched official HTML", () => {
  const assessment = assessSourceHtml(
    source("eql"),
    `
      <a href="/special/editorial">Summer editorial <time>August 2, 2026</time></a>
      <a href="/event/raffle-2026">Sneaker raffle entry <time>August 4, 2026</time></a>
      <a href="https://lookalike.example/event/raffle">Outside raffle <time>August 4, 2026</time></a>
    `,
    "https://www.eqlstore.com/main",
    NOW,
  );

  assert.equal(assessment.structuralStatus, "valid");
  assert.equal(assessment.officialLinkUrl, "https://www.eqlstore.com/event/raffle-2026");
  assert.equal(assessment.validInWindowCandidates, 1);
});

test("genuine challenge pages are blocked without exposing response text", () => {
  const assessment = assessSourceHtml(
    source("on-the-spot"),
    "<title>Checking your browser</title><main><h1>Verify you are human</h1></main>",
    "https://www.onthespot.co.kr/?viewer=pc",
    NOW,
  );

  assert.equal(assessment.structuralStatus, "blocked");
  assert.equal(assessment.structuralCode, "bot-challenge");
  assert.equal(assessment.officialLinkUrl, null);
});

test("Korean challenge headings are also contextual blocking evidence", () => {
  const assessment = assessSourceHtml(
    source("on-the-spot"),
    "<title>\uBE0C\uB77C\uC6B0\uC800\uB97C \uD655\uC778</title><main>\uC0AC\uB78C\uC778\uC9C0 \uD655\uC778</main>",
    "https://www.onthespot.co.kr/?viewer=pc",
    NOW,
  );

  assert.equal(assessment.structuralStatus, "blocked");
  assert.equal(assessment.structuralCode, "bot-challenge-ko");
});

test("valid release structure wins over incidental captcha and consent footer or script markers", () => {
  const assessment = assessSourceHtml(
    source("kith-seoul"),
    `
      <h1>News</h1>
      <a href="/blogs/news/seoul-raffle">Kith Seoul raffle <time>August 2, 2026</time></a>
      <footer>Cookie consent preferences and captcha support</footer>
      <script>window.hcaptcha = true;</script>
    `,
    "https://kr.kith.com/blogs/news",
    NOW,
  );

  assert.equal(assessment.structuralStatus, "valid");
  assert.equal(assessment.structuralCode, "ok");
});

test("genuine consent walls are blocked while weak marker-only pages are structure-invalid", () => {
  const consent = assessSourceHtml(
    source("eql"),
    "<title>Cookie Consent</title><form id='consent-form'><h1>Consent Required</h1></form>",
    "https://www.eqlstore.com/main",
    NOW,
  );
  assert.equal(consent.structuralStatus, "blocked");
  assert.equal(consent.structuralCode, "consent-required");

  const weak = assessSourceHtml(
    source("eql"),
    "<main>Our developer documentation mentions captcha integration.</main>",
    "https://www.eqlstore.com/main",
    NOW,
  );
  assert.equal(weak.structuralStatus, "structure-invalid");
  assert.equal(weak.structuralCode, "official-link-not-verified");
});

test("manual redirects count every hop and retain the validated final URL", async () => {
  const calls: string[] = [];
  let requestOptions: RequestInit | undefined;
  const request = async (url: string, options: RequestInit) => {
    calls.push(url);
    requestOptions = options;
    if (calls.length === 1) {
      return new Response(null, { status: 302, headers: { location: "/event/raffle" } });
    }
    return htmlResponse("<a href='/event/raffle'>Raffle <time>August 4, 2026</time></a>");
  };

  const page = await fetchOfficialPage(source("eql"), request);

  assert.deepEqual(calls, [
    "https://www.eqlstore.com/main",
    "https://www.eqlstore.com/event/raffle",
  ]);
  assert.equal(page.httpStatus, 200);
  assert.equal(page.redirectCount, 1);
  assert.equal(page.requestCount, 2);
  assert.equal(page.finalUrl, "https://www.eqlstore.com/event/raffle");
  assert.equal(page.finalHost, "www.eqlstore.com");
  assert.equal(requestOptions?.credentials, "omit");
  assert.equal(requestOptions?.redirect, "manual");
  assert.equal(requestOptions?.referrerPolicy, "no-referrer");
  assert.equal(new Headers(requestOptions?.headers).has("cookie"), false);
  assert.equal(new Headers(requestOptions?.headers).has("authorization"), false);
});

test("redirects reject cross-host destinations, credentials, loops, and the five-request cap as source data", async () => {
  const missingLocation = await probeSource(source("eql"), NOW, async () =>
    new Response(null, { status: 302 }),
  );
  assert.equal(missingLocation.errorCode, "redirect-missing-location");

  const crossHost = await probeSource(source("eql"), NOW, async () =>
    new Response(null, { status: 302, headers: { location: "https://evil.example/release" } }),
  );
  assert.equal(crossHost.status, "source-error");
  assert.equal(crossHost.errorCode, "redirect-unsafe-url");
  assert.equal(crossHost.requestCount, 1);

  const credentials = await probeSource(source("eql"), NOW, async () =>
    new Response(null, { status: 302, headers: { location: "https://user:pass@www.eqlstore.com/event" } }),
  );
  assert.equal(credentials.errorCode, "redirect-unsafe-url");

  const unsafePort = await probeSource(source("eql"), NOW, async () =>
    new Response(null, { status: 302, headers: { location: "https://www.eqlstore.com:8443/event" } }),
  );
  assert.equal(unsafePort.errorCode, "redirect-unsafe-url");

  let loopCall = 0;
  const loop = await probeSource(source("eql"), NOW, async () => {
    loopCall += 1;
    return new Response(null, {
      status: 302,
      headers: { location: loopCall === 1 ? "/event/one" : "/main" },
    });
  });
  assert.equal(loop.errorCode, "redirect-loop");
  assert.equal(loop.requestCount, 2);
  assert.equal(loop.redirectCount, 2);

  let capCall = 0;
  const cap = await probeSource(source("eql"), NOW, async () => {
    capCall += 1;
    return new Response(null, {
      status: 302,
      headers: { location: `/event/${capCall}` },
    });
  });
  assert.equal(cap.errorCode, "redirect-limit");
  assert.equal(cap.requestCount, 5);
  assert.equal(cap.redirectCount, 5);
});

test("candidate dates use real calendar boundaries and the duplicate formula uses product identity plus date", () => {
  const assessment = assessSourceHtml(
    source("eql"),
    `
      <a href="/product/a">SKU AB-123 raffle <time>July 1, 2026</time></a>
      <a href="/product/b">SKU AB-123 raffle <time>July 1, 2026</time></a>
      <a href="/product/c">Raffle <time>October 29, 2026</time></a>
      <a href="/product/d">Raffle <time>April 31, 2026</time></a>
      <a href="/product/e">Raffle <time>October 30, 2026</time></a>
    `,
    "https://www.eqlstore.com/main",
    NOW,
  );

  assert.equal(assessment.totalRelevantRows, 5);
  assert.equal(assessment.validInWindowCandidates, 3);
  assert.equal(assessment.malformedRelevantRows, 1);
  assert.equal(assessment.outOfWindowValidRows, 1);
  assert.equal(assessment.duplicateEstimate, 1 / 3);

  const zeroDenominator = assessSourceHtml(
    source("eql"),
    "<a href='/product/old'>Raffle <time>May 1, 2026</time></a>",
    "https://www.eqlstore.com/main",
    NOW,
  );
  assert.equal(zeroDenominator.duplicateEstimate, null);
});

test("timeout, response size, HTTP status, and content type failures are data and do not fail a probe run", async () => {
  const timeout = await probeSource(source("eql"), NOW, async () => {
    const error = new Error("aborted");
    error.name = "TimeoutError";
    throw error;
  });
  assert.equal(timeout.status, "source-error");
  assert.equal(timeout.errorCode, "timeout");
  assert.equal(timeout.httpStatus, null);

  const tooLarge = await probeSource(source("eql"), NOW, async () =>
    htmlResponse("small", 200, { "content-length": "1000001" }),
  );
  assert.equal(tooLarge.errorCode, "response-too-large");

  const overflow = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(600_000));
      controller.enqueue(new Uint8Array(600_000));
      controller.close();
    },
  });
  const streamedTooLarge = await probeSource(source("eql"), NOW, async () =>
    new Response(overflow, { status: 200, headers: { "content-type": "text/html" } }),
  );
  assert.equal(streamedTooLarge.errorCode, "response-too-large");

  const unavailable = await probeSource(source("eql"), NOW, async () =>
    htmlResponse("not available", 503),
  );
  assert.equal(unavailable.errorCode, "http-status");
  assert.equal(unavailable.httpStatus, 503);
  assert.equal(unavailable.assessment.structuralStatus, "blocked");
  assert.equal(unavailable.assessment.structuralCode, "http-503");

  const json = await probeSource(source("eql"), NOW, async () =>
    new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
  );
  assert.equal(json.errorCode, "unexpected-content-type");
  assert.equal(json.contentType, "application/json");

  const results = await runProbe(NOW, {
    sources: [source("eql")],
    request: async () => htmlResponse("unavailable", 503),
    log: () => {},
  });
  assert.equal(results[0]?.status, "source-error");
});

test("one source deadline covers every redirect hop", async () => {
  const ticks = [0, 0, 6_001];
  let requests = 0;
  const result = await probeSource(
    source("eql"),
    NOW,
    async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { location: "/event/next" } });
    },
    { now: () => ticks.shift() ?? 6_001 },
  );

  assert.equal(result.errorCode, "timeout");
  assert.equal(result.requestCount, 1);
  assert.equal(result.redirectCount, 1);
  assert.equal(requests, 1);
});
