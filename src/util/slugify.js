const defaultSlugify = require("slug");

const extractNumbers = require("./extractNumbers");

const SPECIAL_CASES = {
  // Feature names from Art Blocks "Gazers" project (project 215) that collide
  // under the default slug function because they differ only in emoji (...).
  "🌕🎨 Variance": "moon-variance",
  "🌈 Variance 🎲": "rainbow-variance",
  "🎨 Variance 🎲": "art-variance",
  "🌑 Outline 🎲": "new-moon-outline",
  "🌕 Outline 🎲": "full-moon-outline",

  // Other feature/trait names, mostly also from "Gazers", that do not collide
  // but contain only non-text characters (...) and so slugify to
  // human-unreadable strings like "8jsrq" by default.
  "💭": "thought-balloon",
  "🔭": "telescope",
  "🚀": "rocket",
  "🌑📅": "new-moon-calendar",
  "🦪🎲": "oyster-die",
  "🌕🦪🎲": "full-moon-oyster-die",
  "✍️": "writing-hand",
  "🎲": "die",
  "🌑": "new-moon",
  "👨\u200d🎨🎁": "man-artist-present",
  "👩\u200d🎨🎁": "woman-artist-present",

  "-": "hyphen",
  "✓": "checkmark",
};

const RE_STARTS_WITH_NEGATIVE_NUMBER = /^-[0-9]/;

function slugify(string) {
  const special = SPECIAL_CASES[string];
  if (special != null) return special;
  const groups = extractNumbers(string);
  if (groups.length === 1) {
    return slugifyGroup(groups[0]);
  } else {
    const nonPunctuationGroups = groups.filter((group) => {
      // Groups made entirely of slug-unfriendly characters (punctuation,
      // emoji, etc.) will be processed by something like Punycode. We want to
      // omit those groups entirely. Detect them by adding a slug-friendly
      // character to the group (here, a "z") and seeing if that replaces the
      // whole slugification with just "z".
      return defaultSlugify(group + "z") !== "z";
    });
    const slugifiedGroups = nonPunctuationGroups.map((group) => ({
      original: group,
      slugified: slugifyGroup(group),
    }));

    // Tests whether group `i` should lack the preceding hyphen.
    //
    // We want things like "the-80s-music" (whether from source "80s" or
    // "80's") and "a-3x3-grid" (omit some hyphens around digits), but also
    // "up-to-11" and "51-percent" (keep some hyphens around digits).
    function stickToPrevious(i) {
      const prev = slugifiedGroups[i - 1];
      const here = slugifiedGroups[i];
      if (here == null) return false;
      // Is this a non-digit following a digit, like the "x" in "2x boost" or
      // "2x3 grid"?
      if (
        prev != null &&
        prev.original.match(/\d$/) &&
        here.original.match(/^[A-Za-z_']/)
      )
        return true;
      // Is this a digit following a non-digit separator, like the "3" in "x3
      // boost" or "2x3 grid"?
      if (
        prev != null &&
        prev.original.match(/[A-Za-z_]$/) &&
        here.original.match(/^\d/)
      )
        return true;
      // Guess not.
      return false;
    }

    return slugifiedGroups
      .map(({ slugified }, i) => {
        if (i === 0) return slugified;
        if (stickToPrevious(i)) return slugified;
        return "-" + slugified;
      })
      .join("");
  }
}

function slugifyGroup(string) {
  // Preserve decimal points in numbers like "1.2", but not stray periods as in
  // "Overcast w. Precipitation" (Democracity, project #162).
  string = string.replace(/(?<![0-9])\.(?![0-9])/g, "");
  const slugifyOptions = {
    charmap: {
      ...slugify.charmap,
      ".": ".",
    },
  };
  let result = defaultSlugify(string, slugifyOptions);
  if (string.match(RE_STARTS_WITH_NEGATIVE_NUMBER) && !result.startsWith("-")) {
    // e.g., 70s Pop Series One's "Boosted" feature includes both `-3` and `3`
    // as possible values; these both slugify to "3" under the default
    // algorithm but really should be distinct. However, only do this for
    // digits, not (e.g.) the "-part" group in "2-part".
    result = "-" + result;
  }
  return result;
}

module.exports = slugify;
