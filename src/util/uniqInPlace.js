const Cmp = require("./cmp");

/**
 * Removes all but the first of consecutive elements in the array that compare
 * equal under `cmp`. If the array is sorted, this removes all duplicates.
 *
 * (Equivalent to Rust `Vec::dedup_by`.)
 */
function uniqInPlace(xs, cmp = Cmp.natural) {
  let removed = 0; // number of duplicates seen so far
  for (let i = 1; i < xs.length; i++) {
    if (cmp(xs[i - 1], xs[i]) === 0) {
      removed++;
    } else {
      xs[i - removed] = xs[i];
    }
  }
  xs.splice(xs.length - removed, removed);
}

module.exports = uniqInPlace;
