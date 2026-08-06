import { fetchNews } from "../providers/news";

export async function getNews(
  symbol: string
) {
  const result =
    await fetchNews(symbol);

  return result?.data || [];
}