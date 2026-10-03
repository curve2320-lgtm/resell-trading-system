import type {ExpandedSource} from "../expanded-sources.ts";
import {isRecord, stringValue, htmlText} from "../source-utils.ts";
import {expandedScriptJson, expandedSafeUrl, expandedInput, validReleaseDay, type ExpandedParseResult} from "./expanded-adapters.ts";

const MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
function dateIn(value:string):string|null {
  const first=value.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December),?\s+(20\d{2})/i);
  const second=value.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/i);
  if(first)return validReleaseDay(+first[3],MONTHS.indexOf(first[2].toLowerCase())+1,+first[1]);
  return second?validReleaseDay(+second[3],MONTHS.indexOf(second[1].toLowerCase())+1,+second[2]):null;
}
function datedField(body:string,pattern:RegExp):string|null {
  for(const match of body.matchAll(pattern)){
    const date=dateIn(match[1]);
    if(date)return date;
  }
  return null;
}
export function parseLegoAnnouncements(html:string,source:ExpandedSource,now:Date):ExpandedParseResult {
  const data=expandedScriptJson(html,"__NEXT_DATA__");
  const props=isRecord(data)&&isRecord(data.props)&&isRecord(data.props.pageProps)?data.props.pageProps:null;
  const news=props&&isRecord(props.news)&&Array.isArray(props.news.news)?props.news.news:null;
  if(!news)return {recognized:false,releases:[],malformed:0};
  const releases:ExpandedParseResult["releases"]=[];let malformed=0;
  for(const article of news){
    if(!isRecord(article)||!Array.isArray(article.components))continue;
    const categories=Array.isArray(article.categories)?article.categories:[];
    if(!categories.some((category)=>isRecord(category)&&/products/i.test(String(category.title??category.display_title))))continue;
    const title=stringValue(article.title),url=expandedSafeUrl(`https://www.lego.com/en-us/aboutus${article.url}`,source);
    if(!title||!url){malformed++;continue;}
    const texts=article.components.flatMap((component)=>isRecord(component)&&isRecord(component.content_block)&&typeof component.content_block.text==="string"?[component.content_block.text]:[]);
    const body=texts.join("\n").replace(/\*\*/g,""),sku=body.match(/(?:SKU number|Product number|Set number)\s*:\s*(\d{4,6})/i)?.[1]??null;
    const earlyDate=datedField(body,/(?:Insiders\s*)?Early Access\s*(?:[:–-]|\bfrom\b)\s*([^\n]+)/gi);
    const date=datedField(body,/(?:For all|For general purchase|General availability)\s*(?:[:–-]|\bfrom\b)\s*([^\n]+)/gi)
      ??datedField(body,/Availability\s*[:–-]\s*([^\n]+)/gi)
      ??datedField(body,/(?:available for purchase starting|available[^.\n]{0,120}\bfrom)\s*([^\n.]+)/gi);
    const price=body.match(/(?:Price|Pricing|RRP)\s*:\s*([^\n]+)/i)?.[1]?.trim().slice(0,100)??null;
    if(earlyDate)releases.push(expandedInput(source,now,{externalId:`lego:${sku??url}:early`,title:`${title} · Insiders 얼리 액세스`,brand:"LEGO",releaseDate:earlyDate,productUrl:url,sourceUrl:url,priceLabel:price}));
    releases.push(expandedInput(source,now,{externalId:`lego:${sku??url}:general`,title,brand:"LEGO",releaseDate:date??"",styleCode:sku,productUrl:url,sourceUrl:url,priceLabel:price}));
  }
  return {recognized:true,releases,malformed};
}
export function parseStarbucksAnnouncements(payload:unknown,source:ExpandedSource,now:Date):ExpandedParseResult {
  if(!isRecord(payload)||!Array.isArray(payload.list))return {recognized:false,releases:[],malformed:0};
  const releases=payload.list.flatMap((article)=>{
    if(!isRecord(article))return [];
    const title=stringValue(article.title);if(!title||!/(?:MD|상품|굿즈|텀블러|머그|백\b|Peanuts|키링|콜라보)/iu.test(title)||/케이크|쿠키|음료|푸드/i.test(title))return [];
    const match=title.match(/(\d{1,2})월\s*(\d{1,2})일/),published=String(article.news_dt??article.reg_dt??""),pubYear=Number(published.slice(0,4));
    let year=Number.isFinite(pubYear)&&pubYear>2000?pubYear:now.getUTCFullYear();
    if(match&&published.slice(5,7)==="01"&&+match[1]===12)year--;
    const date=match?validReleaseDay(year,+match[1],+match[2]):null;
    const url=expandedSafeUrl(`https://www.starbucks.co.kr/whats_new/newsView.do?seq=${Number(article.seq)}`,source);
    if(!url)return [];
    return [expandedInput(source,now,{externalId:`starbucks:${article.seq}`,title:htmlText(title),brand:"스타벅스",releaseDate:date??"",productUrl:url,sourceUrl:url})];
  });return {recognized:true,releases,malformed:0};
}
