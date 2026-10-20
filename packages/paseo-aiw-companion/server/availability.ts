import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/** Detect the manifest without invoking AIW or requiring materialized business repos. */
export function hasAiwConfig(directory: string): boolean {
  try {
    const root = realpathSync(directory);
    const config = realpathSync(join(root, "aiw.yaml"));
    const path = relative(root, config);
    return (
      !isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${sep}`) &&
      statSync(config).isFile()
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(error.code))
    )
      return false;
    throw error;
  }
}
