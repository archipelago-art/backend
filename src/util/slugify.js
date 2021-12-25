const defaultSlugify = require("slug");

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

function slugify(string) {
  const special = SPECIAL_CASES[string];
  if (special != null) return special;
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
  if (string.startsWith("-") && !result.startsWith("-")) {
    // e.g., 70s Pop Series One's "Boosted" feature includes both `-3` and `3`
    // as possible values; these both slugify to "3" under the default
    // algorithm but really should be distinct.
    result = "-" + result;
  }
  return result;
}

module.exports = slugify;
