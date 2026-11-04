export type TurnSelection = { turnId: string | null; path: string | null; request: number };
const empty: TurnSelection = { turnId: null, path: null, request: 0 };

/** Installation-local navigation, shared by cards and the mounted agent panel. */
export function createTurnSelections() {
  const selections = new Map<string, TurnSelection>();
  const listeners = new Map<string, Set<() => void>>();
  let request = 0;
  const clear = () => {
    selections.clear();
    for (const group of listeners.values()) for (const listener of group) listener();
  };
  return {
    get: (agentId: string) => selections.get(agentId) ?? empty,
    select(agentId: string, turnId: string | null, path: string | null = null) {
      selections.set(agentId, { turnId, path, request: ++request });
      for (const listener of listeners.get(agentId) ?? []) listener();
    },
    subscribe(agentId: string, listener: () => void) {
      let group = listeners.get(agentId);
      if (!group) {
        group = new Set();
        listeners.set(agentId, group);
      }
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(agentId);
      };
    },
    clear,
    dispose() {
      clear();
      listeners.clear();
    },
  };
}
export type TurnSelections = ReturnType<typeof createTurnSelections>;
