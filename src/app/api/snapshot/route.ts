import { getCachedSnapshot, SNAPSHOT_TTL_MS } from "@/server/snapshot";

export const dynamic = "force-dynamic";

/**
 * The dataset the browser caches and filters locally.
 *
 * Conditional on purpose. The client polls this every five minutes and sends
 * back the `version` it already holds as `If-None-Match`; when nothing in
 * MongoDB has changed the answer is a 304 of a few hundred bytes instead of a
 * quarter-megabyte of events. That is what makes a five-minute refresh cheap
 * enough to leave running in every open tab.
 *
 * `no-store` keeps proxies and the browser HTTP cache out of it: freshness
 * here is the client's own business, decided against its own sync clock in
 * `useSnapshot`, and a stale intermediary would answer the poll without the
 * origin ever learning there was new data.
 */
export async function GET(request: Request) {
  const { json, gzip, brotli, etag } = await getCachedSnapshot();

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    ETag: `"${etag}"`,
    "Cache-Control": "no-store",
    // The body differs by encoding even though the ETag does not, so anything
    // that does cache this must key on it.
    Vary: "Accept-Encoding",
    /** Advisory, for anyone reading the response by hand. */
    "X-Snapshot-TTL-Ms": String(SNAPSHOT_TTL_MS),
  };

  // Browsers and proxies may quote, weaken, or send a list; compare on the
  // bare hash so a `W/"abc"` or `"abc", "def"` still matches.
  const requested = request.headers.get("if-none-match");
  if (requested && requested.includes(etag)) {
    return new Response(null, { status: 304, headers });
  }

  // Compression happens in `getCachedSnapshot`, once per build — Next does not
  // compress this route itself, and 5.4 MB of identity-encoded JSON per cold
  // load is not a payload to leave to chance.
  const accepted = request.headers.get("accept-encoding") ?? "";
  if (accepted.includes("br")) {
    return new Response(brotli, {
      status: 200,
      headers: { ...headers, "Content-Encoding": "br" },
    });
  }
  if (accepted.includes("gzip")) {
    return new Response(gzip, {
      status: 200,
      headers: { ...headers, "Content-Encoding": "gzip" },
    });
  }

  return new Response(json, { status: 200, headers });
}
