import { officialInstagramAccounts, findOfficialInstagramAccount, type OfficialInstagramAccount } from "../instagram-accounts.ts";
import { canonicalizeInstagramPostUrl } from "../sns-links.ts";
import { isRecord, seoulDateTime, stringValue, withSourceRequest } from "../source-utils.ts";
import type { ReleaseSourceAdapter, SourceCollectionResult } from "./registry.ts";
import type { AdapterReleaseInput } from "./types.ts";

type InstagramSettings = {
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID?: string;
  INSTAGRAM_GRAPH_VERSION?: string;
  INSTAGRAM_SOURCE_HANDLES?: string;
};

type InstagramAdapterOptions = {
  accounts?: readonly OfficialInstagramAccount[];
  concurrency?: number;
  deadlineMs?: number;
  perRequestMs?: number;
};

async function settings(): Promise<InstagramSettings> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as InstagramSettings;
  } catch { return process.env as InstagramSettings; }
}

const RELEASE_CUE = /발매|출시|래플|응모|\breleases?\b|\blaunch\b|\bdrop\b|\bavailable\b|発売|抽選/i;
const PRODUCT_PREVIEW_CUE = /\bplush(?:ies|es)?\b|\bkeyrings?\b|\bfigurines?\b|\bcollectibles?\b|한정\s*상품|인형|키링/i;
const RAFFLE_CUE = /래플|응모|추첨|\braffle\b|\bdraw\b|抽選/i;
const AMBIGUOUS_ZONE = /\b(?:EST|EDT|PST|PDT|CET|CEST|GMT|BST|JST)\b/i;
const MONTHS = "january february march april may june july august september october november december".split(" ");

export function hasInstagramReleaseCue(caption: string): boolean {
  return RELEASE_CUE.test(caption) || (/\bstay tuned\b/i.test(caption) && PRODUCT_PREVIEW_CUE.test(caption));
}

function dateRelevant(caption:string,index:number,end:number): boolean {
  const before=caption.slice(0,index).split(/\r?\n/).at(-1) ?? "";
  const line=before+caption.slice(index).split(/\r?\n/)[0];
  if (/촬영|촬영일|생일|게시일|\b(?:filmed|filming|photo(?:shoot)?|shoot|birthday|posted|published|copyright)\b/i.test(line)) return false;
  if (/\bstay tuned\b/i.test(line) && !RELEASE_CUE.test(line)) return false;
  return RELEASE_CUE.test(caption.slice(Math.max(0,index-100),Math.min(caption.length,end+100)));
}

function validDay(year: number, month: number, day: number): string | null {
  if (year<2000 || year>2100) return null;
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date.toISOString().slice(0,10) : null;
}

type CaptionDate = { date:string|null; index:number; end:number };
function explicitDates(caption: string, publishedAt?: string | null): CaptionDate[] {
  const dates:CaptionDate[]=[];
  for (const match of caption.matchAll(/(?<!\d)(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})(?:\s*일)?(?!\d)/gu)) {
    dates.push({date:validDay(+match[1],+match[2],+match[3]),index:match.index,end:match.index+match[0].length});
  }
  for (const match of caption.matchAll(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/g)) {
    const month=MONTHS.findIndex((value)=>value===match[1].toLowerCase() || value.slice(0,3)===match[1].toLowerCase());
    if (month>=0) dates.push({date:validDay(+match[3],month+1,+match[2]),index:match.index,end:match.index+match[0].length});
  }
  const anchor=publishedAt && /^20\d{2}-\d{2}-\d{2}T/.test(publishedAt) ? new Date(publishedAt) : null;
  const anchorMs=anchor?.getTime() ?? NaN;
  const year=anchor?.getUTCFullYear() ?? 0;
  const nearbyDay=(month:number,day:number)=>{
    if (!Number.isFinite(anchorMs)) return null;
    const candidates=[year-1,year,year+1].flatMap((candidateYear)=>{
      const candidate=validDay(candidateYear,month,day);
      const distance=candidate ? Math.abs(Date.parse(`${candidate}T12:00:00+09:00`)-anchorMs) : Infinity;
      return candidate && distance<=120*86_400_000 ? [{candidate,distance}] : [];
    }).sort((left,right)=>left.distance-right.distance);
    return candidates.length===1 ? candidates[0].candidate : null;
  };
  const addPartial=(match:RegExpMatchArray,month:number,day:number)=>{
    const index=match.index!,end=index+match[0].length;
    if (dates.some((date)=>index<date.end && end>date.index)) return;
    // The date is still stated by the brand. Publication only supplies its year,
    // and only for a nearby, unambiguous release notice, including year rollover.
    if (!dateRelevant(caption,index,end)) return;
    dates.push({date:nearbyDay(month,day),index,end});
  };
  for (const match of caption.matchAll(/(?<![\d./-])(\d{1,2})\s*(?:[./-]|월)\s*(\d{1,2})(?:\s*일)?(?!\d)/gu)) addPartial(match,+match[1],+match[2]);
  for (const match of caption.matchAll(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const month=MONTHS.findIndex((value)=>value===match[1].toLowerCase() || value.slice(0,3)===match[1].toLowerCase());
    if (month>=0) addPartial(match,month+1,+match[2]);
  }
  return dates.filter(({index,end})=>dateRelevant(caption,index,end)).sort((left,right)=>left.index-right.index);
}

