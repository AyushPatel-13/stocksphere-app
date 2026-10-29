import { bareIndianSymbol } from "../data/instruments/india";
import { chooseReference, type ReferenceMode, type ReferenceSource } from "../predictions/v2/reference";
import type { PredictionMarketData } from "../predictions/v2/sources";
import { isRetiredSymbol } from "../search/renames";
import { getAdminClient, getPublicClient, getUserClient } from "../supabase/server";
import { isValidSymbol } from "../validation/symbol";

/**
 * Thesis Tracker: a member's case for (or against) one listing, kept honest.
 *
 *   - Content lives in thesis_versions, which the database makes append-only:
 *     an edit is version n+1; version n never changes.
 *   - The listing is resolved here, never taken from the client as-is: the
 *     symbol must price through the same providers predictions use, and a
 *     retired listing (TATAMOTORS) is refused.
 *   - Publishing freezes a reference price read by the server, by the same
 *     rules as a prediction's entry (live while the market is open, the last
 *     official close otherwise; a stale live quote is refused).
 *   - Outcomes are judged at the target date against that reference. Scoring
 *     stays off (THESIS_SCORING_ENABLED) until the scheduled jobs have been
 *     seen running in production; until then no outcome is shown.
 *
 * Reads go through RLS as the viewer (drafts are visible only to their
 * author); writes go through the service role after the session is checked.
 */

export type Stance = "bullish" | "bearish" | "neutral";
export type ThesisStatus = "draft" | "published" | "closed";
export type Exchange = "NSE" | "BSE" | "US";

export type EvidenceLink = { label: string; url: string };

export type ThesisContent = {
  title: string;
  summary: string;
  stance: Stance;
  targetDate: string;
  targetPrice: number | null;
  assumptions: string;
  catalysts: string;
  risks: string;
  counterarguments: string;
  invalidation: string;
  evidence: EvidenceLink[];
};

export type ThesisVersion = ThesisContent & { version: number; createdAt: string };

export type ThesisView = {
  id: string;
  symbol: string;
  exchange: Exchange;
  currency: string | null;
  status: ThesisStatus;
  currentVersion: number;
  publishedVersion: number | null;
  publishedAt: string | null;
  reference: { price: number; source: ReferenceSource; mode: ReferenceMode; quoteTime: string } | null;
  closedAt: string | null;
  createdAt: string;
  author: { username: string; displayName: string; avatarUrl: string | null };
  /** The latest version the viewer can see. */
  latest: ThesisVersion | null;
};

export type ThesisDetail = ThesisView & {
  versions: ThesisVersion[];
  statusLog: { from: ThesisStatus | null; to: ThesisStatus; at: string }[];
  isAuthor: boolean;
};

export const LIMITS = {
  title: [3, 120],
  summary: [10, 4000],
  long: 2000,
  invalidation: 1000,
  evidence: 10,
  evidenceLabel: 120,
  newPerDay: 10,
  versionsPerDay: 30,
  minHorizonDays: 7,
  maxHorizonDays: 3 * 366,
} as const;

