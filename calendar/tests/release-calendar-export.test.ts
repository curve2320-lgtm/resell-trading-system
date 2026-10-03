import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseCalendar, releaseCalendarEventCount, type ReleaseExportInput } from "../app/release-calendar-export.ts";

const generatedAt = "2026-10-04T03:00:00Z";
const base: ReleaseExportInput = {
  id: "cached:example", title: "스니커즈 기능 검증", category: "선착순", releaseDate: "2026-10-04", releaseTime: "10:00",
  retailer: "Nike", productUrl: "https://www.nike.com/kr/launch/t/example",
};
const unfold = (value: string) => value.replace(/\r\n[ \t]/g, "");

test("monthly export includes a prior-month raffle's deadline and excludes its old opening",()=>{
  const release={...base,category:"응모",releaseDate:"2026-09-30",startAt:"2026-09-30T10:00:00+09:00",endAt:"2026-10-02T18:00:00+09:00",announcementAt:"2026-10-03T12:00:00+09:00"};
  const text=unfold(createReleaseCalendar([release],{generatedAt,month:"2026-10"}));
  assert.equal((text.match(/BEGIN:VEVENT/g)??[]).length,2);
  assert.doesNotMatch(text,/DTSTART:20260930/);
});
test("repeated releases from one retailer retain their independent calendar events",()=>{
  const text=createReleaseCalendar([{...base,channels:[{externalId:"first",sourceKey:"nike",retailer:"Nike",releaseDate:"2026-10-04",releaseTime:"10:00",productUrl:base.productUrl},{externalId:"second",sourceKey:"nike",retailer:"Nike",releaseDate:"2026-10-05",releaseTime:"11:00",productUrl:base.productUrl}]}],{generatedAt});
  assert.equal((text.match(/BEGIN:VEVENT/g)??[]).length,2);
});

test("month scope uses each event's Korean date including UTC month boundaries", () => {
  const release = {...base, category:"응모", releaseDate:"2026-09-30", startAt:"2026-09-30T01:00:00Z", endAt:"2026-09-30T16:00:00Z"};
  const text = createReleaseCalendar([release], {generatedAt, month:"2026-10"});
  assert.equal(releaseCalendarEventCount([release], {month:"2026-10"}), 1);
  assert.match(text, /DTSTART:20260930T160000Z/);
  assert.doesNotMatch(text, /DTSTART:20260930T010000Z/);
  assert.throws(() => createReleaseCalendar([base], {generatedAt, month:"2026-13"}));
});

test("repeated retailer drops without external IDs use URL and schedule identity", () => {
  const release = {...base, channels:[
    {sourceKey:"nike", retailer:"Nike", releaseDate:"2026-10-04", releaseTime:"10:00", productUrl:base.productUrl},
    {sourceKey:"nike", retailer:"Nike", releaseDate:"2026-10-05", releaseTime:"11:00", productUrl:base.productUrl},
  ]};
  assert.equal(releaseCalendarEventCount([release]), 2);
});

test("channel raffle metadata preserves every opening, deadline and announcement", () => {
  const release = {...base, category:"응모", startAt:"2026-10-01T09:00:00+09:00", channels:[
    {externalId:"nike-raffle",sourceKey:"nike",retailer:"Nike",releaseDate:"2026-10-02",releaseTime:"10:00",startAt:"2026-10-01T09:00:00+09:00",endAt:"2026-10-02T10:00:00+09:00",announcementAt:"2026-10-03T12:00:00+09:00",productUrl:base.productUrl},
    {externalId:"tune-raffle",sourceKey:"tune",retailer:"TUNE",releaseDate:"2026-10-04",releaseTime:null,startAt:"2026-10-02T10:00:00+09:00",endAt:"2026-10-04T00:00:00+09:00",endTimeUnknown:true,announcementAt:"2026-10-05T12:00:00+09:00",productUrl:"https://tune.kr/product/example"},
  ]};
  const text = unfold(createReleaseCalendar([release], {generatedAt,month:"2026-10"}));
  assert.equal(releaseCalendarEventCount([release], {month:"2026-10"}), 6);
  assert.match(text, /SUMMARY:스니커즈 기능 검증 · TUNE · 응모 마감/);
  assert.match(text, /DTSTART;VALUE=DATE:20261004/);
  assert.equal((text.match(/ · 당첨 발표/g) ?? []).length, 2);
});

test("explicit channel IDs keep their UID across schedule corrections", () => {
  const channel={externalId:"stable",sourceKey:"nike",retailer:"Nike",releaseDate:"2026-10-04",releaseTime:"10:00",productUrl:base.productUrl};
  const first=unfold(createReleaseCalendar([{...base,channels:[channel]}], {generatedAt}));
  const next=unfold(createReleaseCalendar([{...base,channels:[{...channel,releaseDate:"2026-10-05"}]}], {generatedAt}));
  assert.equal(first.match(/UID:(.+)\r\n/)?.[1], next.match(/UID:(.+)\r\n/)?.[1]);
});

