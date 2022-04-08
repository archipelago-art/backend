const adHocPromise = require("./adHocPromise");

class Signal {
  constructor() {
    this.reset();
  }
  reset() {
    this._adHocPromise = adHocPromise();
  }
  set(v) {
    this._adHocPromise.resolve(v);
  }
  async wait() {
    return await this._adHocPromise.promise;
  }
  async waitAndReset() {
    const res = await this.wait();
    this.reset();
    return res;
  }
}

function signal() {
  return new Signal();
}

module.exports = signal;
