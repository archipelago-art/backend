const { downloadImage, resizeImage } = require("./downloadImages");
const { ingest } = require("./ingest");
const { list, listingProgress } = require("./list");
const generate = require("./generator");

module.exports = {
  download: downloadImage,
  resize: resizeImage,
  list,
  listingProgress,
  ingest,
  generate,
};
