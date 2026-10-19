import type { Scope } from "../shared/contracts";
import type { Reader } from "./model";

export function patchQueryKey(workspaceId: string, reader: Reader | null, scope: Scope): readonly unknown[] {
  return ["aiw", "patch", workspaceId, reader?.locator.repoId, reader?.locator.path,
    reader?.change?.oldPath, reader?.change?.origin, scope, reader?.group?.snapshotId];
}

// Preserve an open diff during a snapshot update, never across files or comparison scopes.
export function retainPatchData<T>(previous: T | undefined, previousKey: readonly unknown[] | undefined, nextKey: readonly unknown[]): T | undefined {
  return previousKey?.length === nextKey.length && nextKey.slice(0, -1).every((value, index) => value === previousKey[index]) ? previous : undefined;
}
