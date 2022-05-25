const { BigQuery } = require("@google-cloud/bigquery");

const dbEth = require("../db/eth");
const queryPaginated = require("../util/bigqueryPaginated");
const log = require("../util/log")(__filename);

const BLOCK_PAGE_SIZE = 10000;

function makeQuery({ startBlock }) {
  const query =
    "SELECT `number`, `hash`, `parent_hash` AS `parentHash`, `timestamp` " +
    "FROM `bigquery-public-data.crypto_ethereum.blocks` " +
    "WHERE `number` >= ? " +
    "ORDER BY `number` ASC";
  return { query, params: [startBlock] };
}

async function addHistoricalBlocks({ client, startBlock }) {
  const bq = new BigQuery();
  async function callback(rows) {
    if (rows.length === 0) return;
    log.info`adding ${rows[0]?.number}..=${rows[rows.length - 1]?.number}`;
    for (const row of rows) {
      row.timestamp = Math.floor(Date.parse(row.timestamp.value) / 1000);
    }
    await dbEth.addBlocks({ client, blocks: rows });
  }
  const query = makeQuery({ startBlock });
  log.info`starting BigQuery query for historical block data`;
  log.debug`BigQuery query: ${JSON.stringify(query)}`;
  await queryPaginated({ bq, query, pageSize: BLOCK_PAGE_SIZE, callback });
  log.info`done ingesting historical block data`;
}

module.exports = addHistoricalBlocks;
