import { fetchAdidasReleases } from "../adidas.ts";
import { fetchConverseReleases } from "../converse.ts";
import { fetchFilaReleases } from "../fila.ts";
import { fetchGrandstageReleases } from "../grandstage.ts";
import { fetchKasinaReleases } from "../kasina.ts";
import { fetchKreamReleases } from "../kream.ts";
import { fetchMusinsaReleases } from "../musinsa.ts";
import { fetchNewBalanceReleases } from "../new-balance.ts";
import { fetchNikeReleases } from "../nike.ts";
import { fetchNorthFaceReleases } from "../north-face.ts";
import { fetchPalaceReleases } from "../palace.ts";
import { fetchShoeprizeReleases } from "../shoeprize.ts";
import { fetchSoldoutReleases } from "../soldout.ts";
import { fetchWorksoutReleases } from "../worksout.ts";
import type {
  ExternalRelease,
  SourceFetchResult,
  UndatedRelease,
} from "../source-types.ts";
import type {
  ReleaseSourceAdapter,
  SourceCollectionResult,
} from "./registry.ts";
import type {
  AdapterReleaseInput,
  ReleaseKind,
} from "./types.ts";

export type ExistingSourceFetchResult = Pick<
  SourceFetchResult,
  "status" | "releases" | "message" | "undated"
> & {
  malformedRows?: number;
  snapshotComplete?: boolean;
};

type ExistingAdapterConfig = {
  key: string;
  retailer: string;
  allowedDomains: string[];
  fetcher: () => Promise<ExistingSourceFetchResult>;
  confirmsEmptySchedule?: boolean;
};

function releaseKindHint(release: ExternalRelease): ReleaseKind | undefined {
  if (
    release.category === "응모" ||
    /(?:raffle|draw|응모|추첨)/iu.test(release.releaseMethod ?? "")
  ) {
    return "raffle";
  }
  if (release.mode === "offline") {
    return "offline";
  }
  return undefined;
}

function datedRelease(
  release: ExternalRelease,
  config: ExistingAdapterConfig,
  collectedAt: string,
): AdapterReleaseInput {
  return {
    sourceKey: config.key,
    externalId: release.externalId,
    title: release.title,
    brand: release.brand || null,
    categoryHint: "sneakers",
    releaseKindHint: releaseKindHint(release),
    releaseDate: release.releaseDate,
    releaseTime: release.releaseTime,
    priceLabel: release.priceLabel ?? null,
    styleCode: release.styleCode ?? null,
    retailer: release.retailer || release.channel || config.retailer,
    productUrl: release.productUrl || release.sourceUrl,
    sourceUrl: release.sourceUrl,
    collectedAt,
    allowedDomains: config.allowedDomains,
    ...(release.startAt !== undefined ? {startAt:release.startAt} : {}),
    ...(release.endAt !== undefined ? {endAt:release.endAt} : {}),
    ...(release.announcementAt !== undefined ? {announcementAt:release.announcementAt} : {}),
    ...(release.startTimeUnknown !== undefined ? {startTimeUnknown:release.startTimeUnknown} : {}),
    ...(release.endTimeUnknown !== undefined ? {endTimeUnknown:release.endTimeUnknown} : {}),
    ...(release.region ? {region:release.region} : {}),
    ...(release.marketScope ? {marketScope:release.marketScope} : {}),
    ...(release.note ? {note:release.note} : {}),
    ...(release.releaseMethod ? {releaseMethod:release.releaseMethod} : {}),
    ...(release.shippingMethod ? {shippingMethod:release.shippingMethod} : {}),
  };
}

function undatedRelease(
  release: UndatedRelease,
  config: ExistingAdapterConfig,
  collectedAt: string,
): AdapterReleaseInput {
  return {
    sourceKey: config.key,
    externalId: release.id,
    title: release.title,
    brand: release.brand ?? null,
    categoryHint: "sneakers",
    releaseDate: "",
    releaseTime: null,
    priceLabel: release.priceLabel ?? null,
    styleCode: release.styleCode ?? null,
    retailer: config.retailer,
    productUrl: release.productUrl || release.sourceUrl,
    sourceUrl: release.sourceUrl,
    collectedAt,
    allowedDomains: config.allowedDomains,
  };
}

