const Cmp = require("./cmp");

describe("util/cmp", () => {
  describe("natural", () => {
    it("compares strings naturally", () => {
      const actual = ["bob", "alice", "cheryl"].sort(Cmp.natural);
      expect(actual).toEqual(["alice", "bob", "cheryl"]);
    });
    it("compares numbers naturally (not lexicographically)", () => {
      const actual = [9, 10, 8].sort(Cmp.natural);
      expect(actual).toEqual([8, 9, 10]);
    });
  });

  describe("rev", () => {
    it("defines a reverse-natural order by default", () => {
      const actual = [9, 10, 8].sort(Cmp.rev());
      expect(actual).toEqual([10, 9, 8]);
    });
    it("reverses the order of a given sub-comparator", () => {
      const byBidDesc = Cmp.rev(Cmp.comparing((x) => x.bid));
      const actual = [{ bid: 9 }, { bid: 10 }, { bid: 8 }].sort(byBidDesc);
      expect(actual).toEqual([{ bid: 10 }, { bid: 9 }, { bid: 8 }]);
    });
  });

  describe("comparing", () => {
    it("accepts a simple accessor as only argument", () => {
      const byLength = Cmp.comparing((s) => s.length);
      const actual = ["alice", "bob", "cheryl"].sort(byLength);
      expect(actual).toEqual(["bob", "alice", "cheryl"]);
    });
    it("keeps ties stable", () => {
      const byLength = Cmp.comparing((s) => s.length);
      const actual = ["alice", "bob", "bab", "beb"].sort(byLength);
      expect(actual).toEqual(["bob", "bab", "beb", "alice"]);
    });
    it("accepts an accessor and sub-comparator", () => {
      const byRevLength = Cmp.comparing((s) => s.length, Cmp.rev());
      const actual = ["alice", "bob", "cheryl"].sort(byRevLength);
      expect(actual).toEqual(["cheryl", "alice", "bob"]);
    });
  });

  describe("first", () => {
    it("uses the first nonzero comparator result", () => {
      const shortlex = Cmp.first([Cmp.comparing((s) => s.length), Cmp.natural]);
      const actual = ["bob", "bab", "beb", "jo", "alice"].sort(shortlex);
      expect(actual).toEqual(["jo", "bab", "beb", "bob", "alice"]);
    });
    it("returns zero when all comparators return zero", () => {
      const byHookOrByCrook = Cmp.first([
        Cmp.comparing((x) => x.hook),
        Cmp.comparing((x) => x.crook),
      ]);
      const x = { hook: 1, crook: 2, brook: 3 };
      const y = { hook: 1, crook: 2, brook: 5 };
      expect(byHookOrByCrook(x, y)).toEqual(0);
    });
  });

  describe("nullsLast", () => {
    it("pushes nulls to the end of natural order by default", () => {
      const actual = [9, null, 10, 8].sort(Cmp.nullsLast());
      expect(actual).toEqual([8, 9, 10, null]);
    });
    it("accepts a sub-comparator only invoked on non-nulls", () => {
      const byLength = Cmp.comparing((s) => s.length);
      const actual = ["alice", null, "bob"].sort(Cmp.nullsLast(byLength));
      expect(actual).toEqual(["bob", "alice", null]);
    });
  });

  describe("array", () => {
    function checkPrecedes(xs, ys, cmp = Cmp.array()) {
      expect({ xs, ys, result: cmp(xs, ys) }).toEqual({ xs, ys, result: -1 });
      expect({ xs, ys, result: cmp(ys, xs) }).toEqual({ xs, ys, result: 1 });
    }
    function checkEqual(xs, ys, cmp = Cmp.array()) {
      expect({ xs, ys, result: cmp(xs, ys) }).toEqual({ xs, ys, result: 0 });
      expect({ xs, ys, result: cmp(ys, xs) }).toEqual({ xs, ys, result: 0 });
    }
    it("compares empty array shorter than any other", () => {
      checkEqual([], []);
      checkPrecedes([], [1]);
      checkPrecedes([], [-1]);
    });
    it("honors the first differing element", () => {
      checkPrecedes([1, 2, 3], [1, 5, 2]);
    });
    it("honors strict prefixes", () => {
      checkPrecedes([1, 2, 3], [1, 2, 3, 2, 1]);
    });
    it("honors exact equality", () => {
      checkEqual([1, 2, 3], [1, 2, 3]);
    });
    it("honors exact comparator equality even on object inequality", () => {
      checkEqual(
        [2, 4, 6],
        [3, 5, 7],
        Cmp.comparing((x) => Math.floor(x / 2))
      );
    });
  });
});
