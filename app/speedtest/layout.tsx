import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "スピードテスト | News Desktop",
  description: "30 分ごとに回線の下り・上り速度、Ping、ジッターを計測してグラフと評価を表示します",
};

export default function SpeedTestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
