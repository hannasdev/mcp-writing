import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("package.json files allowlist", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const allowlist = pkg.files ?? [];

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
    ].map((m) => path.normalize(path.join("src", m[1])));

    for (const file of localImports) {
      const covered =
        allowlist.includes(file) ||
        allowlist.some(entry => entry.endsWith("/") && file.startsWith(entry));
      assert.ok(covered, `"${file}" is imported by src/index.js but missing from package.json files allowlist`);
    }
  });

  test("every local JS module imported by tools/*.js is in the files allowlist", () => {
    const toolsDir = path.join(root, "tools");
    if (!fs.existsSync(toolsDir)) return;

    const toolFiles = fs.readdirSync(toolsDir).filter((f) => f.endsWith(".js"));
    for (const toolFile of toolFiles) {
      const src = fs.readFileSync(path.join(toolsDir, toolFile), "utf8");
      const localImports = [
        ...src.matchAll(/^\s*import\b(?:[\s\S]*?\bfrom\s*)?["'](\.\.\/[^"']+)["']/gm),
      ].map((m) => path.normalize(path.join("tools", m[1])));

      for (const file of localImports) {
        const covered =
          allowlist.includes(file) ||
          allowlist.some((entry) => entry.endsWith("/") && file.startsWith(entry));
        assert.ok(covered, `"${file}" is imported by tools/${toolFile} but missing from package.json files allowlist`);
      }
    }
  });
});
