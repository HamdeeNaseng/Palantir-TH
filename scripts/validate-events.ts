/**
 * Geographic validation of the generated event set, runnable on its own.
 *
 *   npm run validate:events
 *
 * `scripts/seed.ts` runs the same check before writing, so this is for
 * inspecting the data without touching the database — e.g. after re-fetching
 * boundaries, which moves every generated coordinate.
 */
import { buildEvents } from "../src/lib/fixtures";
import { formatPlacementReport, validateEventPlacement } from "../src/lib/validate-events";

const events = buildEvents();
const report = validateEventPlacement(events);

console.log(`Checked ${report.total} events, outside in:`);
console.log(formatPlacementReport(report));

if (!report.ok) {
  console.error(`\n${report.failures.length} event(s) failed placement checks.`);
  process.exit(1);
}
console.log("\nAll events sit inside the district they claim.");
