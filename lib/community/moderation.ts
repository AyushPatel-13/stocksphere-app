import { getAdminClient } from "../supabase/server";

/**
 * The moderator queue: reported posts, most-reported first, and the hide /
 * restore action. Only members whose profile role is 'moderator' or 'admin'
 * (set from the SQL editor, never by users) can use it. Reports and the
 * hidden flag are server-only data under RLS, so all of this runs with the
 * service role after the caller's role is checked.
 */

export type ReportReason = "spam" | "tips" | "abuse" | "scam" | "other";

export type ReportedPost = {
  postId: string;
  body: string;
  authorHandle: string;
  createdAt: string;
  hidden: boolean;
  hiddenReason: string | null;
  reports: number;
  reasons: Partial<Record<ReportReason, number>>;
  lastReportedAt: string;
};

export interface ModerationStore {
  verifyToken(token: string): Promise<string | null>;
  roleOf(userId: string): Promise<string | null>;
  reported(limit: number): Promise<ReportedPost[]>;
  setHidden(postId: string, hidden: boolean, reason: string | null): Promise<boolean>;
}

export type ModerationResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; code: string };

const MODERATOR_ROLES = new Set(["moderator", "admin"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorise(token: string | null, store: ModerationStore | null): Promise<ModerationResult<string>> {
  if (!store) return { ok: false, status: 503, error: "Moderation isn't set up yet.", code: "NOT_CONFIGURED" };
  if (!token) return { ok: false, status: 401, error: "Sign in first.", code: "SIGNED_OUT" };
  const userId = await store.verifyToken(token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired.", code: "SIGNED_OUT" };
  const role = await store.roleOf(userId);
  if (!role || !MODERATOR_ROLES.has(role)) return { ok: false, status: 403, error: "Moderators only.", code: "FORBIDDEN" };
  return { ok: true, value: userId };
}

export async function listReported(token: string | null, store: ModerationStore | null, limit = 50): Promise<ModerationResult<ReportedPost[]>> {
  const auth = await authorise(token, store);
  if (!auth.ok) return auth;
  return { ok: true, value: await store!.reported(limit) };
}

export async function moderatePost(
  token: string | null,
  input: { postId?: unknown; action?: unknown; reason?: unknown },
  store: ModerationStore | null
): Promise<ModerationResult<{ postId: string; hidden: boolean }>> {
  const auth = await authorise(token, store);
  if (!auth.ok) return auth;

  if (typeof input.postId !== "string" || !UUID.test(input.postId)) return { ok: false, status: 400, error: "Invalid post.", code: "BAD_REQUEST" };
  if (input.action !== "hide" && input.action !== "restore") return { ok: false, status: 400, error: "Choose hide or restore.", code: "BAD_REQUEST" };

  const hidden = input.action === "hide";
  const reason = hidden ? (typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 140) : "Hidden by a moderator") : null;
  const changed = await store!.setHidden(input.postId, hidden, reason);
  if (!changed) return { ok: false, status: 404, error: "Post not found.", code: "NOT_FOUND" };
  return { ok: true, value: { postId: input.postId, hidden } };
}

/** Group report rows into one entry per post, most-reported first. */
export function groupReports(
  rows: { post_id: string; reason: ReportReason; created_at: string }[]
): Map<string, { reports: number; reasons: Partial<Record<ReportReason, number>>; last: string }> {
  const grouped = new Map<string, { reports: number; reasons: Partial<Record<ReportReason, number>>; last: string }>();
  for (const row of rows) {
    const entry = grouped.get(row.post_id) ?? { reports: 0, reasons: {}, last: row.created_at };
    entry.reports++;
    entry.reasons[row.reason] = (entry.reasons[row.reason] ?? 0) + 1;
    if (row.created_at > entry.last) entry.last = row.created_at;
    grouped.set(row.post_id, entry);
  }
  return grouped;
}

export function getModerationStore(): ModerationStore | null {
  const admin = getAdminClient();
  if (!admin) return null;

  return {
    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async roleOf(userId) {
      const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
      return data?.role ?? null;
    },

    async reported(limit) {
      const { data: reports, error } = await admin
        .from("post_reports")
        .select("post_id, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;

      const grouped = groupReports(reports ?? []);
      const ids = Array.from(grouped.entries())
        .sort((a, b) => b[1].reports - a[1].reports || b[1].last.localeCompare(a[1].last))
        .slice(0, limit)
        .map(([id]) => id);
      if (ids.length === 0) return [];

      const { data: posts, error: postError } = await admin
        .from("posts")
        .select("id, body, created_at, hidden, hidden_reason, author:profiles!posts_author_id_fkey(username)")
        .in("id", ids);
      if (postError) throw postError;

      const byId = new Map((posts ?? []).map((p) => [p.id, p]));
      return ids.flatMap((id) => {
        const post = byId.get(id);
        const meta = grouped.get(id)!;
        if (!post) return [];
        const author = Array.isArray(post.author) ? post.author[0] : post.author;
        return [
          {
            postId: id,
            body: post.body,
            authorHandle: (author as { username?: string } | null)?.username ?? "deleted",
            createdAt: post.created_at,
            hidden: post.hidden,
            hiddenReason: post.hidden_reason,
            reports: meta.reports,
            reasons: meta.reasons,
            lastReportedAt: meta.last,
          },
        ];
      });
    },

    async setHidden(postId, hidden, reason) {
      const { data, error } = await admin.from("posts").update({ hidden, hidden_reason: reason }).eq("id", postId).select("id");
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  };
}
