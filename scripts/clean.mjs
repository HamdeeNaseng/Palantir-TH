import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const targets = [".next", ".next-build", "tsconfig.tsbuildinfo"];

for (const name of targets) {
  const target = resolve(root, name);
  if (basename(target) !== name || !target.startsWith(`${root}\\`) && !target.startsWith(`${root}/`)) {
    throw new Error(`Refusing to clean unexpected path: ${target}`);
  }

  try {
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    console.log(`Cleaned ${name}`);
  } catch (error) {
    console.error(`Unable to clean ${name}. Stop running dev/build processes and try again.`);
    throw error;
  }
}

console.log("Build artifacts cleaned.");
