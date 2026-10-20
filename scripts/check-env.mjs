import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import semver from "semver";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (!semver.satisfies(process.versions.node, pkg.engines.node)) {
  throw new Error(`Node ${process.versions.node} is unsupported; use ${pkg.engines.node}.`);
}
const expected = pkg.packageManager.replace("pnpm@", "");
const agent = process.env.npm_config_user_agent?.split(" ")[0];
const actual = agent?.startsWith("pnpm/")
  ? agent.slice("pnpm/".length)
  : execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
if (actual !== expected) throw new Error(`Use pnpm ${expected}, received ${actual}.`);
for (const executable of ["git", "rg", "npm", "tar"]) {
  try {
    const version = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).split(/\r?\n/)[0];
    console.log(`${executable}: ${version}`);
  } catch {
    throw new Error(`Missing ${executable} on PATH. See CONTRIBUTING.md prerequisites.`);
  }
}
console.log(`Node ${process.versions.node}; pnpm ${actual}. Environment checks passed.`);
