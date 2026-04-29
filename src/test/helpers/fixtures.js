import fs from "node:fs";
import path from "node:path";

export function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

export function writeFileSyncWithDirs(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export function createTestSyncFixture(syncDir) {
  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.md"),
    `---
scene_id: sc-001
title: The Return
part: 1
chapter: 1
characters: [elena, marcus]
places: [harbor-district]
logline: Elena returns to the harbor district after three years away and runs into Marcus.
save_the_cat: Opening Image
pov: elena
timeline_position: 1
story_time: "Day 1, late afternoon"
tags: [reunion, tension, harbor]
---

The ferry docked at quarter past four, which meant Elena had seventeen minutes before the evening freight shift began and the harbor became impassable. She had timed it deliberately. She did not want to see anyone she knew.

She was at the bottom of the gangway when she heard her name.

Marcus was standing by the storage shed with a clipboard in one hand and an expression she recognized -- the particular look he got when he was pretending not to be surprised. He was very bad at pretending.

"You could have called," he said.

"I could have," she agreed, and kept walking.

He fell into step beside her anyway, which was exactly what she had expected him to do.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-001.meta.yaml"),
    `scene_id: sc-001
title: The Return
part: 1
chapter: 1
characters:
  - elena
  - marcus
places:
  - harbor-district
logline: >-
  Elena returns to the harbor district after three years away and runs into
  Marcus.
save_the_cat: Opening Image
pov: elena
timeline_position: 1
story_time: 'Day 1, late afternoon'
tags:
  - reunion
  - tension
  - harbor
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.md"),
    `---
scene_id: sc-002
title: The Argument
part: 1
chapter: 1
characters: [elena, marcus]
places: [harbor-district]
logline: Elena and Marcus argue about why she left; she deflects, he pushes back harder than before.
save_the_cat: Theme Stated
pov: elena
timeline_position: 2
story_time: "Day 1, evening"
tags: [conflict, backstory, harbor]
---

They ended up at the old bait shed because the wind had picked up and it was the nearest shelter. The shed smelled the same as it always had -- salt and something faintly chemical. Elena had spent half her childhood in this shed. She wished she were somewhere else.

"You didn't call me," Marcus said. "You didn't write. Three years."

"I was busy."

"Everyone is busy. That's not an answer."

She looked at the water instead of him. "It's the one I've got."

He was quiet for a long time. When he spoke again, his voice had changed -- less patient, more tired. "I'm not angry you left, Elena. I'm angry you decided I wouldn't understand."

She didn't have an answer for that either.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-1", "sc-002.meta.yaml"),
    `scene_id: sc-002
title: The Argument
part: 1
chapter: 1
characters:
  - elena
  - marcus
places:
  - harbor-district
logline: >-
  Elena and Marcus argue about why she left; she deflects, he pushes back harder
  than before.
save_the_cat: Theme Stated
pov: elena
timeline_position: 2
story_time: 'Day 1, evening'
tags:
  - conflict
  - backstory
  - harbor
  - Daniel Nystrom
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.md"),
    `---
scene_id: sc-003
title: The Offer
part: 1
chapter: 2
characters: [elena]
places: [harbor-district]
logline: Elena receives an envelope at her old address -- an offer she doesn't understand yet, but can't ignore.
save_the_cat: Catalyst
pov: elena
timeline_position: 3
story_time: "Day 2, morning"
tags: [mystery, catalyst, solo]
---

The envelope had been slipped under the door of the flat she no longer lived in. The landlord had kept it for her -- "figured you'd be back eventually," he said, in a tone that suggested he had not figured this at all.

Her name was on the front in handwriting she didn't recognize. Inside was a single card with an address across town and a time: 9 p.m., two days from now.

No name. No explanation.

She turned the card over. On the back, in smaller writing: *You know what happened to your father. We do too.*

Elena Voss sat down on the floor of the empty flat and stared at the card for a long time.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "part-1", "chapter-2", "sc-003.meta.yaml"),
    `scene_id: sc-003
title: The Offer
part: 1
chapter: 2
characters:
  - elena
places:
  - harbor-district
logline: >-
  Elena receives an envelope at her old address -- an offer she doesn't
  understand yet, but can't ignore.
save_the_cat: Catalyst
pov: elena
timeline_position: 3
story_time: 'Day 2, morning'
tags:
  - mystery
  - catalyst
  - solo
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "elena.md"),
    `---
character_id: elena
name: Elena Voss
role: protagonist
traits: [driven, guarded, perceptive, self-sabotaging]
arc_summary: Learns to trust others without losing herself.
first_appearance: sc-001
tags: [main-cast]
---

Elena grew up in the harbor district, the daughter of a dockworker who disappeared when she was twelve. She has spent most of her adult life building walls and calling it independence. Perceptive to a fault -- she sees through people quickly, which makes her both valuable and exhausting to be around.

Her self-sabotaging streak shows up most clearly in relationships. When things get close, she finds a reason to leave first.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "elena.meta.yaml"),
    `character_id: elena
name: Elena Voss
role: protagonist
traits:
  - driven
  - guarded
  - perceptive
  - self-sabotaging
arc_summary: Learns to trust others without losing herself.
first_appearance: sc-001
tags:
  - main-cast
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "marcus.md"),
    `---
character_id: marcus
name: Marcus Hale
role: supporting
traits: [patient, idealistic, stubborn, warm]
arc_summary: Has to decide whether loyalty to Elena is worth the cost to himself.
first_appearance: sc-001
tags: [main-cast]
---

Marcus runs a small freight operation out of the harbor. He has known Elena since they were teenagers and is one of the few people she has never fully pushed away -- not for lack of trying on her part.

He is patient in a way that sometimes reads as passive. He is not passive. He is waiting for the right moment, which he has been doing for approximately fifteen years.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "characters", "marcus.meta.yaml"),
    `character_id: marcus
