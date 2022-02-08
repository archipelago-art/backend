async function up({ client }) {
  await client.query(`
    CREATE DOMAIN cnfid AS int8 CONSTRAINT cnfid_type
      CHECK ((VALUE >> 58) & 63 = 8);

    CREATE DOMAIN bidscope AS int8 CONSTRAINT bidscope_type
      CHECK (((VALUE >> 58) & 63) IN (1, 2, 4, 8));

    CREATE DOMAIN orderid AS int8 CONSTRAINT orderid_type
      CHECK (((VALUE >> 58) & 63) IN (6, 7));

    CREATE TABLE bids (
      bid_id bidid PRIMARY KEY,
      project_id projectid NOT NULL REFERENCES projects(project_id),
      scope bidscope NOT NULL,
      active boolean NOT NULL,
      price uint256 NOT NULL,
      deadline timestamptz NOT NULL,
      create_time timestamptz NOT NULL,
      bidder address NOT NULL,
      nonce uint256 NOT NULL,
      agreement bytea NOT NULL,
      message bytea NOT NULL,
      signature signature NOT NULL
    );

    CREATE INDEX bids_scope_price_create_time
      ON bids(scope, price DESC, create_time ASC)
      INCLUDE (bid_id)
      WHERE active;

    CREATE TABLE asks (
      ask_id askid PRIMARY KEY,
      project_id projectid NOT NULL REFERENCES projects(project_id),
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      active boolean NOT NULL,
      price uint256 NOT NULL,
      deadline timestamptz NOT NULL,
      create_time timestamptz NOT NULL,
      asker address NOT NULL,
      nonce uint256 NOT NULL,
      agreement bytea NOT NULL,
      message bytea NOT NULL,
      signature signature NOT NULL
    );

    CREATE INDEX ask_token_id_price_create_time
      ON asks(token_id, price ASC, create_time ASC)
      INCLUDE (ask_id)
      WHERE active;

    CREATE INDEX ask_project_id_price_create_time
      ON asks(project_id, price ASC, create_time ASC)
      INCLUDE (ask_id)
      WHERE active;

    CREATE TABLE cnfs (
      cnf_id cnfid PRIMARY KEY,
      project_id projectid NOT NULL REFERENCES projects(project_id),
      canonical_form text NOT NULL,
      digest uuid NOT NULL,
      UNIQUE(project_id, digest)
    );

    CREATE TABLE cnf_clauses (
      cnf_id cnfid NOT NULL REFERENCES cnfs(cnf_id),
      clause_idx int NOT NULL,
      trait_id traitid NOT NULL REFERENCES traits(trait_id),
      PRIMARY KEY (cnf_id, clause_idx, trait_id)
    );

    CREATE TABLE cnf_members (
      cnf_id cnfid NOT NULL REFERENCES cnfs(cnf_id),
      token_id tokenid NOT NULL REFERENCES tokens(token_id),
      PRIMARY KEY (cnf_id, token_id)
    );
    CREATE INDEX cnf_members_token_id
      ON cnf_members(token_id);

    CREATE TABLE cnf_trait_update_queue (
      token_id tokenid PRIMARY KEY,
      traits_last_update_time timestamptz NOT NULL
    );
  `);
}

module.exports = { up };
