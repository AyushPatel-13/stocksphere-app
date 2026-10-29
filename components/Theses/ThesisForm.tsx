"use client";

import { useState } from "react";

import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import type { EvidenceLink, Stance, ThesisContent } from "@/lib/theses/service";

/**
 * The thesis editor, for a new thesis and for a new version of one. The
 * server checks everything again; the limits here only help the member.
 */

const FIELDS: { key: "assumptions" | "catalysts" | "risks" | "counterarguments" | "invalidation"; label: string; hint: string; max: number }[] = [
  { key: "assumptions", label: "Assumptions", hint: "What has to be true for this to work?", max: 2000 },
  { key: "catalysts", label: "Catalysts", hint: "What could move the price, and when?", max: 2000 },
  { key: "risks", label: "Risks", hint: "What could go wrong?", max: 2000 },
  { key: "counterarguments", label: "The other side", hint: "The strongest case against you.", max: 2000 },
  { key: "invalidation", label: "What would prove it wrong", hint: "A clear sign you'd give up on it.", max: 1000 },
];

export type ThesisDraft = Omit<ThesisContent, "targetPrice"> & { targetPrice: string };

export function emptyDraft(): ThesisDraft {
  const inSixMonths = new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10);
  return { title: "", summary: "", stance: "bullish", targetDate: inSixMonths, targetPrice: "", assumptions: "", catalysts: "", risks: "", counterarguments: "", invalidation: "", evidence: [] };
}

export function draftFrom(content: ThesisContent): ThesisDraft {
  return { ...content, targetPrice: content.targetPrice === null ? "" : String(content.targetPrice) };
}

export default function ThesisForm({
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
  before,
}: {
  initial: ThesisDraft;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (content: ThesisDraft) => void;
  onCancel?: () => void;
  before?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<ThesisDraft>(initial);
  const set = <K extends keyof ThesisDraft>(key: K, value: ThesisDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setEvidence = (index: number, patch: Partial<EvidenceLink>) => set("evidence", draft.evidence.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ ...draft, evidence: draft.evidence.filter((e) => e.url.trim()) });
      }}
      className="space-y-4"
    >
      {before}
      <div>
        <label htmlFor="thesis-title" className="mb-1 block text-sm font-medium">Title</label>
        <input id="thesis-title" value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={120} required minLength={3} className={inputClass} placeholder="One line: what you expect and why" />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Stance</legend>
        <div className="flex gap-2" role="radiogroup">
          {(["bullish", "bearish", "neutral"] as Stance[]).map((stance) => (
            <label key={stance} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${draft.stance === stance ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa]"}`}>
              <input type="radio" name="stance" value={stance} checked={draft.stance === stance} onChange={() => set("stance", stance)} className="sr-only" />
              {stance[0].toUpperCase() + stance.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="thesis-summary" className="mb-1 block text-sm font-medium">The thesis</label>
        <textarea id="thesis-summary" value={draft.summary} onChange={(e) => set("summary", e.target.value)} maxLength={4000} required minLength={10} rows={6} className={inputClass} placeholder="Your reasoning, with the numbers that matter." />
        <p className="mt-1 text-right text-[11px] text-[#666]">{draft.summary.length}/4000</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="thesis-date" className="mb-1 block text-sm font-medium">Target date</label>
          <input id="thesis-date" type="date" value={draft.targetDate} onChange={(e) => set("targetDate", e.target.value)} required className={inputClass} />
          <p className="mt-1 text-[11px] text-[#666]">When it should be judged: 7 days to 3 years away.</p>
        </div>
        <div>
          <label htmlFor="thesis-price" className="mb-1 block text-sm font-medium">Target price <span className="text-[#666]">(optional)</span></label>
          <input id="thesis-price" inputMode="decimal" value={draft.targetPrice} onChange={(e) => set("targetPrice", e.target.value)} className={inputClass} placeholder="e.g. 1650" />
        </div>
      </div>

      {FIELDS.map((field) => (
        <div key={field.key}>
          <label htmlFor={`thesis-${field.key}`} className="mb-1 block text-sm font-medium">{field.label} <span className="font-normal text-[#666]">{field.hint}</span></label>
          <textarea id={`thesis-${field.key}`} value={draft[field.key]} onChange={(e) => set(field.key, e.target.value)} maxLength={field.max} rows={3} className={inputClass} />
        </div>
      ))}

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Evidence <span className="font-normal text-[#666]">Links to filings, results or reports (https).</span></legend>
        <ul className="space-y-2">
          {draft.evidence.map((item, index) => (
            <li key={index} className="flex flex-col gap-2 sm:flex-row">
              <input aria-label={`Evidence ${index + 1} label`} value={item.label} onChange={(e) => setEvidence(index, { label: e.target.value })} maxLength={120} placeholder="Label" className={`${inputClass} sm:w-48`} />
              <input aria-label={`Evidence ${index + 1} link`} value={item.url} onChange={(e) => setEvidence(index, { url: e.target.value })} type="url" placeholder="https://…" className={inputClass} />
              <button type="button" onClick={() => set("evidence", draft.evidence.filter((_, i) => i !== index))} className={secondaryButtonClass} aria-label={`Remove evidence ${index + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        {draft.evidence.length < 10 && (
          <button type="button" onClick={() => set("evidence", [...draft.evidence, { label: "", url: "" }])} className={`${secondaryButtonClass} mt-2`}>
            Add a link
          </button>
        )}
      </fieldset>

      {error && <p role="alert" className="text-sm text-[#f87171]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>{busy ? "Saving…" : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className={secondaryButtonClass}>Cancel</button>}
      </div>
    </form>
  );
}
