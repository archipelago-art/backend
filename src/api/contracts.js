const artblocksLegacy = Object.freeze({
  address: "0x059EDD72Cd353dF5106D2B9cC5ab83a52287aC3a",
  name: "artblocks",
  externalUrl: "https://media.artblocks.io/{tokenid}.png",
});

const artblocksStandard = Object.freeze({
  address: "0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270",
  name: "artblocks",
  externalUrl: "https://media.artblocks.io/{tokenid}.png",
});

const autoglyphs = Object.freeze({
  name: "autoglyphs",
  address: "0xd4e4078ca3495de5b1d4db434bebc5a986197782",
  externalUrl:
    "https://larvalabs.com/public/images/autoglyphs/glyph{tokenid}.svg",
});

const cryptoadz = Object.freeze({
  name: "cryptoadz",
  address: "0x1CB1A5e65610AEFF2551A50f76a87a7d3fB649C6",
  externalUrl:
    "https://qiydg7uxbfyhvl4jfhmlsqrzcjirat6w7xpyjiogwuifswrfm4.arweave.net/gjAzfpcJcHqviSnYuUI5ElEQT9b934ShxrUQ-WVolZ0/{tokenid}.png",
});

const contracts = Object.freeze([
  artblocksLegacy,
  artblocksStandard,
  autoglyphs,
  cryptoadz,
]);

function contractForAddress(address) {
  for (const c of contracts) {
    if (c.address.toLowerCase() === address.toLowerCase()) {
      return c;
    }
  }
  return null;
}

module.exports = {
  artblocksStandard,
  artblocksLegacy,
  autoglyphs,
  cryptoadz,
  contracts,
  contractForAddress,
};
