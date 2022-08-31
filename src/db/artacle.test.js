const { testDbProvider } = require("./testUtil");

const artacle = require("./artacle");
const projects = require("./projects");
const tokens = require("./tokens");

describe("db/artacle", () => {
  const withTestDb = testDbProvider();

  it(
    "updating rarity and retrieving it works properly",
    withTestDb(async ({ client }) => {
      const p1TokenCount = 4;
      const p2TokenCount = 2;

      await client.query("BEGIN");
      const p1 = await projects.addProject({
        client,
        name: "One",
        maxInvocations: p1TokenCount,
        artistName: "Alice",
        description: "one",
        aspectRatio: 1,
        tokenContract: "0x" + "ff".repeat(20),
        imageTemplate: "/unused",
      });
      await artacle.updateArtacleProjects({
        client,
        updates: [{ projectId: p1, artacleSlug: "one_" }],
      });
      const p2 = await projects.addProject({
        client,
        name: "Two",
        maxInvocations: p2TokenCount,
        artistName: "Bob",
        description: "two",
        aspectRatio: 1.5,
        tokenContract: "0x" + "ee".repeat(20),
        imageTemplate: "/unused",
      });
      await artacle.updateArtacleProjects({
        client,
        updates: [{ projectId: p2, artacleSlug: "two" }],
      });
      const tokenIds = new Map([p1, p2].map((p) => [p, []]));
      for (const [p, n] of [
        [p1, p1TokenCount],
        [p2, p2TokenCount],
      ]) {
        for (let i = 0; i < n; i++) {
          const t = await tokens.addBareToken({
            client,
            projectId: p,
            tokenIndex: i,
            onChainTokenId: i,
          });
          tokenIds.get(p).push(t);
        }
      }
      await client.query("COMMIT");

      async function rarityUpdateTime(projectId, tokenIndex) {
        const tokenId = tokenIds.get(projectId)[tokenIndex];
        const res = await client.query(
          `
      SELECT update_time AS "updateTime" FROM token_rarity
      WHERE token_id = $1::tokenid
      `,
          [tokenId]
        );
        const [row] = res.rows;
        if (row == null) return null;
        return row.updateTime;
      }

      const initialUpdates = [
        // Project 1: tokens 1 and 2 tied for rarity#1, token 0 at rarity#3, token 3 null
        { tokenId: tokenIds.get(p1)[0], rarityRank: 3 },
        { tokenId: tokenIds.get(p1)[1], rarityRank: 1 },
        { tokenId: tokenIds.get(p1)[2], rarityRank: 1 },
        { tokenId: tokenIds.get(p1)[3], rarityRank: null },
        // Project 2: token 0 rarity#1, token 1 rarity#2
        { tokenId: tokenIds.get(p2)[0], rarityRank: 1 },
        { tokenId: tokenIds.get(p2)[1], rarityRank: 2 },
      ];
      await artacle.updateTokenRarity({
        client,
        updates: initialUpdates,
      });

      const initialUpdateTime = await rarityUpdateTime(p1, 0);
      // Spot-check that it's the same for one other token.
      expect(await rarityUpdateTime(p2, 1)).toEqual(initialUpdateTime);

      const p1InitialRarities = await artacle.getRarityForProjectTokens({
        client,
        projectId: p1,
      });
      expect(p1InitialRarities).toEqual([
        { tokenId: tokenIds.get(p1)[1], tokenIndex: 1, rarityRank: 1 },
        { tokenId: tokenIds.get(p1)[2], tokenIndex: 2, rarityRank: 1 },
        { tokenId: tokenIds.get(p1)[0], tokenIndex: 0, rarityRank: 3 },
        { tokenId: tokenIds.get(p1)[3], tokenIndex: 3, rarityRank: null },
      ]);

      expect(
        await artacle.getTokenRarity({ client, tokenId: tokenIds.get(p1)[0] })
      ).toEqual({ rarityRank: 3, total: 4, numTies: 1, artacleSlug: "one_" });
      expect(
        await artacle.getTokenRarity({ client, tokenId: tokenIds.get(p1)[1] })
      ).toEqual({ rarityRank: 1, total: 4, numTies: 2, artacleSlug: "one_" });
      expect(
        await artacle.getTokenRarity({ client, tokenId: tokenIds.get(p1)[3] })
      ).toEqual({
        rarityRank: null,
        total: 4,
        numTies: 0,
        artacleSlug: "one_",
      });

      // Delay 1ms so that the timestamps are ~guaranteed different even
      // when downcasted to millisecond-precision JS dates.
      await new Promise((res) => setTimeout(res, 1));

      const finalUpdates = [
        { tokenId: tokenIds.get(p1)[0], rarityRank: 4 },
        { tokenId: tokenIds.get(p1)[1], rarityRank: 2 },
        { tokenId: tokenIds.get(p1)[2], rarityRank: 2 },
        { tokenId: tokenIds.get(p1)[3], rarityRank: 1 },
      ];
      await artacle.updateTokenRarity({ client, updates: finalUpdates });
      const finalUpdateTime = await rarityUpdateTime(p1, 0);
      expect(finalUpdateTime).not.toEqual(initialUpdateTime);
      // Project 2 tokens unchanged.
      expect(await rarityUpdateTime(p2, 1)).toEqual(initialUpdateTime);

      const p1FinalRarities = await artacle.getRarityForProjectTokens({
        client,
        projectId: p1,
      });
      expect(p1FinalRarities).toEqual([
        { tokenId: tokenIds.get(p1)[3], tokenIndex: 3, rarityRank: 1 },
        { tokenId: tokenIds.get(p1)[1], tokenIndex: 1, rarityRank: 2 },
        { tokenId: tokenIds.get(p1)[2], tokenIndex: 2, rarityRank: 2 },
        { tokenId: tokenIds.get(p1)[0], tokenIndex: 0, rarityRank: 4 },
      ]);
      expect(
        await artacle.getTokenRarity({ client, tokenId: tokenIds.get(p1)[0] })
      ).toEqual({ rarityRank: 4, total: 4, numTies: 1, artacleSlug: "one_" });
    })
  );
});
