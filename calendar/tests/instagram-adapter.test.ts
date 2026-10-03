import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramAdapter, parseInstagramAnnouncements } from "../app/collection/instagram-adapter.ts";
import { normalizeSnsIntake } from "../app/collection/sns-intake.ts";
import { withSourceRequest } from "../app/source-utils.ts";
const now = new Date("2026-10-04T00:00:00Z");

test("an unconnected Instagram account cannot claim successful automatic collection",async()=>{
  let requests = 0;
  const adapter = createInstagramAdapter(async()=>({}),async()=>{requests++;return new Response("{}");});
  const result = await adapter.collect(now);
  assert.equal(result.status,"manual");
  assert.equal(requests,0);
});

test("Instagram publication time is never substituted for an unconfirmed launch",()=>{
  const releases = parseInstagramAnnouncements({business_discovery:{media:{data:[{id:"1",caption:"NEW COLLECTION releases soon",permalink:"https://www.instagram.com/p/Test1/",timestamp:"2026-10-04T00:00:00Z"},{id:"2",caption:"launch soon",permalink:"https://evil.test/p/Test2/"},{id:"3",caption:"Weekend memories",permalink:"https://www.instagram.com/p/Test3/"}]}}},"stussy",now);
  assert.equal(releases.length,1);
  assert.equal(releases[0].releaseDate,"");
});

test("Meta errors cannot expose the server token through source health",async()=>{
  const adapter=createInstagramAdapter(async()=>({INSTAGRAM_ACCESS_TOKEN:"private-token",INSTAGRAM_BUSINESS_ACCOUNT_ID:"123",INSTAGRAM_GRAPH_VERSION:"v25.0",INSTAGRAM_SOURCE_HANDLES:"stussy"}),async()=>new Response('{"error":{"message":"private-token"}}',{status:400}));
  const result=await adapter.collect(now);
  assert.equal(result.status,"error");
  assert.equal(JSON.stringify(result).includes("private-token"),false);
});

const account = { handle: "salomon_kr", label: "Salomon Korea", region: "한국", marketScope: "korea" as const, profileUrl:"https://www.instagram.com/salomon_kr/", officialWebsite: "https://salomon.co.kr/", verifiedByUrl: "https://salomon.co.kr/" };
const discovery = (caption: string, username = "salomon_kr") => ({business_discovery:{username,media:{data:[{id:"17800001",caption,permalink:"https://www.instagram.com/p/OfficialDrop/",timestamp:"2026-10-01T00:00:00Z"}]}}});

test("a verified Korean brand caption supplies its explicit launch date and local time",()=>{
  const releases = parseInstagramAnnouncements(discovery("XT-6 LIMITED EDITION\n발매 2026년 10월 9일 오전 10시"),"salomon_kr",now);
  assert.equal(releases.length,1);
  assert.equal(releases[0].releaseDate,"2026-10-09");
  assert.equal(releases[0].releaseTime,"10:00");
  assert.equal(releases[0].brand,"Salomon Korea");
  assert.equal(releases[0].marketScope,"korea");
  assert.equal(releases[0].sourceUrl,"https://www.instagram.com/p/OfficialDrop/");
});

test("a different returned profile cannot impersonate the requested official account",()=>{
  assert.deepEqual(parseInstagramAnnouncements(discovery("발매 2026-10-09 10:00","salomon_fanclub"),"salomon_kr",now),[]);
});

test("incomplete, impossible and multi-region caption schedules remain in review",()=>{
  for (const caption of ["발매 일정 추후 안내", "발매 2026-02-30 10:00", "발매 2026-10-09 Korea / 2026-10-10 Japan", "발매 2026-10-09 10:00 EST"]) {
    const releases=parseInstagramAnnouncements(discovery(caption),"salomon_kr",now);
    assert.equal(releases.length,1,caption);
    assert.equal(releases[0].releaseDate,"",caption);
  }
});

test("an overseas date without an explicit timezone retains an unknown time",()=>{
  const payload={business_discovery:{username:"stussy",media:{data:[{id:"17800002",caption:"NEW COLLECTION\nRelease October 9, 2026 at 10:00",permalink:"https://www.instagram.com/p/OverseasDrop/"}]}}};
  const releases=parseInstagramAnnouncements(payload,"stussy",now);
  assert.equal(releases[0]?.releaseDate,"2026-10-09");
  assert.equal(releases[0]?.releaseTime,null);
  assert.equal(releases[0]?.marketScope,"overseas");
});

test("an explicit Korean raffle period keeps the closing date and both endpoints",()=>{
  const releases=parseInstagramAnnouncements(discovery("XT-6 응모\n응모 시작: 2026-10-09 10:00\n응모 종료: 2026-10-12 23:59"),"salomon_kr",now);
  assert.equal(releases[0]?.releaseDate,"2026-10-12");
  assert.equal(releases[0]?.releaseKindHint,"raffle");
  assert.equal(releases[0]?.startAt,"2026-10-09T10:00:00+09:00");
  assert.equal(releases[0]?.endAt,"2026-10-12T23:59:00+09:00");
});

