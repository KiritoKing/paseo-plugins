export type FileLocator = {
  workspaceId: string;
  repoId: string;
  path: string;
  line?: number;
};

const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

/** Search commands reuse the business panel, including before its first mount. */
export function requestSearchFocus(workspaceId: string): void {
  const callbacks = listeners.get(workspaceId);
  if (callbacks?.size) for (const callback of callbacks) callback();
  else pending.add(workspaceId);
}

export function subscribeToSearchFocus(workspaceId: string, listener: () => void): () => void {
  const callbacks = listeners.get(workspaceId) ?? new Set();
  callbacks.add(listener);
  listeners.set(workspaceId, callbacks);
  if (pending.delete(workspaceId)) listener();
  return () => {
    callbacks.delete(listener);
    if (!callbacks.size) listeners.delete(workspaceId);
  };
}
