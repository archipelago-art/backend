const log = require("../../util/log")(__filename);
const { acqrel, bufToHex } = require("../util");

const RPC_BATCH_SIZE = 128;
const QUERY_BATCH_SIZE = RPC_BATCH_SIZE * 4;

async function backfillBlocks({ pool, verbose }) {
  let total = 0;
  const res = await pool.query(
    `
    BEGIN;

    CREATE TEMPORARY TABLE changes(
      trait_id traitid PRIMARY KEY,
      feature_id featureid NOT NULL,
      old_value jsonb NOT NULL,
      new_value jsonb NOT NULL
        CHECK(jsonb_typeof(new_value) = 'string')
    );

    CREATE INDEX ON changes(feature_id, new_value) INCLUDE (trait_id);

    INSERT INTO changes(trait_id, feature_id, old_value, new_value) (
      SELECT
        trait_id,
        feature_id,
        value AS old_value,
        to_jsonb(coalesce(value->>0, 'null')) AS new_value
      FROM traits
    );

    UPDATE traits
    SET value = new_value
    FROM changes c1
    WHERE
      traits.trait_id = c1.trait_id
      AND (
        SELECT count(1) FROM changes c2
        WHERE c1.feature_id = c2.feature_id AND c1.new_value = c2.new_value
      ) = 1;

    COMMIT;
    `
  );
  const insertRes = res[res.length - 3];
  const updateRes = res[res.length - 2];
  log.info`done: updated ${updateRes.rowCount} of ${insertRes.rowCount} traits`;
}

module.exports = backfillBlocks;
