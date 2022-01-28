async function parmap(batchSize, xs, f) {
  if (batchSize === 0) throw new Error("batch size must be nonzero");
  const result = Array(xs.length).fill();
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < result.length) {
      const i = nextIdx++;
      result[i] = await f(xs[i]);
    }
  }
  await Promise.all(
    Array(batchSize)
      .fill()
      .map(() => worker())
  );
  return result;
}

module.exports = parmap;
