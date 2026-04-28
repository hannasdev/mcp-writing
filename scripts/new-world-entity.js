#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  renderCharacterArcTemplate,
  renderCharacterSheetTemplate,
  renderPlaceSheetTemplate,
  slugifyEntityName,
} from "../src/world/world-entity-templates.js";

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    syncDir: null,
    kind: null,
    scope: null,
    universe: null,
    project: null,
    name: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--sync-dir") opts.syncDir = args[++i];
    else if (arg === "--kind") opts.kind = args[++i];
    else if (arg === "--scope") opts.scope = args[++i];
    else if (arg === "--universe") opts.universe = args[++i];
    else if (arg === "--project") opts.project = args[++i];
    else if (arg === "--name") opts.name = args[++i];
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help") opts.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return opts;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/new-world-entity.js --sync-dir <dir> --kind <character|place> --scope <project|universe> --name <display name> [--project <project-id>] [--universe <universe-id>] [--dry-run]",
    "",
    "Examples:",
    "  node scripts/new-world-entity.js --sync-dir ./writing --kind character --scope universe --universe universe-1 --name 'Mira Nystrom'",
    "  node scripts/new-world-entity.js --sync-dir ./writing --kind place --scope project --project universe-1/book-1-the-lamb --name 'University Hospital'",
  ].join("\n");
}

function validateOptions(opts) {
  if (opts.help) return;
  if (!opts.syncDir || !opts.kind || !opts.scope || !opts.name) {
    throw new Error("Missing required arguments. See --help.");
  }
  if (!["character", "place"].includes(opts.kind)) {
    throw new Error("--kind must be 'character' or 'place'.");
  }
  if (!["project", "universe"].includes(opts.scope)) {
    throw new Error("--scope must be 'project' or 'universe'.");
  }
  if (opts.scope === "project" && !opts.project) {
    throw new Error("--project is required when --scope is 'project'.");
  }
  if (opts.scope === "universe" && !opts.universe) {
    throw new Error("--universe is required when --scope is 'universe'.");
  }
}

function buildTargetDir(opts, folderName) {
  const syncDir = path.resolve(opts.syncDir);
  const entityRoot = opts.kind === "character" ? "characters" : "places";

  if (opts.scope === "project") {
    return path.join(syncDir, "projects", opts.project, "world", entityRoot, folderName);
  }

  return path.join(syncDir, "universes", opts.universe, "world", entityRoot, folderName);
}

function renderTemplates(opts) {
  const slug = slugifyEntityName(opts.name);
  const entityId = `${opts.kind === "character" ? "char" : "place"}-${slug}`;

  if (opts.kind === "character") {
    return {
      prose: renderCharacterSheetTemplate(opts.name),
      arc: renderCharacterArcTemplate(opts.name),
      meta: [
        `character_id: ${entityId}`,
        `name: ${opts.name}`,
        "role: ",
        "arc_summary: ",
        "first_appearance: ",
        "traits:",
        "  - ",
      ].join("\n"),
    };
  }

  return {
    prose: renderPlaceSheetTemplate(opts.name),
    meta: [
      `place_id: ${entityId}`,
      `name: ${opts.name}`,
      "associated_characters:",
      "  - ",
      "tags:",
      "  - ",
    ].join("\n"),
  };
}

function main() {
  try {
    const opts = parseArgs(process.argv);
    if (opts.help) {
      console.log(usage());
      process.exit(0);
    }

    validateOptions(opts);

    const folderName = slugifyEntityName(opts.name);
    if (!folderName) throw new Error("Could not derive a valid folder name from --name.");

    const targetDir = buildTargetDir(opts, folderName);
    const prosePath = path.join(targetDir, "sheet.md");
    const metaPath = path.join(targetDir, "sheet.meta.yaml");
    const arcPath = path.join(targetDir, "arc.md");
    const templates = renderTemplates(opts);

    if (fs.existsSync(prosePath) || fs.existsSync(metaPath)) {
      throw new Error(`Target already exists: ${targetDir}`);
    }

    if (opts.dryRun) {
      console.log(`Would create: ${targetDir}`);
      console.log(`- ${prosePath}`);
      console.log(`- ${metaPath}`);
      if (templates.arc) console.log(`- ${arcPath}`);
      process.exit(0);
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(prosePath, templates.prose + "\n", "utf8");
    fs.writeFileSync(metaPath, templates.meta + "\n", "utf8");
    if (templates.arc) fs.writeFileSync(arcPath, templates.arc + "\n", "utf8");

    console.log(`Created ${opts.kind} template:`);
    console.log(`- ${prosePath}`);
    console.log(`- ${metaPath}`);
    if (templates.arc) console.log(`- ${arcPath}`);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
  }
}

main();
