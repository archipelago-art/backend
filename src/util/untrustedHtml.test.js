const child_process = require("child_process");

const evalUntrustedHtml = require("./untrustedHtml");

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

describeIfChromium("evalUntrustedHtml", () => {
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
