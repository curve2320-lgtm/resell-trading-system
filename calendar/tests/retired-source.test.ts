import assert from "node:assert/strict";
import test from "node:test";
import {enabledReleaseSourceAdapters,scheduledReleaseSourceAdapters,findReleaseSourceAdapter} from "../app/collection/registry.ts";
import {sourceEnabled} from "../app/source-flags.ts";
import {safeRetailerUrl} from "../app/release-links.ts";
import {readReleaseApiPayload,type CachedRelease,type CollectionRepository} from "../app/collection/repository.ts";

const official={sourceKey:"nike",retailer:"Nike Korea",externalId:"official",productUrl:"https://www.nike.com/kr/launch/t/product",sourceUrl:"https://www.nike.com/kr/launch/t/product",priceLabel:null,releaseDate:"2026-10-09",releaseTime:"10:00"};
const retired={...official,sourceKey:"sibna",retailer:"SIBNA 발매정보",externalId:"sibna:2022",productUrl:"https://sibna.kr/today/post/2022-test",sourceUrl:"https://sibna.kr/today/post/2022-test",releaseDate:"2026-10-03"};
const cached:CachedRelease={id:"mixed",canonicalKey:"mixed",title:"Official product",brand:"Nike",category:"sneakers",releaseKind:"general",releaseDate:retired.releaseDate,releaseTime:"09:00",changedAt:null,lastVerifiedAt:"2026-10-06T00:00:00Z",channels:[retired,official]};
function repository(rows:CachedRelease[]):CollectionRepository{return {
  listCachedReleases:async()=>rows,listSourceHealth:async()=>[],countPendingReviewItems:async()=>0,
  listPendingUndatedReviews:async()=>[],listPendingNikeMissingDateReviews:async()=>[],
} as unknown as CollectionRepository;}
test("retired reference source has no live or monthly collection route",()=>{
  assert.equal(findReleaseSourceAdapter("sibna"),null);
  for(const a of [...enabledReleaseSourceAdapters(),...scheduledReleaseSourceAdapters(new Date("2026-10-06"),"2026-09")]){
    assert.notEqual(a.key,"sibna");assert.equal(a.allowedDomains.includes("sibna.kr"),false);
  }
});
test("runtime override cannot re-enable the removed source",()=>{
  const previous=process.env.RELEASE_SOURCES_ON;process.env.RELEASE_SOURCES_ON="sibna";
  try{assert.equal(sourceEnabled("sibna"),false);}finally{if(previous===undefined)delete process.env.RELEASE_SOURCES_ON;else process.env.RELEASE_SOURCES_ON=previous;}
  assert.equal(safeRetailerUrl(retired.sourceUrl),null);
});
test("API discards retired-only rows but retains a mixed row's independently verified schedule",async()=>{
  const data=await readReleaseApiPayload(repository([{...cached,id:"retired-only",channels:[retired]},cached]),["nike","sibna"]);
  assert.deepEqual(data.releases.map(r=>r.id),["mixed"]);
  assert.equal(data.releases[0].releaseDate,"2026-10-09");assert.equal(data.releases[0].releaseTime,"10:00");
  assert.deepEqual(data.releases[0].channels.map(c=>c.sourceKey),["nike"]);
  assert.equal(data.sources.sibna,undefined);assert.equal(data.sources.database.count,1);
  assert.equal(JSON.stringify(data).includes("sibna.kr"),false);
});
test("API rejects retired-domain channels even if their source key was changed",async()=>{
  const rows=[{...cached,channels:[{...retired,sourceKey:"custom"}]}];
  assert.deepEqual((await readReleaseApiPayload(repository(rows))).releases,[]);
});
test("pending retired announcements cannot recreate the removed source in API health",async()=>{
  const repo=repository([]);repo.listPendingUndatedReviews=async()=>[{id:1,sourceKey:"sibna",externalId:retired.externalId,reason:"missing_date",status:"pending",payloadJson:JSON.stringify({release:{...retired,title:"Teaser",releaseDate:"",brand:null,styleCode:null}})}];
  const data=await readReleaseApiPayload(repo,["sibna"]);assert.equal(data.sources.sibna,undefined);
});
