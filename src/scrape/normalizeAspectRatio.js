const RE_RATIO = /^(0|[1-9][0-9]*)\/(0|[1-9][0-9]*)$/;
const RE_DECIMAL = /^(0|[1-9][0-9]*)?(?:\.([0-9]+))?$/;

function normalizeAspectRatio(ar) {
  if (ar == null) throw new Error("nullish aspect ratio: " + ar);
  if (typeof ar === "number") return ar;
  const ratio = ar.match(RE_RATIO);
  if (ratio != null) return Number(ratio[1]) / Number(ratio[2]);
  const decimal = ar.match(RE_DECIMAL);
  if (decimal != null) return Number(ar);
  throw new Error("unsupported aspect ratio: " + JSON.stringify(ar));
}

module.exports = normalizeAspectRatio;
