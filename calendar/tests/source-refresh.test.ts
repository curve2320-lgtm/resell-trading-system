import assert from "node:assert/strict";
import test from "node:test";
import * as collectionRun from "../app/collection/run.ts";
import type { CollectionRepository, PersistSourceResult, SlotClaimOutcome } from "../app/collection/repository.ts";
import type { ReleaseSourceAdapter, SourceCollectionResult } from "../app/collection/registry.ts";

const now=new Date("2026-10-04T02:00:00.000Z");
type Slot={slotKey:string;status:"running"|"completed"|"failed";startedAt:string};
type TestRepository=CollectionRepository&{listCollectionSlots(keys:readonly string[]):Promise<Slot[]>};
function repository(slots:Slot[]=[]){
  const persisted:PersistSourceResult[]=[],claims:Array<{slotKey:string;staleBefore:string}>=[],terminal:string[]=[];
  const result:TestRepository={
    async listCollectionSlots(keys){return slots.filter((slot)=>keys.includes(slot.slotKey));},
    async claimSlot(slotKey,startedAt,claimToken,staleBefore,retryFailedBefore):Promise<SlotClaimOutcome>{
      claims.push({slotKey,staleBefore});const prior=slots.find((slot)=>slot.slotKey===slotKey);
      if(prior?.status==="completed")return {state:"completed"};
      if(prior?.status==="failed" && (!retryFailedBefore || prior.startedAt>retryFailedBefore))return {state:"failed"};
      if(prior&&Date.parse(prior.startedAt)>Date.parse(staleBefore))return {state:"in_progress"};
      if(prior){prior.startedAt=startedAt;prior.status="running";}else slots.push({slotKey,status:"running",startedAt});
      return {state:"claimed",claimToken,reclaimed:Boolean(prior)};
    },
    async completeSlot(slotKey){terminal.push(`completed:${slotKey}`);const slot=slots.find((slot)=>slot.slotKey===slotKey);if(slot)slot.status="completed";return true;},
    async failSlot(slotKey){terminal.push(`failed:${slotKey}`);const slot=slots.find((slot)=>slot.slotKey===slotKey);if(slot)slot.status="failed";return true;},
    async persistSourceResult(value){persisted.push(value);return {reviewItemsCreated:0};},
    async listCachedReleases(){return [];},async listSourceHealth(){return [];},async listReviewItems(){return [];},
    async countPendingReviewItems(){return 0;},async listPendingNikeMissingDateReviews(){return [];},async resolveReview(){},
  };
  return {result,persisted,claims,terminal};
}
function response(key:string):SourceCollectionResult{return {sourceKey:key,status:"connected",releases:[],message:"Official source checked",confirmedEmpty:false};}
function adapter(key:string,collect:ReleaseSourceAdapter["collect"]=async()=>response(key)):ReleaseSourceAdapter{return {key,retailer:key,allowedDomains:["example.com"],collect};}
function scheduled(){
  const run=collectionRun as unknown as {
    sourceRefreshSlotKey(key:string,now:Date):string;
    runScheduledSourceCollection(input:{repository:CollectionRepository;adapter:ReleaseSourceAdapter;now:Date;randomUUID?:()=>string;adapterDeadlineMs?:number}):Promise<{state:string}>;
  };
  assert.equal(typeof run.runScheduledSourceCollection,"function");
  assert.equal(typeof run.sourceRefreshSlotKey,"function");
  return run;
}

test("scheduled source refresh uses a versioned source slot and a ninety-second claim",async()=>{
  const run=scheduled(),repo=repository();
  const result=await run.runScheduledSourceCollection({repository:repo.result,adapter:adapter("nike"),now,randomUUID:()=>"claim-1"});
  assert.equal(result.state,"current");
  assert.deepEqual(repo.claims,[{slotKey:"refresh:v2:2026-10-04@09:30:nike",staleBefore:"2026-10-04T01:58:30.000Z"}]);
  assert.equal(repo.persisted.length,1);
});

test("a corrected SHOEPRIZE parser refreshes the current slot while completed sources stay cached",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts"),run=scheduled();
  const repo=repository([
    {slotKey:"refresh:v3:2026-10-04@09:30:shoeprize",status:"completed",startedAt:now.toISOString()},
    {slotKey:run.sourceRefreshSlotKey("nike",now),status:"completed",startedAt:now.toISOString()},
  ]),started:string[]=[],background:Promise<unknown>[]=[];
  const result=await startReleaseRefreshBatch({repository:repo.result,adapters:["nike","shoeprize"].map(key=>adapter(key,async()=>{started.push(key);return response(key);})),now,waitUntil:job=>{background.push(job);}});
  assert.equal(result.pendingSources,1);await background[0];assert.deepEqual(started,["shoeprize"]);
});

