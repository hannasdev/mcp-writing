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

function unwrapChainExpression(node) {
  let current = node;
  while (current?.type === "ChainExpression") {
    current = current.expression;
  }
  return current;
}

function localIdentifierName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "AssignmentPattern" && node.left.type === "Identifier") return node.left.name;
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

    function trackPromiseObjectPattern(pattern) {
      for (const property of pattern.properties) {
        if (property.type !== "Property") continue;
        const importedName = propertyName(property.key);
        const localName = localIdentifierName(property.value);
        if (localName && FS_PROMISE_MUTATIONS.has(importedName)) {
          fsPromiseMutationLocals.set(localName, importedName);
        }
      }
    }

    function trackFsObjectPattern(pattern) {
      for (const property of pattern.properties) {
        if (property.type !== "Property") continue;
        const importedName = propertyName(property.key);
        const localName = localIdentifierName(property.value);
        if (localName && FS_SYNC_MUTATIONS.has(importedName)) {
          fsMutationLocals.set(localName, importedName);
        }
        if (importedName === "promises") {
          if (localName) {
            promisesLocals.add(localName);
          } else if (property.value.type === "ObjectPattern") {
            trackPromiseObjectPattern(property.value);
          }
        }
      }
    }

    function isFsNamespaceExpression(node) {
      const expression = unwrapChainExpression(node);
      return expression?.type === "Identifier" && fsNamespaces.has(expression.name);
    }

    function isFsPromisesExpression(node) {
      const expression = unwrapChainExpression(node);
      if (expression?.type === "Identifier") {
        return fsPromiseNamespaces.has(expression.name) || promisesLocals.has(expression.name);
      }
      if (expression?.type !== "MemberExpression") return false;
      const object = unwrapChainExpression(expression.object);
      return (
        propertyName(expression.property) === "promises" &&
        object?.type === "Identifier" &&
        fsNamespaces.has(object.name)
      );
    }

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
        trackFsObjectPattern(node.id);
      }
      if (isRequireCall(node.init, FS_PROMISES_MODULES)) {
        trackPromiseObjectPattern(node.id);
      }
      if (isFsNamespaceExpression(node.init)) {
        trackFsObjectPattern(node.id);
      }
      if (isFsPromisesExpression(node.init)) {
        trackPromiseObjectPattern(node.id);
      }
    }

    function checkCall(node) {
      const callee = unwrapChainExpression(node.callee);
      if (callee.type === "Identifier") {
        const syncOperation = fsMutationLocals.get(callee.name);
        if (syncOperation) report(context, callee, syncOperation);
        const promiseOperation = fsPromiseMutationLocals.get(callee.name);
        if (promiseOperation) report(context, callee, promiseOperation);
        return;
      }

      if (callee.type !== "MemberExpression") return;
      const member = callee;
      const operation = propertyName(member.property);
      if (!operation) return;
      const object = unwrapChainExpression(member.object);

      if (object.type === "Identifier") {
        if (fsNamespaces.has(object.name) && FS_SYNC_MUTATIONS.has(operation)) {
          report(context, member.property, operation);
        }
        if ((fsPromiseNamespaces.has(object.name) || promisesLocals.has(object.name)) && FS_PROMISE_MUTATIONS.has(operation)) {
          report(context, member.property, operation);
        }
        return;
      }

      if (
        object.type === "MemberExpression" &&
        propertyName(object.property) === "promises" &&
        unwrapChainExpression(object.object)?.type === "Identifier" &&
        fsNamespaces.has(unwrapChainExpression(object.object).name) &&
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