test("monthly export scopes independently expanded retailer raffle schedules", () => {
  const release={...base,category:"응모",releaseDate:"2026-09-30",channels:[
    {externalId:"previous-month",sourceKey:"nike",retailer:"Nike",releaseDate:"2026-09-30",releaseTime:"10:00",startAt:"2026-09-29T10:00:00+09:00",endAt:"2026-10-02T10:00:00+09:00",announcementAt:"2026-11-01T12:00:00+09:00",productUrl:base.productUrl},
    {externalId:"current-month",sourceKey:"tune",retailer:"TUNE",releaseDate:"2026-10-02",releaseTime:"11:00",startAt:"2026-10-02T11:00:00+09:00",endAt:"2026-10-05T18:00:00+09:00",announcementAt:"2026-11-02T12:00:00+09:00",productUrl:"https://tune.kr/product/example"},
  ]};
  const text=unfold(createReleaseCalendar([release],{generatedAt,month:"2026-10"}));
  assert.equal(releaseCalendarEventCount([release],{month:"2026-10"}),3);
  assert.match(text,/SUMMARY:스니커즈 기능 검증 · Nike · 응모 마감/);
  assert.match(text,/SUMMARY:스니커즈 기능 검증 · TUNE · 응모 시작/);
  assert.match(text,/SUMMARY:스니커즈 기능 검증 · TUNE · 응모 마감/);
  assert.doesNotMatch(text,/Nike · 응모 시작| · 당첨 발표/);
});

test("export converts Korean time into UTC", () => {
  const text = createReleaseCalendar([base], {generatedAt});
  assert.match(text, /DTSTART:20261004T010000Z\r\n/);
  assert.match(text, /DTSTAMP:20261004T030000Z\r\n/);
  assert.match(text, /URL:https:\/\/www.nike.com\/kr\/launch\/t\/example/);
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
});
test("unknown time is all-day with an exclusive end over the year boundary", () => {
  const text = createReleaseCalendar([{...base, releaseDate:"2026-12-31", releaseTime:null}], {generatedAt});
  assert.match(text, /DTSTART;VALUE=DATE:20261231/);
  assert.match(text, /DTEND;VALUE=DATE:20270101/);
  assert.doesNotMatch(text, /DTSTART:20261231T/);
  assert.match(unfold(text), /시간 미정/);
});
test("raffle start and closing remain separate and unknown end is not fabricated", () => {
  const release = {...base, category:"응모", startAt:"2026-10-04T10:00:00+09:00", endAt:"2026-10-05T00:00:00+09:00", endTimeUnknown:true};
  const text = unfold(createReleaseCalendar([release], {generatedAt}));
  assert.equal(releaseCalendarEventCount([release]), 2);
  assert.match(text, /SUMMARY:스니커즈 기능 검증 · 응모 시작/);
  assert.match(text, /SUMMARY:스니커즈 기능 검증 · 응모 마감/);
  assert.match(text, /DTSTART:20261004T010000Z/);
  assert.match(text, /DTSTART;VALUE=DATE:20261005/);
  assert.doesNotMatch(text, /DTSTART:20261004T150000Z/);
});
test("different retailer times survive export and duplicate input is deduplicated", () => {
  const release = {...base, channels:[
    {sourceKey:"nike", retailer:"Nike", releaseDate:"2026-10-04", releaseTime:"10:00", productUrl:base.productUrl},
    {sourceKey:"tune", retailer:"TUNE", releaseDate:"2026-10-04", releaseTime:"11:00", productUrl:"https://tune.kr/product/example"},
  ]};
  const text = createReleaseCalendar([release,release], {generatedAt});
  assert.equal(releaseCalendarEventCount([release,release]), 2);
  assert.match(text, /DTSTART:20261004T010000Z/);
  assert.match(text, /DTSTART:20261004T020000Z/);
  assert.equal(text.match(/BEGIN:VEVENT\r\n/g)?.length, 2);
});
test("UTF-8 folding respects 75 octets and text cannot inject properties", () => {
  const title = `${"한글발매 ".repeat(40)};가격,\\표시\nBEGIN:VEVENT\r\nATTENDEE:bad`;
  const text = createReleaseCalendar([{...base,title,note:"줄바꿈\n메모"}], {generatedAt});
  for(const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line,"utf8")<=75);
  const plain = unfold(text);
  assert.equal(plain.match(/BEGIN:VEVENT\r\n/g)?.length, 1);
  assert.match(plain, /\\;가격\\,\\\\표시\\nBEGIN:VEVENT\\nATTENDEE:bad/);
  assert.match(plain, /줄바꿈\\n메모/);
});
test("invalid dates are omitted and unsafe URLs are removed", () => {
  assert.equal(releaseCalendarEventCount([{...base,releaseDate:"2026-02-30"}]), 0);
  assert.equal(releaseCalendarEventCount([{...base,releaseTime:"25:00"}]), 0);
  assert.equal(releaseCalendarEventCount([{...base,category:"응모",startAt:"2026-10-04T10:00:00",releaseDate:""}]), 0);
  const text = createReleaseCalendar([{...base,productUrl:"javascript:alert(1)",sourceUrl:"https://nike.com.evil.test/"}], {generatedAt});
  assert.doesNotMatch(text, /javascript:|evil\.test/);
  assert.throws(()=>createReleaseCalendar([base], {generatedAt:"bad"}));
});
test("schedule changes retain UIDs and do not mutate input", () => {
  const input = structuredClone(base);
  const first = unfold(createReleaseCalendar([input], {generatedAt}));
  const second = unfold(createReleaseCalendar([{...input,releaseDate:"2026-10-05"}], {generatedAt}));
  assert.equal(first.match(/UID:(.+)\r\n/)?.[1],second.match(/UID:(.+)\r\n/)?.[1]);
  assert.deepEqual(input,base);
});



