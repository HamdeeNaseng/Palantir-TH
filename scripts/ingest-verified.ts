/**
 * Resolve one verified-event window to its import script and run it.
 *
 * The window scripts in this directory are the source of truth for which
 * windows exist — this reads them off disk rather than a hand-kept list, so
 * adding a window means dropping in a file, not also editing package.json.
 *
 *   npm run ingest:verified -- -d 20260503-09   # by window token
 *   npm run ingest:verified -- -d 2026-05-05    # by any date inside a window
 *   npm run ingest:verified -- --list           # what is available
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** import-verified-events-2026-05-31-to-06-06.ts -> 2026-05-31 .. 2026-06-06 */
const FILE_PATTERN =
  /^(import-verified-events?|import-zero-event-audit)-(\d{4})-(\d{2})-(\d{2})(?:-to-(?:(\d{4})-)?(?:(\d{2})-)?(\d{2}))?\.ts$/;

interface WindowScript {
  file: string;
  /** The npm-script token this window used to have, e.g. "20260531-0606". */
  token: string;
  /** YYYYMMDD, inclusive on both ends. */
  start: string;
  end: string;
  audit: boolean;
}

/**
 * Rebuild the token the per-window npm scripts used, so anything already
 * written down against the old names keeps working: the end date drops the
 * parts it shares with the start, exactly as those names did.
 */
function tokenOf(start: string, end: string): string {
  if (end === start) return start;
  if (end.slice(0, 6) === start.slice(0, 6)) return `${start}-${end.slice(6)}`;
  if (end.slice(0, 4) === start.slice(0, 4)) return `${start}-${end.slice(4)}`;
  return `${start}-${end}`;
}

function discover(): WindowScript[] {
  const windows: WindowScript[] = [];
  for (const file of readdirSync(SCRIPT_DIR)) {
    const match = FILE_PATTERN.exec(file);
    if (!match) continue;
    const [, kind, year, month, day, endYear, endMonth, endDay] = match;
    const start = `${year}${month}${day}`;
    const end = endDay ? `${endYear ?? year}${endMonth ?? month}${endDay}` : start;
    windows.push({ file, token: tokenOf(start, end), start, end, audit: kind === "import-zero-event-audit" });
  }
  return windows.sort((a, b) => b.start.localeCompare(a.start));
}

const digitsOf = (value: string): string => value.replace(/\D/g, "");

/**
 * Accepts a window token, a full date inside a window, or a YYYY/YYYYMM
 * prefix. Returning every match rather than the first keeps an ambiguous
 * query an error the caller sees, not a window picked for them.
 */
function findWindows(windows: WindowScript[], query: string): WindowScript[] {
  const wanted = digitsOf(query);
  const byToken = windows.filter((w) => digitsOf(w.token) === wanted);
  if (byToken.length > 0) return byToken;
  if (wanted.length === 8) return windows.filter((w) => w.start <= wanted && wanted <= w.end);
  return windows.filter((w) => w.start.startsWith(wanted));
}

const asDate = (yyyymmdd: string): string =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6)}`;

function describe(w: WindowScript): string {
  const span = w.start === w.end ? asDate(w.start) : `${asDate(w.start)} → ${asDate(w.end)}`;
  return `  ${w.token.padEnd(15)} ${span.padEnd(25)} ${w.file}${w.audit ? "  (zero-event audit)" : ""}`;
}

const USAGE = [
  "Usage: npm run ingest:verified -- -d <window>",
  "",
  "  -d, --date <window>  window token (20260503-09), or any date inside a window",
  "  -l, --list           list the windows that have an import script",
].join("\n");

function parseArgs(argv: string[]): { query: string | null; list: boolean } {
  let query: string | null = null;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-l" || arg === "--list") {
      list = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "-d" || arg === "--date") {
      query = argv[++i] ?? null;
      if (query === null) throw new Error("-d needs a window, e.g. -d 20260503-09");
    } else if (arg.startsWith("--date=")) {
      query = arg.slice("--date=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option ${arg}\n\n${USAGE}`);
    } else {
      query = arg;
    }
  }
  return { query, list };
}

async function main(): Promise<void> {
  const windows = discover();
  if (windows.length === 0) throw new Error(`No window import scripts found in ${SCRIPT_DIR}`);

  const { query, list } = parseArgs(process.argv.slice(2));

  if (list || query === null) {
    console.log(`${windows.length} verified windows:`);
    console.log(windows.map(describe).join("\n"));
    if (!list) {
      console.log(`\n${USAGE}`);
      process.exitCode = 1;
    }
    return;
  }

  const matches = findWindows(windows, query);
  if (matches.length === 0) {
    throw new Error(`No window matches "${query}". Run with --list to see the ${windows.length} available.`);
  }
  if (matches.length > 1) {
    throw new Error(`"${query}" matches ${matches.length} windows:\n${matches.map(describe).join("\n")}`);
  }

  const target = matches[0];
  console.log(`Running ${target.file} (${asDate(target.start)} → ${asDate(target.end)})`);
  // The window scripts run their own main() on import and close their own
  // client, so nothing may be scheduled after this point.
  await import(pathToFileURL(join(SCRIPT_DIR, target.file)).href);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
