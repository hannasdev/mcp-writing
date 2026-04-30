import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const scenesDir = "./sync/projects/the-lamb/scenes";
let fixed = 0;

for (const f of fs.readdirSync(scenesDir)) {
  if (!f.endsWith(".meta.yaml")) continue;
  const fp = path.join(scenesDir, f);
  const meta = yaml.load(fs.readFileSync(fp, "utf8")) ?? {};
  if (!meta.characters) continue;

  const versions   = meta.characters.filter(c => /^v\d[\d.a-z]*$/i.test(c));
  const characters = meta.characters.filter(c => !/^v\d[\d.a-z]*$/i.test(c));

  if (!versions.length) continue;

  const updated = { ...meta, characters };
  if (!characters.length) delete updated.characters;
  updated.versions = versions;
  fs.writeFileSync(fp, yaml.dump(updated, { lineWidth: 120 }), "utf8");
  console.log("Fixed:", f, "-> chars:", characters.length, "versions:", versions);
  fixed++;
}
console.log("Total fixed:", fixed);
