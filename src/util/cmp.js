/**
 * A comparator that follows elements' natural ordering. Useful for comparing
 * numbers: `[8, 9, 10].sort()` is broken, but `[8, 9, 10].sort(natural)` works
 * as expected. Also useful as a "neutral" comparator to give to combinators.
 */
function natural(a, b) {
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

/**
 * Creates a comparator that yields the reverse order of the given comparator.
 */
function rev(cmp = natural) {
  return (a, b) => -cmp(a, b);
}

/**
 * Creates a comparator that passes elements through a key-extraction function
 * and compares the resulting keys. The extracted keys are compared using the
 * given comparator (or natural order if none is given).
 *
 * For instance, to sort strings by their length, leaving strings of the same
 * length in the same order relative to each other:
 *
 *    const byLength = cmp.comparing((s) => s.length);
 *    words.sort(byLength);
 *
 * Or, to sort people by their names, locale-sensitively:
 *
 *    const byName = cmp.comparing((p) => p.name, (a, b) => a.localeCompare(b));
 *    people.sort(byName);
 */
function comparing(f, cmp = natural) {
  return (a, b) => cmp(f(a), f(b));
}

/**
 * Creates a comparator that tries each of the given comparators in turn,
 * honoring the first one that gives a nonzero result. For instance, to sort
 * strings by their length, breaking ties by lexicographical order:
 *
 *    const byLength = cmp.comparing((s) => s.length);
 *    const byValue = cmp.natural;
 *    const shortlex = first([byLength, byValue]);
 *    words.sort(shortlex);
 */
function first(cmps) {
  return (a, b) => {
    for (const cmp of cmps) {
      const result = cmp(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

/**
 * Creates a comparator that treats `null` and `undefined` values as equal to
 * each other but greater than all other elements, falling back to `cmp` for
 * comparisons between non-nullish values. It is therefore guaranteed that
 * `cmp` will only be called with non-nullish inputs.
 */
function nullsLast(cmp = natural) {
  return (a, b) => {
    if (a == null && b != null) return 1;
    if (a != null && b == null) return -1;
    if (a == null && b == null) return 0;
    return cmp(a, b);
  };
}

module.exports = {
  natural,
  rev,
  comparing,
  first,
  nullsLast,
};
