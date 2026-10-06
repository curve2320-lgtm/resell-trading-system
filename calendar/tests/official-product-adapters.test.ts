import assert from "node:assert/strict";
import test from "node:test";
import {groupCollectedReleases} from "../app/collection/dedupe.ts";
import {createOfficialProductAdapter,parseMuseumProducts,parseOnepieceProducts,parsePokemonProduct,pokemonProductUrls} from "../app/collection/official-product-adapters.ts";
const now=new Date("2026-10-06T00:00:00Z");
const onepiece=(date="2026-10-23",href="products/view.do?brdno=6599")=>`<ul class="product_list"><li><a href="${href}" class="desc_wrap"><span class="tit">[EBK-04] EGGHEAD CRISIS</span><span class="date">${date}</span><span class="price_wrap"><span class="sub">48,000원</span></span></a></li></ul>`;
const pokemon=(date="2026-09-30")=>`<span>게시일 2026-09-23</span><h3 class="medium-title mgb0 white">MEGA 스타터 세트 ex 이브이</h3><ul><li><b>발매일</b> ${date}</li><li><b>가격</b>17,000원</li></ul>`;
const museum=(title="국새 키캡 키링 세트(온라인 4차판매 : 10월13일(화) 오후2시30분)")=>`<ul id="goodsListUl"><li class="item"><a onclick="fn_productView2('001002008','202607210006', event)"><div class="tit">${title}</div><span class="price">38,000</span></a></li></ul>`;
test("official One Piece product schedule preserves current and historical release facts",()=>{
  const future=parseOnepieceProducts(onepiece(),now).releases[0];assert.equal(future.releaseDate,"2026-10-23");assert.equal(future.releaseTime,null);assert.equal(future.styleCode,"EBK-04");assert.equal(future.sourceUrl,"https://onepiece-cardgame.kr/products/view.do?brdno=6599");
  assert.equal(parseOnepieceProducts(onepiece("2025-12-26"),now).releases[0].releaseDate,"2025-12-26");
  assert.equal(parseOnepieceProducts(onepiece("2026-02-30"),now).releases.length,0);
  assert.equal(parseOnepieceProducts(onepiece("2026-10-23","https://sibna.kr/today/post/1"),now).releases.length,0);
  assert.equal(parseOnepieceProducts('<title>Just a moment...</title>',now).recognized,false);
  assert.equal(future.releaseMethod,"정보");
});
test("official Pokemon explicit 発売 field wins over article publication or image filename",()=>{
  const product=parsePokemonProduct(pokemon(),"https://pokemoncard.co.kr/card/966",now).releases[0];assert.equal(product.releaseDate,"2026-09-30");assert.equal(product.releaseTime,null);assert.equal(product.priceLabel,"17,000원");
  assert.equal(product.releaseMethod,"정보");
  assert.equal(parsePokemonProduct(pokemon("発売予定"),"https://pokemoncard.co.kr/card/966",now).releases[0].releaseDate,"");
  assert.equal(parsePokemonProduct(pokemon(),"https://pokemoncard.co.kr.evil.test/card/966",now).recognized,false);
  assert.equal(parsePokemonProduct(pokemon().replace('<li><b>발매일</b> 2026-09-30</li>',''),"https://pokemoncard.co.kr/card/966",now).recognized,false);
});
test("Pokemon list follows only observed official product cards",()=>{
  assert.deepEqual(pokemonProductUrls('<nav onclick="location.href=\'/card/999\'"></nav><article class="white-panel"><div class="point" onclick="location.href=\'/card/966\'"></div></article>'),["https://pokemoncard.co.kr/card/966"]);
});
test("museum official product title supplies sale date, weekday and KST clock",()=>{
  const product=parseMuseumProducts(museum(),now).releases[0];assert.equal(product.releaseDate,"2026-10-13");assert.equal(product.releaseTime,"14:30");assert.equal(product.priceLabel,"38,000원");assert.equal(new URL(product.sourceUrl!).searchParams.get('str_goodcode'),"202607210006");
  assert.equal(parseMuseumProducts(museum("상품 출시 예정 · 2026 뮷즈 공모 선정작"),now).releases.length,0);
  assert.equal(parseMuseumProducts(museum("국새(온라인 판매 : 10월13일(수) 오후2시30분)"),now).releases.length,0);
  assert.equal(parseMuseumProducts(museum("국새(온라인 판매 : 10월13일(화))"),now).releases[0].releaseTime,null);
  assert.equal(parseMuseumProducts(museum("국새(온라인 판매 : 1월3일(토) 오전10시)"),now).releases.length,0);
});
test("museum date without year handles December to January only when nearby and weekday agrees",()=>{
  const product=parseMuseumProducts(museum("국새(온라인 판매 : 1월5일(화) 오전10시)"),new Date("2026-12-28T00:00:00Z")).releases[0];assert.equal(product.releaseDate,"2027-01-05");assert.equal(product.releaseTime,"10:00");
});
test("museum duplicate list entries merge by real product and sale day",async()=>{
  const result=await createOfficialProductAdapter("museumShop",async()=>museum()).collect(now);assert.equal(result.status,"connected");assert.equal(result.releases.length,1);
});
test("direct source returns partial verified facts within its whole-adapter deadline",async()=>{
  const result=await createOfficialProductAdapter("onepieceCard",url=>url.includes('?')?new Promise<string>(()=>{}):Promise.resolve(onepiece()),25).collect(now);
  assert.equal(result.status,"connected");assert.equal(result.releases.length,1);assert.match(result.message,/일부 연결 실패/);
});

function pokemonVariant(id:number, character:string) {
  return parsePokemonProduct(pokemon().replace("MEGA 스타터 세트 ex 이브이",`포켓몬 카드 게임 덱 실드 「잘 자 ${character}」`),`https://pokemoncard.co.kr/card/${id}`,now).releases[0];
}
test("distinct official Pokemon product IDs preserve similarly named sleeve variants",()=>{
  const groups=groupCollectedReleases([pokemonVariant(970,"이브이"),pokemonVariant(971,"조로아&조로아크"),pokemonVariant(972,"나오하&마스카나")]);
  assert.equal(groups.length,3);
  assert.ok(groups.every(group=>group.reviewReason===null));
});
test("official product identity exemption requires matching IDs and real product URLs",()=>{
  const left=pokemonVariant(970,"이브이"),right=pokemonVariant(971,"조로아&조로아크");
  for(const unverified of [
    {...right,externalId:"pokemon:970"},
    {...right,sourceUrl:"https://pokemoncard.co.kr.evil.test/card/971"},
    {...right,productUrl:"https://pokemoncard.co.kr/card/999"},
  ]) assert.ok(groupCollectedReleases([left,unverified]).every(group=>group.reviewReason==="possible_duplicate"));
});
test("official Pokemon IDs do not bypass fuzzy review against other retailers",()=>{
  const left=pokemonVariant(970,"이브이"),right={...pokemonVariant(971,"조로아&조로아크"),sourceKey:"pokemonStore",externalId:"retailer:971"};
  assert.ok(groupCollectedReleases([left,right]).every(group=>group.reviewReason==="possible_duplicate"));
});
