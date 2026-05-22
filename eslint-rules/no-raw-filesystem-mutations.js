const FS_MODULES = new Set(["fs", "node:fs"]);
const FS_PROMISES_MODULES = new Set(["fs/promises", "node:fs/promises"]);

const FS_SYNC_MUTATIONS = new Set([
  "appendFileSync",
  "chmodSync",
  "chownSync",
  "copyFileSync",
  "cpSync",
  "linkSync",
  "mkdirSync",
  "mkdtempSync",
  "renameSync",
  "rmSync",
  "rmdirSync",
  "symlinkSync",
  "truncateSync",
  "unlinkSync",
  "utimesSync",
  "writeFileSync",
]);

const FS_PROMISE_MUTATIONS = new Set([
  "appendFile",
  "chmod",
  "chown",
  "copyFile",
  "cp",
  "link",
  "mkdir",
  "mkdtemp",
  "rename",
  "rm",
  "rmdir",
  "symlink",
  "truncate",
  "unlink",
  "utimes",
  "writeFile",
]);

function isRequireCall(node, modules) {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "require" &&
    node.arguments.length === 1 &&
    node.arguments[0].type === "Literal" &&
    modules.has(node.arguments[0].value)
  );
}

function propertyName(property) {
  if (!property) return null;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal") return String(property.value);
  return null;
}

function report(context, node, operation) {
  context.report({
    node,
    message:
      "Raw filesystem mutation '{{operation}}' must go through src/core/filesystem-boundary.js or an explicit support-script exemption.",
    data: { operation },
  });
}

export const noRawFilesystemMutations = {
  meta: {
    type: "problem",
    docs: {
      description: "disallow raw filesystem mutations outside approved boundary surfaces",
    },
    schema: [],
    messages: {},
  },
  create(context) {
    const fsNamespaces = new Set();
    const fsPromiseNamespaces = new Set();
    const fsMutationLocals = new Map();
    const fsPromiseMutationLocals = new Map();
    const promisesLocals = new Set();

    function trackImport(node) {
      const source = node.source?.value;
      if (FS_MODULES.has(source)) {
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportNamespaceSpecifier") {
            fsNamespaces.add(specifier.local.name);
            continue;
          }
          if (specifier.type !== "ImportSpecifier") continue;
          const importedName = propertyName(specifier.imported);
          if (FS_SYNC_MUTATIONS.has(importedName)) {
            fsMutationLocals.set(specifier.local.name, importedName);
          }
          if (importedName === "promises") {
            promisesLocals.add(specifier.local.name);
          }
        }
        return;
      }

      if (FS_PROMISES_MODULES.has(source)) {
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportDefaultSpecifier" || specifier.type === "ImportNamespaceSpecifier") {
            fsPromiseNamespaces.add(specifier.local.name);
            continue;
          }
          if (specifier.type !== "ImportSpecifier") continue;
          const importedName = propertyName(specifier.imported);
          if (FS_PROMISE_MUTATIONS.has(importedName)) {
            fsPromiseMutationLocals.set(specifier.local.name, importedName);
          }
        }
      }
    }

    function trackRequire(node) {
      if (node.id.type === "Identifier") {
        if (isRequireCall(node.init, FS_MODULES)) fsNamespaces.add(node.id.name);
        if (isRequireCall(node.init, FS_PROMISES_MODULES)) fsPromiseNamespaces.add(node.id.name);
        return;
      }

      if (node.id.type !== "ObjectPattern") return;
      if (isRequireCall(node.init, FS_MODULES)) {
        for (const property of node.id.properties) {
          if (property.type !== "Property") continue;
          const importedName = propertyName(property.key);
          if (property.value.type !== "Identifier") continue;
          if (FS_SYNC_MUTATIONS.has(importedName)) {
            fsMutationLocals.set(property.value.name, importedName);
          }
          if (importedName === "promises") {
            promisesLocals.add(property.value.name);
          }
        }
      }
      if (isRequireCall(node.init, FS_PROMISES_MODULES)) {
        for (const property of node.id.properties) {
          if (property.type !== "Property") continue;
          const importedName = propertyName(property.key);
          if (property.value.type !== "Identifier") continue;
          if (FS_PROMISE_MUTATIONS.has(importedName)) {
            fsPromiseMutationLocals.set(property.value.name, importedName);
          }
        }
      }
    }

    function checkCall(node) {
      if (node.callee.type === "Identifier") {
        const syncOperation = fsMutationLocals.get(node.callee.name);
        if (syncOperation) report(context, node.callee, syncOperation);
        const promiseOperation = fsPromiseMutationLocals.get(node.callee.name);
        if (promiseOperation) report(context, node.callee, promiseOperation);
        return;
      }

      if (node.callee.type !== "MemberExpression") return;
      const member = node.callee;
      const operation = propertyName(member.property);
      if (!operation) return;

      if (member.object.type === "Identifier") {
        if (fsNamespaces.has(member.object.name) && FS_SYNC_MUTATIONS.has(operation)) {
          report(context, member.property, operation);
        }
        if (
          (fsPromiseNamespaces.has(member.object.name) || promisesLocals.has(member.object.name)) &&
          FS_PROMISE_MUTATIONS.has(operation)
        ) {
          report(context, member.property, operation);
        }
        return;
      }

      if (
        member.object.type === "MemberExpression" &&
        propertyName(member.object.property) === "promises" &&
        member.object.object.type === "Identifier" &&
        fsNamespaces.has(member.object.object.name) &&
        FS_PROMISE_MUTATIONS.has(operation)
      ) {
        report(context, member.property, `promises.${operation}`);
      }
    }

    return {
      ImportDeclaration: trackImport,
      VariableDeclarator: trackRequire,
      CallExpression: checkCall,
    };
  },
};

export default {
  rules: {
    "no-raw-filesystem-mutations": noRawFilesystemMutations,
  },
};
