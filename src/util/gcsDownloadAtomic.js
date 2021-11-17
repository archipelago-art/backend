const fs = require("fs");
const util = require("util");

async function downloadAtomic(gcsFile, options = {}) {
  const dst = options.destination;
  if (dst == null) throw new Error("must provide options.destination");
  return new Promise((res, rej) => {
    const bufs = [];
    let done = false;
    gcsFile
      .createReadStream(options)
      .on("error", (e) => {
        if (done) return;
        done = true;
        rej(e);
      })
      .on("data", (buf) => {
        if (done) return;
        bufs.push(buf);
      })
      .on("end", () => {
        if (done) return;
        done = true;
        util
          .promisify(fs.writeFile)(dst, Buffer.concat(bufs))
          .then(() => res())
          .catch((e) => rej(e));
      });
  });
}

module.exports = downloadAtomic;
