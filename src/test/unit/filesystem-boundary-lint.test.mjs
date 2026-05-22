import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";
import filesystemBoundary from "../../../eslint-rules/no-raw-filesystem-mutations.js";

const ruleId = "filesystem-boundary/no-raw-filesystem-mutations";

async function lintSnippet(code, { filePath = "src/tools/example.js" } = {}) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.cjs", "**/*.js", "**/*.mjs"],
        plugins: {
          "filesystem-boundary": filesystemBoundary,
        },
        languageOptions: {
          ecmaVersion: 2024,
          sourceType: "module",
        },
        rules: {
          [ruleId]: "error",
        },
      },
      {
        files: [
          "src/core/filesystem-boundary.js",
          "src/core/git.js",
          "src/scripts/**/*.js",
          "src/scripts/**/*.mjs",
        ],
        rules: {
          [ruleId]: "off",
        },
      },
    ],
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
}

describe("filesystem boundary lint rule", () => {
  test("rejects namespace filesystem mutations in feature modules", async () => {
    const messages = await lintSnippet(`
      import fs from "node:fs";
      fs.writeFileSync(targetPath, "content", "utf8");
      fs.copyFileSync(sourcePath, targetPath);
      fs.rmSync(targetPath, { force: true });
    `);

    assert.deepEqual(messages.map((message) => message.ruleId), [ruleId, ruleId, ruleId]);
    assert.match(messages[0].message, /writeFileSync/);
    assert.match(messages[1].message, /copyFileSync/);
    assert.match(messages[2].message, /rmSync/);
  });

  test("rejects destructured and aliased filesystem mutations", async () => {
    const messages = await lintSnippet(`
      import { writeFileSync as writeNow, mkdirSync } from "node:fs";
      writeNow(targetPath, "content", "utf8");
      mkdirSync(targetDir, { recursive: true });
    `);

    assert.deepEqual(messages.map((message) => message.ruleId), [ruleId, ruleId]);
    assert.match(messages[0].message, /writeFileSync/);
    assert.match(messages[1].message, /mkdirSync/);
  });

  test("rejects fs.promises mutation forms", async () => {
    const messages = await lintSnippet(`
      import fs, { promises as fsp } from "node:fs";
      import * as fsPromises from "node:fs/promises";
      await fs.promises.writeFile(targetPath, "content", "utf8");
      await fsp.rename(sourcePath, targetPath);
      await fsPromises.copyFile(sourcePath, targetPath);
    `);

    assert.deepEqual(messages.map((message) => message.ruleId), [ruleId, ruleId, ruleId]);
    assert.match(messages[0].message, /promises\.writeFile/);
    assert.match(messages[1].message, /rename/);
    assert.match(messages[2].message, /copyFile/);
  });

  test("rejects optional chaining filesystem mutation forms", async () => {
    const messages = await lintSnippet(`
      import fs from "node:fs";
      fs?.writeFileSync?.(targetPath, "content", "utf8");
      await fs.promises?.writeFile?.(targetPath, "content", "utf8");
    `);

    assert.deepEqual(messages.map((message) => message.ruleId), [ruleId, ruleId]);
    assert.match(messages[0].message, /writeFileSync/);
    assert.match(messages[1].message, /promises\.writeFile/);
  });

  test("rejects mutations destructured from filesystem namespaces after import", async () => {
    const messages = await lintSnippet(`
      import fs from "node:fs";
      const { writeFileSync: writeNow } = fs;
      const { writeFile: writeAsync } = fs.promises;
      const { promises: { rename: renameAsync } } = fs;
      writeNow(targetPath, "content", "utf8");
      await writeAsync(targetPath, "content", "utf8");
      await renameAsync(sourcePath, targetPath);
    `);

    assert.deepEqual(messages.map((message) => message.ruleId), [ruleId, ruleId, ruleId]);
    assert.match(messages[0].message, /writeFileSync/);
    assert.match(messages[1].message, /writeFile/);
    assert.match(messages[2].message, /rename/);
  });

  test("rejects CommonJS aliases so require-based bypasses do not slip through", async () => {
    const messages = await lintSnippet(`
      const rawFs = require("node:fs");
      const { unlinkSync: unlinkNow } = require("fs");
      const fsp = require("node:fs/promises");
      rawFs.renameSync(sourcePath, targetPath);
      unlinkNow(targetPath);
      fsp.mkdir(targetDir);
    `, { filePath: "src/tools/example.cjs" });

    assert.deepEqual(messages.map((message) => message.ruleId), [ruleId, ruleId, ruleId]);
    assert.match(messages[0].message, /renameSync/);
    assert.match(messages[1].message, /unlinkSync/);
    assert.match(messages[2].message, /mkdir/);
  });

  test("permits raw mutations inside approved boundary and support-script files", async () => {
    const boundaryMessages = await lintSnippet(`
      import fs from "node:fs";
      fs.writeFileSync(targetPath, "content", "utf8");
    `, { filePath: "src/core/filesystem-boundary.js" });
    const scriptMessages = await lintSnippet(`
      import fs from "node:fs";
      fs.writeFileSync(targetPath, "content", "utf8");
    `, { filePath: "src/scripts/generate-tool-docs.mjs" });

    assert.deepEqual(boundaryMessages, []);
    assert.deepEqual(scriptMessages, []);
  });

  test("does not reject read-only filesystem calls", async () => {
    const messages = await lintSnippet(`
      import fs from "node:fs";
      fs.readFileSync(targetPath, "utf8");
      fs.existsSync(targetPath);
      fs.readdirSync(targetDir);
    `);

    assert.deepEqual(messages, []);
  });
});
