import assert from "node:assert/strict";
import test from "node:test";
import { parseExpandedSource, parseReleaseArticle } from "../app/collection/expanded-adapters.ts";
import { expandedSourceCatalog } from "../app/expanded-sources.ts";

const now = new Date("2026-10-04T02:00:00Z");
const source = (key: string) => expandedSourceCatalog.find((item) => item.key === key)!;
const next = (data: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;

test("atmos uses the actual releaseAt field instead of the raffle opening", () => {
  const result = parseExpandedSource(next({props:{initialReduxState:{domain:{launch:{byId:{8413280:{id:8413280,title:"NIKE AIR MAX GOADOME LOW",brandName:"NIKE",releaseAt:"2026-10-06T09:00:00.000+09:00",calendarStartAt:"2026-10-01T09:00:00Z",modelNumber:"iv4517-001",shopUrl:"https://www.atmos-tokyo.com/shop/draw/haus0pn0",price:27500,releaseTimeString:"9:00"}}}}}}}), source("atmosJP"), now);
  assert.equal(result.recognized, true);
  assert.equal(result.releases[0]?.releaseDate, "2026-10-06");
  assert.equal(result.releases[0]?.releaseTime, "09:00");
  assert.equal(result.releases[0]?.styleCode, "IV4517-001");
  assert.equal(result.releases[0]?.releaseKindHint, "raffle");
  assert.equal(result.releases[0]?.priceLabel, "¥27,500");
});

test("END converts its epoch timestamp into Seoul's next calendar day", () => {
  const result = parseExpandedSource(next({props:{initialProps:{pageProps:{initialAlgoliaState:{results:{hits:[{name:"adidas x Willy Chavarria Woven Track Jacket",brand:"Adidas",sku:"KZ3119",url_key:"adidas-x-willy-chavarria-woven-track-jacket-kz3119",launches_release_date_unix:1791039600,launches_mode:"Countdown",final_price_1:220}]}}}}}}), source("endGB"), now);
  assert.equal(result.releases[0]?.releaseDate, "2026-10-04");
  assert.equal(result.releases[0]?.releaseTime, "00:00");
  assert.equal(result.releases[0]?.categoryHint, "fashion");
  assert.equal(result.releases[0]?.productUrl, "https://www.endclothing.com/gb/adidas-x-willy-chavarria-woven-track-jacket-kz3119.html");
});

test("a validated empty END list differs from an HTML challenge page", () => {
  const empty = parseExpandedSource(next({props:{initialProps:{pageProps:{initialAlgoliaState:{results:{hits:[]}}}}}}), source("endGB"), now);
  assert.equal(empty.recognized, true);
  assert.deepEqual(empty.releases, []);
  assert.equal(parseExpandedSource("<title>Just a moment...</title>", source("endGB"), now).recognized, false);
});

test("Slam Jam reads European day/month dates without inventing a release time", () => {
  const result = parseExpandedSource('<table class="drops-table"><tbody><tr><td>10/10/2026</td><td>Nike Jordan</td><td>Air Jordan 1 High OG Royal</td><td>Black/Game Royal</td><td>IQ5495-005</td><td>€190</td><td>Online/In Store</td></tr></tbody></table>', source("slamJam"), now);
  assert.equal(result.releases[0]?.releaseDate, "2026-10-10");
  assert.equal(result.releases[0]?.releaseTime, null);
  assert.equal(result.releases[0]?.productUrl, "https://slamjam.com/pages/upcoming-drops");
});

test("a daylight-saving conflict in Bodega's stated PST leaves the time unconfirmed", () => {
  const parsed = parseReleaseArticle('Available online Saturday, October 10, 2026 at 7am PST. AIR JORDAN 1 HIGH OG ROYAL $185 IQ5495-005', "2026-09-28T17:44:13-07:00", source("bodega"));
  assert.deepEqual(parsed, {date:"2026-10-10",time:null});
  assert.equal(parseReleaseArticle("Published October 10, 2026. Photograph by Sam.", "2026-10-10T10:00:00Z", source("bodega")), null);
});

test("Kith release prose resolves a missing year from the nearby article date", () => {
  assert.deepEqual(parseReleaseArticle("Kith Ivy Fall 2026 releases on Monday, October 5 at 11 AM ET, exclusively on Kith.com.", "2026-10-03T00:00:00Z", source("kithNews")), {date:"2026-10-06",time:"00:00"});
});

test("official news without an explicit release date stays undated", () => {
  const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:shop,1</id><title>Stüssy x Helinox</title><published>2026-09-17T10:00:00Z</published><link rel="alternate" href="https://www.stussy.com/blogs/news/fall-26-helinox"/><content type="html">&lt;p&gt;Collection preview&lt;/p&gt;</content></entry></feed>';
  const result = parseExpandedSource(atom, source("stussyNews"), now);
  assert.equal(result.recognized, true);
  assert.equal(result.releases[0]?.releaseDate, "");
  assert.equal(result.releases[0]?.categoryHint, "lifestyle");
});
test("an exhibition launch cannot override the product's explicit release date",()=>{
  assert.deepEqual(parseReleaseArticle("An exhibition launches September 25. The anniversary book releases on September 30 at 11 AM ET.","2026-09-20T00:00:00Z",source("kithNews")),{date:"2026-10-01",time:"00:00"});
});
test("editorials, videos and food trucks are excluded from release announcements",()=>{
  const xml='<feed><entry><title>Ronnie’s Pronto Truck</title><published>2026-10-01</published><link rel="alternate" href="https://kith.com/blogs/discover/truck"/><content>Launching new food trucks today.</content></entry></feed>';
  assert.deepEqual(parseExpandedSource(xml,source("kithNews"),now).releases,[]);
});

test("an article's historic launch does not hide its current product release",()=>{
  assert.deepEqual(parseReleaseArticle("The original sneaker launched in 2011. Its first footwear release defined the brand. The new sneaker releases globally on September 28 at 11 AM ET.","2026-09-25T00:00:00Z",source("kithNews")),{date:"2026-09-29",time:"00:00"});
});

test("product collaborations are retained while unrelated video posts are excluded",()=>{
  const xml='<feed><entry><title>OSAKA FULL VIDEO</title><published>2026-09-08</published><link rel="alternate" href="https://kith.com/blogs/discover/osaka-full-video"/><summary>A film by our friends.</summary></entry><entry><title>Kith Treats capsule</title><published>2026-09-25</published><link rel="alternate" href="https://kith.com/blogs/discover/capsule"/><content>A collaborative apparel and accessories collection launches on September 26. Ice cream specials are also available.</content></entry></feed>';
  const result=parseExpandedSource(xml,source("kithNews"),now);
  assert.deepEqual(result.releases.map((r)=>[r.title,r.releaseDate]),[["Kith Treats capsule","2026-09-26"]]);
});

test("seasonal product deliveries stay while undated editorials and food collections are removed",()=>{
  const entry=(title:string,content:string,id:string)=>`<entry><title>${title}</title><published>2026-09-15</published><link rel="alternate" href="https://www.stussy.com/blogs/news/${id}"/><content>${content}</content></entry>`;
  const xml=`<feed>${entry("Fall '26 Delivery Two","AVAILABLE FRIDAY September 18th. Photographer: Antosh.","delivery")}${entry("A Closer Look at Fall 2026","The apparel collection explores new colors.","closer-look")}${entry("Summer Ice Cream Collection","New ice cream flavors launch on September 18.","ice-cream")}</feed>`;
  assert.deepEqual(parseExpandedSource(xml,source("stussyNews"),now).releases.map((r)=>[r.title,r.releaseDate]),[["Fall '26 Delivery Two","2026-09-18"]]);
});

test("Product datePublished never becomes a launch; availabilityStarts does", () => {
  const jsonld = (offers: unknown) => `<script type="application/ld+json">${JSON.stringify({"@type":"Product",name:"Human Made Jacket",url:"https://www.humanmade.jp/products/jacket",datePublished:"2026-10-04",offers})}</script>`;
  const without = parseExpandedSource(jsonld({price:100}), source("humanMade"), now);
  assert.equal(without.releases.length, 1);
  assert.equal(without.releases[0]?.releaseDate, "");
  const withDate = parseExpandedSource(jsonld({availabilityStarts:"2026-10-08T11:00:00+09:00"}), source("humanMade"), now);
  assert.equal(withDate.releases[0]?.releaseDate, "2026-10-08");
  assert.equal(withDate.releases[0]?.releaseTime, "11:00");
});

test("invalid days and foreign product URL hosts are not accepted as launches", () => {
  const html = '<table class="drops-table"><tbody><tr><td>31/02/2026</td><td>Nike</td><td>Wrong Date</td><td>Black</td><td>AA1234-001</td><td>€100</td><td>Online</td></tr></tbody></table>';
  assert.equal(parseExpandedSource(html, source("slamJam"), now).releases.length, 0);
  const payload = next({props:{initialReduxState:{domain:{launch:{byId:{1:{id:1,title:"Wrong host",releaseAt:"2026-10-06T09:00:00+09:00",shopUrl:"https://evil.test/a"}}}}}}});
  assert.equal(parseExpandedSource(payload, source("atmosJP"), now).releases.length, 0);
});
