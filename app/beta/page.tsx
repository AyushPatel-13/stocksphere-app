import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, PageShell } from "@/components/ui/Page";

export const metadata: Metadata = {
  title: "Beta notice, risks and privacy",
  description: "What StockSphere's private beta is, its known limitations, financial-risk notice and how your data is handled.",
};

/**
 * The private-beta notice every tester should read: what this is, what it
 * isn't, where data comes from and its limits, and what we store about them.
 * Plain statements only — no promises about returns or data accuracy.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-[#bbb]">{children}</div>
    </section>
  );
}

export default function BetaNoticePage() {
  return (
    <PageShell>
      <PageHeader eyebrow="Private beta" title="Before you use StockSphere" description="A short, plain-language notice for beta testers. Please read it once." />

      <div className="max-w-3xl space-y-5">
        <Section title="This is a private beta">
          <p>StockSphere is unfinished software shared with a small group of testers. Features may change, break or be removed, and data you create (watchlists, posts, predictions) may occasionally need to be reset during the beta.</p>
          <p>Please report anything that looks wrong — especially a price, chart or figure you believe is incorrect.</p>
        </Section>

        <Section title="Not investment advice">
          <p>Nothing on StockSphere — prices, charts, screens, backtests, community posts, prediction scores or AI answers — is investment, financial, tax or legal advice, or a recommendation to buy or sell anything.</p>
          <p>StockSphere is not registered with SEBI or any other regulator as an investment adviser or research analyst. Community posts are members&apos; personal opinions. Paper trading uses virtual money only.</p>
          <p>Investing involves risk, including loss of capital. Past performance — including backtests and prediction records — does not predict future results. Do your own research and consult a registered adviser before investing.</p>
        </Section>

        <Section title="Market data and its limits">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Prices come from Upstox (Indian markets), Yahoo Finance, Twelve Data, Alpha Vantage and Finnhub. They may be delayed, incomplete or occasionally wrong. Each page names its source and the time of the price where available.</li>
            <li>When the main Indian data feed is unavailable, prices fall back to Yahoo Finance and are labelled &ldquo;fallback, may be delayed&rdquo;.</li>
            <li>Missing figures are shown as &ldquo;N/A&rdquo; or &ldquo;Unavailable&rdquo; — StockSphere never fills gaps with estimates.</li>
            <li>Market cap is computed as price × shares outstanding; company descriptions may come from Wikipedia (CC BY-SA) and are credited.</li>
            <li>Do not use StockSphere for time-sensitive trading decisions.</li>
          </ul>
        </Section>

        <Section title="AI assistant">
          <p>The AI assistant answers from StockSphere&apos;s data tools and shows its sources, but AI can still misread or misstate information. Check important figures on the stock page. It never gives buy/sell advice. Your questions are sent to the AI provider (Groq) to generate answers; don&apos;t include personal or confidential information.</p>
        </Section>

        <Section title="Your data and privacy">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>You sign in with Google. We receive your name, email and profile picture from Google; your email is never shown publicly.</li>
            <li>We store what you create: your @handle and profile, watchlists, portfolio holdings, alerts, paper trades, posts, likes, reports and predictions. Profiles, posts and predictions are public; watchlists, holdings, alerts and paper trades are private to you.</li>
            <li>Data is stored in Supabase (database and sign-in). We don&apos;t sell your data or show ads.</li>
            <li>To delete your account and data, or to ask what we hold about you, contact the StockSphere team; we&apos;ll act on it during the beta.</li>
          </ul>
        </Section>

        <Section title="Community rules">
          <p>Share views and reasoning, not tips for sale. No promotion of Telegram/WhatsApp groups, paid calls, &ldquo;sure-shot&rdquo; or guaranteed-return claims, phone numbers, spam or abuse. Moderators can hide posts that break these rules.</p>
        </Section>

        <p className="text-sm text-[#888]">
          By using StockSphere during the beta you accept these terms. <Link href="/" className="text-[#4ade80] hover:underline">Back to StockSphere →</Link>
        </p>
      </div>
    </PageShell>
  );
}
