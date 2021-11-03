const { downloadImage, resizeImage } = require("./downloadImages");
const { list } = require("./list");

module.exports = {
  download: downloadImage,
  resize: resizeImage,
  list,
};
