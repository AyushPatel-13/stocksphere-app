import { test } from "node:test";
import assert from "node:assert/strict";

import { EMPTY_CRITERIA } from "@/lib/analytics/screener";
import { MAX_SAVED_SCREENS, SAVED_KEY, cleanScreenName, loadScreens, readDevice, removeScreen, saveScreen, type AccountScreens, type DeviceStorage } from "../savedScreens";

/** Saved screens: with the account when there is one, in the browser otherwise, never trusted as stored. */

function device(initial?: unknown): DeviceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[SAVED_KEY, JSON.stringify(initial)]]);
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

/** An account store, as the saved_screens table behaves: one screen per name (any case), ten at most. */
function account(rows: { name: string; criteria: unknown }[] = []): AccountScreens & { rows: typeof rows } {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return {
    rows,
    list: async () => [...rows],
    save: async (name, criteria) => {
      const i = rows.findIndex((r) => same(r.name, name));
      if (i >= 0) rows[i] = { name, criteria };
      else if (rows.length >= 10) return "full";
      else rows.unshift({ name, criteria });
      return "saved";
    },
    remove: async (name) => {
      const i = rows.findIndex((r) => same(r.name, name));
      if (i >= 0) rows.splice(i, 1);
      return "removed";
    },
  };
}

const signedOut: AccountScreens = { list: async () => "unavailable", save: async () => "unavailable", remove: async () => "unavailable" };
const lowPe = { ...EMPTY_CRITERIA, maxPe: 15 };

test("a signed-in member's screens are kept with the account and follow them; the browser isn't touched", async () => {
  const acct = account();
  const laptop = device();
  const saved = await saveScreen("  Low   P/E ", lowPe, acct, laptop);
  assert.deepEqual(saved, { ok: true, saved: { where: "account", screens: [{ name: "Low P/E", criteria: lowPe }] } });
  assert.equal(laptop.data.size, 0);

  // Another device, same account: the screen is there.
  assert.deepEqual(await loadScreens(acct, device()), { where: "account", screens: [{ name: "Low P/E", criteria: lowPe }] });

  // Saving under the same name (any case) replaces it; removing it frees the name.
  await saveScreen("low p/e", { ...EMPTY_CRITERIA, maxPe: 10 }, acct, laptop);
  assert.deepEqual(acct.rows.map((r) => [r.name, (r.criteria as { maxPe: number }).maxPe]), [["low p/e", 10]]);
  assert.deepEqual((await removeScreen("LOW P/E", acct, laptop)).screens, []);
});

test("signed out, or before the table exists, screens are kept in this browser and say so", async () => {
  const phone = device();
  const first = await saveScreen("Gainers", { ...EMPTY_CRITERIA, minChangePct: 1 }, signedOut, phone);
  assert.deepEqual(first, { ok: true, saved: { where: "device", screens: [{ name: "Gainers", criteria: { ...EMPTY_CRITERIA, minChangePct: 1 } }] } });
  await saveScreen("Low P/E", lowPe, signedOut, phone);
  assert.deepEqual((await loadScreens(signedOut, phone)).screens.map((s) => s.name), ["Low P/E", "Gainers"]);
  assert.deepEqual((await removeScreen("gainers", signedOut, phone)).screens.map((s) => s.name), ["Low P/E"]);
  // An account store that throws is the same as none: nothing is lost.
  const broken: AccountScreens = { list: async () => Promise.reject(new Error("x")), save: async () => Promise.reject(new Error("x")), remove: async () => Promise.reject(new Error("x")) };
  assert.equal((await loadScreens(broken, phone)).where, "device");
  assert.equal((await saveScreen("Third", lowPe, broken, phone)).ok, true);
  // No storage at all (private mode): saving still answers, it just won't persist.
  assert.deepEqual(await loadScreens(signedOut, null), { where: "device", screens: [] });
});

test("ten screens at most, a real name, and nothing read from storage is trusted", async () => {
  assert.deepEqual(await saveScreen("   ", lowPe, signedOut, device()), { ok: false, reason: "name" });
  assert.deepEqual(await saveScreen(null, lowPe, signedOut, device()), { ok: false, reason: "name" });
  assert.equal(cleanScreenName("x".repeat(60))?.length, 40);
  assert.equal(cleanScreenName(" a \n b "), "a b");

  const full = device(Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, criteria: {} })));
  assert.deepEqual(await saveScreen("Eleventh", lowPe, signedOut, full), { ok: false, reason: "full" });
  // Replacing one of the ten is still allowed.
  assert.equal((await saveScreen("s3", lowPe, signedOut, full)).ok, true);
  const acct = account(Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, criteria: {} })));
  assert.deepEqual(await saveScreen("Eleventh", lowPe, acct, device()), { ok: false, reason: "full" });

  // Old screens (saved before P/E filters existed), duplicates, junk and extras are cleaned on the way out.
  const messy = device([
    { name: "Old", criteria: { market: "india", minChangePct: 2 } },
    { name: "old", criteria: {} },
    { name: 42, criteria: {} },
    "not a screen",
    null,
    { name: "Hostile", criteria: { market: "<script>", maxPe: "15", sector: 7 } },
    ...Array.from({ length: 20 }, (_, i) => ({ name: `Extra ${i}`, criteria: {} })),
  ]);
  const screens = readDevice(messy);
  assert.equal(screens.length, MAX_SAVED_SCREENS);
  assert.deepEqual(screens[0], { name: "Old", criteria: { ...EMPTY_CRITERIA, market: "india", minChangePct: 2 } });
  assert.deepEqual(screens[1], { name: "Hostile", criteria: EMPTY_CRITERIA });
  // Corrupt storage is an empty list, not a crash.
  const corrupt = device();
  corrupt.data.set(SAVED_KEY, "{not json");
  assert.deepEqual(readDevice(corrupt), []);
  // Account rows are cleaned the same way.
  assert.deepEqual((await loadScreens(account([{ name: "A", criteria: { maxPe: "x" } }]), null)).screens, [{ name: "A", criteria: EMPTY_CRITERIA }]);
});
