import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "paseo-biome-rules-"));
const biome = resolve(root, "node_modules/.bin/biome");
const environment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(directory, "global-git-config"),
  GIT_CONFIG_SYSTEM: join(directory, "system-git-config"),
};
writeFileSync(environment.GIT_CONFIG_GLOBAL, "");
writeFileSync(environment.GIT_CONFIG_SYSTEM, "");
cpSync(join(root, "biome.json"), join(directory, "biome.json"));
cpSync(join(root, "lint"), join(directory, "lint"), { recursive: true });
const initialized = spawnSync("git", ["init", "--quiet"], {
  cwd: directory,
  env: environment,
  encoding: "utf8",
});
assert.equal(initialized.status, 0, initialized.stderr);
after(() => rmSync(directory, { recursive: true, force: true }));

function lint(path, source) {
  const file = join(directory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source + "\n");
  const result = spawnSync(biome, ["lint", path, "--reporter=json"], {
    cwd: directory,
    env: environment,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.ifError(result.error);
  assert.ok(!result.signal, `Biome was terminated: ${result.signal}`);
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    assert.fail(`Biome did not return diagnostics: ${result.stderr}\n${result.stdout}`);
  }
  return { status: result.status, diagnostics: report.diagnostics ?? [] };
}

const native = "packages/paseo-ux/client";
const server = "packages/paseo-ux/server";
const category = "lint/style/noRestrictedGlobals";
const cases = [
  ["navigator", `${native}/navigator.ts`, "export const value = navigator.clipboard;", category],
  [
    "storage",
    `${native}/storage.ts`,
    "export const value = localStorage.getItem('key');",
    category,
  ],
  [
    "other native DOM",
    "packages/another-plugin/client/native.ts",
    "export const value = document.body;",
    category,
  ],
  [
    "shared native runtime",
    "packages/paseo-ux/shared/native.ts",
    'export { View } from "react-native";',
    "lint/style/noRestrictedImports",
  ],
  ["bare DOM", `${native}/dom.ts`, "export const value = document.body;", category],
  ["global DOM", `${native}/global.ts`, "export const value = globalThis.document;", category],
  [
    "computed DOM",
    `${native}/computed.ts`,
    'export const value = globalThis["document"];',
    category,
  ],
  ["window DOM", `${native}/window.ts`, "export const value = window.document;", category],
  ["adapter bypass", `${native}/web.ts`, "export const value = document.body;", category],
  [
    "native Node",
    `${native}/node.ts`,
    'export { readFile } from "node:fs";',
    "lint/correctness/noNodejsModules",
  ],
  [
    "shared Node",
    "packages/paseo-ux/shared/node.ts",
    'export { readFile } from "node:fs";',
    "lint/correctness/noNodejsModules",
  ],
  [
    "shared Buffer",
    "packages/paseo-ux/shared/buffer.ts",
    "export const value = Buffer.from('x');",
    category,
  ],
  [
    "host internals",
    `${native}/host.ts`,
    'export { usePaseo } from "@getpaseo/plugin/client/host";',
    "lint/style/noRestrictedImports",
  ],
  [
    "private SDK",
    `${server}/private.ts`,
    'export { value } from "@getpaseo/client/dist/private.js";',
    "lint/style/noRestrictedImports",
  ],
  [
    "CLI discovery",
    `${server}/cli.ts`,
    'export const value = require.resolve("@getpaseo/cli");',
    "plugin",
    "Import public SDK entrypoints",
  ],
  [
    "private CLI discovery",
    `${server}/cli-dist.ts`,
    'export const value = require.resolve("@getpaseo/cli/dist/index.js");',
    "plugin",
    "Import public SDK entrypoints",
  ],
  [
    "HTML",
    `${native}/html.tsx`,
    "export const Panel = () => <div />;",
    "plugin",
    "Native client JSX must use React Native components",
  ],
  [
    "HTML children",
    `${native}/children.tsx`,
    "export const Panel = () => <section>Content</section>;",
    "plugin",
    "Native client JSX must use React Native components",
  ],
  [
    "onClick",
    `${native}/click.tsx`,
    'import { View } from "react-native"; export const Panel = () => <View onClick={() => {}} />;',
    "plugin",
    "browser-only element props",
  ],
  [
    "className",
    `${native}/class-name.tsx`,
    'import { View } from "react-native"; export const Panel = () => <View className="panel" />;',
    "plugin",
    "browser-only element props",
  ],
  [
    "onWheel",
    `${native}/wheel.tsx`,
    'import { View } from "react-native"; export const Panel = () => <View onWheel={() => {}} />;',
    "plugin",
    "browser-only element props",
  ],
  [
    "direct prototype",
    `${server}/direct.ts`,
    "KeyboardEvent.prototype.stopImmediatePropagation = () => {};",
    "plugin",
    "Do not modify native",
  ],
  [
    "computed prototype",
    `${server}/computed.ts`,
    'EventTarget.prototype["addEventListener"] = () => {};',
    "plugin",
    "Do not modify native",
  ],
  [
    "reflective prototype",
    `${server}/define.ts`,
    'Object.defineProperty(KeyboardEvent.prototype, "stopImmediatePropagation", {value() {}});',
    "plugin",
    "Do not modify native",
  ],
  [
    "assign prototype",
    `${server}/assign.ts`,
    "Object.assign(Array.prototype, {map() {}});",
    "plugin",
    "Do not modify native",
  ],
  [
    "global prototype",
    `${server}/global.ts`,
    'Reflect.set(globalThis.EventTarget.prototype, "dispatchEvent", () => {});',
    "plugin",
    "Do not modify native",
  ],
];

for (const [name, path, source, expectedCategory, message] of cases) {
  test(`Biome rejects ${name} using the actual root rules`, () => {
    const result = lint(path, source);
    assert.equal(result.status, 1, JSON.stringify(result));
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.category === expectedCategory &&
          (!message || diagnostic.message.includes(message)),
      ),
      JSON.stringify(result.diagnostics),
    );
  });
}

test("Biome permits native APIs, local window/document bindings and attachment metadata", () => {
  const result = lint(
    `${native}/good.tsx`,
    'import { View, Text, Modal, PanResponder } from "react-native"; const window = {width: 1}; const document = {title: "local"}; export const labels = {document: "Documents"}; export const responder = PanResponder.create({}); export const Panel = () => <Modal><View onLayout={() => {}}><Text>{window.width}{document.title}</Text></View></Modal>;',
  );
  assert.equal(result.status, 0, JSON.stringify(result.diagnostics));
});

test("Biome permits plugin class prototypes, server Node and another plugin's explicit adapter", () => {
  for (const [path, source] of [
    [`${native}/public-sdk.ts`, 'export { useRpc } from "@getpaseo/plugin/client";'],
    ["packages/paseo-ux/shared/public-sdk.ts", 'export { defineRpc } from "@getpaseo/plugin";'],
    [
      `${server}/own-class.ts`,
      "export class Widget { value() {} } Widget.prototype.value = () => {};",
    ],
    [`${server}/node.ts`, 'export { readFile } from "node:fs";'],
    ["packages/another-plugin/client/web.ts", "export const value = document.body;"],
    [
      "packages/paseo-ux/tests/browser/fixture.tsx",
      "export const Fixture = () => <button type='button' onClick={() => {}}>Fixture</button>;",
    ],
  ]) {
    const result = lint(path, source);
    assert.equal(result.status, 0, JSON.stringify({ path, diagnostics: result.diagnostics }));
  }
});
