import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production output separate from the development server cache. This
  // prevents Windows file-handle collisions on `.next/trace` when `next dev`
  // is running while CI or a local terminal creates a production build.
  //
  // `NEXT_DIST_DIR` extends that to a second dev server: two `next dev`
  // processes sharing one directory both open `.next/trace` for writing, and on
  // Windows the second one dies with EPERM before it serves a single request.
  // `.next-build` exists only to keep a local production build from fighting a
  // running `next dev` for `.next/trace` on Windows. A hosted build has no dev
  // server to collide with, and Vercel looks for the default `.next`, so the
  // split stays local: `VERCEL` is set in every Vercel build environment.
  distDir:
    process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === "production" && !process.env.VERCEL ? ".next-build" : ".next"),
  serverExternalPackages: ["mongodb"],
};

export default nextConfig;
