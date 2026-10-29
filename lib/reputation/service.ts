import { getAdminClient } from "../supabase/server";
import type { ReputationInputs } from "./compute";

/**
 * Reads a member's reputation inputs from the raw tables (service role, so
 * moderator-removed posts are counted). Counts only: no post text, no
 * portfolio or paper data is read.
 */

export interface ReputationStore {
  /** The member's id for a handle, or null. */
  memberId(username: string): Promise<string | null>;
  inputs(memberId: string, now: number): Promise<ReputationInputs>;
}

type VersionRow = { version: number; created_at: string; risks: string; invalidation: string; target_date: string };
type ThesisRow = { published_version: number | null; published_at: string | null; status: string; versions: VersionRow[] | null };

/** Pure part of the thesis counts, for tests. */
export function thesisCounts(theses: ThesisRow[]): Pick<ReputationInputs, "thesisUpdates" | "publishedTheses"> {
  let beforeTarget = 0;
  let afterTarget = 0;
  let total = 0;
  let withRisksAndInvalidation = 0;
  for (const thesis of theses) {
    if (thesis.status === "draft" || thesis.published_version === null) continue;
    total++;
    const versions = [...(thesis.versions ?? [])].sort((a, b) => a.version - b.version);
    const published = versions.find((v) => v.version === thesis.published_version);
    if (published && published.risks.trim() && published.invalidation.trim()) withRisksAndInvalidation++;
    for (const v of versions) {
      if (v.version <= thesis.published_version) continue;
      // Judged against the target date in force just before the update.
      const target = versions.filter((p) => p.version < v.version).at(-1)?.target_date;
      if (target && Date.parse(v.created_at) >= Date.parse(`${target}T00:00:00Z`) + 86_400_000) afterTarget++;
      else beforeTarget++;
    }
  }
  return { thesisUpdates: { beforeTarget, afterTarget }, publishedTheses: { total, withRisksAndInvalidation } };
}

export function getReputationStore(): ReputationStore | null {
  const admin = getAdminClient();
  if (!admin) return null;
  return {
    async memberId(username) {
      const { data } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      return data?.id ?? null;
    },
    async inputs(memberId) {
      const [profile, theses, standing, removed] = await Promise.all([
        admin.from("profiles").select("pred_resolved, pred_wins").eq("id", memberId).maybeSingle(),
        admin
          .from("theses")
          .select("published_version, published_at, status, versions:thesis_versions(version, created_at, risks, invalidation, target_date)")
          .eq("author_id", memberId),
        admin.from("posts").select("id", { count: "exact", head: true }).eq("author_id", memberId).is("deleted_at", null).eq("hidden", false),
        admin.from("posts").select("id", { count: "exact", head: true }).eq("author_id", memberId).eq("hidden", true),
      ]);
      for (const result of [profile, theses, standing, removed]) if (result.error) throw result.error;
      return {
        predictions: { resolved: profile.data?.pred_resolved ?? 0, wins: profile.data?.pred_wins ?? 0 },
        ...thesisCounts((theses.data ?? []) as unknown as ThesisRow[]),
        posts: { standing: standing.count ?? 0, removed: removed.count ?? 0 },
      };
    },
  };
}
