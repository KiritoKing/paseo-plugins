import type { ChangedFile, ChangeGroup, FileContent, Patch } from "../shared/contracts";
import type { FileLocator } from "./navigation";

export type Reader = { locator: FileLocator; change?: ChangedFile; group?: ChangeGroup };
export type ReaderMode = "file" | "diff";
export type FileQuery = { data: FileContent | undefined; isLoading: boolean; error: unknown };
export type PatchQuery = { data: Patch | undefined; isLoading: boolean; error: unknown };
