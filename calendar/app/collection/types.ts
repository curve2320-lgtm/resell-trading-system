export type ReleaseCategory = "sneakers" | "fashion" | "lifestyle";
export type ReleaseKind = "general" | "collab" | "raffle" | "offline";

export type CollectedRelease = {
  sourceKey: string;
  externalId: string;
  title: string;
  brand: string | null;
  category: ReleaseCategory;
  releaseKind: ReleaseKind;
  releaseDate: string;
  releaseTime: string | null;
  priceLabel: string | null;
  styleCode: string | null;
  retailer: string;
  productUrl: string | null;
  sourceUrl: string | null;
  collectedAt: string;
  startAt?: string | null;
  endAt?: string | null;
  announcementAt?: string | null;
  startTimeUnknown?: boolean;
  endTimeUnknown?: boolean;
  region?: string | null;
  marketScope?: "korea" | "overseas";
  note?: string;
  releaseMethod?: string | null;
  shippingMethod?: string | null;
};

export type ReviewReason =
  | "conflicting_schedule"
  | "possible_duplicate"
  | "missing_date"
  | "invalid_source_url";

export type AdapterReleaseInput = Omit<
  CollectedRelease,
  "category" | "releaseKind"
> & {
  categoryHint?: ReleaseCategory;
  releaseKindHint?: ReleaseKind;
  allowedDomains: string[];
};

export type Classification = {
  release: CollectedRelease | null;
  reviewReason: ReviewReason | null;
};
