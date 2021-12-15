const crypto = require("crypto");

const ObjectType = Object.freeze({
  TOKEN: 1,
  PROJECT: 2,
  FEATURE: 3,
  TRAIT: 4,
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

  return BigInt.asIntN(64, typePart | timestampPart | entropyPart);
}

module.exports = {
  ObjectType,
  objectTypeToName,
  newId,
};
