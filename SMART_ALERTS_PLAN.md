# Smart alerts — plan (25 Oct 2026)

> **Status (25 Oct, uncommitted):**
> - **Stage A built.** Files: `lib/alerts/quotes.ts` (new), `lib/alerts/service.ts`, `app/api/alerts/check/route.ts`, `vercel.json` (daily run moved to 22:15 UTC), plus tests.
> - A live dry run with real Upstox/Yahoo prices and a fake store priced 6/6 instruments: TCS, RELIANCE, NIFTY, GOLDBEES, AAPL and BTC in INR.
> - Two data gaps found and fixed:
>   - Upstox index quotes have no `prev_close_price`.
>   - Yahoo's weekend USD/INR time lags the coin's.
> - **Stage B migration applied 25 Oct 2026 04:47 UTC, with the owner's approval** (`supabase/migrations/20261025000100_smart_alerts.sql`; listed in Supabase migration history).
>   - `supabase/tests/smart_alerts_rls.test.sql` passed. The original `alerts_rls.test.sql` also still passes. Both ran in a transaction that was rolled back, and no test rows remain.
>   - No new security advisor findings.
> - **Stage B code built (25 Oct):** `lib/alerts/rules.ts`, `service.ts`, `client.ts` and `app/alerts/page.tsx`.
>   - New conditions: move %, 52-week high/low, F&O ban, IPO open/listed. Repeat every session (at most once per trading day). Every firing is recorded in `alert_events`.
>   - Works before the migration: the checker and page detect the missing columns, behave exactly as before, and offer only the original four conditions.
>   - A live dry run on real data (fake store) fired move %, day-move, F&O ban and IPO-open correctly. The 52-week rule evaluated TCS and correctly didn't fire.
>   - The alerts page hasn't been checked in a browser: the dev server was down.
> - **Stage C scheduler written, not applied:** `supabase/manual/alert_schedule.sql`.

## What exists today
- `price_alerts` table with four conditions: `above`, `below`, `day_up` and `day_down` (percent). Each alert fires once, then stays `triggered`. Members can have at most 25 active alerts.
- A "triggered" alert writes a row to `notifications`, which the navbar bell shows. It respects `user_preferences.alert_notifications`.
- `/api/alerts/check` is called by Vercel Cron once a day at 10:00 UTC (15:30 IST, before the US open). It prices each symbol one at a time from 1-day history candles (mostly Yahoo).
- The notification says "Prices may be delayed" and gives no source or time.
- `lib/markets/session.ts` already knows India and US trading hours (not holidays).

**Hard constraint (Vercel docs, verified):** the Hobby plan allows crons **once per day** only, with ±59 minutes of timing precision. A more frequent expression in `vercel.json` makes the deployment fail. So "checks during market hours" needs Vercel Pro or a scheduler outside Vercel.

## Stage A — better checks (code only, no approval)
1. **Market-aware runs.** Each run checks only alerts whose market is in session: India 09:15–15:30 IST, US 09:30–16:00 ET, crypto always. One closing pass per market evaluates the closing price. A symbol whose newest quote is more than 15 minutes old during session hours (holiday or stalled feed) is skipped and counted. It never fires on stale data.
2. **Batched, quota-free quotes.** Indian symbols use one Upstox market-quote call per run (up to 500 keys). US symbols use Yahoo spark in batches of 20. Crypto uses the existing crypto quotes. Twelve Data and Alpha Vantage are never used.
3. **Honest notifications.** Each one carries the price, currency, source and exchange time, e.g. "TCS ₹2,612.40 at 14:05 IST (Upstox) — crossed above ₹2,600".
4. **Fix the 10:00 UTC daily run.** The current single daily run lands before the US open, so US alerts get checked on the previous day's close. The one daily run (on Hobby) moves to after the US close.

## Stage B — new conditions (needs one migration)
| Condition | Data source | Notes |
|---|---|---|
| Crosses above / below a price (existing, kept) | as above | The form already refuses levels that are already true |
| Day move ≥ X% up / down (existing, kept) | previous session close | |
| **Moves X% from the price when set** | reference price stored at creation | Captures "tell me if it moves 5% either way" |
| **New 52-week high / low** | 1-year daily history (Yahoo/Upstox) | Checked once per run per symbol, cached for the day |
| **Enters the F&O ban list** | NSE `fo_secban.csv` (one fetch per run) | Indian F&O stocks only |
| **IPO opens / lists** | Upstox IPO API | For the IPO board and IPO communities |
| **Repeat mode** | — | "Once" (today's behaviour) or "every session", with at most one notification per alert per session |

Migration `2026102500xx_smart_alerts.sql`:
- Widens the `condition` check.
- Adds `reference_price`, `repeat`, `last_fired_at`, `fired_source` and `fired_quote_time`.
- Adds an `alert_events` table (one row per firing, owner-read only, service-role write) so history and de-duplication don't rely on one status column.
- Keeps the existing RLS pattern and column grants.

There will be SQL tests in `supabase/tests/alerts_rls.test.sql`.

## Stage C — scheduler (production change, needs approval)
| Option | Cost | Frequency | What you'd approve |
|---|---|---|---|
| **1. Supabase pg_cron + pg_net (recommended)** | free | every 5 min, market hours only | Enable the `pg_cron` and `pg_net` extensions. You add `CRON_SECRET` to Supabase Vault yourself; I never see it. Schedule one job that POSTs to the production `/api/alerts/check`. If Vercel Deployment Protection stays on, you also create a "Protection Bypass for Automation" secret in Vercel. |
| 2. Vercel Pro | $20/month | every 5 min | Upgrade the plan; I then change `vercel.json` |
| 3. GitHub Actions schedule | free | ≥5 min, often delayed 10–30 min | Add a workflow and a repo secret |

Whichever you pick, the daily Vercel cron stays as a safety net.

## Stage D — later, separate approval
Email delivery, which needs an email provider account and key. Browser push.

## Acceptance criteria
- A "crosses above" alert on an Indian stock fires within one interval (≤ 5 minutes with option 1) during NSE hours, and the notification shows price, ₹, source and IST time.
- No alert fires on a quote older than 15 minutes during session, or from a closed market's stale price. Covered by tests with fixed clocks: weekend, holiday-quiet feed, pre-open and close.
- A run with 500 active alerts makes ≤ 1 Upstox quote call, ≤ 25 Yahoo spark calls and 0 Twelve Data or Alpha Vantage calls (counted with fakes).
- A repeat-mode alert notifies at most once per session. A "once" alert never fires twice, even with overlapping runs (atomic status update).
- RLS tests: a member can't read another member's alerts or `alert_events`, and can't set `status`, `last_fired_at` or `fired_*` themselves.
- The F&O ban condition fires only when a symbol is newly on the list, and the notification states the list's trade date.