import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.ts";
import { readReleaseApiPayload, createCollectionRepositoryWithDb, type CollectionRepository, type ReviewItem, type CachedRelease } from "../app/collection/repository.ts";

function review(sourceKey: string, id = 1): ReviewItem {
  const release = {
    sourceKey, externalId: `item-${id}`, title: `${sourceKey} 미정 공지`, brand: "EXAMPLE",
    releaseDate: "", releaseTime: null, priceLabel: null, styleCode: null,
    productUrl: null, sourceUrl: sourceKey === "sns" ? "https://www.instagram.com/p/Example123/" : "https://www.nike.com/kr/launch/upcoming",
  };
  return { id, sourceKey, externalId: release.externalId, reason: "missing_date", status: "pending", payloadJson: JSON.stringify({release}) };
}

function repository(items: ReviewItem[], releases: CachedRelease[] = []): CollectionRepository {
  return {
    async listCachedReleases() { return releases; },
    async listSourceHealth() { return []; },
    async countPendingReviewItems() { return items.length; },
    async listPendingNikeMissingDateReviews() { throw new Error("general pending reader must win"); },
    async listPendingUndatedReviews() { return items; },
  } as CollectionRepository;
}

test("pending announcements are projected per source, including SNS with no product URL", async () => {
  const payload = await readReleaseApiPayload(repository([review("nike"), review("sns", 2)]), ["nike", "sns"]);
  assert.equal(payload.sources.nike.undated?.[0]?.title, "nike 미정 공지");
  assert.equal(payload.sources.sns.undated?.[0]?.sourceUrl, "https://www.instagram.com/p/Example123/");
  assert.equal(payload.sources.sns.undated?.[0]?.productUrl, null);
  assert.equal(payload.releases.length, 0);
});

test("old repositories retain the narrow Nike fallback contract", async () => {
  const input = repository([review("nike")]);
  delete input.listPendingUndatedReviews;
  input.listPendingNikeMissingDateReviews = async () => [review("nike")];
  const payload = await readReleaseApiPayload(input, ["nike", "asics"]);
  assert.equal(payload.sources.nike.undated?.length, 1);
  assert.equal(payload.sources.asics.undated, undefined);
});

test("pending projection is bounded and excludes mismatched, dated or resolved payloads", async () => {
  const rows = Array.from({length: 201}, (_, index) => review("nike", index));
  const payload = await readReleaseApiPayload(repository(rows));
  assert.equal(payload.sources.nike.undated?.length, 200);
  const dated = review("nike");
  const data = JSON.parse(dated.payloadJson);
  data.release.releaseDate = "2026-10-04";
  dated.payloadJson = JSON.stringify(data);
  const mismatched = { ...review("nike"), sourceKey: "asics" };
  const result = await readReleaseApiPayload(repository([dated, mismatched, {...review("nike"), status: "approved"}]));
  assert.equal(result.sources.nike.undated?.length, 0);
});

test("production missing-date read filters pending status and applies SQL limit 200", async () => {
  const captured: {sql: string; params: unknown[]}[] = [];
  const d1 = { prepare(sql: string) { return {
    bind(...params: unknown[]) { captured.push({sql, params}); return this; },
    async raw() { return []; },
  }; } };
  const db = drizzle(d1 as never, {schema});
  const input = createCollectionRepositoryWithDb(db);
  assert.equal(typeof input.listPendingUndatedReviews, "function");
  assert.deepEqual(await input.listPendingUndatedReviews!(), []);
  assert.equal(captured.length, 1);
  assert.match(captured[0].sql, /limit \?/);
  assert.deepEqual(captured[0].params, ["missing_date", "pending", 200]);
});

test("expanded overseas sources retain the primary channel region", async () => {
  const release: CachedRelease = {
    id: "example-overseas", canonicalKey: "example", title: "해외 발매", brand: "EXAMPLE",
    category: "sneakers", releaseKind: "general", releaseDate: "2026-10-04", releaseTime: "10:00",
    changedAt: null, lastVerifiedAt: "2026-10-04T00:00:00Z", channels: [{
      sourceKey: "atmosJP", retailer: "atmos 일본", productUrl: null, sourceUrl: null,
      priceLabel: null, releaseDate: "2026-10-04", releaseTime: "10:00",
    }],
  };
  const payload = await readReleaseApiPayload(repository([], [release]), ["atmosJP"]);
  assert.equal(payload.releases[0].region, "일본");
  assert.equal(payload.releases[0].marketScope, "overseas");
});

