import assert from "node:assert/strict";
import test from "node:test";
import {
  createSibnaAdapter,
  createSibnaCalendarAdapter,
  isSibnaCalendarMonth,
  parseSibnaCalendar,
  parseSibnaRss,
  sibnaCalendarWindow,
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

test("calendar history covers twelve prior and twelve following Seoul months with nearby months first", () => {
  const months=sibnaCalendarWindow(now);
  assert.equal(months.length,25);
  assert.deepEqual(months.slice(0,7),["2026-10","2026-09","2026-11","2026-08","2026-12","2026-07","2027-01"]);
  assert.equal(months.includes("2025-10"),true);
  assert.equal(months.includes("2027-10"),true);
  assert.equal(new Set(months).size,months.length);
  assert.equal(sibnaCalendarWindow(new Date("2026-12-31T16:00:00Z"),1,1)[0],"2027-01");
});

test("on-demand calendar months accept only real months within the provider's public navigation range", () => {
  assert.equal(isSibnaCalendarMonth("2021-01"),true);
  assert.equal(isSibnaCalendarMonth("2028-12"),true);
  for(const month of ["2020-12","2029-01","2026-13","2026-00","2026-1","2026-10&private=1","http://evil.test"])
    assert.equal(isSibnaCalendarMonth(month),false);
  assert.deepEqual(sibnaCalendarWindow(new Date("2021-01-01T00:00:00Z"),12,1),["2021-01","2021-02"]);
  assert.throws(()=>sibnaCalendarWindow(now,-1,1),/month|range/i);
  assert.throws(()=>sibnaCalendarWindow(now,13.5,1),/month|range/i);
});

test("a historical calendar job preserves the canonical source but claims a separate month and fetches only that month", async () => {
  const urls:string[]=[];
  const adapter=createSibnaCalendarAdapter("2026-09",async(url)=>{urls.push(url);return calendar({"2026-09-13":{items:[row(1791,"나이키 한정 신발","10:00")]}});});
  assert.equal(adapter.key,"sibna");
  assert.equal(adapter.collectionKey,"sibna:calendar:2026-09");
  const result=await adapter.collect(now);
  assert.deepEqual(urls,["https://sibna.kr/today/upcoming?month=2026-09"]);
  assert.equal(result.sourceKey,"sibna");
  assert.equal(result.releases[0].releaseDate,"2026-09-13");
  assert.equal(result.releases[0].sourceKey,"sibna");
  assert.equal(result.authoritativeSnapshot,false);
  assert.equal(result.confirmedEmpty,false);
  assert.match(result.message,/2026-09/);
});

test("an empty historical calendar is a valid bounded job and cannot erase other cached months", async () => {
  const result=await createSibnaCalendarAdapter("2025-10",async()=>calendar({"2025-10-01":{items:[]}})).collect(now);
  assert.equal(result.status,"connected");
  assert.deepEqual(result.releases,[]);
  assert.equal(result.authoritativeSnapshot,false);
  assert.equal(result.confirmedEmpty,false);
  assert.throws(()=>createSibnaCalendarAdapter("2026-13"),/month|range/i);
  const failed=await createSibnaCalendarAdapter("2026-09",async()=>"<title>Just a moment</title>").collect(now);
  assert.equal(failed.status,"error");
});

test("historical calendar food, tickets, financial news, generic sales and telecom promotions do not become releases", () => {
  const titles=["DAY6 5TH FANMEETING","2026 김무열 팬미팅","스페이스엑스 상장","2026 대형한류 종합행사 : 함안 낙화 페스티벌","자라 세일","마리떼 프랑소와져버 세일","웍스아웃 SS 시즌오프 세일(매장)","팔라스 26ss 시즌 세일 영국/유럽","나이키 아울렛 세일 전제품 2개이상 구매시 20% 추가할인","제주항공 국제선 특가","맘스터치X귀멸의 칼날: 무한성편 콜라보 세트","농심 삼계탕 사발면 85g 6개입 쿠팡 사전예약","쿼터파운더 치즈+불고기 버거=6,000원","세이코 시계 가격인상","닌텐도 스위치2 가격인상","뮤지컬 [드림하이 시즌3 : 리부트]","2026-27 로이킴 LIVE TOUR (선예매)","포켓몬고 잉어킹 x SK텔레콤 2차 프로모션 (9월 16일 마감)","LG유플러스 선호번호 신청 이벤트 (골드번호 추첨응모)","eql 창고세일"];
  const parsed=parseSibnaCalendar(calendar({"2026-09-01":{items:titles.map((title,index)=>row(index+1,title,"10:00"))}}),now);
  assert.deepEqual(parsed.releases,[]);
  assert.equal(parsed.filtered,titles.length);
});

test("product collaborations, merchandise, preorder goods and the Sail color survive historical noise rules", () => {
  const titles=["킨 × 후지 록 페스티벌 컬레버레이션","나이키 문 슈 OG SP 세일 앤 클로러필","나이키 에어 포스 1 세일","닌텐도 스위치2 가격인상 후 첫발매","DAY6 팬미팅 한정 키링 굿즈","빅뱅 2026-2027 월드투어 공식 서울 팝업","예약판매 망그러진 곰x두산베어스","Apple Watch Ultra 4 사전예약","팬텀 6 로우 엘리트 FG x Cactus Jack","BLACKPINK X TAMAGOTCHI"];
  const parsed=parseSibnaCalendar(calendar({"2026-09-01":{items:titles.map((title,index)=>row(index+1,title,"10:00"))}}),now);
  assert.deepEqual(parsed.releases.map(release=>release.title),titles);
});
