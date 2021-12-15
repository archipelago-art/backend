const { ObjectType, idBounds, newId } = require("./id");

describe("db/id", () => {
  describe("newId", () => {
    it("includes the right tag for ObjectType.TOKEN", () => {
      const id = newId(ObjectType.TOKEN);
      expect(Number(id >> 58n)).toEqual(ObjectType.TOKEN);
    });
    it("includes the right tag for ObjectType.PROJECT", () => {
      const id = newId(ObjectType.PROJECT);
      expect(Number(id >> 58n)).toEqual(ObjectType.PROJECT);
    });

    it("puts the right bits in the right spots when manually specified", () => {
      const now = +new Date("2001-02-03T04:05:06Z");
      const id = newId(ObjectType.TOKEN, {
        timestampMs: now,
        entropyBuf: Buffer.from([0xab, 0xcd]),
      });
      expect(Number(id >> 58n)).toEqual(ObjectType.TOKEN);
      expect(Number((id >> 16n) & ((1n << 42n) - 1n))).toEqual(now);
      expect(Number(id & ((1n << 16n) - 1n))).toEqual(0xcdab);
    });

    it("works with large (but in-range) timestamps", () => {
      const type = 2;
      const now = +new Date("2109-01-01T00:00:00Z");
      const id = newId(type, {
        timestampMs: now,
        entropyBuf: Buffer.from([0xab, 0xcd]),
      });
      expect(Number(id >> 58n)).toEqual(type);
      expect(Number((id >> 16n) & ((1n << 42n) - 1n))).toEqual(now);
      expect(Number(id & ((1n << 16n) - 1n))).toEqual(0xcdab);
    });

    it("rejects out-of-range timestamps", () => {
      const type = 2;
      const now = +new Date("2109-12-12T00:00:00Z");
      expect(() => newId(ObjectType.TOKEN, { timestampMs: now })).toThrow(
        "invalid timestamp: 4416249600000"
      );
    });

    it("rejects timestamps passed as seconds instead of milliseconds", () => {
      const type = 2;
      const now = Math.floor(+new Date("2001-02-03T04:05:06Z") / 1000);
      expect(() => newId(ObjectType.TOKEN, { timestampMs: now })).toThrow(
        "invalid timestamp: 981173106"
      );
    });

    it("rejects unknown object types", () => {
      expect(() => newId(30)).toThrow("invalid object type: 30");
    });

    it("returns positive integers for object types less than 32", () => {
      const type = 31;
      const id = newId(type, { checkObjectType: false });
      expect(id).toBeGreaterThanOrEqual(2n ** 62n);
      expect(Number(id >> 58n)).toEqual(type);
    });

    it("returns negative (signed 64-bit) integers for larger object types", () => {
      const type = 32;
      const id = newId(type, { checkObjectType: false });
      expect(id).toBeLessThan(0n);
      expect(Number(BigInt.asUintN(64, id) >> 58n)).toEqual(type);
    });
  });

  describe("idBounds", () => {
    it("returns the proper bounds for token IDs", () => {
      expect(idBounds(ObjectType.TOKEN)).toEqual({
        min: 0x400000000000000n,
        max: 0x7ffffffffffffffn,
      });
    });
    it("rejects unknown object types", () => {
      expect(() => newId(30)).toThrow("invalid object type: 30");
    });
  });
});
