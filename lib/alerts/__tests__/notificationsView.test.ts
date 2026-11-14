import { test } from "node:test";
import assert from "node:assert/strict";

import { filterNotifications, groupByDay, kindCounts, kindInfo, safeNotificationLink, type NotificationItem } from "../notificationsView";

/** The Notifications page's arrangement rules. */

const n = (id: string, kind: string, createdAt: string, read = false): NotificationItem => ({ id, kind, title: id, body: null, link: null, createdAt, readAt: read ? "2026-11-14T00:00:00Z" : null });

// Sat 14 Nov 2026, 10:00 IST.
const NOW = Date.parse("2026-11-14T04:30:00Z");
const IST = -330;

const items = [
  n("alert-today", "price_alert", "2026-11-14T03:00:00Z"),
  n("reply-late-last-night", "community", "2026-11-13T18:00:00Z", true), // 23:30 IST on the 13th
  n("follow-just-after-midnight", "community", "2026-11-13T18:45:00Z"), // 00:15 IST on the 14th
  n("old", "price_alert", "2026-11-01T10:00:00Z", true),
  n("mystery", "something_new", "not a date"),
];

test("notifications are grouped by the viewer's own calendar day, newest first", () => {
  const groups = groupByDay(items, NOW, IST);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ["Today", ["alert-today", "follow-just-after-midnight"]],
    ["Yesterday", ["reply-late-last-night"]],
    ["Earlier", ["old", "mystery"]],
  ]);
  // The same moments seen from New York (UTC−5, offset 300): it's still the 13th there.
  const ny = groupByDay(items, NOW, 300);
  assert.deepEqual(ny[0].items.map((i) => i.id), ["alert-today", "follow-just-after-midnight", "reply-late-last-night"]);
  // Empty groups aren't shown.
  assert.deepEqual(groupByDay([items[3]], NOW, IST).map((g) => g.label), ["Earlier"]);
  assert.deepEqual(groupByDay([], NOW, IST), []);
});

test("filters by kind and to unread, and counts each kind for its chip", () => {
  assert.deepEqual(filterNotifications(items, "community", false).map((i) => i.id), ["reply-late-last-night", "follow-just-after-midnight"]);
  assert.deepEqual(filterNotifications(items, "community", true).map((i) => i.id), ["follow-just-after-midnight"]);
  assert.deepEqual(filterNotifications(items, "all", true).map((i) => i.id), ["alert-today", "follow-just-after-midnight", "mystery"]);
  // Only kinds that have notifications get a chip; an unknown kind counts under All.
  assert.deepEqual(kindCounts(items), [
    { id: "all", label: "All", total: 5, unread: 3 },
    { id: "price_alert", label: "Price alerts", total: 2, unread: 1 },
    { id: "community", label: "Community", total: 2, unread: 1 },
  ]);
  assert.deepEqual(kindInfo("something_new"), { label: "Other", icon: "•" });
  assert.equal(kindInfo("price_alert").label, "Price alerts");
});

test("a notification only links inside the site", () => {
  for (const ok of ["/stock/TCS", "/community/post/1b2c?reply=3#c", "/alerts", "/profile/@ayush"]) assert.equal(safeNotificationLink(ok), ok);
  for (const bad of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "stock/TCS", "/a b", "", null]) {
    assert.equal(safeNotificationLink(bad), "/notifications", String(bad));
  }
});
