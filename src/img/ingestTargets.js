function resizeTarget(dim) {
  return { name: `${dim}p`, type: "RESIZE", dim };
}

function letterboxTarget({ name, geometry, bg }) {
  return {
    name,
    type: "LETTERBOX",
    geometry,
    background: bg,
  };
}

const ORIG = "orig";

// Order matters: the `ORIGINAL` target should come first.
function targets() {
  return [
    { name: ORIG, type: "ORIGINAL" },
    ...[1200, 800, 600, 400, 200].map(resizeTarget),
    letterboxTarget({ name: "social", geometry: "1200x628", bg: "black" }),
  ];
}

module.exports = { ORIG, targets };