export function createExistingAdapter(
  config: ExistingAdapterConfig,
): ReleaseSourceAdapter {
  return {
    key: config.key,
    retailer: config.retailer,
    allowedDomains: config.allowedDomains,
    async collect(now): Promise<SourceCollectionResult> {
      const result = await config.fetcher();
      const collectedAt = now.toISOString();
      const releases = [
        ...result.releases.map((release) =>
          datedRelease(release, config, collectedAt),
        ),
        ...(result.undated ?? []).map((release) =>
          undatedRelease(release, config, collectedAt),
        ),
      ];
      const snapshotComplete =
        result.status === "connected" &&
        result.snapshotComplete === true &&
        result.malformedRows === 0;

      return {
        sourceKey: config.key,
        status: result.status,
        releases,
        message: result.message,
        authoritativeSnapshot: snapshotComplete,
        confirmedEmpty:
          snapshotComplete &&
          releases.length === 0 &&
          config.confirmsEmptySchedule === true,
      };
    },
  };
}

export const existingReleaseSourceAdapters: ReleaseSourceAdapter[] = [
  createExistingAdapter({
    key: "shoeprize",
    retailer: "SHOEPRIZE",
    allowedDomains: ["shoeprize.com"],
    fetcher: fetchShoeprizeReleases,
  }),
  createExistingAdapter({
    key: "nike",
    retailer: "Nike SNKRS Korea",
    allowedDomains: ["nike.com"],
    fetcher: fetchNikeReleases,
  }),
  createExistingAdapter({
    key: "adidas",
    retailer: "adidas 코리아",
    allowedDomains: ["adidas.co.kr", "adidas.com"],
    fetcher: fetchAdidasReleases,
  }),
  createExistingAdapter({
    key: "grandstage",
    retailer: "ABC Grand Stage",
    allowedDomains: ["a-rt.com"],
    fetcher: fetchGrandstageReleases,
  }),
  createExistingAdapter({
    key: "newBalance",
    retailer: "New Balance Korea",
    allowedDomains: ["nbkorea.com"],
    fetcher: fetchNewBalanceReleases,
  }),
  createExistingAdapter({
    key: "musinsa",
    retailer: "MUSINSA",
    allowedDomains: ["musinsa.com"],
    fetcher: fetchMusinsaReleases,
  }),
  createExistingAdapter({
    key: "soldout",
    retailer: "SOLDOUT",
    allowedDomains: ["soldout.co.kr"],
    fetcher: fetchSoldoutReleases,
  }),
  createExistingAdapter({
    key: "worksout",
    retailer: "WORKSOUT",
    allowedDomains: ["worksout.co.kr"],
    fetcher: fetchWorksoutReleases,
  }),
  createExistingAdapter({
    key: "kasina",
    retailer: "KASINA",
    allowedDomains: ["kasina.co.kr"],
    fetcher: fetchKasinaReleases,
  }),
  createExistingAdapter({
    key: "kream",
    retailer: "KREAM DRAW",
    allowedDomains: ["kream.co.kr"],
    fetcher: fetchKreamReleases,
  }),
  createExistingAdapter({
    key: "converse",
    retailer: "Converse Korea",
    allowedDomains: ["converse.co.kr"],
    fetcher: fetchConverseReleases,
  }),
  createExistingAdapter({
    key: "fila",
    retailer: "FILA Korea",
    allowedDomains: ["fila.co.kr"],
    fetcher: fetchFilaReleases,
  }),
  createExistingAdapter({
    key: "northFace",
    retailer: "노스페이스 공식몰",
    allowedDomains: ["thenorthfacekorea.co.kr"],
    fetcher: fetchNorthFaceReleases,
  }),
  createExistingAdapter({
    key: "palace",
    retailer: "PALACE 서울",
    allowedDomains: ["palaceskateboards.seoul.kr"],
    fetcher: fetchPalaceReleases,
  }),
];
