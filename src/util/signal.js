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
  /**
   * Wait for the signal to be set and then resets it, or rejects without
   * resetting if `timeout` ms elapse (if `timeout` is non-null).
   *
   * This differs from `Promise.race([sleepMs(t), s.wait().then(s.reset)])` in
   * that it only resets the signal if it resolves *during* this call.
   */
  async waitAndReset(timeout) {
    let task, timer;
    if (timeout == null) {
      task = this.wait();
    } else {
      task = Promise.race([
        new Promise((res, rej) => {
          timer = setTimeout(() => rej("timed out"), timeout);
        }),
        this.wait(),
      ]);
    }
    const res = await task;
    this.reset();
    if (timer != null) clearTimeout(timer);
    return res;
  }
}

function signal() {
  return new Signal();
}

module.exports = signal;
