import {expandedSourceCatalog,type ExpandedSource} from "../expanded-sources.ts";
import {fetchSourceText,htmlText,seoulDateTime} from "../source-utils.ts";
import {expandedInput,expandedSafeUrl,validReleaseDay,type ExpandedParseResult} from "./expanded-adapters.ts";
import type {ReleaseSourceAdapter,SourceCollectionResult} from "./registry.ts";

const source=(key:string)=>expandedSourceCatalog.find(item=>item.key===key)!;
const classBody=(html:string,tag:string,name:string):string|null=>html.match(new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${name}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,"i"))?.[1]??null;
function fullDay(value:string):string|null {
  const match=value.trim().match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  return match?validReleaseDay(+match[1],+match[2],+match[3]):null;
}

/** This site's product list date was checked against the detail's explicit 발매일 field. */
export function parseOnepieceProducts(html:string,now:Date):ExpandedParseResult {
  const itemSource=source("onepieceCard"),list=classBody(html,"ul","product_list");
  if(list===null)return {recognized:false,releases:[],malformed:0};
  let malformed=0;
  const releases=[...list.matchAll(/<a\b([^>]*class=["'][^"']*\bdesc_wrap\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)].flatMap((match)=>{
    const href=match[1].match(/href=["']([^"']+)["']/i)?.[1];
    const url=href?expandedSafeUrl(href,itemSource):null;
    const title=htmlText(classBody(match[2],"span","tit")??""),date=fullDay(htmlText(classBody(match[2],"span","date")??""));
    const id=url?new URL(url).searchParams.get("brdno"):null;
    if(!title||!url||!id||!/^\d+$/.test(id)||!date){malformed++;return [];}
    return [expandedInput(itemSource,now,{externalId:`onepiece:${id}`,title,brand:"ONE PIECE CARD GAME",releaseDate:date,releaseTime:null,releaseMethod:"정보",productUrl:url,sourceUrl:url,priceLabel:htmlText(classBody(match[2],"span","price_wrap")??"")||null,styleCode:title.match(/\[(\w+-\d+)\]/)?.[1]??null})];
  });
  return {recognized:true,releases,malformed};
}

export function pokemonProductUrls(html:string):string[] {
  const urls=[...html.matchAll(/<article\b[^>]*class=["'][^"']*\bwhite-panel\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)].flatMap((item)=>{
    const path=item[1].match(/location\.href\s*=\s*['"](\/card\/\d+)['"]/)?.[1];
    return path?[`https://pokemoncard.co.kr${path}`]:[];
  });
  return [...new Set(urls)];
}
export function parsePokemonProduct(html:string,url:string,now:Date):ExpandedParseResult {
  const itemSource=source("pokemonCard"),safe=expandedSafeUrl(url,itemSource);
  const title=htmlText(classBody(html,"h3","medium-title")??"");
  if(!safe||!/^\/card\/\d+$/.test(new URL(safe).pathname)||!title)return {recognized:false,releases:[],malformed:0};
  const fields=new Map([...html.matchAll(/<li\b[^>]*>\s*<b\b[^>]*>([^<]+)<\/b>([\s\S]*?)<\/li>/gi)].map(match=>[htmlText(match[1]),htmlText(match[2])]));
  const date=fullDay(fields.get("발매일")??"");
  if(!fields.has("발매일"))return {recognized:false,releases:[],malformed:1};
  return {recognized:true,malformed:date?0:1,releases:[expandedInput(itemSource,now,{externalId:`pokemon:${new URL(safe).pathname.split('/').at(-1)}`,title,brand:"POKEMON TCG",releaseDate:date??"",releaseTime:null,releaseMethod:"정보",priceLabel:fields.get("가격")||null,productUrl:safe,sourceUrl:safe})]};
}

function museumSaleDate(title:string,now:Date):{date:string;time:string|null}|null {
  // Parse the explicitly labelled sale schedule, never product IDs or competition years.
  const sale=title.match(/(?:판매|발매|출시)[^:：)]*[:：]\s*(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:\s*\(([일월화수목금토])\))?\s*(.*)/);
  if(!sale)return null;
  const year=Number(seoulDateTime(now)!.date.slice(0,4));
  const candidates=(sale[1]?[+sale[1]]:[year-1,year,year+1]).flatMap(y=>{
    const date=validReleaseDay(y,+sale[2],+sale[3]);
    if(!date||(!sale[1]&&Math.abs(Date.parse(`${date}T12:00:00+09:00`)-now.getTime())>90*86400000))return [];
    if(sale[4]&&"일월화수목금토"[new Date(`${date}T00:00:00Z`).getUTCDay()]!==sale[4])return [];
    return [date];
  });
  if(candidates.length!==1)return null;
  const clock=sale[5].match(/(오전|오후)\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  let time:string|null=null;
  if(clock&&+clock[2]>=1&&+clock[2]<=12&&+(clock[3]??0)<=59){const hour=+clock[2]%12+(clock[1]==="오후"?12:0);time=`${String(hour).padStart(2,"0")}:${String(clock[3]??0).padStart(2,"0")}`;}
  return {date:candidates[0],time};
}
export function parseMuseumProducts(html:string,now:Date):ExpandedParseResult {
  const itemSource=source("museumShop");
  if(!/id=["']goodsListUl["']/i.test(html))return {recognized:false,releases:[],malformed:0};
  const releases=[...html.matchAll(/<li\b[^>]*class=["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].flatMap((item)=>{
    const codes=item[1].match(/fn_productView2\(\s*'([\d]+)'\s*,\s*'([\d]+)'/),title=htmlText(classBody(item[1],"div","tit")??"");
    if(!codes||!title)return [];
    const schedule=museumSaleDate(title,now);
    if(!schedule)return []; // Ordinary in-stock goods do not become calendar entries.
    const url=`https://www.museumshop.or.kr/kor/product/product_view.do?str_bcode=${codes[1]}&str_goodcode=${codes[2]}`;
    const price=htmlText(classBody(item[1],"span","price")??"");
    return [expandedInput(itemSource,now,{externalId:`museum:${codes[2]}:${schedule.date}`,title,brand:"뮷즈",releaseDate:schedule.date,releaseTime:schedule.time,releaseMethod:/온라인/.test(title)?"온라인 판매":"정보",priceLabel:price?`${price}원`:null,productUrl:url,sourceUrl:url,note:/완판/.test(title)?"공식 상품명에 완판으로 표시됨":"공식 상품명에 명시된 판매 일정"})];
  });
  return {recognized:true,releases,malformed:0};
}

export function createOfficialProductAdapter(key:"onepieceCard"|"pokemonCard"|"museumShop",fetchText=fetchSourceText,deadlineMs=18_000):ReleaseSourceAdapter {
  const itemSource=source(key);
  return {key,retailer:itemSource.label,allowedDomains:itemSource.domains,async collect(now):Promise<SourceCollectionResult>{
    const releases:ExpandedParseResult["releases"]=[];let success=0,failed=0;
    const deadline=Date.now()+deadlineMs;
    async function boundedText(url:string):Promise<string>{
      const remaining=deadline-Date.now();if(remaining<=0)throw new Error("Source deadline exceeded");
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{return await Promise.race([fetchText(url),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Source deadline exceeded")),remaining);})]);}
      finally{if(timer!==undefined)clearTimeout(timer);}
    }
    async function read(url:string,parse:(html:string)=>ExpandedParseResult){try{const result=parse(await boundedText(url));if(!result.recognized){failed++;return;}success++;releases.push(...result.releases);}catch{failed++;}}
    if(key==="onepieceCard"){
      // Six pages are linked by the official public list; retain their historic product schedules.
      await Promise.all([itemSource.url,...Array.from({length:5},(_,i)=>`${itemSource.url}?page=${i+1}&size=12&extraValue=`)].map(url=>read(url,html=>parseOnepieceProducts(html,now))));
    }else if(key==="museumShop"){
      await Promise.all(["003000000","002000000"].map(code=>read(`https://www.museumshop.or.kr/kor/product/product_li.do?str_bcode=${code}`,html=>parseMuseumProducts(html,now))));
    }else{
      const lists=await Promise.allSettled(["info1","info2","info3"].map(kind=>boundedText(`https://pokemoncard.co.kr/card/category/${kind}`)));
      const urls=[...new Set(lists.flatMap(result=>result.status==="fulfilled"?pokemonProductUrls(result.value).slice(0,6):[]))];
      failed+=lists.filter(result=>result.status==="rejected").length;
      if(!urls.length)failed++;
      // Bounded read of actual public product links, four at a time.
      for(let i=0;i<urls.length;i+=4){if(Date.now()>=deadline){failed+=urls.length-i;break;}await Promise.all(urls.slice(i,i+4).map(url=>read(url,html=>parsePokemonProduct(html,url,now))));}
    }
    const unique=[...new Map(releases.map(item=>[item.externalId,item])).values()];
    const dated=unique.filter(item=>item.releaseDate).length;
    return {sourceKey:key,status:success?"connected":"error",releases:unique,confirmedEmpty:false,authoritativeSnapshot:false,message:success?`공식 제품정보 직접 확인 · 발매 ${dated}건${unique.length-dated?` · 날짜 미정 ${unique.length-dated}건`:""}${failed?` · 일부 연결 실패 ${failed}곳`:""}`:"공식 제품정보 연결 실패 · 마지막 확인 일정 유지"};
  }};
}
export const officialProductAdapters=[createOfficialProductAdapter("onepieceCard"),createOfficialProductAdapter("pokemonCard"),createOfficialProductAdapter("museumShop")];
