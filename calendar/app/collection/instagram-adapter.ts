import { canonicalizeInstagramPostUrl } from "../sns-links.ts";
import { isRecord, stringValue, withSourceRequest } from "../source-utils.ts";
import type { ReleaseSourceAdapter, SourceCollectionResult } from "./registry.ts";
import type { AdapterReleaseInput } from "./types.ts";

type InstagramSettings = {
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_BUSINESS_ACCOUNT_ID?: string;
  INSTAGRAM_GRAPH_VERSION?: string;
  INSTAGRAM_SOURCE_HANDLES?: string;
};

async function settings(): Promise<InstagramSettings> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as InstagramSettings;
  } catch { return process.env as InstagramSettings; }
}

export function parseInstagramAnnouncements(payload: unknown, handle: string, now: Date): AdapterReleaseInput[] {
  if (!isRecord(payload) || !isRecord(payload.business_discovery) || !isRecord(payload.business_discovery.media) || !Array.isArray(payload.business_discovery.media.data)) return [];
  return payload.business_discovery.media.data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const caption = stringValue(item.caption), url = canonicalizeInstagramPostUrl(String(item.permalink ?? ""));
    if (!caption || !url || !/발매|출시|래플|응모|release|launch|drop|available|発売|抽選/i.test(caption)) return [];
    // Captions can mix several regions and deadlines. Confirm the schedule in review,
    // and never reuse Instagram's publication timestamp as the release date.
    return [{sourceKey:"sns",externalId:`instagram:${handle}:${item.id}`,title:caption.split(/\r?\n/).find((line)=>line.trim())!.slice(0,180),brand:handle,categoryHint:"fashion" as const,releaseDate:"",releaseTime:null,priceLabel:null,styleCode:caption.match(/\b[A-Z\d]{5,10}-\d{2,3}\b/)?.[0] ?? null,retailer:`Instagram @${handle}`,productUrl:url,sourceUrl:url,collectedAt:now.toISOString(),allowedDomains:["instagram.com"]}];
  });
}

export function createInstagramAdapter(resolveSettings = settings, request = fetch): ReleaseSourceAdapter {
  return {key:"sns",retailer:"Instagram 공식 공지",allowedDomains:["instagram.com"],async collect(now): Promise<SourceCollectionResult> {
    const config = await resolveSettings();
    const handles = [...new Set((config.INSTAGRAM_SOURCE_HANDLES ?? "").split(",").map((handle)=>handle.trim().replace(/^@/,"")).filter((handle)=>/^[a-z\d._]{1,30}$/i.test(handle)))].slice(0,20);
    if (!config.INSTAGRAM_ACCESS_TOKEN || !/^\d+$/.test(config.INSTAGRAM_BUSINESS_ACCOUNT_ID ?? "") || !/^v\d+\.\d+$/.test(config.INSTAGRAM_GRAPH_VERSION ?? "") || !handles.length) {
      return {sourceKey:"sns",status:"manual",releases:[],message:"Instagram 공식 API 연결 필요 · 공지 링크 등록 가능",confirmedEmpty:false};
    }
    const releases: AdapterReleaseInput[] = [];
    let failed = 0;
    // Deliberately serialize this connector to stay inside Meta's account rate limits.
    for (const handle of handles) {
      await withSourceRequest(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(()=>controller.abort(),8_000);
        try {
          const url = new URL(`https://graph.facebook.com/${config.INSTAGRAM_GRAPH_VERSION}/${config.INSTAGRAM_BUSINESS_ACCOUNT_ID}`);
          url.searchParams.set("fields",`business_discovery.username(${handle}){username,media.limit(10){id,caption,permalink,timestamp}}`);
          const response = await request(url,{headers:{Authorization:`Bearer ${config.INSTAGRAM_ACCESS_TOKEN}`},signal:controller.signal,cache:"no-store"});
          if (!response.ok) {await response.body?.cancel().catch(()=>{});failed++;return;}
          const payload: unknown = await response.json();
          if (!isRecord(payload) || !isRecord(payload.business_discovery)) {failed++;return;}
          releases.push(...parseInstagramAnnouncements(payload,handle,now));
        } catch { failed++; } finally {clearTimeout(timeout);}
      });
    }
    return {sourceKey:"sns",status:failed===handles.length ? "error":"connected",releases,message:failed===handles.length ? "Instagram 권한·연결 확인 필요 · 기존 공지 유지" : `공식 계정 ${handles.length-failed}개 · 공지 ${releases.length}건${failed ? ` · 연결 실패 ${failed}개`:""}`,confirmedEmpty:false,authoritativeSnapshot:false};
  }};
}

export const instagramReleaseAdapter = createInstagramAdapter();
