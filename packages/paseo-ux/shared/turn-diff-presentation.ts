export type DiffRow = {
  kind: "header" | "context" | "added" | "removed";
  text: string;
  before: number | null;
  after: number | null;
};

/** Bound rendering separately from the daemon's patch byte limit. */
export function diffRows(patch: string, limit = 2_000) {
  const rows: DiffRow[] = [];
  let before = 0;
  let after = 0;
  let inHunk = false;
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const text of lines.slice(0, limit)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    let row: DiffRow = { kind: "header", text, before: null, after: null };
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      inHunk = true;
    } else if (text.startsWith("diff --git ")) {
      inHunk = false;
    } else if (inHunk && text.startsWith("+")) {
      row = { kind: "added", text, before: null, after: after++ };
    } else if (inHunk && text.startsWith("-")) {
      row = { kind: "removed", text, before: before++, after: null };
    } else if (inHunk && text.startsWith(" ")) {
      row = { kind: "context", text, before: before++, after: after++ };
    }
    rows.push(row);
  }
  return { rows, truncated: lines.length > limit };
}
