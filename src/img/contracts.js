const {
  CONTRACT_ARTBLOCKS_LEGACY,
  CONTRACT_ARTBLOCKS_STANDARD,
} = require("../db/artblocks");
const AUTOGLYPHS_CONTRACT = require("../db/autoglyphs").CONTRACT_ADDRESS;
const CRYPTOADZ_CONTRACT = require("../db/cryptoadz");

const CONTRACT_IMAGE_INFO = {
  [CONTRACT_ARTBLOCKS_LEGACY]: {
    projectName: "artblocks",
    externalUrl: "https://media.artblocks.io/{tokenid}.png",
  },
  [CONTRACT_ARTBLOCKS_STANDARD]: {
    projectName: "artblocks",
    externalUrl: "https://media.artblocks.io/{tokenid}.png",
  },
  [AUTOGLYPHS_CONTRACT]: {
    projectName: "autoglyphs",
    externalUrl:
      "https://larvalabs.com/public/images/autoglyphs/glyph{tokenid}.svg",
  },
  [CRYPTOADZ_CONTRACT]: {
    projectName: "cryptoadz",
    externalUrl:
      "https://qiydg7uxbfyhvl4jfhmlsqrzcjirat6w7xpyjiogwuifswrfm4.arweave.net/gjAzfpcJcHqviSnYuUI5ElEQT9b934ShxrUQ-WVolZ0/{tokenid}.png",
  },
};

function imageInfo(token) {
  const res = CONTRACT_IMAGE_INFO[token.tokenContract];
  if (res == null) {
    throw new Error(
      `no info for token ${token.slug} #${token.tokenIndex} (missing contract ${token.tokenContract})`
    );
  }
  return res;
}

module.exports = { imageInfo };
