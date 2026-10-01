import { test } from "node:test";
import assert from "node:assert/strict";

import { parseInline, parseMarkdown } from "@/lib/agent/client/markdown";

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

test("plain text is a single run", () => {
  assert.deepEqual(parseInline("just words"), [
    { type: "text", value: "just words" },
  ]);
});

test("bold and code are split out of the surrounding text", () => {
  assert.deepEqual(parseInline("**Current Price:** ₹2,054.00"), [
    { type: "bold", value: "Current Price:" },
    { type: "text", value: " ₹2,054.00" },
  ]);

  assert.deepEqual(parseInline("fetch from `get_price` now"), [
    { type: "text", value: "fetch from " },
    { type: "code", value: "get_price" },
    { type: "text", value: " now" },
  ]);
});

test("an unbalanced marker stays literal instead of swallowing the answer", () => {
  const runs = parseInline("**unclosed and then some text");

  assert.deepEqual(runs, [
    { type: "text", value: "**unclosed and then some text" },
  ]);
});

test("markers do not span a newline", () => {
  const runs = parseInline("**start\nend**");

  assert.deepEqual(runs, [{ type: "text", value: "**start\nend**" }]);
});

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

test("headings are recognised and deeper levels are clamped", () => {
  assert.deepEqual(parseMarkdown("### TCS Overview"), [
    { type: "heading", level: 3, text: "TCS Overview" },
  ]);

  assert.deepEqual(parseMarkdown("# One\n\n###### Six"), [
    { type: "heading", level: 1, text: "One" },
    { type: "heading", level: 3, text: "Six" },
  ]);
});

test("a hash without a space is not a heading", () => {
  assert.deepEqual(parseMarkdown("#NotAHeading"), [
    { type: "paragraph", lines: ["#NotAHeading"] },
  ]);
});

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

test("consecutive lines stay separate lines rather than running together", () => {
  // The agent's metric blocks are written exactly this way.
  const blocks = parseMarkdown("**Market Cap:** ₹7.4T\n**P/E:** 28.4");

  assert.deepEqual(blocks, [
    {
      type: "paragraph",
      lines: ["**Market Cap:** ₹7.4T", "**P/E:** 28.4"],
    },
  ]);
});

test("a blank line separates paragraphs", () => {
  assert.deepEqual(parseMarkdown("one\n\ntwo"), [
    { type: "paragraph", lines: ["one"] },
    { type: "paragraph", lines: ["two"] },
  ]);
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

test("bullet lists are grouped", () => {
  assert.deepEqual(parseMarkdown("- alpha\n- beta\n- gamma"), [
    { type: "list", ordered: false, items: ["alpha", "beta", "gamma"] },
  ]);
});

test("numbered lists are grouped and kept ordered", () => {
  assert.deepEqual(parseMarkdown("1. first\n2. second"), [
    { type: "list", ordered: true, items: ["first", "second"] },
  ]);
});

test("a bullet list and a numbered list do not merge", () => {
  const blocks = parseMarkdown("- bullet\n1. number");

  assert.deepEqual(blocks, [
    { type: "list", ordered: false, items: ["bullet"] },
    { type: "list", ordered: true, items: ["number"] },
  ]);
});

test("a list ends at a blank line", () => {
  const blocks = parseMarkdown("- one\n\ntrailing prose");

  assert.deepEqual(blocks, [
    { type: "list", ordered: false, items: ["one"] },
    { type: "paragraph", lines: ["trailing prose"] },
  ]);
});

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

test("a table needs a separator row to be a table", () => {
  assert.deepEqual(
    parseMarkdown("| Metric | Value |\n| --- | --- |\n| P/E | 28.4 |\n| EPS | 132.1 |"),
    [
      {
        type: "table",
        header: ["Metric", "Value"],
        rows: [
          ["P/E", "28.4"],
          ["EPS", "132.1"],
        ],
      },
    ]
  );
});

test("pipes without a separator row are ordinary prose", () => {
  assert.deepEqual(parseMarkdown("| not | a | table |"), [
    { type: "paragraph", lines: ["| not | a | table |"] },
  ]);
});

test("alignment markers in the separator are accepted", () => {
  const blocks = parseMarkdown("| a | b |\n|:--|--:|\n| 1 | 2 |");

  assert.equal(blocks[0].type, "table");
});

test("a table ends at the first non-row line", () => {
  const blocks = parseMarkdown("| a |\n| --- |\n| 1 |\nafter");

  assert.deepEqual(blocks[0], {
    type: "table",
    header: ["a"],
    rows: [["1"]],
  });
  assert.deepEqual(blocks[1], { type: "paragraph", lines: ["after"] });
});

// ---------------------------------------------------------------------------
// Code fences
// ---------------------------------------------------------------------------

test("a fenced block is literal, blank lines and all", () => {
  assert.deepEqual(parseMarkdown("```\nline one\n\nline two\n```"), [
    { type: "code", text: "line one\n\nline two" },
  ]);
});

test("markdown inside a fence is not parsed", () => {
  assert.deepEqual(parseMarkdown("```\n# not a heading\n**not bold**\n```"), [
    { type: "code", text: "# not a heading\n**not bold**" },
  ]);
});

test("an unterminated fence still yields its content", () => {
  assert.deepEqual(parseMarkdown("```\ndangling"), [
    { type: "code", text: "dangling" },
  ]);
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

test("empty and whitespace-only answers produce no blocks", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\n\n   \n"), []);
});

test("CRLF answers parse the same as LF", () => {
  assert.deepEqual(parseMarkdown("### Title\r\n\r\nbody"), [
    { type: "heading", level: 3, text: "Title" },
    { type: "paragraph", lines: ["body"] },
  ]);
});

test("an answer with no markdown at all is one paragraph", () => {
  assert.deepEqual(parseMarkdown("TCS is a consultancy."), [
    { type: "paragraph", lines: ["TCS is a consultancy."] },
  ]);
});

test("the whole spec example parses into the expected shape", () => {
  const blocks = parseMarkdown(
    [
      "### TCS Overview",
      "",
      "**Current Price:** ₹2,054.00",
      "**Market Cap:** ₹7.4T",
      "**P/E:** 28.4",
      "",
      "Then explanatory text.",
    ].join("\n")
  );

  assert.deepEqual(blocks, [
    { type: "heading", level: 3, text: "TCS Overview" },
    {
      type: "paragraph",
      lines: [
        "**Current Price:** ₹2,054.00",
        "**Market Cap:** ₹7.4T",
        "**P/E:** 28.4",
      ],
    },
    { type: "paragraph", lines: ["Then explanatory text."] },
  ]);
});
