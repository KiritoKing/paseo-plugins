// Host-independent glob matching; paths use Git's '/' separator.
export function matchesGlob(pattern: string, path: string): boolean {
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') { index++; expression += '(?:.*/)?'; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += ('.+^$()[]{}|\\'.includes(char) ? '\\' : '') + char;
  }
  return new RegExp(expression + '$').test(path);
}
export function matchesPatterns(path: string, oldPath: string | undefined, include: readonly string[], exclude: readonly string[]): boolean {
  const paths = oldPath ? [path, oldPath] : [path];
  return !paths.some(value => exclude.some(pattern => matchesGlob(pattern, value))) &&
    paths.some(value => include.some(pattern => matchesGlob(pattern, value)));
}