function captionTime(fragment: string): string | null {
  const numeric=fragment.match(/(?:^|[\sT,])(?:(AM|PM)\s*)?(\d{1,2}):(\d{2})(?:\s*(AM|PM))?(?!\d)/i);
  const korean=fragment.match(/(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/u);
  if (!numeric && !korean) return null;
  const marker=(numeric?.[1] ?? numeric?.[4] ?? korean?.[1] ?? "").toLowerCase();
  let hour=+(numeric?.[2] ?? korean![2]);
  const minute=+(numeric?.[3] ?? korean?.[3] ?? "0");
  if (marker) {
    if (hour<1 || hour>12) return null;
    hour=hour%12+(/pm|오후/.test(marker)?12:0);
  }
  return hour>=0 && hour<24 && minute>=0 && minute<60 ? `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}` : null;
}

function scheduleMoment(caption: string, date: CaptionDate, account: OfficialInstagramAccount): {date:string;time:string|null;at:string;unknown:boolean} | null {
  if (!date.date || AMBIGUOUS_ZONE.test(caption)) return null;
  const fragment=caption.slice(date.end).split(/\r?\n/)[0];
  const time=captionTime(fragment);
  const explicitKst=/\bKST\b|한국\s*시간|서울\s*시간|UTC\s*\+\s*0?9(?::?00)?/iu.test(caption);
  const offset=fragment.match(/(?:UTC\s*)?([+-](?:0\d|1[0-4]):?[0-5]\d)\b/i)?.[1];
  if (time && offset) {
    const normalized=offset.length===5 ? `${offset.slice(0,3)}:${offset.slice(3)}` : offset;
    const kst=seoulDateTime(`${date.date}T${time}:00${normalized}`);
    return kst ? {...kst,at:`${kst.date}T${kst.time}:00+09:00`,unknown:false} : null;
  }
  const localTime=(account.marketScope==="korea" || explicitKst) ? time : null;
  return {date:date.date,time:localTime,at:localTime ? `${date.date}T${localTime}:00+09:00` : date.date,unknown:localTime===null};
}

export function parseInstagramCaptionSchedule(caption: string, account: OfficialInstagramAccount, publishedAt?: string | null): Partial<AdapterReleaseInput> {
  // Product teasers can be useful review candidates, but "stay tuned" gives
  // neither a sale date nor an entry period, even when it names a calendar day.
  if (!RELEASE_CUE.test(caption)) return {};
  const dates=explicitDates(caption,publishedAt);
  if (!dates.length || dates.some(({date})=>!date)) return {};
  const unique=[...new Set(dates.map(({date})=>date))];
  // Several markets or product dates are ambiguous. Only explicitly labelled
  // raffle start/end lines make a period safe to publish automatically.
  const labelled=(marker:RegExp)=>dates.filter((date)=>marker.test(caption.slice(0,date.index).split(/\r?\n/).at(-1) ?? ""));
  const starts=labelled(/응모\s*(?:시작|오픈)|(?:raffle|draw)\s*(?:starts?|opens?)|(?:start|open)\s*(?:date|time)?\s*[:：]/i);
  const ends=labelled(/응모\s*(?:종료|마감)|(?:raffle|draw)\s*(?:ends?|closes?)|(?:end|close)\s*(?:date|time)?\s*[:：]/i);
  if (RAFFLE_CUE.test(caption) && (starts.length || ends.length)) {
    if (starts.length!==1 || ends.length!==1 || unique.length>2) return {};
    const start=scheduleMoment(caption,starts[0],account),end=scheduleMoment(caption,ends[0],account);
    if (!start || !end || start.at>end.at) return {};
    return {releaseDate:end.date,releaseTime:end.time,startAt:start.at,endAt:end.at,startTimeUnknown:start.unknown,endTimeUnknown:end.unknown};
  }
  if (unique.length!==1) return {};
  const moment=scheduleMoment(caption,dates[0],account);
  return moment ? {releaseDate:moment.date,releaseTime:moment.time} : {};
}

export function parseInstagramAnnouncements(payload: unknown, handle: string, now: Date, account = findOfficialInstagramAccount(handle)): AdapterReleaseInput[] {
  if (!isRecord(payload) || !isRecord(payload.business_discovery) || !isRecord(payload.business_discovery.media) || !Array.isArray(payload.business_discovery.media.data)) return [];
  const normalizedHandle=handle.toLowerCase().replace(/^@/,"");
  const returnedHandle=stringValue(payload.business_discovery.username)?.toLowerCase();
  if (returnedHandle && returnedHandle!==normalizedHandle) return [];
  const verified=account?.handle===normalizedHandle && returnedHandle===normalizedHandle;
  return payload.business_discovery.media.data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const caption=stringValue(item.caption),url=canonicalizeInstagramPostUrl(String(item.permalink ?? "")),id=stringValue(item.id);
    if (!caption || !id || !url || !hasInstagramReleaseCue(caption)) return [];
    const schedule=verified ? parseInstagramCaptionSchedule(caption,account,stringValue(item.timestamp)) : {};
    const isRaffle=RAFFLE_CUE.test(caption);
    const previewOnly=!RELEASE_CUE.test(caption);
    return [{sourceKey:"sns",externalId:`instagram:${normalizedHandle}:${id}`,title:caption.split(/\r?\n/).find((line)=>line.trim())!.slice(0,180),brand:account?.label ?? normalizedHandle,categoryHint:PRODUCT_PREVIEW_CUE.test(caption) || /LEGO|Pop Mart|LINE FRIENDS/i.test(account?.label ?? "") ? "lifestyle" as const : /스니커|운동화|슈즈|sneaker|\bshoe\b|\bXT-\d/i.test(caption)?"sneakers" as const:"fashion" as const,releaseKindHint:isRaffle?"raffle" as const:undefined,releaseDate:"",releaseTime:null,priceLabel:null,styleCode:caption.match(/\b[A-Z\d]{5,10}-\d{2,3}\b/)?.[0] ?? null,retailer:`Instagram @${normalizedHandle}`,productUrl:url,sourceUrl:url,collectedAt:now.toISOString(),allowedDomains:["instagram.com"],region:account?.region,marketScope:account?.marketScope,releaseMethod:isRaffle?"응모":previewOnly?"정보":"선착순",note:verified ? `브랜드 공식 Instagram @${normalizedHandle} 공지${schedule.releaseDate ? " · 캡션에 명시된 일정" : previewOnly ? " · 제품 안내 공지 · 판매·응모 일정 미확인" : " · 날짜·시간 확인 필요"}` : `Instagram @${normalizedHandle} · 공식 계정 확인 필요`,...schedule}];
  });
}

