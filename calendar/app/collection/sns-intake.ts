import { isOfficialSnsHandle, snsAccountLabel } from "../sns-config.ts";
import { canonicalizeInstagramPostUrl } from "../sns-links.ts";
import type { CollectedRelease, ReleaseCategory } from "./types.ts";

export type SnsIntakeInput = {
  postUrl: string;
  handle: string;
  title: string;
  brand: string;
  category: ReleaseCategory;
  releaseDate: string | null;
  releaseTime: string | null;
  kind: "drop" | "raffle" | "restock" | "announcement";
  styleCode: string | null;
};

export type SnsIntakeResult =
  | { kind: "publish"; release: CollectedRelease }
  | {
      kind: "review";
      sourceKey: "sns";
      externalId: string;
      reason: "missing_date";
      payload: SnsIntakeInput & { canonicalUrl: string };
    }
  | { kind: "reject"; reason: "invalid_url" | "unofficial_account" | "disabled" };

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function snsIntakeEnabled(): boolean {
  return (process.env.RELEASE_SNS_INTAKE ?? "on").trim().toLowerCase() !== "off";
}

export function normalizeSnsIntake(
  input: SnsIntakeInput,
  collectedAt: string,
): SnsIntakeResult {
  if (!snsIntakeEnabled()) return { kind: "reject", reason: "disabled" };
  const canonicalUrl = canonicalizeInstagramPostUrl(input.postUrl);
  if (!canonicalUrl) return { kind: "reject", reason: "invalid_url" };
  if (!isOfficialSnsHandle(input.handle)) {
    return { kind: "reject", reason: "unofficial_account" };
  }

  const postMatch = canonicalUrl.match(/^https:\/\/www\.instagram\.com\/(?:p|reel)\/([^/]+)\/$/);
  const externalId = postMatch?.[1];
  if (!externalId) return { kind: "reject", reason: "invalid_url" };

  const payload = {
    ...input,
    handle: input.handle.trim().replace(/^@/, "").toLowerCase(),
    canonicalUrl,
  };
  if (!validDate(input.releaseDate)) {
    return {
      kind: "review",
      sourceKey: "sns",
      externalId,
      reason: "missing_date",
      payload,
    };
  }

  return {
    kind: "publish",
    release: {
      sourceKey: "sns",
      externalId,
      title: input.title.trim(),
      brand: input.brand.trim(),
      category: input.category,
      releaseKind: input.kind === "raffle" ? "raffle" : "general",
      releaseDate: input.releaseDate,
      releaseTime: input.releaseTime,
      priceLabel: null,
      styleCode: input.styleCode?.trim() || null,
      retailer: `SNS · @${payload.handle} · ${snsAccountLabel(payload.handle)}`,
      productUrl: null,
      sourceUrl: canonicalUrl,
      collectedAt,
    },
  };
}

