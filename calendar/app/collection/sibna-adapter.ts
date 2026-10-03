import { fetchSourceText, htmlText, isRecord, seoulDateTime, stringValue } from "../source-utils.ts";
import type { ReleaseSourceAdapter, SourceCollectionResult } from "./registry.ts";
import type { AdapterReleaseInput, ReleaseCategory } from "./types.ts";

export const SIBNA_RSS_URL = "https://sibna.kr/today/rss.php";
const SIBNA_CALENDAR_URL = "https://sibna.kr/today/upcoming";

export type SibnaParseResult = {
  recognized: boolean;
  releases: AdapterReleaseInput[];
  total: number;
  filtered: number;
  malformed: number;
};

const empty = (): SibnaParseResult => ({recognized:false,releases:[],total:0,filtered:0,malformed:0});
const NON_PRODUCT = /KFC|맥도날드|버거킹|치킨|치킨올데이|햄버거|피자|도넛|케이크|음료\s*(?:출시|행사)|쿠폰|카드\s*혜택|\b(?:coupon|cashback)\b|할인\s*(?:행사|쿠폰)|세금|세금계산서|주식\s*휴장|나스닥|증시|지수|환율|실적\s*발표|경제\s*일정|영화\s*개봉|영화관|콘서트|공연\s*티켓|항공권|여행\s*특가|호텔\s*(?:예약|특가)|서머타임|섬머타임|썸머타임|공식\s*러닝|마라톤|퍼레이드|스포츠\s*경기/iu;
const INFORMATION_PRODUCT = /한정|발매|출시|제품|상품|입고|피규어|미니피겨|키링|굿즈|TCG|카드\s*게임|실버바|골드바|사전\s*주문|사전\s*예약|(?:\s+x\s+|\s+with\s+)|\b(?:drop|delivery|collection|capsule|collab|present)\b|매장\s*오픈|스토어\s*오픈|팝업|(?:서울|부산|베이징|도쿄|싱가폴|싱가포르|중국|일본)\s*오픈/iu;

function text(value: string): string {
  try {
    return htmlText(htmlText(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")));
  } catch { return ""; }
}

function tag(block: string, name: string): string {
  return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,"i"))?.[1] ?? "";
}

function safePostUrl(value: unknown): {url:string;id:string} | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(text(value),"https://sibna.kr");
    const id = url.pathname.match(/^\/today\/post\/(\d+)(?:-|$)/)?.[1];
    if (url.protocol!=="https:" || !["sibna.kr","www.sibna.kr"].includes(url.hostname) || url.username || url.password || url.port || !id) return null;
    url.hostname="sibna.kr";
    url.search="";
    url.hash="";
    return {url:url.href,id};
  } catch { return null; }
}

function eligible(title:string, method:string): boolean {
  if (NON_PRODUCT.test(title) || /29cm\s*29데이|^29데이$/iu.test(title) || /경제|여행|음식|영화|공연/.test(method)) return false;
  if (/선착순|응모|추첨|래플|raffle|first.?come/i.test(method)) return true;
  return INFORMATION_PRODUCT.test(title);
}

function category(title:string): ReleaseCategory {
  if (/레고|lego|포켓몬|pokemon|TCG|카드\s*게임|카드\s*입고|미니피겨|피규어|베어브릭|팝마트|pop\s?mart|dossy|키링|키캡|시계|watch|tumbler|스타벅스|라인프[렌랜]즈|단청|색동|실버바|골드바|조폐공사|iphone|아이폰|전자|게임기|playstation|플레이스테이션/iu.test(title)) return "lifestyle";
  if (/자켓|재킷|jacket|hoodie|shirt|sweat|pants|coat|의류|가방|백팩|리바이스|levis|마똉킴|matin\s?kim/iu.test(title)) return "fashion";
  if (/나이키|nike|조던|jordan|아디다스|adidas|뉴발란스|new\s?balance|아식스|asics|살로몬|salomon|gel[-\s]?|에어\s*(?:맥스|포스)|덩크|dunk|스니커|신발|운동화|크라이오샷|cryoshot|클라우드서퍼|온러닝|마인드\s*00[12]|케이틀린|케이스트릿|푸마|puma/iu.test(title)) return "sneakers";
  return "fashion";
}

