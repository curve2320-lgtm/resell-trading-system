import type { CollectedRelease, ReleaseCategory } from "./types.ts";

export type LegacyReleaseRow = {
  id: number;
  externalId: string | null;
  title: string;
  brand: string;
  category: string;
  releaseDate: string;
  releaseTime: string | null;
  channel: string;
  sourceName: string;
  sourceUrl: string | null;
  retailer: string | null;
  priceLabel: string | null;
  styleCode: string | null;
  productUrl: string | null;
  note?: string;
  releaseMethod?: string | null;
};

function sourceKey(sourceName: string): string {
  const normalized = sourceName.trim().toLowerCase();
  if (normalized.includes("shoeprize")) return "shoeprize";
  if (normalized.includes("nike")) return "nike";
  if (normalized.includes("adidas")) return "adidas";
  if (normalized.includes("new balance") || normalized.includes("뉴발란스")) return "newBalance";
  if (normalized.includes("musinsa") || normalized.includes("무신사")) return "musinsa";
  if (normalized.includes("kasina")) return "kasina";
  if (normalized.includes("worksout")) return "worksout";
  if (normalized.includes("soldout")) return "soldout";
  if (normalized.includes("kream")) return "kream";
  return "legacy";
}

function category(value: string): ReleaseCategory {
  const normalized = value.trim();
  if (normalized.includes("패션")) return "fashion";
  if (normalized.includes("라이프") || normalized.includes("레고")) return "lifestyle";
  return "sneakers";
}

export function legacyReleaseToCollected(
  row: LegacyReleaseRow,
  collectedAt: string,
): CollectedRelease {
  return {
    sourceKey: `legacy:${sourceKey(row.sourceName)}`,
    externalId: `legacy:${row.id}:${row.externalId ?? row.id}`,
    title: row.title,
    brand: row.brand || null,
    category: category(row.category),
    releaseKind: row.category.includes("응모") ? "raffle" : "general",
    releaseDate: row.releaseDate,
    releaseTime: row.releaseTime,
    priceLabel: row.priceLabel,
    styleCode: row.styleCode,
    retailer: row.retailer || row.channel || row.sourceName,
    productUrl: row.productUrl,
    sourceUrl: row.sourceUrl,
    collectedAt,
    ...(row.note !== undefined ? {note:row.note} : {}),
    ...(row.releaseMethod !== undefined ? {releaseMethod:row.releaseMethod} : {}),
  };
}
