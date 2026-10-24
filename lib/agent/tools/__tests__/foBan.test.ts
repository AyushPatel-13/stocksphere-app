import { test } from "node:test";
import assert from "node:assert/strict";

import { FO_BAN_URL, clearFoBanCache, getFoBanList, parseFoBanCsv } from "@/lib/apis/nseFoBan";
import { createFoBanTool } from "../foBanTool";
import { glossaryTool, matchTerm } from "../glossaryTool";

const SAMPLE = "Securities in Ban For Trade Date 26-OCT-2026:\n1,AMBUJACEM\n2,KAYNES\n3,SAIL\n";

test("NSE's ban file is parsed into a trade date and symbols", () => {
  assert.deepEqual(parseFoBanCsv(SAMPLE), { tradeDate: "2026-10-26", securities: ["AMBUJACEM", "KAYNES", "SAIL"] });
  assert.deepEqual(parseFoBanCsv("Securities in Ban For Trade Date 27-OCT-2026:\n"), { tradeDate: "2026-10-27", securities: [] });
});

test("a file in an unexpected shape gives null, never a guessed list", () => {
  assert.equal(parseFoBanCsv("<html>Access denied</html>"), null);
  assert.equal(parseFoBanCsv("Securities in Ban For Trade Date 26-OCT-2026:\nsomething odd here"), null);
  assert.equal(parseFoBanCsv(""), null);
});

test("the list is fetched from NSE's file; a failed fetch gives null", async () => {
  clearFoBanCache();
  const urls: string[] = [];
  const ok = (async (url: string) => {
    urls.push(String(url));
    return new Response(SAMPLE, { status: 200 });
  }) as unknown as typeof fetch;
  const list = await getFoBanList(ok, () => 0);
  assert.deepEqual(list, { tradeDate: "2026-10-26", securities: ["AMBUJACEM", "KAYNES", "SAIL"], sourceUrl: FO_BAN_URL });
  assert.deepEqual(urls, [FO_BAN_URL]);

  clearFoBanCache();
  const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  assert.equal(await getFoBanList(down, () => 0), null);
  clearFoBanCache();
});

test("regression: 'Which stocks are currently in the F&O ban list?' — the tool returns NSE's list with its date and source", async () => {
  const tool = createFoBanTool(async () => ({ tradeDate: "2026-10-26", securities: ["SAIL"], sourceUrl: FO_BAN_URL }));
  const result = await tool.execute({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { tradeDate: "2026-10-26", securities: ["SAIL"], sourceUrl: FO_BAN_URL, count: 1 });
  assert.match(result.source, /NSE/);
});

test("regression: when NSE can't be reached, the ban-list tool reports unavailable instead of an empty list", async () => {
  const result = await createFoBanTool(async () => null).execute({});
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
});

test("regression: the glossary accepts natural wording for the F&O ban", async () => {
  for (const term of ["fo_ban", "F&O ban", "f&o ban period", "FnO ban", "F and O ban", "futures & options ban", "MWPL", "ban list"]) {
    assert.equal(matchTerm(term), "fo_ban", term);
  }
  const result = await glossaryTool.execute({ term: "F&O ban" });
  assert.equal(result.ok, true);
  assert.match(JSON.stringify(result.data), /"found":true[\s\S]*95% of its market-wide position limit/);
});

test("an unknown term is a successful 'not in glossary' with guidance, not a failure", async () => {
  const result = await glossaryTool.execute({ term: "price to earnings ratio" });
  assert.equal(result.ok, true);
  assert.match(JSON.stringify(result.data), /"found":false[\s\S]*general knowledge/);
  assert.equal(matchTerm("dividend yield"), null);
});

test("extra arguments a model adds to the ban-list tool are ignored, not rejected", () => {
  assert.equal(createFoBanTool(async () => null).argsSchema.safeParse({ date: "today" }).success, true);
});
