const child_process = require("child_process");
const fs = require("fs");
const { join } = require("path");
const util = require("util");

const {
  evalUntrustedHtml,
  screenshotUntrustedHtml,
} = require("./untrustedHtml");

let hasChromium = true;
try {
  // Pardon the module-level side effect; there doesn't seem to be a way to get
  // this status to Jest later.
  child_process.execFileSync("which", ["chromium"]);
} catch (e) {
  hasChromium = false;
}
function describeIfChromium(...args) {
  if (hasChromium) {
    return describe(...args);
  } else {
    return describe.skip(...args);
  }
}

describeIfChromium("untrustedHtml", () => {
  describe("evalUntrustedHtml", () => {
    it("evaluates HTML that depends a provided JavaScript file", async () => {
      const indexHtml = `\
<!DOCTYPE html><body><script src="features.js"></script><script>
(() => {
  const tokenId = "123";
  const hash = "0x" + "00".repeat(32);
  const tokenData = { tokenId, hash };
  const features = calculateFeatures(tokenData);
  document.body.innerText = JSON.stringify(features);
})();
</script></body>
`;
      const featuresJs = `\
function calculateFeatures(tokenData) {
  return {
    "Token ID": tokenData.tokenId,
    "Hash": tokenData.hash,
  };
}
`;
      const res = await evalUntrustedHtml({
        "/index.html": indexHtml,
        "/features.js": featuresJs,
      });
      expect(JSON.parse(res)).toEqual({
        "Token ID": "123",
        Hash: "0x" + "00".repeat(32),
      });
    });
  });

  describe("screenshotUntrustedHtml", () => {
    it("produces a PNG output file", async () => {
      const indexHtml = "<!DOCTYPE html><body>Hello, world!</body>\n";
      // Use a local tmpdir to work around bug in Ubuntu 20.04:
      // https://bugs.launchpad.net/ubuntu/+source/chromium-browser/+bug/1851250
      const tmpdir = await util.promisify(fs.mkdtemp)(
        "./tmp.untrustedHtml.test.js."
      );
      const outfile = () => join(tmpdir, "out.png");
      try {
        await screenshotUntrustedHtml({ "/index.html": indexHtml }, outfile());
        const buf = await util.promisify(fs.readFile)(outfile());
        expect(buf.slice(0, 4).toString("latin1")).toEqual("\x89PNG");
      } finally {
        await util
          .promisify(fs.rm)(outfile())
          .catch(() => {});
        await util.promisify(fs.rmdir)(tmpdir);
      }
    });
  });
});
