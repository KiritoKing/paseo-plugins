import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));
const hostModules = [
  "@getpaseo/plugin",
  "@getpaseo/client",
  "react",
  "react-native",
  "react-dom",
  "@tanstack/react-query",
  "zod",
];
const moduleName = (value) =>
  value.startsWith("@") ? value.split("/").slice(0, 2).join("/") : value.split("/")[0];
const layer = (path) =>
  path.startsWith("client/") || /^index\.client\./.test(path)
    ? "client"
    : path.startsWith("server/") || /^index\.server\./.test(path)
      ? "server"
      : "shared";

export function checkPackage(packageRoot) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "work", "tests", "assets"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in plugin source: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
    }
  }
  walk(packageRoot);
  const errors = [];
  for (const file of files) {
    const name = relative(packageRoot, file).replaceAll("\\", "/");
    const sourceLayer = layer(name);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function check(specifier, typeOnly) {
      const prefix = `${pkg.name}/${name}: ${specifier}`;
      if (specifier.startsWith(".")) {
        const target = resolve(dirname(file), specifier);
        const targetName = relative(packageRoot, target).replaceAll("\\", "/");
        if (targetName.startsWith("../") || isAbsolute(targetName))
          errors.push(`${prefix}: import escapes package`);
        const targetLayer = layer(targetName);
        if (
          (sourceLayer === "shared" && targetLayer !== "shared") ||
          (sourceLayer === "client" && targetLayer === "server") ||
          (sourceLayer === "server" && targetLayer === "client")
        ) {
          errors.push(`${prefix}: ${sourceLayer} cannot import ${targetLayer}`);
        }
        return;
      }
      if (builtins.has(specifier.replace(/^node:/, ""))) {
        if (sourceLayer !== "server") errors.push(`${prefix}: Node modules belong in server`);
        return;
      }
      if (/^@getpaseo\/plugin\/client\/host(?:\/|$)/.test(specifier))
        errors.push(`${prefix}: host internals are test-only`);
      if (/^@getpaseo\/plugin\/(client|server)(?:\/|$)/.test(specifier)) {
        const targetLayer = specifier.split("/")[2];
        if (sourceLayer !== targetLayer)
          errors.push(`${prefix}: ${sourceLayer} cannot import SDK ${targetLayer}`);
      }
      const dependency = moduleName(specifier);
      const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (
        !declared[dependency] &&
        !(typeOnly && declared[`@types/${dependency.replace("@", "").replace("/", "__")}`])
      ) {
        errors.push(`${prefix}: undeclared dependency ${dependency}`);
      }
      if (!typeOnly && !hostModules.includes(dependency) && !pkg.dependencies?.[dependency]) {
        errors.push(`${prefix}: runtime library must be in dependencies`);
      }
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const typesOnly =
          clause?.isTypeOnly ||
          (!clause?.name &&
            bindings &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((item) => item.isTypeOnly));
        check(node.moduleSpecifier.text, Boolean(typesOnly));
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        check(node.moduleSpecifier.text, node.isTypeOnly);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        check(node.argument.literal.text, true);
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        if (ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text, false);
        else errors.push(`${pkg.name}/${name}: non-literal module loading cannot be checked`);
      }
      if (
        sourceLayer === "client" &&
        name !== "client/web.ts" &&
        ts.isIdentifier(node) &&
        ["document", "navigator", "localStorage"].includes(node.text)
      ) {
        errors.push(`${pkg.name}/${name}: DOM access belongs in client/web.ts`);
      }
      if (
        sourceLayer === "client" &&
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        ts.isIdentifier(node.tagName) &&
        /^[a-z]/.test(node.tagName.text)
      ) {
        errors.push(`${pkg.name}/${name}: client JSX must use React Native components`);
      }
      if (
        sourceLayer === "client" &&
        ts.isJsxAttribute(node) &&
        ["className", "onClick"].includes(node.name.getText(source))
      ) {
        errors.push(`${pkg.name}/${name}: browser-only JSX props belong in the web adapter`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../packages/", import.meta.url));
  const errors = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => checkPackage(join(root, entry.name)));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Plugin import and runtime boundaries passed.");
}
