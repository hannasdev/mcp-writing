import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

describe("package.json files allowlist", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const toPosixPath = (value) => value.replace(/\\/g, "/");
  const allowlist = (pkg.files ?? []).map(toPosixPath);

  test("every file listed in files exists on disk", () => {
    for (const entry of allowlist) {
      const full = path.join(root, entry);
      assert.ok(
        fs.existsSync(full),
        `package.json files entry "${entry}" does not exist on disk`
      );
    }
  });

  test("every local JS module imported by src/index.js is in the files allowlist", () => {
    const entrypointSrc = fs.readFileSync(path.join(root, "src", "index.js"), "utf8");
    const localImports = [
      ...entrypointSrc.matchAll(/^\s*import\b(?:[\s\S]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gm),
    ].map((m) => toPosixPath(path.normalize(path.join("src", m[1]))));

    for (const file of localImports) {
      const covered =
        allowlist.includes(file) ||
        allowlist.some(entry => entry.endsWith("/") && file.startsWith(entry));
      assert.ok(covered, `"${file}" is imported by src/index.js but missing from package.json files allowlist`);
    }
  });

  test("every local JS module imported by src/tools/*.js is in the files allowlist", () => {
    const toolsDir = path.join(root, "src", "tools");
    if (!fs.existsSync(toolsDir)) return;

    const toolFiles = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".js"));
    for (const toolFile of toolFiles) {
      const src = fs.readFileSync(path.join(toolsDir, toolFile), "utf8");
      const localImports = [
        ...src.matchAll(/^\s*import\b(?:[\s\S]*?\bfrom\s*)?["'](\.\.\/[^"']+)["']/gm),
      ].map((m) => toPosixPath(path.normalize(path.join("src", "tools", m[1]))));

      for (const file of localImports) {
        const covered =
          allowlist.includes(file) ||
          allowlist.some((entry) => entry.endsWith("/") && file.startsWith(entry));
        assert.ok(covered, `"${file}" is imported by src/tools/${toolFile} but missing from package.json files allowlist`);
      }
    }
  });
});

describe("package.json exports", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const require = createRequire(import.meta.url);
  const exportsField = pkg.exports ?? {};
  const exportEntries = Object.entries(exportsField).filter(
    ([subpath, target]) => typeof target === "string" && !subpath.includes("*")
  );

  function exportSpecifier(subpath) {
    return subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
  }

  test("every explicit export subpath resolves", () => {
    for (const [subpath] of exportEntries) {
      const specifier = exportSpecifier(subpath);
      const resolved = require.resolve(specifier);
      assert.ok(resolved, `Unable to resolve export subpath "${subpath}" (${specifier})`);
    }
  });

  test("safe explicit JS export subpaths can be imported", async () => {
    const importableEntries = exportEntries.filter(([subpath, target]) => {
      if (!target.endsWith(".js")) return false;
      // Importing the server entrypoint starts the process, so only resolve-check those.
      return subpath !== "." && subpath !== "./index.js";
    });

    for (const [subpath] of importableEntries) {
      const specifier = exportSpecifier(subpath);
      const loaded = await import(specifier);
      assert.ok(loaded && typeof loaded === "object", `Unable to import export subpath "${subpath}" (${specifier})`);
    }
  });
});
