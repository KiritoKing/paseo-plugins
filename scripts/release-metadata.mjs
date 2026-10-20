import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = fileURLToPath(new URL("../", import.meta.url));

export function releaseMetadata({ directory, version, tag = "latest", publish = false, ref }) {
  if (!/^paseo-[a-z0-9-]+$/.test(directory ?? "")) throw new Error("Invalid package directory.");
  const pkg = JSON.parse(
    readFileSync(resolve(root, "packages", directory, "package.json"), "utf8"),
  );
  if (!version || semver.valid(version) !== version || pkg.version !== version) {
    throw new Error("Requested version must match the package manifest exactly.");
  }
  if (!["latest", "next"].includes(tag)) throw new Error("Release tag must be latest or next.");
  if (semver.prerelease(version) && tag === "latest") {
    throw new Error("Prereleases must use the next dist-tag.");
  }
  if (publish && ref !== "refs/heads/main")
    throw new Error("Publication requires the main branch.");
  return {
    name: pkg.name,
    version,
    tag,
    artifact: `work/packages/${pkg.name.replace("@", "").replace("/", "-")}-${version}.tgz`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = releaseMetadata({
    directory: process.env.RELEASE_PACKAGE,
    version: process.env.RELEASE_VERSION,
    tag: process.env.RELEASE_TAG,
    publish: process.env.RELEASE_PUBLISH === "true",
    ref: process.env.GITHUB_REF,
  });
  for (const [key, value] of Object.entries(metadata)) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    console.log(`${key}: ${value}`);
  }
}
