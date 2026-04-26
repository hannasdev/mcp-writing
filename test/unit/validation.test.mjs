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

  test("every local JS module imported by index.js is in the files allowlist", () => {
    const indexSrc = fs.readFileSync(path.join(root, "index.js"), "utf8");
    const localImports = [...indexSrc.matchAll(/^import\s+.+?\s+from\s+["'](\.\/[^"']+)["']/gm)]
      .map((m) => m[1].replace(/^\.\//, ""));

    for (const file of localImports) {
      assert.ok(
        allowlist.includes(file),
        `"${file}" is imported by index.js but missing from package.json files allowlist`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// validateProjectId / validateUniverseId
// ---------------------------------------------------------------------------
