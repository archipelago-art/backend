const { ObjectType, newId } = require("./id");
const { addCnf, canonicalForm } = require("./cnfs");

describe("db/cnfs", () => {
  function dummyId(x) {
    return newId(ObjectType.TRAIT, {
      timestampMs: +new Date("2022-02-02"),
      entropyBuf: Buffer.from(new Uint8Array([0, x])),
    });
  }
  const i1 = dummyId(1);
  const i2 = dummyId(2);
  const i3 = dummyId(3);
  if (i1 > i2 || i2 > i3) {
    throw new Error("test invariant violation");
  }
  describe("canonicalForm", () => {
    it("errors if there is an empty CNF", () => {
      expect(() => canonicalForm([])).toThrowError("empty cnf");
    });
    it("errors if a CNF has an empty clause", () => {
      expect(() => canonicalForm([[i1], [], [i3]])).toThrowError(
        "empty clause"
      );
    });
    it("canonicalizes out duplicated terms", () => {
      expect(canonicalForm([[i1, i1]])).toEqual([[i1]]);
    });
    it("canonicalizes out duplicated clauses", () => {
      expect(canonicalForm([[i1], [i1]])).toEqual([[i1]]);
    });
    it("canonicalizes out second-order duplications", () => {
      expect(canonicalForm([[i1, i1], [i1]])).toEqual([[i1]]);
    });
    it("within-clause ordering is canoncalized", () => {
      const c1 = [[i1, i2, i3]];
      const c2 = [[i3, i2, i1]];
      const cx = canonicalForm(c1);
      expect(cx).toEqual(c1);
      expect(cx).toEqual(canonicalForm(c2));
    });
    it("across-clause ordering is canoncalized", () => {
      const c1 = [[i1], [i2, i3]];
      const c2 = [[i3, i2], [i1]];
      const cx = canonicalForm(c1);
      expect(cx).toEqual(c1);
      expect(cx).toEqual(canonicalForm(c2));
    });
  });
});
