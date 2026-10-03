"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { ReleaseBadges } from "./release-badges";
import { OfficialInstagramDialog } from "./official-instagram-dialog";
import { SavedReleaseButton } from "./saved-release-button";
import {
  createSavedReleaseController,
  savedReleaseButtonView,
  savedReleaseUiAvailable,
} from "./saved-release-controller";
import {
  releaseDestination,
  safeRetailerUrl,
} from "./release-links";
import { safeAnnouncementUrl, isInstagramSource } from "./sns-links";
import { expandedSourceCatalog } from "./expanded-sources";
import { downloadReleaseCalendar, releaseCalendarEventCount } from "./release-calendar-export";
import { createReleaseFeedLoader, releaseFeedCountLabel, type ReleaseCollectionState } from "./release-feed-loader";
import { indexReleasesForDays, releaseAppearsOnDate as appearsOnDate } from "./release-schedule-days";
import {
  calendarDayCountLabel,
  effectiveScheduleMode,
  featuredCollaborationReleases,
  filterReleases,
  filterReleasesByMarketScope,
  isOverseasRelease,
  releaseChannelCount,
  releasesForScheduleMode,
  ReleaseFilters,
  selectedDayEmptyCopy,
  selectedDayScheduleView,
  type ReleaseFilter,
  type ReleaseScheduleMode as ScheduleMode,
} from "./release-filters";

type Category = "선착순" | "응모" | "정보" | "루머" | "수강";
type DailyScope = "today" | "tomorrow";

type ReleaseChannel = {
  externalId?: string | null;
  sourceKey: string;
  retailer: string;
  productUrl: string | null;
  sourceUrl: string | null;
  priceLabel: string | null;
  releaseDate: string;
  releaseTime: string | null;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
};

type Release = {
  id: number | string;
  title: string;
  brand: string;
  category: Category;
  releaseDate: string;
  releaseTime: string | null;
  channel: string;
  sourceName: string;
  sourceUrl: string | null;
  status: string;
  confidence: number;
  note: string;
  isFeatured: boolean;
  retailer?: string | null;
  releaseMethod?: string | null;
  winnerMethod?: string | null;
  paymentMethod?: string | null;
  scheduleLabel?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
  priceLabel?: string | null;
  styleCode?: string | null;
  region?: string | null;
  marketScope?: "korea" | "overseas";
  shippingMethod?: string | null;
  productUrl?: string | null;
  appOnly?: boolean;
  mode?: string | null;
  catalogCategory?: "sneakers" | "fashion" | "lifestyle";
  releaseKind?: "general" | "collab" | "raffle" | "offline";
  hasScheduleChange?: boolean;
  lastVerifiedLabel?: string | null;
  channels?: ReleaseChannel[];
};

type UndatedSourceItem = {
  id: string;
  title: string;
  sourceUrl: string | null;
  note: string;
  brand?: string | null;
  priceLabel?: string | null;
  styleCode?: string | null;
  productUrl?: string | null;
};

type KreamLookupItem = {
  title: string;
  styleCode?: string | null;
};

type SourceHealthItem = {
  status: "connected" | "error" | "manual" | string;
  count: number;
  message: string;
  sourceUrl?: string;
  undated?: UndatedSourceItem[];
};

type SourceKey =
  | "nike"
  | "adidas"
  | "shoeprize"
  | "grandstage"
  | "newBalance"
  | "musinsa"
  | "soldout"
  | "worksout"
  | "kasina"
  | "kream"
  | "converse"
  | "fila"
  | "northFace"
  | "palace"
  | "salomon"
  | "asics"
  | "tune"
  | "sns"
  | "instagramPublic"
  | (typeof expandedSourceCatalog)[number]["key"]
  | "database";

type SourceHealth = Partial<Record<SourceKey, SourceHealthItem>>;

const sourceCatalog: {
  key: SourceKey;
  icon: string;
  label: string;
  url?: string;
  authorized?: boolean;
}[] = [
  {
    key: "nike",
    icon: "N",
    label: "Nike SNKRS Korea",
    url: "https://www.nike.com/kr/launch/upcoming",
  },
  {
    key: "adidas",
    icon: "AD",
    label: "adidas Release Dates",
    url: "https://www.adidas.co.kr/release-dates",
  },
  {
    key: "shoeprize",
    icon: "S",
    label: "SHOEPRIZE API",
    url: "https://www.shoeprize.com/today",
    authorized: true,
  },
  {
    key: "grandstage",
    icon: "A",
    label: "ABC Grandstage",
    url: "https://grandstage.a-rt.com/display/calendar",
  },
  {
    key: "newBalance",
    icon: "NB",
    label: "New Balance",
    url: "https://m.nbkorea.com/launchingCalendar/list.action",
  },
  {
    key: "musinsa",
    icon: "M",
    label: "무신사 응모",
    url: "https://www.musinsa.com/events/raffle",
  },
  {
    key: "soldout",
    icon: "SO",
    label: "솔드아웃 응모",
    url: "https://svc.soldout.co.kr/trade/raffle/list",
  },
  {
    key: "worksout",
    icon: "W",
    label: "웍스아웃 응모",
    url: "https://www.worksout.co.kr/app-download",
  },
  {
    key: "kasina",
    icon: "K",
    label: "KASINA LAUNCHES",
    url: "https://www.kasina.co.kr/launches",
    authorized: true,
  },
  {
    key: "kream",
    icon: "KR",
    label: "KREAM DRAW",
    url: "https://kream.co.kr/brands/KREAM%20DRAW",
    authorized: true,
  },
  {
    key: "converse",
    icon: "C",
    label: "Converse 공식몰",
    url: "https://www.converse.co.kr/limited/launch.html",
    authorized: true,
  },
  {
    key: "fila",
    icon: "F",
    label: "FILA 순차출고",
    url: "https://www.fila.co.kr/product/new.asp",
  },
  {
    key: "northFace",
    icon: "TNF",
    label: "The North Face 공식몰",
    url: "https://www.thenorthfacekorea.co.kr/category/n/new?sort=ACTIVE_DATE_DESC",
  },
  {
    key: "palace",
    icon: "P",
    label: "PALACE 서울 사인업",
    url: "https://palaceskateboards.seoul.kr/",
  },
  { key: "salomon", icon: "SA", label: "Salomon 공식 발매", url: "https://salomon.co.kr/collections/launch-calendar" },
  { key: "asics", icon: "AS", label: "ASICS 공식 달력", url: "https://www.asics.co.kr/board/?id=spscalendar" },
  { key: "tune", icon: "T", label: "TUNE", url: "https://tune.kr" },
  { key: "sns", icon: "IG", label: "공식 Instagram 공지" },
  { key: "instagramPublic", icon: "IG", label: "홈페이지 공개 Instagram 공지" },
  ...expandedSourceCatalog.map((source) => ({
    key: source.key, icon: source.label.slice(0, 2).toUpperCase(),
    label: source.label, url: source.url,
  })),
  { key: "database", icon: "D", label: "자체 데이터베이스" },
];

const categoryMeta: Record<Category, { label: string; mark: string }> = {
  선착순: { label: "선착순", mark: "⚡" },
  응모: { label: "응모", mark: "◇" },
  정보: { label: "정보", mark: "i" },
  루머: { label: "확인 필요", mark: "?" },
  수강: { label: "수강 일정", mark: "↗" },
};

function scheduleModeLabel(mode: ScheduleMode) {
  if (mode === "all") return "전체";
  if (mode === "entry") return "응모";
  if (mode === "overseas") return "해외";
  return "선착순 · 일반";
}

