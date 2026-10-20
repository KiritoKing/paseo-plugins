import type { MediaAsset, MediaCursor } from "../shared/contracts";

type Page = { assets: MediaAsset[]; hasOlder: boolean; cursor: MediaCursor | null; epoch: string };
export type AttachmentPresence = {
  status: "checking" | "present" | "empty" | "error";
  hasAttachments: boolean;
  error?: string;
};
type Entry = {
  generation: number;
  cursor?: MediaCursor;
  epoch?: string;
  state: AttachmentPresence;
};

/** Metadata-only, fair pagination. An empty tail is never a proof of empty history. */
export function createAttachmentPresence(
  fetchPage: (input: { agentId: string; cursor?: MediaCursor }) => Promise<Page>,
  changed: (agentId: string, state: AttachmentPresence) => void,
  options: { concurrency?: number; pagesPerBatch?: number } = {},
) {
  const entries = new Map<string, Entry>();
  const queue = new Set<string>();
  const concurrency = options.concurrency ?? 2;
  const pagesPerBatch = options.pagesPerBatch ?? 4;
  let running = 0;
  let disposed = false;
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  const emit = (id: string, entry: Entry, state: AttachmentPresence) => {
    entry.state = state;
    changed(id, state);
  };
  const schedule = () => {
    if (disposed || scheduled !== undefined) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      pump();
    }, 0);
  };
  const pump = () => {
    if (disposed) return;
    while (running < concurrency && queue.size) {
      const id = queue.values().next().value as string;
      queue.delete(id);
      const entry = entries.get(id);
      if (!entry) continue;
      const generation = entry.generation;
      running++;
      void (async () => {
        try {
          for (let pageNumber = 0; pageNumber < pagesPerBatch; pageNumber++) {
            const cursor = entry.cursor;
            const page = await fetchPage({ agentId: id, ...(cursor ? { cursor } : {}) });
            if (disposed || entries.get(id) !== entry || generation !== entry.generation) return;
            if (cursor && entry.epoch !== page.epoch) {
              throw new Error("Attachment history epoch changed. Refresh to retry.");
            }
            entry.epoch = page.epoch;
            if (page.assets.length) {
              emit(id, entry, { status: "present", hasAttachments: true });
              return;
            }
            if (!page.hasOlder) {
              emit(id, entry, { status: "empty", hasAttachments: false });
              return;
            }
            if (
              !page.cursor ||
              page.cursor.epoch !== page.epoch ||
              (cursor && cursor.seq <= page.cursor.seq)
            ) {
              throw new Error("Attachment history cursor did not advance.");
            }
            entry.cursor = page.cursor;
          }
          queue.add(id);
        } catch (error) {
          if (disposed || entries.get(id) !== entry || generation !== entry.generation) return;
          emit(id, entry, {
            status: "error",
            hasAttachments: entry.state.hasAttachments,
            error: error instanceof Error ? error.message : "Could not check attachments.",
          });
        } finally {
          running--;
          schedule();
        }
      })();
    }
  };

  return {
    get: (id: string) => entries.get(id)?.state,
    invalidate(id: string) {
      if (disposed) return;
      const previous = entries.get(id);
      const entry: Entry = {
        generation: (previous?.generation ?? 0) + 1,
        state: { status: "checking", hasAttachments: previous?.state.hasAttachments ?? false },
      };
      entries.set(id, entry);
      changed(id, entry.state);
      queue.add(id);
      schedule();
    },
    seen(id: string) {
      if (disposed) return;
      const entry: Entry = {
        generation: (entries.get(id)?.generation ?? 0) + 1,
        state: { status: "present", hasAttachments: true },
      };
      entries.set(id, entry);
      queue.delete(id);
      changed(id, entry.state);
    },
    remove(id: string) {
      entries.delete(id);
      queue.delete(id);
    },
    dispose() {
      disposed = true;
      if (scheduled !== undefined) clearTimeout(scheduled);
      queue.clear();
      entries.clear();
    },
  };
}
