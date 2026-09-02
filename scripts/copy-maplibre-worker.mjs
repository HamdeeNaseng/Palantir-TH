import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * MapLibre v6's module worker imports `maplibre-gl-shared.mjs` beside itself.
 * Next (Turbopack and webpack modes) does not preserve that pair when resolving
 * the worker through `new URL(..., import.meta.url)`, so serve the installed
 * package's matching files from one stable, same-origin public directory.
 *
 * Keep this aligned with the official MapLibre Next.js integration guidance.
 */
const require = createRequire(import.meta.url);
const dist = path.join(path.dirname(require.resolve("maplibre-gl/package.json")), "dist");
const destination = path.join(process.cwd(), "public", "maplibre");

mkdirSync(destination, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(destination, file));
}
