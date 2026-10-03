import assert from "node:assert/strict";
import test from "node:test";
import { createPublicInstagramAdapter, parseLineFriendsInstagramEmbed, parseNewEraInstagramFeed } from "../app/collection/instagram-widget-adapter.ts";

const now = new Date("2026-10-04T00:00:00Z");
const previewCaption = "Look who minini invited over..! 💝\nWhen minini meets Pudgy Penguins—\na first look at the plushies, keyrings and more!\n🗓️ Stay tuned for October 1st!";

function lineHtml(caption = previewCaption, username = "linefriends_us", sourceType = "ProfileSelf", permalink = "https://www.instagram.com/p/Dd7JK1hAVBr/") {
  const widget = {status:true,accounts:{official:{username,social_type:"InstagramPersonal",connect_status:true}},sources:{self:{source_type:sourceType,name:`Media source from profile @${username}`}},media_list:[{media_id:"5cba50c1-bdc0-11f1-9839-ba9309130010",account_id:"official",source_id:"self",caption,permalink,timestamp:"2026-09-30T20:00:26Z",media_url:"https://image.test/private-media"}]};
  const data = {widget:{desktop:[{widget:JSON.stringify(widget)}]}};
  return `<a href="https://www.instagram.com/linefriends_us/">Instagram</a><script>window.__SW_DATA = window.__SW_DATA || ${JSON.stringify(data)};</script>`;
}

const newEraHtml = '<a href="https://www.instagram.com/newerahk/">Instagram</a><script>var instafeedScriptSrc = "https://cdn.nfcube.com/instafeed-74950990a05d49e412eafb9eaa4bb02c.js";</script>';
const newEraScript = 'var feed = new Instafeed({"account":"newerahk","hash":"9bdf0153a43671e5816d8d8303eb685c","apiVersion":6,"shopOrigin":"newera-hk.myshopify.com","feedId":0}); feed.run();';
const newEraPayload = (username = "newerahk") => ({data:[{id:"17867491575662830",caption:"Limited cap release October 8, 2026",link:"https://www.instagram.com/p/NewEraOfficial/",created_time:1790676024,user:{username},images:{standard_resolution:{url:"https://image.test/private-media"}}}],meta:{code:200}});

test("the official LINE FRIENDS teaser preserves its original link without inventing a sale date",()=>{
  const releases = parseLineFriendsInstagramEmbed(lineHtml(),now);
  assert.equal(releases.length,1);
  assert.equal(releases[0].sourceKey,"instagramPublic");
  assert.equal(releases[0].releaseDate,"");
  assert.equal(releases[0].releaseTime,null);
  assert.equal(releases[0].marketScope,"overseas");
  assert.equal(releases[0].categoryHint,"lifestyle");
  assert.equal(releases[0].sourceUrl,"https://www.instagram.com/p/Dd7JK1hAVBr/");
  assert.match(releases[0].note ?? "",/공식 사이트/);
  assert.equal(JSON.stringify(releases).includes("private-media"),false);
  assert.equal(Object.hasOwn(releases[0],"caption"),false);
});

test("an explicit launch date in the branded public feed can publish independently of its posting day",()=>{
  const releases=parseLineFriendsInstagramEmbed(lineHtml("Limited plushies launch October 1st"),now);
  assert.equal(releases[0]?.releaseDate,"2026-10-01");
  assert.equal(releases[0]?.releaseTime,null);
});

test("an undated public Instagram drop remains in review instead of using its posting day",()=>{
  const releases = parseLineFriendsInstagramEmbed(lineHtml("New limited plushies release soon"),now);
  assert.equal(releases.length,1);
  assert.equal(releases[0].releaseDate,"");
});

test("a mismatched account, tagged-content widget or missing official profile link cannot publish",()=>{
  assert.deepEqual(parseLineFriendsInstagramEmbed(lineHtml(previewCaption,"fanclub"),now),[]);
  assert.deepEqual(parseLineFriendsInstagramEmbed(lineHtml(previewCaption,"linefriends_us","Hashtag"),now),[]);
  assert.deepEqual(parseLineFriendsInstagramEmbed(lineHtml().replace(/<a[^>]*>Instagram<\/a>/,""),now),[]);
});

test("unsafe public feed links are rejected and duplicate desktop scripts do not duplicate posts",()=>{
  assert.deepEqual(parseLineFriendsInstagramEmbed(lineHtml(previewCaption,"linefriends_us","ProfileSelf","https://evil.test/p/Test/"),now),[]);
  const html = lineHtml();
  assert.equal(parseLineFriendsInstagramEmbed(html+html,now).length,1);
});

test("the publicly embedded New Era feed preserves its stated date and refuses another username",()=>{
  const releases = parseNewEraInstagramFeed(newEraPayload(),now);
  assert.equal(releases[0]?.sourceKey,"instagramPublic");
  assert.equal(releases[0]?.releaseDate,"2026-10-08");
  assert.equal(releases[0]?.sourceUrl,"https://www.instagram.com/p/NewEraOfficial/");
  assert.deepEqual(parseNewEraInstagramFeed(newEraPayload("unrelated_account"),now),[]);
  assert.equal(JSON.stringify(releases).includes("private-media"),false);
});

