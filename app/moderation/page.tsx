"use client";

import { useEffect, useState } from "react";

import AuthGuard from "@/components/AuthGuard";
import { PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import type { ReportedPost } from "@/lib/community/moderation";
import { supabase } from "@/lib/supabase";

/**
 * Moderator queue: posts members reported, most-reported first, with hide and
 * restore. The server checks the caller's role on every request; this page
 * just shows what it's told.
 */

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const REASON_LABEL: Record<string, string> = { spam: "Spam", tips: "Paid tips", abuse: "Abuse", scam: "Scam", other: "Other" };

export default function ModerationPage() {
  const [state, setState] = useState<{ status: "loading" } | { status: "denied"; message: string } | { status: "error" } | { status: "ready"; posts: ReportedPost[] }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/community/moderation", { headers: await authHeader() });
        const data = await response.json();
        if (cancelled) return;
        if (data?.success) setState({ status: "ready", posts: data.posts });
        else if (response.status === 401 || response.status === 403 || response.status === 503) setState({ status: "denied", message: data?.error ?? "Moderators only." });
        else setState({ status: "error" });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function act(post: ReportedPost, action: "hide" | "restore") {
    let reason: string | null = null;
    if (action === "hide") {
      reason = window.prompt("Reason shown in the log (optional)", "Breaks community rules");
      if (reason === null) return;
    }
    setBusy(post.postId);
    try {
      const response = await fetch("/api/community/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ postId: post.postId, action, reason }),
      });
      const data = await response.json();
      if (data?.success && state.status === "ready") {
        setState({
          status: "ready",
          posts: state.posts.map((p) => (p.postId === post.postId ? { ...p, hidden: data.hidden, hiddenReason: data.hidden ? reason : null } : p)),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthGuard>
      <PageShell>
        <PageHeader eyebrow="Community" title="Moderation" description="Reported posts, most-reported first. Hidden posts disappear from every feed but stay in the database." />

        {state.status === "loading" && <div className="h-40 animate-pulse rounded-2xl bg-[#111]" />}
        {state.status === "denied" && <p className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center text-sm text-[#888]">{state.message}</p>}
        {state.status === "error" && (
          <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-10 text-center">
            <p className="text-sm text-[#888]">Reports couldn&apos;t be loaded.</p>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${secondaryButtonClass} mt-3`}>
              Try again
            </button>
          </div>
        )}
        {state.status === "ready" && state.posts.length === 0 && (
          <p className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center text-sm text-[#888]">No reported posts. 🎉</p>
        )}
        {state.status === "ready" && state.posts.length > 0 && (
          <ul className="space-y-3">
            {state.posts.map((post) => (
              <li key={post.postId} className={`rounded-2xl border bg-[#111] p-4 ${post.hidden ? "border-[#3a2020] opacity-70" : "border-[#222]"}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#888]">
                  <span className="font-semibold text-white">@{post.authorHandle}</span>
                  <span>{new Date(post.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="rounded-full border border-[#ef4444]/40 bg-[#ef4444]/10 px-2 py-0.5 font-semibold text-[#f87171]">
                    {post.reports} report{post.reports === 1 ? "" : "s"}
                  </span>
                  {Object.entries(post.reasons).map(([reason, count]) => (
                    <span key={reason} className="rounded-full border border-[#2a2a2a] px-2 py-0.5">
                      {REASON_LABEL[reason] ?? reason} ×{count}
                    </span>
                  ))}
                  {post.hidden && <span className="text-[#f87171]">Hidden{post.hiddenReason ? ` — ${post.hiddenReason}` : ""}</span>}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#ddd]">{post.body}</p>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={busy === post.postId}
                    onClick={() => act(post, post.hidden ? "restore" : "hide")}
                    className={
                      post.hidden
                        ? secondaryButtonClass
                        : "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-red-400 hover:bg-red-500 hover:text-white disabled:opacity-50"
                    }
                  >
                    {post.hidden ? "Restore post" : "Hide post"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PageShell>
    </AuthGuard>
  );
}
