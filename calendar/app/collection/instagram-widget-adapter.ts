import { findOfficialInstagramAccount } from "../instagram-accounts.ts";
import { canonicalizeInstagramPostUrl } from "../sns-links.ts";
import { fetchSourceJson, fetchSourceText, isRecord, stringValue } from "../source-utils.ts";
import { parseInstagramAnnouncements } from "./instagram-adapter.ts";
import type { ReleaseSourceAdapter, SourceCollectionResult } from "./registry.ts";
import type { AdapterReleaseInput } from "./types.ts";

const LINE_PAGE="https://store.linefriends.com/";
const NEW_ERA_PAGE="https://neweracap.hk/";
type PublicPost={id:string;caption:string;permalink:string;timestamp:string|null};
type PublicFeed={handle:string;page:string;posts:PublicPost[]};

function hasProfileLink(html:string,handle:string):boolean {
  return [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].some((match)=>{
    try {
      const url=new URL(match[1].replaceAll("&amp;","&"));
      return url.protocol==="https:" && !url.username && !url.password && !url.port && /^(?:www\.)?instagram\.com$/.test(url.hostname) && url.pathname.replace(/\/$/,"").toLowerCase()===`/${handle}`;
    } catch {return false;}
  });
}

function instagramTimestamp(value:unknown):string|null {
  if (typeof value==="number" || typeof value==="string" && /^\d{9,11}$/.test(value)) {
    const date=new Date(Number(value)*1000);
    return Number.isFinite(date.getTime()) && date.getUTCFullYear()>=2000 && date.getUTCFullYear()<=2100 ? date.toISOString() : null;
  }
  return typeof value==="string" && /^20\d{2}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function publicPost(item:Record<string,unknown>,idValue:unknown,urlValue:unknown,timeValue:unknown):PublicPost|null {
  const caption=stringValue(item.caption),id=stringValue(idValue),permalink=canonicalizeInstagramPostUrl(String(urlValue ?? ""));
  if (!id || !caption || caption.length>12_000 || !permalink) return null;
  return {id,caption,permalink,timestamp:instagramTimestamp(timeValue)};
}

/** Only the self-profile feed actually published by the branded homepage. */
function lineFriendsFeed(html:string):PublicFeed|null {
  if (html.length>4_000_000 || !hasProfileLink(html,"linefriends_us")) return null;
  const posts=new Map<string,PublicPost>();
  let verifiedWidget=false;
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match)=>match[1]).filter((script)=>script.includes("window.__SW_DATA")).slice(0,4);
  const matches=scripts.flatMap((script)=>[...script.matchAll(/window\.__SW_DATA\s*=\s*window\.__SW_DATA\s*\|\|\s*(\{[^\r\n]+\})\s*;/g)]);
  for (const match of matches) {
    if (match[1].length>500_000) continue;
    try {
      const outer:unknown=JSON.parse(match[1]);
      if (!isRecord(outer) || !isRecord(outer.widget) || !Array.isArray(outer.widget.desktop)) continue;
      for (const entry of outer.widget.desktop.slice(0,8)) {
        if (!isRecord(entry) || typeof entry.widget!=="string" || entry.widget.length>250_000) continue;
        const widget:unknown=JSON.parse(entry.widget);
        if (!isRecord(widget) || widget.status!==true || !isRecord(widget.accounts) || !isRecord(widget.sources) || !Array.isArray(widget.media_list)) continue;
        const accounts=widget.accounts,sources=widget.sources;
        const trustedAccountIds=new Set(Object.entries(accounts).filter(([,account])=>isRecord(account) && account.username==="linefriends_us" && account.connect_status===true).map(([id])=>id));
        const trustedSourceIds=new Set(Object.entries(sources).filter(([,source])=>isRecord(source) && source.source_type==="ProfileSelf" && source.name==="Media source from profile @linefriends_us").map(([id])=>id));
        if (!trustedAccountIds.size || !trustedSourceIds.size) continue;
        verifiedWidget=true;
        for (const item of widget.media_list.slice(0,25)) {
          if (!isRecord(item) || !trustedAccountIds.has(String(item.account_id)) || !trustedSourceIds.has(String(item.source_id))) continue;
          const post=publicPost(item,item.media_id,item.permalink,item.timestamp);
          if (post) posts.set(post.permalink,post);
        }
      }
    } catch { /* A changed or malformed public embed cannot become a confirmed schedule. */ }
  }
  return verifiedWidget ? {handle:"linefriends_us",page:LINE_PAGE,posts:[...posts.values()]} : null;
}

function newEraFeed(payload:unknown):PublicFeed|null {
  if (!isRecord(payload) || !Array.isArray(payload.data) || isRecord(payload.meta) && payload.meta.code!==200) return null;
  const posts=new Map<string,PublicPost>();
  for (const item of payload.data.slice(0,10)) {
    if (!isRecord(item) || !isRecord(item.user) || item.user.username!=="newerahk") continue;
    const caption=typeof item.caption==="string" ? item.caption : isRecord(item.caption) ? item.caption.text : null;
    const post=publicPost({...item,caption},item.id,item.link ?? item.permalink,item.created_time ?? item.timestamp);
    if (post) posts.set(post.permalink,post);
  }
  if (payload.data.length && !posts.size) return null;
  return {handle:"newerahk",page:NEW_ERA_PAGE,posts:[...posts.values()]};
}

