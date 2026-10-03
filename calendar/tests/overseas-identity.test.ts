import assert from "node:assert/strict";
import test from "node:test";
import { groupCollectedReleases } from "../app/collection/dedupe.ts";
import type {CollectedRelease} from "../app/collection/types.ts";
const base:CollectedRelease={sourceKey:"nike",externalId:"1",title:"Nike Air Max",brand:"Nike",category:"sneakers",releaseKind:"general",releaseDate:"2026-10-06",releaseTime:"10:00",priceLabel:null,styleCode:"IV4517-001",retailer:"Nike Korea",productUrl:"https://www.nike.com/kr/a",sourceUrl:"https://www.nike.com/kr/a",collectedAt:"2026-10-04T00:00:00Z"};
test("the same SKU can have legitimate Korean and overseas launch times without both being hidden",()=>{
  const groups=groupCollectedReleases([base,{...base,sourceKey:"atmosJP",retailer:"atmos 일본",releaseTime:"09:00"},{...base,sourceKey:"endGB",releaseDate:"2026-10-07",retailer:"END. 영국"}]);
  assert.equal(groups.length,3);
  assert.equal(groups.every((group)=>group.reviewReason===null),true);
  assert.equal(new Set(groups.map((group)=>group.canonicalKey)).size,3);
});
test("matching titles without SKUs in separate markets are not false duplicates",()=>{
  const groups=groupCollectedReleases([{...base,styleCode:null,sourceKey:"newBalanceUS"},{...base,styleCode:null,sourceKey:"newBalanceUK"}]);
  assert.equal(groups.length,2);
  assert.equal(groups.every((group)=>group.reviewReason===null),true);
});
