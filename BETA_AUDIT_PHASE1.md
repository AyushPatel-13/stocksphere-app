# StockSphere — Phase One Audit & Beta Readiness

Audit date: 2026-10-24 (a Saturday, so Indian and US markets were closed). Branch `stocksphere-community-markets`, local HEAD `80aec47`, plus uncommitted commodities work from another session.
Scope: audit only. Nothing was edited apart from this file. Nothing was committed, pushed, deployed or migrated, and no production setting was changed.

**How it was checked:** read-only SQL and auth logs through the Supabase connector; GET requests against the dev server at `http://localhost:3001` (Yahoo, Upstox, Finnhub and NSE paths only, so Twelve Data, Alpha Vantage and Groq credits were not spent on purpose); `npm test`, `tsc --noEmit` and `eslint`; a signed-out-style browser pass over four pages; plain `curl` against the production URL. `next build` was **not** run, because the dev server is using this folder.

**Grades used:** PASS = behaviour verified with data. PARTIAL = works with a verified defect or gap. FAIL = verified broken. BLOCKED = could not be checked (reason given). NOT TESTED = not exercised in this pass. A page that only returns 200 is never a PASS.

> **Stage 1 progress (uncommitted, 24 Oct):**
> - Done: P1-4 (heatmap falls back to NSE's archive copy), P2-1 (provider budgets, a 60 s quote cache and a 60/min per-client limit on `/api/market`), P2-2 (AI cap 20/day), P2-5 (PKCE), P2-9 (`.env.example`; note `.env*` is git-ignored, so it isn't tracked) and the P3 dead-code removal.
> - P2-7 was withdrawn: ABOS is pre-revenue, so a $0 estimate is real.
> - Second round:
>   - `/api/health` added; it reports whether Upstox accepts the token. This app's token is a market-data token, and the profile endpoint refuses it with UDAPI1221, so the check uses a NIFTY 50 last-price call.
>   - `/asset/commodity/*` now redirects to `/commodities/*`.
>   - The AI portfolio review now includes the paper account separately, at cost only and labelled virtual money.
>   - PKCE sign-in is confirmed in the Supabase logs (`grant_type: pkce`, 200, from localhost:3001).
> - Tests now 924/924.
>
> **25 Oct (committed on the branch, not pushed):**
> - `57d28b5` smart alerts plus the fixes above. Migration `20261025000100_smart_alerts` applied with approval; its SQL tests pass.
> - `02d3d66`:
>   - Upstox 429 cooldown: one minute of going straight to Yahoo after a rate limit.
>   - India heatmap filled from Yahoo for stocks Upstox didn't price, labelled per tile. Indian indices already had a Yahoo fallback, so the earlier "no fallback" note was wrong for them.
> - `ee3d896` US quotes are Yahoo first, with Twelve Data and Alpha Vantage as backups (P2-1 largely resolved).
> - `a5ccfdb` constant-time `CRON_SECRET` checks (P3).
> - Still open:
>   - **P2-4** paper fill price stored unrounded. The stale-quote cause was fixed by the crypto session in `7896420`. Rounding belongs to the paper-trading sessions' code.
>   - **P2-6** migration-history drift.
>   - **P2-12** CSP.
>   - Everything in Stage 0 (deploy, Vercel protection, Supabase URLs, env vars).
> - Tests 945/945, tsc and eslint clean.

---

## 1. Executive summary

**Beta verdict: NO-GO today.** No P0 security or data-isolation defect was found. Testers still cannot get through the front door:

1. **Production is behind Vercel Deployment Protection.** `GET https://stocksphere-ayushpatel-13s-projects.vercel.app/login` returns `302 → https://vercel.com/sso-api?...`, and every route tested (`/`, `/dashboard`, `/api/ipo`, …) does the same. A tester without access to the Vercel team never reaches the app.
2. **Production Google sign-in returns users to `http://localhost:3001`.** Correction to the background brief: **`main` (19c46d1) already uses `getOAuthRedirectUrl()`**. That fix landed on 1 Oct in `c542a2f`. So merging PR #2 will not fix this by itself. The cause is almost certainly configuration: either Supabase *Site URL* is `http://localhost:3001` and the vercel.app origin is missing from *Redirect URLs* (Supabase then falls back to the Site URL), or Vercel has `NEXT_PUBLIC_SITE_URL=http://localhost:3001`. 4 of 5 auth users have no profile, which fits a broken sign-in loop.
3. **Production runs old code.** PR #2 is unmerged and 129 files / +12k lines behind. Local `80aec47` is **not pushed** (origin branch is at `ef63148`). The deployed commit can't be verified, because the Vercel connector gets 403 and the site is behind SSO.

