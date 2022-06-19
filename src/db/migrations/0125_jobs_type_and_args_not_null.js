async function up({ client }) {
  await client.query(`
    ALTER TABLE eth_job_progress
      ALTER COLUMN job_type SET NOT NULL,
      ALTER COLUMN job_args SET NOT NULL;
  `);
}

module.exports = { up };
