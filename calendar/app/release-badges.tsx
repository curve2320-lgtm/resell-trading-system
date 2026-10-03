import React from "react";

export type BadgeableRelease = {
  releaseKind?: "general" | "collab" | "raffle" | "offline";
  hasScheduleChange?: boolean;
};

export type ReleaseBadgeLabel =
  | "COLLAB"
  | "RAFFLE"
  | "SEOUL ONLY"
  | "일정 변경";

export function releaseBadgeLabels(
  release: BadgeableRelease,
): ReleaseBadgeLabel[] {
  const labels: ReleaseBadgeLabel[] = [];
  if (release.releaseKind === "collab") labels.push("COLLAB");
  if (release.releaseKind === "raffle") labels.push("RAFFLE");
  if (release.releaseKind === "offline") labels.push("SEOUL ONLY");
  if (release.hasScheduleChange) labels.push("일정 변경");
  return labels;
}

export function ReleaseBadges({
  release,
}: {
  release: BadgeableRelease;
}) {
  const labels = releaseBadgeLabels(release);
  if (labels.length === 0) return null;

  return (
    <span className="release-badges" role="group" aria-label="발매 특징">
      {labels.map((label) => (
        <span
          className={`release-badge badge-${label === "일정 변경" ? "changed" : label.toLowerCase().replace(" ", "-")}`}
          key={label}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
