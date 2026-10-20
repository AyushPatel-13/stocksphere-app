import { test } from "node:test";
import assert from "node:assert/strict";

import { checkAlertInput, describeAlert, evaluateAlert } from "../rules";
import { alertLink, checkAlerts, type ActiveAlert, type AlertStore, type NotificationRow } from "../service";
import { POST } from "@/app/api/alerts/check/route";

test("price alerts trigger at or beyond their level; missing prices never trigger", () => {
  assert.deepEqual(evaluateAlert({ condition: "above", threshold: 100 }, { price: 100, changePercent: null }), { triggered: true, value: 100 });
  assert.equal(evaluateAlert({ condition: "above", threshold: 100 }, { price: 99.99, changePercent: null }).triggered, false);
  assert.equal(evaluateAlert({ condition: "below", threshold: 100 }, { price: 95, changePercent: null }).triggered, true);
  assert.equal(evaluateAlert({ condition: "below", threshold: 100 }, { price: null, changePercent: -50 }).triggered, false);
  assert.equal(evaluateAlert({ condition: "above", threshold: 1 }, { price: 0, changePercent: null }).triggered, false);
});

test("day-move alerts read the day's percentage change", () => {
  assert.equal(evaluateAlert({ condition: "day_up", threshold: 3 }, { price: 1, changePercent: 3.2 }).triggered, true);
  assert.equal(evaluateAlert({ condition: "day_up", threshold: 3 }, { price: 1, changePercent: 2.9 }).triggered, false);
  assert.equal(evaluateAlert({ condition: "day_down", threshold: 3 }, { price: 1, changePercent: -3 }).triggered, true);
  assert.equal(evaluateAlert({ condition: "day_down", threshold: 3 }, { price: 1, changePercent: 3 }).triggered, false);
  assert.equal(evaluateAlert({ condition: "day_down", threshold: 3 }, { price: 1, changePercent: null }).triggered, false);
});

test("alert input is validated, and an alert that's already true is refused", () => {
  const ok = checkAlertInput({ symbol: " tcs ", condition: "above", threshold: "2600", currentPrice: 2460 });
  assert.deepEqual(ok.ok && ok.value, { assetType: "stock", symbol: "TCS", condition: "above", threshold: 2600, note: null });

  const reason = (raw: Parameters<typeof checkAlertInput>[0]) => {
    const r = checkAlertInput(raw);
    return r.ok ? null : r.reason;
  };
  assert.match(reason({ symbol: "TCS", condition: "above", threshold: "2400", currentPrice: 2460 })!, /higher/);
  assert.match(reason({ symbol: "TCS", condition: "below", threshold: "2500", currentPrice: 2460 })!, /lower/);
  assert.match(reason({ symbol: "TCS", condition: "day_up", threshold: "150" })!, /100%/);
  assert.match(reason({ symbol: "TCS", condition: "above", threshold: "-1" })!, /positive/);
  assert.match(reason({ symbol: "<x>", condition: "above", threshold: "1" })!, /Pick/);
  assert.match(reason({ symbol: "TCS", condition: "sideways", threshold: "1" })!, /condition/);
  assert.match(reason({ symbol: "TCS", assetType: "bond", condition: "above", threshold: "1" })!, /asset/);

  assert.equal(describeAlert({ symbol: "TCS", condition: "day_down", threshold: 2 }), "TCS is down 2% on the day");
  assert.equal(alertLink("index", "NIFTY"), "/asset/index/NIFTY");
});

function fakeStore(alerts: ActiveAlert[], alreadyTriggered = new Set<string>()) {
  const notified: NotificationRow[] = [];
  const triggered: string[] = [];
  const touched: string[] = [];
  const store: AlertStore = {
    active: async () => alerts,
    trigger: async (id) => {
      if (alreadyTriggered.has(id)) return false;
      alreadyTriggered.add(id);
      triggered.push(id);
      return true;
    },
    touch: async (ids) => {
      touched.push(...ids);
    },
    notify: async (row) => {
      notified.push(row);
    },
  };
  return { store, notified, triggered, touched };
}

const alerts: ActiveAlert[] = [
  { id: "a1", userId: "u1", assetType: "stock", symbol: "TCS", condition: "above", threshold: 2400 },
  { id: "a2", userId: "u2", assetType: "stock", symbol: "TCS", condition: "below", threshold: 2000 },
  { id: "a3", userId: "u1", assetType: "index", symbol: "NIFTY", condition: "day_down", threshold: 1 },
  { id: "a4", userId: "u3", assetType: "stock", symbol: "GONE", condition: "above", threshold: 1 },
];

test("the checker prices each symbol once, triggers matching alerts and notifies their owners", async () => {
  const { store, notified, triggered, touched } = fakeStore(alerts);
  const priced: string[] = [];
  const result = await checkAlerts(store, async (type, symbol) => {
    priced.push(`${type}:${symbol}`);
    if (symbol === "GONE") return null;
    return symbol === "TCS" ? { price: 2460, changePercent: -0.2 } : { price: 22888, changePercent: -1.11 };
  });

  assert.deepEqual(result, { checked: 4, triggered: 2, unpriced: 1 });
  assert.deepEqual(priced.sort(), ["index:NIFTY", "stock:GONE", "stock:TCS"]);
  assert.deepEqual(triggered, ["a1", "a3"]);
  assert.deepEqual(notified.map((n) => [n.user_id, n.link]), [["u1", "/stock/TCS"], ["u1", "/asset/index/NIFTY"]]);
  assert.match(notified[0].body, /may be delayed/);
  assert.deepEqual(touched.sort(), ["a1", "a2", "a3", "a4"]);
});

test("an alert another run already triggered isn't notified twice", async () => {
  const { store, notified } = fakeStore(alerts.slice(0, 1), new Set(["a1"]));
  const result = await checkAlerts(store, async () => ({ price: 2460, changePercent: 0 }));
  assert.equal(result.triggered, 0);
  assert.equal(notified.length, 0);
});

test("POST /api/alerts/check needs the cron secret", async () => {
  const { store } = fakeStore([]);
  const quotes = async () => null;
  assert.equal((await POST(new Request("http://x", { method: "POST" }), undefined, store, quotes, undefined)).status, 401);
  assert.equal((await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer no" } }), undefined, store, quotes, "s")).status, 401);
  assert.equal((await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer s" } }), undefined, null, quotes, "s")).status, 503);
  const ok = await POST(new Request("http://x", { method: "POST", headers: { Authorization: "Bearer s" } }), undefined, store, quotes, "s");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { success: true, checked: 0, triggered: 0, unpriced: 0 });
});