function addDays(iso: string, amount: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function makeDemoReleases(today: string): Release[] {
  return [
    {
      id: -1,
      title: "한정판 발매 분석 라이브",
      brand: "리셀 강의",
      category: "수강",
      releaseDate: today,
      releaseTime: "20:00",
      channel: "온라인",
      sourceName: "관리자 직접 등록",
      sourceUrl: null,
      status: "예정",
      confidence: 100,
      note: "이번 주 주요 발매와 응모 전략을 함께 정리합니다.",
      isFeatured: true,
    },
    {
      id: -2,
      title: "러닝 컬렉션 온라인 드롭",
      brand: "공식 브랜드 스토어",
      category: "선착순",
      releaseDate: today,
      releaseTime: "10:00",
      channel: "온라인",
      sourceName: "공식 발매 페이지",
      sourceUrl: null,
      status: "예정",
      confidence: 96,
      note: "공식 판매처 페이지를 기준으로 등록된 데모 일정입니다.",
      isFeatured: true,
    },
    {
      id: -3,
      title: "시즌 협업 컬렉션 응모",
      brand: "CITY SELECT",
      category: "응모",
      releaseDate: addDays(today, 1),
      releaseTime: "11:00",
      channel: "온라인 응모",
      sourceName: "판매처 공지",
      sourceUrl: null,
      status: "예정",
      confidence: 92,
      note: "응모 마감 시간은 판매처 공지를 다시 확인하세요.",
      isFeatured: false,
    },
    {
      id: -4,
      title: "스니커즈 드로우 실전 과제",
      brand: "리셀 강의",
      category: "수강",
      releaseDate: addDays(today, 2),
      releaseTime: "19:30",
      channel: "과제",
      sourceName: "관리자 직접 등록",
      sourceUrl: null,
      status: "예정",
      confidence: 100,
      note: "관심 상품 3개를 골라 발매처와 응모 조건을 정리합니다.",
      isFeatured: false,
    },
    {
      id: -5,
      title: "주말 팝업 한정 수량 판매",
      brand: "LOCAL EDIT",
      category: "정보",
      releaseDate: addDays(today, 3),
      releaseTime: null,
      channel: "오프라인",
      sourceName: "공식 공지",
      sourceUrl: null,
      status: "확인필요",
      confidence: 74,
      note: "판매 시작 시간이 공개되지 않아 관리자 확인이 필요합니다.",
      isFeatured: false,
    },
    {
      id: -6,
      title: "아카이브 컬러 재발매",
      brand: "STUDIO NINE",
      category: "루머",
      releaseDate: addDays(today, 5),
      releaseTime: null,
      channel: "미정",
      sourceName: "수강생 제보",
      sourceUrl: null,
      status: "검수중",
      confidence: 42,
      note: "공식 출처가 확인되기 전까지 구매 판단에 사용하지 마세요.",
      isFeatured: false,
    },
    {
      id: -7,
      title: "캡슐 컬렉션 선착순 발매",
      brand: "OBJECT LAB",
      category: "선착순",
      releaseDate: addDays(today, 7),
      releaseTime: "12:00",
      channel: "온라인",
      sourceName: "브랜드 뉴스룸",
      sourceUrl: null,
      status: "예정",
      confidence: 98,
      note: "수강용 화면을 보여주기 위한 독립 데모 데이터입니다.",
      isFeatured: true,
    },
    {
      id: -8,
      title: "월말 발매 복기 세션",
      brand: "리셀 강의",
      category: "수강",
      releaseDate: addDays(today, 9),
      releaseTime: "21:00",
      channel: "온라인",
      sourceName: "관리자 직접 등록",
      sourceUrl: null,
      status: "예정",
      confidence: 100,
      note: "놓친 일정과 실제 구매 결과를 정리하는 월말 세션입니다.",
      isFeatured: false,
    },
  ];
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function relativeDateLabel(value: string, todayIso: string) {
  const compact = value.slice(5).replace("-", ".");
  const distance = dayDistance(value, todayIso);
  if (distance === 0) return `오늘 · ${compact}`;
  if (distance === 1) return `내일 · ${compact}`;
  if (distance === 2) return `모레 · ${compact}`;
  return compact;
}

function dateTimeLabel(value: string | null | undefined, timeUnknown = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    ...(timeUnknown
      ? {}
      : {
          hour: "2-digit" as const,
          minute: "2-digit" as const,
          hourCycle: "h23" as const,
        }),
  }).format(date);
  return timeUnknown ? `${formatted} · 시간 미정` : formatted;
}

function scheduleFor(release: Release) {
  const start = dateTimeLabel(release.startAt, release.startTimeUnknown);
  const end = dateTimeLabel(release.endAt, release.endTimeUnknown);
  if (release.category === "응모") {
    if (start && end) return `${start} → ${end}`;
    if (start) return `${start} 시작`;
    if (end) return `${end} 마감`;
  } else if (start) {
    return `${start} 시작`;
  }
  if (release.scheduleLabel) return release.scheduleLabel;
  if (end) return `${end} 종료 정보`;
  return `${release.releaseDate} ${release.releaseTime ?? "시간 미정"}`;
}

