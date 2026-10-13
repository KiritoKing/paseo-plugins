import { refractor } from 'refractor/core';
import tsx from 'refractor/tsx';
import css from 'refractor/css';
import json from 'refractor/json';
import yaml from 'refractor/yaml';
import markdown from 'refractor/markdown';
import go from 'refractor/go';
import bash from 'refractor/bash';
import python from 'refractor/python';
import sql from 'refractor/sql';
import protobuf from 'refractor/protobuf';
import type { RootContent } from 'hast';
import type { PluginTheme } from '@getpaseo/plugin';

for (const grammar of [tsx, css, json, yaml, markdown, go, bash, python, sql, protobuf]) refractor.register(grammar);

export type Segment = { text: string; classes: string[] };
export type Highlighted = { language: string; lines: Segment[][]; limited: boolean };
const extensions: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'javascript', yaml: 'yaml', yml: 'yaml', md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'css', less: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  go: 'go', sh: 'bash', bash: 'bash', zsh: 'bash', env: 'bash', py: 'python', sql: 'sql', proto: 'protobuf',
};
export function languageFor(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === '.env' || name.startsWith('.env.')) return 'bash';
  return extensions[name.split('.').pop() ?? ''] ?? 'text';
}

function flatten(nodes: RootContent[], inherited: string[] = []): Segment[] {
  return nodes.flatMap(node => {
    if (node.type === 'text') return [{ text: node.value, classes: inherited }];
    if (node.type !== 'element') return [];
    const names = node.properties.className;
    const classes = Array.isArray(names) ? names.map(String).filter(name => name !== 'token') : [];
    return flatten(node.children, [...inherited, ...classes]);
  });
}

export function highlightCode(code: string, path: string): Highlighted {
  const language = languageFor(path);
  const limited = code.length > 250_000;
  const segments = language === 'text' || limited ? [{ text: code, classes: [] }] : flatten(refractor.highlight(code, language).children);
  const lines: Segment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split('\n');
    parts.forEach((text, index) => {
      if (index) lines.push([]);
      if (text) lines[lines.length - 1].push({ text, classes: segment.classes });
    });
  }
  return { language, lines, limited };
}

/** Syntax colors follow the selected host palette, including light and dark themes. */
export function tokenColor(classes: readonly string[], theme: PluginTheme): string {
  if (classes.some(name => ['comment', 'prolog', 'doctype', 'cdata'].includes(name))) return theme.colors.foregroundMuted;
  if (classes.some(name => ['string', 'char', 'attr-value', 'regex', 'inserted'].includes(name))) return theme.colors.statusSuccess;
  if (classes.some(name => ['number', 'boolean', 'constant', 'class-name', 'builtin'].includes(name))) return theme.colors.statusWarning;
  if (classes.some(name => ['keyword', 'function', 'tag', 'property', 'attr-name', 'selector', 'title', 'important'].includes(name))) return theme.colors.accent;
  if (classes.includes('deleted')) return theme.colors.statusDanger;
  if (classes.some(name => ['punctuation', 'operator'].includes(name))) return theme.colors.foregroundMuted;
  return theme.colors.foreground;
}

export function tint(color: string, surface: string, amount = 0.12): string {
  const rgb = (value: string): number[] | null => {
    const hex = value.replace(/^#/, '');
    if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(hex)) return null;
    const full = hex.length === 3 ? [...hex].map(char => char + char).join('') : hex;
    return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16));
  };
  const foreground = rgb(color); const background = rgb(surface);
  if (!foreground || !background) return surface;
  return '#' + background.map((value, index) => Math.round(value * (1 - amount) + foreground[index] * amount).toString(16).padStart(2, '0')).join('');
}
