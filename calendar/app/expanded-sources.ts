/** Public official release calendars and announcements. Shared with the source drawer. */
export type ExpandedSource = {
  key: string;
  label: string;
  url: string;
  feedUrl?: string;
  domains: string[];
  region: string;
  parser: "atmos" | "end" | "slamjam" | "atom" | "structured" | "sibna";
  category: "sneakers" | "fashion" | "lifestyle";
};

export const expandedSourceCatalog: ExpandedSource[] = [
  {key:"lego",label:"LEGO 한정·협업",url:"https://www.lego.com/en-us/aboutus/newsroom",domains:["lego.com"],region:"글로벌",parser:"structured",category:"lifestyle"},
  {key:"starbucks",label:"스타벅스 한정 MD",url:"https://www.starbucks.co.kr/whats_new/news_list.do?cate=N01",domains:["starbucks.co.kr"],region:"한국",parser:"structured",category:"lifestyle"},
  {key:"museumShop",label:"뮷즈·국립박물관",url:"https://www.museumshop.or.kr/kor/boad/notice/list.do",domains:["museumshop.or.kr"],region:"한국",parser:"structured",category:"lifestyle"},
  {key:"pokemonStore",label:"포켓몬·TCG",url:"https://www.pokemonstore.co.kr/pages/board/post-list.html?boardId=information",domains:["pokemonstore.co.kr"],region:"한국",parser:"structured",category:"lifestyle"},
  {key:"lineFriends",label:"LINE FRIENDS 공식 굿즈",url:"https://linefriends.com/ko-kr/news",domains:["linefriends.com"],region:"한국",parser:"structured",category:"lifestyle"},
  {key:"atmosJP",label:"atmos 일본",url:"https://launch.atmos-tokyo.com/launch",domains:["atmos-tokyo.com"],region:"일본",parser:"atmos",category:"sneakers"},
  {key:"endGB",label:"END. 영국",url:"https://www.endclothing.com/gb/launches/all-launches",domains:["endclothing.com"],region:"영국",parser:"end",category:"sneakers"},
  {key:"slamJam",label:"Slam Jam",url:"https://slamjam.com/pages/upcoming-drops",domains:["slamjam.com"],region:"이탈리아",parser:"slamjam",category:"sneakers"},
  {key:"bodega",label:"Bodega",url:"https://bdgastore.com/blogs/upcoming-releases",feedUrl:"https://bdgastore.com/blogs/upcoming-releases.atom",domains:["bdgastore.com"],region:"미국",parser:"atom",category:"sneakers"},
  {key:"stussyNews",label:"Stüssy 공식 공지",url:"https://www.stussy.com/blogs/news",feedUrl:"https://www.stussy.com/blogs/news.atom",domains:["stussy.com"],region:"해외",parser:"atom",category:"fashion"},
  {key:"kithNews",label:"Kith 공식 공지",url:"https://kith.com/blogs/discover",feedUrl:"https://kith.com/blogs/discover.atom",domains:["kith.com"],region:"미국",parser:"atom",category:"fashion"},
  {key:"supremeUS",label:"Supreme 미국",url:"https://us.supreme.com/collections/frontpage",domains:["supreme.com"],region:"미국",parser:"structured",category:"fashion"},
  {key:"newBalanceUS",label:"New Balance 미국",url:"https://www.newbalance.com/nb-launches/",domains:["newbalance.com"],region:"미국",parser:"structured",category:"sneakers"},
  {key:"newBalanceUK",label:"New Balance 영국",url:"https://www.newbalance.co.uk/launch-calendar/",domains:["newbalance.co.uk"],region:"영국",parser:"structured",category:"sneakers"},
  {key:"newBalanceSG",label:"New Balance 싱가포르",url:"https://www.newbalance.com.sg/nb-launches.html",domains:["newbalance.com.sg"],region:"싱가포르",parser:"structured",category:"sneakers"},
  {key:"snsUS",label:"Sneakersnstuff",url:"https://us.sneakersnstuff.com/collections/upcoming-releases/",domains:["sneakersnstuff.com"],region:"미국",parser:"structured",category:"sneakers"},
  {key:"svd",label:"SVD",url:"https://www.sivasdescalzo.com/us",domains:["sivasdescalzo.com"],region:"스페인",parser:"structured",category:"sneakers"},
  {key:"footpatrol",label:"Footpatrol",url:"https://www.footpatrol.com/pages/footpatrol-launches",domains:["footpatrol.com"],region:"영국",parser:"structured",category:"sneakers"},
  {key:"undefeated",label:"UNDEFEATED",url:"https://undefeated.com/blogs/featured",feedUrl:"https://undefeated.com/blogs/featured.atom",domains:["undefeated.com"],region:"미국",parser:"atom",category:"fashion"},
  {key:"bait",label:"BAIT",url:"https://www.baitme.com/footwear",domains:["baitme.com"],region:"미국",parser:"structured",category:"sneakers"},
  {key:"naked",label:"NAKED Copenhagen",url:"https://nakedcph.com/collections/releases",domains:["nakedcph.com"],region:"덴마크",parser:"structured",category:"sneakers"},
  {key:"sizeUK",label:"size?",url:"https://www.size.co.uk/page/sizepreviews-launches/",domains:["size.co.uk"],region:"영국",parser:"structured",category:"sneakers"},
  {key:"asicsUS",label:"ASICS 미국",url:"https://www.asics.com/us/en-us/sportstyle-new-arrivals/c/aa90000023/",domains:["asics.com"],region:"미국",parser:"structured",category:"sneakers"},
  {key:"converseUS",label:"Converse 미국",url:"https://www.converse.com/shop/collabs",domains:["converse.com"],region:"미국",parser:"structured",category:"sneakers"},
  {key:"humanMade",label:"HUMAN MADE",url:"https://www.humanmade.jp/en/news/",domains:["humanmade.jp"],region:"일본",parser:"structured",category:"fashion"},
  {key:"bape",label:"BAPE 공식 공지",url:"https://en.jp.bape.com/blogs/news",feedUrl:"https://en.jp.bape.com/blogs/news.atom",domains:["bape.com"],region:"일본",parser:"atom",category:"fashion"},
  {key:"patta",label:"Patta 공식 공지",url:"https://patta.nl/blogs/news",feedUrl:"https://patta.nl/blogs/news.atom",domains:["patta.nl"],region:"네덜란드",parser:"atom",category:"fashion"},
  {key:"dsm",label:"Dover Street Market",url:"https://london.doverstreetmarket.com/pages/new-items",domains:["doverstreetmarket.com"],region:"영국",parser:"structured",category:"fashion"},
  {key:"worksoutGlobal",label:"WORKSOUT 글로벌 공지",url:"https://worksout.com/blogs/news",feedUrl:"https://worksout.com/blogs/news.atom",domains:["worksout.com"],region:"해외",parser:"atom",category:"fashion"},
  {key:"sibna",label:"SIBNA 발매 정보",url:"https://sibna.kr/today/upcoming",domains:["sibna.kr"],region:"한국",parser:"sibna",category:"lifestyle"},
];

export const expandedSourceDomains = [...new Set(expandedSourceCatalog.flatMap(({domains}) => domains))];
export function expandedSourceRegion(key: string): string | null {
  return expandedSourceCatalog.find((source) => source.key === key)?.region ?? null;
}
