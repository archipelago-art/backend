const { acqrel, bufToAddress } = require("./util");
const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const autoglyphs = require("./autoglyphs");
const { newTokens, websocketMessages } = require("./channels");
const tokens = require("./tokens");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const adHocPromise = require("../util/adHocPromise");
const ws = require("./ws");

describe("db/tokens", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProjects(client, projectIds) {
    const projects = await Promise.all(
      projectIds.map(async (id) => parseProjectData(id, await sc.project(id)))
    );
    const result = [];
    for (const project of projects) {
      const id = await artblocks.addProject({ client, project });
      result.push({ project, id });
    }
    return result;
  }
  async function addTokens(client, tokenIds) {
    const tokens = await Promise.all(
      tokenIds.map(async (id) => ({
        artblocksTokenId: id,
        rawTokenData: await sc.token(id),
      }))
    );
    const result = [];
    for (const { artblocksTokenId, rawTokenData } of tokens) {
      const id = await artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData,
      });
      result.push({ artblocksTokenId, rawTokenData, id });
    }
    return result;
  }

  it(
    "adds tokens to an existing project",
    withTestDb(async ({ pool, client }) => {
      const [{ id: archetype }] = await addProjects(client, [
        snapshots.ARCHETYPE,
      ]);
      async function getTokenCount() {
        const res = await client.query(
          `
          SELECT
            (SELECT num_tokens FROM projects WHERE project_id = $1::projectid) AS a,
            (SELECT count(1)::int FROM tokens WHERE project_id = $1::projectid) AS b
          `,
          [archetype]
        );
        const { a, b } = res.rows[0];
        if (a !== b) throw new Error(`token count mismatch: ${a} !== ${b}`);
        return a;
      }
      async function getTokenId(onChainTokenId) {
        const tokenContract = artblocks.CONTRACT_ARTBLOCKS_STANDARD;
        return await tokens.tokenIdByChainData({
          client,
          tokenContract,
          onChainTokenId,
        });
      }
      expect(await getTokenCount()).toEqual(0);

      const tokenId1 = await acqrel(pool, async (listenClient) => {
        const newTokensEvent = adHocPromise();
        const websocketMessagesEvent = adHocPromise();
        listenClient.on("notification", (n) => {
          switch (n.channel) {
            case websocketMessages.name:
              websocketMessagesEvent.resolve(n.payload);
              break;
            case newTokens.name:
              newTokensEvent.resolve(n.payload);
              break;
          }
        });
        await newTokens.listen(listenClient);
        await websocketMessages.listen(listenClient);

        const tokenId1 = await tokens.addBareToken({
          client,
          projectId: archetype,
          tokenIndex: 250,
          onChainTokenId: snapshots.THE_CUBE,
        });
        expect(JSON.parse(await newTokensEvent.promise)).toEqual({
          projectId: archetype,
          tokenId: tokenId1,
        });
        expect(JSON.parse(await websocketMessagesEvent.promise)).toEqual({
          messageId: expect.any(String),
          timestamp: expect.any(String),
          type: "TOKEN_MINTED",
          topic: "archetype",
          data: {
            projectId: archetype,
            tokenId: tokenId1,
            slug: "archetype",
            tokenIndex: 250,
            tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
            onChainTokenId: 23000250,
          },
        });

        return tokenId1;
      });

      expect(tokenId1).toEqual(expect.any(String));
      expect(await getTokenCount()).toEqual(1);

      expect(await getTokenId(snapshots.ARCH_66)).toEqual(null);
      const tokenId2 = await tokens.addBareToken({
        client,
        projectId: archetype,
        tokenIndex: 66,
        onChainTokenId: snapshots.ARCH_66,
      });
      expect(await getTokenCount()).toEqual(2);
      expect(tokenId2).toEqual(expect.any(String));
      expect(tokenId1).not.toEqual(tokenId2);
      expect(await getTokenId(snapshots.ARCH_66)).toEqual(tokenId2);
    })
  );

  it(
    "claims entries from the token-traits queue",
    withTestDb(async ({ client: client1, pool }) => {
      const [{ id: archetype }] = await addProjects(client1, [
        snapshots.ARCHETYPE,
      ]);
      async function getCommittedQueueSize() {
        const res = await pool.query(
          'SELECT count(1)::int AS "n" FROM token_traits_queue'
        );
        return res.rows[0].n;
      }
      expect(await getCommittedQueueSize()).toEqual(0);
      const tokenId1 = await tokens.addBareToken({
        client: client1,
        projectId: archetype,
        tokenIndex: 250,
        onChainTokenId: snapshots.THE_CUBE,
      });
      const tokenId2 = await tokens.addBareToken({
        client: client1,
        projectId: archetype,
        tokenIndex: 66,
        onChainTokenId: snapshots.ARCH_66,
      });
      expect(await getCommittedQueueSize()).toEqual(2);

      async function claimOneEntry(client) {
        return await tokens.claimTokenTraitsQueueEntries({
          client,
          limit: 1,
          alreadyInTransaction: true,
        });
      }

      await acqrel(pool, async (client2) => {
        await client1.query("BEGIN");
        await client2.query("BEGIN");
        const e1 = await claimOneEntry(client1);
        const e2 = await claimOneEntry(client2);
        expect(e1).toEqual([tokenId1]); // added earlier
        expect(e2).toEqual([tokenId2]);
        expect(await claimOneEntry(client1)).toEqual([]);
        expect(await claimOneEntry(client2)).toEqual([]);

        await tokens.setTokenTraits({
          client: client2,
          tokenId: tokenId2,
          featureData: { Foo: "Bar", Baz: "Quux" },
        });
        await client2.query("COMMIT");
        expect(await getCommittedQueueSize()).toEqual(1);
        await client1.query("ROLLBACK");
        expect(await getCommittedQueueSize()).toEqual(1);

        const messages = await ws.getMessages({
          client: client2,
          topic: "archetype",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "TRAITS_UPDATED",
              topic: "archetype",
              data: expect.objectContaining({
                projectId: archetype,
                tokenId: tokenId2,
                slug: "archetype",
                tokenIndex: 66,
                traits: [
                  // in insertion order...
                  {
                    featureId: expect.any(String),
                    traitId: expect.any(String),
                    featureName: "Foo",
                    traitValue: "Bar",
                    featureSlug: "foo",
                    traitSlug: "bar",
                  },
                  {
                    featureId: expect.any(String),
                    traitId: expect.any(String),
                    featureName: "Baz",
                    traitValue: "Quux",
                    featureSlug: "baz",
                    traitSlug: "quux",
                  },
                ],
              }),
            },
          ])
        );

        await client1.query("BEGIN");
        await client2.query("BEGIN");
        const excluding = await tokens.claimTokenTraitsQueueEntries({
          client: client1,
          limit: 2,
          excludeTokenIds: [tokenId1],
          alreadyInTransaction: true,
        });
        const notExcluding = await tokens.claimTokenTraitsQueueEntries({
          client: client2,
          limit: 2,
          excludeTokenIds: [],
          alreadyInTransaction: true,
        });
        expect(excluding).toEqual([]);
        expect(notExcluding).toEqual([tokenId1]);
      });
    })
  );

  it(
    "supports tokenSummariesByOnChainId",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      await autoglyphs.addAutoglyphs({ client });
      const tokenId1 = snapshots.ARCH_TRIPTYCH_1;
      await addTokens(client, [tokenId1]);
      const res = await tokens.tokenSummariesByOnChainId({
        client,
        tokens: [
          { address: artblocks.CONTRACT_ARTBLOCKS_STANDARD, tokenId: tokenId1 },
          { address: autoglyphs.CONTRACT_ADDRESS, tokenId: 2 },
        ],
      });
      expect(res).toEqual([
        {
          name: "Archetype",
          artistName: "Kjetil Golid",
          slug: "archetype",
          imageTemplate: "{baseUrl}/artblocks/{sz}/23/{hi}/{lo}",
          tokenIndex: 36,
          aspectRatio: 1,
          onChainTokenId: "23000036",
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        },
        {
          name: "Autoglyphs",
          artistName: "Larva Labs",
          slug: "autoglyphs",
          imageTemplate: "{baseUrl}/autoglyphs/svg/{lo}",
          tokenIndex: 2,
          aspectRatio: 1,
          onChainTokenId: "2",
          tokenContract: autoglyphs.CONTRACT_ADDRESS,
        },
      ]);
    })
  );
  it(
    "supports tokenInfoById",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      const tokenId = snapshots.ARCH_TRIPTYCH_1;
      const [{ id: archipelagoTokenId }] = await addTokens(client, [tokenId]);
      const res = await tokens.tokenInfoById({
        client,
        tokenIds: [archipelagoTokenId],
      });
      expect(res).toEqual([
        {
          tokenId: archipelagoTokenId,
          slug: "archetype",
          tokenIndex: 36,
        },
      ]);
    })
  );
  it(
    "adds tokens to the image_ingestion_queue",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      const tokenId = snapshots.ARCH_TRIPTYCH_1;
      const [{ id: archipelagoTokenId }] = await addTokens(client, [tokenId]);
      const res = await client.query(`
        SELECT token_id AS "tokenId", create_time AS "createTime"
        FROM image_ingestion_queue
        `);
      expect(res.rows.length).toEqual(1);
      const [row] = res.rows;
      expect(row.tokenId).toEqual(archipelagoTokenId);
    })
  );
});
