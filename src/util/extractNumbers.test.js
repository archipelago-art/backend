const extractNumbers = require("./extractNumbers");

describe("util/extractNumbers", () => {
  it("handles numbers offset by spaces", () => {
    expect(extractNumbers("a 1 b 2 c")).toEqual(["a ", "1", " b ", "2", " c"]);
    expect(extractNumbers("7 z 8 9")).toEqual(["7", " z ", "8", " ", "9"]);
  });

  it("handles numbers set off by hyphens from words", () => {
    const input = "the 1-in-100 chance";
    const expected = ["the ", "1", "-in-", "100", " chance"];
    expect(extractNumbers(input)).toEqual(expected);
  });

  it("handles numbers set off by hyphens from other numbers", () => {
    const input = "easy as 1-2-3";
    const expected = ["easy as ", "1", "-", "2", "-", "3"];
    expect(extractNumbers(input)).toEqual(expected);
  });

  it("handles numbers with decimal places", () => {
    const input = "foo 1.23 bar 4.56.78";
    const expected = ["foo ", "1.23", " bar ", "4.56", ".78"];
  });

  it("handles numbers with signs", () => {
    const input = "from -1 to 0 to +1 and back";
    const expected = ["from ", "-1", " to ", "0", " to ", "+1", " and back"];
    expect(extractNumbers(input)).toEqual(expected);
  });

  it("handles numbers with minus signs in hyphenated contexts", () => {
    const input = "from--1-to-1-and-back";
    const expected = ["from-", "-1", "-to-", "1", "-and-back"];
    expect(extractNumbers(input)).toEqual(expected);
  });

  it('handles adjacent "x"s', () => {
    expect(extractNumbers("2x2 grid")).toEqual(["2", "x", "2", " grid"]);
    expect(extractNumbers("x3 bonus")).toEqual(["x", "3", " bonus"]);
    expect(extractNumbers("4x factor")).toEqual(["4", "x factor"]);
  });

  it("keeps parts of a 0x-string together", () => {
    expect(extractNumbers("0xa0b1")).toEqual(["0", "xa0b1"]);
    expect(extractNumbers("0x9f8e")).toEqual(["0", "x9f8e"]);
  });
});