export function createInstagramAdapter(resolveSettings = settings, request = fetch, options:InstagramAdapterOptions = {}): ReleaseSourceAdapter {
  return {key:"sns",retailer:"Instagram 공식 공지",allowedDomains:["instagram.com"],async collect(now): Promise<SourceCollectionResult> {
    const config=await resolveSettings(),accounts=options.accounts ?? officialInstagramAccounts;
    const configured=(config.INSTAGRAM_SOURCE_HANDLES ?? "").split(",").map((handle)=>handle.trim().replace(/^@/,"").toLowerCase()).filter((handle)=>/^[a-z\d._]{1,30}$/i.test(handle));
    const handles=[...new Set(configured.length ? configured : accounts.map(({handle})=>handle))].slice(0,40);
    if (!config.INSTAGRAM_ACCESS_TOKEN || !/^\d+$/.test(config.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "") || !/^v\d+\.\d+$/.test(config.INSTAGRAM_GRAPH_VERSION ?? "") || !handles.length) {
      return {sourceKey:"sns",status:"manual",releases:[],message:`Instagram 자동수집 미연결 · 공식 계정 ${accounts.length}개 등록 · Meta 인증 필요`,confirmedEmpty:false};
    }
    const releases:AdapterReleaseInput[]=[],controller=new AbortController();
    const deadline=setTimeout(()=>controller.abort(),options.deadlineMs ?? 18_000);
    let cursor=0,failed=0,connected=0;
    const loadAccount=async(handle:string)=>withSourceRequest(async()=>{
      if (controller.signal.aborted) return null;
      const requestController=new AbortController();
      const abort=()=>requestController.abort();
      controller.signal.addEventListener("abort",abort,{once:true});
      const timeout=setTimeout(abort,options.perRequestMs ?? 8_000);
      try {
        const url=new URL(`https://graph.facebook.com/${config.INSTAGRAM_GRAPH_VERSION}/${config.INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
        url.searchParams.set("fields",`business_discovery.username(${handle}){username,media.limit(25){id,caption,permalink,timestamp}}`);
        // Race also settles a stalled body stream, and never stores raw Meta
        // errors or access tokens in source health. Late responses cannot append.
        const operation=(async()=>{
          const response=await request(url,{headers:{Authorization:`Bearer ${config.INSTAGRAM_ACCESS_TOKEN}`},signal:requestController.signal,cache:"no-store",redirect:"error"});
          if (!response.ok) {await response.body?.cancel().catch(()=>{});return null;}
          const payload:unknown=await response.json();
          return isRecord(payload) && isRecord(payload.business_discovery) && stringValue(payload.business_discovery.username)?.toLowerCase()===handle && isRecord(payload.business_discovery.media) && Array.isArray(payload.business_discovery.media.data) ? payload : null;
        })();
        let abortListener:()=>void=()=>{};
        const aborted=new Promise<null>((resolve)=>{abortListener=()=>resolve(null);requestController.signal.addEventListener("abort",abortListener,{once:true});if(requestController.signal.aborted)resolve(null);});
        try {return await Promise.race([operation,aborted]);}
        finally {requestController.signal.removeEventListener("abort",abortListener);}
      } catch {return null;} finally {clearTimeout(timeout);controller.signal.removeEventListener("abort",abort);}
    });
    const requestAccount=async(handle:string)=>{
      let abortListener:()=>void=()=>{};
      const aborted=new Promise<null>((resolve)=>{abortListener=()=>resolve(null);controller.signal.addEventListener("abort",abortListener,{once:true});if(controller.signal.aborted)resolve(null);});
      // Include time spent waiting for other sources' shared request slots.
      // A queued operation sees the aborted signal before making any request.
      try {return await Promise.race([loadAccount(handle),aborted]);}
      finally {controller.signal.removeEventListener("abort",abortListener);}
    };
    const workers=Array.from({length:Math.min(handles.length,Math.max(1,Math.min(4,Math.floor(options.concurrency ?? 4))))},async()=>{
      while (cursor<handles.length && !controller.signal.aborted) {
        const handle=handles[cursor++],payload=await requestAccount(handle);
        if (!payload) {failed++;continue;}
        connected++;
        releases.push(...parseInstagramAnnouncements(payload,handle,now,accounts.find((account)=>account.handle===handle)));
      }
    });
    try {await Promise.all(workers);} finally {clearTimeout(deadline);controller.abort();}
    failed+=handles.length-cursor;
    const dated=releases.filter(({releaseDate})=>Boolean(releaseDate)).length;
    return {sourceKey:"sns",status:connected ? "connected":"error",releases,message:connected ? `Instagram 계정 ${connected}/${handles.length}개 확인 · 일정 ${dated}건 · 검토 ${releases.length-dated}건${failed ? ` · 미확인 ${failed}개`:""}` : "Instagram 권한·연결 확인 필요 · 기존 공지 유지",confirmedEmpty:false,authoritativeSnapshot:false};
  }};
}

export const instagramReleaseAdapter=createInstagramAdapter();
