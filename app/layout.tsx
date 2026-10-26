import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import ProfileGate from "@/components/ProfileGate";
import AuthReturn from "@/components/AuthReturn";
import BetaFooter from "@/components/BetaFooter";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "StockSphere — Research, track and discuss markets",
    template: "%s · StockSphere",
  },
  description:
    "Live Indian and global market data, portfolio tracking, watchlists and an AI research assistant.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-black text-white">
        <Navbar />
        <AuthReturn />
        <ProfileGate />

        {children}
        <BetaFooter />
      </body>
    </html>
  );
}
