# StockSphere — Phase Two audit and staged plan

Date: 28 Oct 2026, a weekday, so NSE and US markets were open during the checks. Local code is the branch `stocksphere-community-markets` at `692d64b`, which is the same tree as `main` = `c6d4c24`. Production is `https://stocksphere-theta.vercel.app`. During this audit Vercel was still building `c6d4c24`, so production was serving the previous release: `/community/saved` returned 404 there and 200 locally.

This document follows on from `BETA_AUDIT_PHASE1.md` (24–25 Oct) and `AUTH_AUDIT.md` (26 Oct). It was a read-only audit: no code was changed, nothing was committed, and no database or production setting was touched.

**Evidence labels**

| Label | Meaning |
|---|---|
| **[api]** | Live request to the dev server on localhost:3001 |
| **[prod]** | Unauthenticated request to production |
| **[db]** | Read-only SQL or Supabase advisors |
| **[logs]** | Supabase edge, auth or postgres logs |
| **[code]** | Reading the source |
| **[run]** | Ran a module directly with `tsx` |
| **[auto]** | Test suite |
| **NOT TESTED** | Not exercised; the reason is given |

No signed-in flow was driven by me: neither the browser pane nor I can complete Google sign-in. The **[db]** row counts show which signed-in features real people have used.

**Status words**

| Word | Meaning |
|---|---|
| **Implemented** | Works, with evidence |
| **Partial** | Works with a verified gap |
| **Missing** | Not in the code |
| **Broken** | Verified wrong output |
| **Unproven** | Code and tests exist, but no human has used it (0 rows) |

## Verdict

**Not ready to invite beta users yet.** Most of what blocks it is short fixes, not new features.

1. **Two index endpoints disagree on today's move, and one is wrong.** BANKNIFTY showed **+292.5** on `/api/indices` and **−99.3** on `/api/indices/overview`. Yahoo's daily closes confirm +292.5 [api] [run].
2. **Scheduled jobs aren't running in production.** There was no database activity at the alerts-check (22:15 UTC) or listing (05:00 UTC) cron times [logs]. That fits `CRON_SECRET` being unset in Vercel. Also, the photo-cleanup job is not in `vercel.json` at all [code].
3. **Most of Community 2.0 has never been used by a person.** Votes, reposts, bookmarks, follows, photo uploads and price alerts all have 0 rows [db]. The code and SQL tests are thorough, but none of it has been used for real.

Good news since Phase 1, with evidence:
- **Sign-up now works in production.** Three people who joined on 26 Oct each created a profile within 15 seconds of their first sign-in [db].
- **Tests:** 1,116/1,116 pass, `tsc` is clean, and eslint reports 0 errors and 18 warnings [auto].
- **Database:** all 24 migrations are applied [db].

## 1. Feature status

### 1a. Core reliability, auth, authorization, RLS, data accuracy