function announcements(feed:PublicFeed|null,now:Date):AdapterReleaseInput[] {
  if (!feed) return [];
  const account=findOfficialInstagramAccount(feed.handle);
  if (!account) return [];
  return parseInstagramAnnouncements({business_discovery:{username:feed.handle,media:{data:feed.posts}}},feed.handle,now,account).map((release)=>({
    ...release,sourceKey:"instagramPublic",categoryHint:feed.handle==="linefriends_us" ? "lifestyle" : release.categoryHint,
    note:`${release.note ?? "브랜드 공식 Instagram 공지"} · 공식 사이트 공개 피드 (${new URL(feed.page).hostname})`,
  }));
}

export function parseLineFriendsInstagramEmbed(html:string,now:Date):AdapterReleaseInput[] {
  return announcements(lineFriendsFeed(html),now);
}

export function parseNewEraInstagramFeed(payload:unknown,now:Date):AdapterReleaseInput[] {
  return announcements(newEraFeed(payload),now);
}

function publicNewEraFeedUrl(script:string):string|null {
  if (script.length>300_000) return null;
  const match=script.match(/new Instafeed\((\{[^;]+\})\)\s*;/);
  if (!match || match[1].length>20_000) return null;
  try {
    const config:unknown=JSON.parse(match[1]);
    if (!isRecord(config) || config.account!=="newerahk" || config.shopOrigin!=="newera-hk.myshopify.com" || !Number.isInteger(config.apiVersion) || Number(config.apiVersion)<1 || Number(config.apiVersion)>20 || !Number.isInteger(config.feedId) || Number(config.feedId)<0 || Number(config.feedId)>9999 || typeof config.hash!=="string" || !/^[a-f0-9]{32}$/.test(config.hash)) return null;
    const url=new URL(`https://instafeed.nfcube.com/feed/v${config.apiVersion}`);
    for (const [key,value] of Object.entries({limit:"10",account:config.shopOrigin,fu:"0",fid:String(config.feedId),hash:config.hash,locale:"en"})) url.searchParams.set(key,value);
    return url.toString();
  } catch {return null;}
}

export function createPublicInstagramAdapter(fetchText=fetchSourceText,fetchJson:(url:string)=>Promise<unknown>=fetchSourceJson,options:{deadlineMs?:number}={}):ReleaseSourceAdapter {
  return {key:"instagramPublic",retailer:"공식 사이트 Instagram 공지",allowedDomains:["instagram.com"],async collect(now):Promise<SourceCollectionResult> {
    let expired=false,timeout:ReturnType<typeof setTimeout>;
    const deadline=new Promise<null>((resolve)=>{timeout=setTimeout(()=>{expired=true;resolve(null);},options.deadlineMs ?? 18_000);});
    const readLine=async()=>lineFriendsFeed(await fetchText(LINE_PAGE));
    const readNewEra=async()=>{
      const html=await fetchText(NEW_ERA_PAGE);
      if (expired || !hasProfileLink(html,"newerahk")) return null;
      const publicHtml=html.replace(/\\\//g,"/");
      const scriptUrl=publicHtml.match(/https:\/\/cdn\.nfcube\.com\/instafeed-[a-f0-9]{32}\.js(?=["'\s?])/i)?.[0];
      if (!scriptUrl) return null;
      const script=await fetchText(scriptUrl);
      if (expired) return null;
      const feedUrl=publicNewEraFeedUrl(script);
      if (!feedUrl) return null;
      const payload=await fetchJson(feedUrl);
      return expired ? null : newEraFeed(payload);
    };
    let feeds:Array<PublicFeed|null>;
    try {feeds=await Promise.all([readLine,readNewEra].map((read)=>Promise.race([read().catch(()=>null),deadline])));}
    finally {clearTimeout(timeout!);expired=true;}
    const connected=feeds.filter((feed):feed is PublicFeed=>feed!==null);
    const releases=connected.flatMap((feed)=>announcements(feed,now));
    const dated=releases.filter(({releaseDate})=>Boolean(releaseDate)).length;
    const postCount=connected.reduce((count,feed)=>count+feed.posts.length,0);
    return {sourceKey:"instagramPublic",status:connected.length ? "connected" : "error",releases,
      message:connected.length ? `공식 사이트 Instagram ${connected.length}/2곳 · 게시물 ${postCount}건 · 확정 일정 ${dated}건 · 검토 ${releases.length-dated}건` : "공식 사이트 Instagram 공개 피드 확인 필요 · 기존 공지 유지",
      confirmedEmpty:false,authoritativeSnapshot:false};
  }};
}

export const instagramPublicReleaseAdapter=createPublicInstagramAdapter();
