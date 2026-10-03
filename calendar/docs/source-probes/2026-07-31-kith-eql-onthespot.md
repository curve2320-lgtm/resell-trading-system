# Second-wave source probe — 2026-07-31

## Scope and safeguards

This is measurement only. The standalone `npm run probe:sources` script does not
register or enable a source, import collection adapters, write D1, use
cookies/credentials/authentication, or persist response bodies. Each invocation uses
`cache: "no-store"`; the three runs below are independent live requests.

Each source starts from an explicit HTTPS URL and exact allowed host:
`kr.kith.com`, `www.eqlstore.com`, or `www.onthespot.co.kr`. Redirects are manual;
every hop counts toward five total requests, and non-HTTPS, credentialed,
nonstandard-port, cross-host, missing-location, and looping redirects are rejected.
No cookies, authorization, or referrer are sent. One 6,000 ms source-wide deadline
starts before the initial request and is shared by every redirect hop and its response
body; it is not reset per hop. Response bodies are held only in memory, capped at
1,000,000 bytes. User agent: `ReleaseCalendarCandidateProbe/2.0 (read-only; no-auth)`.

## Classification and metrics

Only anchors in fetched official HTML are considered. A useful row needs official
product/release/launch/raffle/draw/calendar/schedule evidence; editorial, campaign,
lookbook, store-guide, and about links are excluded. Kith also needs a real `News`
index heading and eligible dated link; EQL and On The Spot need an eligible official
anchor. No external discovery is substituted.

Release/index structure is evaluated before bot/consent/challenge markers. A valid
structure remains valid when a CAPTCHA or consent marker occurs only in incidental
footer/script content. Without valid structure, `blocked` requires contextual
page-level evidence: HTTP 403/429/503, a matching title/heading, an explicitly named
challenge/consent form or container, or a small visible response dominated by the
marker. Weak marker-only pages are `structure-invalid`. Reports expose only a
non-sensitive code, never response text.

Official anchors are de-duplicated by normalized URL before classification. Dates are
validated as real calendar dates. The sample window is 30 days before through 90 days
after probe time, inclusive. Zero denominators are `n/a`, not passing.

| Metric | Formula |
| --- | --- |
| Total relevant rows | Unique official anchors with positive release/product/date evidence. |
| Valid in-window candidates | Relevant rows with a title and valid date in the sample window. |
| Malformed relevant rows | Relevant rows missing a title or a real calendar date. |
| Out-of-window valid rows | Valid relevant rows outside the sample window. |
| Duplicate estimate | `(valid in-window candidates - unique identities) / valid in-window candidates`; style/SKU plus date, otherwise normalized path plus date. |

Transport, content-type, deadline, size, and redirect failures are source data;
script logic failures alone exit nonzero.

## Three independent live runs

Sample window for each run: `2026-07-01` through `2026-10-29`. A three-run gate
passes only if all three per-source measurements are structurally valid.

| Run (UTC) | Source | Status | HTTP | Content | Final URL / host | Redirects | Requests | Structural status | Official link | Relevant | In-window | Malformed | Out-of-window | Duplicates |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | --- |
| 2026-07-31T08:03:20.078Z | Kith Seoul News | measured | 200 | text/html | `https://kr.kith.com/blogs/news` / `kr.kith.com` | 0 | 1 | valid (`ok`) | `https://kr.kith.com/blogs/news/monday-program%E2%84%A2-kith-for-back-to-the-future` | 30 | 1 | 0 | 29 | 0.0% |
| 2026-07-31T08:03:20.078Z | EQL | measured | 200 | text/html | `https://www.eqlstore.com/main` / `www.eqlstore.com` | 0 | 1 | structure-invalid (`official-link-not-verified`) | not verified | 0 | 0 | 0 | 0 | n/a |
| 2026-07-31T08:03:20.078Z | On The Spot | measured | 200 | text/html | `https://www.onthespot.co.kr/` / `www.onthespot.co.kr` | 0 | 1 | structure-invalid (`official-link-not-verified`) | not verified | 0 | 0 | 0 | 0 | n/a |
| 2026-07-31T08:03:25.537Z | Kith Seoul News | measured | 200 | text/html | `https://kr.kith.com/blogs/news` / `kr.kith.com` | 0 | 1 | valid (`ok`) | `https://kr.kith.com/blogs/news/monday-program%E2%84%A2-kith-for-back-to-the-future` | 30 | 1 | 0 | 29 | 0.0% |
| 2026-07-31T08:03:25.537Z | EQL | measured | 200 | text/html | `https://www.eqlstore.com/main` / `www.eqlstore.com` | 0 | 1 | structure-invalid (`official-link-not-verified`) | not verified | 0 | 0 | 0 | 0 | n/a |
| 2026-07-31T08:03:25.537Z | On The Spot | measured | 200 | text/html | `https://www.onthespot.co.kr/` / `www.onthespot.co.kr` | 0 | 1 | structure-invalid (`official-link-not-verified`) | not verified | 0 | 0 | 0 | 0 | n/a |
| 2026-07-31T08:03:31.697Z | Kith Seoul News | measured | 200 | text/html | `https://kr.kith.com/blogs/news` / `kr.kith.com` | 0 | 1 | valid (`ok`) | `https://kr.kith.com/blogs/news/monday-program%E2%84%A2-kith-for-back-to-the-future` | 30 | 1 | 0 | 29 | 0.0% |
| 2026-07-31T08:03:31.697Z | EQL | measured | 200 | text/html | `https://www.eqlstore.com/main` / `www.eqlstore.com` | 0 | 1 | structure-invalid (`official-link-not-verified`) | not verified | 0 | 0 | 0 | 0 | n/a |
| 2026-07-31T08:03:31.697Z | On The Spot | measured | 200 | text/html | `https://www.onthespot.co.kr/` / `www.onthespot.co.kr` | 0 | 1 | structure-invalid (`official-link-not-verified`) | not verified | 0 | 0 | 0 | 0 | n/a |

## Activation decisions

Required gates are measured official release/date link, useful candidate, malformed
rate <= 10%, estimated duplicates <= 70%, requests <= 5, and three structurally
valid independent runs. `n/a` is a failed gate. This task activates no source even
when a measurement gate passes.

| Source | Official link | Useful candidate | Malformed <= 10% | Duplicates <= 70% | Requests <= 5 | Structural runs | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kith Seoul News | PASS | PASS (1) | PASS (0.0%) | PASS (0.0%) | PASS (1 each) | PASS (3/3) | **DO NOT ACTIVATE** — measurement only; no source activation is authorized in Task 12. |
| EQL | FAIL (not verified) | FAIL (0) | FAIL (n/a) | FAIL (n/a) | PASS (1 each) | FAIL (0/3) | **DO NOT ACTIVATE** — no eligible official release/date anchor verified. |
| On The Spot | FAIL (not verified) | FAIL (0) | FAIL (n/a) | FAIL (n/a) | PASS (1 each) | FAIL (0/3) | **DO NOT ACTIVATE** — no eligible official release/date anchor verified. |

No source was enabled, registered, or persisted by this task.