The **engineering quality on the branch is high**. RLS is on every public table with owner-scoped policies. Privileged writes go through `SECURITY DEFINER` RPCs that are not executable by `anon` or `authenticated`. Server routes verify the bearer token before acting. AI links are allowlisted. Providers are written not to fabricate numbers. Results: 913/913 tests pass, `tsc` is clean and `eslint` is clean.

Main data and product gaps:
- Indian heatmap universes are down: niftyindices.com redirects to a status page, and the API returns 503.
- Alerts are checked once a day.
- Public routes that spend quota have no rate limit.
- The Upstox token may expire daily (needs confirming).
- Commodities are built but uncommitted.
- Signed-in journeys could not be exercised end to end in this pass.

---

## 2. Feature-by-feature status

"Local" = dev server on this branch plus uncommitted work. "Prod" = the vercel.app deployment.

| # | Feature / journey | Routes & APIs | Local | Prod | Evidence |
|---|---|---|---|---|---|
| 1 | Google sign-in | `/login`, Supabase OAuth | PARTIAL | **FAIL** | Auth logs show successful `login` events on 24 Oct. Prod returns users to localhost:3001 (brief and memory). Implicit flow, not PKCE. |
| 2 | Reaching the app at all | all | PASS | **BLOCKED/FAIL** | Prod returns 302 to the Vercel SSO wall on every path. |
| 3 | Onboarding / profile | `/onboarding`, `/profile`, `/profile/[username]` | NOT TESTED | BLOCKED | 5 auth users, only 1 profile row. |
| 4 | Home | `/` | PARTIAL | BLOCKED | AI panel, trending, recently viewed, movers and news render. "Most discussed" and "Top predictors" are empty because there are 0 posts and 0 predictions. |
| 5 | Dashboard / daily brief / Watchtower | `/dashboard` (`lib/dashboard/briefing.ts`, `watchtower.ts`) | NOT TESTED | BLOCKED | Auth-gated. Unit tests pass. |
| 6 | Indices | `/indices`, `/api/indices`, `/api/indices/overview` | PASS (API) | BLOCKED | Upstox source, NIFTY 22600 −0.39%, change matches previous close. |
| 7 | Stock detail (IN) | `/stock/TCS` | PARTIAL | BLOCKED | ₹2530 +23.10 (0.92%). Chart labelled "Source: Yahoo · as of 23 Oct, 03:28 pm". Market cap labelled "shares as of 2026-03-31". The header has no "market closed" badge. |
| 8 | Stock detail (US) | `/stock/AAPL` | NOT TESTED | BLOCKED | Renders 200 in 4.5 s. Data path not checked, to avoid spending Twelve Data credits. |
| 9 | ETFs / Crypto / Bonds | `/etfs`, `/crypto`, `/bonds`, `/api/assets`, `/asset/[type]/[symbol]` | PASS (API) | BLOCKED | `/api/assets?type=crypto` is in INR with `marketTime`. GOLDBEES detail renders. |
| 10 | Commodities (MCX) | `/commodities`, `/commodities/[symbol]`, `/api/commodities`, `/api/history?type=commodity` | PARTIAL | N/A (uncommitted) | Board 200 (Upstox MCX_FO). GOLD `range=1mo` gives 30-minute candles. `range=1m` is rejected (only `1d/5d/1mo/…` are valid). `/asset/commodity/GOLD` still shows "Unknown asset type". |
| 11 | Heatmap | `/heatmap`, `/api/market/heatmap[/metrics]` | **FAIL (India)** / PASS (US) | BLOCKED | `universe=nifty50` → 503. niftyindices.com CSV → `302 /sitefinity/status`. `universe=us` → 200. The UI shows "This heatmap is unavailable right now", which is honest. |
| 12 | Market movers | `/api/market/movers` | PASS | BLOCKED | NIFTY 50: 51 stocks, 14 up / 37 down, breadth 27.5%. |
| 13 | Search | `/api/search` | PASS | BLOCKED | "reliance" → RELIANCE (NSE) first. A path-traversal symbol gets 400 "Unknown asset". |
| 14 | IPO board | `/ipo`, `/api/ipo`, `/api/ipo/news` | PASS (API) | BLOCKED | Upstox IPO data; open SME issue listed with ISIN. |
| 15 | IPO / stock communities | `/community`, `/community/ipo/[id]`, `/api/community/*` | PARTIAL | BLOCKED | Migration applied. 0 posts and 0 communities, so the write path was never exercised with real data. |
| 16 | Events / earnings | `/events`, `/api/events/earnings` | PARTIAL | BLOCKED | Finnhub returns US-only earnings, with no Indian corporate events. `revenueEstimate: 0` would show as "$0" (`app/events/page.tsx:50-54`). |
| 17 | News | `/news`, `/api/news` | NOT TESTED | BLOCKED | Renders 200. |
| 18 | Screener | `/screener` | PARTIAL | BLOCKED | Saved screens live only in `localStorage` (`app/screener/page.tsx:62-80`), so they don't follow the user across devices. |
| 19 | Watchlist | `/watchlist`, `/api/watchlist/rows` | PARTIAL | BLOCKED | Rows API returns price, 52-week range and sparkline. The signed-in add/remove flow was not exercised. |
| 20 | Price alerts | `/alerts`, `/api/alerts/check` (cron) | PARTIAL | BLOCKED | Only above/below conditions, delivered as in-app notifications. The cron runs **once a day at 10:00 UTC** (US alerts are judged before the US open). 0 alerts in the DB. Whether CRON_SECRET is set on Vercel is unknown. |
| 21 | Paper trading | `/paper`, `/api/paper/orders`, `/api/paper/quote` | PARTIAL | BLOCKED | 5 real BTC trades in the DB, with server-side pricing and idempotent requestId. One fill used a quote 107 s old (limit 120 s). Price stored as `7600305.873199999`. Stock orders are correctly refused while the market is closed. |
| 22 | Portfolio | `/portfolio` | NOT TESTED | BLOCKED | `portfolio` table has 0 rows. Being redesigned by another session. |
| 23 | Predictions / leaderboard | `/predictions`, `/leaderboard`, `/api/predictions*` | NOT TESTED | BLOCKED | 0 predictions. Resolve cron is closed without a secret (401, verified). |
| 24 | Moderation | `/moderation`, `/api/community/moderation` | PASS (code) | BLOCKED | Server checks `profiles.role ∈ {moderator, admin}` through the service role. `role` is not user-updatable (column grants verified). |
| 25 | StockSphere AI | `/api/agent` + home panel | NOT TESTED live / PASS unit | **FAIL** (old code) | Sign-in plus a Postgres rate limit (5/min, 40/day) are in place. The F&O ban, concept routing and link fixes are only on the branch. |
| 26 | Backtest | `/backtest` | NOT TESTED | BLOCKED | Renders 200. |
| 27 | Beta notice | `/beta`, `BetaFooter` | NOT TESTED | BLOCKED | Renders 200. |
| 28 | Cron jobs | `vercel.json` (3 jobs) | PASS (auth) | BLOCKED | All three return 401 without a bearer token. Whether they run in prod is unknown. |

