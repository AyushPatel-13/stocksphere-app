"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, Notice, PageShell, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { deleteThesis, fetchThesis, isApiError, updateThesis } from "@/lib/theses/client";
import type { ThesisDetail, ThesisVersion } from "@/lib/theses/service";
import ThesisForm, { draftFrom } from "./ThesisForm";
import { NOT_ADVICE, StanceBadge, StatusBadge, formatDate, money, stockHref } from "./ThesisBits";

type State = { status: "loading" } | { status: "error"; message: string; code?: string } | { status: "ready"; thesis: ThesisDetail; scoring: "on" | "off" };

const SECTIONS: { key: keyof ThesisVersion; label: string }[] = [
  { key: "assumptions", label: "Assumptions" },
  { key: "catalysts", label: "Catalysts" },
  { key: "risks", label: "Risks" },
  { key: "counterarguments", label: "The other side" },
  { key: "invalidation", label: "What would prove it wrong" },
];

function VersionBody({ version, currency }: { version: ThesisVersion; currency: string | null }) {
  return (
    <div className="space-y-4">
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-[#ddd]">{version.summary}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[#777]">Target date</dt>
          <dd>{formatDate(version.targetDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[#777]">Target price</dt>
          <dd>{version.targetPrice === null ? "Not set" : money(version.targetPrice, currency)}</dd>
        </div>
      </dl>
      {SECTIONS.filter((s) => String(version[s.key] ?? "").trim()).map((s) => (
        <section key={s.key}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#888]">{s.label}</h3>
          <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[#ccc]">{String(version[s.key])}</p>
        </section>
      ))}
      {version.evidence.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#888]">Evidence</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {version.evidence.map((e) => (
              <li key={e.url}>
                <a href={e.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="text-[#4ade80] hover:underline">
                  {e.label}
                </a>{" "}
                <span className="text-xs text-[#666]">{new URL(e.url).hostname}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function ThesisPage({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [viewing, setViewing] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchThesis(id);
    setState(isApiError(result) ? { status: "error", message: result.error, code: result.code } : { status: "ready", ...result });
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchThesis(id).then((result) => {
      if (!cancelled) setState(isApiError(result) ? { status: "error", message: result.error, code: result.code } : { status: "ready", ...result });
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === "loading") {
    return (
      <PageShell>
        <div className="h-64 animate-pulse rounded-2xl bg-[#111]" aria-busy="true" />
      </PageShell>
    );
  }
  if (state.status === "error") {
    return (
      <PageShell>
        <EmptyState
          title={state.code === "NOT_CONFIGURED" ? "Theses are launching soon" : "Thesis not found"}
          description={state.code === "NOT_CONFIGURED" ? undefined : "It may be a draft, or it was deleted."}
          action={<Link href="/theses" className={secondaryButtonClass}>All theses</Link>}
        />
      </PageShell>
    );
  }

  const { thesis, scoring } = state;
  const shown = thesis.versions.find((v) => v.version === (viewing ?? thesis.latest?.version)) ?? thesis.latest;
  const act = async (run: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (isApiError(result)) setError(result.error);
    else {
      after?.();
      await load();
    }
  };

  return (
    <PageShell>
      <nav className="mb-4 text-sm text-[#888]" aria-label="Breadcrumb">
        <Link href="/theses" className="hover:text-white">Theses</Link> <span aria-hidden="true">›</span>{" "}
        <Link href={stockHref(thesis)} className="hover:text-white">{thesis.symbol}</Link>
      </nav>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[#888]">
          <Link href={stockHref(thesis)} className="font-semibold text-white hover:text-[#22c55e]">{thesis.symbol}</Link>
          <span className="text-xs">{thesis.exchange}</span>
          {shown && <StanceBadge stance={shown.stance} />}
          <StatusBadge status={thesis.status} />
          <span>
            by <Link href={`/profile/${encodeURIComponent(thesis.author.username)}`} className="text-[#ccc] hover:text-white">@{thesis.author.username}</Link>
          </span>
        </div>
        <h1 className="mt-2 text-[26px] font-bold leading-tight sm:text-[30px]">{shown?.title ?? "Untitled"}</h1>
        <p className="mt-2 text-xs text-[#777]">
          {thesis.publishedAt ? `Published ${formatDate(thesis.publishedAt)}` : "Draft: only you can see it"}
          {thesis.reference &&
            ` · reference ${money(thesis.reference.price, thesis.currency)} (${thesis.reference.mode === "live" ? "live" : "last close"}, ${thesis.reference.source === "upstox" ? "Upstox" : "Yahoo"}, ${formatDate(thesis.reference.quoteTime)})`}
          {thesis.closedAt && ` · closed ${formatDate(thesis.closedAt)}`}
        </p>
      </header>

      <Notice>{NOT_ADVICE}</Notice>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="min-w-0 rounded-2xl border border-[#222] bg-[#111] p-5">
          {editing && thesis.latest ? (
            <ThesisForm
              initial={draftFrom(thesis.latest)}
              submitLabel={thesis.status === "draft" ? "Save draft" : "Publish as a new version"}
              busy={busy}
              error={error}
              onCancel={() => setEditing(false)}
              onSubmit={(draft) => act(() => updateThesis(thesis.id, { action: "revise", content: draft }), () => { setEditing(false); setViewing(null); })}
            />
          ) : shown ? (
            <>
              {shown.version !== thesis.latest?.version && (
                <p className="mb-4 rounded-lg border border-[#3a3a1a] bg-[#1a1a0d] px-3 py-2 text-xs text-[#d4d48a]">
                  You&apos;re reading version {shown.version} from {formatDate(shown.createdAt)}.{" "}
                  <button type="button" onClick={() => setViewing(null)} className="underline">Show the latest</button>
                </p>
              )}
              <VersionBody version={shown} currency={thesis.currency} />
            </>
          ) : (
            <p className="text-sm text-[#888]">No content.</p>
          )}
        </article>

        <aside className="space-y-4">
          {thesis.isAuthor && !editing && (
            <section className="rounded-2xl border border-[#222] bg-[#111] p-4">
              <p className="mb-3 text-sm font-semibold">Your thesis</p>
              <div className="flex flex-col gap-2">
                {thesis.status !== "closed" && <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>Edit</button>}
                {thesis.status === "draft" && (
                  <button type="button" disabled={busy} onClick={() => act(() => updateThesis(thesis.id, { action: "publish" }))} className={primaryButtonClass}>
                    Publish
                  </button>
                )}
                {thesis.status === "published" && (
                  <button type="button" disabled={busy} onClick={() => window.confirm("Close this thesis? It can't be edited afterwards.") && act(() => updateThesis(thesis.id, { action: "close" }))} className={secondaryButtonClass}>
                    Close
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => window.confirm("Delete this thesis? It disappears from StockSphere.") && act(() => deleteThesis(thesis.id), () => router.push("/theses"))}
                  className="text-sm text-[#888] hover:text-[#f87171]"
                >
                  Delete
                </button>
              </div>
              {thesis.status === "draft" && <p className="mt-3 text-[11px] text-[#666]">Publishing locks the current price as the reference. Edits after that are kept as new versions.</p>}
              {error && <p role="alert" className="mt-2 text-xs text-[#f87171]">{error}</p>}
            </section>
          )}

          <section className="rounded-2xl border border-[#222] bg-[#111] p-4">
            <p className="text-sm font-semibold">Outcome</p>
            <p className="mt-1 text-xs leading-relaxed text-[#888]">
              {thesis.status === "draft"
                ? "Judged once published, at the target date."
                : scoring === "off"
                  ? `Reviewed against the reference price at the target date (${thesis.latest ? formatDate(thesis.latest.targetDate) : "—"}). Outcome scoring isn't switched on yet.`
                  : `Reviewed at the target date (${thesis.latest ? formatDate(thesis.latest.targetDate) : "—"}).`}
            </p>
          </section>

          <section className="rounded-2xl border border-[#222] bg-[#111] p-4">
            <p className="text-sm font-semibold">Versions</p>
            <ol className="mt-2 space-y-1">
              {[...thesis.versions].reverse().map((v) => {
                const afterPublish = thesis.publishedAt !== null && thesis.publishedVersion !== null && v.version > thesis.publishedVersion;
                return (
                  <li key={v.version}>
                    <button
                      type="button"
                      onClick={() => setViewing(v.version)}
                      aria-current={shown?.version === v.version}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-xs ${shown?.version === v.version ? "bg-[#1a1a1a] text-white" : "text-[#aaa] hover:bg-[#151515]"}`}
                    >
                      v{v.version} · {formatDate(v.createdAt)}
                      {v.version === thesis.publishedVersion && <span className="ml-1 text-[#4ade80]">published</span>}
                      {afterPublish && <span className="ml-1 text-[#facc15]">updated after publishing</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          {thesis.statusLog.length > 0 && (
            <section className="rounded-2xl border border-[#222] bg-[#111] p-4">
              <p className="text-sm font-semibold">History</p>
              <ol className="mt-2 space-y-1 text-xs text-[#888]">
                {thesis.statusLog.map((entry, i) => (
                  <li key={i}>
                    {formatDate(entry.at)}: {entry.from ? `${entry.from} → ${entry.to}` : `started as ${entry.to}`}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Drafts are private, so only a published thesis is offered for a post. */}
          {thesis.status !== "draft" && (
            <Link href={`${stockHref(thesis)}?thesis=${thesis.id}#community`} className={`${secondaryButtonClass} w-full`}>
              Discuss this thesis in the community
            </Link>
          )}
        </aside>
      </div>
    </PageShell>
  );
}
