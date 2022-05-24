const adHocPromise = require("./adHocPromise");

async function queryPaginated({ bq, query, pageSize, callback }) {
  const [job] = await bq.createQueryJob(query);
  let result = adHocPromise();
  async function bigqueryCallback(err, rows, nextQuery) {
    if (err != null) {
      result.reject(err);
      return;
    }
    try {
      await callback(rows);
    } catch (e) {
      result.reject(e);
      return;
    }
    if (nextQuery) {
      job.getQueryResults(nextQuery, bigqueryCallback);
    } else {
      result.resolve();
    }
  }
  job.getQueryResults(
    { autoPaginate: false, maxResults: pageSize },
    bigqueryCallback
  );
  return result.promise;
}

module.exports = queryPaginated;
