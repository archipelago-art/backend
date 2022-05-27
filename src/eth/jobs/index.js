const makeEchoJob = require("./echo");

const JOBS = [
  makeEchoJob(),
  // ...
];

function getJob(index) {
  const job = JOBS[index];
  if (job == null) throw new Error("no job for index " + index);
  return job;
}

function getAllJobs() {
  return JOBS.slice();
}

module.exports = { getJob, getAllJobs };
