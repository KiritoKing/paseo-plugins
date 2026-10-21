import { useEffect, useState } from "react";

export { useRpc, useWorkspace } from "aiw-fixture-client";

// Paseo supplies useSettings at runtime (the npm SDK declares it without JS).
// This fixture uses schema validation and revision checks with in-memory storage.
const docs = new Map(),
  listeners = new Set();
export function useSettings(definition) {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = () => render((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  const [saveError, setError] = useState(null);
  if (!docs.has(definition.id))
    docs.set(definition.id, { values: definition.schema.parse({}), revision: "0" });
  const current = docs.get(definition.id);
  return {
    status: "ready",
    ...current,
    saving: false,
    saveError,
    reload: async () => {},
    save: async (values, revision) => {
      if (docs.get(definition.id).revision !== revision) {
        setError("设置已由其他客户端更新，请重新打开设置。");
        return false;
      }
      const parsed = definition.schema.safeParse(values);
      if (!parsed.success) {
        setError(parsed.error.message);
        return false;
      }
      docs.set(definition.id, { values: parsed.data, revision: String(Number(revision) + 1) });
      setError(null);
      for (const listener of listeners) listener();
      return true;
    },
  };
}
export const readDisplay = () => docs.get("display")?.values ?? { tabTitle: "AIW" };
