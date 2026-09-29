import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNews } from "../news";

test("normalizeNews returns [] for non-array input", () => {
  assert.deepEqual(normalizeNews(null), []);
  assert.deepEqual(normalizeNews(undefined), []);
  assert.deepEqual(normalizeNews("not an array"), []);
});

test("normalizeNews drops articles missing a headline or url", () => {
  const raw = [
    { headline: "Has both", url: "https://example.com/a", source: "Reuters", datetime: 1700000000 },
    { headline: "No url" },
    { url: "https://example.com/no-headline" },
  ];

  const result = normalizeNews(raw);

  assert.equal(result.length, 1);
  assert.equal(result[0].headline, "Has both");
});

test("normalizeNews converts unix seconds to an ISO timestamp", () => {
  const raw = [
    { headline: "A", url: "https://example.com/a", source: "Reuters", datetime: 1700000000 },
  ];

  const [article] = normalizeNews(raw);

  assert.equal(article.publishedAt, new Date(1700000000 * 1000).toISOString());
});

test("normalizeNews defaults missing/invalid fields safely, never fabricates them", () => {
  const raw = [{ headline: "A", url: "https://example.com/a" }];

  const [article] = normalizeNews(raw);

  assert.equal(article.source, "Unknown");
  assert.equal(article.summary, "");
  assert.equal(article.publishedAt, null);
});

test("normalizeNews de-duplicates by url", () => {
  const raw = [
    { headline: "First", url: "https://example.com/a", datetime: 1 },
    { headline: "Duplicate", url: "https://example.com/a", datetime: 2 },
  ];

  const result = normalizeNews(raw);

  assert.equal(result.length, 1);
});

test("normalizeNews sorts newest first and caps at 10 articles", () => {
  const raw = Array.from({ length: 15 }, (_, i) => ({
    headline: `Article ${i}`,
    url: `https://example.com/${i}`,
    datetime: i,
  }));

  const result = normalizeNews(raw);

  assert.equal(result.length, 10);
  assert.equal(result[0].headline, "Article 14");
  assert.equal(result[9].headline, "Article 5");
});
