import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production output separate from the development server cache. This
  // prevents Windows file-handle collisions on `.next/trace` when `next dev`
  // is running while CI or a local terminal creates a production build.
  //
  // `NEXT_DIST_DIR` extends that to a second dev server: two `next dev`
  // processes sharing one directory both open `.next/trace` for writing, and on
  // Windows the second one dies with EPERM before it serves a single request.
  distDir:
    process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === "production" ? ".next-build" : ".next"),
  serverExternalPackages: ["mongodb"],
};

export default nextConfig;
