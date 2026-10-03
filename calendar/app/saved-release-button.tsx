"use client";

import React from "react";

export function SavedReleaseButton({
  releaseId,
  saved,
  pending,
  disabled,
  error,
  onToggle,
}: {
  releaseId: string;
  saved: boolean;
  pending: boolean;
  disabled: boolean;
  error: string | null;
  onToggle: (releaseId: string) => void;
}) {
  return (
    <span className="saved-release-control">
      <button
        type="button"
        aria-label={
          saved ? "관심 발매에서 삭제" : "관심 발매에 저장"
        }
        aria-pressed={saved}
        aria-busy={pending}
        className={`saved-release-button ${saved ? "is-saved" : ""}`}
        disabled={disabled}
        onClick={() => onToggle(releaseId)}
      >
        <span aria-hidden="true">{saved ? "★" : "☆"}</span>
      </button>
      {error && (
        <span className="saved-release-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
