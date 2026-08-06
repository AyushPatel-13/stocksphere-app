import { getCompanyNews } from "../apis/finnhub";

export async function fetchNews(
  symbol: string
) {
  try {
    const news =
      await getCompanyNews(symbol);

    if (news?.length) {
      console.log("✅ Finnhub News");

      return {
        provider: "Finnhub",
        data: news,
      };
    }
  } catch {}

  return null;
}