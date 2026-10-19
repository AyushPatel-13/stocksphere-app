import type { ReactNode } from "react";

/**
 * Shared page primitives.
 *
 * The polished pages (Home, Stock, Portfolio, Indices) all use the same look:
 * a black page, one centred 1080px column, #111 cards on #222 borders, #888
 * muted text and #22c55e for gains and accents. These components carry that
 * look so the simpler pages cannot drift from it.
 *
 * The navbar lives in the root layout and renders 65px (64px plus its 1px
 * border), which is why the shell subtracts 65.
 */

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-[calc(100vh_-_65px)] bg-black text-white">
      <div className="mx-auto w-full max-w-[1080px] px-4 pb-24 pt-8 sm:px-6 sm:pt-10 lg:px-8">
        {children}
      </div>
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#22c55e]">
            {eyebrow}
          </p>
        )}

        <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">
          {title}
        </h1>

        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#888] sm:text-[15px]">
            {description}
          </p>
        )}
      </div>

      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div" | "li";
}) {
  return (
    <Tag
      className={`rounded-2xl border border-[#222] bg-[#111] p-5 ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 mt-10 flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {aside && <span className="text-xs text-[#777]">{aside}</span>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0b0b0b] px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[#262626] bg-[#151515] text-xl">
          {icon}
        </div>
      )}

      <p className="font-semibold text-white">{title}</p>

      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[#777]">
          {description}
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "up" | "down";
}) {
  const valueColor =
    tone === "up"
      ? "text-[#4ade80]"
      : tone === "down"
        ? "text-[#f87171]"
        : "text-white";

  return (
    <div className="rounded-2xl border border-[#222] bg-[#111] p-4 sm:p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#777]">
        {label}
      </p>
      <p className={`mt-2 text-xl font-semibold tracking-tight sm:text-2xl ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * A quiet one-line notice, e.g. "saved on this device only". Used wherever a
 * page's data has a limit the user should know about.
 */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#2a2a2a] bg-[#151515] px-4 py-3 text-[13px] leading-relaxed text-[#8a8a8a]">
      <span aria-hidden="true" className="mt-px text-[#666]">
        ⓘ
      </span>
      <span>{children}</span>
    </p>
  );
}

export const inputClass =
  "w-full rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5 text-sm text-white placeholder:text-[#666] outline-none transition-colors focus:border-[#22c55e]/70 focus-visible:ring-2 focus-visible:ring-[#22c55e]/25";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#22c55e] px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#2a2a2a] bg-[#151515] px-3.5 py-2 text-sm font-medium text-[#e5e5e5] transition-colors hover:border-[#3a3a3a] hover:bg-[#1c1c1c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40";
