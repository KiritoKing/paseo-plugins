import type { RpcOutput } from "@getpaseo/plugin";
import { type layoutRpcs, layoutValuesSchema, type WorkspaceLayout } from "../shared/layout";

export async function saveWorkspaceLayout(
  workspaceId: string,
  layout: WorkspaceLayout,
  read: () => Promise<RpcOutput<typeof layoutRpcs.read>>,
  write: (input: {
    revision: string;
    values: ReturnType<typeof layoutValuesSchema.parse>;
  }) => Promise<RpcOutput<typeof layoutRpcs.write>>,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const snapshot = await read();
    if (snapshot.status !== "ready") throw new Error(snapshot.error);
    const values = layoutValuesSchema.parse(snapshot.values);
    const result = await write({
      revision: snapshot.revision,
      values: { workspaces: { ...values.workspaces, [workspaceId]: layout } },
    });
    if (result.status === "saved") return;
    if (result.status !== "conflict" || attempt === 1) throw new Error(result.error);
  }
}
