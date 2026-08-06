import WatchlistButton from "../../WatchlistButton";
import RecentSearchTracker from "@/app/RecentSearchTracker";
import StockDiscussion
  from "@/app/StockDiscussion";
import BullBearVote
  from "@/app/BullBearVote";
import StockEvents from "@/app/StockEvents";
import StockHeader from "@/components/Stock/StockHeader";
import StockChart from "@/components/Stock/StockChart";
import CompanyOverview from "@/components/Stock/CompanyOverview";
import { getPrice } from "@/lib/services/price";
import { getCompany } from "@/lib/services/company";
import { getHistorical } from "@/lib/services/historical";
import { getNews } from "@/lib/services/news";
import { getFinancials } from "@/lib/services/financials";
import {
  formatCurrency,
  formatLargeNumber,
  formatPercent,
  formatVolume,
} from "@/lib/utils/format";

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const quote =
    await getPrice(symbol);

  const company =
    await getCompany(symbol);

  const historical =
    await getHistorical(symbol)

  console.log(company);

  const news =
    await getNews(symbol);

  const financials =
    await getFinancials(symbol);

  console.log(financials);

  console.log("QUOTE:", quote);

  console.log(quote);
  const stockData: any = {
    RELIANCE: {
      name: "Reliance Industries Ltd.",
      price: "₹2,850.00",
      change: "+45.20 (+1.61%)",
    },

    TCS: {
      name: "Tata Consultancy Services",
      price: "₹4,150.00",
      change: "+25.10 (+0.61%)",
    },

    INFY: {
      name: "Infosys Ltd.",
      price: "₹1,620.00",
      change: "-12.40 (-0.76%)",
    },

    // ADD THESE ↓↓↓

    BEL: {
      name: "Bharat Electronics Ltd.",
      price: "₹385.00",
      change: "+4.20%",
    },

    HAL: {
      name: "Hindustan Aeronautics Ltd.",
      price: "₹5,420.00",
      change: "+3.85%",
    },

    TRENT: {
      name: "Trent Ltd.",
      price: "₹6,120.00",
      change: "+3.12%",
    },

    AAPL: {
      name: "Apple Inc.",
      price: "$201.50",
      change: "+2.35 (+1.18%)",
      description:
        "Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and services worldwide.",
    },

    NVDA: {
      name: "NVIDIA Corporation",
      price: "$158.90",
      change: "+3.42 (+2.20%)",
      description:
        "NVIDIA is a global leader in graphics processing units (GPUs), AI computing, gaming, and data center technologies.",
    },

    MSFT: {
      name: "Microsoft Corporation",
      price: "$503.30",
      change: "+1.62 (+0.32%)",
      description:
        "Microsoft develops software, cloud computing services, AI products, and enterprise technologies including Windows and Azure.",

    },

    TSLA: {
      name: "Tesla Inc.",
      price: "$327.11",
      change: "-4.10 (-1.24%)",
      description:
        "Tesla designs and manufactures electric vehicles, battery storage systems, and clean energy products.",
    },

  };

  const stock =
    stockData[symbol.toUpperCase()] ||
    stockData.RELIANCE;
  const livePrice =
    quote?.price;

  const liveChange =
    quote?.change;

  const liveChangePercent =
    quote?.changePercent;

  const open = quote?.open;
  const high = quote?.high;
  const low = quote?.low;
  const volume = quote?.volume;
  const previousClose = quote?.previousClose;

  const currencySymbol =
    quote?.currency === "USD"
      ? "$"
      : "₹";

  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <RecentSearchTracker symbol={symbol} />
      <h1 style={{ fontSize: "40px", fontWeight: "bold" }}>
        {symbol}
      </h1>
      <h3 style={{ color: "#888" }}>
        {company?.name || stock.name}
      </h3>

      <h2>
        {livePrice
          ? formatCurrency(
            livePrice,
            currencySymbol
          )
          : stock.price}
      </h2>

      <p
        style={{
          color:
            Number(liveChange) >= 0
              ? "lime"
              : "red",
        }}
      >
        {liveChange}
        ({liveChangePercent})
      </p>
      <WatchlistButton symbol={symbol} />

      <BullBearVote symbol={symbol} />

      <StockDiscussion symbol={symbol} />

      <CompanyOverview company={stock} />

      <div
        style={{
          marginTop: "30px",
          background: "#111",
          borderRadius: "20px",
          padding: "25px",
        }}
      >
        <StockChart
          historicalData={
            historical?.values || []
          }
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "20px",
          marginTop: "30px",
        }}
      >
        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>Open</h3>
          <p>{open || "N/A"}</p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>High</h3>
          <p>{high || "N/A"}</p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>Low</h3>
          <p>{low || "N/A"}</p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>Previous Close</h3>
          <p>{previousClose || "N/A"}</p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>Volume</h3>
          <p>
            {formatVolume(volume ?? null)}
          </p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>Market Cap</h3>
          <p>
            {formatLargeNumber(
              financials?.marketCap ?? null
            )}
          </p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>52W High</h3>
          <p>
            {financials?.week52High ?? "N/A"}
          </p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>52W Low</h3>
          <p>
            {financials?.week52Low ?? "N/A"}
          </p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>P/E Ratio</h3>
          <p>
            {financials?.pe?.toFixed(2) ?? "N/A"}
          </p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>EPS</h3>
          <p>
            {financials?.eps?.toFixed(2) ?? "N/A"}
          </p>
        </div>

        <div
          style={{
            background: "#111",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h3>Dividend Yield</h3>
          <p>
            {formatPercent(
              financials?.dividendYield ?? null
            )}
          </p>
        </div>

      </div>

      <h2
        style={{
          marginTop: "40px",
          marginBottom: "20px",
          fontSize: "28px",
        }}
      >
        Latest News
      </h2>

      <div
        style={{
          display: "grid",
          gap: "15px",
        }}
      >
        {news.slice(0, 10).map((item: any) => (
          <div
            key={item.id}
            style={{
              background: "#111",
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            <img
              src={item.image}
              alt={item.headline}
              style={{
                width: "100%",
                height: "220px",
                objectFit: "cover",
              }}
            />

            <div
              style={{
                padding: "20px",
              }}
            >
              <h3>{item.headline}</h3>

              <p
                style={{
                  color: "#888",
                  marginTop: "10px",
                }}
              >
                {item.source}
              </p>
            </div>
          </div>
        ))}
      </div>

      <StockEvents symbol={symbol} />

    </div>
  );
}