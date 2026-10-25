"use client";

import Link from "next/link";

import { safeLink, type AgentLink } from "@/lib/agent/links";

/**
 * The pages and sources that go with an answer. Every link is checked again
 * here with the same rules the server used (safeLink): an unknown internal
 * path or an unsafe external URL is simply not rendered. StockSphere pages
 * open in place; external sources open in a new tab.
 */
export default function AgentLinks({ links }: { links: AgentLink[] }) {
  // News articles are the only external links allowed beyond official hosts;
  // they arrive from the server already limited to https.
  const safe = links.map((link) => safeLink(link, { allowArticles: true })).filter((l): l is AgentLink => l !== null);
  if (safe.length === 0) return null;

  const primary = safe.filter((l) => l.primary);
  const rest = safe.filter((l) => !l.primary);

  return (
    <nav aria-label="Related pages and sources" className="mt-3 space-y-2 border-t border-[#222] pt-3">
      {primary.map((link) => (
        <div key={link.href}>
          <LinkItem link={link} className="inline-flex items-center gap-1.5 rounded-lg bg-[#22c55e] px-3 py-1.5 text-[12.5px] font-semibold text-black transition hover:bg-[#4ade80] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141414]" />
          {link.note && <p className="mt-1 text-[11px] leading-relaxed text-[#888]">{link.note}</p>}
        </div>
      ))}

      {rest.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {rest.map((link) => (
            <li key={link.href} className="max-w-full">
              <LinkItem
                link={link}
                title={link.note}
                className="inline-flex max-w-full items-center gap-1 truncate rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-2.5 py-1 text-[11.5px] text-[#ddd] transition hover:border-[#22c55e]/50 hover:text-[#4ade80] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#22c55e]/40"
              />
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function LinkItem({ link, className, title }: { link: AgentLink; className: string; title?: string }) {
  if (link.kind === "internal") {
    return (
      <Link href={link.href} className={className} title={title}>
        <span className="truncate">{link.label}</span>
        <span aria-hidden="true">→</span>
      </Link>
    );
  }
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer nofollow" className={className} title={title}>
      <span className="truncate">{link.label}</span>
      <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
