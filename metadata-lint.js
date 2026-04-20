import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  inferProjectAndUniverse,
  isCanonicalWorldEntityFile,
  isWorldFile,
  parseFile,
  sidecarPath,
  walkFiles,
  walkSidecars,
  worldEntityFolderKey,
  worldEntityKindForPath,
} from "./sync.js";
import yaml from "js-yaml";

const { load: parseYaml } = yaml;

const metadataKindSchema = z.enum(["scene", "character", "place"]);

const threadLinkSchema = z.object({
  thread_id: z.string().min(1),
  beat: z.string().min(1).optional(),
  thread_name: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
});

const sceneSchema = z.object({
  scene_id: z.string().min(1),
  external_source: z.string().min(1).optional(),
  external_id: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  part: z.number().int().positive().optional(),
  chapter: z.number().int().positive().optional(),
  pov: z.string().min(1).optional(),
  logline: z.string().min(1).optional(),
  save_the_cat_beat: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  timeline_position: z.number().int().optional(),
  story_time: z.string().min(1).optional(),
  word_count: z.number().int().nonnegative().optional(),
  scene_change: z.string().min(1).optional(),
  causality: z.string().min(1).optional(),
  stakes: z.string().min(1).optional(),
  scene_functions: z.array(z.string().min(1)).optional(),
  characters: z.array(z.string().min(1)).optional(),
  places: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  versions: z.array(z.string().min(1)).optional(),
  threads: z.array(threadLinkSchema).optional(),
});

const characterSchema = z.object({
  character_id: z.string().min(1),
  canonical: z.boolean().optional(),
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
  arc_summary: z.string().min(1).optional(),
  first_appearance: z.string().min(1).optional(),
  traits: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

const placeSchema = z.object({
  place_id: z.string().min(1),
  canonical: z.boolean().optional(),
  name: z.string().min(1).optional(),
  associated_characters: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

const sceneAllowedKeys = new Set(Object.keys(sceneSchema.shape));
const characterAllowedKeys = new Set(Object.keys(characterSchema.shape));
const placeAllowedKeys = new Set(Object.keys(placeSchema.shape));
const sceneLegacyKeys = new Set(["synopsis", "save_the_cat", "change"]);

function uniqueItems(items = []) {
  return new Set(items).size === items.length;
}

export function detectMetadataKind(meta) {
  if (meta && typeof meta === "object") {
    if (typeof meta.character_id === "string") return "character";
    if (typeof meta.place_id === "string") return "place";
    return "scene";
  }
  return "scene";
}

function allowedKeysFor(kind) {
  if (kind === "character") return characterAllowedKeys;
  if (kind === "place") return placeAllowedKeys;
  return sceneAllowedKeys;
}

function schemaFor(kind) {
  if (kind === "character") return characterSchema;
  if (kind === "place") return placeSchema;
  return sceneSchema;
}

function validateUniqueArrays(meta, kind, issues) {
  const fields = kind === "scene"
    ? ["characters", "places", "tags", "scene_functions", "versions"]
    : kind === "character"
      ? ["traits", "tags"]
      : ["associated_characters", "tags"];

  for (const key of fields) {
    if (Array.isArray(meta[key]) && !uniqueItems(meta[key])) {
      issues.push({
        level: "warning",
        code: "DUPLICATE_ARRAY_ITEMS",
        message: `Array '${key}' contains duplicate values.`,
      });
    }
  }
}

export function validateMetadataObject(meta, { sourcePath, kindHint } = {}) {
  const issues = [];
  const kind = metadataKindSchema.parse(kindHint ?? detectMetadataKind(meta));
  const schema = schemaFor(kind);
  const allowed = allowedKeysFor(kind);

  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {
      ok: false,
      kind,
      issues: [{
        level: "error",
        code: "INVALID_METADATA_OBJECT",
        message: "Metadata must be a YAML mapping/object.",
      }],
    };
  }

  const parsed = schema.safeParse(meta);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        level: "error",
        code: "SCHEMA_VALIDATION_ERROR",
        message: `${issue.path.join(".") || "metadata"}: ${issue.message}`,
      });
    }
  }

  for (const key of Object.keys(meta)) {
    if (kind === "scene" && sceneLegacyKeys.has(key)) {
      issues.push({
        level: "warning",
        code: "LEGACY_SCENE_KEY",
        message: `Legacy scene key '${key}' found. Prefer canonical sidecar keys.`,
      });
      continue;
    }
    if (!allowed.has(key)) {
      issues.push({
        level: "warning",
        code: "UNKNOWN_KEY",
        message: `Unknown key '${key}' for ${kind} metadata.`,
      });
    }
  }

  validateUniqueArrays(meta, kind, issues);

  if (kind === "scene" && sourcePath) {
    const sidecar = sourcePath.endsWith(".meta.yaml");
    if (sidecar && !meta.scene_id) {
      issues.push({
        level: "error",
        code: "MISSING_SCENE_ID",
        message: "Scene sidecar is missing required 'scene_id'.",
      });
    }
  }

  const hasErrors = issues.some(i => i.level === "error");
  return { ok: !hasErrors, kind, issues };
}

function loadYamlFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseYaml(raw);
    return { ok: true, value: parsed ?? {} };
  } catch (err) {
    return {
      ok: false,
      error: {
        level: "error",
        code: "YAML_PARSE_ERROR",
        message: `Failed to parse YAML: ${err.message}`,
      },
    };
  }
}

function lintSidecar(filePath) {
  const loaded = loadYamlFile(filePath);
  if (!loaded.ok) {
    return {
      file: filePath,
      kind: "scene",
      issues: [loaded.error],
    };
  }
  const result = validateMetadataObject(loaded.value, { sourcePath: filePath });
  return { file: filePath, kind: result.kind, issues: result.issues };
}

function lintFrontmatter(filePath) {
  try {
    const { data } = parseFile(filePath);
    if (!data || !Object.keys(data).length) return null;
    const result = validateMetadataObject(data, { sourcePath: filePath });
    return { file: filePath, kind: result.kind, issues: result.issues };
  } catch (err) {
    return {
      file: filePath,
      kind: "scene",
      issues: [{
        level: "error",
        code: "FRONTMATTER_PARSE_ERROR",
        message: `Failed to parse frontmatter: ${err.message}`,
      }],
    };
  }
}

function loadMetadataForFile(filePath) {
  const sidecar = sidecarPath(filePath);
  if (fs.existsSync(sidecar)) {
    const loaded = loadYamlFile(sidecar);
    return loaded.ok ? loaded.value : null;
  }

  try {
    const { data } = parseFile(filePath);
    return data && Object.keys(data).length ? data : {};
  } catch {
    return null;
  }
}

function reportPathForFile(filePath) {
  const sidecar = sidecarPath(filePath);
  return fs.existsSync(sidecar) ? sidecar : filePath;
}

function addIssueToReport(reports, filePath, kind, issue) {
  const reportFile = reportPathForFile(filePath);
  const report = reports.find(r => r.file === reportFile);
  if (report) {
    report.issues.push(issue);
    return;
  }
  reports.push({ file: reportFile, kind, issues: [issue] });
}

function shouldWarnNoMetadata(syncDir, filePath) {
  if (!isWorldFile(syncDir, filePath)) return true;

  const kind = worldEntityKindForPath(syncDir, filePath);
  if (!kind) return false;

  return isCanonicalWorldEntityFile(syncDir, filePath, {});
}

function compareSidecarAndFrontmatter(filePath, reports) {
  const sidecar = sidecarPath(filePath);
  if (!fs.existsSync(sidecar)) return;
  const sc = reports.find(r => r.file === sidecar);
  if (!sc) return;

  try {
    const { data } = parseFile(filePath);
    if (!data || !Object.keys(data).length) return;
    const sidecarData = parseYaml(fs.readFileSync(sidecar, "utf8")) ?? {};

    if (typeof data.scene_id === "string" && typeof sidecarData.scene_id === "string" && data.scene_id !== sidecarData.scene_id) {
      sc.issues.push({
        level: "warning",
        code: "SCENE_ID_MISMATCH",
        message: `scene_id mismatch between frontmatter ('${data.scene_id}') and sidecar ('${sidecarData.scene_id}').`,
      });
    }
  } catch {
    // Parsing failures are already surfaced by individual report entries.
  }
}