test("scheduled adapter deadline persists an error and ignores a late successful result",async()=>{
  const run=scheduled(),repo=repository();
  let finish!:(value:SourceCollectionResult)=>void;
  const result=await run.runScheduledSourceCollection({repository:repo.result,adapter:adapter("nike",()=>new Promise((resolve)=>{finish=resolve;})),now,adapterDeadlineMs:5});
  assert.equal(result.state,"failed");
  assert.equal(repo.persisted[0].status,"error");
  assert.match(repo.persisted[0].message,/timed out/i);
  finish(response("nike"));
  await new Promise((resolve)=>setTimeout(resolve,1));
  assert.equal(repo.persisted.length,1);
  assert.deepEqual(repo.terminal,["failed:refresh:v2:2026-10-04@09:30:nike"]);
});

test("a scheduled source that lost its claim skips collection",async()=>{
  const run=scheduled(),repo=repository();let calls=0;
  repo.result.claimSlot=async()=>({state:"in_progress"});
  const result=await run.runScheduledSourceCollection({repository:repo.result,adapter:adapter("nike",async()=>{calls++;return response("nike");}),now});
  assert.equal(result.state,"in_progress");assert.equal(calls,0);assert.equal(repo.persisted.length,0);
});

test("refresh returns before network completion and retains four priority jobs in waitUntil",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts");
  const repo=repository(),started:string[]=[],background:Promise<unknown>[]=[];
  let finish!:()=>void;const gate=new Promise<void>((resolve)=>{finish=resolve;});
  const adapters=["other","shoeprize","atmosJP","lego","nike","last"].map((key)=>adapter(key,async()=>{started.push(key);await gate;return response(key);}));
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try {
    const result=await Promise.race([
      startReleaseRefreshBatch({repository:repo.result,adapters,now,waitUntil:(job)=>{background.push(job);}}),
      new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error("refresh waited for network")),1000);}),
    ]);
    assert.equal(result.status,"stale");assert.equal(result.pendingSources,6);
    assert.deepEqual(started,["nike","lego","atmosJP","shoeprize"]);
    assert.equal(background.length,1);assert.equal(repo.persisted.length,0);
  } finally {if(timeout)clearTimeout(timeout);finish();}
  // The response can be gone; the registered promise still owns all persistence.
  await background[0];assert.equal(repo.persisted.length,4);
});

test("refresh skips completed, failed and fresh-held sources while reclaiming stale ones",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts"),run=scheduled();
  const repo=repository([
    {slotKey:run.sourceRefreshSlotKey("nike",now),status:"completed",startedAt:now.toISOString()},
    {slotKey:run.sourceRefreshSlotKey("lego",now),status:"failed",startedAt:now.toISOString()},
    {slotKey:run.sourceRefreshSlotKey("atmosJP",now),status:"running",startedAt:"2026-10-04T01:59:30.000Z"},
    {slotKey:run.sourceRefreshSlotKey("shoeprize",now),status:"running",startedAt:"2026-10-04T01:58:30.000Z"},
  ]),started:string[]=[],background:Promise<unknown>[]=[];
  const result=await startReleaseRefreshBatch({repository:repo.result,adapters:["nike","lego","atmosJP","shoeprize","other"].map((key)=>adapter(key,async()=>{started.push(key);return response(key);})),now,waitUntil:(job)=>{background.push(job);}});
  await background[0];
  assert.deepEqual(started,["shoeprize","other"]);assert.equal(result.pendingSources,3);
  assert.equal(repo.claims[0].staleBefore,"2026-10-04T01:58:30.000Z");
});

test("later polls advance through missing sources instead of rerunning completed batches",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts");
  const repo=repository(),started:string[]=[],adapters=["nike","lego","atmosJP","shoeprize","fifth","sixth"].map((key)=>adapter(key,async()=>{started.push(key);return response(key);}));
  for(let index=0;index<2;index++){
    const background:Promise<unknown>[]=[];
    const result=await startReleaseRefreshBatch({repository:repo.result,adapters,now,waitUntil:(job)=>{background.push(job);}});
    assert.equal(result.status,"stale");await background[0];
  }
  let registered=0;
  const result=await startReleaseRefreshBatch({repository:repo.result,adapters,now,waitUntil:()=>{registered++;}});
  assert.deepEqual(started,["nike","lego","atmosJP","shoeprize","fifth","sixth"]);
  assert.deepEqual(result,{status:"current",message:null,pendingSources:0});assert.equal(registered,0);
});

test("all failed terminal refresh slots report failure without restarting jobs",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts"),run=scheduled();
  const repo=repository([{slotKey:run.sourceRefreshSlotKey("nike",now),status:"failed",startedAt:now.toISOString()}]);
  let calls=0,registered=0;
  const result=await startReleaseRefreshBatch({repository:repo.result,adapters:[adapter("nike",async()=>{calls++;return response("nike");})],now,waitUntil:()=>{registered++;}});
  assert.equal(result.status,"failed");assert.equal(result.pendingSources,0);assert.equal(calls,0);assert.equal(registered,0);
});

