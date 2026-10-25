import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { navigation } from "../navigation";

test("the navbar links to Commodities right after the other asset classes", () => {
  const hrefs = navigation.map((item) => item.href);
  assert.equal(navigation.find((item) => item.label === "Commodities")?.href, "/commodities");
  assert.equal(hrefs.indexOf("/commodities"), hrefs.indexOf("/bonds") + 1);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("every navbar link points at a page that exists", () => {
  for (const { href } of navigation) {
    assert.ok(existsSync(join(process.cwd(), "app", href.slice(1), "page.tsx")), `${href} has no app${href}/page.tsx`);
  }
  assert.ok(existsSync(join(process.cwd(), "app", "commodities", "[symbol]", "page.tsx")));
});