---

## 3. Issues (P0–P3)

No **P0** was found. RLS, ownership checks and service-role confinement held up on everything inspected (see §4). The caveat is that authenticated cross-user tests were not run live in this pass. They exist as SQL tests in `supabase/tests/*`, which were not run against the database.

### P1

| ID | Issue | User impact | Evidence / repro | Likely root cause | Proposed fix | Files / systems | Tests | Approval? |
|---|---|---|---|---|---|---|---|---|
| P1-1 | Production is behind Vercel SSO | No tester can open the app | `curl -sI https://stocksphere-ayushpatel-13s-projects.vercel.app/login` → 302 to `vercel.com/sso-api` | Vercel Deployment Protection (Vercel Authentication) is on for production | Turn protection off for Production, or add a public custom domain, or give testers a shareable bypass link | Vercel project settings | curl from a signed-out browser returns 200 | **Yes** (production setting) |
| P1-2 | Prod Google sign-in returns to localhost:3001 | Sign-in is impossible on prod. 4/5 users have no profile. | Brief plus memory note. `git show 19c46d1:app/login/page.tsx` already uses `NEXT_PUBLIC_SITE_URL \|\| window.location.origin` | **Configuration, not code:** Supabase Site URL = `http://localhost:3001` and/or the prod origin is missing from Redirect URLs (Supabase falls back to the Site URL), **or** Vercel `NEXT_PUBLIC_SITE_URL` points at localhost | Supabase Auth: set Site URL to the prod origin and keep `http://localhost:3001` in Redirect URLs. Add `https://stocksphere-ayushpatel-13s-projects.vercel.app/**` (and any custom domain). In Vercel, unset `NEXT_PUBLIC_SITE_URL` or set it to the prod origin, then redeploy (it is baked in at build). | Supabase Auth URL config; Vercel env | Manual: sign in on prod lands on prod and creates a profile. Unit test on `getOAuthRedirectUrl` (exists) | **Yes** |
| P1-3 | Prod runs old code; latest commit unpushed | Testers get the old AI answers ("no data", Ford/Occidental for F&O) and none of the IPO, community or terminal work | origin branch = `ef63148`; local `80aec47` is 1 ahead; PR #2 open; deploy SHA BLOCKED (Vercel 403) | PR not merged; commit not pushed | Push `80aec47`, then commit the commodities work once its session is done, run `next build` in a clean worktree, merge PR #2 and confirm the deployed SHA | git, GitHub, Vercel | `npm test`, `next build`, smoke list in §8 | **Yes** |
| P1-4 | Indian heatmap universes down | Heatmap is empty for all NIFTY universes | `/api/market/heatmap?universe=nifty50` → 503; niftyindices.com CSV → `302 /sitefinity/status` (24 Oct, 2 tries) | Single source for constituent lists, which is currently redirecting (maybe site maintenance) | Re-check Monday. Add a last-good snapshot of constituents (stored, dated, labelled "constituents as of …"), never a hand-written list. | `lib/apis/niftyIndices.ts`, `lib/services/heatmap.ts` | Unit: snapshot served with an as-of label when the live fetch fails. Live probe. | No (code); yes for a storage migration |
| P1-5 | Crons may not run in prod | Alerts never fire, predictions never resolve, IPO→stock listings never move | `CRON_SECRET` is absent from `.env.local`; routes answer 401 without it (verified). Vercel env BLOCKED. | Secret probably not set on Vercel | Set `CRON_SECRET` in Vercel Production (Vercel Cron sends it as a Bearer token) | Vercel env | After deploy, check the cron logs for 200 | **Yes** |
| P1-6 | Upstox access-token lifetime (**unverified**) | Indian prices, IPOs, commodities and movers all stop when the token lapses | `UPSTOX_ACCESS_TOKEN` is a static env var used by 11 call sites. Upstox's standard access tokens are daily (to be confirmed against Upstox docs and the account type) | A manual daily token in env | Confirm the token type. If it is daily, move to an extended or analytics token or an automated refresh, and add a health check that labels Indian data "unavailable" rather than stale | `lib/apis/upstox*.ts`, Vercel env | Health route test; alert on 401 from Upstox | Yes (env) |

