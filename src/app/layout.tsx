import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Palantir TH",
  description: "แพลตฟอร์มวิเคราะห์เหตุการณ์ความมั่นคงชายแดนใต้",
};

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
      <body className="bg-void text-ink antialiased">{children}</body>
    </html>
  );
}
