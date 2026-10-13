export type FileLocator = {
  workspaceId: string;
  repoId: string;
  path: string;
  line?: number;
};

type Listener = (locator: FileLocator) => void;

let latest: FileLocator | null = null;
const listeners = new Set<Listener>();

/** A small client-local bridge between search results and the business reader. */
export function requestFile(locator: FileLocator): void {
  latest = locator;
  for (const listener of listeners) listener(locator);
}

export function subscribeToFileRequests(listener: Listener): () => void {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => listeners.delete(listener);
}