test("a configured but unverified handle cannot publish itself as an official brand",()=>{
  const releases=parseInstagramAnnouncements(discovery("발매 2026-10-09 10:00","fan_account"),"fan_account",now);
  assert.equal(releases[0]?.releaseDate,"");
  assert.match(releases[0]?.note ?? "",/계정 확인/);
});

test("verified accounts collect through Business Discovery without a custom handles variable",async()=>{
  let requestUrl:URL|null=null;
  const adapter=createInstagramAdapter(async()=>({INSTAGRAM_ACCESS_TOKEN:"private-token",INSTAGRAM_BUSINESS_ACCOUNT_ID:"123",INSTAGRAM_GRAPH_VERSION:"v25.0"}),async(url,init)=>{
    requestUrl=new URL(String(url));
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer private-token");
    return Response.json(discovery("발매 2026-10-09 10:00"));
  },{accounts:[account]});
  const result=await adapter.collect(now);
  assert.equal(result.status,"connected");
  assert.equal(result.releases[0]?.releaseDate,"2026-10-09");
  assert.match(requestUrl!.searchParams.get("fields") ?? "",/business_discovery.username\(salomon_kr\)/);
  assert.equal(requestUrl!.searchParams.has("access_token"),false);
});

test("a blocked Meta request settles before the source collector deadline",async()=>{
  const adapter=createInstagramAdapter(async()=>({INSTAGRAM_ACCESS_TOKEN:"private-token",INSTAGRAM_BUSINESS_ACCOUNT_ID:"123",INSTAGRAM_GRAPH_VERSION:"v25.0"}),async()=>new Promise<Response>(()=>{}),{accounts:[account],deadlineMs:30,perRequestMs:20});
  const before=Date.now();
  const result=await adapter.collect(now);
  assert.equal(result.status,"error");
  assert.ok(Date.now()-before<500);
  assert.equal(JSON.stringify(result).includes("private-token"),false);
});

test("a caption month and day use the publication year rather than the collector year",()=>{
  const payload=discovery("XT-6\n발매 10월 9일 오전 10시");
  payload.business_discovery.media.data[0].timestamp="2025-10-01T00:00:00Z";
  const releases=parseInstagramAnnouncements(payload,"salomon_kr",now);
  assert.equal(releases[0]?.releaseDate,"2025-10-09");
  assert.equal(releases[0]?.releaseTime,"10:00");
});

test("numeric and English month/day release notices acquire only an unambiguous nearby year",()=>{
  for (const caption of ["XT-6 발매 10/9 오전 10시", "XT-6 release October 9 at 10:00 KST"]) {
    const releases=parseInstagramAnnouncements(discovery(caption),"salomon_kr",now);
    assert.equal(releases[0]?.releaseDate,"2026-10-09",caption);
    assert.equal(releases[0]?.releaseTime,"10:00",caption);
  }
});

test("a December post announcing a January drop resolves to the following year",()=>{
  const payload=discovery("XT-6\n발매 1월 5일 오전 10시");
  payload.business_discovery.media.data[0].timestamp="2026-12-29T00:00:00Z";
  assert.equal(parseInstagramAnnouncements(payload,"salomon_kr",now)[0]?.releaseDate,"2027-01-05");
});

test("a bare month/day without a publication anchor or a nearby release cue stays in review",()=>{
  const noAnchor=discovery("발매 10월 9일 10시");
  noAnchor.business_discovery.media.data[0].timestamp="";
  assert.equal(parseInstagramAnnouncements(noAnchor,"salomon_kr",now)[0]?.releaseDate,"");
  const tooFar=discovery("발매 1월 9일");
  tooFar.business_discovery.media.data[0].timestamp="2026-06-01T00:00:00Z";
  assert.equal(parseInstagramAnnouncements(tooFar,"salomon_kr",now)[0]?.releaseDate,"");
  const unrelated=discovery(`발매 일정 추후 안내\n${"제품 소개 ".repeat(40)}\n촬영 10월 9일`);
  assert.equal(parseInstagramAnnouncements(unrelated,"salomon_kr",now)[0]?.releaseDate,"");
});

test("different regional month/day dates cannot become a single guessed release",()=>{
  assert.equal(parseInstagramAnnouncements(discovery("한국 발매 10/9\n일본 발매 10/10"),"salomon_kr",now)[0]?.releaseDate,"");
});

test("new verified Korean profiles remain eligible for the existing manual SNS intake",()=>{
  const result=normalizeSnsIntake({postUrl:"https://www.instagram.com/p/OfficialDrop/",handle:"salomon_kr",title:"XT-6",brand:"Salomon Korea",category:"sneakers",releaseDate:"2026-10-09",releaseTime:null,kind:"drop",styleCode:null},now.toISOString());
  assert.equal(result.kind,"publish");
});

