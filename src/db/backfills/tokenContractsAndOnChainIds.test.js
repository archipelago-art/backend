const { testDbProvider } = require("../testUtil");

const { parseProjectData } = require("../../scrape/fetchArtblocksProject");
const snapshots = require("../../scrape/snapshots");
const artblocks = require("../artblocks");
const { hexToBuf, bufToAddress } = require("../util");
const backfillTokenContractsAndOnChainIds = require("./tokenContractsAndOnChainIds");

describe("backfills/tokenContractsAndOnChainIds", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  const nonstandardAddress = "0xEfa7bDD92B5e9CD9dE9b54AC0e3dc60623F1C989";
  const nonstandardTokenIndex = "456789";
  const nonstandardOnChainTokenId = "123456789";

  async function dump(client) {
    const projectsRes = await client.query(`
      SELECT project_id AS id, token_contract AS address FROM projects
      ORDER BY project_id ASC
    `);
    const tokensRes = await client.query(`
      SELECT
        token_id AS id,
        token_index AS index,
        token_contract AS address,
        on_chain_token_id AS "onChainId"
      FROM tokens
      ORDER BY token_id ASC
    `);
    const traitMembersRes = await client.query(`
      SELECT
        trait_id AS "traitId",
        token_id AS "tokenId",
        token_contract AS address,
        on_chain_token_id AS "onChainId"
      FROM trait_members
      ORDER BY trait_id ASC, token_id ASC
    `);
    return {
      projects: projectsRes.rows.map((r) => ({
        id: r.id,
        address: r.address && bufToAddress(r.address),
      })),
      tokens: tokensRes.rows.map((r) => ({
        id: r.id,
        index: r.index,
        address: r.address && bufToAddress(r.address),
        onChainId: r.onChainId,
      })),
      traitMembers: traitMembersRes.rows.map((r) => ({
        traitId: r.traitId,
        tokenId: r.tokenId,
        address: r.address && bufToAddress(r.address),
        onChainId: r.onChainId,
      })),
    };
  }

  it(
    "populates data for both legacy and standard projects, without replacing existing data",
    withTestDb(async ({ client, pool }) => {
      const projects = [
        { projectId: snapshots.SQUIGGLES, omit: false },
        { projectId: snapshots.GENESIS, omit: true },
        { projectId: snapshots.ARCHETYPE, omit: true },
      ];
      const tokens = [
        { tokenId: snapshots.PERFECT_CHROMATIC, omit: false },
        { tokenId: snapshots.GENESIS_ZERO, omit: true },
        { tokenId: snapshots.THE_CUBE, omit: true },
      ];

      for (const p of projects) {
        await artblocks.addProject({
          client,
          project: parseProjectData(p.projectId, await sc.project(p.projectId)),
          omitTokenContract: p.omit,
        });
      }
      await client.query(
        `
        UPDATE projects
        SET token_contract = $1
        WHERE project_id = $2
        `,
        [hexToBuf(nonstandardAddress), snapshots.SQUIGGLES]
      );
      for (const t of tokens) {
        await artblocks.addToken({
          client,
          tokenId: t.tokenId,
          rawTokenData: await sc.token(t.tokenId),
          omitTokenContractAndOnChainId: t.omit,
        });
      }
      await client.query(
        `
        UPDATE tokens
        SET
          on_chain_token_id = $1,
          token_index = $2
        WHERE token_id = $3
        `,
        [
          nonstandardOnChainTokenId,
          nonstandardTokenIndex,
          snapshots.PERFECT_CHROMATIC,
        ]
      );
      await client.query(
        `
        UPDATE trait_members
        SET on_chain_token_id = $1
        WHERE token_id = $2
        `,
        [nonstandardOnChainTokenId, snapshots.PERFECT_CHROMATIC]
      );

      function expected({ beforeBackfill }) {
        return {
          projects: [
            {
              id: snapshots.SQUIGGLES,
              address: nonstandardAddress,
            },
            {
              id: snapshots.GENESIS,
              address: beforeBackfill
                ? null
                : artblocks.CONTRACT_ARTBLOCKS_LEGACY,
            },
            {
              id: snapshots.ARCHETYPE,
              address: beforeBackfill
                ? null
                : artblocks.CONTRACT_ARTBLOCKS_STANDARD,
            },
          ],
          tokens: [
            {
              id: snapshots.PERFECT_CHROMATIC,
              index: nonstandardTokenIndex,
              address: nonstandardAddress,
              onChainId: nonstandardOnChainTokenId,
            },
            {
              id: snapshots.GENESIS_ZERO,
              index: beforeBackfill
                ? null
                : String(snapshots.GENESIS_ZERO % 1e6),
              address: beforeBackfill
                ? null
                : artblocks.CONTRACT_ARTBLOCKS_LEGACY,
              onChainId: beforeBackfill ? null : String(snapshots.GENESIS_ZERO),
            },
            {
              id: snapshots.THE_CUBE,
              index: beforeBackfill ? null : String(snapshots.THE_CUBE % 1e6),
              address: beforeBackfill
                ? null
                : artblocks.CONTRACT_ARTBLOCKS_STANDARD,
              onChainId: beforeBackfill ? null : String(snapshots.THE_CUBE),
            },
          ],
          traitMembers: expect.arrayContaining([
            {
              traitId: expect.any(Number),
              tokenId: snapshots.PERFECT_CHROMATIC,
              address: nonstandardAddress,
              onChainId: nonstandardOnChainTokenId,
            },
            {
              traitId: expect.any(Number),
              tokenId: snapshots.GENESIS_ZERO,
              address: beforeBackfill
                ? null
                : artblocks.CONTRACT_ARTBLOCKS_LEGACY,
              onChainId: beforeBackfill ? null : String(snapshots.GENESIS_ZERO),
            },
            {
              traitId: expect.any(Number),
              tokenId: snapshots.THE_CUBE,
              address: beforeBackfill
                ? null
                : artblocks.CONTRACT_ARTBLOCKS_STANDARD,
              onChainId: beforeBackfill ? null : String(snapshots.THE_CUBE),
            },
          ]),
        };
      }

      expect(await dump(client)).toEqual(expected({ beforeBackfill: true }));
      await backfillTokenContractsAndOnChainIds({ pool });
      expect(await dump(client)).toEqual(expected({ beforeBackfill: false }));
    })
  );
});