| Area | Status | Evidence |
|---|---|---|
| Google sign-in (PKCE, return to the starting origin, error messages, `?next=` return) | **Implemented** | [db]: 3 new users on 26 Oct, each with a profile within 15 s. [code]: `AuthReturn.tsx`, `lib/auth/*`. |
| Accounts without a profile | **Partial** | [db]: 4 of 9 users (20, 20, 24 and 26 Oct) have no profile. They are routed to onboarding on their next sign-in; nothing to fix in data. |
| Server-side authorization on private APIs | **Implemented** | [code]: paper, community, moderation, predictions and agent routes verify the bearer token with `auth.getUser(token)`. |
| RLS on all public tables | **Implemented** | [db]: RLS is on for all 24 tables. Private tables (portfolio, watchlist(s), paper_*, price_alerts, alert_events, notifications, bookmarks, user_preferences, activity, ai_usage, community_uploads) can't be read by `anon`. Writes use column-level grants plus own-row `with check`. |
| Vote privacy | **Partial** (design gap) | [db]: `post_votes` (who voted up or down on what), `follows`, `reposts` and `post_likes` are readable by `anon` with `qual = true`. Anyone with the public anon key can list every member's down-votes. Reddit and X don't expose this. |
| Photo uploads: server-only writes, type/size checks, abuse limit, cleanup | **Partial** | [db]: bucket is public-read, 4 MB, jpeg/png/webp, no storage write policies (service role only). Metadata is stripped **only in the browser** (canvas re-encode in `imageClient.ts`), so a direct API upload keeps EXIF/GPS [code]. The cleanup cron is **not scheduled** (`vercel.json` has 3 crons, none of them cleanup) [code]. |
| Crons (alerts check, predictions resolve, community listing, image cleanup) | **Broken in production** | [logs]: no REST traffic at 22:15 or 05:00 UTC. [db]: 0 `prediction_resolutions`, 0 `community_listing_checks`. All four endpoints return 401 [prod], so the code is closed; the secret is most likely missing in Vercel (I can't read Vercel settings). The 5-minute pg_cron schedule isn't set up: neither `pg_cron` nor `pg_net` is installed [db]. |
| Stock page header price | **Broken (US stocks)** | [run]: the header uses `lib/providers/price.ts` `fetchPrice`, so MSFT shows **528.22 from Twelve Data**, while `/api/market` and the chart show **528.14 from Yahoo**. This is the known header-vs-chart mismatch. Each US stock page view also spends Twelve Data's 8/min quota. Indian stocks agree (RELIANCE 1158 everywhere) [api]. |
| Index day change | **Broken** | [api] [run]: `/api/indices/overview` (`lib/services/indexOverview.ts` → `getHistory("1d").previousClose`) uses Yahoo's intraday `previousClose`, which for `^NSEBANK` was the **26 Oct** close (54,366.7). Yahoo's daily series and Upstox both give 27 Oct = 53,974.9. Effect on NIFTY: −54.35 instead of −50.9. Effect on BANKNIFTY: **−99.3 instead of +292.5, the wrong direction**. Used by `components/Markets/IndexDetails.tsx`. |
| Number formatting in APIs | **Partial** | [api]: `change: -38.200000000000045` and `-1.7200000000000273`. The UI rounds; the AI and any API consumer see the raw floats. |
| Search | **Partial** | [api]: "Ford" → F (US), Infosys → INFY, Tata Motors → TATAMOTORS. **"Zomato" → nothing** (it was renamed Eternal; the AI handles the rename and search doesn't). Upstox 429 cooldown making results partial: known, not reproduced today. |
| Upstox 429 → Yahoo fallback | **Implemented** | Phase 1, `02d3d66`; [auto] tests. |
| CSP | **Partial** | Report-only (Phase 1). Not enforced yet. |
| CI | **Missing** | No `.github/workflows`. Tests, typecheck and the SQL RLS tests only run when someone runs them. |
| End-to-end tests for signed-in flows | **Missing** | No Playwright or Cypress. |

### 1b. Social posts

| Feature | Status | Evidence |
|---|---|---|
| Posts: create, edit, delete; titles and kinds; mentions of stocks, IPOs and bonds | **Implemented** | [db]: 4 posts. [auto]: `service`, `composer`, `mentions` and `bonds` tests. |
| Threaded replies (any depth) | **Implemented** | [db]: 3 replies. [auto]: `threads.test.ts`. |
| Likes and up/down votes | **Unproven** | [db]: `post_votes` = 0. Grants and policies are correct (column insert on `user_id, post_id, value`). |
| Reposts and quote posts | **Unproven** | [db]: `reposts` = 0. |
| Bookmarks and `/community/saved` | **Unproven** | [db]: 0. The page returns 200 locally and 404 on production until the deploy lands. |
| Follows; Following and Trending feeds | **Unproven** | [db]: `follows` = 0. **The Trending feed is empty** [api] (`/api/community/posts?feed=trending` and `/api/community/trending` return `[]`), so a beta tester's first look at the Trending tab is a blank list. |
| Profiles: redesign, edit dialog, follower lists | **Implemented in code, Unproven by use** | [code]: `components/Profile/*`. |
| Photo uploads | **Unproven** | [db]: `community_uploads` = 0. Replies take no photos [code: no image handling in `Thread.tsx`]; that may be deliberate. |
| Notifications (follow and repost) | **Partial** | [db]: 0 rows. The bell links to `/alerts#notifications`, so social notifications sit under the alerts page; there's no notifications page of their own. |
| Rate limits on social writes | **Partial** | Posts and uploads have limits [code]. Votes, reposts, bookmarks and follows are direct client inserts limited only by RLS, so a script could spam follows. Low risk at beta size. |
| Direct messages | **Missing** | Not in the code. Not requested. |

### 1c. StockSphere AI

| Feature | Status | Evidence |
|---|---|---|
| Tool-based answers (quotes, history, financials, company, news, earnings, IPO, F&O ban, movers, screener, calculator, glossary, app guide) | **Implemented** | [code]: 16 tools in `lib/agent/tools`. [auto]: orchestrator, guards and answer-coverage tests. |
| Source links in answers | **Implemented** | [code]: `AgentLinks.tsx`, with sources in each tool result. |
| Financial calculations | **Implemented** | `calculatorTool.ts`, `performanceTool.ts`. |
| Symbol resolution | **Broken for US names outside a small list** | [run]: `resolve_symbol("Ford")` returns FORTIS.NS, FORCEMOT.NS and others, with no F (`symbolResolverTool.ts` uses Upstox NSE search plus a small local US list). Site search finds F. "Tata Motors": the AI picks TMCV.NS and search picks TATAMOTORS; one rule should decide. |
| Grounding check / regression benchmark | **Partial** | `lib/agent/benchmark/score.ts` checks that every figure in an answer appears in the tool data, but it runs from `scripts/ai-benchmark.ts` by hand, not in `npm test`. No fixed set of recorded questions and answers runs in CI. |
| Provider limits (Groq 8k TPM / 200k TPD) | **Partial** | Known. Gemini and Anthropic exist as fallbacks [code]. Not measured today. |

### 1d. Watchtower (dashboard)

| Source | Status | Evidence |
|---|---|---|
| Triggered alerts, price moves since last visit, earnings, IPO dates, tagged news, F&O ban | **Implemented** | [code]: `lib/dashboard/watchtower.ts`. [auto]: tests. |
| Community discussion about your stocks | **Missing** | `watchtower.ts` has no posts input. `/api/community/sentiment` exists and could feed it. |
| Indian corporate actions (dividends, splits, results, AGMs) | **Missing** | `/events` covers only US earnings from Finnhub. Reminders live in this browser's localStorage. `lib/services/events.ts` `getEvents()` is a stub returning `[]` and is used nowhere. |
| Alerts as a feed source | **Unproven** | [db]: `price_alerts` = 0 ever, and the checker isn't running in production (see crons). |

### 1e. Private-beta readiness

| Item | Status |
|---|---|
| Public domain, sign-in, onboarding | **Implemented** [db] |
| Beta notice, risk disclosure and privacy page (`/beta`) | **Implemented** [api] |
| All 31 page paths swept return 200 locally and on production, apart from `/community/saved` pending the deploy | [api] [prod]. This is status codes only; it doesn't show the pages render correctly. |
| A human pass over signed-in flows | **NOT TESTED**. This is the biggest gap. |
| Monitoring or error reporting | **Missing**. There is `/api/health` (Upstox token) only, no Sentry-style error capture. |
| Mobile layout | **NOT TESTED** in this pass. |

## 2. Issues by priority

**P0:** none found. No data leak, no auth bypass, no RLS hole.

**P1: fix before inviting testers**

| ID | Issue | Where | Fix |
|---|---|---|---|
| P1-A | Index day change uses Yahoo's stale intraday previous close, so BANKNIFTY showed the wrong direction | `lib/services/indexOverview.ts`, `lib/services/history.ts` | Take the previous close from Upstox, falling back to Yahoo's daily series; never Yahoo's intraday `meta.previousClose` for indices. Add a test with today's numbers. |
| P1-B | Stock header prices US stocks from a different source than the chart (and burns Twelve Data quota) | `app/stock/[symbol]/page.tsx` → `lib/providers/price.ts` | Price the header with `getMarketQuote()`, the same chain `/api/market` uses. |
| P1-C | Crons don't run in production | Vercel env vars; `vercel.json` | **You:** set `CRON_SECRET` in Vercel. **Code:** add the image-cleanup cron (Hobby plans allow one run a day). |
| P1-D | No one has exercised Community 2.0 or alerts | n/a | Have a human run the checklist in Stage 4 below, on production after the deploy. |

**P2: fix during beta**

| ID | Issue | Fix |
|---|---|---|
| P2-A | Anyone can list who voted what (`post_votes`, `post_likes`, `reposts`, `follows` are anon-readable) | Make `post_votes` own-row read only (counts already live on `posts`). Keep reposts and follows public, since they're public actions on X too, but decide that explicitly. **Migration: needs your approval.** |
| P2-B | Photo metadata is stripped only in the browser | Strip or re-encode on the server, or reject files that still carry EXIF. |
| P2-C | AI `resolve_symbol` and site search use different universes ("Ford") | Make `resolve_symbol` use the site's search index, keeping the rename map. |
| P2-D | Search misses renamed companies ("Zomato") | Add the rename map to search. |
| P2-E | The Trending tab is empty on a quiet site | Fall back to most-discussed or latest when the trending window is empty, with an honest label. |
| P2-F | Social notifications live under `/alerts` | A `/notifications` page or a tab of its own. |
| P2-G | No CI | A GitHub Action running `npm test`, `tsc` and `eslint` on every push, with the SQL RLS tests added later. |
| P2-H | Raw float noise in API responses | Round at the API boundary. |
| P2-I | The AI benchmark isn't part of the test run | Add recorded tool-result fixtures, so a test runs grounding checks offline in `npm test`. |
| P2-J | CSP is still report-only | Enforce it after a beta week with no violations. |

**P3: clean-up**

- Migration history names drift again: `threaded_comments`, `follows` and others are recorded without their file prefix. Some local file dates run ahead of the apply dates (20261029 … 20261102). Harmless now; repair before using the Supabase CLI.
- Two unindexed foreign keys (`bookmarks.post_id`, `community_uploads.post_id`) and 18 unused indexes [db]. Fine at this size.
- The `getEvents()` stub is unused.
- Leaked-password protection is off. It doesn't apply: sign-in is Google only.
- 18 eslint warnings.

## 3. Staged plan

Each stage is small, tested on its own, and stops for your review. Items marked **⚑** need your approval: a migration, a production setting or a deploy.

**Stage 0: settings only (you, about 10 min)**
1. ⚑ Vercel → Environment Variables: set `CRON_SECRET` for Production.
2. ⚑ Confirm the `c6d4c24` deploy finished (`/community/saved` returns 200 on production).
3. Optional, ⚑: Supabase → enable `pg_cron` and `pg_net`, then I apply `supabase/manual/alert_schedule.sql` for 5-minute alert checks.

**Stage 1: data accuracy (code only, about half a day)**
- P1-A: correct the index previous close. Tests use today's BANKNIFTY and NIFTY figures.
- P1-B: one quote source for the stock header.
- P2-H: round prices at the API boundary.
- P1-C (code part): schedule the image cleanup in `vercel.json`.
- *Done when:* the header, chart, `/api/market` and the index endpoints agree to the paisa or cent for 5 symbols and 3 indices during market hours, and the tests pass.

**Stage 2: AI and search consistency (about half a day)**
- P2-C and P2-D: one resolver behind both the AI and search, with the rename map.
- P2-I: offline grounding regression tests using recorded tool data.
- *Done when:* Ford, Apple, Infosys, Tata Motors, Zomato and Eternal resolve the same way in both, and the regression runs in `npm test`.

**Stage 3: social polish and privacy (about 1 day; one migration ⚑)**
- P2-A: votes private (migration plus an SQL test).
- P2-B: server-side metadata stripping.
- P2-E: a Trending fallback.
- P2-F: a notifications page.
- *Done when:* `anon` can't read `post_votes`, an uploaded JPEG with GPS comes back without it, and Trending is never blank when posts exist.

**Stage 4: human beta pass (you, or 2 testers, about 1 hour) — needed before inviting anyone**

The checklist, on production with two Google accounts A and B:
- **Community, with A:** post with a photo, reply 3 levels deep, upvote and downvote, repost and quote, bookmark (it appears in Saved), follow B (B gets a notification).
- **Isolation:** B can't see A's bookmarks, alerts, paper trades or watchlist.
- **Alerts:** create a "% move" alert and an F&O-ban alert; after the cron runs, a notification appears.
- **AI:** ask "price of Ford", "compare TCS and Infosys", "Reliance news"; each answer has sources.
- **Phone:** repeat the main flows on a phone.
- I record the results in the database and logs and fix what breaks.

**Stage 5: Watchtower 2 (about 1 day)**
- Add a "community is talking about your stocks" item (posts mentioning your watchlist or holdings in the last 24 h, with sentiment) from existing data.
- Add Indian results and corporate-action dates **only if** a reliable free source is confirmed (NSE corporate-actions archive); otherwise keep it marked missing.

**Stage 6: hardening for a wider beta**
- P2-G: CI.
- P2-J: enforce the CSP.
- Error reporting.
- Rate limits on follows and reposts.
- Playwright smoke tests for sign-in-free pages.

Not planned (no request, or would duplicate something existing): direct messages, a new search engine, rewriting Community. Every item above extends code that already exists.

## 4. Not covered in this pass

- Signed-in UI flows (no Google sign-in available to me).
- Production behaviour of `c6d4c24` (still deploying).
- Mobile layouts.
- Groq and Gemini quota behaviour under load.
- Vercel environment variables (my connector has no access to the team).
