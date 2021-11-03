const { imagePath, parseImagePath } = require("./paths");

describe("img/paths", () => {
  describe("imagePath", () => {
    it("pads zeros for token ID parts (but not project ID)", () => {
      expect(imagePath(0)).toEqual("0/000/000");
      expect(imagePath(1001)).toEqual("0/001/001");
    });
    it("properly renders a realistic token ID with all parts nonzero", () => {
      expect(imagePath(12345678)).toEqual("12/345/678");
    });
    it("returns slash-delimited output", () => {
      expect(imagePath(12345678)).toEqual("12/345/678");
    });
  });
  describe("parseImagePath", () => {
    it("parses paths with leading zeros and octal-looking numbers", () => {
      expect(parseImagePath("0/000/000")).toEqual(0);
      expect(parseImagePath("7/077/077")).toEqual(7077077);
    });
    it("properly parses a realistic path with all parts nonzero", () => {
      expect(parseImagePath("12/345/678")).toEqual(12345678);
    });
    it("handles backslashes", () => {
      expect(parseImagePath("12\\345\\678")).toEqual(12345678);
    });
    it("rejects components that are too short", () => {
      expect(parseImagePath("12/34/5")).toEqual(null);
    });
  });
});
