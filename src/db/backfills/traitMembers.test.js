const { testDbProvider } = require("../testUtil");

const { parseProjectData } = require("../../scrape/fetchArtblocksProject");
const snapshots = require("../../scrape/snapshots");
const artblocks = require("../artblocks");
const backfillTraitMembers = require("./traitMembers");

const Mode = backfillTraitMembers.Mode;

describe("backfills/traitMembers", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function backfillState(client) {
    const res = await client.query(`
      SELECT token_id AS "id" FROM backfill_state_trait_members
      ORDER BY token_id
    `);
    return res.rows.map((r) => r.id);
  }

  async function addTestData(client) {
    await artblocks.addProject({
      client,
      project: parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      ),
    });
    await artblocks.addToken({
      client,
      tokenId: snapshots.ARCH_TRIPTYCH_1,
      rawTokenData: await sc.token(snapshots.ARCH_TRIPTYCH_1),
      includeTraitMembers: false,
    });
    await artblocks.addToken({
      client,
      tokenId: snapshots.ARCH_TRIPTYCH_2,
      rawTokenData: await sc.token(snapshots.ARCH_TRIPTYCH_2),
      includeTraitMembers: true,
    });
  }

  describe('"init" action', () => {
    it(
      "adds all token IDs, whether they have features or not",
      withTestDb(async ({ client, pool }) => {
        expect(await backfillState(client)).toEqual([]);
        await addTestData(client);
        await backfillTraitMembers({ pool, args: [Mode.INIT] });
        expect(await backfillState(client)).toEqual([
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
        ]);
      })
    );
    it(
      "is idempotent",
      withTestDb(async ({ client, pool }) => {
        await addTestData(client);
        await backfillTraitMembers({ pool, args: [Mode.INIT] });
        await backfillTraitMembers({ pool, args: [Mode.INIT] });
        const res = await client.query(`
          SELECT token_id AS "id" FROM backfill_state_trait_members
          ORDER BY token_id
        `);
        expect(await backfillState(client)).toEqual([
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
        ]);
      })
    );
  });

  describe('"populate" action', () => {
    async function expectFlats(client, tokens) {
      const res = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId: snapshots.ARCHETYPE,
      });
      expect(res.find((x) => x.name === "Scene").traits).toEqual([
        expect.objectContaining({ value: "Flat", tokens }),
      ]);
    }
    it(
      "works when some tokens have traits already and others don't",
      withTestDb(async ({ client, pool }) => {
        await addTestData(client);
        await backfillTraitMembers({ pool, args: [Mode.INIT] });
        await expectFlats(client, [snapshots.ARCH_TRIPTYCH_2]);
        await backfillTraitMembers({ pool, args: [Mode.POPULATE] });
        await expectFlats(client, [
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
        ]);
        expect(await backfillState(client)).toEqual([]);
      })
    );
  });
});