/* ------------------------------------------------------------ validation */

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (value: unknown) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** https only, no credentials; returned normalised. */
export function cleanEvidenceUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseThesisContent(raw: Record<string, unknown> | null | undefined, now: number = Date.now()): Checked<ThesisContent> {
  const input = raw ?? {};
  const title = text(input.title).replace(/\s+/g, " ");
  if (title.length < LIMITS.title[0] || title.length > LIMITS.title[1]) return { ok: false, error: `The title needs ${LIMITS.title[0]}–${LIMITS.title[1]} characters.` };

  const summary = text(input.summary);
  if (summary.length < LIMITS.summary[0] || summary.length > LIMITS.summary[1]) return { ok: false, error: `The thesis needs ${LIMITS.summary[0]}–${LIMITS.summary[1]} characters.` };

  const stance = input.stance;
  if (stance !== "bullish" && stance !== "bearish" && stance !== "neutral") return { ok: false, error: "Pick bullish, bearish or neutral." };

  const targetDate = text(input.targetDate);
  const at = Date.parse(`${targetDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !Number.isFinite(at) || isoDay(at) !== targetDate) return { ok: false, error: "Pick a target date." };
  const days = (at - Date.parse(`${isoDay(now)}T00:00:00Z`)) / 86_400_000;
  if (days < LIMITS.minHorizonDays) return { ok: false, error: `The target date must be at least ${LIMITS.minHorizonDays} days away.` };
  if (days > LIMITS.maxHorizonDays) return { ok: false, error: "The target date must be within three years." };

  let targetPrice: number | null = null;
  if (input.targetPrice !== undefined && input.targetPrice !== null && input.targetPrice !== "") {
    const n = typeof input.targetPrice === "string" ? Number(input.targetPrice) : input.targetPrice;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0 || n > 1e9) return { ok: false, error: "The target price must be a positive number." };
    targetPrice = Math.round(n * 100) / 100;
  }

  const long: Record<"assumptions" | "catalysts" | "risks" | "counterarguments", string> = {
    assumptions: text(input.assumptions),
    catalysts: text(input.catalysts),
    risks: text(input.risks),
    counterarguments: text(input.counterarguments),
  };
  for (const [key, value] of Object.entries(long)) {
    if (value.length > LIMITS.long) return { ok: false, error: `${key[0].toUpperCase()}${key.slice(1)} can be at most ${LIMITS.long} characters.` };
  }
  const invalidation = text(input.invalidation);
  if (invalidation.length > LIMITS.invalidation) return { ok: false, error: `"What would prove it wrong" can be at most ${LIMITS.invalidation} characters.` };

  const rawEvidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (rawEvidence.length > LIMITS.evidence) return { ok: false, error: `Add at most ${LIMITS.evidence} evidence links.` };
  const evidence: EvidenceLink[] = [];
  for (const item of rawEvidence) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const url = cleanEvidenceUrl(text(entry.url));
    if (!url) return { ok: false, error: "Evidence links must be full https:// addresses." };
    const label = text(entry.label).replace(/\s+/g, " ").slice(0, LIMITS.evidenceLabel) || new URL(url).hostname;
    evidence.push({ label, url });
  }

  return { ok: true, value: { title, summary, stance, targetDate, targetPrice, ...long, invalidation, evidence } };
}

/** The listing a thesis is about, resolved on the server. */
export function resolveThesisListing(raw: unknown): Checked<{ symbol: string; exchange: Exchange; lookup: string }> {
  const symbol = text(raw).toUpperCase();
  if (!symbol || !isValidSymbol(symbol) || symbol.startsWith("^")) return { ok: false, error: "Pick a stock from the search." };
  const bare = bareIndianSymbol(symbol.replace(/\.(BO|BSE)$/, ""));
  if (isRetiredSymbol(bare)) return { ok: false, error: "That listing no longer trades. Search for its current name." };
  if (/\.(BO|BSE)$/.test(symbol)) return { ok: true, value: { symbol: bare, exchange: "BSE", lookup: `${bare}.BO` } };
  return { ok: true, value: { symbol: bare, exchange: "NSE", lookup: symbol } };
}

/* ------------------------------------------------------------ outcomes */

export function isThesisScoringEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.THESIS_SCORING_ENABLED === "true";
}

export type ThesisOutcome =
  | { status: "not_due"; dueOn: string }
  | { status: "unavailable" }
  | { status: "scored"; returnPct: number; benchmarkReturnPct: number | null; excessPct: number | null; verdict: "supported" | "not_supported" | "inconclusive"; targetReached: boolean | null };

/**
 * A thesis judged at its target date against the reference frozen at publish.
 * Bullish needs the stock up (and ahead of the benchmark, when one is given);
 * bearish needs it down (or behind); a move inside ±flatPct is inconclusive,
 * as is any neutral thesis. Never computed before the target date.
 */
export function thesisOutcome(
  input: { stance: Stance; targetDate: string; referencePrice: number; priceAtTarget: number | null; benchmarkReturnPct?: number | null; targetPrice?: number | null },
  now: number,
  flatPct = 2
): ThesisOutcome {
  if (now < Date.parse(`${input.targetDate}T00:00:00Z`) + 86_400_000) return { status: "not_due", dueOn: input.targetDate };
  if (!(input.referencePrice > 0) || input.priceAtTarget === null || !(input.priceAtTarget > 0)) return { status: "unavailable" };

  const round = (n: number) => Math.round(n * 100) / 100;
  const returnPct = round((input.priceAtTarget / input.referencePrice - 1) * 100);
  const benchmark = input.benchmarkReturnPct ?? null;
  const excessPct = benchmark === null ? null : round(returnPct - benchmark);
  const measured = excessPct ?? returnPct;

  let verdict: "supported" | "not_supported" | "inconclusive" = "inconclusive";
  if (input.stance !== "neutral" && Math.abs(measured) >= flatPct) {
    verdict = (input.stance === "bullish") === measured > 0 ? "supported" : "not_supported";
  }
  const target = input.targetPrice ?? null;
  const targetReached =
    target === null || input.stance === "neutral" ? null : input.stance === "bullish" ? input.priceAtTarget >= target : input.priceAtTarget <= target;
  return { status: "scored", returnPct, benchmarkReturnPct: benchmark, excessPct, verdict, targetReached };
}

/* ------------------------------------------------------------ store */

export type NewThesisRow = { author_id: string; symbol: string; exchange: Exchange; currency: string | null };

export type PublishFields = {
  published_version: number;
  published_at: string;
  reference_price: number;
  reference_source: ReferenceSource;
  reference_mode: ReferenceMode;
  reference_quote_time: string;
};

export interface ThesisStore {
  verifyToken(token: string): Promise<string | null>;
  hasProfile(userId: string): Promise<boolean>;
  countSince(userId: string, sinceIso: string): Promise<{ theses: number; versions: number }>;
  /** Thesis plus its version 1; returns the new id. */
  create(row: NewThesisRow, content: ThesisContent): Promise<string>;
  /** The raw thesis row for the server's own checks (service role). */
  getOwned(id: string): Promise<{ authorId: string; status: ThesisStatus; currentVersion: number; deleted: boolean; symbol: string; exchange: Exchange } | null>;
  /** "conflict" when version n already exists (two edits raced). */
  addVersion(id: string, version: number, content: ThesisContent): Promise<"ok" | "conflict">;
  publish(id: string, fields: PublishFields): Promise<void>;
  close(id: string, at: string): Promise<void>;
  softDelete(id: string, at: string): Promise<void>;
  /** Read as the viewer (RLS); null token reads as a visitor. */
  detail(id: string, viewerToken: string | null, viewerId: string | null): Promise<ThesisDetail | null>;
  list(query: { symbol?: string; username?: string; viewerToken?: string | null; mine?: string | null; limit: number }): Promise<ThesisView[]>;
}

/* ------------------------------------------------------------ actions */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code?: string };

const fail = <T>(status: number, error: string, code?: string): ActionResult<T> => ({ ok: false, status, error, code });

async function authorOf(store: ThesisStore, token: string | null): Promise<ActionResult<string>> {
  if (!token) return fail(401, "Sign in to write a thesis.", "SIGNED_OUT");
  const userId = await store.verifyToken(token);
  if (!userId) return fail(401, "Your session expired. Please sign in again.", "SIGNED_OUT");
  if (!(await store.hasProfile(userId))) return fail(403, "Pick your @handle before writing a thesis.", "NO_PROFILE");
  return { ok: true, value: userId };
}

export async function createThesis(
  input: { token: string | null; symbol: unknown; content: Record<string, unknown> | null },
  store: ThesisStore,
  market: PredictionMarketData,
  now: number = Date.now()
): Promise<ActionResult<{ id: string }>> {
  const author = await authorOf(store, input.token);
  if (!author.ok) return author;

  const listing = resolveThesisListing(input.symbol);
  if (!listing.ok) return fail(400, listing.error);
  const content = parseThesisContent(input.content, now);
  if (!content.ok) return fail(422, content.error, "RULES");

  const counts = await store.countSince(author.value, new Date(now - 86_400_000).toISOString());
  if (counts.theses >= LIMITS.newPerDay) return fail(429, `You can start up to ${LIMITS.newPerDay} theses a day.`, "RATE_LIMITED");

  // The listing must price through our providers; that's what publishing will need.
  const snapshot = await market.snapshot("stock", listing.value.lookup, now);
  if (!snapshot) return fail(400, "We don't recognise that symbol.");
  const exchange: Exchange = snapshot.currency === "USD" ? "US" : listing.value.exchange;
  const symbol = exchange === "US" ? snapshot.symbol.toUpperCase() : listing.value.symbol;

  const id = await store.create({ author_id: author.value, symbol, exchange, currency: snapshot.currency === "INR" || snapshot.currency === "USD" ? snapshot.currency : null }, content.value);
  return { ok: true, value: { id } };
}

async function ownedThesis(store: ThesisStore, token: string | null, id: string) {
  const author = await authorOf(store, token);
  if (!author.ok) return author;
  const thesis = await store.getOwned(id);
  if (!thesis || thesis.deleted || thesis.authorId !== author.value) return fail<never>(404, "Thesis not found.");
  return { ok: true as const, value: { userId: author.value, thesis } };
}

export async function reviseThesis(
  input: { token: string | null; id: string; content: Record<string, unknown> | null },
  store: ThesisStore,
  now: number = Date.now()
): Promise<ActionResult<{ version: number }>> {
  const owned = await ownedThesis(store, input.token, input.id);
  if (!owned.ok) return owned;
  if (owned.value.thesis.status === "closed") return fail(409, "A closed thesis can't be edited.", "CLOSED");

  const content = parseThesisContent(input.content, now);
  if (!content.ok) return fail(422, content.error, "RULES");
  const counts = await store.countSince(owned.value.userId, new Date(now - 86_400_000).toISOString());
  if (counts.versions >= LIMITS.versionsPerDay) return fail(429, `You can save up to ${LIMITS.versionsPerDay} versions a day.`, "RATE_LIMITED");

  const version = owned.value.thesis.currentVersion + 1;
  if ((await store.addVersion(input.id, version, content.value)) === "conflict") {
    return fail(409, "This thesis was just edited somewhere else. Reload to see the latest version.", "CONFLICT");
  }
  return { ok: true, value: { version } };
}

export async function publishThesis(
  input: { token: string | null; id: string },
  store: ThesisStore,
  market: PredictionMarketData,
  now: number = Date.now()
): Promise<ActionResult<{ referencePrice: number }>> {
  const owned = await ownedThesis(store, input.token, input.id);
  if (!owned.ok) return owned;
  const { thesis } = owned.value;
  if (thesis.status !== "draft") return fail(409, "This thesis is already published.", "ALREADY_PUBLISHED");

  const lookup = thesis.exchange === "BSE" ? `${thesis.symbol}.BO` : thesis.exchange === "NSE" ? `${thesis.symbol}.NS` : thesis.symbol;
  const snapshot = await market.snapshot("stock", lookup, now);
  if (!snapshot) return fail(503, "We couldn't get a price for this right now. Try again shortly.", "PRICE_UNAVAILABLE");
  const reference = chooseReference({ assetType: "stock", now, session: snapshot.session, live: snapshot.live, lastClose: snapshot.lastClose });
  if ("error" in reference) {
    return fail(
      503,
      reference.error === "stale"
        ? "The live price is delayed right now, so we can't lock a fair reference. Try again in a minute."
        : "We couldn't get a price for this right now. Try again shortly.",
      "PRICE_UNAVAILABLE"
    );
  }

  await store.publish(input.id, {
    published_version: thesis.currentVersion,
    published_at: new Date(now).toISOString(),
    reference_price: reference.price,
    reference_source: reference.source,
    reference_mode: reference.mode,
    reference_quote_time: new Date(reference.quoteTime).toISOString(),
  });
  return { ok: true, value: { referencePrice: reference.price } };
}

export async function closeThesis(input: { token: string | null; id: string }, store: ThesisStore, now: number = Date.now()): Promise<ActionResult<null>> {
  const owned = await ownedThesis(store, input.token, input.id);
  if (!owned.ok) return owned;
  if (owned.value.thesis.status !== "published") return fail(409, "Only a published thesis can be closed.");
  await store.close(input.id, new Date(now).toISOString());
  return { ok: true, value: null };
}

export async function deleteThesis(input: { token: string | null; id: string }, store: ThesisStore, now: number = Date.now()): Promise<ActionResult<null>> {
  const owned = await ownedThesis(store, input.token, input.id);
  if (!owned.ok) return owned;
  await store.softDelete(input.id, new Date(now).toISOString());
  return { ok: true, value: null };
}

/* ------------------------------------------------------------ Supabase store */

type VersionRow = {
  version: number;
  title: string;
  summary: string;
  stance: Stance;
  target_date: string;
  target_price: number | string | null;
  assumptions: string;
  catalysts: string;
  risks: string;
  counterarguments: string;
  invalidation: string;
  evidence: unknown;
  created_at: string;
};

type ThesisRow = {
  id: string;
  author_id: string;
  symbol: string;
  exchange: Exchange;
  currency: string | null;
  status: ThesisStatus;
  current_version: number;
  published_version: number | null;
  published_at: string | null;
  reference_price: number | string | null;
  reference_source: ReferenceSource | null;
  reference_mode: ReferenceMode | null;
  reference_quote_time: string | null;
  closed_at: string | null;
  created_at: string;
  author: { username: string; display_name: string; avatar_url: string | null } | { username: string; display_name: string; avatar_url: string | null }[] | null;
  versions?: VersionRow[];
};

const THESIS_COLUMNS =
  "id, author_id, symbol, exchange, currency, status, current_version, published_version, published_at, reference_price, reference_source, reference_mode, reference_quote_time, closed_at, created_at, author:profiles!theses_author_id_fkey(username, display_name, avatar_url)";
const VERSION_COLUMNS = "version, title, summary, stance, target_date, target_price, assumptions, catalysts, risks, counterarguments, invalidation, evidence, created_at";

function evidenceOf(value: unknown): EvidenceLink[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const url = typeof item?.url === "string" ? cleanEvidenceUrl(item.url) : null;
        return url ? [{ label: typeof item.label === "string" ? item.label : new URL(url).hostname, url }] : [];
      })
    : [];
}

export function toVersion(row: VersionRow): ThesisVersion {
  return {
    version: row.version,
    title: row.title,
    summary: row.summary,
    stance: row.stance,
    targetDate: row.target_date,
    targetPrice: row.target_price === null ? null : Number(row.target_price),
    assumptions: row.assumptions,
    catalysts: row.catalysts,
    risks: row.risks,
    counterarguments: row.counterarguments,
    invalidation: row.invalidation,
    evidence: evidenceOf(row.evidence),
    createdAt: row.created_at,
  };
}

export function toThesisView(row: ThesisRow, versions: ThesisVersion[]): ThesisView {
  const author = Array.isArray(row.author) ? row.author[0] : row.author;
  const latest = versions.reduce<ThesisVersion | null>((best, v) => (!best || v.version > best.version ? v : best), null);
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    currency: row.currency,
    status: row.status,
    currentVersion: row.current_version,
    publishedVersion: row.published_version,
    publishedAt: row.published_at,
    reference:
      row.reference_price !== null && row.reference_source && row.reference_mode && row.reference_quote_time
        ? { price: Number(row.reference_price), source: row.reference_source, mode: row.reference_mode, quoteTime: row.reference_quote_time }
        : null,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    author: { username: author?.username ?? "deleted", displayName: author?.display_name ?? "Deleted user", avatarUrl: author?.avatar_url ?? null },
    latest,
  };
}

export function getThesisStore(): ThesisStore | null {
  const admin = getAdminClient();
  const visitor = getPublicClient();
  if (!admin || !visitor) return null;
  const reader = (token: string | null | undefined) => (token ? getUserClient(token) ?? visitor : visitor);

  const insertVersion = async (id: string, version: number, content: ThesisContent) =>
    admin.from("thesis_versions").insert({
      thesis_id: id,
      version,
      title: content.title,
      summary: content.summary,
      stance: content.stance,
      target_date: content.targetDate,
      target_price: content.targetPrice,
      assumptions: content.assumptions,
      catalysts: content.catalysts,
      risks: content.risks,
      counterarguments: content.counterarguments,
      invalidation: content.invalidation,
      evidence: content.evidence,
    });

  return {
    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    async hasProfile(userId) {
      const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
      return Boolean(data);
    },
    async countSince(userId, sinceIso) {
      const [theses, versions] = await Promise.all([
        admin.from("theses").select("id", { count: "exact", head: true }).eq("author_id", userId).gte("created_at", sinceIso),
        admin.from("thesis_versions").select("thesis_id, theses!inner(author_id)", { count: "exact", head: true }).eq("theses.author_id", userId).gte("created_at", sinceIso),
      ]);
      if (theses.error) throw theses.error;
      if (versions.error) throw versions.error;
      return { theses: theses.count ?? 0, versions: versions.count ?? 0 };
    },
    async create(row, content) {
      const { data, error } = await admin.from("theses").insert(row).select("id").single();
      if (error) throw error;
      const { error: versionError } = await insertVersion(data.id, 1, content);
      if (versionError) {
        // No content saved: retire the empty thesis rather than leave it half-made.
        await admin.from("theses").update({ deleted_at: new Date().toISOString() }).eq("id", data.id);
        throw versionError;
      }
      return data.id as string;
    },
    async getOwned(id) {
      const { data, error } = await admin.from("theses").select("author_id, status, current_version, deleted_at, symbol, exchange").eq("id", id).maybeSingle();
      if (error) throw error;
      return data
        ? { authorId: data.author_id, status: data.status, currentVersion: data.current_version, deleted: data.deleted_at !== null, symbol: data.symbol, exchange: data.exchange }
        : null;
    },
    async addVersion(id, version, content) {
      const { error } = await insertVersion(id, version, content);
      if (error?.code === "23505") return "conflict";
      if (error) throw error;
      const { error: bump } = await admin.from("theses").update({ current_version: version }).eq("id", id).lt("current_version", version);
      if (bump) throw bump;
      return "ok";
    },
    async publish(id, fields) {
      const { error } = await admin.from("theses").update({ status: "published", ...fields }).eq("id", id).eq("status", "draft");
      if (error) throw error;
    },
    async close(id, at) {
      const { error } = await admin.from("theses").update({ status: "closed", closed_at: at }).eq("id", id).eq("status", "published");
      if (error) throw error;
    },
    async softDelete(id, at) {
      const { error } = await admin.from("theses").update({ deleted_at: at }).eq("id", id).is("deleted_at", null);
      if (error) throw error;
    },
    async detail(id, viewerToken, viewerId) {
      const client = reader(viewerToken);
      const { data, error } = await client.from("theses").select(`${THESIS_COLUMNS}, versions:thesis_versions(${VERSION_COLUMNS})`).eq("id", id).is("deleted_at", null).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as ThesisRow;
      const versions = (row.versions ?? []).map(toVersion).sort((a, b) => a.version - b.version);
      const { data: log } = await client.from("thesis_status_log").select("from_status, to_status, changed_at").eq("thesis_id", id).order("changed_at", { ascending: true });
      return {
        ...toThesisView(row, versions),
        versions,
        statusLog: (log ?? []).map((entry) => ({ from: entry.from_status, to: entry.to_status, at: entry.changed_at })),
        isAuthor: viewerId !== null && row.author_id === viewerId,
      };
    },
    async list({ symbol, username, viewerToken, mine, limit }) {
      const client = reader(viewerToken);
      let query = client
        .from("theses")
        .select(`${THESIS_COLUMNS}, versions:thesis_versions(${VERSION_COLUMNS})`)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (mine) query = query.eq("author_id", mine);
      else query = query.neq("status", "draft");
      if (symbol) query = query.eq("symbol", symbol);
      if (username) {
        const { data: profile } = await visitor.from("profiles").select("id").eq("username", username).maybeSingle();
        if (!profile) return [];
        query = query.eq("author_id", profile.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => {
        const r = row as unknown as ThesisRow;
        return toThesisView(r, (r.versions ?? []).map(toVersion));
      });
    },
  };
}
