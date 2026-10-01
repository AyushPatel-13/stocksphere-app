"use client";

import { useMemo } from "react";

import { parseInline, parseMarkdown, type MdBlock } from "@/lib/agent/client/markdown";

/**
 * Renders an agent answer.
 *
 * Everything becomes React elements — there is no dangerouslySetInnerHTML and
 * no raw HTML path — so text arriving from a model (or from a news headline a
 * tool fed it) cannot become markup. Unknown syntax renders as plain text.
 */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, index) => {
        if (part.type === "bold") {
          return (
            <strong key={index} className="font-semibold text-white">
              {part.value}
            </strong>
          );
        }

        if (part.type === "code") {
          return (
            <code
              key={index}
              className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[12px] text-green-400"
            >
              {part.value}
            </code>
          );
        }

        return <span key={index}>{part.value}</span>;
      })}
    </>
  );
}

// The most content one column may be weighted by, in characters: a long URL in
// one cell should widen its column, not take the width the numbers beside it
// need.
const MAX_COLUMN_WEIGHT = 40;

/**
 * How a table divides its width between its columns, as fractions summing to 1.
 *
 * Every column is given half of an equal share, and the remaining half is handed
 * out in proportion to how much text the column holds. The equal half is a
 * floor: at 390px the cell padding alone is 16px, so a column narrower than that
 * can only spill, and a ragged row — a stray `|` inside a URL splits one cell
 * into two — would otherwise leave a five-character column too narrow to show
 * anything. The proportional half is what stops a comparison's first column,
 * which carries the metric names, being wrapped one fragment per line while the
 * columns of prices sit half empty.
 */
export function columnShares(rows: string[][], columns: number): number[] {
  const weights = Array.from({ length: columns }, (_, index) =>
    Math.min(
      MAX_COLUMN_WEIGHT,
      Math.max(1, ...rows.map((row) => (row[index] ?? "").length))
    )
  );

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const floor = 0.5 / columns;
  const proportional = 0.5 / totalWeight;

  return weights.map((weight) => floor + weight * proportional);
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-4 text-[17px] font-semibold text-white first:mt-0",
  2: "mt-4 text-[15px] font-semibold text-white first:mt-0",
  3: "mt-3 text-[14px] font-semibold text-white first:mt-0",
};

function Block({ block }: { block: MdBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <p className={HEADING_CLASS[block.level] ?? HEADING_CLASS[3]}>
          <Inline text={block.text} />
        </p>
      );

    case "paragraph":
      return (
        <p className="text-[13.5px] leading-relaxed text-gray-200">
          {block.lines.map((line, index) => (
            <span key={index}>
              {index > 0 && <br />}
              <Inline text={line} />
            </span>
          ))}
        </p>
      );

    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="pl-0.5">
          <Inline text={item} />
        </li>
      ));

      return block.ordered ? (
        <ol className="ml-4 list-decimal space-y-1.5 text-[13.5px] leading-relaxed text-gray-200">
          {items}
        </ol>
      ) : (
        <ul className="ml-4 list-disc space-y-1.5 text-[13.5px] leading-relaxed text-gray-200">
          {items}
        </ul>
      );
    }

    case "table": {
      // A comparison table is the widest thing an answer produces, and an
      // auto-laid-out table is never narrower than its content's minimum width:
      // one long cell ("Market-cap, EPS, dividend yield, 52-week high/low, ROE")
      // pushed the table past the card, and the container scrolled sideways
      // *inside* the answer — the horizontal scrollbar a comparison produced at
      // 390px.
      //
      // table-fixed replaces that content-derived width with the one we specify,
      // so `w-full` really is the message width and the columns share it.
      // break-words is what makes the long cells wrap inside their column rather
      // than spill out of it; without a break opportunity a single long symbol
      // or URL would still escape.
      //
      // The column count comes from the widest row, not just the header, because
      // a model-written table is sometimes ragged — the reader splits on every
      // `|`, so a URL in a cell becomes one more column.
      //
      // The scroll container stays as a last resort for anything that genuinely
      // cannot fit, so any overflow is confined to the table and never reaches
      // the panel or the page.
      const columns = Math.max(
        block.header.length,
        ...block.rows.map((row) => row.length),
        1
      );

      const shares = columnShares([block.header, ...block.rows], columns);

      return (
        <div className="overflow-x-auto rounded-lg border border-[#222]">
          <table className="w-full table-fixed border-collapse break-words text-[12.5px]">
            <colgroup>
              {shares.map((share, index) => (
                <col key={index} style={{ width: `${share * 100}%` }} />
              ))}
            </colgroup>

            <thead>
              <tr className="bg-[#161616]">
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-[#222] px-2 py-2 text-left font-semibold text-gray-300 sm:px-3"
                  >
                    <Inline text={cell} />
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-b border-[#1c1c1c] px-2 py-2 align-top text-gray-200 last:border-b-0 sm:px-3"
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-lg border border-[#222] bg-black/60 p-3 font-mono text-[12px] leading-relaxed text-green-400">
          <code>{block.text}</code>
        </pre>
      );
  }
}

export default function AgentMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