export function lintMetadataInSyncDir(syncDir) {
  const reports = [];
  const files = walkFiles(syncDir);

  for (const sidecar of walkSidecars(syncDir)) {
    reports.push(lintSidecar(sidecar));
  }

  for (const file of files) {
    if (fs.existsSync(sidecarPath(file))) {
      continue;
    }
    const frontmatterReport = lintFrontmatter(file);
    if (frontmatterReport) {
      reports.push(frontmatterReport);
    } else if (shouldWarnNoMetadata(syncDir, file)) {
      // No sidecar and no frontmatter — file will be silently skipped during sync
      reports.push({
        file,
        kind: "scene",
        issues: [{
          level: "warning",
          code: "NO_METADATA",
          message: "File has no sidecar and no frontmatter — will be skipped during sync (no scene_id).",
        }],
      });
    }
  }

  for (const file of files) {
    compareSidecarAndFrontmatter(file, reports);
  }

  // --- Duplicate scene_id detection (cross-file, errors) ---
  const sceneIdToFiles = new Map(); // scene_id → [filePath, ...]

  for (const sidecar of walkSidecars(syncDir)) {
    try {
      const raw = fs.readFileSync(sidecar, "utf8");
      const meta = parseYaml(raw) ?? {};
      if (typeof meta.scene_id === "string" && meta.scene_id) {
        const arr = sceneIdToFiles.get(meta.scene_id) ?? [];
        arr.push(sidecar);
        sceneIdToFiles.set(meta.scene_id, arr);
      }
    } catch { /* empty */ }
  }
  for (const file of files) {
    if (fs.existsSync(sidecarPath(file))) continue; // already counted via sidecar
    try {
      const { data } = parseFile(file);
      if (typeof data.scene_id === "string" && data.scene_id) {
        const arr = sceneIdToFiles.get(data.scene_id) ?? [];
        arr.push(file);
        sceneIdToFiles.set(data.scene_id, arr);
      }
    } catch { /* empty */ }
  }

  for (const [sceneId, dupeFiles] of sceneIdToFiles) {
    if (dupeFiles.length < 2) continue;
    const relPaths = dupeFiles.map(f => path.relative(syncDir, f)).join(", ");
    for (const f of dupeFiles) {
      const report = reports.find(r => r.file === f);
      const issue = {
        level: "error",
        code: "DUPLICATE_SCENE_ID",
        message: `scene_id "${sceneId}" is used by ${dupeFiles.length} files: ${relPaths}`,
      };
      if (report) {
        report.issues.push(issue);
      } else {
        reports.push({ file: f, kind: "scene", issues: [issue] });
      }
    }
  }

  const entityIdToFiles = new Map();
  const canonicalFilesByFolder = new Map();

  for (const file of files) {
    const kind = worldEntityKindForPath(syncDir, file);
    if (!kind) continue;

    const meta = loadMetadataForFile(file);
    if (!meta) continue;
    if (!isCanonicalWorldEntityFile(syncDir, file, meta)) continue;

    const folderKey = worldEntityFolderKey(syncDir, file, kind);
    if (folderKey) {
      const current = canonicalFilesByFolder.get(folderKey) ?? [];
      current.push(file);
      canonicalFilesByFolder.set(folderKey, current);
    }

    const entityId = kind === "character" ? meta.character_id : meta.place_id;
    if (typeof entityId === "string" && entityId) {
      const { universe_id, project_id } = inferProjectAndUniverse(syncDir, file);
      const scopeKey = `${kind}:${universe_id ?? "-"}:${project_id ?? "-"}:${entityId}`;
      const current = entityIdToFiles.get(scopeKey) ?? [];
      current.push(file);
      entityIdToFiles.set(scopeKey, current);
    } else {
      addIssueToReport(reports, file, kind, {
        level: "warning",
        code: kind === "character" ? "MISSING_CHARACTER_ID" : "MISSING_PLACE_ID",
        message: `Canonical ${kind} file is missing required '${kind}_id'.`,
      });
    }
  }

  for (const [folderKey, canonicalFiles] of canonicalFilesByFolder) {
    if (canonicalFiles.length < 2) continue;
    const relPaths = canonicalFiles.map(f => path.relative(syncDir, f)).join(", ");
    for (const file of canonicalFiles) {
      addIssueToReport(reports, file, worldEntityKindForPath(syncDir, file), {
        level: "error",
        code: "MULTIPLE_CANONICAL_FILES",
        message: `Multiple canonical files found in entity folder '${folderKey}': ${relPaths}`,
      });
    }
  }

  for (const [scopeKey, dupeFiles] of entityIdToFiles) {
    if (dupeFiles.length < 2) continue;
    const entityId = scopeKey.split(":").at(-1);
    const kind = scopeKey.split(":")[0];
    const relPaths = dupeFiles.map(f => path.relative(syncDir, f)).join(", ");
    for (const file of dupeFiles) {
      addIssueToReport(reports, file, kind, {
        level: "error",
        code: kind === "character" ? "DUPLICATE_CHARACTER_ID" : "DUPLICATE_PLACE_ID",
        message: `${kind}_id '${entityId}' is used by ${dupeFiles.length} canonical files: ${relPaths}`,
      });
    }
  }

  const errors = reports.flatMap(r => r.issues.map(i => ({ ...i, file: r.file, kind: r.kind }))).filter(i => i.level === "error");
  const warnings = reports.flatMap(r => r.issues.map(i => ({ ...i, file: r.file, kind: r.kind }))).filter(i => i.level === "warning");

  return {
    ok: errors.length === 0,
    syncDir: path.resolve(syncDir),
    files_checked: reports.length,
    error_count: errors.length,
    warning_count: warnings.length,
    errors,
    warnings,
    reports,
  };
}
