import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_TOOLS, getToolByName } from "../index";

test("every registered tool has a unique name", () => {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
});

test("every registered tool exposes an object JSON schema with a symbol/query property", () => {
  for (const tool of AGENT_TOOLS) {
    assert.equal(tool.parameters.type, "object");
    assert.ok(tool.parameters.properties, `${tool.name} is missing properties`);
    assert.ok(typeof tool.description === "string" && tool.description.length > 0);
  }
});

test("getToolByName resolves a known tool", () => {
  assert.equal(getToolByName("get_price")?.name, "get_price");
});

test("getToolByName returns undefined for an unknown tool", () => {
  assert.equal(getToolByName("delete_everything"), undefined);
});

test("registry includes all six V1 tools", () => {
  const names = AGENT_TOOLS.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "get_company",
    "get_financials",
    "get_historical",
    "get_news",
    "get_price",
    "resolve_symbol",
  ]);
});
