import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Does this deployment's MongoDB actually answer?
 *
 *   npm run db:check              # .env.production — the deployed cluster
 *   npm run db:check -- --env .env.local
 *   npm run db:check -- --env-none  # whatever is already in the environment
 *
 * Two things make it worth more than a `ping` in a REPL:
 *
 *   1. It connects through `src/lib/mongodb.ts` — the app's own URI handling,
 *      pool and timeouts — so a pass means *the app* can connect, not merely
 *      that a driver somewhere can.
 *   2. It reads the failure. "Connection failed" is the least useful sentence
 *      in operations: a bad password, an un-allowlisted IP and a broken local
 *      resolver all produce it, and they are fixed in three different places.
 */

const ROOT = process.cwd();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value, e.g. ${name} .env.production`);
  return value;
}

/**
 * Loaded into `process.env` *before* the app's client module is imported,
 * because that module reads `MONGODB_URI` once at load. Values already in the
 * environment win, so `MONGODB_URI=... npm run db:check` still overrides.
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

/** Never print the password, whatever else goes into the log. */
const redact = (uri: string) => uri.replace(/\/\/[^@/]*@/, "//***@");

/** The collections the app reads; a missing one is a seeding problem, not a connection one. */
const EXPECTED = [
  "event_candidates",
  "citizen_reports",
  "source_registry",
  "ingestion_runs",
  "raw_records",
] as const;

function explain(err: unknown): string[] {
  const message = String((err as { message?: string })?.message ?? err);
  const name = (err as { name?: string })?.name ?? "";

  if (/querySrv|queryTxt/.test(message)) {
    return [
      "The SRV/TXT DNS lookup for the cluster hostname failed — the connection never",
      "left this machine, so Atlas, the password and the IP allowlist are all innocent.",
      "On Windows, Node sometimes falls back to a 127.0.0.1 resolver that nothing is",
      "listening on while Windows itself resolves fine (check: `node -e \"console.log(require('dns').getServers())\"`).",
      "src/lib/mongodb.ts retries once via public resolvers for exactly this; if it still",
      "fails, a VPN or firewall is blocking outbound DNS.",
    ];
  }
  if (/Authentication failed|bad auth/i.test(message)) {
    return [
      "The cluster answered and rejected the credentials. Check MONGODB_URI's user and",
      "password (a password with @ : / ? # must be percent-encoded), and that the user",
      "exists under Atlas -> Database Access with a role on this database.",
    ];
  }
  if (name === "MongoServerSelectionError" || /timed out|ETIMEDOUT/i.test(message)) {
    return [
      "The hostname resolved but no server could be selected before the timeout. The",
      "usual cause is Atlas -> Network Access: this machine's egress IP is not on the",
      "access list (a serverless host has no fixed IP and needs 0.0.0.0/0). A paused",
      "cluster looks the same from here.",
    ];
  }
  return ["Unrecognised failure — the driver's own error is printed above."];
}

async function main() {
  const useEnvFile = !process.argv.includes("--env-none");
  const file = flag("--env") ?? ".env.production";
  if (useEnvFile) console.log(`env file:    ${loadEnv(file)}`);
  else console.log("env file:    (none — using the ambient environment)");

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Nothing to check.");
  }
  console.log(`uri:         ${redact(process.env.MONGODB_URI)}`);
  console.log(`database:    ${process.env.MONGODB_DB ?? "palantir_th (default)"}`);

  // Imported late, and dynamically, so the env file above is already in place
  // when the module reads it.
  const { getDb, getClient } = await import("../src/lib/mongodb");

  const started = Date.now();
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    console.log(`\n✅ connected in ${Date.now() - started} ms`);

    const present = new Set((await db.listCollections().toArray()).map((c) => c.name));
    console.log(`collections: ${[...present].sort().join(", ") || "(none)"}`);

    let empty = 0;
    for (const name of EXPECTED) {
      if (!present.has(name)) {
        console.log(`  - ${name.padEnd(18)} MISSING`);
        empty += 1;
        continue;
      }
      const n = await db.collection(name).countDocuments();
      console.log(`  - ${name.padEnd(18)} ${n.toLocaleString("en-US")} docs`);
      if (n === 0) empty += 1;
    }
    if (empty > 0) {
      console.log(
        "\nNote: the connection is fine, but some collections the app reads are empty or\n" +
          "absent — the pages will render their empty state. Seed with `npm run db:seed`\n" +
          "or push from a local copy with `npm run mongo:push:prod`.",
      );
    }
    await (await getClient()).close();
  } catch (err) {
    console.error(`\n❌ could not connect (after ${Date.now() - started} ms)`);
    console.error(err);
    console.error("");
    for (const line of explain(err)) console.error(line);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exitCode = 1;
});