function releaseFacts(release: Release) {
  const delivery = [release.region, release.shippingMethod]
    .filter(Boolean)
    .join(" · ");
  const channelMode = [
    release.mode === "online" ? "온라인" : release.mode,
    release.appOnly ? "앱 사용" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const announcement = dateTimeLabel(release.announcementAt);
  const facts: { label: string; value: string | null | undefined; wide?: boolean }[] = [
    { label: "판매처", value: release.retailer ?? release.channel },
    {
      label: "구분",
      value: release.releaseMethod ?? categoryMeta[release.category].label,
    },
    { label: "가격", value: release.priceLabel },
    { label: "스타일 코드", value: release.styleCode },
    {
      label: release.category === "응모" ? "응모 기간" : "일정",
      value: scheduleFor(release),
      wide: true,
    },
    { label: "당첨 안내", value: release.winnerMethod },
    { label: "구매·결제", value: release.paymentMethod },
    { label: "지역·배송", value: delivery || null },
    { label: "발표", value: announcement },
    { label: "이용 채널", value: channelMode || null },
  ];
  return facts.filter(
    (fact): fact is { label: string; value: string; wide?: boolean } =>
      Boolean(fact.value),
  );
}

function ReleaseFacts({
  release,
  tone = "light",
}: {
  release: Release;
  tone?: "light" | "dark";
}) {
  return (
    <dl className={`release-facts ${tone}`}>
      {releaseFacts(release).map((fact) => (
        <div className={fact.wide ? "wide" : ""} key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function sameUrl(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left === right);
}

function kreamSearchUrl(item: KreamLookupItem) {
  const keyword = item.styleCode?.trim() || item.title.trim();
  const url = new URL("https://kream.co.kr/search");
  url.searchParams.set("keyword", keyword);
  return url.toString();
}

function KreamLink({
  item,
  className,
}: {
  item: KreamLookupItem;
  className?: string;
}) {
  return (
    <a
      className={["kream-link", className].filter(Boolean).join(" ")}
      href={kreamSearchUrl(item)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <strong>KREAM에서 검색 ↗</strong>
      <small>{item.styleCode?.trim() || "제품명으로 검색"}</small>
    </a>
  );
}

function parseWonAmount(label: string | null | undefined) {
  if (!label || !/원|₩|krw/i.test(label)) return null;
  const digits = label.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function formatWon(amount: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(amount))}원`;
}

/**
 * 마진 계산기 (간단판 — 2026-07-25 유과장 지시로 축소):
 *   예상 정산금액 = 예상 체결가 − 판매수수료 − 배송비 등 차감액
 *   예상 순이익  = 예상 정산금액 − 총매입원가   (세금·위험비용 빼기 전)
 *   순이익률(%)  = 예상 순이익 ÷ 총매입원가 × 100
 * 수수료 6%·차감액 2,500원은 유과장이 정한 기본값이며 입력칸에서 바로 수정 가능.
 * (수수료·차감액은 플랫폼 정책에 따라 바뀔 수 있음 — 값 변경은 이 기본값만 고치면 됨)
 */
const DEFAULT_FEE_RATE = "6";
const DEFAULT_DEDUCTION = "2500";

function MarginCalculator({ release }: { release: KreamLookupItem & { priceLabel?: string | null } }) {
  const defaultCost = parseWonAmount(release.priceLabel);
  const [cost, setCost] = useState(defaultCost ? String(defaultCost) : "");
  const [sale, setSale] = useState("");
  const [feeRate, setFeeRate] = useState(DEFAULT_FEE_RATE);
  const [deduction, setDeduction] = useState(DEFAULT_DEDUCTION);

  const costValue = Number(cost.replace(/[^0-9]/g, "")) || 0;
  const saleValue = Number(sale.replace(/[^0-9]/g, "")) || 0;
  const feeValue = Number(feeRate.replace(/[^0-9.]/g, "")) || 0;
  const deductionValue = Number(deduction.replace(/[^0-9]/g, "")) || 0;

  const ready = costValue > 0 && saleValue > 0;
  const settlement = saleValue - (saleValue * feeValue) / 100 - deductionValue;
  const profit = settlement - costValue;
  const profitRate = costValue > 0 ? (profit / costValue) * 100 : 0;

  return (
    <details className="margin-calc">
      <summary>마진 계산기 — 사기 전에 예상 순이익부터</summary>
      <div className="margin-calc-body">
        <p className="margin-calc-guide">
          KREAM 검색으로 <b>실제 체결가</b>를 확인해서 넣으면 바로 계산됩니다.
        </p>
        <div className="margin-calc-grid">
          <label>
            총매입원가 (원)
            <small>기본값은 발매가 — 실제 들어간 돈으로 수정</small>
            <input
              inputMode="numeric"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="예: 169000"
            />
          </label>
          <label>
            예상 체결가 (원)
            <small>KREAM에서 실제로 거래되는 가격</small>
            <input
              inputMode="numeric"
              value={sale}
              onChange={(event) => setSale(event.target.value)}
              placeholder="KREAM 검색 후 입력"
            />
          </label>
          <label>
            판매수수료율 (%)
            <small>기본 6% — 필요하면 수정</small>
            <input
              inputMode="decimal"
              value={feeRate}
              onChange={(event) => setFeeRate(event.target.value)}
            />
          </label>
          <label>
            배송비 등 기타 차감액 (원)
            <small>기본 2,500원 — 필요하면 수정</small>
            <input
              inputMode="numeric"
              value={deduction}
              onChange={(event) => setDeduction(event.target.value)}
            />
          </label>
        </div>
        {ready ? (
          <dl className="margin-calc-result">
            <div>
              <dt>예상 정산금액 <small>수수료·차감액 뺀 입금액</small></dt>
              <dd>{formatWon(settlement)}</dd>
            </div>
            <div>
              <dt>예상 순이익 <small>세금 빼기 전</small></dt>
              <dd className={profit >= 0 ? "profit-plus" : "profit-minus"}>
                {formatWon(profit)}
              </dd>
            </div>
            <div>
              <dt>순이익률</dt>
              <dd className={profit >= 0 ? "profit-plus" : "profit-minus"}>
                {profitRate.toFixed(1)}%
              </dd>
            </div>
          </dl>
        ) : (
          <p className="margin-calc-waiting">
            총매입원가와 예상 체결가를 넣으면 예상 순이익이 바로 계산됩니다.
          </p>
        )}
      </div>
    </details>
  );
}

function destinationFor(release: Release) {
  return releaseDestination(release);
}

function destinationHost(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function directLinkLabel(release: Release) {
  const retailer = release.retailer ?? release.channel;
  return release.category === "응모"
    ? `${retailer} 응모 페이지`
    : `${retailer} 홈페이지`;
}

function dayDistance(releaseDate: string, todayIso: string) {
  const releaseDay = Date.parse(`${releaseDate}T12:00:00+09:00`);
  const today = Date.parse(`${todayIso}T12:00:00+09:00`);
  return Math.round((releaseDay - today) / 86_400_000);
}

function releaseStartTimestamp(release: Release) {
  if (release.startAt) {
    const parsed = Date.parse(release.startAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (!release.releaseTime) return null;
  const parsed = Date.parse(
    `${release.releaseDate}T${release.releaseTime}:00+09:00`,
  );
  return Number.isNaN(parsed) ? null : parsed;
}

function explicitTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function releaseTimeLabel(release: Pick<Release, "releaseTime" | "category" | "startAt" | "endAt" | "startTimeUnknown" | "endTimeUnknown">, fallback = "미정") {
  const endpointLabel = (value: string | null | undefined, timeUnknown = false) => {
    if (!value) return null;
    const day = value.slice(0, 10);
    const dayInstant = Date.parse(`${day}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayInstant) || new Date(dayInstant).toISOString().slice(0, 10) !== day) return null;
    if (value === day) return timeUnknown ? `${Number(day.slice(5, 7))}/${Number(day.slice(8))} 시간 미정` : null;
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.month}/${parts.day} ${timeUnknown ? "시간 미정" : `${parts.hour}:${parts.minute}`}`;
  };
  const end = endpointLabel(release.endAt, release.endTimeUnknown);
  if (end) return `마감 ${end}`;
  const start = endpointLabel(release.startAt, release.startTimeUnknown);
  if (start) return `시작 ${start}`;
  return release.releaseTime ?? fallback;
}

function releaseStatusLabel(
  release: Release,
  todayIso: string,
  currentTimeIso: string,
) {
  const days = dayDistance(release.releaseDate, todayIso);
  const now = Date.parse(currentTimeIso);

  if (release.category === "응모") {
    const start = explicitTimestamp(release.startAt);
    const end = explicitTimestamp(release.endAt);
    if (end !== null) {
      if (now >= end) return "응모 마감";
      if (start !== null && now >= start) return "응모 중";
      if (days === 0) return "오늘 마감";
      if (days > 0) return `마감 D-${days}`;
      return "일정 확인";
    }

    if (start !== null && now >= start) return "응모 시작됨";
    if (days === 0) return start !== null ? "오늘 응모 시작" : "오늘 응모";
    if (days > 0) return start !== null ? `응모 시작 D-${days}` : `응모 D-${days}`;
    return "일정 확인";
  }

  if (days === 0) {
    const start = releaseStartTimestamp(release);
    return start !== null && now >= start ? "판매 시작됨" : "오늘 발매";
  }
  if (days > 0) return `D-${days}`;
  return "일정 확인";
}

function DirectLink({
  release,
  className,
}: {
  release: Release;
  className?: string;
}) {
  const destination = destinationFor(release);
  if (!destination) return null;

  return (
    <a
      className={className}
      href={destination}
      target="_blank"
      rel="noreferrer"
    >
      <strong>{directLinkLabel(release)} ↗</strong>
      <small>{destinationHost(destination)}</small>
    </a>
  );
}

function AnnouncementLink({ release }: { release: Release }) {
  const source = release.channels?.find((channel) => isInstagramSource(channel.sourceKey));
  const url = safeAnnouncementUrl(source?.sourceUrl ?? (isInstagramSource(release.sourceName) ? release.sourceUrl : null));
  if (!url) return null;
  return (
    <a className="source-reference" href={url} target="_blank" rel="noreferrer">
      원 게시글 보기
    </a>
  );
}

function ScheduleTypeTabs({
  scope,
  label,
  releases,
  value,
  onChange,
  confirmed = true,
}: {
  scope: string;
  label: string;
  releases: Release[];
  value: ScheduleMode;
  onChange: (mode: ScheduleMode) => void;
  confirmed?: boolean;
}) {
  const tabs: { value: ScheduleMode; label: string; count: number }[] = [
    {
      value: "all",
      label: "전체",
      count: releases.length,
    },
    {
      value: "general",
      label: "선착순",
      count: releasesForScheduleMode(releases, "general").length,
    },
    {
      value: "entry",
      label: "응모",
      count: releasesForScheduleMode(releases, "entry").length,
    },
    {
      value: "overseas",
      label: "해외",
      count: releasesForScheduleMode(releases, "overseas").length,
    },
  ];

  return (
    <div
      className="schedule-tabs"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <button
          id={`${scope}-${tab.value}-tab`}
          key={tab.value}
          className="schedule-tab"
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`${scope}-panel`}
          onClick={() => onChange(tab.value)}
        >
          <span>{tab.label}</span>
          <strong>{releaseFeedCountLabel(tab.count, confirmed)}</strong>
        </button>
      ))}
    </div>
  );
}

function PeriodNavigation({
  view,
  dailyScope,
  todayCount,
  tomorrowCount,
  onSelectDaily,
}: {
  view: "today" | "calendar";
  dailyScope: DailyScope;
  todayCount: number | string;
  tomorrowCount: number | string;
  onSelectDaily: (scope: DailyScope) => void;
}) {
  const calendarView = view === "calendar";

  return (
    <nav
      className={`period-tabs ${calendarView ? "calendar-period-tabs" : ""}`}
      aria-label="일정 날짜 선택"
    >
      {calendarView ? (
        <Link href="/#upcoming">
          <span>오늘</span>
          <strong>{todayCount}</strong>
        </Link>
      ) : (
        <button
          className={dailyScope === "today" ? "is-active" : ""}
          type="button"
          aria-pressed={dailyScope === "today"}
          onClick={() => onSelectDaily("today")}
        >
          <span>오늘</span>
          <strong>{todayCount}</strong>
        </button>
      )}
      {calendarView ? (
        <Link href="/?day=tomorrow#upcoming">
          <span>내일</span>
          <strong>{tomorrowCount}</strong>
        </Link>
      ) : (
        <button
          className={dailyScope === "tomorrow" ? "is-active" : ""}
          type="button"
          aria-pressed={dailyScope === "tomorrow"}
          onClick={() => onSelectDaily("tomorrow")}
        >
          <span>내일</span>
          <strong>{tomorrowCount}</strong>
        </button>
      )}
      <Link
        className={calendarView ? "is-active" : ""}
        href="/calendar"
        aria-current={calendarView ? "page" : undefined}
      >
        <span>월간</span>
        <strong>달력</strong>
      </Link>
    </nav>
  );
}

function ReleaseSummaryContent({
  release,
  index,
  todayIso,
  currentTimeIso,
}: {
  release: Release;
  index: number;
  todayIso: string;
  currentTimeIso: string;
}) {
  const statusLabel = releaseStatusLabel(release, todayIso, currentTimeIso);

  return (
    <>
      <span className="release-index">{String(index + 1).padStart(2, "0")}</span>
      <span className={`release-mark cat-${release.category}`}>
        {categoryMeta[release.category].mark}
      </span>
      <span className="release-main">
        <ReleaseBadges release={release} />
        <b>{release.title}</b>
        <small>{release.brand} · {release.retailer ?? release.channel}</small>
        <span className="release-quickfacts">
          <em className="status-fact">{statusLabel}</em>
          {[
            isOverseasRelease(release) ? release.region ?? "해외" : null,
            release.priceLabel,
            release.styleCode,
            release.releaseMethod ?? categoryMeta[release.category].label,
          ]
            .filter((value): value is string => Boolean(value))
            .map((value) => <em key={value}>{value}</em>)}
        </span>
        {destinationFor(release) && (
          <span className="release-destination">
            {directLinkLabel(release)} · {destinationHost(destinationFor(release))}
          </span>
        )}
      </span>
      <span className="release-date">
        <b>{relativeDateLabel(release.releaseDate, todayIso)}</b>
        <small>
          {releaseTimeLabel(release)}
          {isOverseasRelease(release) ? " · KST" : ""}
        </small>
      </span>
      <span className="row-arrow">{destinationFor(release) ? "↗" : "↓"}</span>
    </>
  );
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calendarCells(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const currentDays = new Date(year, month, 0).getDate();
  const previousDays = new Date(year, month - 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const rawDay = index - firstDay + 1;
    const date = new Date(year, month - 1, rawDay);
    let day = rawDay;
    let outside = false;
    if (rawDay < 1) {
      day = previousDays + rawDay;
      outside = true;
    } else if (rawDay > currentDays) {
      day = rawDay - currentDays;
      outside = true;
    }
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { iso, day, outside };
  });
}

export function ReleaseBoard({
  view,
  initialDate,
  initialDailyScope = "today",
  todayIso,
  updatedAtLabel,
  currentTimeIso,
  userName,
  signedIn,
}: {
  view: "today" | "calendar";
  initialDate?: string;
  initialDailyScope?: DailyScope;
  todayIso: string;
  updatedAtLabel: string;
  currentTimeIso: string;
  userName: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const selectedDateAtLoad =
    view === "calendar" && initialDate ? initialDate : todayIso;
  const demoReleases = useMemo(() => makeDemoReleases(todayIso), [todayIso]);
  // 실제 데이터가 오기 전에는 빈 목록 + "불러오는 중"을 보여준다.
  // 가짜 데모 일정은 주소에 ?demo=1을 붙였을 때만 노출된다 (수강생 오인 방지).
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadState, setLoadState] = useState<
    "loading" | "live" | "error" | "demo"
  >("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const isDemo = loadState === "demo";
  const [activeMonth, setActiveMonth] = useState(selectedDateAtLoad.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(selectedDateAtLoad);
  const [selectedDayOpen, setSelectedDayOpen] = useState(
    view === "calendar" && Boolean(initialDate),
  );
  const [dailyScope, setDailyScope] =
    useState<DailyScope>(initialDailyScope);
  const [todayScheduleMode, setTodayScheduleMode] =
    useState<ScheduleMode>("all");
  const [tomorrowScheduleMode, setTomorrowScheduleMode] =
    useState<ScheduleMode>("all");
  const [calendarScheduleMode, setCalendarScheduleMode] =
    useState<ScheduleMode>("all");
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ReleaseFilter>("all");
  const [overseasOnly, setOverseasOnly] = useState(false);
  const savedController = useMemo(
    () =>
      createSavedReleaseController({
        authenticated: signedIn,
        request: fetch,
      }),
    [signedIn],
  );
  const savedState = useSyncExternalStore(
    savedController.subscribe,
    savedController.getSnapshot,
    savedController.getSnapshot,
  );
  const savedReleaseIds = savedState.savedReleaseIds;
  const savedLoadState = savedState.status;
  const savedUiAvailable = savedReleaseUiAvailable(
    savedState,
    signedIn,
  );
  const savedMutationError =
    savedState.errors.values().next().value ?? null;
  const [adminOpen, setAdminOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [sourceHealth, setSourceHealth] = useState<SourceHealth>({});
  const [collectionState, setCollectionState] = useState<ReleaseCollectionState | null>(null);
  const [feedError, setFeedError] = useState(false);
  const [clockIso, setClockIso] = useState(currentTimeIso);
  const [exportMessage, setExportMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockIso(new Date().toISOString());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setReleases(demoReleases);
      setLoadState("demo");
      setFeedError(false);
      return;
    }
    setLoadState((previous) => previous === "live" ? previous : "loading");
    const loader = createReleaseFeedLoader<Release, SourceHealth>({
      month: activeMonth,
      request: fetch,
      onResponse: (data) => {
        if (data.sources) setSourceHealth(data.sources);
        setReleases((previous) => data.collection.status === "failed" && data.releases.length === 0 && previous.length > 0 ? previous : data.releases);
        setCollectionState(data.collection);
        setFeedError(false);
        setLoadState("live");
      },
      onError: () => {
        setFeedError(true);
        setLoadState((previous) => previous === "live" ? previous : "error");
      },
    });
    loader.start();
    return () => loader.stop();
  }, [demoReleases, reloadKey, activeMonth]);

  useEffect(() => {
    if (signedIn) void savedController.load();
    return () => {
      savedController.reset(false);
    };
  }, [savedController, signedIn]);

  useEffect(() => {
    if (!savedUiAvailable && activeFilter === "saved") {
      setActiveFilter("all");
    }
  }, [activeFilter, savedUiAvailable]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const primary = filterReleases(
      releases,
      activeFilter,
      savedReleaseIds,
    );
    return filterReleasesByMarketScope(
      primary,
      view === "calendar" && overseasOnly,
    ).filter((release) => {
      if (!normalized) return true;
      return [
        release.title,
        release.brand,
        release.retailer,
        release.styleCode,
        release.releaseMethod,
        release.sourceName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [activeFilter, overseasOnly, query, releases, savedReleaseIds, view]);

  const featuredCollaborations = useMemo(
    () => featuredCollaborationReleases(filtered, todayIso).slice(0, 3),
    [filtered, todayIso],
  );

  const cells = useMemo(() => calendarCells(activeMonth), [activeMonth]);
  const eventsByDate = useMemo(
    () => indexReleasesForDays(filtered, cells.map(cell => cell.iso)),
    [filtered, cells],
  );

  const selectedEvents = eventsByDate[selectedDate] ?? [];
  const selectedDayView = selectedDayScheduleView(
    selectedEvents,
    activeFilter,
    calendarScheduleMode,
    overseasOnly,
  );
  const effectiveCalendarScheduleMode = selectedDayView.effectiveMode;
  const visibleSelectedEvents = selectedDayView.visibleReleases;
  const undatedGroups = useMemo(() => Object.entries(sourceHealth).flatMap(([key, health]) =>
    health?.undated?.length ? [{
      sourceKey: key,
      label: sourceCatalog.find((source) => source.key === key)?.label ?? key,
      items: health.undated,
    }] : [],
  ), [sourceHealth]);
  const undatedCount = undatedGroups.reduce((count, group) => count + group.items.length, 0);
  const savedExportReleases = useMemo(
    () => releases.filter((release) => savedReleaseIds.has(String(release.id))),
    [releases, savedReleaseIds],
  );
  const savedExportCount = useMemo(() => releaseCalendarEventCount(savedExportReleases), [savedExportReleases]);
  const monthExportCount = useMemo(
    () => releaseCalendarEventCount(filtered, { month: activeMonth }),
    [filtered, activeMonth],
  );
  const todayReleases = filtered
    .filter((release) => appearsOnDate(release, todayIso))
    .sort((a, b) => (a.releaseTime ?? "99:99").localeCompare(b.releaseTime ?? "99:99"));
  const tomorrowIso = addDays(todayIso, 1);
  const tomorrowReleases = filtered
    .filter((release) => appearsOnDate(release, tomorrowIso))
    .sort((a, b) =>
      (a.releaseTime ?? "99:99").localeCompare(b.releaseTime ?? "99:99"),
    );
  const activeDailyReleases =
    dailyScope === "today" ? todayReleases : tomorrowReleases;
  const requestedDailyMode =
    dailyScope === "today" ? todayScheduleMode : tomorrowScheduleMode;
  const activeDailyMode = effectiveScheduleMode(
    activeFilter,
    requestedDailyMode,
  );
  const visibleDailyReleases = releasesForScheduleMode(
    activeDailyReleases,
    activeDailyMode,
  );
  const todayCount = releases.filter((release) =>
    appearsOnDate(release, todayIso),
  ).length;
  const reviewCount = releases.filter((release) => release.confidence < 80).length;
  const autoSourceCount = Object.entries(sourceHealth).filter(
    ([key, health]) => key !== "database" && health?.status === "connected",
  ).length;
  const schedulesConfirmed = isDemo || (loadState === "live" && collectionState?.status === "current" && !feedError);
  const collectionFinishedWithErrors = collectionState?.status === "failed" && (collectionState.pendingSources ?? 0) === 0;

  function exportCalendar(scope: "month" | "saved") {
    try {
      downloadReleaseCalendar(
        scope === "saved" ? savedExportReleases : filtered,
        `yugwajang-${scope === "saved" ? "saved" : activeMonth}`,
        scope === "saved" ? {} : { month: activeMonth },
      );
      setExportMessage("ICS 파일을 캘린더 앱에서 불러오세요.");
    } catch {
      setExportMessage("일정 파일을 만들지 못했습니다. 다시 시도해 주세요.");
    }
  }

  function changeDailyScheduleMode(mode: ScheduleMode) {
    if (dailyScope === "today") {
      setTodayScheduleMode(mode);
      return;
    }
    setTomorrowScheduleMode(mode);
  }

  function toggleSavedRelease(releaseId: string) {
    void savedController.toggle(releaseId);
  }

  function focusReleaseDate(
    releaseDate: string,
    preferDetails = false,
    toggleWhenSelected = false,
  ) {
    if (view === "today") {
      router.push(`/calendar?date=${encodeURIComponent(releaseDate)}#selected-day`);
      return;
    }
    const willOpen =
      toggleWhenSelected && releaseDate === selectedDate
        ? !selectedDayOpen
        : true;
    setSelectedDate(releaseDate);
    setActiveMonth(releaseDate.slice(0, 7));
    setSelectedDayOpen(willOpen);
    if (!willOpen) return;
    if (releaseDate !== selectedDate || !selectedDayOpen) {
      setCalendarScheduleMode("all");
    }
    requestAnimationFrame(() => {
      const useDetails =
        preferDetails || window.matchMedia("(max-width: 760px)").matches;
      document
        .getElementById(useDetails ? "selected-day" : "calendar")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function submitRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage("");
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch("/api/releases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { release?: Release; error?: string };
      if (!response.ok || !data.release) throw new Error(data.error ?? "저장에 실패했습니다.");
      setReleases((current) => (isDemo ? [data.release!] : [...current, data.release!]));
      setLoadState("live");
      setSelectedDate(data.release.releaseDate);
      setActiveMonth(data.release.releaseDate.slice(0, 7));
      setSaveMessage("자체 데이터베이스에 저장했습니다.");
      form.reset();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={`app-shell${view === "calendar" ? " calendar-page" : ""}`}>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="리셀하는 유과장 발매달력 — 오늘 일정">
          <span className="brand-dot" />
          <span>리셀하는 유과장</span>
          <span className="brand-name-short" aria-hidden="true">유과장</span>
          <em>발매달력</em>
        </Link>
        <nav className="topnav" aria-label="주요 메뉴">
          <Link
            className={view === "today" ? "active" : ""}
            href="/"
            aria-current={view === "today" ? "page" : undefined}
          >
            오늘
          </Link>
          <Link
            className={view === "calendar" ? "active" : ""}
            href="/calendar"
            aria-current={view === "calendar" ? "page" : undefined}
          >
            월간 달력
          </Link>
        </nav>
        <div className="account">
          <span className={`status-dot ${signedIn ? "online" : ""}`} />
          <span>{userName}</span>
          <button className="admin-trigger" type="button" onClick={() => setAdminOpen(true)}>
            + 일정 등록
          </button>
        </div>
      </header>

      {view === "today" ? (
        <section className="hero" id="top">
          <div className="hero-copy">
            <span className="eyebrow">TODAY · {updatedAtLabel} 기준</span>
            <h1>오늘·내일 발매,<br />빠르게 확인.</h1>
            <span className="motto-chip">사기 전에 마진 구조를 확정하라!</span>
            <p>가까운 일정을 오늘과 내일로 나눴습니다. 모레 이후 일정은 월간 달력에서 확인할 수 있습니다. 각 상품의 <b>마진 계산기</b>로 응모 전에 예상 순이익부터 계산해 보세요.</p>
          </div>
          <div className="metric-grid" aria-label="발매 현황 요약">
            <article>
              <span>오늘 발매</span>
              <strong>{releaseFeedCountLabel(todayCount, schedulesConfirmed, true)}</strong>
              <small>오늘 체크할 일정</small>
            </article>
            <article className="lime-card">
              <span>내일 일정</span>
              <strong>{releaseFeedCountLabel(tomorrowReleases.length, schedulesConfirmed, true)}</strong>
              <small>{tomorrowIso.slice(5).replace("-", ".")} 체크할 일정</small>
            </article>
            <article>
              <span>검수 필요</span>
              <strong>{releaseFeedCountLabel(reviewCount, schedulesConfirmed, true)}</strong>
              <small>출처 확인 대기</small>
            </article>
          </div>
        </section>
      ) : (
        <section className="calendar-intro" id="top">
          <div>
            <h1>월간 발매 달력</h1>
            <p>날짜를 눌러 발매 일정과 판매처를 확인하세요.</p>
          </div>
        </section>
      )}

      <section className="discovery-controls" aria-label="발매 둘러보기">
        <OfficialInstagramDialog status={sourceHealth.sns?.status} publicStatus={sourceHealth.instagramPublic?.status} publicCount={sourceHealth.instagramPublic?.count} />
        {view === "today" && <div>
          <span className="section-kicker">RELEASE DISCOVERY</span>
          <p>카테고리와 발매 유형으로 빠르게 골라보세요.</p>
        </div>}
        <ReleaseFilters
          value={activeFilter}
          onChange={setActiveFilter}
          showSaved={savedUiAvailable}
          savedLoading={savedLoadState === "loading"}
          showOverseas={view === "calendar"}
          overseasOnly={overseasOnly}
          onOverseasChange={setOverseasOnly}
        />
        {activeFilter === "saved" && (
          <div className="month-controls">
            <button
              type="button"
              onClick={() => exportCalendar("saved")}
              disabled={isDemo || loadState !== "live" || savedExportCount === 0 || savedLoadState !== "ready"}
              title="저장한 관심 발매 전체를 ICS 파일로 저장"
            >
              관심 일정 내보내기
            </button>
          </div>
        )}
        {exportMessage && <p className="saved-release-status" role="status">{exportMessage}</p>}
        {loadState === "live" && !schedulesConfirmed && (
          <div className="saved-release-status" role="status">
            <span>
              {collectionFinishedWithErrors
                ? "최신 일정 확인을 마치지 못했습니다."
                : feedError
                  ? "연결이 잠시 끊겨 자동으로 다시 확인 중입니다."
                  : "최신 일정을 업데이트 중입니다."}
              {releases.length > 0
                ? " 마지막으로 받은 일정을 표시하며, 빈 날짜는 아직 확인 중입니다."
                : collectionFinishedWithErrors
                  ? " 잠시 후 다시 확인해 주세요. 빈 날짜는 확정된 결과가 아닙니다."
                  : " 확인이 완료되면 일정이 자동으로 표시됩니다."}
            </span>
            {collectionFinishedWithErrors && <button type="button" onClick={() => setReloadKey(value => value + 1)}>다시 확인 ↻</button>}
          </div>
        )}
        {savedUiAvailable && savedLoadState === "loading" && (
          <p className="saved-release-status" role="status">
            관심 발매 목록을 불러오는 중입니다…
          </p>
        )}
        {savedUiAvailable && savedLoadState === "error" && (
          <div className="saved-release-status is-error" role="alert">
            <span>{savedState.listError}</span>
            <button
              type="button"
              onClick={() => void savedController.load()}
            >
              다시 불러오기
            </button>
          </div>
        )}
        {savedUiAvailable && savedMutationError && (
          <p className="saved-release-status is-error" role="alert">
            {savedMutationError}
          </p>
        )}
        {signedIn && savedLoadState === "unauthorized" && (
          <p className="saved-release-status is-error" role="alert">
            로그인 상태가 변경되어 관심 발매 정보를 숨겼습니다.
          </p>
        )}
      </section>

      {view === "calendar" && (
      <section className="workspace" id="calendar">
        <PeriodNavigation
          view={view}
          dailyScope={dailyScope}
          todayCount={releaseFeedCountLabel(todayReleases.length, schedulesConfirmed)}
          tomorrowCount={releaseFeedCountLabel(tomorrowReleases.length, schedulesConfirmed)}
          onSelectDaily={setDailyScope}
        />
        <div className="workspace-head">
          <div>
            <h2>{monthLabel(activeMonth)}</h2>
          </div>
          <div className="calendar-header-actions">
          <div className="month-controls">
            <button type="button" aria-label="이전 달" onClick={() => { setActiveMonth(shiftMonth(activeMonth, -1)); setSelectedDayOpen(false); }}>←</button>
            <button type="button" onClick={() => focusReleaseDate(todayIso, true)}>오늘</button>
            <button type="button" aria-label="다음 달" onClick={() => { setActiveMonth(shiftMonth(activeMonth, 1)); setSelectedDayOpen(false); }}>→</button>
          </div>
          <button
            className="calendar-export-button"
            type="button"
            onClick={() => exportCalendar("month")}
            disabled={isDemo || loadState !== "live" || monthExportCount === 0 || (activeFilter === "saved" && savedLoadState !== "ready")}
            title="현재 검색·필터에 맞는 이달 일정을 ICS 파일로 저장"
          >
            이달 내보내기
          </button>
          </div>
        </div>

        <div className="filterbar">
          <label className="searchbox">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="브랜드 또는 일정 검색"
              aria-label="브랜드 또는 일정 검색"
            />
          </label>
          <span
            className={`data-badge ${
              loadState === "live" ? "live" : loadState === "demo" ? "demo" : ""
            }`}
          >
            {loadState === "loading"
              ? "일정 불러오는 중…"
              : loadState === "error"
                ? "연결 안 됨 — 새로고침 필요"
                : loadState === "demo"
                  ? "연습용 데모 화면"
                  : !schedulesConfirmed
                    ? collectionFinishedWithErrors ? "최신 일정 확인 필요" : "최신 일정 업데이트 중"
                  : autoSourceCount > 0
                    ? `자동 연결 ${autoSourceCount}곳`
                    : "자체 등록 일정"}
          </span>
        </div>

        <div className="calendar-layout">
          <div className="calendar-card">
            <div className="weekday-row" aria-hidden="true">
              {['일', '월', '화', '수', '목', '금', '토'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {cells.map((cell) => {
                const cellEvents = eventsByDate[cell.iso] ?? [];
                const dayCountLabel = cellEvents.length === 0 && !schedulesConfirmed && overseasOnly ? "—" : calendarDayCountLabel(
                  cellEvents.length,
                  overseasOnly,
                );
                const isToday = cell.iso === todayIso;
                const isSelected =
                  selectedDayOpen && cell.iso === selectedDate;
                return (
                  <button
                    key={cell.iso}
                    className={`day-cell ${cell.outside ? "outside" : ""} ${isSelected ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => focusReleaseDate(cell.iso, true, true)}
                    aria-label={`${dateLabel(cell.iso)} ${cellEvents.length === 0 && !schedulesConfirmed ? "일정 확인 중" : `${cellEvents.length}건`} ${isSelected ? "일정 접기" : "일정 펼치기"}`}
                    aria-expanded={isSelected}
                    aria-controls="selected-day"
                  >
                    <span className={`day-number ${isToday ? "today" : ""}`}>
                      {cell.day}
                    </span>
                    {dayCountLabel && (
                      <span className="day-count">
                        {dayCountLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDayOpen && (
          <aside className="day-panel" id="selected-day" aria-live="polite">
            <div className="day-panel-head">
              <div>
                <span>EXPANDED DAY</span>
                <h3>{dateLabel(selectedDate)}</h3>
              </div>
              <div className="day-panel-controls">
                <strong>{releaseFeedCountLabel(selectedEvents.length, schedulesConfirmed)}</strong>
                <button
                  type="button"
                  onClick={() => setSelectedDayOpen(false)}
                  aria-label="선택한 날짜 일정 접기"
                >
                  접기 ↑
                </button>
              </div>
            </div>
            {selectedDayView.showScheduleTabs && (
              <ScheduleTypeTabs
                scope="calendar-schedule"
                label={`${dateLabel(selectedDate)} 일정 유형`}
                releases={selectedEvents}
                value={effectiveCalendarScheduleMode}
                onChange={setCalendarScheduleMode}
                confirmed={schedulesConfirmed}
              />
            )}
            <div
              className="day-events"
              id="calendar-schedule-panel"
              role={
                selectedDayView.showScheduleTabs ? "tabpanel" : undefined
              }
              aria-labelledby={
                selectedDayView.showScheduleTabs
                  ? `calendar-schedule-${effectiveCalendarScheduleMode}-tab`
                  : undefined
              }
            >
              {visibleSelectedEvents.length ? visibleSelectedEvents.map((release) => {
                const destination = destinationFor(release);
                const officialSourceUrl = safeRetailerUrl(release.sourceUrl);
                const statusLabel = releaseStatusLabel(
                  release,
                  todayIso,
                  clockIso,
                );
                const releaseId = String(release.id);
                const bookmarkView = savedReleaseButtonView(
                  savedState,
                  releaseId,
                );
                return (
                  <article
                    className={`day-event ${release.releaseDate === todayIso ? "is-today" : ""}`}
                    key={release.id}
                  >
                  <div className="event-topline">
                    <div className="event-labels">
                      <span className={`category-chip cat-${release.category}`}>
                        {categoryMeta[release.category].mark} {categoryMeta[release.category].label}
                      </span>
                      <span className="status-chip">{release.releaseDate !== selectedDate ? release.category === "응모" ? "응모 기간" : "판매 기간" : statusLabel}</span>
                      <ReleaseBadges release={release} />
                    </div>
                    <div className="event-topline-meta">
                      {savedUiAvailable && !isDemo && (
                        <SavedReleaseButton
                          releaseId={releaseId}
                          {...bookmarkView}
                          onToggle={toggleSavedRelease}
                        />
                      )}
                      <time>
                        {releaseTimeLabel(release, "시간 미정")}
                        {isOverseasRelease(release) ? " · KST" : ""}
                      </time>
                    </div>
                  </div>
                  {destination ? (
                    <a
                      className="event-title-link"
                      href={destination}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <h4>{release.title}</h4>
                      <small>{directLinkLabel(release)} ↗ · {destinationHost(destination)}</small>
                    </a>
                  ) : (
                    <h4>{release.title}</h4>
                  )}
                  <p className="event-brand">{release.brand} · {release.channel}</p>
                  <details className="day-event-more">
                    <summary>상세 정보와 링크</summary>
                    <div className="day-event-details">
                      <ReleaseFacts release={release} />
                      {release.note && <p className="release-note">{release.note}</p>}
                      <div className="event-actions">
                        <DirectLink release={release} />
                        {release.category !== "수강" && <KreamLink item={release} />}
                        {officialSourceUrl &&
                          !sameUrl(destination, officialSourceUrl) && (
                            <a
                              className="source-reference"
                              href={officialSourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              데이터 출처
                            </a>
                          )}
                      </div>
                      {release.category !== "수강" && (
                        <MarginCalculator release={release} />
                      )}
                      <footer>
                        <span>일정 출처 · {release.sourceName}</span>
                        <span>
                          통합 발매 정보 마지막 확인 ·{" "}
                          {release.lastVerifiedLabel ?? "확인 시각 미정"}
                        </span>
                        <span className={release.confidence < 80 ? "low-confidence" : ""}>{release.sourceName === "sibna" ? "SIBNA 공개 일정" : `신뢰도 ${release.confidence}%`}</span>
                      </footer>
                    </div>
                  </details>
                </article>
                );
              }) : (
                <div className="empty-state">
                  <span>○</span>
                  <h4>
                    {!schedulesConfirmed
                      ? collectionFinishedWithErrors ? "최신 일정 확인이 필요합니다." : "이 날짜의 최신 일정을 확인 중입니다…"
                      : selectedEvents.length
                      ? `이 날짜에는 ${scheduleModeLabel(effectiveCalendarScheduleMode)} 일정이 없습니다`
                      : selectedDayEmptyCopy(
                          overseasOnly,
                          activeFilter,
                          query,
                        )}
                  </h4>
                  <p>
                    {!schedulesConfirmed
                      ? "빈 날짜를 아직 일정 없음으로 확정하지 않았습니다. 확인한 일정이 여기에 표시됩니다."
                      : selectedEvents.length
                      ? "옆 탭을 누르면 다른 유형의 일정을 확인할 수 있습니다."
                      : "관리자 등록 또는 연결된 출처 확인 후 이 날짜에 표시됩니다."}
                  </p>
                  <button type="button" onClick={() => setAdminOpen(true)}>이 날짜에 추가</button>
                </div>
              )}
            </div>
          </aside>
          )}
        </div>
      </section>
      )}

      {view === "today" && featuredCollaborations.length > 0 && (
        <section
          className="featured-collabs"
          aria-labelledby="featured-collab-title"
        >
          <div className="section-title-row">
            <div>
              <span className="section-kicker">FEATURED COLLABORATIONS</span>
              <h2 id="featured-collab-title">주목할 협업 발매</h2>
            </div>
            <span>{featuredCollaborations.length} ITEMS</span>
          </div>
          <p className="featured-collab-helper">
            협업 발매는 아래 전체 일정에도 함께 표시됩니다.
          </p>
          <div className="featured-collab-grid">
            {featuredCollaborations.map((release) => {
              const destination = destinationFor(release);
              const officialSourceUrl = safeRetailerUrl(release.sourceUrl);
              const channels = release.channels ?? [];
              const channelCount = releaseChannelCount(release);
              const releaseId = String(release.id);
              const bookmarkView = savedReleaseButtonView(
                savedState,
                releaseId,
              );
              return (
                <article className="featured-collab-card" key={release.id}>
                  <div className="featured-collab-topline">
                    <ReleaseBadges release={release} />
                    <div className="featured-collab-actions">
                      {savedUiAvailable && !isDemo && (
                        <SavedReleaseButton
                          releaseId={releaseId}
                          {...bookmarkView}
                          onToggle={toggleSavedRelease}
                        />
                      )}
                      <time dateTime={release.releaseDate}>
                        {relativeDateLabel(release.releaseDate, todayIso)}
                      </time>
                    </div>
                  </div>
                  {destination ? (
                    <a
                      className="featured-collab-title"
                      href={destination}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <h3>{release.title}</h3>
                      <span aria-hidden="true">↗</span>
                    </a>
                  ) : (
                    <h3>{release.title}</h3>
                  )}
                  <p>
                    {release.brand} · {release.retailer ?? release.channel}
                  </p>
                  <dl className="featured-collab-facts">
                    <div>
                      <dt>발매</dt>
                      <dd>
                        {release.releaseDate} ·{" "}
                        {release.releaseTime ?? "시간 미정"}
                      </dd>
                    </div>
                    <div>
                      <dt>판매처</dt>
                      <dd>{channelCount > 0 ? `${channelCount}개 채널` : "확인 중"}</dd>
                    </div>
                  </dl>
                  <footer className="featured-collab-footer">
                    {officialSourceUrl ? (
                      <a
                        href={officialSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        일정 원문 ↗
                      </a>
                    ) : (
                      <span>일정 원문 확인 중</span>
                    )}
                    <span>
                      통합 발매 정보 마지막 확인 ·{" "}
                      {release.lastVerifiedLabel ?? "확인 시각 미정"}
                    </span>
                  </footer>
                  {channelCount > 1 && (
                    <details className="retailer-channels">
                      <summary>{channelCount}개 판매처 채널 보기</summary>
                      <ul>
                        {channels.map((channel) => {
                          const channelProductUrl = safeRetailerUrl(
                            channel.productUrl,
                          );
                          const channelSourceUrl = safeRetailerUrl(
                            channel.sourceUrl,
                          );
                          const channelUrl =
                            channelProductUrl ?? channelSourceUrl;
                          return (
                            <li
                              key={[
                                channel.sourceKey,
                                channel.productUrl,
                                channel.releaseDate,
                                channel.releaseTime,
                              ].join(":")}
                            >
                              <div>
                                <b>{channel.retailer}</b>
                                <span>
                                  {channel.releaseDate} ·{" "}
                                  {channel.releaseTime ?? "시간 미정"}
                                  {channel.priceLabel
                                    ? ` · ${channel.priceLabel}`
                                    : ""}
                                </span>
                              </div>
                              <span className="retailer-channel-links">
                                {channelUrl && (
                                  <a
                                    href={channelUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    판매 페이지 ↗
                                  </a>
                                )}
                                {channelSourceUrl &&
                                  !sameUrl(channelUrl, channelSourceUrl) && (
                                    <a
                                      href={channelSourceUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      일정 원문 ↗
                                    </a>
                                  )}
                                {!channelUrl && !channelSourceUrl && (
                                  <span>링크 확인 필요</span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {view === "today" && (
      <section className="lower-grid" id="upcoming">
        <div className="daily-schedule-section">
          <PeriodNavigation
            view={view}
            dailyScope={dailyScope}
            todayCount={releaseFeedCountLabel(todayReleases.length, schedulesConfirmed)}
            tomorrowCount={releaseFeedCountLabel(tomorrowReleases.length, schedulesConfirmed)}
            onSelectDaily={setDailyScope}
          />
          <div className="section-title-row">
            <div>
              <span className="section-kicker">
                {dailyScope === "today"
                  ? "TODAY'S RELEASES"
                  : "TOMORROW'S RELEASES"}
              </span>
              <h2>{dailyScope === "today" ? "오늘 일정" : "내일 일정"}</h2>
            </div>
            <span>{releaseFeedCountLabel(activeDailyReleases.length, schedulesConfirmed)} ITEMS</span>
          </div>
          <ScheduleTypeTabs
            scope="daily-schedule"
            label={`${dailyScope === "today" ? "오늘" : "내일"} 일정 유형`}
            releases={activeDailyReleases}
            value={activeDailyMode}
            onChange={changeDailyScheduleMode}
            confirmed={schedulesConfirmed}
          />
          <div className="kream-guide">
            <strong>💡 유과장 한마디</strong>
            <span>
              발매가만 보고 응모하지 마세요. 상품마다 <b>KREAM 검색</b>으로 실제
              체결가(실제로 거래된 가격)를 확인하고, <b>마진 계산기</b>에서
              수수료·배송비까지 뺀 예상 순이익이 남는지 먼저 계산하는 게 순서입니다.
            </span>
          </div>
          <div
            className="release-list"
            id="daily-schedule-panel"
            role="tabpanel"
            aria-labelledby={`daily-schedule-${activeDailyMode}-tab`}
          >
            {visibleDailyReleases.map((release, index) => {
              const destination = destinationFor(release);
              const officialSourceUrl = safeRetailerUrl(release.sourceUrl);
              const releaseId = String(release.id);
              const bookmarkView = savedReleaseButtonView(
                savedState,
                releaseId,
              );
              return (
                <article
                  className={`release-row ${dailyScope === "today" ? "is-today" : ""}`}
                  key={release.id}
                >
                <div className="release-row-primary">
                  {destination ? (
                    <a
                      className="release-summary"
                      href={destination}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${release.title} · ${directLinkLabel(release)} 열기`}
                    >
                      <ReleaseSummaryContent
                        release={release}
                        index={index}
                        todayIso={todayIso}
                        currentTimeIso={clockIso}
                      />
                    </a>
                  ) : (
                    <button
                      className="release-summary"
                      type="button"
                      onClick={() => focusReleaseDate(release.releaseDate, true)}
                      aria-label={`${release.title} 상세 보기`}
                    >
                      <ReleaseSummaryContent
                        release={release}
                        index={index}
                        todayIso={todayIso}
                        currentTimeIso={clockIso}
                      />
                    </button>
                  )}
                  {savedUiAvailable && !isDemo && (
                    <SavedReleaseButton
                      releaseId={releaseId}
                      {...bookmarkView}
                      onToggle={toggleSavedRelease}
                    />
                  )}
                </div>
                <details className="release-more">
                  <summary>상세 정보와 링크</summary>
                  <div className="release-row-details">
                    <ReleaseFacts release={release} />
                    {release.note && <p className="release-row-note">{release.note}</p>}
                    <div className="release-row-actions">
                      <span>
                        일정 출처 · {release.sourceName}
                        <small>
                          통합 발매 정보 마지막 확인 ·{" "}
                          {release.lastVerifiedLabel ?? "확인 시각 미정"}
                        </small>
                      </span>
                      <DirectLink release={release} />
                      <AnnouncementLink release={release} />
                      {release.category !== "수강" && <KreamLink item={release} />}
                      {officialSourceUrl &&
                        !sameUrl(destination, officialSourceUrl) && (
                          <a
                            className="source-reference"
                            href={officialSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            일정 원문
                          </a>
                        )}
                    </div>
                    {release.category !== "수강" && (
                      <MarginCalculator release={release} />
                    )}
                  </div>
                </details>
              </article>
              );
            })}
            {visibleDailyReleases.length === 0 && loadState !== "error" && !schedulesConfirmed && (
              <div className="today-empty">
                <span>확인 중</span>
                <h3>{dailyScope === "today" ? "오늘" : "내일"} 최신 일정을 {collectionFinishedWithErrors ? "확인하지 못했습니다." : "확인 중입니다…"}</h3>
                <p>{collectionFinishedWithErrors
                  ? "마지막으로 받은 데이터에서 이 날짜의 일정을 찾지 못했습니다. 최신 일정이 없는 것으로 확정하지 않았습니다."
                  : "수집이 끝나면 자동으로 표시됩니다. 현재 빈 목록은 확인 중인 상태입니다."}</p>
                {collectionFinishedWithErrors && <button className="retry-button" type="button" onClick={() => setReloadKey(value => value + 1)}>다시 확인 ↻</button>}
              </div>
            )}
            {visibleDailyReleases.length === 0 && loadState === "error" && (
              <div className="today-empty">
                <span>연결 안 됨</span>
                <h3>일정을 불러오지 못했습니다.</h3>
                <p>
                  연결을 자동으로 다시 확인하고 있습니다. 아래 버튼으로 바로 다시 불러올 수도 있습니다.
                </p>
                <button
                  className="retry-button"
                  type="button"
                  onClick={() => setReloadKey((value) => value + 1)}
                >
                  다시 불러오기 ↻
                </button>
              </div>
            )}
            {visibleDailyReleases.length === 0 &&
              schedulesConfirmed && (
              <div className="today-empty">
                <span>
                  {scheduleModeLabel(activeDailyMode)}
                </span>
                <h3>
                  {dailyScope === "today" ? "오늘" : "내일"}{" "}
                  {scheduleModeLabel(activeDailyMode)} 일정이 없습니다.
                </h3>
                <p>
                  {activeDailyReleases.length
                    ? "옆 탭을 누르면 다른 유형의 일정을 확인할 수 있습니다."
                    : "월간 달력에서 다른 날짜의 일정을 확인해 보세요."}
                </p>
                <Link href="/calendar">월간 달력 보기 →</Link>
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {view === "calendar" && (
      <section className="calendar-support" id="undated">
        <details className="support-panel">
          <summary>
            <span>
              <small>DATE TO BE ANNOUNCED</small>
              <b>날짜 미정 공지</b>
            </span>
            <strong>{releaseFeedCountLabel(undatedCount, schedulesConfirmed)}</strong>
          </summary>
          <div className="support-panel-body">
          <p className="section-description">
            공식·판매처 공지에 공개됐지만 발매일이 아직 확인되지 않은 정보입니다.
            날짜는 추측하지 않고 미정으로 표시합니다.
          </p>
          <div className="undated-list">
            {undatedGroups.length ? (
              undatedGroups.map((group) => (
              <details className="support-panel" key={group.sourceKey}>
                <summary><b>{group.label}</b><strong>{group.items.length}</strong></summary>
                <div className="undated-list">
              {group.items.map((item) => {
                const announcementUrl = releaseDestination(item) ?? safeAnnouncementUrl(item.sourceUrl);
                return (
                  <article key={`${group.sourceKey}:${item.id}`}>
                    <div className="undated-topline">
                      <span>{item.brand || group.label}</span>
                      <em>날짜 미정</em>
                    </div>
                    <h3>{item.title}</h3>
                    <p>
                      {[
                        item.priceLabel,
                        item.styleCode ? `스타일 ${item.styleCode}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || item.note}
                    </p>
                    <div className="undated-actions">
                      {announcementUrl ? (
                        <a
                          href={announcementUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          원문 보기 ↗
                        </a>
                      ) : (
                        <span>공식 링크 확인 필요</span>
                      )}
                      {(item.styleCode || item.priceLabel) && <KreamLink item={item} />}
                    </div>
                    {item.priceLabel && <details className="day-event-more"><summary>마진 계산기</summary><MarginCalculator release={item} /></details>}
                  </article>
                );
              })}
                </div>
              </details>
              ))
            ) : (
              <div className="reference-empty">
                <strong>
                  {loadState === "loading" ? "공지를 불러오고 있습니다."
                    : loadState === "error" ? "공지를 불러오지 못했습니다."
                    : "현재 확인된 날짜 미정 공지가 없습니다."}
                </strong>
                <span>
                  {loadState === "loading" ? "확인이 끝나면 출처별로 표시됩니다."
                    : "공식 판매처의 최신 공지를 확인해 주세요."}
                </span>
              </div>
            )}
          </div>
          </div>
        </details>

      </section>
      )}

      <footer className="footer">
        <div><span className="brand-dot" /> 리셀하는 유과장 · 수강생 전용</div>
        <p>
          발매 일정과 가격은 브랜드 사정으로 변동될 수 있습니다.
          응모·구매 전 반드시 공식 페이지에서 최종 확인하세요.
        </p>
        <span>ASIA / SEOUL</span>
      </footer>

      {adminOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdminOpen(false); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
            <header>
              <div>
                <span className="section-kicker">ADMIN ENTRY</span>
                <h2 id="admin-title">새 일정 등록</h2>
              </div>
              <button type="button" aria-label="닫기" onClick={() => setAdminOpen(false)}>×</button>
            </header>
            <p className="modal-intro">공식 출처를 확인한 뒤 등록하세요. 저장된 일정은 자체 데이터로 달력에 반영됩니다.</p>
            <form onSubmit={submitRelease}>
              <label className="wide">일정 제목<input name="title" required placeholder="예: 협업 컬렉션 온라인 발매" /></label>
              <label>브랜드<input name="brand" required placeholder="브랜드명" /></label>
              <label>분류<select name="category" defaultValue="선착순"><option>선착순</option><option>응모</option><option>정보</option><option>루머</option><option>수강</option></select></label>
              <label>발매일<input name="releaseDate" type="date" required defaultValue={selectedDate} /></label>
              <label>시간<input name="releaseTime" type="time" /></label>
              <label>판매 채널<input name="channel" placeholder="온라인 / 오프라인" /></label>
              <label>출처 이름<input name="sourceName" required placeholder="공식 뉴스룸" /></label>
              <label className="wide">출처 URL<input name="sourceUrl" type="url" placeholder="https://" /></label>
              <label className="wide">관리자 메모<textarea name="note" rows={3} placeholder="수강생에게 보여줄 확인 사항" /></label>
              <div className="form-actions wide">
                <span>{saveMessage}</span>
                <button type="button" onClick={() => setAdminOpen(false)}>취소</button>
                <button className="primary" disabled={saving} type="submit">{saving ? "저장 중…" : "일정 저장"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