function titleMarket(title:string): Pick<AdapterReleaseInput,"region"|"marketScope"> {
  // Manufacturing-origin model names do not identify the selling market.
  const marketTitle=title.replace(/\bmade\s+in\s+(?:south\s+korea|united\s+kingdom|united\s+states|uk|usa|us|korea|japan|china|italy)\b/giu,"");
  const locations:Array<[string,RegExp]>=[
    ["한국",/한국|코리아|\b(?:south\s+korea|korea)\b/iu],
    ["일본",/일본|\bjapan\b/iu],
    ["영국",/영국|\b(?:uk|united\s+kingdom|britain)\b/iu],
    ["미국",/미국|\b(?:usa|us|united\s+states)\b/iu],
    ["유럽",/유럽|\beurope\b/iu],
    ["싱가포르",/싱가폴|싱가포르|\bsingapore\b/iu],
    ["중국",/중국|베이징|\b(?:china|beijing)\b/iu],
    ["홍콩",/홍콩|\bhong\s+kong\b/iu],
    ["대만",/대만|타이완|\btaiwan\b/iu],
    ["캐나다",/캐나다|\bcanada\b/iu],
    ["호주",/호주|\baustralia\b/iu],
    ["네덜란드",/네덜란드|\bnetherlands\b/iu],
    ["덴마크",/덴마크|\bdenmark\b/iu],
    ["이탈리아",/이탈리아|\bitaly\b/iu],
    ["스페인",/스페인|\bspain\b/iu],
    ["독일",/독일|\bgermany\b/iu],
    ["프랑스",/프랑스|\bfrance\b/iu],
  ];
  const found=locations.flatMap(([region,pattern])=>{const match=pattern.exec(marketTitle);return match?[{region,index:match.index}]:[];}).sort((a,b)=>a.index-b.index);
  if (!found.length) return {};
  return {region:found.map(value=>value.region).join("·"),marketScope:found.some(value=>value.region==="한국")?"korea":"overseas"};
}

function day(year:number, month:number, date:number): string | null {
  if (!Number.isInteger(year) || year<2000 || year>2100) return null;
  const parsed=new Date(Date.UTC(year,month-1,date));
  return parsed.getUTCFullYear()===year && parsed.getUTCMonth()===month-1 && parsed.getUTCDate()===date ? parsed.toISOString().slice(0,10) : null;
}

function validDay(value:string): string | null {
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? day(+match[1],+match[2],+match[3]) : null;
}

function time(value: string | undefined): string | null {
  const match=value?.match(/^(\d{1,2}):(\d{2})$/);
  return match && +match[1]<24 && +match[2]<60 ? `${match[1].padStart(2,"0")}:${match[2]}` : null;
}

function moment(date:string, clock:string|null): string {
  return clock ? `${date}T${clock}:00+09:00` : date;
}

function period(value:string, anchor:string): Pick<AdapterReleaseInput,"releaseDate"|"releaseTime"|"startAt"|"endAt"|"startTimeUnknown"|"endTimeUnknown"> | null {
  const match=value.match(/(?:(\d{4})[-/.])?(\d{1,2})[/-](\d{1,2})\s*(?:(\d{1,2}:\d{2})|미정)?\s*[~～–]\s*(?:(\d{4})[-/.])?(\d{1,2})[/-](\d{1,2})\s*(?:(\d{1,2}:\d{2})|미정)?/);
  if (!match || !validDay(anchor)) return null;
  const anchorYear=+anchor.slice(0,4), anchorMs=Date.parse(anchor);
  const starts=(match[1] ? [+match[1]] : [anchorYear-1,anchorYear,anchorYear+1]).map(year=>day(year,+match[2],+match[3])).filter((value):value is string=>Boolean(value));
  const start=starts.sort((a,b)=>Math.abs(Date.parse(a)-anchorMs)-Math.abs(Date.parse(b)-anchorMs))[0];
  if (!start) return null;
  const startYear=+start.slice(0,4),startMs=Date.parse(start);
  const ends=(match[5] ? [+match[5]] : [startYear-1,startYear,startYear+1]).map(year=>day(year,+match[6],+match[7])).filter((value):value is string=>Boolean(value)).filter(value=>Date.parse(value)>=startMs);
  const end=ends.sort()[0];
  if (!end || Date.parse(end)-startMs>366*86400000) return null;
  const startTime=time(match[4]),endTime=time(match[8]);
  if (startTime && endTime && Date.parse(moment(end,endTime))<Date.parse(moment(start,startTime))) return null;
  return {releaseDate:start,releaseTime:startTime,startAt:moment(start,startTime),endAt:moment(end,endTime),startTimeUnknown:!startTime,endTimeUnknown:!endTime};
}

