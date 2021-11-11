const { listingProgress } = require("./list");
const { targets } = require("./ingestTargets");

describe("img/list", () => {
  describe("listingProgress", () => {
    const done = () => targets().map((t) => t.name);
    const notDone = () => [];

    it("handles a representative case", () => {
      const listing = new Map()
        // project 0: tokens 0 through 1
        .set(0e6 + 0, done())
        .set(0e6 + 1, done())
        .set(0e6 + 2, notDone())
        // project 1: nothing (plus extra)
        .set(1e6 + 0, notDone())
        .set(1e6 + 1, done())
        // project 2: tokens 0 through 2 (plus irrelevant extra)
        .set(2e6 + 0, done())
        .set(2e6 + 1, done())
        .set(2e6 + 2, done())
        .set(2e6 + 4, done())
        // project 3: nothing (token 0 missing)
        .set(3e6 + 1, done())
        // project 4: token 0 only
        .set(4e6 + 0, done());
      expect(listingProgress(listing)).toEqual(
        new Map()
          .set(0, 0e6 + 1)
          .set(1, null)
          .set(2, 2e6 + 2)
          .set(3, null)
          .set(4, 4e6 + 0)
      );
    });
  });
});
