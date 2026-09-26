import type { NextConfig } from "next";

// GitHub Pages ではリポジトリ名配下 (/newsdesktop) で配信されるため、
// ワークフローから NEXT_PUBLIC_BASE_PATH を渡す。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
