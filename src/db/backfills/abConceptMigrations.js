const log = require("../../util/log")(__filename);

async function backfill({ pool, verbose }) {
  const projectsRes = await pool.query(
    `
    SELECT project_id AS "projectId", script_json AS "scriptJson", script
    FROM projects
    WHERE script_json IS NOT NULL OR script IS NOT NULL
    `
  );
  const projectIds = projectsRes.rows.map((x) => x.projectId);
  const scriptJsons = projectsRes.rows.map((x) => x.scriptJson);
  const scripts = projectsRes.rows.map((x) => x.script);
  await pool.query(
    `
    UPDATE artblocks_projects
    SET script_json = updates.script_json,
        script = updates.script
    FROM (
      SELECT
        unnest($1::projectid[]) AS project_id,
        unnest($2::jsonb[]) AS script_json,
        unnest($3::text[]) AS script
    ) AS updates
    WHERE artblocks_projects.project_id = updates.project_id
    `,
    [projectIds, scriptJsons, scripts]
  );
  if (verbose) {
    log.info`updated ${projectsRes.rows.length} artblocks projects`;
  }

  const tokensRes = await pool.query(
    `
    SELECT token_id AS "tokenId", token_data AS "tokenData"
    FROM tokens
    WHERE token_data IS NOT NULL
    `
  );
  const tokenIds = tokensRes.rows.map((x) => x.tokenId);
  const tokenData = tokensRes.rows.map((x) => x.tokenData);
  await pool.query(
    `
    INSERT INTO artblocks_tokens (token_id, token_data)
    VALUES (unnest($1::tokenid[]), unnest($2::json[]))
    ON CONFLICT (token_id) DO NOTHING
    `,
    [tokenIds, tokenData]
  );
  if (verbose) {
    log.info`updated ${tokensRes.rows.length} artblocks tokens`;
  }
}

module.exports = backfill;
