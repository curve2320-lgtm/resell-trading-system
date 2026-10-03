import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REQUESTS_PER_SOURCE = 5;
const SAMPLE_PAST_DAYS = 30;
const SAMPLE_FUTURE_DAYS = 90;
const USER_AGENT = "ReleaseCalendarCandidateProbe/2.0 (read-only; no-auth)";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const candidateSources = [
  {
    key: "kith-seoul",
    name: "Kith Seoul News",
    url: "https://kr.kith.com/blogs/news",
    allowedHosts: ["kr.kith.com"],
    kind: "kith-news",
  },
  {
    key: "eql",
    name: "EQL",
    url: "https://www.eqlstore.com/main",
    allowedHosts: ["www.eqlstore.com"],
    kind: "retailer-page",
  },
  {
    key: "on-the-spot",
    name: "On The Spot",
    url: "https://www.onthespot.co.kr/?viewer=pc",
    allowedHosts: ["www.onthespot.co.kr"],
    kind: "retailer-page",
  },
];

class SourceFailure extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function normalizeText(value) {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeKey(value) {
  return value.toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, "");
}

function sampleWindow(now) {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - SAMPLE_PAST_DAYS);
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + SAMPLE_FUTURE_DAYS);
  return { start, end };
}

function validUtcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function parseCandidateDate(value) {
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const english = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/iu,
  );
  if (english) {
    return validUtcDate(Number(english[3]), months[english[1].toLowerCase()], Number(english[2]));
  }

  const korean = value.match(/\b(20\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})\b/u);
  return korean ? validUtcDate(Number(korean[1]), Number(korean[2]), Number(korean[3])) : null;
}

function stripDateText(value) {
  return value
    .replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/giu, "")
    .replace(/\b20\d{2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}\b/gu, "")
    .trim();
}

