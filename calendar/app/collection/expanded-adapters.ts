import { expandedSourceCatalog, type ExpandedSource } from "../expanded-sources.ts";
import { fetchSourceJson, fetchSourceText, htmlText, isRecord, seoulDateTime, stringValue } from "../source-utils.ts";
import type { AdapterReleaseInput, ReleaseCategory } from "./types.ts";
import type { ReleaseSourceAdapter, SourceCollectionResult } from "./registry.ts";
import {parseLegoAnnouncements, parseStarbucksAnnouncements} from "./lifestyle-adapters.ts";

export type ExpandedParseResult = {recognized:boolean;releases:AdapterReleaseInput[];malformed:number};
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const empty = (): ExpandedParseResult => ({recognized:false,releases:[],malformed:0});
export function validReleaseDay(year:number,month:number,day:number):string|null {
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date.toISOString().slice(0,10):null;
}
export function expandedSafeUrl(value:unknown,source:ExpandedSource):string|null {
  if(typeof value!=="string" || !value.trim())return null;
  try {const url=new URL(value,source.url);if(url.protocol!=="https:" || url.username || url.password || url.port)return null;return source.domains.some((domain)=>url.hostname===domain || url.hostname.endsWith(`.${domain}`))?url.href:null;}catch{return null;}
}
export function expandedCategory(title:string,fallback:ReleaseCategory):ReleaseCategory {
  if(/helinox|wilson|watch|시계|키링|키캡|레고|lego|pokemon|포켓몬|카드|굿즈|toy|bearbrick|be@rbrick|스누피|캐릭터|cup|tumbler|잡화/iu.test(title))return "lifestyle";
  if(/jacket|pant|hoodie|shirt|sweat|coat|vest|cap\b|니트|자켓|재킷|의류|가방|백팩|hat\b/iu.test(title))return "fashion";
  if(/sneaker|air jordan|air max|kobe|samba|gel-|shoe|신발|스니커|운동화|뉴발란스|아식스/iu.test(title))return "sneakers";
  return fallback;
}
export function expandedInput(source:ExpandedSource,now:Date,values:Partial<AdapterReleaseInput>&{title:string;externalId:string}):AdapterReleaseInput {
  return {sourceKey:source.key,brand:source.label,releaseDate:"",releaseTime:null,priceLabel:null,styleCode:null,retailer:source.label,productUrl:source.url,sourceUrl:source.url,collectedAt:now.toISOString(),allowedDomains:source.domains,categoryHint:expandedCategory(values.title,source.category),...values};
}
export function expandedScriptJson(html:string,id:string):unknown {
  const match=html.match(new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,"i"));
  try{return match?JSON.parse(match[1]):null;}catch{return null;}
}
function at(value:unknown,...keys:string[]):unknown {for(const key of keys){if(!isRecord(value))return undefined;value=value[key];}return value;}
function iso(value:unknown):{date:string;time:string|null}|null {
  if(typeof value!=="string")return null;
  const day=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(day){const date=validReleaseDay(+day[1],+day[2],+day[3]);return date?{date,time:null}:null;}
  return /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)?seoulDateTime(value):null;
}
function atmos(html:string,source:ExpandedSource,now:Date):ExpandedParseResult {
  const byId=at(expandedScriptJson(html,"__NEXT_DATA__"),"props","initialReduxState","domain","launch","byId");
  if(!isRecord(byId))return empty();let malformed=0;
  const releases=Object.entries(byId).flatMap(([id,row])=>{
    if(!isRecord(row)){malformed++;return [];}
    const title=stringValue(row.title),url=expandedSafeUrl(row.shopUrl,source),schedule=iso(row.releaseAt);
    if(!title || !url || !schedule){malformed++;return [];}
    return [expandedInput(source,now,{externalId:`atmos:${id}`,title,brand:stringValue(row.brandName),releaseDate:schedule.date,releaseTime:stringValue(row.releaseTimeString)?schedule.time:null,styleCode:stringValue(row.modelNumber)?.toUpperCase()??null,productUrl:url,sourceUrl:url,priceLabel:typeof row.price==="number"?`¥${row.price.toLocaleString("en-US")}`:null,...(/\/(draw|raffles?)\//i.test(url)?{releaseKindHint:"raffle" as const}:{})})];
  });return {recognized:true,releases,malformed};
}
function end(html:string,source:ExpandedSource,now:Date):ExpandedParseResult {
  const hits=at(expandedScriptJson(html,"__NEXT_DATA__"),"props","initialProps","pageProps","initialAlgoliaState","results","hits");
  if(!Array.isArray(hits))return empty();let malformed=0;
  const releases=hits.flatMap((row)=>{
    if(!isRecord(row)){malformed++;return [];}
    const title=stringValue(row.name),slug=stringValue(row.url_key),epoch=Number(row.launches_release_date_unix);
    const schedule=Number.isFinite(epoch)&&epoch>1e9?seoulDateTime(epoch*1000):null;
    const url=slug&&/^[a-z\d-]+$/i.test(slug)?expandedSafeUrl(`/gb/${slug}.html`,source):null;
    if(!title || !url || !schedule){malformed++;return [];}
    return [expandedInput(source,now,{externalId:`end:${stringValue(row.sku)??slug}`,title,brand:stringValue(row.brand),releaseDate:schedule.date,releaseTime:schedule.time,styleCode:stringValue(row.sku)?.toUpperCase()??null,productUrl:url,sourceUrl:url,priceLabel:typeof row.final_price_1==="number"?`£${row.final_price_1}`:null,...(/draw|raffle/i.test(String(row.launches_mode))?{releaseKindHint:"raffle" as const}:{})})];
  });return {recognized:true,releases,malformed};
}
function slamjam(html:string,source:ExpandedSource,now:Date):ExpandedParseResult {
  const table=html.match(/<table\b[^>]*class=["'][^"']*\bdrops-table\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
  if(!table)return empty();let malformed=0;
  const releases=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((row)=>{
    const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell)=>htmlText(cell[1]));if(!cells.length)return [];
    const match=cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/),date=match?validReleaseDay(+match[3],+match[2],+match[1]):null;
    if(cells.length<7 || !date || !cells[2]){malformed++;return [];}
    return [expandedInput(source,now,{externalId:`slamjam:${cells[4]||cells[2]}:${date}`,title:cells[2],brand:cells[1]||null,releaseDate:date,styleCode:cells[4]==="-"?null:cells[4],priceLabel:cells[5],...(/raffle|draw/i.test(cells[6])?{releaseKindHint:"raffle" as const}:{})})];
  });return {recognized:true,releases,malformed};
}
type Announcement={title:string;url:string;content:string;published:string};
const MERCHANDISE=/\b(?:collection|delivery|capsule|collaborat(?:ion|ive)|collab|apparel|accessor(?:y|ies)|footwear|sneakers?|shoes?|tee|t-shirts?|jacket|hoodie|pants?|eyegear|gear|cargo net|helinox|book|toys?|figures?|tumbler|mug|cards?)\b|발매|출시|협업|의류|잡화|굿즈|피규어|키링|키캡|스니커|신발/iu;
const PHYSICAL_GOODS=/\b(?:apparel|accessor(?:y|ies)|footwear|sneakers?|shoes?|tee|t-shirts?|jacket|hoodie|pants?|eyegear|gear|cargo net|helinox|book|toys?|figures?|tumbler|mug|cards?)\b|의류|잡화|굿즈|피규어|키링|키캡|스니커|신발/iu;
const PRODUCT_NAME=/\b(?:air jordan|air max|air force|kobe|nike|adidas|new balance|asics|salomon|puma|converse|keen|shai|junya|be@rbrick|lego|pokemon)\b/iu;
function releaseAnnouncement(entry:Announcement,source:ExpandedSource):boolean {
  const text=`${entry.title} ${entry.content}`,merchandise=MERCHANDISE.test(text);
  // A food partnership can also release a merchandise capsule; keep that capsule.
  if(/\b(?:food truck|pronto truck|restaurant|meal|menu|ice cream|burger|chicken|non-profit|foundation|mainstay special)\b|버거|치킨|음료|푸드/iu.test(text)&&!PHYSICAL_GOODS.test(text))return false;
  if(/\b(?:video|film|interview|editorial|lookbook|campaign|exhibition|a closer look)\b/iu.test(entry.title)&&!parseReleaseArticle(entry.content,entry.published,source))return false;
  return merchandise||PRODUCT_NAME.test(text)||/\s(?:x|×|&)\s/iu.test(entry.title);
}
function xmlValue(xml:string,tag:string):string {return (xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))?.[1]??"").replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,"$1");}
function announcements(xml:string,source:ExpandedSource,now:Date):Announcement[] {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].flatMap(([_,entry])=>{
    const links=[...entry.matchAll(/<link\b[^>]*>/gi)],link=links.find(([tag])=>/rel=["']alternate["']/.test(tag))??links[0];
    const href=link?.[0].match(/href=["']([^"']+)["']/i)?.[1],url=expandedSafeUrl(href?htmlText(href):null,source),title=htmlText(xmlValue(entry,"title")),published=xmlValue(entry,"published");
    if(!url || !title || Date.parse(published)<now.getTime()-90*86400000)return [];
    const announcement={title,url,published,content:htmlText(htmlText(xmlValue(entry,"content")||xmlValue(entry,"summary")))};
    return releaseAnnouncement(announcement,source)?[announcement]:[];
  }).slice(0,30);
}
function offsetFor(zone:string,date:string,hour:number,minute:number):number|null {
  const fixed:Record<string,number>={PST:-480,PDT:-420,EST:-300,EDT:-240,JST:540,KST:540,GMT:0,UTC:0,CET:60,CEST:120};if(zone in fixed)return fixed[zone];
  const name=zone==="ET"?"America/New_York":zone==="PT"?"America/Los_Angeles":null;if(!name)return null;
  const guess=new Date(`${date}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00Z`);
  const label=new Intl.DateTimeFormat("en-US",{timeZone:name,timeZoneName:"longOffset"}).formatToParts(guess).find((part)=>part.type==="timeZoneName")?.value,match=label?.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match?(match[1]==="-"?-1:1)*(+match[2]*60 + +match[3]):null;
}
/** Release statements supply dates; article publication timestamps never do. */
export function parseReleaseArticle(content:string,published:string,source:ExpandedSource):{date:string;time:string|null}|null {
  const text=htmlText(content),pub=new Date(published);
  if(!/releas(?:e|es|ing)|launch(?:es|ing)?|available|drop(?:s|ping)?|발매|출시|発売/i.test(text)||Number.isNaN(pub.getTime()))return null;
  const regional=text.match(/Japan\s*(?:&|and)\s*Korea\s*[-–:]\s*([^\n]*?(?:JST\/?KST|JST|KST))/i)?.[1];
  // Nouns such as "the launch of an exhibition" do not identify a product date.
  const statements=[...text.matchAll(/\b(?:releases|releasing|launches|launching|drops|dropping|available|will\s+(?:release|launch|drop)|(?:released|launched|release|launch|drop)\s+on)\b[^.!?]{0,260}/gi)].map(([clause])=>clause);
  const clauses=regional?[regional]:statements.sort((left,right)=>Number(!/\bon\b/i.test(left))-Number(!/\bon\b/i.test(right)));
  for(const clause of clauses){const schedule=releaseClause(clause,pub,source);if(schedule)return schedule;}
  return null;
}
function releaseClause(clause:string,pub:Date,source:ExpandedSource):{date:string;time:string|null}|null {
  const pattern=MONTHS.map((month)=>`${month}|${month.slice(0,3)}`).join("|")+"|sept",match=clause.match(new RegExp(`\\b(${pattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?`,"i"));if(!match)return null;
  const month=MONTHS.findIndex((value)=>value.startsWith(match[1].toLowerCase()))+1;let year=match[3]?+match[3]:pub.getUTCFullYear();if(!match[3]&&pub.getUTCMonth()===11&&month===1)year++;
  const date=validReleaseDay(year,month,+match[2]);if(!date||Math.abs(Date.parse(date)-pub.getTime())>90*86400000)return null;
  const tm=clause.slice(match.index!+match[0].length).match(/(?:at\s+|,\s*)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(PST|PDT|EST|EDT|ET|PT|JST|KST|GMT|UTC|CEST|CET)?/i);
  if(!tm)return {date,time:null};const raw=+tm[1],minute=+(tm[2]??0);if(raw<1||raw>12||minute>59)return null;
  const hour=raw%12+(tm[3].toUpperCase()==="PM"?12:0),zone=tm[4]?.toUpperCase();if(!zone)return {date,time:null};
  const offset=offsetFor(zone,date,hour,minute);if(offset===null)return {date,time:null};
  const local=source.key==="bodega"?"PT":source.key==="kithNews"?"ET":null;
  if(local&&/^(?:PST|PDT|EST|EDT)$/.test(zone)&&offsetFor(local,date,hour,minute)!==offset)return {date,time:null};
  return seoulDateTime(Date.parse(`${date}T00:00:00Z`)+(hour*60+minute-offset)*60000);
}
function articleRelease(entry:Announcement,source:ExpandedSource,now:Date):AdapterReleaseInput {
  const schedule=parseReleaseArticle(entry.content,entry.published,source);
  return expandedInput(source,now,{externalId:entry.url,title:entry.title,releaseDate:schedule?.date??"",releaseTime:schedule?.time??null,productUrl:entry.url,sourceUrl:entry.url,styleCode:entry.content.match(/\b[A-Z\d]{5,10}-\d{2,3}\b/)?.[0]??null,priceLabel:entry.content.match(/(?:[$£€¥]\s?\d[\d,.]*|\d[\d,]*\s?円)/)?.[0]??null});
}
function structured(html:string,source:ExpandedSource,now:Date):ExpandedParseResult {
  const records:Record<string,unknown>[]=[];
  function walk(value:unknown){if(Array.isArray(value))return value.forEach(walk);if(!isRecord(value))return;const types=Array.isArray(value["@type"])?value["@type"]:[value["@type"]];if(types.some((type)=>["Product","Event","SaleEvent"].includes(String(type))))records.push(value);else if(value["@graph"])walk(value["@graph"]);else if(value.itemListElement)walk(value.itemListElement);else if(value.item)walk(value.item);}
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{walk(JSON.parse(match[1]));}catch{/* A format change is never a confirmed empty release schedule. */}}
  let malformed=0;const releases=records.slice(0,60).flatMap((row)=>{
    const title=stringValue(row.name),url=expandedSafeUrl(row.url,source);if(!title||!url){malformed++;return [];}
    const offers=Array.isArray(row.offers)?row.offers[0]:row.offers,schedule=iso(row.startDate??(isRecord(offers)?offers.availabilityStarts:null)),brand=isRecord(row.brand)?stringValue(row.brand.name):stringValue(row.brand);
    return [expandedInput(source,now,{externalId:stringValue(row.sku)??url,title,brand:brand??source.label,releaseDate:schedule?.date??"",releaseTime:schedule?.time??null,styleCode:stringValue(row.sku),productUrl:url,sourceUrl:url,priceLabel:isRecord(offers)&&offers.price?`${offers.priceCurrency??""} ${offers.price}`.trim():null})];
  });return {recognized:records.length>0,releases,malformed};
}
export function parseExpandedSource(html:string,source:ExpandedSource,now:Date):ExpandedParseResult {
  if(source.key==="lego")return parseLegoAnnouncements(html,source,now);
  if(source.key==="starbucks"){try{return parseStarbucksAnnouncements(JSON.parse(html),source,now);}catch{return empty();}}
  if(source.parser==="atom")return /<feed\b[\s\S]*<\/feed>/i.test(html)?{recognized:true,releases:announcements(html,source,now).map((entry)=>articleRelease(entry,source,now)),malformed:0}:empty();
  return {atmos,end,slamjam,structured}[source.parser](html,source,now);
}
export function createExpandedAdapter(source:ExpandedSource,fetchText=fetchSourceText):ReleaseSourceAdapter {
  return {key:source.key,retailer:source.label,allowedDomains:source.domains,async collect(now):Promise<SourceCollectionResult>{
    try{const url=source.feedUrl??source.url;
      let text:string;
      if(source.key==="starbucks"){
        const payload=await fetchSourceJson("https://www.starbucks.co.kr/whats_new/newsListAjax.do",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Referer:source.url},body:"cate=N01&pageIndex=1&searchKeyword=&searchKey=3"});
        text=JSON.stringify(payload);
      }else{text=await fetchText(url);}
      const parsed=parseExpandedSource(text,source,now);
      if(source.parser==="atom"&&["kithNews","stussyNews"].includes(source.key)){
        const entries=announcements(text,source,now).slice(0,6),details=await Promise.allSettled(entries.map(async(entry)=>{
          if(parseReleaseArticle(entry.content,entry.published,source))return entry;const page=await fetchText(entry.url);
          const body=[...page.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match)=>htmlText(match[1])).filter((paragraph)=>/release[sd]? on|available (?:on|worldwide)|launch(?:es)? on/i.test(paragraph)).join(" ");return {...entry,content:body};
        }));details.forEach((result,index)=>{if(result.status==="fulfilled")parsed.releases[index]=articleRelease(result.value,source,now);});
      }
      if(!parsed.recognized)return {sourceKey:source.key,status:"manual",releases:[],message:"공개 발매 일정 형식 확인 필요 · 공식 사이트에서 확인",confirmedEmpty:false};
      const releases=parsed.releases.filter((item)=>!item.releaseDate||Date.parse(item.releaseDate)>=now.getTime()-90*86400000),dated=releases.filter((item)=>item.releaseDate).length,undated=releases.length-dated;
      return {sourceKey:source.key,status:"connected",releases,message:`발매 ${dated}건${undated?` · 날짜 미정 공지 ${undated}건`:""}${parsed.malformed?` · 확인 필요 ${parsed.malformed}건`:""} · ${source.region}`,confirmedEmpty:false,authoritativeSnapshot:false};
    }catch(error){const status=error instanceof Error?error.message.match(/HTTP \d{3}/)?.[0]:null;return {sourceKey:source.key,status:"error",releases:[],message:status?`${status} · 마지막 확인 일정 유지`:"출처 연결 지연 · 마지막 확인 일정 유지",confirmedEmpty:false};}
  }};
}
export const expandedReleaseSourceAdapters=expandedSourceCatalog.map((source)=>createExpandedAdapter(source));
