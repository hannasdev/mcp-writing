import { readMeta, writeMeta, normalizeReferenceLinkList } from "../sync/sync.js";

export function upsertSerializedReferenceLinks(existing, targetDocId, relation, { defaultRelation }) {
  const normalized = normalizeReferenceLinkList(existing ?? [], { defaultRelation });
  const filtered = normalized.filter((entry) => entry.targetDocId !== targetDocId);
  filtered.push({ targetDocId, relation });
  return filtered.map((entry) => ({
    target_doc_id: entry.targetDocId,
    relation: entry.relation,
  }));
}

export function persistSceneReferenceLink({ scenePath, syncDir, targetDocId, relation }) {
  const { meta } = readMeta(scenePath, syncDir, { writable: true });
  const existingExplicit = [
    ...(Array.isArray(meta.reference_links) ? meta.reference_links : meta.reference_links ? [meta.reference_links] : []),
    ...(Array.isArray(meta.explicit_reference_links) ? meta.explicit_reference_links : meta.explicit_reference_links ? [meta.explicit_reference_links] : []),
  ];
  const nextReferenceLinks = upsertSerializedReferenceLinks(existingExplicit, targetDocId, relation, {
    defaultRelation: "informs",
  });

  const nextMeta = {
    ...meta,
    reference_links: nextReferenceLinks,
  };
  delete nextMeta.explicit_reference_links;

  if (relation === "informs") {
    const existingIds = Array.isArray(meta.reference_ids)
      ? meta.reference_ids
      : typeof meta.reference_ids === "string"
        ? meta.reference_ids.split(",")
        : [];
    nextMeta.reference_ids = [...new Set([...existingIds.map((value) => String(value).trim()).filter(Boolean), targetDocId])];
  }

  writeMeta(scenePath, nextMeta);
}

export function upsertExplicitReferenceLinkRow(
  db,
  { sourceKind, sourceProjectId, sourceId, targetDocId, relation }
) {
  db.prepare(`
    DELETE FROM reference_links
    WHERE source_kind = ? AND source_project_id = ? AND source_id = ? AND target_doc_id = ?
  `).run(sourceKind, sourceProjectId, sourceId, targetDocId);

  db.prepare(`
    INSERT INTO reference_links (
      source_kind, source_project_id, source_id, target_doc_id, relation, origin
    ) VALUES (?, ?, ?, ?, ?, 'explicit')
  `).run(sourceKind, sourceProjectId, sourceId, targetDocId, relation);
}
