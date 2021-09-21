async function addProject({ client, project }) {
  return await client.query(
    `
    INSERT INTO projects (project_id, name, max_invocations)
    VALUES ($1, $2, $3)
    `,
    [project.projectId, project.name, project.maxInvocations]
  );
}

async function getProject({ client, projectId }) {
  const res = await await client.query(
    `
    SELECT
      project_id AS "projectId",
      name as "name",
      max_invocations AS "maxInvocations"
    FROM projects
    WHERE project_id = $1
    `,
    [projectId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

module.exports = {
  addProject,
  getProject,
};