function matchedRejectedMarker(html) {
  const text = normalizeText(html);
  const koreanMarkers = [
    ["bot-captcha-ko", /(?:\uCEA1\uCC28|\uCEA1\uCC60)/u],
    ["bot-challenge-ko", /(?:\uC0AC\uB78C\uC778\uC9C0\s*\uD655\uC778|\uBE0C\uB77C\uC6B0\uC800\uB97C\s*\uD655\uC778|\uC811\uC18D\uC744\s*\uD655\uC778)/u],
    ["consent-required-ko", /(?:\uB3D9\uC758.*(?:\uD544\uC694|\uC694\uCCAD)|\uAC1C\uC778\uC815\uBCF4.*\uB3D9\uC758)/u],
    ["access-denied-ko", /(?:\uC811\uADFC.*\uAC70\uBD80|\uAD8C\uD55C.*\uC5C6\uC74C|\uCC28\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4)/u],
    ["error-page-ko", /(?:\uC11C\uBE44\uC2A4.*\uC624\uB958|\uC77C\uC2DC\uC801.*\uC624\uB958|\uC11C\uBC84.*\uC624\uB958)/u],
  ];
  const koreanMarker = koreanMarkers.find(([, pattern]) => pattern.test(text));
  if (koreanMarker) return koreanMarker[0];
  const markers = [
    ["bot-captcha", /(?:captcha|recaptcha|hcaptcha)/iu],
    ["bot-captcha-ko", /(?:캡차|캡챠)/u],
    ["bot-challenge", /(?:verify you are human|just a moment|checking your browser|security check)/iu],
    ["bot-challenge-ko", /(?:사람인지 확인|브라우저를 확인|접속을 확인)/u],
    ["consent-required", /(?:consent required|cookie consent|privacy consent)/iu],
    ["consent-required-ko", /(?:동의.*(?:필요|요청)|개인정보.*동의)/u],
    ["access-denied", /(?:access denied|forbidden|request blocked)/iu],
    ["access-denied-ko", /(?:접근.*거부|권한.*없|차단되었습니다)/u],
    ["error-page", /(?:error\s*5\d\d|internal server error|temporarily unavailable|service unavailable)/iu],
    ["error-page-ko", /(?:서비스.*오류|일시적.*오류|서버.*오류)/u],
  ];
  return markers.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

function markerPatternForCode(code) {
  if (code === "bot-captcha-ko") return /(?:\uCEA1\uCC28|\uCEA1\uCC60)/u;
  if (code === "bot-challenge-ko") return /(?:\uC0AC\uB78C\uC778\uC9C0\s*\uD655\uC778|\uBE0C\uB77C\uC6B0\uC800\uB97C\s*\uD655\uC778|\uC811\uC18D\uC744\s*\uD655\uC778)/u;
  if (code === "consent-required-ko") return /(?:\uB3D9\uC758.*(?:\uD544\uC694|\uC694\uCCAD)|\uAC1C\uC778\uC815\uBCF4.*\uB3D9\uC758)/u;
  if (code === "access-denied-ko") return /(?:\uC811\uADFC.*\uAC70\uBD80|\uAD8C\uD55C.*\uC5C6\uC74C|\uCC28\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4)/u;
  if (code === "error-page-ko") return /(?:\uC11C\uBE44\uC2A4.*\uC624\uB958|\uC77C\uC2DC\uC801.*\uC624\uB958|\uC11C\uBC84.*\uC624\uB958)/u;
  if (code?.startsWith("bot-captcha")) return /(?:captcha|recaptcha|hcaptcha)/iu;
  if (code?.startsWith("bot-challenge")) return /(?:verify you are human|just a moment|checking your browser|security check)/iu;
  if (code?.startsWith("consent-required")) return /(?:consent required|cookie consent|privacy consent)/iu;
  if (code?.startsWith("access-denied")) return /(?:access denied|forbidden|request blocked)/iu;
  if (code?.startsWith("error-page")) return /(?:error\s*5\d\d|internal server error|temporarily unavailable|service unavailable)/iu;
  return null;
}

function blockingEvidence(html) {
  const markerCode = matchedRejectedMarker(html);
  const markerPattern = markerPatternForCode(markerCode);
  if (!markerCode || !markerPattern) return null;

  const titleAndHeadings = normalizeText(
    [...html.matchAll(/<(?:title|h1|h2)\b[^>]*>([\s\S]{0,1000}?)<\/(?:title|h1|h2)>/giu)]
      .map((match) => match[1])
      .join(" "),
  );
  if (markerPattern.test(titleAndHeadings)) return markerCode;
  if (/<(?:form|main|section|div)\b[^>]*(?:id|class)=(?:"[^"]*(?:captcha|challenge|consent|access|block)[^"]*"|'[^']*(?:captcha|challenge|consent|access|block)[^']*')[^>]*>/iu.test(html)) {
    return markerCode;
  }

  const visibleText = normalizeText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/giu, " "),
  );
  const markerText = visibleText.match(markerPattern)?.[0] ?? "";
  return visibleText.length > 0 && visibleText.length <= 2_000 && markerText.length / visibleText.length >= 0.6
    ? markerCode
    : null;
}

function safeReportUrl(url) {
  return `${url.origin}${url.pathname}`;
}

function normalizeOfficialUrl(url) {
  const normalized = new URL(url);
  normalized.hash = "";
  for (const key of [...normalized.searchParams.keys()]) {
    if (/^(?:utm_.+|fbclid|gclid)$/iu.test(key)) normalized.searchParams.delete(key);
  }
  normalized.searchParams.sort();
  return normalized.href;
}

function parseOfficialUrl(value, baseUrl, source, code = "unsafe-url") {
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch {
    throw new SourceFailure(code, "Location is not a valid URL.");
  }
  const allowedHosts = new Set(source.allowedHosts.map((host) => host.toLowerCase()));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw new SourceFailure(code, "URL is outside the explicit HTTPS official-host boundary.");
  }
  return url;
}

