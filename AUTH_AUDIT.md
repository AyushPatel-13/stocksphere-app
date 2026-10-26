# StockSphere authentication audit

Date: 26 Oct 2026. Branch `stocksphere-community-markets`; the changes described here are uncommitted.

**Evidence labels:**
- **[logs]**: Supabase auth or edge logs, read-only.
- **[db]**: read-only SQL.
- **[auto]**: automated tests.
- **[local]**: checked in a browser on localhost:3001 while signed out.
- **[prod-probe]**: unauthenticated `curl` against production.
- **[blocked]**: needs a dashboard change or a real user before it can be checked.

Nobody has completed a Google sign-in since these changes. That needs a real person.

## 1. Root cause of the current login problem

**Sign-ins from the public production site are sent back to the team-only Vercel address, which non-members can't open.** [logs]

There are two production addresses. **[prod-probe]**
- `https://stocksphere-theta.vercel.app` is the public production domain. It returns 200, has no Vercel wall, and runs `main` (`d2b1809`; it serves the new CSP header and `/api/fo-ban`).
- `https://stocksphere-ayushpatel-13s-projects.vercel.app` is the team alias. It redirects to `vercel.com/sso-api`, so only Vercel team members get past it.

Every sign-in from production asks Supabase to return to `https://stocksphere-theta.vercel.app`. That address is baked into the build from `NEXT_PUBLIC_SITE_URL`. It isn't in Supabase's Redirect URLs list, so Supabase falls back to the Site URL, which is the team alias. GoTrue records where it actually sent the user in the `referer` field:

