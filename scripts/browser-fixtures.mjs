import { createReadStream } from "node:fs";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "work/browser");
const input = resolve(root, "packages/paseo-ux/tests/browser");
const packageRequire = createRequire(resolve(input, "../../package.json"));
const fixtures = [
  { name: "essentials", entry: "essentials.tsx", native: "react-native-web" },
  {
    name: "session-screen",
    entry: "session-screen.jsx",
    native: "screen-native.jsx",
    ui: "screen-ui.jsx",
  },
];

await mkdir(output, { recursive: true });
for (const fixture of fixtures) {
  await copyFile(resolve(input, `${fixture.name}.html`), resolve(output, `${fixture.name}.html`));
  await build({
    entryPoints: [resolve(input, fixture.entry)],
    outfile: resolve(output, `${fixture.name}.js`),
    bundle: true,
    platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: {
      "react-native":
        fixture.native === "react-native-web"
          ? dirname(fileURLToPath(import.meta.resolve("react-native-web/package.json")))
          : resolve(input, fixture.native),
      ...(fixture.name === "essentials"
        ? {
            react: dirname(packageRequire.resolve("react/package.json")),
            "react-dom": dirname(packageRequire.resolve("react-dom/package.json")),
            "@getpaseo/plugin/client": resolve(input, "essentials-host.tsx"),
            "@getpaseo/plugin/client/ui": resolve(input, "essentials-host.tsx"),
            "@getpaseo/plugin/client/react-native": resolve(input, "essentials-host.tsx"),
          }
        : {}),
      ...(fixture.ui ? { "@getpaseo/plugin/client/react-native": resolve(input, fixture.ui) } : {}),
    },
  });
}
console.log(`Built ${fixtures.length} browser fixtures in work/browser.`);

if (process.argv.includes("--serve")) {
  const port = Number(process.env.PORT ?? "8769");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1-65535.");
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const requested = resolve(
        output,
        `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`,
      );
      const path = await realpath(requested);
      const inside = relative(await realpath(output), path);
      if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside)) {
        response.writeHead(403).end();
        return;
      }
      const file = await stat(path);
      if (!file.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404).end("Fixture not found");
    }
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Fixtures: http://127.0.0.1:${port}/essentials.html (Ctrl+C to stop)`);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => server.close());
  }
}
