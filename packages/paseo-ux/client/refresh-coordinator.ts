export type RefreshKind = "head" | "older";

export type RefreshCoordinator<Cursor> = {
  activate(checkCurrent: () => boolean): void;
  request(kind?: RefreshKind, cursor?: Cursor | null): Promise<void>;
  invalidate(): void;
  dispose(): void;
};

type RefreshCoordinatorOptions<Page, Cursor> = {
  load: (kind: RefreshKind, cursor: Cursor | null) => Promise<Page>;
  onPage: (page: Page, kind: RefreshKind) => void;
  onError: (cause: unknown) => void;
  onSettled?: () => void;
};

export function createRefreshCoordinator<Page, Cursor>(
  options: RefreshCoordinatorOptions<Page, Cursor>,
): RefreshCoordinator<Cursor> {
  let isCurrent: (() => boolean) | null = null;
  let disposed = false;
  let inFlight = false;
  let pendingHead = false;
  let historyRevision = 0;
  let activation = 0;
  const pendingWaiters: Array<() => void> = [];

  const active = (expectedActivation: number) =>
    !disposed && activation === expectedActivation && isCurrent?.() === true;

  const resolveWaiters = (waiters: Array<() => void>) => {
    for (const resolve of waiters) resolve();
  };

  const run = async (kind: RefreshKind, cursor: Cursor | null, expectedActivation: number) => {
    if (!active(expectedActivation)) return;
    inFlight = true;
    const revision = historyRevision;
    try {
      const page = await options.load(kind, cursor);
      if (active(expectedActivation) && revision === historyRevision) options.onPage(page, kind);
    } catch (cause) {
      if (active(expectedActivation) && revision === historyRevision) options.onError(cause);
    } finally {
      if (active(expectedActivation) && revision === historyRevision && !pendingHead)
        options.onSettled?.();

      inFlight = false;
      if (!active(expectedActivation)) {
        pendingHead = false;
        resolveWaiters(pendingWaiters.splice(0));
      } else if (pendingHead) {
        pendingHead = false;
        const waiters = pendingWaiters.splice(0);
        const followup = run("head", null, expectedActivation);
        void followup.then(
          () => resolveWaiters(waiters),
          () => resolveWaiters(waiters),
        );
      }
    }
  };

  return {
    activate(checkCurrent) {
      if (disposed) return;
      activation++;
      isCurrent = checkCurrent;
    },
    request(kind = "head", cursor = null) {
      const expectedActivation = activation;
      if (!active(expectedActivation)) return Promise.resolve();
      if (inFlight) {
        pendingHead = true;
        return new Promise<void>((resolve) => pendingWaiters.push(resolve));
      }
      return run(kind, cursor, expectedActivation);
    },
    invalidate() {
      if (!disposed) historyRevision++;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activation++;
      historyRevision++;
      pendingHead = false;
      resolveWaiters(pendingWaiters.splice(0));
    },
  };
}
