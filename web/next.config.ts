import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Links to the old static arena (README, shared posts) keep working.
  async redirects() {
    return [
      { source: "/play.html", destination: "/play", permanent: true },
      { source: "/board.html", destination: "/leaderboard", permanent: true },
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/", has: [{ type: "query", key: "run", value: "(?<run>.+)" }], destination: "/matches/:run", permanent: false },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