name: Marcus Hale
role: supporting
traits:
  - patient
  - idealistic
  - stubborn
  - warm
arc_summary: Has to decide whether loyalty to Elena is worth the cost to himself.
first_appearance: sc-001
tags:
  - main-cast
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "places", "harbor-district.md"),
    `---
place_id: harbor-district
name: The Harbor District
associated_characters: [elena, marcus]
tags: [urban, working-class, recurring]
---

The harbor district is loud and smells of brine and diesel. The buildings closest to the water are old enough to have survived two floods and a fire. Most of the businesses that used to operate here have moved inland; the ones that remain are either too stubborn or too poor to follow.

It is the kind of place people are from, not the kind of place people choose.
`
  );

  writeFileSyncWithDirs(
    path.join(syncDir, "projects", "test-novel", "world", "places", "harbor-district.meta.yaml"),
    `place_id: harbor-district
name: The Harbor District
associated_characters:
  - elena
  - marcus
tags:
  - urban
  - working-class
  - recurring
`
  );
}

export function createScrivenerDraftFixture(baseDir) {
  const draftDir = path.join(baseDir, "Draft");
  fs.mkdirSync(draftDir, { recursive: true });

  fs.writeFileSync(
    path.join(draftDir, "001 Scene Arrival [10].txt"),
    "Elena arrives at the station and scans for familiar faces.\n",
    "utf8"
  );

  fs.writeFileSync(path.join(draftDir, "002 -Setup- [11].txt"), "", "utf8");

  fs.writeFileSync(
    path.join(draftDir, "003 Epigraph [12].txt"),
    "A city remembers what its people forget.\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(draftDir, "004 Scene Debate [13].txt"),
    "Marcus challenges Elena's plan in the stairwell.\n",
    "utf8"
  );

  fs.writeFileSync(path.join(draftDir, "005 Chapter Card [14].txt"), "", "utf8");
  fs.writeFileSync(path.join(draftDir, "006 Notes.txt"), "Not in expected filename format.\n", "utf8");
}

export function createScrivenerProjectBundleFixture(baseDir) {
  const scrivDir = path.join(baseDir, "Sebastian the Vampire.scriv");
  const scrivxPath = path.join(scrivDir, "Sebastian the Vampire.scrivx");
  fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-10"), { recursive: true });
  fs.mkdirSync(path.join(scrivDir, "Files", "Data", "UUID-13"), { recursive: true });

  fs.writeFileSync(
    path.join(scrivDir, "Files", "Data", "UUID-10", "synopsis.txt"),
    "Elena arrives at the station and scans for familiar faces.\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(scrivDir, "Files", "Data", "UUID-13", "synopsis.txt"),
    "Marcus challenges Elena's plan in the stairwell.\n",
    "utf8"
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject>
  <ExternalSyncMap>
    <SyncItem ID="UUID-10">10</SyncItem>
    <SyncItem ID="UUID-13">13</SyncItem>
  </ExternalSyncMap>
  <Keywords>
    <Keyword ID="kw-elena"><Title>Elena Voss</Title></Keyword>
    <Keyword ID="kw-version"><Title>v1.1</Title></Keyword>
  </Keywords>
  <Binder>
    <BinderItem Type="DraftFolder" UUID="draft-root">
      <Children>
        <BinderItem Type="Folder" UUID="part-1">
          <Title>Part One</Title>
          <Children>
            <BinderItem Type="Folder" UUID="chapter-1">
              <Title>Arrival</Title>
              <Children>
                <BinderItem Type="Text" UUID="UUID-10">
                  <Keywords>
                    <KeywordID>kw-elena</KeywordID>
                    <KeywordID>kw-version</KeywordID>
                  </Keywords>
                  <MetaData>
                    <MetaDataItem><FieldID>savethecat!</FieldID><Value>Setup</Value></MetaDataItem>
                    <MetaDataItem><FieldID>causality</FieldID><Value>2</Value></MetaDataItem>
                    <MetaDataItem><FieldID>f:character</FieldID><Value>Yes</Value></MetaDataItem>
                  </MetaData>
                </BinderItem>
                <BinderItem Type="Text" UUID="UUID-13">
                  <MetaData>
                    <MetaDataItem><FieldID>stakes</FieldID><Value>3</Value></MetaDataItem>
                  </MetaData>
                </BinderItem>
              </Children>
            </BinderItem>
          </Children>
        </BinderItem>
      </Children>
    </BinderItem>
  </Binder>
</ScrivenerProject>`;

  fs.mkdirSync(scrivDir, { recursive: true });
  fs.writeFileSync(scrivxPath, xml, "utf8");
  return scrivDir;
}
