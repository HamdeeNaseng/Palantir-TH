import { readFile } from "node:fs/promises";
import process from "node:process";

const REQUIRED_NODE = "24.14";
const REQUIRED_NPM = "11.16";

const failures = [];
const notes = [];

const nodeVersion = process.versions.node;
if (!nodeVersion.startsWith(`${REQUIRED_NODE}.`)) {
  failures.push(
    `Node ${nodeVersion} is unsupported; use ${REQUIRED_NODE}.x (run \"nvm use\" on nvm-managed systems).`,
  );
}

const npmAgent = process.env.npm_config_user_agent ?? "";
const npmVersion = npmAgent.match(/(?:^|\s)npm\/([^\s]+)/)?.[1];
if (!npmVersion) {
  notes.push("npm version was not detected; run this check through npm run check:env.");
} else if (!npmVersion.startsWith(`${REQUIRED_NPM}.`)) {
  failures.push(`npm ${npmVersion} is unsupported; use ${REQUIRED_NPM}.x.`);
}

const [packageText, lockText] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
]);
const packageJson = JSON.parse(packageText);
const packageLock = JSON.parse(lockText);

if (packageLock.lockfileVersion !== 3) {
  failures.push(`package-lock.json must use lockfileVersion 3; found ${packageLock.lockfileVersion}.`);
}

if (
  packageJson.name !== packageLock.name ||
  packageJson.version !== packageLock.version
) {
  failures.push("package.json and package-lock.json name/version metadata do not match.");
}

if (failures.length) {
  console.error("Environment check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Environment OK: Node ${nodeVersion}${npmVersion ? `, npm ${npmVersion}` : ""}.`);
}

for (const note of notes) console.warn(`Note: ${note}`);
