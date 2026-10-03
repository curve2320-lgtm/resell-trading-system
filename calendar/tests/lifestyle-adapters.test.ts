import assert from "node:assert/strict";
import test from "node:test";
import { parseLegoAnnouncements, parseStarbucksAnnouncements } from "../app/collection/lifestyle-adapters.ts";
import { expandedSourceCatalog } from "../app/expanded-sources.ts";
const now=new Date("2026-10-04T00:00:00Z");
test("LEGO uses product availability and keeps early access separate from general availability",()=>{
  const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{news:{news:[{title:"LEGO Holiday House",url:"/news/2026/september/holiday",release_date:"2026-09-15T00:00:00Z",categories:[{title:"Products"}],components:[{content_block:{text:"**LEGO Holiday House**\nProduct number: 11387\nLEGO Insiders Early Access: 1 October 2026\nFor all: 4 October 2026"}}]}]}}}})}</script>`;
  const result=parseLegoAnnouncements(html,expandedSourceCatalog.find((s)=>s.key==="lego")!,now);
  assert.deepEqual(result.releases.map((r)=>[r.releaseDate,r.releaseTime]),[["2026-10-01",null],["2026-10-04",null]]);
  assert.equal(result.releases.some((r)=>r.releaseDate==="2026-09-15"),false);
  assert.match(result.releases[0].title,/얼리 액세스/);
});
test("Starbucks admits dated collectible MD and excludes food, without using news_dt as launch date",()=>{
  const result=parseStarbucksAnnouncements({list:[{seq:1,title:"9월 22일 Leaf to Coffee MD 출시",news_dt:"2026-09-21"},{seq:2,title:"NEW 말차 케이크 출시",news_dt:"2026-10-02"},{seq:3,title:"Peanuts 상품 출시",news_dt:"2026-09-10"}]},expandedSourceCatalog.find((s)=>s.key==="starbucks")!,now);
  assert.deepEqual(result.releases.map((r)=>[r.title,r.releaseDate]),[["9월 22일 Leaf to Coffee MD 출시","2026-09-22"],["Peanuts 상품 출시",""]]);
});

test("LEGO Markdown product facts retain SKU and RRP while general purchase wins over early availability",()=>{
  const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{news:{news:[{title:"LEGO PlayStation",url:"/news/2026/september/playstation",categories:[{title:"Products"}],components:[{content_block:{text:"Available for LEGO Insiders Early Access from 1 October 2026.\n**Product Number:** 72306\n**RRP:** £139.99 / €159.99 / $179.99\n**LEGO Insiders Early Access:** 1 October 2026\n**For general purchase:** 4 October 2026"}}]}]}}}})}</script>`;
  const result=parseLegoAnnouncements(html,expandedSourceCatalog.find((s)=>s.key==="lego")!,now);
  assert.deepEqual(result.releases.map((r)=>r.releaseDate),["2026-10-01","2026-10-04"]);
  assert.equal(result.releases[1].styleCode,"72306");
  assert.equal(result.releases[1].priceLabel,"£139.99 / €159.99 / $179.99");
});

test("LEGO prose distinguishes For all from availability from Insiders early access",()=>{
  const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{news:{news:[{title:"LEGO PlayStation",url:"/news/2026/september/playstation",categories:[{title:"Products"}],components:[{content_block:{text:"Available for LEGO Insiders Early Access from 1 October 2026, and for all from 4 October 2026.\n**Product Number:** 72306\n**RRP:** $179.99"}}]}]}}}})}</script>`;
  const result=parseLegoAnnouncements(html,expandedSourceCatalog.find((s)=>s.key==="lego")!,now);
  assert.deepEqual(result.releases.map((r)=>r.releaseDate),["2026-10-01","2026-10-04"]);
});

test("LEGO incomplete prose cannot mask a fully dated product label or a comma before the year",()=>{
  const rows=[
    {title:"Holiday House",text:"Available for LEGO Insiders Early Access from 1 October, and for all from 4 October at LEGO Stores.\nProduct number: 11387\nLEGO Insiders Early Access: 1 October 2026\nFor all: 4 October 2026"},
    {title:"Dragon Ball",text:"LEGO Insiders Early Access from 1 November, 2026 and for all from 4 November, 2026.\nProduct number: 11390"},
  ].map((row,index)=>({title:row.title,url:`/news/2026/product-${index}`,categories:[{title:"Products"}],components:[{content_block:{text:row.text}}]}));
  const html=`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{news:{news:rows}}}})}</script>`;
  const result=parseLegoAnnouncements(html,expandedSourceCatalog.find((s)=>s.key==="lego")!,now);
  assert.deepEqual(result.releases.map((r)=>r.releaseDate),["2026-10-01","2026-10-04","2026-11-01","2026-11-04"]);
});
