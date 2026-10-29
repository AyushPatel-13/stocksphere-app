"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import InstrumentField, { pickedFromResult, type PickedInstrument } from "@/components/Search/InstrumentField";
import { Notice, PageHeader, PageShell } from "@/components/ui/Page";
import { storedSymbolFor } from "@/lib/search/pick";
import { createThesis, isApiError } from "@/lib/theses/client";
import ThesisForm, { emptyDraft } from "./ThesisForm";
import { NOT_ADVICE } from "./ThesisBits";

export default function NewThesis({ symbol }: { symbol?: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedInstrument | null>(symbol ? { symbol, name: symbol } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Theses"
        title="Write a thesis"
        description="It starts as a private draft. When you publish, we lock the current price as its reference; later edits become new versions, and earlier ones stay as they were."
      />
      <Notice>{NOT_ADVICE}</Notice>
      <div className="rounded-2xl border border-[#222] bg-[#111] p-5">
        <ThesisForm
          initial={emptyDraft()}
          submitLabel="Save draft"
          busy={busy}
          error={error}
          before={
            <InstrumentField
              label="Stock"
              inputId="thesis-symbol"
              value={picked}
              filterTypes={["stock"]}
              placeholder="Search e.g. TCS, HDFC Bank, AAPL"
              onPick={(result) => setPicked(pickedFromResult(result, storedSymbolFor(result)))}
              onClear={() => setPicked(null)}
            />
          }
          onSubmit={async (draft) => {
            if (!picked) {
              setError("Pick a stock first.");
              return;
            }
            setBusy(true);
            setError(null);
            const result = await createThesis(picked.symbol, draft);
            setBusy(false);
            if (isApiError(result)) setError(result.error);
            else router.push(`/theses/${result}`);
          }}
        />
      </div>
    </PageShell>
  );
}
