import {
  type ChangedFile,
  type ChangeGroup,
  defaultCodeIncludes,
  effectiveIncludes,
  type ProjectPreference,
} from "./contracts";
import { matchesPatterns } from "./patterns";

export type PatternKind = "code" | "documents";
export type FileFilter = "all" | PatternKind;

export function matchesFileFilter(
  file: ChangedFile,
  filter: FileFilter,
  saved?: ProjectPreference,
): boolean {
  if (filter === "all") return true;
  const include =
    filter === "code"
      ? (saved?.codeInclude ?? defaultCodeIncludes)
      : effectiveIncludes(saved?.include);
  const exclude = filter === "code" ? (saved?.codeExclude ?? []) : (saved?.exclude ?? []);
  return matchesPatterns(file.path, file.oldPath, include, exclude);
}

export function filterChangeGroups(
  groups: ChangeGroup[],
  filter: FileFilter,
  saved?: ProjectPreference,
): ChangeGroup[] {
  return groups
    .map((group) => ({
      ...group,
      files: group.files.filter((file) => matchesFileFilter(file, filter, saved)),
    }))
    .filter((group) => filter === "all" || group.files.length > 0 || group.error !== null);
}
