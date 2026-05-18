import { applySceneStructurePatch } from "./structure-inference.js";

export function buildSceneChapterAssignmentPlan(syncDir, filePath, meta = {}, { chapter } = {}) {
  if (chapter === undefined) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide a canonical chapter or null to clear the scene chapter link.",
      },
    };
  }

  const currentStructure = applySceneStructurePatch(syncDir, filePath, meta);
  const pathChapter = currentStructure.chapterStructure.chapter ?? null;
  const pathChapterNumber = currentStructure.derived.chapter ?? null;

  if (chapter === null) {
    if (pathChapter || pathChapterNumber !== null) {
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "chapter_id cannot be cleared for a scene whose file path implies a chapter.",
          details: {
            path_chapter: pathChapter?.chapter_id ?? pathChapterNumber,
          },
        },
      };
    }

    return {
      ok: true,
      meta: applySceneStructurePatch(syncDir, filePath, meta, { chapter: null }).meta,
      assignedChapter: null,
      previousChapterId: meta.chapter_id ?? null,
    };
  }

  if (pathChapter && pathChapter.chapter_id !== chapter.chapter_id) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Cannot assign a scene to a different chapter while its file path implies another canonical chapter.",
        details: {
          requested_chapter_id: chapter.chapter_id,
          path_chapter: pathChapter.chapter_id,
        },
      },
    };
  }

  return {
    ok: true,
    meta: applySceneStructurePatch(syncDir, filePath, meta, { chapter }).meta,
    assignedChapter: chapter,
    previousChapterId: meta.chapter_id ?? null,
  };
}
