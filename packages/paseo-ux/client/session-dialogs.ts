export type SessionDialogRequest = { id: number; latest: boolean };
export function createSessionDialogs() {
  let nextId = 0;
  const requests = new Map<string, SessionDialogRequest>();
  const listeners = new Map<string, Set<() => void>>();
  const emit = (workspaceId: string) => {
    for (const listener of listeners.get(workspaceId) ?? []) listener();
  };
  return {
    get: (workspaceId: string) => requests.get(workspaceId) ?? null,
    subscribe(workspaceId: string, listener: () => void) {
      let group = listeners.get(workspaceId);
      if (!group) {
        group = new Set();
        listeners.set(workspaceId, group);
      }
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(workspaceId);
      };
    },
    open(workspaceId: string, latest = false) {
      requests.set(workspaceId, { id: ++nextId, latest });
      emit(workspaceId);
    },
    close(workspaceId: string, id: number) {
      if (requests.get(workspaceId)?.id !== id) return;
      requests.delete(workspaceId);
      emit(workspaceId);
    },
    remove(workspaceId: string) {
      requests.delete(workspaceId);
      emit(workspaceId);
    },
    dispose() {
      const ids = [...requests.keys()];
      requests.clear();
      for (const id of ids) emit(id);
      listeners.clear();
    },
  };
}
export type SessionDialogs = ReturnType<typeof createSessionDialogs>;
