export type DiffRow = { kind: 'hunk' | 'addition' | 'deletion' | 'context' | 'note'; text: string; oldLine?: number; newLine?: number };

/** Only hunk content enters the editor. Git headers remain metadata, never code. */
export function parseDiff(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0; let newLine = 0; let oldRemaining = 0; let newRemaining = 0;
  for (const line of patch.split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) {
      oldLine = Number(match[1]); newLine = Number(match[3]);
      oldRemaining = match[2] === undefined ? 1 : Number(match[2]);
      newRemaining = match[4] === undefined ? 1 : Number(match[4]);
      rows.push({ kind: 'hunk', text: line }); continue;
    }
    if (line === '\\ No newline at end of file') { rows.push({ kind: 'note', text: '文件末尾没有换行' }); continue; }
    if (oldRemaining === 0 && newRemaining === 0) continue;
    if (line.startsWith('+') && newRemaining > 0) { rows.push({ kind: 'addition', text: line.slice(1), newLine: newLine++ }); newRemaining--; }
    else if (line.startsWith('-') && oldRemaining > 0) { rows.push({ kind: 'deletion', text: line.slice(1), oldLine: oldLine++ }); oldRemaining--; }
    else if (line.startsWith(' ') && oldRemaining > 0 && newRemaining > 0) {
      rows.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ }); oldRemaining--; newRemaining--;
    }
  }
  return rows;
}