| Time (UTC) | Who | `redirect_to` requested | Where Supabase sent them | What happened next |
|---|---|---|---|---|
| 20 Oct 16:08–16:27 | 3 testers, 3 different IPs | production | team alias | Google and Supabase succeeded (`user_signedup`/`login`). **None of their browsers ever made a single follow-up request**: the app never loaded, so no profile was created. |
| 24 Oct 08:00–08:06 | tester (Android) | `stocksphere-theta.vercel.app` | team alias | Same: 3 attempts, no app request afterwards. |
| 24 Oct 08:08 | owner | `http://localhost:3001` | team alias (localhost wasn't allowed yet) | The owner is a team member, so the alias loaded. |
| 26 Oct 05:43 | owner | `stocksphere-theta.vercel.app` | team alias | The page loaded, but the PKCE code was never exchanged: no `grant_type=pkce`, only a refresh of an older session. |
| 26 Oct 05:45 | owner | `http://localhost:3001` | `http://localhost:3001` | Correct, because localhost was added to the list on 25 Oct. |

This explains the four accounts without a profile **[db]**. All four are Google users with confirmed emails and 1–3 sessions each, and each signed in only once. Their accounts were created, but they never reached the app, so ProfileGate never sent them to onboarding. No profile is orphaned (0), and no account has more than one identity. The fix is configuration, not data: the next time one of them signs in successfully, ProfileGate sends them to `/onboarding`.

The code made it worse in one way. With PKCE (since `57d28b5`), the one-time verifier is stored on the origin where sign-in started. Preferring `NEXT_PUBLIC_SITE_URL` over that origin meant any mismatch made the code impossible to exchange, and the person was left on the home page signed out with no message. That is now fixed in code (section 4).

**Correction to `BETA_AUDIT_PHASE1.md`:**
- P1-1 said production sits behind Vercel's login wall. Only the team alias does; the public domain is open.
- P1-2's "returns to localhost" was the state before 25 Oct. Since then the real fallback is the team alias.

**Google consent screen** [logs, inferred]: three non-owner Google accounts got through Google to Supabase on 20 and 24 Oct. So Google isn't blocking other accounts, which means either the app is "In production" or those accounts are listed test users. I can't see which from here; check it (section 5).

## 2. Flow diagram (✗ = verified failure point, ⚠ = risk handled in this change)

```
 Browser on ORIGIN (localhost:3001 | stocksphere-theta | team alias | preview)
   │
   │  /login → "Continue with Google"
   │    rememberReturn(next) → sessionStorage           (new)
   │    signInWithOAuth({ redirectTo: ORIGIN })         (was NEXT_PUBLIC_SITE_URL || ORIGIN)
   │    PKCE verifier saved in ORIGIN's localStorage
   ▼
 Supabase /auth/v1/authorize?redirect_to=ORIGIN&code_challenge=…
   │
   ▼
 Google consent  (redirect_uri = https://yapaaszcgxfuadylllvn.supabase.co/auth/v1/callback)
   │   ⚠ cancel → back with ?error=access_denied
   ▼
 Supabase /auth/v1/callback
   │   Is ORIGIN in the Redirect URLs list?
   │     yes → 302 to ORIGIN?code=…
   │     no  → 302 to Site URL?code=…        ✗ today: Site URL = team alias
   ▼
 Landing page
   │   ✗ team alias + not a team member → Vercel login wall, app never loads (testers)
   │   ✗ different origin from the start → no verifier, code ignored, signed out with no message
   │   supabase-js (detectSessionInUrl) exchanges the code → session in localStorage
   ▼
 <AuthReturn/> (new, root layout)
   │   error/code still in the URL → /login?auth_error=cancelled|failed (fixed wording)
   │   session + remembered path   → router.replace(next)
   ▼
 <ProfileGate/> → no profile → /onboarding?next=… → profile insert (RLS: id = auth.uid())
   ▼
 Private pages: <AuthGuard/> (client), private APIs verify the bearer token server-side
```

## 3. Configuration per environment

| | Local | Vercel preview | Production (public) | Production team alias |
|---|---|---|---|---|
| Origin | `http://localhost:3001` | `stocksphere-<hash>-ayushpatel-13s-projects.vercel.app` | `https://stocksphere-theta.vercel.app` | `https://stocksphere-ayushpatel-13s-projects.vercel.app` |
| Vercel protection | n/a | team-only (keep) | public, verified [prod-probe] | team-only (keep) |
| In Supabase Redirect URLs? | yes, verified [logs] | no (keep it that way, see below) | **no**: the cause | unknown; it's the Site URL |
| Supabase Site URL | | | **should be this** | **currently this** [logs] |
| `NEXT_PUBLIC_SITE_URL` | unset | set to theta? (baked into whatever was built) | `https://stocksphere-theta.vercel.app` [logs] | same build |
| Code matches local? | yes | n/a | `main` = `d2b1809`. The branch is ahead, and these auth fixes aren't deployed. | same deployment |
| Google sign-in today | works [logs] | fails, falling back to the Site URL | **fails for non-team users** [logs] | works for team members only |

**Previews:** keep them team-only and leave them out of the Redirect URLs list. A glob such as `https://stocksphere-*-ayushpatel-13s-projects.vercel.app/**` would also match a hostname someone else could register as their own project's production domain. That site could then use this Supabase project to sign people in and receive their sessions. If one preview genuinely needs sign-in, add only its exact branch alias (`https://stocksphere-git-<branch>-ayushpatel-13s-projects.vercel.app`) while it's in use. Without that, a sign-in started on a preview returns to the Site URL and now shows the "didn't complete" message instead of failing silently.

**Which domain should be public:** `stocksphere-theta.vercel.app` already is, and it's the one to give testers. The team alias staying behind Vercel's wall is correct. I'm withdrawing the earlier proposal to turn protection off; it isn't needed for sign-in. Making any other address public, such as a custom domain, is a separate product decision.

## 4. Code changes (uncommitted)

| File | Change |
|---|---|
| `app/login/page.tsx` | `redirectTo` is always `window.location.origin`, so PKCE can finish where it started; the allow list still gates it. Shows a fixed message for `?auth_error=cancelled\|failed` or when sign-in can't start. Remembers `?next=` before leaving for Google. Someone already signed in is sent on. |
| `components/AuthReturn.tsx` (new, root layout) | After the Supabase client has handled the URL: an error or a leftover `?code=` goes to `/login?auth_error=…`; a successful return goes to the remembered page. |
| `lib/auth/redirects.ts` (new) | `safeReturnPath` (only same-site paths; refuses `//x`, `/\x`, control characters, and `/login` and `/onboarding` as targets), `loginHref`, `classifyAuthReturn`, fixed failure messages. |
| `lib/auth/session.ts` (new) | `rememberReturn` / `consumeReturn` (sessionStorage, used once), and `signOutAndLeave`. If the server sign-out fails, it removes the local session anyway, then does a full page load to /login. |
| `components/AuthGuard.tsx` | Sends you to `/login?next=<this page>` instead of bare `/login`. A network error while confirming the session no longer signs you out; a refused session clears the local copy first. |
| `app/onboarding/page.tsx` | `?next=` goes through `safeReturnPath`. **Open-redirect fix:** the old check accepted `/\evil.com`, which browsers resolve to `https://evil.com` (test in place). |
| `components/Navbar.tsx`, `app/profile/page.tsx` | Sign-out uses `signOutAndLeave`. |
| `scripts/run-agent-tests.mjs` | Adds `lib/auth` to the test roots. |
| `.env.example` | `NEXT_PUBLIC_SITE_URL` is documented as unused. |

No migration is needed. The profile flow (`profiles.id = auth.uid()`, insert-only-own under RLS, a unique username) already handles OAuth users without a profile. It never overwrites data at sign-in and never merges accounts.

## 5. Dashboard changes you need to make

**Supabase → Authentication → URL Configuration**
1. **Site URL:** `https://stocksphere-theta.vercel.app`
2. **Redirect URLs** (exact entries, no wildcards):
   - `https://stocksphere-theta.vercel.app`
   - `http://localhost:3001` (already there)
   - `http://localhost:3000` only if you also run on 3000
   - `https://stocksphere-ayushpatel-13s-projects.vercel.app` only if team members sign in on the alias
3. Remove any entry you don't recognise or that ends in a wildcard.

**Vercel → Project stocksphere → Settings**
1. **Environment Variables:** delete `NEXT_PUBLIC_SITE_URL` from Production and Preview. With this change the code no longer reads it, so this is cleanup.
2. **Deployment Protection:** leave it as it is. The public domain is already open, and the alias and previews stay team-only.
3. After merging these changes, redeploy production, then share only `https://stocksphere-theta.vercel.app` with testers.

**Google Cloud Console → APIs & Services**
1. **Credentials → the OAuth client used by Supabase:**
   - **Authorized redirect URIs** must contain exactly `https://yapaaszcgxfuadylllvn.supabase.co/auth/v1/callback`. That is the `redirect_uri` the live request sent [local].
   - No app domains are needed there, because Google only ever returns to Supabase.
   - **Authorized JavaScript origins** aren't used by this redirect flow; leave whatever is there.
2. **OAuth consent screen → Publishing status:**
   - *In production*: any Google account can sign in. The scopes are only `email`, `profile` and `openid`, which are non-sensitive, so Google's verification review isn't required.
   - *Testing*: only accounts listed under Test users (up to 100) can sign in, and everyone else gets "Access blocked". Adding testers there is a closed beta, not a public launch.

**Supabase advisors** [db]: leaked-password protection is off. It only matters if email/password sign-in is ever turned on. Today sign-in is Google-only; there is no password, sign-up form or reset flow in the code, so none was added.

## 6. Security review of the change

- **Redirects:** every `next` and return target goes through `safeReturnPath`, both when it's stored and when it's used. The value sent to Supabase is the page's own origin, and Supabase's allow list still applies. No arbitrary destination is accepted anywhere.
- **No reflected content:** `auth_error` can only select one of two fixed messages. The `error_description` text from the URL is never shown.
- **Unchanged:**
  - RLS is on for all 19 public tables [db];
  - private tables (`portfolio`, `watchlist(s)`, `paper_*`, `price_alerts`, `alert_events`, `notifications`, `user_preferences`, `activity`, `ai_usage`) aren't readable by `anon`;
  - private APIs verify the bearer token server-side with `auth.getUser(token)` and take the user id from it, never from the request body;
  - the service role is used server-side only.
- **Rendering on network failure:** AuthGuard now renders on a *network* failure. That exposes nothing, because each private request is still authorised by Supabase or the API.
- **CSRF:** not applicable. The session is a bearer token in localStorage, not a cookie, so cross-site requests carry no credentials. OAuth `state` and PKCE are handled by Supabase and supabase-js.
- **Residual risks (not changed):**
  - The session lives in localStorage, so an XSS bug would expose it. The CSP is still report-only.
  - Saved screens, recently viewed items and chart levels in localStorage aren't per-user, so on a shared computer the next person sees them. They're market data, not account data.

## 7. Evidence and the tests still needed

**[auto]**
- `lib/auth/__tests__/redirects.test.ts`: 6 tests covering safe paths (including `/\evil.com`), `loginHref`, cancelled / failed / leftover-code classification, and fixed messages.
- Full suite 998/998; `tsc` and `eslint` clean.
- `next build` exit 0, run in a separate worktree that held only HEAD plus these auth changes.

**[local]** (dev server, signed out)
- `/portfolio` → `/login?next=%2Fportfolio`.
- `/?error=access_denied…` → `/login?auth_error=cancelled` with the cancellation message.
- `/?code=<fake>` → `/login?auth_error=failed` with the "didn't complete" message.
- "Continue with Google" sends `redirect_to=http://localhost:3001` and stores `/portfolio` to return to.

**[blocked]** After the section 5 changes and a deploy, these need real people:
1. **A new Google account that isn't a Vercel team member, in a private window on `https://stocksphere-theta.vercel.app/portfolio`:**
   - you land on `/login?next=/portfolio`;
   - after Google, you're on `/onboarding?next=/portfolio`;
   - after picking a handle, you're on `/portfolio`;
   - a new `profiles` row exists, and Supabase logs show `grant_type=pkce` with status 200.
2. **One of the four existing accounts without a profile:** they're taken to onboarding, nothing is duplicated, and their account id is unchanged.
3. **Returning user:** reload and move between pages; you stay signed in, with no repeated trips through `/login`.
4. **Cancel on Google's screen:** you're back on `/login` with the cancellation message.
5. **Sign out:**
   - you land on `/login`;
   - the Back button doesn't show private data (pages re-check the session);
   - `/portfolio` asks you to sign in again.
6. **Two accounts:** account B can't see A's portfolio, watchlist, paper trades or alerts, either by URL or by API.
7. **Owner on localhost:3001:** sign-in still works.
