/**
 * A very small markdown reader for agent answers.
 *
 * The project has no markdown dependency (package.json carries none), and the
 * agent's answers only ever use a narrow slice of the syntax — headings, bold,
 * bullets, numbered steps, short tables and the occasional code-ish token. That
 * slice is small enough to parse here rather than pull in a parser and its
 * transitive tree for one panel.
 *
 * This is a parser, not a renderer: it returns a plain data structure, so it can
 * be unit-tested without a DOM and rendered to React elements without ever
 * touching innerHTML. Nothing in an agent answer is interpreted as markup.
 *
 * Deliberately unsupported: links, images, nested lists, blockquotes, setext
 * headings. Unrecognised syntax degrades to literal text, which is the safe
 * direction to fail.
 */

export type MdInline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "code"; value: string };

export type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; text: string };

const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const BULLET_PATTERN = /^[-*+]\s+(.*)$/;
const ORDERED_PATTERN = /^\d+[.)]\s+(.*)$/;
const FENCE_PATTERN = /^\s*```/;

/**
 * Split a line into text / bold / code runs.
 *
 * Bold and code are matched before anything else, and neither may span a
 * newline, so an unbalanced `**` in the middle of a paragraph stays literal
 * text instead of swallowing the rest of the answer.
 */
export function parseInline(text: string): MdInline[] {
  const parts: MdInline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;

    if (index > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, index) });
    }

    const token = match[0];
    parts.push(
      token.startsWith("**")
        ? { type: "bold", value: token.slice(2, -2) }
        : { type: "code", value: token.slice(1, -1) }
    );

    cursor = index + token.length;
  }

  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }

  return parts;
}

/** A table row: `| a | b |` -> ["a", "b"], tolerating a missing outer pipe. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** `| --- | :--: |` — the row that turns the line above it into a header. */
function isTableSeparator(line: string): boolean {
  if (!line.includes("-")) return false;

  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inside a fence everything is literal, including blank lines.
    if (fence !== null) {
      if (FENCE_PATTERN.test(line)) {
        blocks.push({ type: "code", text: fence.join("\n") });
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }

    if (FENCE_PATTERN.test(line)) {
      flushAll();
      fence = [];
      continue;
    }

    if (line.trim() === "") {
      flushAll();
      continue;
    }

    // A table is only a table when the row under it is a separator; otherwise
    // the pipes are just characters in a sentence.
    if (isTableRow(line) && isTableSeparator(lines[i + 1] ?? "")) {
      flushAll();

      const header = splitRow(line);
      const rows: string[][] = [];
      let cursor = i + 2;

      while (cursor < lines.length && isTableRow(lines[cursor])) {
        rows.push(splitRow(lines[cursor]));
        cursor++;
      }

      blocks.push({ type: "table", header, rows });
      i = cursor - 1;
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      flushAll();
      blocks.push({
        type: "heading",
        // Anything deeper than h3 renders at the same size in the panel, so
        // the level is clamped rather than carried through unused.
        level: Math.min(heading[1].length, 3),
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = line.match(BULLET_PATTERN);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    const ordered = line.match(ORDERED_PATTERN);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1].trim());
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  // An unterminated fence still has content worth showing.
  if (fence !== null) {
    blocks.push({ type: "code", text: fence.join("\n") });
  }

  flushAll();

  return blocks;
}
