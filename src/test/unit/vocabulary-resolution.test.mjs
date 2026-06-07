import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFreeformFieldSuggestions,
  resolveVocabularyValue,
  VOCABULARY_CANDIDATE_LIMITS,
} from "../../core/vocabulary-resolution.js";

describe("vocabulary resolution", () => {
  test("resolves case-insensitive values without changing the stored canonical value", () => {
    const result = resolveVocabularyValue({
      input: "Harbor",
      values: ["harbor", "betrayal"],
      targetKind: "tag",
      matchedField: "tag",
    });

    assert.equal(result.ok, true);
    assert.equal(result.value, "harbor");
    assert.deepEqual(result.resolved_from, {
      input: "Harbor",
      matched_field: "tag",
      match_type: "case_insensitive_value",
      value: "harbor",
    });
  });

  test("returns deterministic near-match suggestions for misses", () => {
    const result = resolveVocabularyValue({
      input: "Harbur",
      values: ["departure", "harbor", "harvest", "homecoming"],
      targetKind: "tag",
      matchedField: "tag",
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.candidate_matches.map(candidate => [candidate.value, candidate.match_type]),
      [["harbor", "near_match_suggestion"]]
    );
  });

  test("does not collapse multiple authored case variants into one resolved value", () => {
    const result = resolveVocabularyValue({
      input: "HARBOR",
      values: ["harbor", "Harbor"],
      targetKind: "tag",
      matchedField: "tag",
    });

    assert.equal(result.ok, true);
    assert.equal(result.value, "HARBOR");
    assert.equal(result.resolved_from, undefined);
    assert.deepEqual(
      result.case_variants.map(candidate => candidate.value),
      ["harbor", "Harbor"]
    );
  });

  test("caps suggestion lists", () => {
    const result = resolveVocabularyValue({
      input: "tag",
      values: Array.from({ length: 20 }, (_, index) => `tag-${String(index).padStart(2, "0")}`),
      targetKind: "tag",
      matchedField: "tag",
      candidateLimit: 99,
    });

    assert.equal(result.ok, false);
    assert.equal(result.candidate_matches.length, VOCABULARY_CANDIDATE_LIMITS.hard);
  });

  test("builds advisory suggestions for freeform metadata without changing caller values", () => {
    const suggestions = buildFreeformFieldSuggestions({
      fields: {
        tags: ["Harbor"],
        save_the_cat_beat: "Catalst",
      },
      vocabulary: {
        tags: ["harbor"],
        beats: ["Catalyst"],
      },
    });

    assert.equal(suggestions.tags[0].input, "Harbor");
    assert.equal(suggestions.tags[0].existing_value, "harbor");
    assert.match(suggestions.tags[0].note, /supplied casing was preserved/);
    assert.equal(suggestions.save_the_cat_beat[0].input, "Catalst");
    assert.equal(suggestions.save_the_cat_beat[0].suggested_value, "Catalyst");
    assert.match(suggestions.save_the_cat_beat[0].note, /Beat remains freeform/);
  });
});
