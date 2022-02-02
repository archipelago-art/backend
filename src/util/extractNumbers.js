function concat(strs) {
  return strs.join("");
}
// (See docs on `extractNumbers`.)
//
const RE_DELIMITER = new RegExp(
  concat([
    // Surround delimiter in groups so that `String.prototype.split` retains
    // the delimiters.
    "(",
    // Numbers must be either...
    concat([
      "(?:",
      // ... (a) not preceded by a word character...
      "(?<!\\w)",
      // ...or (b) preceded by an "x" (as in "3x3 grid"), unless that "x" is
      // part of a normal word like "helix" or the start of a "0x..." literal.
      "|(?<=(?<![A-Za-z_]|(?<!\\d)0)x)",
      ")",
    ]),
    // A number has an optional sign, plus one or more integral-part digits,
    // followed optionally by a decimal point and one or more fractional-part
    // digits.
    "(?:[+-]?[0-9]+(?:\\.[0-9]+)?)",
    ")",
  ]),
  "g"
);

/**
 * Splits a string into pieces that, when concatenated, form the original
 * string. Attempts to extract positive and negative integers into their own
 * groups, without confusing hyphens for minus signs:
 *
 *    - "1-of-2" maps to ["1", "-of-", "2"]
 *    - "1-2-3" maps to ["1", "-", "2", "-", "3"]
 *    - "from -1 to 1" maps to ["from ", "-1", " to ", "1"]
 *    - "from-1-to--1" maps to ["from-", "1", "-to-", "-1"]
 *
 * As a special case, we recognize the form "[digits]x[digits]" as three
 * tokens:
 *
 *    - "3x3 grid" maps to ["3", "x", "3", " grid"]
 *    - "Limited-time x2 xp event" maps to ["Limited-time x", "2", " xp event"]
 */
function extractNumbers(s /*: string */) /*: string[] */ {
  return s.split(RE_DELIMITER).filter(Boolean);
}

module.exports = extractNumbers;
