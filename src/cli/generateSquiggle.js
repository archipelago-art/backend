const renderSquiggle = require("../img/generator/squiggles");
const log = require("../util/log")(__filename);

async function generateSquiggle(args) {
  if (args.length !== 3) {
    throw new Error("usage: generate-squiggle <token-index> <hash> <outfile>");
  }
  const [tokenIndexRaw, hash, outfile] = args;
  const tokenIndex = Number(tokenIndexRaw);
  if (String(tokenIndex) !== tokenIndexRaw)
    throw new Error("invalid token index: " + tokenIndexRaw);
  if (typeof hash !== "string" || hash.length !== 66 || !hash.startsWith("0x"))
    throw new Error("invalid hash: " + hash);

  const options = {
    tokenIndex,
    hash,
    width: 2400,
    height: 1600,
    transparent: true,
    outfile,
  };
  await renderSquiggle(options);
}

module.exports = generateSquiggle;
