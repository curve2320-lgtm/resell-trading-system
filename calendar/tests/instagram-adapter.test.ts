import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramAdapter, parseInstagramAnnouncements } from "../app/collection/instagram-adapter.ts";
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