function labeledMoment(description:string, label:string): string | null {
  const match=description.match(new RegExp(`(?:${label})\\s*[:：]?\\s*(\\d{4}-\\d{2}-\\d{2})(?:[T\\s]+(\\d{1,2}:\\d{2}))?`,"i"));
  const date=match ? validDay(match[1]) : null;
  return date ? moment(date,time(match?.[2])) : null;
}

function input(title:string, method:string, source:{url:string;id:string}, now:Date, date:string, clock:string|null): AdapterReleaseInput {
  const codes=[...title.matchAll(/\b[A-Z]{1,5}\d{3,8}-\d{2,4}\b|\bU\d{3,4}[A-Z\d]{2,5}\b/g)].map(match=>match[0]);
  const lego=/레고|lego|미니피겨/iu.test(title) ? title.match(/#(\d{5,6})\b/)?.[1] : null;
  const price=title.match(/(\d[\d,]*(?:\.\d+)?)\s*원\b|((?:\d[\d,]*(?:\.\d+)?))\s*원/);
  return {sourceKey:"sibna",externalId:`sibna:${source.id}`,title,brand:null,categoryHint:category(title),releaseKindHint:/응모|추첨|래플|raffle/i.test(method+" "+title)?"raffle":/오픈|팝업|오프라인/.test(title)?"offline":undefined,releaseDate:date,releaseTime:clock,priceLabel:price?`${price[1]??price[2]}원`:null,styleCode:lego??(new Set(codes).size===1?codes[0]:null),retailer:"SIBNA 발매정보",productUrl:source.url,sourceUrl:source.url,collectedAt:now.toISOString(),allowedDomains:["sibna.kr"],releaseMethod:method||null,note:"SIBNA 공개 발매정보 · 판매처 원문에서 최종 일정 확인",...titleMarket(title)};
}

export function parseSibnaRss(xml:string, now:Date): SibnaParseResult {
  const result=empty();
  if (!/<rss\b/i.test(xml) || !/<channel\b/i.test(xml) || !/<\/rss>/i.test(xml)) return result;
  result.recognized=true;
  const seen=new Set<string>();
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    result.total++;
    const title=text(tag(match[1],"title")),description=text(tag(match[1],"description")),source=safePostUrl(tag(match[1],"link"));
    if (!title || !source) {result.malformed++;continue;}
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const method=description.match(/진행방식\s*[:：]?\s*([^·|]+)/)?.[1]?.replace(/원문\s*보기.*$/," ").trim() ?? text(tag(match[1],"category"));
    if (!eligible(title,method)) {result.filtered++;continue;}
    const dateMatch=description.match(/발매일\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/),date=dateMatch?validDay(dateMatch[1]):null;
    const clock=time(description.match(/발매시간\s*[:：]?\s*(\d{1,2}:\d{2})/)?.[1]);
    const release=input(title,method,source,now,date??"",clock);
    if (date) Object.assign(release,period(description,date)??{});
    const start=labeledMoment(description,"응모시작|응모 시작|판매시작|판매 시작"),end=labeledMoment(description,"응모마감|응모 마감|응모종료|응모 종료|판매종료|판매 종료"),announcement=labeledMoment(description,"당첨자 발표|결과 발표|당첨발표");
    if (start) {release.startAt=start;release.startTimeUnknown=!start.includes("T");release.releaseDate=start.slice(0,10);release.releaseTime=start.includes("T")?start.slice(11,16):null;}
    if (end) {release.endAt=end;release.endTimeUnknown=!end.includes("T");}
    if (announcement) release.announcementAt=announcement;
    result.releases.push(release);
  }
  return result;
}

