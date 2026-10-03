import assert from "node:assert/strict";
import test from "node:test";
import { collectWithLimit } from "../app/collection/concurrency.ts";
import { fetchSourceJson, fetchSourceText } from "../app/source-utils.ts";
import { createExpandedAdapter } from "../app/collection/expanded-adapters.ts";
import { createInstagramAdapter } from "../app/collection/instagram-adapter.ts";
import { expandedSourceCatalog } from "../app/expanded-sources.ts";
import { fetchKreamReleases } from "../app/kream.ts";
import { fetchKasinaReleases } from "../app/kasina.ts";
import { fetchShoeprizeReleases } from "../app/shoeprize.ts";
import { fetchSoldoutReleases } from "../app/soldout.ts";

test("a large source set cannot exceed the worker's network concurrency budget", async () => {
  let active = 0, peak = 0;
  const values = await collectWithLimit(Array.from({length:21},(_,index)=>index),async(index)=> {
    active++;peak=Math.max(active,peak);
    await new Promise((resolve)=>setTimeout(resolve,4));
    active--;
    if (index===3) throw new Error("source failed");
    return index*2;
  },8);
  assert.equal(peak,8);
  assert.equal(values.length,21);
  assert.equal(values[3].status,"rejected");
  assert.deepEqual(values[20],{status:"fulfilled",value:40});
});
test("parallel article fanout shares the eight-request fetch budget",async(t)=>{
  let active=0,peak=0;
  t.mock.method(globalThis,"fetch",async()=>{active++;peak=Math.max(peak,active);await new Promise((r)=>setTimeout(r,5));active--;return new Response("public article");});
  const articles=await Promise.all(Array.from({length:18},(_,i)=>fetchSourceText(`https://kith.com/blogs/discover/${i}`)));
  assert.equal(peak,8);
  assert.equal(articles.length,18);
});

test("text, JSON, Starbucks POST and Instagram all share the request budget",async(t)=>{
  let active=0,peak=0;
  t.mock.method(globalThis,"fetch",async()=>{active++;peak=Math.max(peak,active);await new Promise((r)=>setTimeout(r,5));active--;return Response.json({list:[],business_discovery:{media:{data:[]}}});});
  const starbucks=createExpandedAdapter(expandedSourceCatalog.find((s)=>s.key==="starbucks")!);
  const instagram=createInstagramAdapter(async()=>({INSTAGRAM_ACCESS_TOKEN:"test-token",INSTAGRAM_BUSINESS_ACCOUNT_ID:"123",INSTAGRAM_GRAPH_VERSION:"v25.0",INSTAGRAM_SOURCE_HANDLES:"stussy"}),globalThis.fetch);
  const values=await Promise.all([
    ...Array.from({length:10},(_,i)=>fetchSourceText(`https://kith.com/${i}`)),
    ...Array.from({length:10},(_,i)=>fetchSourceJson(`https://www.nike.com/${i}`)),
    starbucks.collect(new Date("2026-10-04T00:00:00Z")),
    instagram.collect(new Date("2026-10-04T00:00:00Z")),
  ]);
  assert.equal(peak,8);
  assert.equal(values.length,22);
  assert.equal((values[20] as {status:string}).status,"connected");
  assert.equal((values[21] as {status:string}).status,"connected");
});

test("failed requests release their slot for queued source requests",async(t)=>{
  let started=0;
  t.mock.method(globalThis,"fetch",async()=>{const index=started++;await new Promise((r)=>setTimeout(r,2));return new Response(index<8?"blocked":"success",{status:index<8?503:200});});
  const values=await Promise.allSettled(Array.from({length:12},(_,i)=>fetchSourceText(`https://kith.com/${i}`)));
  assert.equal(values.filter((value)=>value.status==="rejected").length,8);
  assert.equal(values.filter((value)=>value.status==="fulfilled").length,4);
});

test("legacy retailer requests cannot bypass the shared fetch budget",async(t)=>{
  let active=0,peak=0;
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL)=>{active++;peak=Math.max(peak,active);await new Promise((r)=>setTimeout(r,5));active--;return new Response("source body",{status:String(url).startsWith("https://kith.com/")?200:503});});
  const values=await Promise.all([
    ...Array.from({length:8},(_,i)=>fetchSourceText(`https://kith.com/${i}`)),
    fetchKreamReleases(),fetchKasinaReleases(),fetchShoeprizeReleases(),fetchSoldoutReleases(),
  ]);
  assert.equal(peak,8);
  assert.equal(values.length,12);
  assert.equal((values[10] as {status:string}).status,"error");
});

test("HTTP error response bodies are cancelled before a queued request takes the slot",async(t)=>{
  let cancelled=0;
  t.mock.method(globalThis,"fetch",async()=>new Response(new ReadableStream({cancel(){cancelled++;}}),{status:503}));
  await Promise.allSettled(Array.from({length:12},(_,i)=>fetchSourceText(`https://kith.com/${i}`)));
  assert.equal(cancelled,12);
});