function tryOfficialUrl(value, baseUrl, source) {
  try {
    return parseOfficialUrl(value, baseUrl, source);
  } catch {
    return null;
  }
}

function requestDetails(url, requestCount, redirectCount, extra = {}) {
  return {
    finalUrl: safeReportUrl(url),
    finalHost: url.hostname,
    requestCount,
    redirectCount,
    httpStatus: null,
    contentType: "unavailable",
    ...extra,
  };
}

async function readLimitedText(response, details) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new SourceFailure("response-too-large", "Response exceeds the safety limit.", details);
  }
  if (!response.body) {
    throw new SourceFailure("response-body-unavailable", "Response body is unavailable.", details);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SourceFailure("response-too-large", "Response exceeds the safety limit.", details);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchOfficialPage(source, request = globalThis.fetch, options = {}) {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let current = parseOfficialUrl(source.url, source.url, source, "source-unsafe-url");
  const seen = new Set([normalizeOfficialUrl(current)]);
  let requestCount = 0;
  let redirectCount = 0;

  while (requestCount < MAX_REQUESTS_PER_SOURCE) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new SourceFailure("timeout", "Source deadline expired.", requestDetails(current, requestCount, redirectCount));
    }
    requestCount += 1;
    let response;
    try {
      response = await request(current.href, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
          "User-Agent": USER_AGENT,
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(remainingMs),
      });
    } catch (error) {
      const code = error instanceof Error && /^(?:AbortError|TimeoutError)$/u.test(error.name)
        ? "timeout"
        : "network-error";
      throw new SourceFailure(code, code === "timeout" ? "Request timed out." : "Network request failed.", requestDetails(current, requestCount, redirectCount));
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "unknown";
    const details = requestDetails(current, requestCount, redirectCount, {
      httpStatus: response.status,
      contentType,
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      redirectCount += 1;
      const location = response.headers.get("location");
      const redirectDetails = { ...details, redirectCount };
      if (!location) throw new SourceFailure("redirect-missing-location", "Redirect response has no Location header.", redirectDetails);
      let next;
      try {
        next = parseOfficialUrl(location, current.href, source, "redirect-unsafe-url");
      } catch (error) {
        if (error instanceof SourceFailure) error.details = redirectDetails;
        throw error;
      }
      const normalizedNext = normalizeOfficialUrl(next);
      if (seen.has(normalizedNext)) {
        throw new SourceFailure("redirect-loop", "Redirect loop detected.", redirectDetails);
      }
      if (requestCount >= MAX_REQUESTS_PER_SOURCE) {
        throw new SourceFailure("redirect-limit", "Redirect request limit reached.", redirectDetails);
      }
      seen.add(normalizedNext);
      current = next;
      continue;
    }

    if (!response.ok) throw new SourceFailure("http-status", "HTTP status was not successful.", details);
    if (!/^(?:text\/html|application\/xhtml\+xml)$/iu.test(contentType)) {
      throw new SourceFailure("unexpected-content-type", "Response is not HTML.", details);
    }
    return { ...details, html: await readLimitedText(response, details) };
  }

  throw new SourceFailure("redirect-limit", "Redirect request limit reached.", requestDetails(current, requestCount, redirectCount));
}

function extractOfficialAnchors(html, finalUrl, source) {
  const anchors = [];
  const anchorPattern = /<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]{0,2500}?)<\/a>/giu;
  for (const match of html.matchAll(anchorPattern)) {
    const url = tryOfficialUrl(match[1] ?? match[2] ?? "", finalUrl, source);
    if (!url) continue;
    anchors.push({
      url,
      normalizedUrl: normalizeOfficialUrl(url),
      text: normalizeText(match[3] ?? ""),
    });
  }
  return [...new Map(anchors.map((anchor) => [anchor.normalizedUrl, anchor])).values()];
}

