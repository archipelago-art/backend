const { ORIG, targets } = require("./ingestTargets");

describe("img/ingestTargets", () => {
  describe("targets", () => {
    it("returns an array of targets", () => {
      const ts = targets();
      expect(ts).toEqual(expect.any(Array));
      expect(ts.find((t) => t.name == null || t.type == null)).toBe(undefined);
    });
    it("includes the ${ORIG} target first", () => {
      expect(targets()[0]).toEqual(expect.objectContaining({ name: ORIG }));
    });
  });
});