### P2

| ID | Issue | Evidence | Fix | Files | Approval? |
|---|---|---|---|---|---|
| P2-1 | Public routes that spend quota have no rate limit | `/api/market?symbol=` → Twelve Data (8/min) → Alpha Vantage (25/day). `revalidate = 60` has no effect: per the Next 16 docs, route handlers are uncached unless `force-static`, and this one reads `request.url`. | A per-IP token bucket plus a short shared cache (e.g. Supabase table or in-memory per symbol) in front of Twelve Data and AV. Prefer Yahoo for non-critical fills. | `app/api/market/route.ts`, `lib/providers/market.provider.ts` | No |
| P2-2 | AI daily capacity is smaller than per-user allowance | 40 answers/user/day × N testers vs Groq 200k TPD shared (≈25–50 answers/day at 4–8k tokens) | Lower the per-user daily cap for beta (e.g. 15), keep the Gemini fallback configured in prod, and show "AI capacity reached for today" honestly | `lib/agent/access.ts`, env | No (code), yes (env) |
| P2-3 | Alerts are end-of-day only | `vercel.json`: `0 10 * * *`. Conditions are above/below only. | See §7 (Smart alerts): an intraday schedule needs an external trigger or Supabase `pg_cron`, because Vercel Hobby crons are daily | `vercel.json`, `lib/alerts/*` | Yes (infra) |
| P2-4 | Paper fill tolerance and precision | BTC fill with a 107 s old quote (`FRESH_MS` = 120 s from `SCORING_V2`). Stored price `7600305.873199999` (float from USD→INR conversion). | Per-asset freshness (crypto ≤ 15 s), round price to tick/2 dp before the RPC. **The crypto-paper session is on this; coordinate, don't duplicate.** | `lib/paper/ticket.ts`, `lib/paper/service.ts` | No |
| P2-5 | OAuth uses the implicit flow | `lib/supabase.ts` creates the client without `flowType: "pkce"`, so tokens come back in the URL fragment | Switch to PKCE and handle the code exchange on the return page | `lib/supabase.ts`, `app/login/page.tsx` | No (but redo the prod sign-in test) |
| P2-6 | Migration history drift | Remote history lacks `20261019000100_profiles` and `20261019000200_owner_columns`, though the tables and columns exist. `ai_usage` is recorded under a different name. | Reconcile history (mark as applied) so a fresh environment or branch can be rebuilt from `supabase/migrations` | Supabase migration history | **Yes** |
| P2-7 | Earnings "Revenue est. $0" | `/api/events/earnings` returns `revenueEstimate: 0` (ABOS). `compactMoney(0)` → "$0". | Treat 0 from Finnhub as "no estimate" (—) | `app/events/page.tsx`, `lib/providers` normaliser | No |
| P2-8 | `/asset/commodity/GOLD` dead end | 200 with "Unknown asset type" | Redirect `commodity` to `/commodities/[symbol]` or return 404 | `app/asset/[type]/[symbol]/page.tsx` | No (wait for the commodities commit) |
| P2-9 | `.env.example` incomplete | Lists 5 names. Code needs `UPSTOX_ACCESS_TOKEN`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`. `FMP_API_KEY` is in `.env.local` but unused. | Update the example with names only and comments | `.env.example` | No |
| P2-10 | Onboarding drop-off | 5 users, 1 profile | Re-measure after P1-2. If it persists, create the profile on first sign-in or make the gate clearer. | `components/ProfileGate.tsx`, `app/onboarding` | No |
| P2-11 | F&O ban from Vercel IPs unverified | NSE CSV → 200 from this machine. NSE often blocks cloud IPs. The handler already degrades honestly. | Probe once from prod after deploy. If blocked, add a dated cache. | `lib/apis/nseFoBan.ts` | No |
| P2-12 | No CSP | Documented as deliberate in `next.config.ts` | Report-only CSP first, then enforce | `next.config.ts` | No |
| P2-13 | Build unverified on this tree | `next build` not run (dev server conflict) | Build in a clean worktree before merging | — | No |

### P3

- Dead code with **hardcoded fake market values**: `components/Dashboard/MarketOverview.tsx` ("NIFTY 50 +0.82%", "GOLD −0.15%", …). Also unused: `StatsGrid`, `TrendingStocks`, `RecentActivity`, `WelcomeCard`, `QuickActions`, `app/BullBearVote.tsx`, `app/StockDiscussion.tsx` and `app/page-backup.tsx`. `app/Navbar.tsx` is an empty file. Delete them, so fabricated numbers can't be re-imported by accident.
- Cron secret compared with `!==` rather than a constant-time compare (`app/api/*/route.ts`). The risk is low.
- The stock header doesn't show market status. The "as of" time appears only in the chart caption.
- Leaked-password protection is off in Supabase Auth. It doesn't matter while sign-in is Google-only.
- `ai_usage` and `community_listing_checks` have RLS with no policies. That is intended (service role only), so it's informational.
- `ROADMAP.md.txt` lists Forex, Options, Futures and Mutual Funds, none of which exist. Keep the roadmap honest in anything testers see.

---

## 4. Security and financial-data findings

Reference: OWASP ASVS 4.0 areas V2/V3 (auth and session), V4 (access control), V5 (validation), V7 (errors and logging), V13 (API). This is not a certification.

**OAuth redirect URLs (V3).** The code is correct: the browser origin or `NEXT_PUBLIC_SITE_URL`, with no hardcoded host. The production failure is configuration (P1-2). The implicit flow should move to PKCE (P2-5).

**RLS and user-data isolation (V4).** Verified on the live DB:
- All 18 public tables have RLS on.
- User tables (`watchlist(s)`, `portfolio`, `activity`, `price_alerts`, `notifications`, `user_preferences`, `paper_*`) are scoped `user_id = auth.uid()` for authenticated users only. `anon` has no SELECT on them.
- `paper_accounts` and `paper_trades` are SELECT-only for owners. Writes go only through `paper_place_trade` (`SECURITY DEFINER`, not executable by anon or authenticated, `search_path` pinned).
- `posts` has no client INSERT or UPDATE. The server writes after the rules in `lib/community/rules.ts`.
- `profiles` is public-read with column-level UPDATE limited to username, display name, avatar and bio, so `role` and prediction stats can't be self-edited.
- All `SECURITY DEFINER` functions have EXECUTE revoked from client roles.

**Service-role usage.** The service role is used in one module (`lib/supabase/server.ts`, `getAdminClient`), only from route handlers, and never under a `NEXT_PUBLIC_` name. Routes that use it verify the bearer token first (`admin.auth.getUser(token)`) and take the user id from the token, never from the body. This was checked for paper orders, the AI route and moderation, and reflected in the code paths of posts and predictions.

**Server-side authorization.** AI: sign-in plus a Postgres slot limiter. Moderation: role checked server-side. Crons: Bearer `CRON_SECRET`, closed when it is unset (verified 401). Page gating (`AuthGuard`) is client-side only. That is acceptable because no private data is server-rendered: everything private comes through RLS or bearer APIs.

**Input validation (V5).** The agent uses zod (message ≤ 500 characters, history ≤ 20, workflow union). Symbols are validated (`lib/validation/symbol.ts`); `../../etc` → 400. Watchlist rows are capped. AI markdown links accept only `https?://`, and `safeLink` allows only known internal paths and official hosts. Community links are tokenised and rendered with `rel="nofollow ugc noopener"`. There is no `dangerouslySetInnerHTML` in the app.

**Rate limits.** The AI is limited per user in Postgres. Community and predictions have their own limits. Public market-data routes have **none** (P2-1).

**Error leakage (V7).** Routes return generic messages and log `error.message` only on the server. The agent returns curated `AgentError` messages. No secrets are logged (grep for token/key/secret in `console.*` came back empty). Security headers are set (nosniff, DENY framing, referrer policy, Permissions-Policy, HSTS). There is no CSP (P2-12).

**Secrets.** `.env*` is git-ignored and no env file is tracked. Only variable names were read for this audit.

**Financial data:**
- **Instrument identifiers.** Indian equities use Upstox `NSE_EQ|ISIN` or NSE symbols. MCX commodities use `MCX_FO|<token>` with explicit expiry. IPO communities key on ISIN and never on names. Search gives `RELIANCE` (NSE) priority over US `RS`. Note: `/stock/GOLD` is a US stock (Gold.com Inc), not the metal. Commodities now live under `/commodities/GOLD`, so search must keep these separate.
- **Currency and units.** Responses carry `currency` (INR/USD) and `unit`. Crypto is priced in INR by default (`vs=inr`). Commodities carry a quote unit (₹/bbl, ₹/10 g, ₹/kg …), and Upstox MCX volume is in lots, which the UI must say. Paper trading refuses non-INR/USD instruments.
- **Timestamps and labels.** Charts show "Source · as of <time>". Commodity data shows last-trade time out of hours. Paper trading stores `price_source` and `price_time`. Gap: no market-status badge in the stock header (P3). The `Yahoo (fallback, may be delayed)` label exists for the fallback path.
- **Percentages.** Movers breadth is computed from counts (14/51 = 27.45%). Index change matches price − previous close. The heatmap documents "1D = latest vs previous session close". The notes record that Yahoo's spark `chartPreviousClose` is *not* the previous session for ranges > 1d; keep that guarded.
- **Market cap.** Price × shares outstanding, labelled with the shares' as-of date (2026-03-31 for TCS: 7 months old, but disclosed). The AI has a market-cap unit guard (`09a4659`).
- **Fabricated fallbacks.** Providers omit unpriceable symbols rather than zero-filling them, and the F&O ban handler refuses to guess. The only fabricated numbers found are in **dead** components (P3). One display-level fabrication risk: Finnhub's `0` shown as "$0" (P2-7).

---

## 5. AI reliability findings

- **Architecture.** Provider chain: Groq default (`openai/gpt-oss-120b`, then `GROQ_FALLBACK_MODEL`), with Gemini optional (`gemini-3.5-flash-lite`) and bounded fallback. Requests that never reach a model: navigation ("open heatmap"), F&O ban, and concept answers from the glossary. Workflows: research, explain move, compare and portfolio. There is a 2-minute in-memory answer cache for standalone, non-portfolio questions only.
- **F&O ban misclassification.** Fixed on the branch:
  - `foBanIntent` routes concept questions to the glossary and list questions to NSE `fo_secban.csv`.
  - An abbreviation guard stops F/O being read as Ford or Occidental.
  - A stale-file warning appears when the file's trade date is before today (IST).
  - The unavailable path says "I won't guess at the list".
  - Covered by `lib/agent/__tests__/foBanIntent.test.ts` among 913 passing tests.
  - **Still failing in production** until deploy (P1-3), and the Vercel-IP fetch of NSE is unverified (P2-11).
- **Not exercised live in this pass.** No `/api/agent` calls were made, because they need a signed-in token and Groq quota. Before beta, run a 20-question golden set on the deployed build: F&O concept and list, "is X in ban", P/E concept, Reliance research, TCS vs Infosys, a US ticker, a commodity question, IPO status, an ambiguous ticker, a non-finance question and an injection attempt. Record answer, sources, links and tool calls.
- **Gaps:**
  - The AI has no commodity tool yet. `get_market_quotes` covers ETFs only, and gold questions answer via GOLDBEES. Once commodities are committed, add a `get_commodity_quote` tool with units.
  - Capacity is the shared-Groq problem in P2-2.
  - "Analyze my portfolio" reads `portfolio` (0 rows) and not paper holdings. Testers who only paper-trade will get an empty analysis. Decide which one it reflects.

---

## 6. Broken or incomplete user journeys

1. **New tester → prod URL → SSO wall** (P1-1). Journey ends.
2. **Sign in on prod → Google → localhost:3001** (P1-2). Journey ends, and no profile is created.
3. **Set a price alert → expect a timely notification.** Checked once a day; US alerts are judged before the US open; in-app only, with no email or push (P2-3).
4. **Open the heatmap for NIFTY** → "unavailable" (P1-4).
5. **Search "gold" → expect the metal** → top hit is the US stock GOLD, then ETFs. MCX gold is only reachable via `/commodities` once committed (P2-8).
6. **Ask the AI about my portfolio after paper trading** → it analyses the empty `portfolio` table (§5).
7. **Save a screen on desktop → open on phone** → it's gone, because it lives in localStorage.
8. **Browse community / leaderboard** → empty (0 posts, 0 predictions). For beta, seed it honestly with an empty state that invites the first post. Never use fake posts.

---

## 7. Recommended top three improvements

Ranked by how much they help the beta (retention and trust) against cost and the free-tier limits. Commodities is not ranked: it's already built and needs committing and verifying (Stage 2), not new work.

1. **Smart alerts.** This turns StockSphere from a place you visit into one that calls you back, and it reuses what exists: the `price_alerts` table, notifications, the quote services and the cron route. Scope:
   - %-move, 52-week high/low, "enters F&O ban", "IPO lists / allotment date" and "earnings tomorrow" conditions.
   - An intraday schedule via Supabase `pg_cron` or an external trigger (Vercel Hobby is daily only).
   - Firing with the price and its source and timestamp.
   - Email as a second channel, opt-in.
2. **Portfolio intelligence.** One honest view of holdings, real (`portfolio`) and paper (`paper_trades`): P&L in native currency plus an INR total at a labelled FX rate, allocation by sector and asset type, concentration warnings, and day change. The AI "analyze my portfolio" should read the same numbers. This is the core reason to return daily, and the plumbing (paper ledger, AI workflow) already exists.
3. **Daily brief, extended with Indian corporate events.** `briefing.ts` exists. Make it personal (watchlist plus holdings moves, alerts fired, ban-list entries, IPO dates, results and dividend dates for held stocks from Upstox or NSE). Show it on the dashboard and optionally email it. This also closes the events gap (Finnhub is US-only).

Ranked lower: AI research (already strong; capacity-bound), screener saved filters (small, so fold DB-backed saved screens into Stage 3 as a quick win), community (needs users before features), and a separate corporate-events page (covered by #3).

---

## 8. Staged plan with acceptance criteria

**Stage 0: Unblock beta (config and release; every step needs approval)**
- [ ] Vercel: production reachable without a Vercel login. *AC:* `curl -sI <prod>/login` → 200 from a signed-out machine.
- [ ] Supabase Auth URL config: Site URL = prod origin; Redirect URLs include the prod origin (+ `/**`) and `http://localhost:3001`. Vercel `NEXT_PUBLIC_SITE_URL` is unset or set to prod. *AC:* a fresh Google account signs in on prod, lands on the prod origin, completes onboarding, and a `profiles` row exists. Local sign-in still works.
- [ ] Vercel Production env holds every "required" name in §9. *AC:* crons return 200 in Vercel logs; the AI answers; Indian quotes are priced.
- [ ] Push `80aec47`, let the commodities session finish and commit, `next build` in a clean worktree, merge PR #2 and deploy. *AC:* the deployed SHA equals the merge commit (Vercel dashboard), and these smoke checks pass on prod: home, `/stock/TCS`, `/commodities`, `/ipo`, paper BTC buy then sell, AI "what is F&O ban" (glossary, no Ford) and "which stocks are in F&O ban today" (NSE list with trade date).

**Stage 1: Data correctness and hardening (code; no approval beyond the plan)**
- P1-4: heatmap constituent snapshot with an as-of label. *AC:* niftyindices returning a redirect still gives a labelled heatmap; unit test.
- P1-6: Upstox token health check. *AC:* when Upstox returns 401, India surfaces show "unavailable" and nothing silently stale; test.
- P2-1: rate limit and cache on `/api/market`. *AC:* 20 rapid requests for new US symbols from one IP spend ≤ 8 Twelve Data calls/min; test with fakes.
- P2-2: beta AI cap and capacity message. *AC:* the 16th question in a day returns a clear capacity error; test.
- P2-4 (with the crypto session): per-asset freshness and price rounding. *AC:* crypto fill rejected when the quote is > 15 s old; stored price has ≤ 2 dp (INR); tests.
- P2-5 PKCE; P2-7 earnings zero; P2-9 `.env.example`; P3 dead-code removal. *AC:* tests pass, no import of removed files, prod sign-in re-verified.
- P2-6: reconcile migration history (**approval needed**). *AC:* `list_migrations` matches the 13 files in `supabase/migrations`.
- Run `supabase/tests/*.test.sql` against a Supabase branch. *AC:* all RLS tests pass.

**Stage 2: Ship commodities and verify the AI**
- Commit the commodities work (owned by the commodities session), redirect `/asset/commodity/*`, add an AI `get_commodity_quote` tool with units. *AC:* "price of gold on MCX" answers with contract, expiry, ₹/10 g, last-trade time and source.
- Run the 20-question golden set on prod. *AC:* 0 fabricated numbers, every number has a source, F&O questions are 100% correct, injection attempt refused.

**Stage 3: Top three features** (each a separate approved plan)
1. Smart alerts. *AC:* a %-move alert fires within one schedule interval during market hours, with price, source and timestamp; user isolation tested by RLS test; intraday schedule documented.
2. Portfolio intelligence. *AC:* P&L matches a hand calculation on a fixture portfolio (INR and USD, labelled FX); the AI portfolio answer uses the same numbers.
3. Personal daily brief plus Indian events. *AC:* the brief lists only real events with dates and sources; with an empty watchlist it shows a sensible empty state; DB-backed saved screens sync across devices.

---

## 9. Files, systems and environment

### Beta GO/NO-GO

| Gate | Status |
|---|---|
| Prod reachable by testers | **NO** (SSO wall) |
| Prod sign-in works | **NO** (redirects to localhost) |
| Prod runs current code | **NO** (PR #2 unmerged; SHA unverifiable) |
| Data isolation (RLS) | GO (verified on the live DB) |
| Tests, types, lint | GO (913/913; tsc 0; eslint 0); build NOT VERIFIED |
| Market data | PARTIAL (India heatmap down; Upstox token lifetime unverified) |
| AI | NO until deployed; capacity risk |
| **Overall** | **NO-GO**. Stage 0 alone could flip it to a limited GO for a small (≤ 10) tester group. |

**Actual deployed commit:** BLOCKED. The Vercel connector returns 403 for team `ayushpatel-13s-projects`, and the site is behind SSO, so its bundle couldn't be inspected. Last known: `main` = `19c46d1` (2026-10-20 22:19 IST), as reported by another session and not re-verified.

### Environment variables (names only)

| Name | Used for | Local (`.env.local`) | Preview | Production |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client | present | required | required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client | present | required | required |
| `SUPABASE_SERVICE_ROLE_KEY` | server writes: posts, paper, alerts, predictions, AI limiter, communities | present | required | required (server only, never `NEXT_PUBLIC_`) |
| `UPSTOX_ACCESS_TOKEN` | Indian quotes, history, IPOs, movers, commodities | present | required | required (check lifetime, P1-6) |
| `GROQ_API_KEY` | AI default | present | required for AI | required for AI |
| `GEMINI_API_KEY` | AI fallback | present | recommended | recommended |
| `CRON_SECRET` | 3 cron routes | **absent** | optional | **required** |
| `NEXT_PUBLIC_SITE_URL` | OAuth return origin | absent (falls back to origin, OK) | leave unset | unset or exact prod origin, **never localhost** |
| `TWELVE_DATA_API_KEY` | US quotes | present | required | required |
| `ALPHA_VANTAGE_API_KEY` | US fallback | present | optional | optional |
| `FINNHUB_API_KEY` | earnings, US news, US industries | present | required | required |
| `GROQ_MODEL`, `GROQ_FALLBACK_MODEL`, `GEMINI_MODEL`, `LLM_PROVIDERS` | model overrides | absent | optional | optional |
| `FMP_API_KEY` | **unused by code** | present | — | remove |

Vercel-side values: BLOCKED (connector 403).

### Systems needing attention
- **Vercel** project `stocksphere`: Deployment Protection, env vars, deployed SHA, cron logs.
- **Supabase** `yapaaszcgxfuadylllvn`: Auth Site URL and Redirect URLs, migration history, optional leaked-password setting.
- **GitHub**: push `80aec47`; PR #2 (https://github.com/AyushPatel-13/stocksphere-app/pull/2).
- **Upstox**: token type and renewal.

### Files
- Auth: `lib/supabase.ts`, `app/login/page.tsx`, `components/ProfileGate.tsx`, `app/onboarding/page.tsx`
- Market data: `app/api/market/route.ts`, `lib/providers/market.provider.ts`, `lib/apis/niftyIndices.ts`, `lib/services/heatmap.ts`, `lib/apis/upstox*.ts`, `app/events/page.tsx`
- Paper (coordinate with the crypto session): `lib/paper/ticket.ts`, `lib/paper/service.ts`
- AI: `lib/agent/access.ts`, `lib/agent/tools/marketQuotesTool.ts`, `lib/agent/workflows/index.ts` (portfolio source), `lib/apis/nseFoBan.ts`
- Alerts: `vercel.json`, `lib/alerts/service.ts`, `app/api/alerts/check/route.ts`
- Commodities (owned by the commodities session, uncommitted): `app/commodities/**`, `app/api/commodities/route.ts`, `lib/*/commodities.ts`, `lib/apis/upstoxCommodities.ts`, `app/asset/[type]/[symbol]/page.tsx`
- Cleanup: `components/Dashboard/{MarketOverview,StatsGrid,TrendingStocks,RecentActivity,WelcomeCard,QuickActions}.tsx`, `app/{BullBearVote,StockDiscussion,Navbar,page-backup}.tsx`
- Config: `.env.example`, `next.config.ts` (CSP later)

### Not covered in this pass (honest gaps)
- Signed-in journeys end to end: no test account was created and no credentials were entered.
- Live AI calls (quota), and US quote paths (Twelve Data and AV credits).
- `next build`, `supabase/tests/*.sql` execution, and mobile and accessibility checks beyond what other sessions reported.
