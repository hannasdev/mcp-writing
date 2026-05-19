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
          requested_chapter: chapter.sort_index,
          path_chapter: pathChapter.chapter_id,
          path_chapter_number: pathChapterNumber,
        },
      },
    };
  }

  if (!pathChapter && pathChapterNumber !== null && pathChapterNumber !== chapter.sort_index) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Cannot assign a scene to a different chapter while its file path implies another compatibility chapter.",
        details: {
          requested_chapter_id: chapter.chapter_id,
          requested_chapter: chapter.sort_index,
          path_chapter: pathChapterNumber,
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

export function buildMoveScenePlan(syncDir, filePath, meta = {}, {
  currentScene,
  chapter,
  timelinePosition,
} = {}) {
  if (chapter === undefined && timelinePosition === undefined) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Provide chapter_id and/or timeline_position for move_scene.",
      },
    };
  }

  if (timelinePosition !== undefined && (!Number.isInteger(timelinePosition) || timelinePosition < 1)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "timeline_position must be a positive integer.",
        details: { timeline_position: timelinePosition },
      },
    };
  }

  const assignmentPlan = chapter === undefined
    ? {
      ok: true,
      meta,
      assignedChapter: {
        chapter_id: currentScene?.chapter_id ?? meta.chapter_id ?? null,
        sort_index: currentScene?.chapter ?? meta.chapter ?? null,
        title: currentScene?.chapter_title ?? meta.chapter_title ?? null,
      },
      previousChapterId: meta.chapter_id ?? currentScene?.chapter_id ?? null,
    }
    : buildSceneChapterAssignmentPlan(syncDir, filePath, meta, { chapter });

  if (!assignmentPlan.ok) return assignmentPlan;

  const movedMeta = {
    ...assignmentPlan.meta,
    ...(timelinePosition !== undefined ? { timeline_position: timelinePosition } : {}),
  };

  return {
    ok: true,
    meta: movedMeta,
    assignedChapter: assignmentPlan.assignedChapter,
    previousChapterId: assignmentPlan.previousChapterId ?? currentScene?.chapter_id ?? null,
    previousTimelinePosition: meta.timeline_position ?? currentScene?.timeline_position ?? null,
    timelinePosition: timelinePosition ?? meta.timeline_position ?? currentScene?.timeline_position ?? null,
  };
}