test("a completed manual source cannot mask another source's terminal failure",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts"),run=scheduled();
  const repo=repository([
    {slotKey:run.sourceRefreshSlotKey("nike",now),status:"failed",startedAt:now.toISOString()},
    {slotKey:run.sourceRefreshSlotKey("instagram",now),status:"completed",startedAt:now.toISOString()},
  ]);
  const result=await startReleaseRefreshBatch({repository:repo.result,adapters:[adapter("nike",async()=>response("nike")),adapter("instagram",async()=>response("instagram"))],now,waitUntil:()=>assert.fail("terminal jobs must not restart")});
  assert.equal(result.status,"failed");assert.equal(result.pendingSources,0);
  assert.equal(result.message,"Some official release sources are temporarily unavailable.");
});

test("refresh job deadlines settle the retained background batch even when adapters never resolve",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts");
  const repo=repository(),background:Promise<unknown>[]=[];
  const result=await startReleaseRefreshBatch({repository:repo.result,adapters:[adapter("nike",()=>new Promise(()=>{})),adapter("lego",()=>new Promise(()=>{}))],now,adapterDeadlineMs:5,waitUntil:(job)=>{background.push(job);}});
  assert.equal(result.status,"stale");await background[0];
  assert.deepEqual(repo.persisted.map((value)=>value.status),["error","error"]);
  assert.equal(repo.terminal.length,2);
});

test("monthly jobs retain the canonical source and progress one month per source",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts");
  const repo=repository(),started:string[]=[],adapters=["2026-09","2026-08"].map(month=>({...adapter("officialCalendar",async()=>{started.push(month);return response("officialCalendar");}),collectionKey:`officialCalendar:calendar:${month}`,refreshInterval:"weekly" as const}));
  for(let index=0;index<2;index++){
    const background:Promise<unknown>[]=[];
    const context=await startReleaseRefreshBatch({repository:repo.result,adapters,now:new Date(now.getTime()+index*1000),waitUntil:job=>{background.push(job);}});
    assert.equal(context.pendingSources,2-index);await background[0];
  }
  assert.deepEqual(started,["2026-09","2026-08"]);
  assert.deepEqual(repo.persisted.map(value=>value.sourceKey),["officialCalendar","officialCalendar"]);
  assert.equal(new Set(repo.claims.map(value=>value.slotKey)).size,2);
});

test("a fresh held month prevents another job from writing the same source",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts");
  const first={...adapter("officialCalendar"),collectionKey:"officialCalendar:calendar:2026-09",refreshInterval:"weekly" as const};
  const second={...adapter("officialCalendar"),collectionKey:"officialCalendar:calendar:2026-08",refreshInterval:"weekly" as const};
  const key=collectionRun.sourceRefreshSlotKey(first.key,now,first);
  const repo=repository([{slotKey:key,status:"running",startedAt:now.toISOString()}]);let registered=0;
  const context=await startReleaseRefreshBatch({repository:repo.result,adapters:[first,second],now,waitUntil:()=>{registered++;}});
  assert.equal(context.pendingSources,2);assert.equal(registered,0);
});

test("historic monthly jobs refresh weekly while live sources keep daily collection slots",()=>{
  const metadata={collectionKey:"officialCalendar:calendar:2026-09",refreshInterval:"weekly" as const};
  assert.equal(collectionRun.sourceRefreshSlotKey("officialCalendar",now,metadata),collectionRun.sourceRefreshSlotKey("officialCalendar",new Date("2026-10-04T13:00:00Z"),metadata));
  assert.notEqual(collectionRun.sourceRefreshSlotKey("officialCalendar",now,metadata),collectionRun.sourceRefreshSlotKey("officialCalendar",new Date("2026-10-12T02:00:00Z"),metadata));
  assert.notEqual(collectionRun.sourceRefreshSlotKey("nike",now),collectionRun.sourceRefreshSlotKey("nike",new Date("2026-10-04T13:00:00Z")));
});

test("a failed historic month retries after five minutes instead of waiting a week",async()=>{
  const {startReleaseRefreshBatch}=await import("../app/collection/refresh.ts");
  const monthly={...adapter("officialCalendar"),collectionKey:"officialCalendar:calendar:2026-09",refreshInterval:"weekly" as const};
  const repo=repository([{slotKey:collectionRun.sourceRefreshSlotKey("officialCalendar",now,monthly),status:"failed",startedAt:new Date(now.getTime()-5*60_000).toISOString()}]);
  const background:Promise<unknown>[]=[];
  const context=await startReleaseRefreshBatch({repository:repo.result,adapters:[monthly],now,waitUntil:job=>background.push(job)});
  assert.equal(context.pendingSources,1);await background[0];assert.equal(repo.persisted.length,1);
});

test("manual source collection respects a declared scoped adapter lease",async()=>{
  const repo=repository();let collected=0;
  repo.result.claimSourceRefreshLock=async()=>false;
  const summary=await collectionRun.runSourceCollection({repository:repo.result,adapters:[{...adapter("officialCalendar",async()=>{collected++;return response("officialCalendar");}),collectionKey:"officialCalendar:calendar:2026-09"}],sourceKey:"officialCalendar",now});
  assert.equal(collected,0);assert.equal(repo.persisted.length,0);assert.equal(summary.sourcesRun,0);
});
