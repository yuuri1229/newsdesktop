import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "News Desktop",
  description: "国内・国外ニュース、日本標準時、天気、日経平均/TOPIX、地域ニュースをリアルタイム表示するダッシュボード",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
