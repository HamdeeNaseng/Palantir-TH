import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Palantir TH",
  description: "แพลตฟอร์มวิเคราะห์เหตุการณ์ความมั่นคงชายแดนใต้",
};

/**
 * Where the server renders run is set in `vercel.json`, not here.
 *
 * It matters more than it looks. The Atlas cluster is on AWS
 * `AP_SOUTHEAST_1` (Singapore, az apse1-az3 — read off the replica set's own
 * tags), and the functions were defaulting to `iad1` (Washington, D.C.), so
 * every page render reached 15,000 km for its data: a request that *arrived*
 * in Singapore was routed to Virginia and then pulled the whole
 * `event_candidates` collection back across the Pacific. Measured, that scan
 * moves at ~94 KB/s — the round trip is the limit, since every `getMore` on
 * the cursor is another crossing — so 30 MB took 320 s and `/events` hit the
 * 300 s function ceiling mid-stream.
 *
 * This would be an `export const preferredRegion = ["sin1"]` right here, but
 * Next 16 deprecated the segment config and warns on it at build time; the
 * documented migration is to leave the choice to the platform. `vercel.json`
 * carries it now. Nothing enforces it from inside the app any more, so a
 * region change made in the Vercel dashboard will silently win — if page
 * latency regresses, check that first.
 */

export const viewport: Viewport = {
  themeColor: "#04070e",
  width: "device-width",
  initialScale: 1,
  // Paint under the notch so the dark console reaches the edge of the screen;
  // the bars that would land underneath it claim the inset back with the
  // `px-safe` / `pb-safe` utilities. No `maximumScale`: this is a page people
  // will want to pinch into, and capping zoom is an accessibility regression.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        {/* Thai UI face; falls back to the system stack when offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-void text-ink antialiased">
        {children}
        {/*
          Field measurement, not lab measurement.

          The `sin1` pin above it was set on the strength of one Vercel request
          log and a probe run from a single machine. Speed Insights reports the
          Core Web Vitals actual visitors record — so whether moving the
          functions to Singapore helped the people this is built for is a
          question with an answer, rather than an argument from where the
          cluster sits. Analytics carries the page views those are a rate over.

          Both are inert without the Vercel injection: off-platform (local dev,
          a self-hosted build) they render nothing and send nothing, so neither
          needs guarding behind an environment check. They are client
          components in a server layout, which is why they sit here in the tree
          rather than being wrapped.
        */}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
