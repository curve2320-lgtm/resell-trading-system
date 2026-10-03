import assert from "node:assert/strict";
import test from "node:test";
import {
  createSibnaAdapter,
  parseSibnaCalendar,
  parseSibnaRss,
} from "../app/collection/sibna-adapter.ts";

const now = new Date("2026-10-04T02:00:00Z");
const post = (id: number, title: string) => `https://sibna.kr/today/post/${id}-${encodeURIComponent(title)}`;
const item = (id: number, title: string, description: string, url = post(id, title)) =>
  `<item><title><![CDATA[${title}]]></title><link>${url}</link><guid isPermaLink="false">today-release-${id}</guid><description><![CDATA[${description}]]></description><pubDate>Tue, 08 Sep 2026 11:32:52 +0900</pubDate></item>`;
const rss = (...items: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>SIBNA TODAY 발매정보 RSS</title>${items.join("")}</channel></rss>`;
const calendar = (data: unknown) => `<script id="calendarPanelData" type="application/json">${JSON.stringify(data)}</script>`;
const row = (id: number, title: string, time: string, method = "선착순") => ({id,title,time,method,url:post(id,title)});

test("SIBNA RSS uses supplied release facts and excludes the live feed's food and economy noise", () => {
  const parsed = parseSibnaRss(rss(
    item(1590,"매월 11일 KFC 1+1 치킨올데이","<p>발매일 2029-08-08 · 진행방식 선착순</p>"),
    item(1552,"미국 주식 휴장일 (크리스마스)","<p>발매일 2026-12-25 · 진행방식 선착순</p>"),
    item(1275,"Asics X INVINCIBLE X MADNESS GEL-KAYANO 12.1","<p>발매일 2026-12-01 · 발매시간 09:30 · 진행방식 선착순</p>"),
    item(1513,"레고® 슈퍼 마리오™ #72052 마리오의 토관 점프 14,900 원","<p>발매일 2027-01-01 · 발매시간 00:00 · 진행방식 선착순</p>"),
  ),now);
  assert.equal(parsed.recognized,true);
  assert.equal(parsed.filtered,2);
  assert.deepEqual(parsed.releases.map(r=>[r.externalId,r.releaseDate,r.releaseTime]),[["sibna:1275","2026-12-01","09:30"],["sibna:1513","2027-01-01","00:00"]]);
  assert.equal(parsed.releases[1].styleCode,"72052");
  assert.equal(parsed.releases[1].priceLabel,"14,900원");
  assert.match(parsed.releases[0].note ?? "",/SIBNA/);
});

test("an RSS publication date never supplies a missing or impossible release date", () => {
  const parsed = parseSibnaRss(rss(
    item(1,"DOSSY 한정 피규어 공개","<p>진행방식 선착순</p>"),
    item(2,"Nike 한정 신발","<p>발매일 2026-02-31 · 발매시간 10:00 · 진행방식 선착순</p>"),
  ),now);
  assert.deepEqual(parsed.releases.map(r=>r.releaseDate),["",""]);
  assert.equal(parsed.releases[0].releaseTime,null);
});

test("RSS XML entities are decoded while hostile and non-post source URLs are rejected", () => {
  const parsed = parseSibnaRss(rss(
    item(1,"Nike &amp; NOAH 한정 상품","발매일 2026-10-08 · 진행방식 선착순"),
    item(2,"Nike shoe","발매일 2026-10-08 · 진행방식 선착순","https://sibna.kr.evil.test/today/post/2-test"),
    item(3,"Nike shoe","발매일 2026-10-08 · 진행방식 선착순","https://sibna.kr/today/login.php"),
    item(4,"Nike shoe","발매일 2026-10-08 · 진행방식 선착순","https://user:pass@sibna.kr/today/post/4-test"),
  ),now);
  assert.equal(parsed.releases.length,1);
  assert.equal(parsed.releases[0].title,"Nike & NOAH 한정 상품");
  assert.equal(parsed.malformed,3);
});

test("calendar facts preserve a raffle crossing month boundaries and deduplicate repeated daily rows", () => {
  const raffle = row(1888,"포켓몬카드 게임 MEGA 30주년 BOX 추첨안내","9/29 10:00 ~ 10/5 14:59","응모");
  raffle.url += "?from=calendar&month=2026-10";
  const parsed = parseSibnaCalendar(calendar({"2026-10-01":{items:[raffle]},"2026-10-02":{items:[raffle]}}),now);
  assert.equal(parsed.releases.length,1);
  const release = parsed.releases[0];
  assert.equal(release.releaseDate,"2026-09-29");
  assert.equal(release.releaseTime,"10:00");
  assert.equal(release.startAt,"2026-09-29T10:00:00+09:00");
  assert.equal(release.endAt,"2026-10-05T14:59:00+09:00");
  assert.equal(release.releaseKindHint,"raffle");
  assert.equal(release.productUrl,post(1888,raffle.title));
});

test("period dates resolve December to January and retain unknown times without midnight guesses", () => {
  const parsed = parseSibnaCalendar(calendar({"2027-01-01":{items:[row(3,"포켓몬 한정 BOX","12/29 미정 ~ 1/5 미정","응모")]}}),now);
  const release = parsed.releases[0];
  assert.equal(release.releaseDate,"2026-12-29");
  assert.equal(release.releaseTime,null);
  assert.equal(release.startAt,"2026-12-29");
  assert.equal(release.endAt,"2027-01-05");
  assert.equal(release.startTimeUnknown,true);
  assert.equal(release.endTimeUnknown,true);
});

test("eligible indie goods, store launches, gadgets, collectible metals and TCG survive broad product filtering", () => {
  const parsed = parseSibnaCalendar(calendar({"2026-10-01":{items:[
    row(1,"DOSSY with 복심이","미정","정보"),
    row(2,"마똉킴 중국 베이징 오픈","미정","정보"),
    row(3,"iPhone Duo 사전 주문","21:00"),
    row(4,"한국 조폐공사 양의 해 실버바 1,000g","10:00"),
    row(5,"이마트24 포켓몬 30주년 카드 입고","10/1 미정 ~ 10/3 미정"),
    row(6,"인디 브랜드 첫 제품","12:00"),
  ]}}),now);
  assert.equal(parsed.releases.length,6);
  assert.deepEqual(parsed.releases.map(r=>r.categoryHint),["lifestyle","fashion","lifestyle","lifestyle","lifestyle","fashion"]);
  assert.equal(parsed.releases[1].releaseKindHint,"offline");
});

test("clear non-product calendar noise is removed despite first-come metadata", () => {
  const titles=["매월 11일 KFC 치킨올데이","맥도날드 신제품 출시","9월분 세금계산서 마감일","웨일폴 영화개봉","하현상 단독 콘서트","유럽 서머타임 해제일","여행 특가 항공권","29cm 29데이 쿠폰 할인","해리포터 공식 러닝 in 부산","피카츄의 가을 나들이 : 퍼레이드"];
  const parsed=parseSibnaCalendar(calendar({"2026-10-01":{items:titles.map((title,i)=>row(i+1,title,"10:00"))}}),now);
  assert.deepEqual(parsed.releases,[]);
  assert.equal(parsed.filtered,titles.length);
});

test("a generic retailer promotion without a product is not a release", () => {
  const parsed=parseSibnaCalendar(calendar({"2026-10-29":{items:[row(1,"29cm 29데이","미정")]}}),now);
  assert.deepEqual(parsed.releases,[]);
});

test("explicit RSS raffle deadlines and result announcements retain their independent timestamps", () => {
  const parsed=parseSibnaRss(rss(item(1,"포켓몬 한정 BOX 추첨","발매일 2026-10-05 · 진행방식 응모 · 응모 시작 2026-09-29 10:00 · 응모 마감 2026-10-05 14:59 · 당첨자 발표 2026-10-09 12:00")),now);
  const release=parsed.releases[0];
  assert.equal(release.releaseDate,"2026-09-29");
  assert.equal(release.startAt,"2026-09-29T10:00:00+09:00");
  assert.equal(release.endAt,"2026-10-05T14:59:00+09:00");
  assert.equal(release.announcementAt,"2026-10-09T12:00:00+09:00");
});

test("a contradictory same-day period is not emitted as a confirmed closing time", () => {
  const parsed=parseSibnaCalendar(calendar({"2026-10-01":{items:[row(1,"포켓몬 한정 BOX","10/1 18:00 ~ 10/1 09:00","응모")]}}),now);
  assert.equal(parsed.releases[0].releaseDate,"2026-10-01");
  assert.equal(parsed.releases[0].releaseTime,null);
  assert.equal(parsed.releases[0].endAt,undefined);
});

test("a branded seasonal delivery remains a product while an ambiguous information post is excluded", () => {
  const parsed=parseSibnaCalendar(calendar({"2026-10-01":{items:[row(1,"스투시 한국","10:00"),row(2,"비전퀘스트","미정","정보"),row(3,"마인드 001 M / HQ4307-001","11:00")]}}),now);
  assert.deepEqual(parsed.releases.map(r=>r.title),["스투시 한국","마인드 001 M / HQ4307-001"]);
  assert.equal(parsed.releases[1].categoryHint,"sneakers");
  assert.equal(parsed.releases[1].styleCode,"HQ4307-001");
});

test("the bounded adapter fetches free RSS and the current plus next Seoul calendar months", async () => {
  const urls:string[]=[];
  const adapter=createSibnaAdapter(async(url)=>{urls.push(url);if(url.endsWith("rss.php"))return rss(item(8,"Nike SB 한정 발매","발매일 2026-10-08 · 진행방식 선착순"));return calendar({"2026-10-08":{items:[row(8,"Nike SB 한정 발매","10:00")]}});});
  const result=await adapter.collect(now);
  assert.deepEqual(urls.sort(),["https://sibna.kr/today/rss.php","https://sibna.kr/today/upcoming?month=2026-10","https://sibna.kr/today/upcoming?month=2026-11"]);
  assert.equal(result.status,"connected");
  assert.equal(result.releases.length,1);
  assert.equal(result.releases[0].releaseTime,"10:00");
  assert.equal(result.authoritativeSnapshot,false);
});

test("a failed supplement preserves successful feed data and reports limited coverage", async () => {
  const result=await createSibnaAdapter(async(url)=>{if(url.endsWith("rss.php"))return rss(item(1,"레고 한정 피규어","발매일 2026-11-01 · 진행방식 선착순"));throw new Error("HTTP 503");}).collect(now);
  assert.equal(result.status,"connected");
  assert.equal(result.releases.length,1);
  assert.equal(result.confirmedEmpty,false);
  assert.match(result.message,/일부|실패/);
  const failed=await createSibnaAdapter(async()=>{throw new Error("HTTP 403");}).collect(now);
  assert.equal(failed.status,"error");
  assert.deepEqual(failed.releases,[]);
});

test("unsupported feed or HTML challenge pages are not reported as connected empty releases", () => {
  assert.equal(parseSibnaRss("<title>Just a moment...</title>",now).recognized,false);
  assert.equal(parseSibnaCalendar("<title>Just a moment...</title>",now).recognized,false);
});

test("only explicit title locations set SIBNA market metadata and keep the supplied time", () => {
  const titles=["스투시 유럽","슈프림 드롭 (영국, 미국)","팔라스 싱가폴 오프라인 매장 오픈","마똉킴 중국 베이징 오픈","팔라스 드롭 (일본, 한국)","스투시 한국","Kith x New Balance","Limited figure Beijing launch","New Balance Made in UK 991v2","New Balance Made in USA 990v6"];
  const parsed=parseSibnaCalendar(calendar({"2026-10-01":{items:titles.map((title,index)=>row(index+1,title,"23:59"))}}),now);
  assert.deepEqual(parsed.releases.map(release=>[release.region,release.marketScope]),[
    ["유럽","overseas"],["영국·미국","overseas"],["싱가포르","overseas"],["중국","overseas"],
    ["일본·한국","korea"],["한국","korea"],[undefined,undefined],["중국","overseas"],[undefined,undefined],[undefined,undefined],
  ]);
  assert.equal(parsed.releases.every(release=>release.releaseTime==="23:59"),true);
});
