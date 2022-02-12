const Cmp = require("./cmp");
const uniqInPlace = require("./uniqInPlace");

describe("uniqInPlace", () => {
  it("leaves the empty array untouched", () => {
    const xs = [];
    uniqInPlace(xs);
    expect(xs).toEqual([]);
  });
  it("leaves a singleton array untouched", () => {
    const xs = [1];
    uniqInPlace(xs);
    expect(xs).toEqual([1]);
  });
  it("removes consecutive duplicates, keeping the first", () => {
    const byName = Cmp.comparing((s) => s.name);
    const xs = [
      { name: "alice", id: 1 },
      { name: "bob", id: 2 },
      { name: "bob", id: 3 },
      { name: "bob", id: 4 },
      { name: "cheryl", id: 5 },
      { name: "alice", id: 6 },
      { name: "alice", id: 7 },
    ];
    uniqInPlace(xs, byName);
    expect(xs).toEqual([
      { name: "alice", id: 1 },
      { name: "bob", id: 2 },
      { name: "cheryl", id: 5 },
      { name: "alice", id: 6 },
    ]);
  });
});
