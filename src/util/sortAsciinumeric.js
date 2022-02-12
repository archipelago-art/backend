const Cmp = require("./cmp");
const extractNumbers = require("./extractNumbers");

function sortAsciinumeric(xs, key = (s) => s) {
  const schwartz = xs.map((x) => {
    const k = key(x);
    if (typeof k !== "string")
      throw new Error("key function returned non-string: " + k);
    return { key: canonicalize(k), value: x };
  });
  return schwartz.sort((a, b) => cmp(a.key, b.key)).map((x) => x.value);
}

const GROUP_RE = /^(?:\s+|[0-9.+-]+|[^\s0-9.+-]+)/;

const NUMBERS = (() => {
  const raw = [
    ["none", "zero"],
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];
  const result = new Map();
  for (let i = 0; i < raw.length; i++) {
    for (const key of [raw[i]].flat()) {
      result.set(key, i);
    }
  }
  return result;
})();

function canonicalize(s) {
  const result = [];
  const tokens = extractNumbers(s).flatMap((group) => {
    // Split each group on hyphens (and whitespace), unless doing so would
    // split a negative number from its minus sign.
    if (Number.isFinite(Number(group))) {
      return [group];
    } else {
      return group.split(/([\s-]+)/g).filter(Boolean);
    }
  });
  for (const token of tokens) {
    if (token.match(/^\s*$/)) continue;
    const num = Number(NUMBERS.get(token.toLowerCase()) ?? token);
    result.push(Number.isFinite(num) ? num : token);
  }
  return result;
}

const cmp = Cmp.array((x, y) => {
  if (typeof x === "number" && typeof y === "string") return -1;
  if (typeof x === "string" && typeof y === "number") return 1;
  return Cmp.natural(x, y);
});

function cmpAsciinumeric(x, y) {
  return cmp(canonicalize(x), canonicalize(y));
}

module.exports = { sortAsciinumeric, cmpAsciinumeric };
