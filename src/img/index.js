const { downloadImage, resizeImage } = require("./downloadImages");
const { ingest } = require("./ingest");
const { list } = require("./list");
const generate = require("./generator");

module.exports = {
  download: downloadImage,
  resize: resizeImage,
  list,
  ingest,
  generate,
};
