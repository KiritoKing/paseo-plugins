import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPublicWorkspaces } from "./check-public.mjs";
import { assertShrinkwrapComplete } from "./lib/package-utils.mjs";

const updates = [];
for (const { packageRoot, packageJson } of discoverPublicWorkspaces()) {
  if (!Object.keys(packageJson.dependencies ?? {}).length) continue;
  const temporary = mkdtempSync(join(tmpdir(), "plugin-consumer-lock-"));
  try {
    const destination = join(packageRoot, "npm-shrinkwrap.json");
    copyFileSync(join(packageRoot, "package.json"), join(temporary, "package.json"));
    if (existsSync(destination)) copyFileSync(destination, join(temporary, "npm-shrinkwrap.json"));
    const options = {
      cwd: temporary,
      env: {
        ...process.env,
        npm_config_registry: "https://registry.npmjs.org/",
        npm_config_cache: join(temporary, "cache"),
        NPM_CONFIG_CACHE: join(temporary, "cache"),
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    };
    execFileSync(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      options,
    );
    execFileSync("npm", ["shrinkwrap", "--ignore-scripts"], options);
    const contents = readFileSync(join(temporary, "npm-shrinkwrap.json"), "utf8");
    assertShrinkwrapComplete(packageJson, JSON.parse(contents));
    updates.push({ destination, contents, name: packageJson.name });
  } catch {
    throw new Error(
      `Consumer lock update failed for ${packageJson.name}; source lock was preserved.`,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
for (const update of updates) {
  writeFileSync(update.destination, update.contents);
  console.log(`Updated public npm consumer lock for ${update.name}.`);
}
