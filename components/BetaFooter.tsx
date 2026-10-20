import Link from "next/link";

/** Site-wide footer: beta status, the risk notice and where data comes from. */
export default function BetaFooter() {
  return (
    <footer className="mt-16 border-t border-[#1d1d1d] px-4 py-6 text-center text-xs leading-relaxed text-[#777] sm:px-6">
      <p>
        <span className="mr-2 rounded-full border border-[#eab308]/40 bg-[#eab308]/10 px-2 py-0.5 font-semibold text-[#facc15]">Private beta</span>
        Information only — not investment advice. Market data may be delayed or incomplete.{" "}
        <Link href="/beta" className="text-[#4ade80] hover:underline">
          Beta notice, risks &amp; privacy
        </Link>
      </p>
    </footer>
  );
}
