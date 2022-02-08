const crypto = require("crypto");

const ObjectType = Object.freeze({
  TOKEN: 1,
  PROJECT: 2,
  FEATURE: 3,
  TRAIT: 4,
  CURRENCY: 5,
  BID: 6,
  ASK: 7,
  CNF: 8,
});

const objectTypeToName = Object.freeze([undefined, ...Object.keys(ObjectType)]);
for (let i = 0; i < objectTypeToName.length; i++) {
  const name = objectTypeToName[i];
  if (name === undefined) continue;
  const actual = ObjectType[name];
  if (actual !== i)
    throw new Error(
      `ObjectType[objectTypeToName[${i}]]: expected ${i}, got ${actual}`
    );
}

const MAX_TIMESTAMP = 2 ** 42 - 1;
// Guard against accidentally passing in seconds instead of milliseconds.
const MIN_TIMESTAMP = +new Date("2000-01-01T00:00:00Z");

function asI64(bigint) {
  return BigInt.asIntN(64, bigint);
}

function newId(
  objectType,
  {
    timestampMs = Date.now(),
    entropyBuf = crypto.randomBytes(2),
    checkObjectType = true,
  } = {}
) {
  // ID format, from LSB to MSB:
  //
  //   - bits 0-16: 16 bits entropy
  //   - bits 16-58: 42 bits of timestamp, unsigned milliseconds since 1970
  //     (sufficient until year 2109)
  //   - bits 58-64: 6 bits of object type
  //
  // Value is interpreted as a signed 64-bit `BigInt`. As a consequence, IDs
  // for a given object type are naturally ordered by timestamp (modulo
  // entropy).

  if (checkObjectType && objectTypeToName[objectType] == null) {
    throw new Error("invalid object type: " + objectType);
  }
  if (
    !Number.isInteger(timestampMs) ||
    timestampMs > MAX_TIMESTAMP ||
    timestampMs < MIN_TIMESTAMP
  ) {
    throw new Error("invalid timestamp: " + timestampMs);
  }
  if (!Buffer.isBuffer(entropyBuf) || entropyBuf.length !== 2) {
    throw new Error("invalid entropy buffer: " + entropyBuf);
  }

  const entropyPart = BigInt(entropyBuf.readUint16LE());
  const timestampPart = BigInt(timestampMs) << 16n;
  const typePart = BigInt(objectType) << 58n;

  return String(asI64(typePart | timestampPart | entropyPart));
}

// Generates `n` strictly ascending IDs with the given parameters.
//
// (This works even with `n > 2**16`; it may simply take more than 1ms.)
function newIds(n, ...newIdArgs) {
  const set = new Set();
  while (set.size < n) {
    set.add(newId(...newIdArgs));
  }
  return Array.from(set)
    .map((i) => BigInt(i))
    .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))
    .map((i) => String(i));
}

function idBounds(objectType) {
  if (objectTypeToName[objectType] == null) {
    throw new Error("invalid object type: " + objectType);
  }
  const min = BigInt(objectType) << 58n;
  const max = min | ((1n << 58n) - 1n);
  return { min: String(asI64(min)), max: String(asI64(max)) };
}

module.exports = {
  ObjectType,
  objectTypeToName,
  idBounds,
  newId,
  newIds,
};