test("public collection follows only the branded published widget and its bounded public feed",async()=>{
  const requests:string[]=[];
  const adapter=createPublicInstagramAdapter(async url=>{
    requests.push(url);
    if(url==="https://store.linefriends.com/")return lineHtml();
    if(url==="https://neweracap.hk/")return newEraHtml;
    if(url==="https://cdn.nfcube.com/instafeed-74950990a05d49e412eafb9eaa4bb02c.js")return newEraScript;
    throw new Error("Unexpected public URL");
  },async url=>{requests.push(url);return newEraPayload();});
  const result=await adapter.collect(now);
  assert.equal(result.status,"connected");
  assert.equal(result.releases.length,2);
  assert.equal(requests.length,4);
  const feedUrl=new URL(requests.find(url=>url.startsWith("https://instafeed.nfcube.com/"))!);
  assert.equal(feedUrl.pathname,"/feed/v6");
  assert.equal(feedUrl.searchParams.get("account"),"newera-hk.myshopify.com");
  assert.equal(feedUrl.searchParams.get("limit"),"10");
  assert.equal(feedUrl.searchParams.get("fu"),"0");
  assert.equal(requests.some(url=>/graph\.facebook|graph\.instagram|instagram\.com\//.test(url)),false);
});

test("the actual Shopify script pointer may escape URL slashes without losing its public feed",async()=>{
  const encodedHtml=newEraHtml.replace("https://cdn.nfcube.com/instafeed-74950990a05d49e412eafb9eaa4bb02c.js","https:\\/\\/cdn.nfcube.com\\/instafeed-74950990a05d49e412eafb9eaa4bb02c.js");
  const adapter=createPublicInstagramAdapter(async url=>url==="https://store.linefriends.com/" ? lineHtml() : url==="https://neweracap.hk/" ? encodedHtml : newEraScript,async()=>newEraPayload());
  const result=await adapter.collect(now);
  assert.equal(result.releases.length,2);
  assert.match(result.message,/2\/2/);
});

test("an injected widget host or another store configuration never becomes a feed request",async()=>{
  let feedRequests=0;
  for(const script of [newEraScript.replace("newerahk","fanclub"),newEraScript.replace("newera-hk.myshopify.com","evil.myshopify.com")]){
    const adapter=createPublicInstagramAdapter(async url=>url==="https://store.linefriends.com/" ? lineHtml() : url==="https://neweracap.hk/" ? newEraHtml : script,async()=>{feedRequests++;return newEraPayload();});
    assert.equal((await adapter.collect(now)).releases.length,1);
  }
  const adapter=createPublicInstagramAdapter(async url=>url==="https://store.linefriends.com/" ? lineHtml() : newEraHtml.replace("cdn.nfcube.com","evil.test"),async()=>{feedRequests++;return newEraPayload();});
  assert.equal((await adapter.collect(now)).releases.length,1);
  assert.equal(feedRequests,0);
});

test("one blocked public website keeps the other real feed and reports partial coverage",async()=>{
  const adapter=createPublicInstagramAdapter(async url=>{if(url==="https://store.linefriends.com/")return lineHtml();throw new Error("secret-shaped upstream failure");},async()=>{throw new Error("not called");});
  const result=await adapter.collect(now);
  assert.equal(result.status,"connected");
  assert.equal(result.releases.length,1);
  assert.match(result.message,/1\/2/);
  assert.equal(JSON.stringify(result).includes("secret-shaped"),false);
});

test("a returned feed containing only another account cannot report a connected branded source",async()=>{
  const adapter=createPublicInstagramAdapter(async url=>url==="https://store.linefriends.com/" ? lineHtml() : url==="https://neweracap.hk/" ? newEraHtml : newEraScript,async()=>newEraPayload("fanclub"));
  const result=await adapter.collect(now);
  assert.equal(result.releases.length,1);
  assert.match(result.message,/1\/2/);
});

test("a stalled public website body settles before the outer collector deadline",async()=>{
  const adapter=createPublicInstagramAdapter(async()=>new Promise<string>(()=>{}),async()=>new Promise<unknown>(()=>{}),{deadlineMs:25});
  const before=Date.now();
  const result=await adapter.collect(now);
  assert.equal(result.status,"error");
  assert.equal(result.releases.length,0);
  assert.ok(Date.now()-before<500);
});

test("a malformed or disabled public widget is not evidence of a successful empty collection",async()=>{
  const adapter=createPublicInstagramAdapter(async url=>url==="https://store.linefriends.com/" ? lineHtml().replace('\\"status\\":true','\\"status\\":false') : "not a widget",async()=>{throw new Error("not called");});
  const result=await adapter.collect(now);
  assert.equal(result.status,"error");
  assert.equal(result.confirmedEmpty,false);
});
