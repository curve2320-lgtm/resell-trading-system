export type ExternalCategory = "선착순" | "응모" | "정보";

export type ExternalRelease = {
  id: string;
  externalId: string;
  title: string;
  brand: string;
  category: ExternalCategory;
  releaseDate: string;
  releaseTime: string | null;
  channel: string;
  sourceName: string;
  sourceUrl: string;
  status: "예정";
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
};

export type UndatedRelease = {
  id: string;
  title: string;
  sourceUrl: string;
  note: string;
  brand?: string | null;
  priceLabel?: string | null;
  styleCode?: string | null;
  productUrl?: string | null;
};

export type SourceFetchResult = {
  status: "connected" | "error" | "manual";
  releases: ExternalRelease[];
  message: string;
  undated?: UndatedRelease[];
};
