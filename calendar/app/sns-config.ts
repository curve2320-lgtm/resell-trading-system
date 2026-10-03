export type SnsAccount = {
  platform: "instagram";
  handle: string;
  label: string;
};

const legacyManualSnsAccounts = [
  { platform: "instagram", handle: "nike", label: "Nike" },
  { platform: "instagram", handle: "adidas", label: "adidas" },
  { platform: "instagram", handle: "newbalance", label: "New Balance" },
  { platform: "instagram", handle: "asics", label: "ASICS" },
  { platform: "instagram", handle: "salomon", label: "Salomon" },
  { platform: "instagram", handle: "thenorthface", label: "The North Face" },
  { platform: "instagram", handle: "converse", label: "Converse" },
  { platform: "instagram", handle: "thisisneverthat", label: "thisisneverthat" },
  { platform: "instagram", handle: "stussy", label: "Stüssy" },
  { platform: "instagram", handle: "carharttwip", label: "Carhartt WIP" },
  { platform: "instagram", handle: "hufworldwide", label: "HUF" },
  { platform: "instagram", handle: "vans", label: "Vans" },
  { platform: "instagram", handle: "neweracap", label: "New Era" },
  { platform: "instagram", handle: "palaceskateboards", label: "PALACE" },
] as const satisfies readonly SnsAccount[];

// Keep previously trusted manual intake accounts. Automatic provenance is
// checked separately against the current website-verified Instagram catalog.
export const officialSnsAccounts: readonly SnsAccount[] = [
  ...officialInstagramAccounts.map(({handle,label})=>({platform:"instagram" as const,handle,label})),
  ...legacyManualSnsAccounts.filter(({handle})=>!officialInstagramAccounts.some((account)=>account.handle===handle)),
];

export function isOfficialSnsHandle(handle: string): boolean {
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  return officialSnsAccounts.some((account) => account.handle === normalized);
}

export function snsAccountLabel(handle: string): string {
  const normalized = handle.trim().replace(/^@/, "").toLowerCase();
  return (
    officialSnsAccounts.find((account) => account.handle === normalized)?.label ??
    normalized
  );
}

import { officialInstagramAccounts } from "./instagram-accounts.ts";
