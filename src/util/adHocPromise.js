// Creates a new, suspended promise returns it, along with handles to resolve
// or reject it at will.
function adHocPromise() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

module.exports = adHocPromise;
