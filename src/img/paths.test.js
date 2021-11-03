const { imagePath } = require("./paths");

describe("img/paths", () => {
  describe("imagePath", () => {
    it("pads zeros for token ID parts (but not project ID)", () => {
      expect(imagePath(0)).toEqual("0/000/000");
      expect(imagePath(1001)).toEqual("0/001/001");
    });
    it("properly renders a realistic token ID with all parts nonzero", () => {
      expect(imagePath(12345678)).toEqual("12/345/678");
    });
  });
});
