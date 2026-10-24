import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The wall, station and sticker pages are plain HTML in /public; "/" shows the landing page.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/index.html" }], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
