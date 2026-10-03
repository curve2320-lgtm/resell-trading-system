# Folder Sync Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the current local release-calendar application to the existing DROPLOG CLASS Sites project without adding product features.

**Architecture:** Preserve the existing App Router application and add the bundled Vinext/Sites build adapter required for Cloudflare Workers. Replace the local JSON write adapter with the existing Drizzle schema backed by the Sites-managed `DB` D1 binding so schedule registration remains durable in production.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vinext, Vite, Cloudflare Workers, Drizzle ORM, D1, OpenAI Sites

## Global Constraints

- Reuse Sites project `appgprj_6a6024cfb5988191b0c9823944ebdcfe`.
- Preserve the existing production URL and custom access policy.
- Do not add user-facing features in this deployment.
- Do not deploy unless the production build succeeds.
- Deploy only the exact committed and packaged source state.

---

### Task 1: Add the Sites-compatible build surface

**Files:**
- Create: `.gitignore`
- Create: `.openai/hosting.json`
- Create: `build/sites-vite-plugin.ts`
- Create: `vite.config.ts`
- Create: `worker/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: the existing Next.js `app/` routes and the Sites project ID.
- Produces: `npm run build` output containing `dist/server/index.js` and `dist/.openai/hosting.json`.

- [ ] **Step 1: Add a build-output assertion**

Run:

```powershell
if (Test-Path '.\dist\server\index.js') { exit 0 } else { exit 1 }
```

Expected: FAIL because the current Next.js build does not produce the Sites worker artifact.

- [ ] **Step 2: Add hosting metadata and the bundled Sites adapter**

Create `.openai/hosting.json` with:

```json
{
  "project_id": "appgprj_6a6024cfb5988191b0c9823944ebdcfe",
  "d1": "DB",
  "r2": null
}
```

Copy the plugin's current `build/sites-vite-plugin.ts`, `vite.config.ts`, and `worker/index.ts` patterns into the project. Preserve the existing application code.

- [ ] **Step 3: Update package scripts and dependencies**

Use Vinext `0.0.50`, Vite `8.0.13`, Wrangler `4.92.0`, and the matching Cloudflare/Vite packages from the bundled starter. Keep Drizzle, React, Next.js, Tailwind, and TypeScript aligned with the starter's validated versions. Run:

```powershell
npm install
```

- [ ] **Step 4: Build and assert the worker output**

Run:

```powershell
npm run build
if (-not (Test-Path '.\dist\server\index.js')) { throw 'Missing Sites worker entry' }
if (-not (Test-Path '.\dist\.openai\hosting.json')) { throw 'Missing packaged hosting metadata' }
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .gitignore .openai build worker vite.config.ts package.json package-lock.json
git commit -m "build: add Sites deployment adapter"
```

### Task 2: Preserve durable schedule registration

**Files:**
- Modify: `db/index.ts`
- Create: `drizzle.config.ts`
- Create: `drizzle/0000_release_calendar.sql`
- Create: `drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: Cloudflare runtime binding `env.DB`.
- Produces: `getDb()` returning `drizzle(env.DB, { schema })`.

- [ ] **Step 1: Verify the local filesystem adapter is incompatible**

Run:

```powershell
rg -n 'from "fs"|writeFile|readFile' db/index.ts
```

Expected: matches show the local JSON persistence implementation.

- [ ] **Step 2: Replace the adapter with D1**

Use:

```ts
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return drizzle(env.DB, { schema });
}
```

- [ ] **Step 3: Generate and inspect the migration**

Run:

```powershell
npm run db:generate
Get-Content -Raw (Get-ChildItem '.\drizzle\*.sql' | Select-Object -First 1).FullName
```

Expected: one `releases` table with columns matching `db/schema.ts`.

- [ ] **Step 4: Rebuild**

Run:

```powershell
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add db/index.ts drizzle.config.ts drizzle
git commit -m "fix: persist release entries in D1"
```

### Task 3: Validate the synchronized application

**Files:**
- Modify only if verification identifies a build or runtime compatibility defect.

**Interfaces:**
- Consumes: local Vinext preview and `/api/releases`.
- Produces: verified `/`, `/calendar`, search, date selection, and registration modal behavior.

- [ ] **Step 1: Start the application preview**

Run:

```powershell
npm run dev
```

Expected: the server prints a healthy local URL.

- [ ] **Step 2: Verify API aggregation**

Request `/api/releases` and confirm:

```text
HTTP 200
releases is an array
sources contains database, shoeprize, nike, adidas, grandstage, newBalance,
musinsa, soldout, worksout, kasina, kream, converse, and fila
```

- [ ] **Step 3: Verify primary routes and interactions**

Confirm `/` and `/calendar` render, the calendar search filters results, a date opens its schedule list, and `+ 일정 등록` opens without submitting data.

- [ ] **Step 4: Verify responsive layout**

Confirm desktop and mobile widths retain readable navigation, calendar cells, and controls without horizontal overflow.

- [ ] **Step 5: Run the final build**

```powershell
npm run build
```

Expected: PASS with `dist/server/index.js`.

### Task 4: Save and publish the validated version

**Files:**
- No application changes.
- Create a temporary deployment archive outside the project source.

**Interfaces:**
- Consumes: the validated git branch head and Sites package archive.
- Produces: a saved Sites version deployed to the existing production URL.

- [ ] **Step 1: Commit the exact validated source**

```powershell
git add app data db public next-env.d.ts next.config.ts postcss.config.mjs tsconfig.json 실행방법.txt
git commit -m "release: sync local release calendar"
git rev-parse HEAD
```

- [ ] **Step 2: Push the committed source using a Sites write credential**

Create a source repository credential for the existing project, push the branch-head commit using a per-command HTTP authorization header, and keep the credential out of git configuration and remote URLs.

- [ ] **Step 3: Package the exact build**

Run the bundled `package-site.sh` with the project directory and a temporary `.tar.gz` path. Confirm the archive contains:

```text
dist/server/index.js
dist/.openai/hosting.json
dist/.openai/drizzle/
```

- [ ] **Step 4: Save and privately deploy one version**

Save one version using the exact pushed `commit_sha` and archive, then deploy that saved version without changing the existing access policy.

- [ ] **Step 5: Poll deployment status**

Wait until Sites reports `succeeded`. On failure, leave the previous production version active and report the blocker.

- [ ] **Step 6: Open and verify production**

Open the returned production URL and confirm the current folder branding, live-source indicator, `/calendar`, and authenticated owner display are present.

