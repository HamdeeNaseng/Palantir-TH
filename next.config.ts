import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production output separate from the development server cache. This
  // prevents Windows file-handle collisions on `.next/trace` when `next dev`
  // is running while CI or a local terminal creates a production build.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  serverExternalPackages: ["mongodb"],
};

export default nextConfig;