export function parseSibnaCalendar(html:string, now:Date): SibnaParseResult {
  const result=empty(),match=html.match(/<script\b[^>]*\bid=["']calendarPanelData["'][^>]*>([\s\S]*?)<\/script>/i);
  let panel:unknown;
  try {panel=match?JSON.parse(match[1]):null;} catch {return result;}
  if (!isRecord(panel)) return result;
  result.recognized=true;
  const seen=new Set<string>();
  for (const [anchor,entries] of Object.entries(panel).sort(([a],[b])=>a.localeCompare(b))) {
    if (!isRecord(entries) || !Array.isArray(entries.items)) continue;
    for (const row of entries.items) {
      result.total++;
      if (!isRecord(row)) {result.malformed++;continue;}
      const title=stringValue(row.title),source=safePostUrl(row.url),method=stringValue(row.method)??"";
      if (!title || !source) {result.malformed++;continue;}
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      if (!eligible(title,method)) {result.filtered++;continue;}
      const date=validDay(anchor),clockText=stringValue(row.time)??"";
      const release=input(text(title),method,source,now,date??"",time(clockText));
      if (date) Object.assign(release,period(clockText,date)??{});
      result.releases.push(release);
    }
  }
  return result;
}

export function createSibnaAdapter(fetchText=fetchSourceText, options:{includeCalendar?:boolean}={}): ReleaseSourceAdapter {
  return {key:"sibna",retailer:"SIBNA 발매정보",allowedDomains:["sibna.kr"],async collect(now):Promise<SourceCollectionResult> {
    const current=seoulDateTime(now)?.date.slice(0,7)??now.toISOString().slice(0,7);
    const [year,month]=current.split("-").map(Number),next=new Date(Date.UTC(year,month,1)).toISOString().slice(0,7);
    const urls=[SIBNA_RSS_URL,...(options.includeCalendar===false?[]:[`${SIBNA_CALENDAR_URL}?month=${current}`,`${SIBNA_CALENDAR_URL}?month=${next}`])];
    const responses=await Promise.allSettled(urls.map(async(url)=>url===SIBNA_RSS_URL?parseSibnaRss(await fetchText(url),now):parseSibnaCalendar(await fetchText(url),now)));
    const releases=new Map<string,AdapterReleaseInput>();let succeeded=0,failed=0,filtered=0;
    for (const response of responses) {
      if (response.status!=="fulfilled" || !response.value.recognized) {failed++;continue;}
      succeeded++;filtered+=response.value.filtered;
      for (const release of response.value.releases) {
        const previous=releases.get(release.externalId);
        releases.set(release.externalId,previous?{...previous,...release,releaseDate:release.releaseDate||previous.releaseDate,releaseTime:release.releaseTime??previous.releaseTime}:release);
      }
    }
    const items=[...releases.values()],dated=items.filter(item=>item.releaseDate).length;
    return {sourceKey:"sibna",status:succeeded?"connected":"error",releases:items,confirmedEmpty:false,authoritativeSnapshot:false,message:succeeded?`SIBNA 공개 정보 · 발매 ${dated}건${items.length-dated?` · 날짜 미정 ${items.length-dated}건`:""} · 일반 행사 제외 ${filtered}건${failed?` · 일부 연결 실패 ${failed}곳`:""}`:"SIBNA 공개 정보 연결 실패 · 마지막 확인 일정 유지"};
  }};
}

export const sibnaReleaseAdapter=createSibnaAdapter();
