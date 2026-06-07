export function normalizeMatchValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function levenshteinDistance(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length];
}

export function isNearMatch(input, value) {
  const normalizedInput = normalizeMatchValue(input);
  const normalizedValue = normalizeMatchValue(value);
  if (!normalizedInput || !normalizedValue) return false;
  if (normalizedInput.length < 3 || normalizedValue.length < 3) return false;
  if (normalizedValue.includes(normalizedInput) || normalizedInput.includes(normalizedValue)) return true;

  const distance = levenshteinDistance(normalizedInput, normalizedValue);
  const threshold = Math.max(1, Math.floor(Math.max(normalizedInput.length, normalizedValue.length) / 4));
  return distance <= threshold;
}