function isRelevantAnchor(anchor, source) {
  const path = anchor.url.pathname;
  const text = anchor.text;
  if (/(?:lookbook|campaign|editorial|store guide|about|룩북|캠페인|에디토리얼|매장 안내)/iu.test(text)) return false;
  if (source.kind === "kith-news" && !/^\/blogs\/news\/[^/]+/u.test(path)) return false;
  return /(?:release|drop|launch|raffle|draw|calendar|schedule|entry|응모|래플|추첨|발매|출시|일정)/iu.test(text) ||
    /\/(?:products?|product|releases?|launch(?:es)?|raffles?|draws?|calendar|schedule|events?)(?:\/|$)/iu.test(path) ||
    /\b(?:style\s*(?:code|no)|sku)\b|\b[A-Z]{2,}[- ][A-Z0-9]{3,}\b/iu.test(text);
}

function rowIdentity(row) {
  const style = row.text.match(/\b[A-Z]{2,}[- ][A-Z0-9]{3,}\b/iu)?.[0];
  return `${normalizeKey(style ?? row.url.pathname)}:${row.date.toISOString().slice(0, 10)}`;
}

function emptyAssessment(structuralCode, structuralStatus = "structure-invalid") {
  return {
    structuralStatus,
    structuralCode,
    officialLinkVerified: false,
    officialLinkUrl: null,
    totalRelevantRows: 0,
    validInWindowCandidates: 0,
    malformedRelevantRows: 0,
    outOfWindowValidRows: 0,
    duplicateEstimate: null,
  };
}

