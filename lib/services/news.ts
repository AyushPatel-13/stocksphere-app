import { fetchNews } from "../providers/news";

/**
 * The provider envelope, for callers that must tell a provider failure apart
 * from a provider that answered with no articles.
 *
 * getNews() below collapses both into [], which is exactly what the stock page
 * wants to render. The agent tool must not: a failed lookup reported as []
 * would tell the model the search succeeded and found nothing.
 */
export async function getNewsResult(
  symbol: string
) {
  return fetchNews(symbol);
}

/** The article array the stock page renders. One provider pass, collapsed. */
export async function getNews(
  symbol: string
) {
  const result =
    await fetchNews(symbol);

  return result?.data || [];
}
