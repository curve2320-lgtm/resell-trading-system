"use client";

import React, {
  useEffect,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import type {
  AdminDashboardData,
  AdminReviewDto,
  AdminReviewValueDto,
  AdminSourceHealthDto,
} from "../admin-api.ts";
import {
  createAdminDashboardController,
  type AdminDashboardController,
} from "../admin-dashboard-controller.ts";
import { officialSnsAccounts } from "../sns-config.ts";
import type { SnsIntakeInput } from "../collection/sns-intake.ts";

type AdminDashboardProps = {
  initialData: AdminDashboardData;
  now: string;
};

const REASON_LABELS: Record<AdminReviewDto["reason"], string> = {
  conflicting_schedule: "Conflicting schedule",
  possible_duplicate: "Possible duplicate",
  missing_date: "Missing release date",
  invalid_source_url: "Invalid source URL",
};

function displaySource(sourceKey: string): string {
  if (sourceKey === "newBalance") return "New Balance";
  return sourceKey.charAt(0).toUpperCase() + sourceKey.slice(1);
}

function displayValue(value: string | null): string {
  return value || "Not provided";
}

function strictIsoTimestamp(value: string | null): number | null {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

export function sourceHealthWarnings(
  health: AdminSourceHealthDto,
  now: string,
): string[] {
  const warnings: string[] = [];
  if (health.consecutiveFailures >= 3) {
    warnings.push(
      `${health.consecutiveFailures} consecutive failures`,
    );
  }
  const nowMs = strictIsoTimestamp(now);
  const lastSuccessMs = strictIsoTimestamp(health.lastSuccessAt);
  if (
    lastSuccessMs === null ||
    nowMs === null ||
    nowMs - lastSuccessMs >= 24 * 60 * 60 * 1000
  ) {
    warnings.push("24 hours without a successful collection");
  }
  return warnings;
}

export function reconcileMergeTarget(
  current: string,
  mergeTargets: AdminDashboardData["mergeTargets"],
): string {
  return mergeTargets.some(({ id }) => id === current)
    ? current
    : (mergeTargets[0]?.id ?? "");
}

function ValueList({
  label,
  value,
}: {
  label: string;
  value: AdminReviewValueDto | null;
}) {
  return (
    <section className="admin-review-values">
      <h4>{label}</h4>
      {value ? (
        <dl>
          <div>
            <dt>Title</dt>
            <dd>{displayValue(value.title)}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{displayValue(value.releaseDate)}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{displayValue(value.releaseTime)}</dd>
          </div>
        </dl>
      ) : (
        <p>No matching published release.</p>
      )}
    </section>
  );
}

function ReviewCard({
  controller,
  review,
  mergeTargets,
  pending,
}: {
  controller: AdminDashboardController;
  review: AdminReviewDto;
  mergeTargets: AdminDashboardData["mergeTargets"];
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [mergeTarget, setMergeTarget] = useState(
    reconcileMergeTarget("", mergeTargets),
  );
  const effectiveMergeTarget = reconcileMergeTarget(
    mergeTarget,
    mergeTargets,
  );
  useEffect(() => {
    setMergeTarget(effectiveMergeTarget);
  }, [effectiveMergeTarget]);

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void controller.resolveReview(review.id, {
      action: "edit",
      title: String(data.get("title") ?? "").trim(),
      releaseDate: String(data.get("releaseDate") ?? ""),
      releaseTime: String(data.get("releaseTime") ?? "") || null,
    });
  }

  return (
    <article className="admin-review-card">
      <header>
        <div>
          <span className="admin-review-reason">
            {REASON_LABELS[review.reason]}
          </span>
          <h3>{displayValue(review.candidate.title)}</h3>
        </div>
        <span>#{review.id}</span>
      </header>

      <p className="admin-review-source">
        {displaySource(review.sourceKey)} · {review.externalId}
      </p>

      <div className="admin-value-comparison">
        <ValueList label="Current value" value={review.previous} />
        <ValueList label="Candidate value" value={review.candidate} />
      </div>

      <dl className="admin-candidate-context">
        <div>
          <dt>Retailer</dt>
          <dd>{displayValue(review.candidate.retailer)}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {review.candidate.productUrl ? (
              <a
                href={review.candidate.productUrl}
                target="_blank"
                rel="noreferrer"
              >
                Product
              </a>
            ) : null}
            {review.candidate.sourceUrl ? (
              <a
                href={review.candidate.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Source
              </a>
            ) : null}
            {!review.candidate.productUrl &&
              !review.candidate.sourceUrl &&
              "No safe source URL"}
          </dd>
        </div>
      </dl>

      {editing ? (
        <form className="admin-edit-form" onSubmit={submitEdit}>
          <label>
            Title
            <input
              name="title"
              required
              maxLength={200}
              defaultValue={review.candidate.title}
            />
          </label>
          <label>
            Release date
            <input
              name="releaseDate"
              type="date"
              required
              defaultValue={review.candidate.releaseDate}
            />
          </label>
          <label>
            Release time
            <input
              name="releaseTime"
              type="time"
              defaultValue={review.candidate.releaseTime ?? ""}
            />
          </label>
          <div className="admin-inline-actions">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button type="submit" disabled={pending}>
              Save edit
            </button>
          </div>
        </form>
      ) : (
        <div className="admin-review-actions">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void controller.resolveReview(review.id, {
                action: "approve",
              })
            }
          >
            Approve
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void controller.resolveReview(review.id, {
                action: "ignore",
              })
            }
          >
            Ignore
          </button>
        </div>
      )}

      <div className="admin-merge-action">
        <label>
          Merge target
          <select
            value={effectiveMergeTarget}
            onChange={(event) => setMergeTarget(event.target.value)}
            disabled={pending || mergeTargets.length === 0}
          >
            {mergeTargets.length === 0 ? (
              <option value="">No release targets</option>
            ) : (
              mergeTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.title} · {target.releaseDate}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !effectiveMergeTarget}
          onClick={() =>
            void controller.resolveReview(review.id, {
              action: "merge",
              releaseId: effectiveMergeTarget,
            })
          }
        >
          Merge
        </button>
      </div>
      {pending ? (
        <p className="admin-action-pending" role="status">
          Applying one review action…
        </p>
      ) : null}
    </article>
  );
}

export function AdminDashboard({
  initialData,
  now,
}: AdminDashboardProps) {
  const [controller] = useState(() =>
    createAdminDashboardController({ initialData }),
  );
  const [clockIso, setClockIso] = useState(now);
  const [snsSaving, setSnsSaving] = useState(false);
  const [snsMessage, setSnsMessage] = useState("");
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    const updateClock = () => setClockIso(new Date().toISOString());
    updateClock();
    const timer = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setClockIso(new Date().toISOString());
  }, [state.data]);

  function submitSns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const input: SnsIntakeInput = {
      postUrl: String(data.get("postUrl") ?? "").trim(),
      handle: String(data.get("handle") ?? "").trim(),
      title: String(data.get("title") ?? "").trim(),
      brand: String(data.get("brand") ?? "").trim(),
      category: "sneakers",
      releaseDate: String(data.get("releaseDate") ?? "") || null,
      releaseTime: String(data.get("releaseTime") ?? "") || null,
      kind: String(data.get("kind") ?? "announcement") as SnsIntakeInput["kind"],
      styleCode: String(data.get("styleCode") ?? "") || null,
    };
    setSnsSaving(true);
    setSnsMessage("");
    void controller.submitSns(input).then((success) => {
      setSnsMessage(success ? "SNS 일정이 등록됐습니다." : "SNS 등록에 실패했습니다.");
      if (success) form.reset();
      setSnsSaving(false);
    });
  }

  return (
    <main className="admin-dashboard">
      <header className="admin-page-header">
        <div>
          <span className="section-kicker">EXCEPTION OPERATIONS</span>
          <h1>Release administration</h1>
          <p>
            Review only uncertain candidates and unhealthy sources. Published,
            healthy releases are intentionally absent.
          </p>
        </div>
        <a href="/">Back to calendar</a>
      </header>

      <section className="admin-sns-section" aria-labelledby="sns-intake-title">
        <div className="admin-section-heading">
          <div>
            <span className="section-kicker">OFFICIAL SNS INTAKE</span>
            <h2 id="sns-intake-title">Instagram 발매 공지 등록</h2>
          </div>
        </div>
        <p className="admin-health-message">
          공식 계정의 원문 링크와 확인한 일정만 저장합니다. 게시물 자체를 수집하거나 복제하지 않습니다.
        </p>
        <form className="admin-sns-form" onSubmit={submitSns}>
          <label>
            공식 계정
            <select name="handle" defaultValue={officialSnsAccounts[0].handle}>
              {officialSnsAccounts.map((account) => (
                <option key={account.handle} value={account.handle}>
                  @{account.handle} · {account.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            원 게시글 URL
            <input name="postUrl" type="url" required placeholder="https://www.instagram.com/p/..." />
          </label>
          <label>
            일정 제목
            <input name="title" required maxLength={200} placeholder="제품명 또는 발매 공지 제목" />
          </label>
          <label>
            브랜드
            <input name="brand" required maxLength={100} placeholder="Nike" />
          </label>
          <label>
            발매일
            <input name="releaseDate" type="date" />
          </label>
          <label>
            시간
            <input name="releaseTime" type="time" />
          </label>
          <label>
            유형
            <select name="kind" defaultValue="announcement">
              <option value="announcement">공지</option>
              <option value="drop">일반 발매</option>
              <option value="raffle">응모</option>
              <option value="restock">재입고</option>
            </select>
          </label>
          <label>
            스타일 코드
            <input name="styleCode" maxLength={80} placeholder="선택" />
          </label>
          <div className="admin-inline-actions">
            <span role="status">{snsMessage}</span>
            <button type="submit" disabled={snsSaving}>
              {snsSaving ? "등록 중…" : "SNS 일정 등록"}
            </button>
          </div>
        </form>
      </section>

      {state.error ? (
        <div className="admin-alert" role="alert">
          <span>{state.error}</span>
          <button
            type="button"
            onClick={() => void controller.refresh()}
            disabled={state.loading}
          >
            Retry
          </button>
        </div>
      ) : null}

      <section
        className="admin-health-section"
        aria-labelledby="source-health-title"
      >
        <div className="admin-section-heading">
          <div>
            <span className="section-kicker">SOURCE HEALTH</span>
            <h2 id="source-health-title">Collection exceptions</h2>
          </div>
        </div>
        <div className="admin-health-grid">
          {state.data.sourceHealth.map((health) => {
            const warnings = sourceHealthWarnings(health, clockIso);
            const pending = state.pendingSourceKeys.has(health.sourceKey);
            return (
              <article className="admin-health-card" key={health.sourceKey}>
                <header>
                  <h3>{displaySource(health.sourceKey)}</h3>
                  <span className={`source-state source-${health.status}`}>
                    {health.statusLabel}
                  </span>
                </header>
                <dl className="admin-health-times">
                  <div>
                    <dt>Last success</dt>
                    <dd>{displayValue(health.lastSuccessAt)}</dd>
                  </div>
                  <div>
                    <dt>Last failure</dt>
                    <dd>{displayValue(health.lastFailureAt)}</dd>
                  </div>
                </dl>
                <dl className="admin-health-metrics">
                  <div>
                    <dt>Source</dt>
                    <dd>{health.sourceCount}</dd>
                  </div>
                  <div>
                    <dt>New</dt>
                    <dd>{health.newCount}</dd>
                  </div>
                  <div>
                    <dt>Merged</dt>
                    <dd>{health.mergedCount}</dd>
                  </div>
                  <div>
                    <dt>Review</dt>
                    <dd>{health.reviewCount}</dd>
                  </div>
                </dl>
                <p className="admin-health-message">
                  {health.operatorMessage}
                </p>
                {warnings.length > 0 ? (
                  <ul className="admin-health-warnings">
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    void controller.collectSource(health.sourceKey)
                  }
                >
                  {pending
                    ? `Refreshing ${displaySource(health.sourceKey)}…`
                    : `Refresh ${displaySource(health.sourceKey)}`}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="admin-review-section"
        aria-labelledby="pending-reviews-title"
      >
        <div className="admin-section-heading">
          <div>
            <span className="section-kicker">PENDING REVIEW</span>
            <h2 id="pending-reviews-title">Decision queue</h2>
          </div>
          <strong aria-label={`${state.data.pendingCount} pending reviews`}>
            {state.data.pendingCount}
          </strong>
        </div>

        {state.data.reviews.length === 0 ? (
          <p className="admin-empty">
            No release exceptions need review.
          </p>
        ) : (
          <div className="admin-review-list">
            {state.data.reviews.map((review) => (
              <ReviewCard
                controller={controller}
                key={review.id}
                review={review}
                mergeTargets={state.data.mergeTargets}
                pending={state.pendingReviewIds.has(review.id)}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
