function sortAsciinumeric(xs, key = (s) => s) {
  const schwartz = xs.map((x) => {
    const k = key(x);
    if (typeof k !== "string")
      throw new Error("key function returned non-string: " + k);
    return { key: canonicalize(k), value: x };
  });
  return schwartz.sort((a, b) => cmp(a.key, b.key)).map((x) => x.value);
}

const GROUP_RE = /^(?:[^0-9.+-]+|[0-9.+-]+)/;

function canonicalize(s) {
  const result = [];
  while (s.length > 0) {
    const match = s.match(GROUP_RE);
    if (match == null) {
      // shouldn't happen, but bail just to be safe
      result.push(s);
      break;
    }
    const group = match[0];
    const num = Number(group);
    result.push(Number.isFinite(num) ? num : group);
    s = s.slice(group.length);
  }
  return result;
}

function cmp(xs, ys) {
  // Loop invariant: at the start of each iteration, `xs[:i]` and `ys[:i]`
  // compare equal. (Initially trivially true because `i === 0`.)
  for (let i = 0; i < xs.length; i++) {
    if (i >= ys.length) {
      // `xs[:i]` and `ys` compare equal, but `xs` has more parts, so `xs`
      // follows `ys`.
      return 1;
    }
    const x = xs[i];
    const y = ys[i];
    if (typeof x === "number" && typeof y === "string") return -1;
    if (typeof x === "string" && typeof y === "number") return 1;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  if (xs.length < ys.length) {
    // `xs` and `ys[:xs.length]` compare equal, but `ys` has more parts, so
    // `xs` precedes `ys`.
    return -1;
  }
  return 0;
}

module.exports = sortAsciinumeric;
