const log = require("../../util/log")(__filename);
const { acqrel, bufToHex } = require("../util");

async function genesisBlockNullParentHash({ pool }) {
  await acqrel(pool, async (client) => {
    await client.query("BEGIN");
    const res = await client.query(
      `
      UPDATE eth_blocks SET parent_hash = NULL WHERE block_number = 0
      RETURNING block_number AS "blockNumber", block_hash AS "blockHash"
      `
    );
    function fmt(row) {
      return `block #${row.blockNumber} (${bufToHex(row.blockHash)})`;
    }
    if (res.rowCount !== 1) {
      const badRows = res.rows.map(fmt).join();
      throw new Error(
        `expected one changed row; got ${res.rowCount}: [${badRows}]`
      );
    }
    await client.query("COMMIT");
    log.info`nulled out parent hash: ${fmt(res.rows[0])}`;
  });
}

module.exports = genesisBlockNullParentHash;