test("an existing manually trusted profile is preserved without new automatic provenance",()=>{
  const result=normalizeSnsIntake({postUrl:"https://www.instagram.com/p/LegacyDrop/",handle:"thisisneverthat",title:"Capsule",brand:"thisisneverthat",category:"fashion",releaseDate:"2026-10-09",releaseTime:null,kind:"drop",styleCode:null},now.toISOString());
  assert.equal(result.kind,"publish");
  assert.equal(parseInstagramAnnouncements(discovery("발매 2026-10-09","thisisneverthat"),"thisisneverthat",now)[0]?.releaseDate,"");
});

test("the Instagram collection deadline also covers waiting for the shared network budget",async()=>{
  const releaseSlots:Array<()=>void>=[];
  const busy=Array.from({length:8},()=>withSourceRequest(()=>new Promise<void>((resolve)=>releaseSlots.push(resolve))));
  await new Promise<void>((resolve)=>setImmediate(resolve));
  const adapter=createInstagramAdapter(async()=>({INSTAGRAM_ACCESS_TOKEN:"private-token",INSTAGRAM_BUSINESS_ACCOUNT_ID:"123",INSTAGRAM_GRAPH_VERSION:"v25.0"}),async()=>Response.json(discovery("발매 2026-10-09")),{accounts:[account],deadlineMs:30});
  const collection=adapter.collect(now);
  let expiredTimer:ReturnType<typeof setTimeout>;
  const observed=await Promise.race([collection.then(()=>"settled"),new Promise<string>((resolve)=>{expiredTimer=setTimeout(()=>resolve("blocked"),200);})]);
  clearTimeout(expiredTimer!);
  releaseSlots.forEach((release)=>release());
  await Promise.all(busy);
  const result=await collection;
  assert.equal(observed,"settled");
  assert.equal(result.status,"error");
});

test("official account fanout remains bounded and records partial account failures",async()=>{
  let active=0,peak=0;
  const accounts=Array.from({length:9},(_,index)=>({...account,handle:`brand_${index}`,label:`Brand ${index}`}));
  const adapter=createInstagramAdapter(async()=>({INSTAGRAM_ACCESS_TOKEN:"private-token",INSTAGRAM_BUSINESS_ACCOUNT_ID:"123",INSTAGRAM_GRAPH_VERSION:"v25.0"}),async(url)=>{
    const handle=new URL(String(url)).searchParams.get("fields")!.match(/username\(([^)]+)\)/)![1];
    active++;peak=Math.max(peak,active);
    await new Promise((resolve)=>setTimeout(resolve,5));
    active--;
    return handle==="brand_4" ? Response.json(discovery("발매 2026-10-09","wrong_profile")) : Response.json(discovery("발매 2026-10-09",handle));
  },{accounts});
  const result=await adapter.collect(now);
  assert.equal(peak,4);
  assert.equal(result.status,"connected");
  assert.equal(result.releases.length,8);
  assert.match(result.message,/8\/9/);
  assert.equal(result.releases.some(({externalId})=>externalId.includes("brand_4")),false);
});

test("a filming date cannot stand in for an explicitly pending release schedule",()=>{
  for (const caption of ["XT-6 발매 일정 추후 안내\n촬영일 2026-10-09 10:00", "XT-6 발매 일정 추후 안내\n촬영일 10월 9일 오전 10시", "XT-6 발매 일정 추후 안내\n2026-10-09 10:00 촬영", "XT-6 발매 일정 추후 안내\n10월 9일 오전 10시 촬영"]) {
    assert.equal(parseInstagramAnnouncements(discovery(caption),"salomon_kr",now)[0]?.releaseDate,"");
  }
});

test("a same-day raffle retains its start, end and closing time",()=>{
  const release=parseInstagramAnnouncements(discovery("XT-6 응모\n응모 시작: 2026-10-09 10:00\n응모 종료: 2026-10-09 23:59"),"salomon_kr",now)[0];
  assert.equal(release?.releaseDate,"2026-10-09");
  assert.equal(release?.releaseTime,"23:59");
  assert.equal(release?.startAt,"2026-10-09T10:00:00+09:00");
  assert.equal(release?.endAt,"2026-10-09T23:59:00+09:00");
});

test("a dated product teaser stays in review while unrelated stay-tuned notices are excluded",()=>{
  const records={business_discovery:{username:"linefriends_us",media:{data:[
    {id:"1",caption:"First look at minini plushies, keyrings and more!\nStay tuned for October 1st!",permalink:"https://www.instagram.com/p/ProductNotice/",timestamp:"2026-09-30T20:00:26Z"},
    {id:"2",caption:"Weekend photos! Stay tuned for October 1st!",permalink:"https://www.instagram.com/p/GeneralNotice/",timestamp:"2026-09-30T20:00:26Z"},
  ]}}};
  const releases=parseInstagramAnnouncements(records,"linefriends_us",now);
  assert.equal(releases.length,1);
  assert.equal(releases[0].releaseDate,"");
  assert.equal(releases[0].releaseMethod,"정보");
  assert.equal(releases[0].marketScope,"overseas");
  assert.equal(releases[0].categoryHint,"lifestyle");
});
