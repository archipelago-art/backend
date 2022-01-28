const parmap = require("./parmap");

describe("util/parmap", () => {
  async function asyncToString(x) {
    return String(x);
  }
  async function asyncFail(x) {
    throw new Error(String(x));
  }

  it("returns empty on empty input", async () => {
    expect(await parmap(4, [], asyncFail)).toEqual([]);
  });

  it("works with `batchSize < xs.length`", async () => {
    const xs = [1, 4, 9, 16];
    const expected = ["1", "4", "9", "16"];
    expect(await parmap(2, xs, asyncToString)).toEqual(expected);
  });

  it("works with `batchSize === xs.length`", async () => {
    const xs = [1, 4, 9, 16];
    const expected = ["1", "4", "9", "16"];
    expect(await parmap(4, xs, asyncToString)).toEqual(expected);
  });

  it("works with `batchSize > xs.length`", async () => {
    const xs = [1, 4, 9, 16];
    const expected = ["1", "4", "9", "16"];
    expect(await parmap(8, xs, asyncToString)).toEqual(expected);
  });

  it("propagates worker failures", async () => {
    await expect(parmap(4, [1, 2, 3], asyncFail)).rejects.toThrow(/[123]/);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    const batchSize = 3;
    const delayMs = 25;
    const iterations = 4;
    async function worker() {
      active++;
      if (active > batchSize) throw new Error("too many cooks!");
      await new Promise((res) => setTimeout(res, delayMs));
      active--;
      return "ok";
    }
    expect(
      await parmap(batchSize, Array(batchSize * iterations).fill(), worker)
    ).toEqual(Array(batchSize * iterations).fill("ok"));
  });
});
