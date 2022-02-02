const RE_UNSIGNED_DECIMAL = /[0-9]+(?:\.[0-9]+)?/;

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
  const result = [];
  let i = 0;
  while (i < s.length) {
    const num = findNextNumber(s, i);
    if (num == null) {
      result.push(s.slice(i));
      break;
    }
    result.push(s.slice(i, num.index));
    result.push(s.slice(num.index, num.index + num.length));
    i = num.index + num.length;
  }
  return result.filter(Boolean);
}

// Finds the next possibly signed decimal that's either (a) not preceded by a
// word character, or (b) preceded by an "x" (as in "3x3 grid"), unless that
// "x" is part of a normal word like "helix" or the start of a "0x..." literal.
function findNextNumber(s, i) {
  while (i < s.length) {
    const match = s.slice(i).match(RE_UNSIGNED_DECIMAL);
    if (match == null) break;
    const matchStart = i + match.index;
    if (s[matchStart - 1] === "+" || s[matchStart - 1] === "-") {
      // Prefer interpreting as signed.
      if (mayBeUnsignedDecimal(s, matchStart - 1)) {
        return { index: matchStart - 1, length: match[0].length + 1 };
      }
    }
    if (mayBeUnsignedDecimal(s, matchStart)) {
      return { index: matchStart, length: match[0].length };
    }
    i += matchStart + match[0].length;
  }
  return null;
}

function mayBeUnsignedDecimal(s, i) {
  // Numbers may always appear at start of string.
  if (i === 0) return true;
  // Numbers may be preceded by non-word characters.
  if (!s[i - 1].match(/\w/)) return true;
  // Numbers preceded by a word character other than an "x" are considered part
  // of the preceding word.
  if (s[i - 1] !== "x") return false;
  // An "x" at the start of the string (as in "x2 multiplier") is okay.
  if (i === 1) return true;
  // An "x" preceded by a non-digit word character (as in "helix") doesn't
  // count as a separator.
  if (s[i - 2].match(/[A-Za-z_]/)) return false;
  // Otherwise, an "x" is a separator unless it's preceded by a lone "0", which
  // we interpret as a "0x1234" hex literal. A longer number ending in zero, as
  // in "10x10 grid", is fine.
  if (s[i - 2] !== "0") return true;
  if (i === 2) return false; // "0x" at start of string
  return s[i - 2].match(/[0-9]/);
}

module.exports = extractNumbers;
