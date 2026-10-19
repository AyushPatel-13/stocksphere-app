import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  RESERVED_HANDLES,
  handleProblem,
  normaliseHandle,
  suggestHandle,
} from "../handle";

test("valid handles pass, and input is normalised the way it is stored", () => {
  assert.equal(handleProblem("ayush_patel"), null);
  assert.equal(handleProblem("@Ayush_Patel"), null);
  assert.equal(normaliseHandle("  @Ayush "), "ayush");
  assert.equal(handleProblem("abc"), null);
  assert.equal(handleProblem("a".repeat(20)), null);
});

test("invalid handles get a specific message", () => {
  assert.match(handleProblem("ab")!, /at least 3/);
  assert.match(handleProblem("a".repeat(21))!, /at most 20/);
  assert.match(handleProblem("1trader")!, /Start with a letter/);
  assert.match(handleProblem("_trader")!, /Start with a letter/);
  assert.match(handleProblem("big bull")!, /letters, numbers and underscores/);
  assert.match(handleProblem("bull.run")!, /letters, numbers and underscores/);
});

test("handles that impersonate the platform, exchanges or regulators are reserved", () => {
  for (const handle of ["sebi", "NSE", "@StockSphere", "admin", "zerodha"]) {
    assert.match(handleProblem(handle)!, /reserved/, handle);
  }
});

test("suggestions from a Google name are always valid or empty", () => {
  assert.equal(suggestHandle("Ayush Patel"), "ayush_patel");
  assert.equal(suggestHandle("José Núñez"), "jose_nunez");
  assert.equal(suggestHandle("123 Traders"), "traders");
  assert.equal(suggestHandle("Al"), "");
  assert.equal(suggestHandle(null), "");
  assert.equal(suggestHandle("Admin"), "");
  assert.equal(handleProblem(suggestHandle("A Very Long Name That Goes On And On")), null);
});

test("drift guard: the app's reserved list matches the database migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20261019000100_profiles.sql"),
    "utf8"
  );
  const block = sql.match(/array\[([\s\S]*?)\]/);
  assert.ok(block, "reserved array not found in migration");

  const fromSql = new Set(
    Array.from(block[1].matchAll(/'([a-z0-9_]+)'/g), (match) => match[1])
  );

  assert.deepEqual([...fromSql].sort(), [...RESERVED_HANDLES].sort());
});
