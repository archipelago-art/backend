const { downloadImage, resizeImage } = require("./downloadImages");
const { ingest } = require("./ingest");
const { list } = require("./list");

module.exports = {
  download: downloadImage,
  resize: resizeImage,
  list,
  ingest,
};
