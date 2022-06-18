async function up({ client }) {
  await client.query(`
    ALTER TABLE eth_job_progress
      ADD COLUMN job_type text,
      ADD COLUMN job_args jsonb;
  `);
}

module.exports = { up };
