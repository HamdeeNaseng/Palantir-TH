import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Builds the precomputed read-side bundle into `snapshot_cache`.
 *
 *   npm run snapshot:build                    # .env.production — the deployed cluster
 *   npm run snapshot:build -- --env .env.local
 *   npm run snapshot:build -- --env-none      # whatever is already in the environment
 *
 * Run this after anything that changes the corpus — `npm run db:seed`, an
 * ingest, an analyst correction. Until it runs again the site serves the
 * previous bundle, which is the trade the cache makes: a corpus that changes
 * on ingestion runs is worth serving slightly stale rather than not at all.
 *
 * The scan this performs is the same one `loadBundle()` used to attempt per
 * request, and the reason it belongs here instead: 6.24 MB at the cluster's
 * measured ~94 KB/s is around 68 s, which no request deadline tolerates and a
 * one-off job does not care about.
 */

const ROOT = process.cwd();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value, e.g. ${name} .env.production`);
  }
  return value;
}

/**
 * Loaded before the client module is imported, because `src/lib/mongodb.ts`
 * reads `MONGODB_URI` once at module load. Values already in the environment
 * win, so `MONGODB_URI=... npm run snapshot:build` still overrides.
 */
function loadEnv(file: string) {
  const full = path.resolve(ROOT, file);
  if (!fs.existsSync(full)) {
    throw new Error(
      `Environment file not found: ${full}\n` +
        "It is gitignored by design — copy it from the deployment platform, or pass --env-none.",
    );
  }
  for (const [k, v] of Object.entries(dotenv.parse(fs.readFileSync(full)))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return full;
}

if (!process.argv.includes("--env-none")) {
  console.log(`env file:    ${loadEnv(flag("--env") ?? ".env.production")}`);
}

/**
 * The app's own client caps a connect at 12 s and a socket at 45 s, sized for
 * a serverless request. Neither budget suits a job whose whole purpose is the
 * read those budgets refuse, so this raises the socket timeout before the
 * module is loaded and reads it.
 */
process.env.MONGODB_SOCKET_TIMEOUT_MS ??= "600000";

const { scanBundle } = await import("../src/server/shared-events");
const { writeCachedBundle } = await import("../src/server/bundle-cache");
const { getClient } = await import("../src/lib/mongodb");

const started = Date.now();
console.log("scanning collections (this reads the whole corpus; expect ~1-2 min)...");

const bundle = await scanBundle();
const scanMs = Date.now() - started;

const { live: _live, ...cacheable } = bundle;
const { bytes, counts } = await writeCachedBundle(cacheable, Date.now());

console.log(`\nscan:        ${(scanMs / 1000).toFixed(1)} s`);
for (const [layer, n] of Object.entries(counts)) {
  console.log(`  ${layer.padEnd(16)} ${n.toLocaleString().padStart(7)}`);
}
console.log(`compressed:  ${(bytes / 1024).toFixed(0)} KB written to snapshot_cache`);

if (counts.sources === 0) {
  console.warn(
    "\nWarning: source_registry is empty, so every page will still render its " +
      "empty state — `live` is derived from it. Seed the database first.",
  );
}

await (await getClient()).close();
