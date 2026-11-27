// src/tagging/sequential-tagger.js
// Pure Fixed + Variable sequential tag allocator for Cable Tray & Fitting tagging.
// Zero DOM/WebGL dependencies — fully unit-testable.

/**
 * Formats a sequential tag from a free-form fixed prefix + padded integer counter.
 * Example: formatSequentialTag('CT01.01.', 3, 2) -> 'CT01.01.03'
 */
export function formatSequentialTag(prefix = '', sequence = 1, digits = 2) {
  const cleanPrefix = String(prefix ?? '').trim();
  const d = Math.max(1, Math.min(6, Number.parseInt(digits, 10) || 2));
  const n = Math.max(0, Number.parseInt(sequence, 10) || 0);
  return `${cleanPrefix}${String(n).padStart(d, '0')}`;
}

/**
 * Natural alphanumeric comparator so CT01.01.02 sorts before CT01.01.10.
 */
export function compareNaturalTags(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/**
 * Finds the next unused sequence integer >= startSequence for the given prefix & digits.
 */
export function getNextAvailableSequence({
  prefix = '',
  startSequence = 1,
  digits = 2,
  existingTags = [],
} = {}) {
  const used = new Set(
    Array.from(existingTags || [])
      .map((t) => String(t ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  let seq = Math.max(1, Number.parseInt(startSequence, 10) || 1);
  const guardLimit = seq + used.size + 10000;
  while (seq < guardLimit) {
    const candidate = formatSequentialTag(prefix, seq, digits).toLowerCase();
    if (!used.has(candidate)) return seq;
    seq += 1;
  }
  return seq;
}

/**
 * Allocates sequential unique tags for an ordered list of elements.
 * Skips any tag already present in `existingTags`.
 */
export function allocateSequentialTags({
  elements = [],
  prefix = '',
  startSequence = 1,
  digits = 2,
  existingTags = [],
} = {}) {
  const cleanPrefix = String(prefix ?? '').trim();
  if (!cleanPrefix) {
    return { valid: false, error: 'Enter a fixed prefix (e.g. CT01.01.).', assignments: [], nextSequence: startSequence };
  }
  const used = new Set(
    Array.from(existingTags || [])
      .map((t) => String(t ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  // Derive a clean SystemTag by stripping trailing separator characters (., -, _, /)
  const systemTag = cleanPrefix.replace(/[.\-_/:\s]+$/, '') || cleanPrefix;
  const d = Math.max(1, Math.min(6, Number.parseInt(digits, 10) || 2));
  let seq = Math.max(1, Number.parseInt(startSequence, 10) || 1);
  const assignments = [];

  for (const el of elements) {
    while (used.has(formatSequentialTag(cleanPrefix, seq, d).toLowerCase())) {
      seq += 1;
    }
    const sequenceNumber = String(seq).padStart(d, '0');
    const elementTag = formatSequentialTag(cleanPrefix, seq, d);
    used.add(elementTag.toLowerCase());
    assignments.push({
      ...el,
      systemTag,
      elementTag,
      componentId: elementTag,
      sequenceNumber,
      schemeVersion: 'seq-1',
    });
    seq += 1;
  }

  return {
    valid: true,
    error: null,
    assignments,
    nextSequence: seq,
  };
}
