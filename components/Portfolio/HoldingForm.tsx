"use client";

import { useState } from "react";

import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import { addHolding, updateHolding } from "@/lib/portfolio";
import { isValidSymbol } from "@/lib/validation/symbol";

/**
 * Record a holding the user already owns, or correct one. Shared by Portfolio
 * and the stock page. This only writes the user's own portfolio record: it
 * never places an order, real or simulated, and says so.
 */
export default function HoldingForm({
  editing,
  fixedSymbol,
  onSaved,
  onCancel,
  compact = false,
}: {
  /** The record being corrected; omitted to add a new one. */
  editing?: { id: string; symbol: string; quantity: number; avgPrice: number };
  /** On a stock page the symbol is that stock's and can't be changed. */
  fixedSymbol?: string;
  onSaved: () => Promise<void> | void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [symbol, setSymbol] = useState(editing?.symbol ?? fixedSymbol ?? "");
  const [quantity, setQuantity] = useState(editing ? String(editing.quantity) : "");
  const [price, setPrice] = useState(editing ? String(editing.avgPrice) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const symbolLocked = Boolean(editing || fixedSymbol);

  async function save() {
    const cleanSymbol = symbol.trim().toUpperCase();
    const qty = Number(quantity);
    const avg = Number(price);

    // The form refuses a holding that could never be valued correctly.
    if (!cleanSymbol || !isValidSymbol(cleanSymbol)) {
      setError("Enter a valid stock symbol, e.g. TCS or AAPL.");
      return;
    }
    if (quantity.trim() === "" || !Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a number greater than 0.");
      return;
    }
    if (price.trim() === "" || !Number.isFinite(avg) || avg <= 0) {
      setError("Average buy price must be a number greater than 0.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = editing ? await updateHolding(editing.id, qty, avg) : await addHolding(cleanSymbol, qty, avg);

      if (!result || result.error) {
        setError("Couldn't save this holding. Please check you're signed in and try again.");
        return;
      }

      await onSaved();
    } catch {
      setError("Couldn't save this holding. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const id = editing ? `holding-${editing.id}` : "holding-new";

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      aria-label={editing ? `Edit ${editing.symbol} holding` : "Record a holding"}
    >
      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-3"}`}>
        {!(compact && symbolLocked) && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[#888]">Symbol</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="TCS"
              autoCapitalize="characters"
              autoFocus={!symbolLocked}
              readOnly={symbolLocked}
              className={`${inputClass} ${symbolLocked ? "cursor-not-allowed text-[#999]" : ""}`}
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#888]">Quantity</span>
          <input
            id={`${id}-qty`}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="10"
            inputMode="decimal"
            autoFocus={symbolLocked && !compact}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#888]">Avg. buy price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="3500"
            inputMode="decimal"
            className={inputClass}
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-[#f87171]">
          {error}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-[#666]">
        This records a holding you already own elsewhere. It doesn&apos;t buy or sell anything.
      </p>

      <div className={`mt-3 flex gap-2 ${compact ? "" : "justify-end"}`}>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`${secondaryButtonClass} ${compact ? "flex-1" : ""}`}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={saving} className={`${primaryButtonClass} ${compact ? "flex-1" : ""}`}>
          {saving ? "Saving…" : editing ? "Save changes" : "Save holding"}
        </button>
      </div>
    </form>
  );
}