export function assessSourceHtml(source, html, finalUrl, now = new Date()) {
  const anchors = extractOfficialAnchors(html, finalUrl, source);
  const relevantRows = anchors.filter((anchor) => isRelevantAnchor(anchor, source)).map((anchor) => {
    const date = parseCandidateDate(anchor.text);
    return { ...anchor, date, title: stripDateText(anchor.text) };
  });
  const validRows = relevantRows.filter((row) => row.title && row.date);
  const kithIndexValid = source.kind !== "kith-news" || /<h1\b[^>]*>\s*News\s*<\/h1>/iu.test(html);
  if (!kithIndexValid || validRows.length === 0) {
    const markerCode = blockingEvidence(html);
    if (markerCode) return emptyAssessment(markerCode, "blocked");
    return emptyAssessment(kithIndexValid ? "official-link-not-verified" : "kith-index-structure-missing");
  }

  const { start, end } = sampleWindow(now);
  const inWindow = validRows.filter(({ date }) => date >= start && date <= end);
  const identities = new Set(inWindow.map(rowIdentity));
  return {
    structuralStatus: "valid",
    structuralCode: "ok",
    officialLinkVerified: true,
    officialLinkUrl: safeReportUrl(validRows[0].url),
    totalRelevantRows: relevantRows.length,
    validInWindowCandidates: inWindow.length,
    malformedRelevantRows: relevantRows.length - validRows.length,
    outOfWindowValidRows: validRows.length - inWindow.length,
    duplicateEstimate: inWindow.length === 0 ? null : (inWindow.length - identities.size) / inWindow.length,
  };
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function threshold(value) {
  return value ? "PASS" : "FAIL";
}

function evaluateSource(result) {
  const { assessment } = result;
  const malformedRate = assessment.totalRelevantRows === 0
    ? null
    : assessment.malformedRelevantRows / assessment.totalRelevantRows;
  return {
    officialReleaseDateLink: assessment.officialLinkVerified,
    usefulCandidate: assessment.validInWindowCandidates > 0,
    malformedRate,
    malformedAtMostTenPercent: malformedRate !== null && malformedRate <= 0.1,
    duplicateAtMostSeventyPercent: assessment.duplicateEstimate !== null && assessment.duplicateEstimate <= 0.7,
    requestsAtMostFive: result.requestCount <= MAX_REQUESTS_PER_SOURCE,
  };
}

export async function probeSource(source, now = new Date(), request = globalThis.fetch, fetchOptions = {}) {
  let page;
  try {
    page = await fetchOfficialPage(source, request, fetchOptions);
  } catch (error) {
    if (!(error instanceof SourceFailure)) throw error;
    return {
      source,
      status: "source-error",
      errorCode: error.code,
      error: error.message,
      assessment: emptyAssessment(
        [403, 429, 503].includes(error.details.httpStatus) ? `http-${error.details.httpStatus}` : "not-assessed",
        [403, 429, 503].includes(error.details.httpStatus) ? "blocked" : "not-assessed",
      ),
      ...error.details,
    };
  }
  return {
    source,
    status: "measured",
    errorCode: null,
    error: null,
    httpStatus: page.httpStatus,
    contentType: page.contentType,
    finalUrl: page.finalUrl,
    finalHost: page.finalHost,
    requestCount: page.requestCount,
    redirectCount: page.redirectCount,
    assessment: assessSourceHtml(source, page.html, page.finalUrl, now),
  };
}

function printResult(result, log) {
  const checks = evaluateSource(result);
  const { assessment, source } = result;
  log(`\n${source.name}`);
  log(`  source status: ${result.status}`);
  log(`  HTTP status: ${result.httpStatus ?? "n/a"}`);
  log(`  content type: ${result.contentType}`);
  log(`  final URL: ${result.finalUrl ?? "n/a"}`);
  log(`  final host: ${result.finalHost ?? "n/a"}`);
  log(`  redirect count: ${result.redirectCount ?? 0}`);
  log(`  request count: ${result.requestCount ?? 0}`);
  log(`  structural status: ${assessment.structuralStatus} (${assessment.structuralCode})`);
  log(`  official release/date link: ${assessment.officialLinkVerified ? assessment.officialLinkUrl : "not verified"}`);
  log(`  total relevant rows: ${assessment.totalRelevantRows}`);
  log(`  valid in-window candidates: ${assessment.validInWindowCandidates}`);
  log(`  malformed relevant rows: ${assessment.malformedRelevantRows}`);
  log(`  out-of-window valid rows: ${assessment.outOfWindowValidRows}`);
  log(`  duplicate estimate: ${percent(assessment.duplicateEstimate)}`);
  if (result.errorCode) log(`  source error code: ${result.errorCode}`);
  log(`  threshold official release/date link: ${threshold(checks.officialReleaseDateLink)}`);
  log(`  threshold useful candidate: ${threshold(checks.usefulCandidate)}`);
  log(`  threshold malformed <= 10%: ${threshold(checks.malformedAtMostTenPercent)} (${percent(checks.malformedRate)})`);
  log(`  threshold estimated duplicates <= 70%: ${threshold(checks.duplicateAtMostSeventyPercent)} (${percent(assessment.duplicateEstimate)})`);
  log(`  threshold requests <= 5: ${threshold(checks.requestsAtMostFive)}`);
  log("  threshold three structurally successful independent runs: evaluated in the probe record");
  log("  decision: DO NOT ACTIVATE (measurement only)");
}

export async function runProbe(now = new Date(), options = {}) {
  const sources = options.sources ?? candidateSources;
  const request = options.request ?? globalThis.fetch;
  const log = options.log ?? console.log;
  const results = [];
  for (const source of sources) results.push(await probeSource(source, now, request));
  const { start, end } = sampleWindow(now);
  log(`Candidate-source probe at ${now.toISOString()}`);
  log(`Sample window: ${start.toISOString().slice(0, 10)} through ${end.toISOString().slice(0, 10)}`);
  log("Independent no-cache invocation: no D1 writes, response-body files, cookies, credentials, or activation.");
  for (const result of results) printResult(result, log);
  return results;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runProbe().catch((error) => {
    console.error("Probe logic failure:", error);
    process.exitCode = 1;
  });
}
