export type OfficialInstagramAccount = {
  handle: string;
  label: string;
  region: string;
  marketScope: "korea" | "overseas";
  profileUrl: string;
  officialWebsite: string;
  verifiedByUrl: string;
};

// Exact profile links checked in official websites on 2026-10-04 (KST).
// Registration is an account allowlist, not evidence of an active API connection.
export const officialInstagramAccounts: readonly OfficialInstagramAccount[] =
[
  {
    "handle": "asicskr",
    "label": "ASICS Korea",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/asicskr/",
    "officialWebsite": "https://www.asics.co.kr/",
    "verifiedByUrl": "https://www.asics.co.kr/"
  },
  {
    "handle": "converse_kr",
    "label": "Converse Korea",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/converse_kr/",
    "officialWebsite": "https://www.converse.co.kr/",
    "verifiedByUrl": "https://www.converse.com/"
  },
  {
    "handle": "kasina_official",
    "label": "Kasina",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/kasina_official/",
    "officialWebsite": "https://www.kasina.co.kr/",
    "verifiedByUrl": "https://www.kasina.co.kr/"
  },
  {
    "handle": "salomon_kr",
    "label": "Salomon Korea",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/salomon_kr/",
    "officialWebsite": "https://salomon.co.kr/",
    "verifiedByUrl": "https://salomon.co.kr/"
  },
  {
    "handle": "thenorthface_kr",
    "label": "The North Face Korea",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/thenorthface_kr/",
    "officialWebsite": "https://www.thenorthfacekorea.co.kr/",
    "verifiedByUrl": "https://www.thenorthfacekorea.co.kr/"
  },
  {
    "handle": "thenorthface_whitelabel",
    "label": "The North Face White Label",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/thenorthface_whitelabel/",
    "officialWebsite": "https://www.thenorthfacekorea.co.kr/",
    "verifiedByUrl": "https://www.thenorthfacekorea.co.kr/"
  },
  {
    "handle": "worksout_official",
    "label": "Worksout",
    "region": "한국",
    "marketScope": "korea",
    "profileUrl": "https://www.instagram.com/worksout_official/",
    "officialWebsite": "https://www.worksout.co.kr/",
    "verifiedByUrl": "https://www.worksout.co.kr/"
  },
  {
    "handle": "adidas",
    "label": "adidas",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/adidas/",
    "officialWebsite": "https://www.adidas.com/",
    "verifiedByUrl": "https://news.adidas.com/sports-performance/adidas-partners-with-hailey-van-lith-to-inspire-student-athletes-on-overcoming-pressure--shares-upda/s/0906d532-5423-46d3-809f-bd1a975a4ce9"
  },
  {
    "handle": "asics",
    "label": "ASICS",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/asics/",
    "officialWebsite": "https://www.asics.com/",
    "verifiedByUrl": "https://corp.asics.com/en/"
  },
  {
    "handle": "bape_japan",
    "label": "BAPE Japan",
    "region": "일본",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/bape_japan/",
    "officialWebsite": "https://jp.bape.com/",
    "verifiedByUrl": "https://bape.com/"
  },
  {
    "handle": "carharttwip",
    "label": "Carhartt WIP",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/carharttwip/",
    "officialWebsite": "https://www.carhartt-wip.com/en-de",
    "verifiedByUrl": "https://www.carhartt-wip.com/"
  },
  {
    "handle": "converse",
    "label": "Converse",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/converse/",
    "officialWebsite": "https://www.nike.com/",
    "verifiedByUrl": "https://www.nike.com/"
  },
  {
    "handle": "hufworldwide",
    "label": "HUF",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/hufworldwide/",
    "officialWebsite": "https://hufworldwide.com/",
    "verifiedByUrl": "https://hufworldwide.com/"
  },
  {
    "handle": "humanmade",
    "label": "HUMAN MADE",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/humanmade/",
    "officialWebsite": "https://www.humanmade.jp/",
    "verifiedByUrl": "https://www.humanmade.jp/en/?cid=homepage"
  },
  {
    "handle": "jumpman23",
    "label": "Jordan",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/jumpman23/",
    "officialWebsite": "https://www.nike.com/",
    "verifiedByUrl": "https://www.nike.com/"
  },
  {
    "handle": "kith",
    "label": "Kith",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/kith/",
    "officialWebsite": "https://kith.com/",
    "verifiedByUrl": "https://kith.com/"
  },
  {
    "handle": "lego",
    "label": "LEGO",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/lego/",
    "officialWebsite": "https://www.lego.com/",
    "verifiedByUrl": "https://www.lego.com/cdn/cs/set/assets/blt2e8a73b8f4bad513/1HY26_ESSA_es-ar.pdf"
  },
  {
    "handle": "newbalance",
    "label": "New Balance",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/newbalance/",
    "officialWebsite": "https://www.newbalance.com/",
    "verifiedByUrl": "https://pay.nbkorea.com/my/introMyNB.action"
  },
  {
    "handle": "neweracap",
    "label": "New Era",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/neweracap/",
    "officialWebsite": "https://www.neweracap.com/",
    "verifiedByUrl": "https://www.neweracap.com/"
  },
  {
    "handle": "nike",
    "label": "Nike",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/nike/",
    "officialWebsite": "https://www.nike.com/",
    "verifiedByUrl": "https://www.nike.com/"
  },
  {
    "handle": "nikesb",
    "label": "Nike SB",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/nikesb/",
    "officialWebsite": "https://www.nikesb.com/",
    "verifiedByUrl": "https://www.nikesb.com/"
  },
  {
    "handle": "palaceskateboards",
    "label": "Palace",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/palaceskateboards/",
    "officialWebsite": "https://kr.palaceskateboards.com/",
    "verifiedByUrl": "https://www.palaceskateboards.com/"
  },
  {
    "handle": "popmart_us",
    "label": "POP MART US",
    "region": "미국",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/popmart_us/",
    "officialWebsite": "https://www.popmart.com/us",
    "verifiedByUrl": "https://www.popmart.com/us"
  },
  {
    "handle": "salomon",
    "label": "Salomon",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/salomon/",
    "officialWebsite": "https://www.salomon.com/",
    "verifiedByUrl": "https://www.salomon.com/en-us"
  },
  {
    "handle": "stussy",
    "label": "Stüssy",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/stussy/",
    "officialWebsite": "https://www.stussy.com/",
    "verifiedByUrl": "https://www.stussy.com/"
  },
  {
    "handle": "thenorthface",
    "label": "The North Face",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/thenorthface/",
    "officialWebsite": "https://www.thenorthface.com/",
    "verifiedByUrl": "https://www.vfc.com/brands/the-north-face"
  },
  {
    "handle": "vans",
    "label": "Vans",
    "region": "글로벌",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/vans/",
    "officialWebsite": "https://www.vans.com/",
    "verifiedByUrl": "https://www.vans.com/en-se/vans-stories/vans-sza"
  },
  {
    "handle": "linefriends_us",
    "label": "LINE FRIENDS US",
    "region": "미국",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/linefriends_us/",
    "officialWebsite": "https://store.linefriends.com/",
    "verifiedByUrl": "https://store.linefriends.com/"
  },
  {
    "handle": "newerahk",
    "label": "New Era Hong Kong",
    "region": "홍콩",
    "marketScope": "overseas",
    "profileUrl": "https://www.instagram.com/newerahk/",
    "officialWebsite": "https://neweracap.hk/",
    "verifiedByUrl": "https://neweracap.hk/"
  }
];

export function findOfficialInstagramAccount(handle: string): OfficialInstagramAccount | undefined {
  return officialInstagramAccounts.find((account)=>account.handle===handle.toLowerCase().replace(/^@/,""));
}
