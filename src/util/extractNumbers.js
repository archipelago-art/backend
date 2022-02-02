const RE_DELIMITER = /((?<!\w)(?:[+-]?[0-9]+(?:\.[0-9]+)?))/g;

/**
 * Splits a string into pieces that, when concatenated, form the original
 * string. Attempts to extract positive and negative integers into their own
 * groups, without confusing hyphens for minus signs:
 *
 *    - "1-of-2" maps to ["1", "-of-", "2"]
 *    - "1-2-3" maps to ["1", "-", "2", "-", "3"]
 *    - "from -1 to 1" maps to ["from ", "-1", " to ", "1"]
 *    - "from-1-to--1" maps to ["from-", "1", "-to-", "-1"]
 */
function extractNumbers(s /*: string */) /*: string[] */ {
  return s.split(RE_DELIMITER).filter(Boolean);
}

module.exports = extractNumbers;
