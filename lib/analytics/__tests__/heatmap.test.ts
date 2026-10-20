import { test } from "node:test";
import assert from "node:assert/strict";

import { CHANGE_COLOR_STOPS, NO_DATA_COLOR, changeColor, formatMarketCap, groupedTreemap, squarify, type TreemapCell } from "../heatmap";

const area = (c: TreemapCell) => c.w * c.h;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/* ------------------------------------------------------------ squarify */

test("squarify: areas are proportional to value and fill the rectangle", () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ id: `s${i}`, value }));
  const rect = { x: 0, y: 0, w: 600, h: 400 };
  const cells = squarify(items, rect);
  assert.equal(cells.length, items.length);
  const total = items.reduce((s, i) => s + i.value, 0);
  for (const cell of cells) {
    const value = items.find((i) => i.id === cell.id)!.value;
    assert.ok(near(area(cell), (value / total) * 600 * 400, 1e-9), `${cell.id} area`);
  }
  assert.ok(near(cells.reduce((s, c) => s + area(c), 0), 600 * 400));
});

test("squarify: cells stay inside the rectangle and don't overlap", () => {
  const items = Array.from({ length: 70 }, (_, i) => ({ id: `s${i}`, value: 1 + ((i * 37) % 23) ** 2 }));
  const rect = { x: 10, y: 20, w: 375, h: 640 };
  const cells = squarify(items, rect);
  assert.equal(cells.length, 70);
  for (const c of cells) {
    assert.ok(c.x >= rect.x - 1e-6 && c.y >= rect.y - 1e-6);
    assert.ok(c.x + c.w <= rect.x + rect.w + 1e-6 && c.y + c.h <= rect.y + rect.h + 1e-6);
    assert.ok(c.w > 0 && c.h > 0);
  }
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      assert.ok(ox <= 1e-6 || oy <= 1e-6, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("squarify: keeps equal tiles roughly square", () => {
  const cells = squarify(Array.from({ length: 16 }, (_, i) => ({ id: `${i}`, value: 1 })), { x: 0, y: 0, w: 400, h: 400 });
  for (const c of cells) assert.ok(Math.max(c.w / c.h, c.h / c.w) < 2.5);
});

test("squarify: drops items with no positive, finite value and handles empty input", () => {
  const cells = squarify(
    [
      { id: "a", value: 10 },
      { id: "zero", value: 0 },
      { id: "neg", value: -5 },
      { id: "nan", value: NaN },
      { id: "inf", value: Infinity },
    ],
    { x: 0, y: 0, w: 100, h: 50 }
  );
  assert.deepEqual(cells, [{ id: "a", x: 0, y: 0, w: 100, h: 50 }]);
  assert.deepEqual(squarify([], { x: 0, y: 0, w: 100, h: 100 }), []);
  assert.deepEqual(squarify([{ id: "a", value: 1 }], { x: 0, y: 0, w: 0, h: 100 }), []);
});

test("squarify: largest value first", () => {
  const cells = squarify([{ id: "small", value: 1 }, { id: "big", value: 9 }], { x: 0, y: 0, w: 100, h: 100 });
  assert.equal(cells[0].id, "big");
});

test("groupedTreemap: groups sized by total, header strip only when there is room", () => {
  const groups = [
    { id: "a", label: "A", items: [{ id: "a1", value: 3 }, { id: "a2", value: 1 }] },
    { id: "b", label: "B", items: [{ id: "b1", value: 4 }] },
  ];
  const out = groupedTreemap(groups, { x: 0, y: 0, w: 800, h: 400 }, 18);
  assert.equal(out.length, 2);
  for (const g of out) {
    assert.ok(near(g.w * g.h, 800 * 400 * 0.5));
    assert.equal(g.header, 18);
    for (const c of g.cells) assert.ok(c.y >= g.y + 18 - 1e-6);
  }
  const tiny = groupedTreemap(groups, { x: 0, y: 0, w: 800, h: 40 }, 18);
  assert.ok(tiny.every((g) => g.header === 0));
});

/* ------------------------------------------------------------ colour */

test("changeColor: grey at zero, stop colours at ±1/2/3, capped beyond ±3", () => {
  for (const stop of CHANGE_COLOR_STOPS) assert.equal(changeColor(stop.at), stop.color);
  assert.equal(changeColor(0), "#414554");
  assert.equal(changeColor(12), changeColor(3));
  assert.equal(changeColor(-40), changeColor(-3));
});

test("changeColor: interpolates between stops and is monotonic in redness/greenness", () => {
  const green = (hex: string) => parseInt(hex.slice(3, 5), 16);
  const red = (hex: string) => parseInt(hex.slice(1, 3), 16);
  assert.ok(green(changeColor(0.5)) > green(changeColor(0)) && green(changeColor(0.5)) < green(changeColor(1)));
  assert.ok(red(changeColor(-2.5)) > red(changeColor(-1.5)));
  assert.match(changeColor(1.37), /^#[0-9a-f]{6}$/);
});

test("changeColor: no data gets the neutral no-data colour", () => {
  assert.equal(changeColor(null), NO_DATA_COLOR);
  assert.equal(changeColor(NaN), NO_DATA_COLOR);
});

/* ------------------------------------------------------------ format */

test("formatMarketCap: lakh crore for INR, T/B/M for USD, dash when unknown", () => {
  assert.equal(formatMarketCap(19.25e12, "INR"), "₹19.25L Cr");
  assert.equal(formatMarketCap(8_420e7, "INR"), "₹8,420 Cr");
  assert.equal(formatMarketCap(3.456e12, "USD"), "$3.46T");
  assert.equal(formatMarketCap(812.34e9, "USD"), "$812.3B");
  assert.equal(formatMarketCap(950e6, "USD"), "$950M");
  assert.equal(formatMarketCap(null, "USD"), "—");
  assert.equal(formatMarketCap(0, "INR"), "—");
});
