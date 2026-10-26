"use client";

import { useId, useState } from "react";

import { StockAvatar } from "@/components/Markets/StockBits";
import SearchBox from "@/components/Search/SearchBox";
import { assetLabel, type InstrumentType, type Market, type SearchResult } from "@/lib/search/types";

/**
 * An instrument field for forms (Record a holding, New prediction, reminders):
 * the shared SearchBox in pick mode, then the picked instrument shown as a
 * card with "Change". A form only ever receives an instrument the search
 * found, never the raw text typed, so "SBI" can't be saved as a ticker.
 */

/** What the field shows once picked. A saved record may only know its symbol. */
export type PickedInstrument = {
  symbol: string;
  name: string;
  type?: InstrumentType;
  exchange?: string;
  market?: Market;
};

export function pickedFromResult(result: SearchResult, symbol: string = result.symbol): PickedInstrument {
  return { symbol, name: result.name, type: result.type, exchange: result.exchange, market: result.market };
}

export default function InstrumentField({
  label,
  value,
  onPick,
  onClear,
  filterTypes,
  market,
  placeholder = "Search a company or ticker…",
  error,
  inputId,
  autoFocus = false,
  className,
}: {
  label: string;
  value: PickedInstrument | null;
  onPick: (result: SearchResult) => void;
  onClear: () => void;
  filterTypes?: InstrumentType[];
  market?: Market;
  placeholder?: string;
  /** Validation message from the form; shown under the field. */
  error?: string | null;
  inputId?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const generated = useId();
  const id = inputId ?? `instrument-${generated}`;
  const errorId = `${id}-error`;
  // Focus the search again after "Change", not on the form's first render.
  const [refocus, setRefocus] = useState(false);

  return (
    <div className={className}>
      <label htmlFor={value ? undefined : id} className="mb-1.5 block text-xs font-medium text-[#888]">
        {label}
      </label>

      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2">
          <StockAvatar symbol={value.symbol} size={28} market={value.market} type={value.type} />
          <span className="min-w-0 flex-1">
            <span id={id} className="block truncate text-sm text-white">
              {value.name}
            </span>
            <span className="block truncate text-xs text-[#777]">
              <span className="font-mono text-[#bbb]">{value.symbol}</span>
              {value.exchange && ` · ${value.exchange}`}
              {value.type && value.market && ` · ${assetLabel({ type: value.type, market: value.market })}`}
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setRefocus(true);
              onClear();
            }}
            className="shrink-0 rounded-lg border border-[#2a2a2a] px-2.5 py-1 text-xs font-semibold text-[#ccc] hover:bg-[#1a1a1a] hover:text-white"
            aria-label={`Change ${label.toLowerCase()} (now ${value.symbol})`}
          >
            Change
          </button>
        </div>
      ) : (
        <SearchBox
          variant="compact"
          inputId={id}
          ariaLabel={label}
          placeholder={placeholder}
          filterTypes={filterTypes}
          market={market}
          autoFocus={autoFocus || refocus}
          invalid={Boolean(error)}
          describedBy={error ? errorId : undefined}
          onSelect={onPick}
        />
      )}

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-[#f87171]">
          {error}
        </p>
      )}
    </div>
  );
}
