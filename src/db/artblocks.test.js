const { acqrel, bufToAddress } = require("./util");
const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const channels = require("./channels");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const adHocPromise = require("../util/adHocPromise");

describe("db/artblocks", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function getProject({ client, projectId }) {
    const res = await client.query(
      `
      SELECT
        project_id AS "projectId",
        name as "name",
        max_invocations AS "maxInvocations",
        artist_name AS "artistName",
        description AS "description",
        script_json AS "scriptJson",
        aspect_ratio AS "aspectRatio",
        num_tokens AS "numTokens",
        slug AS "slug",
        script AS "script",
        projects.token_contract AS "tokenContract",
        image_template AS "imageTemplate"
      FROM projects JOIN artblocks_projects USING (project_id)
      WHERE project_id = $1
      `,
      [projectId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    row.tokenContract = bufToAddress(row.tokenContract);
    return row;
  }

  it("splits on-chain token IDs to project and token indices", () => {
    expect(artblocks.splitOnChainTokenId(7583)).toEqual({
      artblocksProjectIndex: 0,
      tokenIndex: 7583,
    });
    expect(artblocks.splitOnChainTokenId(23000250)).toEqual({
      artblocksProjectIndex: 23,
      tokenIndex: 250,
    });
  });

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const [
        { project: archetypeInput, projectId: archetypeId },
        { projectId: squigglesId },
      ] = await sc.addProjects(client, [
        snapshots.ARCHETYPE,
        snapshots.SQUIGGLES,
      ]);
      expect(archetypeId).toMatch(/[0-9]+/);
      const expected = {
        projectId: archetypeId,
        artistName: "Kjetil Golid",
        name: "Archetype",
        maxInvocations: 600,
        description: snapshots.ARCHETYPE_DESCRIPTION,
        scriptJson: {
          type: "p5js",
          version: "1.0.0",
          aspectRatio: "1",
          curation_status: "curated",
        },
        aspectRatio: 1,
        numTokens: 0,
        slug: "archetype",
        script: archetypeInput.script,
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        imageTemplate: `{baseUrl}/artblocks/{sz}/23/{hi}/{lo}`,
      };
      expect(await getProject({ client, projectId: archetypeId })).toEqual(
        expected
      );
      expect(await getProject({ client, projectId: squigglesId })).toEqual(
        expect.objectContaining({
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
        })
      );
    })
  );

  it(
    "updates project data, preserving `num_tokens` and leaving other projects alone",
    withTestDb(async ({ client }) => {
      const archetype1 = {
        projectId: 23,
        name: "Archetype",
        maxInvocations: 600,
        scriptJson: JSON.stringify({ aspectRatio: "3/2" }),
        script: null,
      };
      const archetype2 = {
        projectId: 23,
        name: "Archetypo",
        maxInvocations: 678,
        scriptJson: JSON.stringify({ aspectRatio: "2/3" }),
        script: "let seed = 1; // ...",
      };
      const { project: squiggles, projectId: squigglesId } =
        await sc.addProject(client, snapshots.SQUIGGLES);
      const archetypeId = await artblocks.addProject({
        client,
        project: archetype1,
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
      });
      expect(
        await artblocks.addProject({
          client,
          project: archetype2,

          tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        })
      ).toEqual(archetypeId);
      await sc.addTokens(client, [
        snapshots.PERFECT_CHROMATIC,
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
      ]);
      expect(await getProject({ client, projectId: squigglesId })).toEqual(
        expect.objectContaining({
          name: squiggles.name,
          numTokens: 1,
        })
      );
      expect(await getProject({ client, projectId: archetypeId })).toEqual(
        expect.objectContaining({
          name: "Archetypo",
          numTokens: 2, // preserved
          scriptJson: { aspectRatio: "2/3" },
          script: "let seed = 1; // ...",
        })
      );
    })
  );

  it(
    "inserts token data for successful fetches",
    withTestDb(async ({ pool, client }) => {
      await acqrel(pool, async (listenClient) => {
        const postgresEvent = adHocPromise();
        listenClient.on("notification", (n) => {
          if (n.channel === channels.newTokens.name) {
            postgresEvent.resolve(n.payload);
          } else {
            postgresEvent.reject("unexpected channel: " + n.channel);
          }
        });
        await channels.newTokens.listen(listenClient);

        const [{ projectId }] = await sc.addProjects(client, [
          snapshots.ARCHETYPE,
        ]);
        const { tokenId } = await sc.addToken(client, snapshots.THE_CUBE);

        expect(await getProject({ client, projectId: projectId })).toEqual(
          expect.objectContaining({
            numTokens: 1,
          })
        );
        const eventValue = await postgresEvent.promise;
        expect(JSON.parse(eventValue)).toEqual({
          projectId,
          tokenId,
        });
      });
    })
  );

  it(
    'inserts token data when "features" is an array',
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.GALAXISS,
      ]);
      await sc.addTokens(client, [snapshots.GALAXISS_FEATURES_ARRAY]);
      const actualFeatures = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId,
      });
      expect(actualFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            featureId: expect.any(String),
            name: "0",
            traits: [
              expect.objectContaining({
                traitId: expect.any(String),
                value: "Pleasant palette",
                tokenIndices: [snapshots.GALAXISS_FEATURES_ARRAY % 1e6],
              }),
            ],
          }),
          expect.objectContaining({
            featureId: expect.any(String),
            name: "1",
            traits: [
              expect.objectContaining({
                traitId: expect.any(String),
                value: "Night theme",
                tokenIndices: [snapshots.GALAXISS_FEATURES_ARRAY % 1e6],
              }),
            ],
          }),
        ])
      );
    })
  );

  it(
    "inserts data whose features are strings, numbers, or null, converting to string",
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.BYTEBEATS,
      ]);
      const [{ tokenId }] = await sc.addTokens(client, [
        snapshots.BYTEBEATS_NULL_FEATURE,
      ]);
      const actualFeatures = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId,
      });
      expect(actualFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Tint",
            traits: [
              expect.objectContaining({
                value: "Electric",
                tokenIndices: [snapshots.BYTEBEATS_NULL_FEATURE % 1e6],
              }),
            ],
          }),
          expect.objectContaining({
            name: "Sample Rate",
            traits: [
              expect.objectContaining({
                value: "4978",
                tokenIndices: [snapshots.BYTEBEATS_NULL_FEATURE % 1e6],
              }),
            ],
          }),
          expect.objectContaining({
            name: "Progressions",
            traits: [
              expect.objectContaining({
                value: "null",
                tokenIndices: [snapshots.BYTEBEATS_NULL_FEATURE % 1e6],
              }),
            ],
          }),
        ])
      );
    })
  );

  it(
    'rejects token data when "features" is not an array or object',
    withTestDb(async ({ client }) => {
      const artblocksTokenId = snapshots.PERFECT_CHROMATIC;
      await sc.addProjects(client, [snapshots.SQUIGGLES]);
      const rawTokenData = JSON.stringify({ features: "hmm" });
      await expect(
        artblocks.addToken({
          client,
          artblocksTokenId,
          rawTokenData,
        })
      ).rejects.toThrow("expected object or array");
    })
  );

  it(
    "rejects token data for 404s",
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.ARCHETYPE,
      ]);
      await expect(
        artblocks.addToken({
          client,
          artblocksTokenId: snapshots.THE_CUBE,
          rawTokenData: null,
        })
      ).rejects.toThrow("no token data given");
    })
  );

  it(
    "updates token data with new traits",
    withTestDb(async ({ client }) => {
      await sc.addProjects(client, [snapshots.ARCHETYPE]);
      const artblocksTokenId = snapshots.THE_CUBE;
      async function dataWithFeatures(features) {
        return JSON.stringify({
          ...JSON.parse(await sc.token(artblocksTokenId)),
          features,
        });
      }
      async function getTraits(tokenId) {
        const res = await artblocks.getTokenFeaturesAndTraits({
          client,
          tokenId,
        });
        return res[0].traits.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        );
      }
      async function getFetchTime(tokenId) {
        const res = await client.query(
          `
          SELECT fetch_time AS "fetchTime" FROM artblocks_tokens
          WHERE token_id = $1
          `,
          [tokenId]
        );
        return res.rows[0].fetchTime;
      }
      const data0 = await dataWithFeatures({ Color: "Red", Number: "7" });
      const tokenId = await artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData: data0,
      });
      const t0 = await getFetchTime(tokenId);
      const traits0 = await getTraits(tokenId);
      expect(traits0).toEqual([
        expect.objectContaining({ name: "Color", value: "Red" }),
        expect.objectContaining({ name: "Number", value: "7" }),
      ]);
      const data1 = await dataWithFeatures({ Color: "Red", Number: 8 });
      await artblocks.updateTokenData({ client, tokenId, rawTokenData: data1 });
      const t1 = await getFetchTime(tokenId);
      const traits1 = await getTraits(tokenId);
      expect(traits1).toEqual([
        traits0[0], // including same feature and trait IDs
        {
          featureId: traits0[1].featureId,
          name: "Number",
          traitId: expect.any(String),
          value: "8", // value changed!
        },
      ]);
      expect(traits1[1].traitId).not.toEqual(traits0[1].traitId);
      expect(+t1).toBeGreaterThan(+t0);
    })
  );

  it(
    "computes unfetched token IDs for a single project",
    withTestDb(async ({ client }) => {
      const artblocksProjectIndex = 12;
      const baseTokenId = artblocksProjectIndex * 1e6;
      const maxInvocations = 6;
      const scriptJson = JSON.stringify({ aspectRatio: "1" });
      const projectId = await artblocks.addProject({
        client,
        project: {
          projectId: artblocksProjectIndex,
          name: "Test",
          maxInvocations,
          scriptJson,
        },
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
      });
      await artblocks.addToken({
        client,
        artblocksTokenId: baseTokenId + 2,
        rawTokenData: JSON.stringify({ features: {} }),
      });
      expect(await artblocks.getUnfetchedTokens({ client, projectId })).toEqual(
        [0, 1, 3, 4, 5].map((tokenIndex) => ({ projectId, tokenIndex }))
      );
    })
  );

  async function addTestData(client) {
    const scriptJson = JSON.stringify({ aspectRatio: "1" });
    const projects = [
      { projectId: 1, name: "A", maxInvocations: 5, scriptJson },
      { projectId: 2, name: "B", maxInvocations: 5, scriptJson },
    ];
    const s = JSON.stringify;
    const tokens = [
      { tokenId: 1000000, rawTokenData: s({ features: { Size: "small" } }) },
      { tokenId: 1000001, rawTokenData: s({ features: { Size: "large" } }) },
      {
        tokenId: 2000000,
        rawTokenData: s({ features: { Size: "small", Color: "red" } }),
      },
      {
        tokenId: 2000001,
        rawTokenData: s({ features: { Size: "large", Color: "green" } }),
      },
      {
        tokenId: 2000002,
        rawTokenData: s({ features: { Size: "small", Color: "blue" } }),
      },
    ];
    const projectIds = await Promise.all(
      projects.map((p) =>
        artblocks.addProject({
          client,
          project: p,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        })
      )
    );
    await Promise.all(
      tokens.map((t) =>
        artblocks.addToken({
          client,
          artblocksTokenId: t.tokenId,
          rawTokenData: t.rawTokenData,
        })
      )
    );
    return projectIds;
  }

  it(
    "computes unfetched token IDs across all projects",
    withTestDb(async ({ client }) => {
      const [p1, p2] = await addTestData(client);
      const p1Results = [2, 3, 4].map((tokenIndex) => ({
        projectId: p1,
        tokenIndex,
      }));
      const p2Results = [3, 4].map((tokenIndex) => ({
        projectId: p2,
        tokenIndex,
      }));
      const expected =
        BigInt(p1) < BigInt(p2)
          ? [...p1Results, ...p2Results]
          : [...p2Results, ...p1Results];
      expect(await artblocks.getUnfetchedTokens({ client })).toEqual(expected);
    })
  );

  it(
    "doesn't permit adding a token that already exists",
    withTestDb(async ({ client }) => {
      await addTestData(client);
      await expect(() =>
        artblocks.addToken({
          client,
          artblocksTokenId: 1000001,
          rawTokenData: JSON.stringify({ features: { Size: "weird" } }),
        })
      ).rejects.toThrow("violates unique constraint");
    })
  );

  it(
    "supports getProjectFeaturesAndTraits",
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.ARCHETYPE,
      ]);
      const addTokensResult = await sc.addTokens(client, [
        snapshots.THE_CUBE,
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
      ]);
      const artblocksTokenIdToTokenId = new Map(
        addTokensResult.map((t) => [t.tokenId, t.id])
      );
      const res = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId,
      });
      function expectedTrait(value, tokens) {
        return {
          traitId: expect.any(String),
          value,
          tokenIndices: tokens.map((id) => id % 1e6),
        };
      }
      const expected = [
        {
          featureId: expect.any(String),
          name: "Coloring strategy",
          traits: [
            expectedTrait("Group", [23000045, 23000467]),
            expectedTrait("Random", [23000036]),
            expectedTrait("Single", [23000250]),
          ],
        },
        {
          featureId: expect.any(String),
          name: "Framed",
          traits: [
            expectedTrait("Yep", [23000036, 23000045, 23000250, 23000467]),
          ],
        },
        {
          featureId: expect.any(String),
          name: "Layout",
          traits: [
            expectedTrait("Chaos", [23000250]),
            expectedTrait("Order", [23000036, 23000045, 23000467]),
          ],
        },
        {
          featureId: expect.any(String),
          name: "Palette",
          traits: [
            expectedTrait("Paddle", [23000036, 23000045, 23000250, 23000467]),
          ],
        },
        {
          featureId: expect.any(String),
          name: "Scene",
          traits: [
            expectedTrait("Cube", [23000250]),
            expectedTrait("Flat", [23000036, 23000045, 23000467]),
          ],
        },
        {
          featureId: expect.any(String),
          name: "Shading",
          traits: [
            expectedTrait("Bright Morning", [23000250]),
            expectedTrait("Noon", [23000036, 23000045, 23000467]),
          ],
        },
      ];
      expect(res).toEqual(expected);
    })
  );

  it(
    "supports getTokenFeaturesAndTraits",
    withTestDb(async ({ client }) => {
      await sc.addProject(client, snapshots.ARCHETYPE);
      const { tokenId } = await sc.addToken(client, snapshots.THE_CUBE);
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        tokenId,
      });
      expect(res).toEqual([
        {
          tokenId,
          tokenIndex: 250,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(String),
              name: "Framed",
              traitId: expect.any(String),
              value: "Yep",
            },
            {
              featureId: expect.any(String),
              name: "Scene",
              traitId: expect.any(String),
              value: "Cube",
            },
          ]),
        },
      ]);
    })
  );

  it(
    "allows filtering token features by id",
    withTestDb(async ({ client }) => {
      await sc.addProject(client, snapshots.ARCHETYPE);
      const { tokenId } = await sc.addToken(client, snapshots.THE_CUBE);
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        tokenId,
      });
      expect(res).toEqual([
        {
          tokenId,
          tokenIndex: 250,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(String),
              name: "Framed",
              traitId: expect.any(String),
              value: "Yep",
            },
            {
              featureId: expect.any(String),
              name: "Scene",
              traitId: expect.any(String),
              value: "Cube",
            },
          ]),
        },
      ]);
    })
  );

  it(
    "respects token-feature project filters even for tokens with no traits",
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.ARCHETYPE,
        snapshots.ELEVATED_DECONSTRUCTIONS,
      ]);
      await sc.addTokens(client, [
        snapshots.THE_CUBE,
        snapshots.ELEVATED_DECONSTRUCTIONS_EMPTY_FEATURES,
      ]);
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId,
      });
      expect(res).toEqual([
        expect.objectContaining({ tokenIndex: snapshots.THE_CUBE % 1e6 }),
        // nothing for Elevated Deconstructions
      ]);
    })
  );

  it(
    "supports getting features from a certain token index upward",
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.ARCHETYPE,
        snapshots.BYTEBEATS,
      ]);
      expect(snapshots.BYTEBEATS_NULL_FEATURE).toBeGreaterThan(
        snapshots.ARCH_TRIPTYCH_3
      );
      const addTokensResult = await sc.addTokens(client, [
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
        snapshots.BYTEBEATS_NULL_FEATURE,
      ]);
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId,
        minTokenIndex: snapshots.ARCH_TRIPTYCH_2 % 1e6,
      });
      expect(res).toEqual([
        {
          tokenId: addTokensResult[1].tokenId,
          tokenIndex: 45,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(String),
              name: "Scene",
              traitId: expect.any(String),
              value: "Flat",
            },
          ]),
        },
        {
          tokenId: addTokensResult[2].tokenId,
          tokenIndex: 467,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(String),
              name: "Scene",
              traitId: expect.any(String),
              value: "Flat",
            },
          ]),
        },
      ]);
    })
  );

  it(
    "includes tokens in range queries even if they have no traits",
    withTestDb(async ({ client }) => {
      const [{ projectId }] = await sc.addProjects(client, [
        snapshots.ARCHETYPE,
      ]);
      const [{ tokenId: id1 }, { tokenId: id3 }] = await sc.addTokens(client, [
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_3,
      ]);
      const triptych2RawData = await sc.token(snapshots.ARCH_TRIPTYCH_2);
      const triptych2WithoutTraits = JSON.stringify({
        ...JSON.parse(triptych2RawData),
        features: {},
      });
      const id2 = await artblocks.addToken({
        client,
        artblocksTokenId: snapshots.ARCH_TRIPTYCH_2,
        rawTokenData: triptych2WithoutTraits,
      });
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId,
        minTokenIndex: snapshots.ARCH_TRIPTYCH_1 % 1e6,
        maxTokenIndex: snapshots.ARCH_TRIPTYCH_3 % 1e6,
      });
      expect(res).toEqual([
        {
          tokenId: id1,
          tokenIndex: 36,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(String),
              name: "Scene",
              traitId: expect.any(String),
              value: "Flat",
            },
          ]),
        },
        {
          tokenId: id2,
          tokenIndex: 45,
          traits: [],
        },
        {
          tokenId: id3,
          tokenIndex: 467,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(String),
              name: "Scene",
              traitId: expect.any(String),
              value: "Flat",
            },
          ]),
        },
      ]);
    })
  );

  it(
    "supports getTokenChainData",
    withTestDb(async ({ client }) => {
      await sc.addProject(client, snapshots.ARCHETYPE);
      const { tokenId } = await sc.addToken(client, snapshots.THE_CUBE);
      const res = await artblocks.getTokenChainData({ client, tokenId });
      expect(res).toEqual({
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        onChainTokenId: String(snapshots.THE_CUBE),
      });
    })
  );

  it(
    "notifies for image progress",
    withTestDb(async ({ pool, client }) => {
      const addProjectsRes = await sc.addProjects(client, [
        snapshots.SQUIGGLES,
        snapshots.ELEVATED_DECONSTRUCTIONS,
        snapshots.ARCHETYPE,
        snapshots.BYTEBEATS,
        snapshots.GALAXISS,
      ]);
      const ids = new Map(
        addProjectsRes.map((x) => [x.project.projectId, x.projectId])
      );

      function progress(projectSpec, completedThroughTokenId) {
        return {
          projectId: ids.get(projectSpec.projectIndex),
          completedThroughTokenIndex: completedThroughTokenId % 1e6,
        };
      }

      await artblocks.updateImageProgress({
        client,
        progress: [
          progress(snapshots.SQUIGGLES, 2),
          progress(snapshots.ELEVATED_DECONSTRUCTIONS, 7000001),
          progress(snapshots.ARCHETYPE, null),
        ],
      });

      await acqrel(pool, async (listenClient) => {
        const progressEvents = [];
        const done = adHocPromise();
        listenClient.on("notification", (n) => {
          if (n.channel !== artblocks.imageProgressChannel.name) {
            return;
          }
          const payload = JSON.parse(n.payload);
          if (payload == null) {
            done.resolve();
          } else {
            progressEvents.push(payload);
          }
        });
        await artblocks.imageProgressChannel.listen(listenClient);

        await artblocks.updateImageProgress({
          client,
          progress: [
            // updated
            progress(snapshots.SQUIGGLES, 3),
            // unchanged
            progress(snapshots.ELEVATED_DECONSTRUCTIONS, 7000001),
            // updated from null to non-null
            progress(snapshots.ARCHETYPE, 23000005),
            // new
            progress(snapshots.GALAXISS, 31000001),
            // new, null
            progress(snapshots.BYTEBEATS, null),
          ],
        });
        await artblocks.imageProgressChannel.send(client, null);
        await done.promise;
        function cmpIds(a, b) {
          const [aId, bId] = [a.projectId, b.projectId];
          return aId < bId ? -1 : aId > bId ? 1 : 0;
        }
        expect(progressEvents.sort(cmpIds)).toEqual(
          [
            progress(snapshots.SQUIGGLES, 3),
            progress(snapshots.ARCHETYPE, 23000005),
            progress(snapshots.GALAXISS, 31000001),
            progress(snapshots.BYTEBEATS, null),
          ].sort(cmpIds)
        );
      });
    })
  );

  it(
    "supports getProjectSpecs",
    withTestDb(async ({ client }) => {
      const projectIds = await sc.addProjects(client, snapshots.PROJECTS);
      const res = await artblocks.getProjectSpecs({ client });
      const expected = snapshots.PROJECTS.map((x, i) => ({
        projectIndex: x.projectIndex,
        tokenContract: x.tokenContract,
        projectId: projectIds[i].projectId,
      }));
      expect(res).toEqual(expected);
    })
  );

  it(
    "supports getProjectIdBySlug",
    withTestDb(async ({ client }) => {
      const { projectId } = await sc.addProject(client, snapshots.ARCHETYPE);
      const archetypeId = await artblocks.getProjectIdBySlug({
        client,
        slug: "archetype",
      });
      expect(archetypeId).toEqual(projectId);
      const nope = await artblocks.getProjectIdBySlug({ client, slug: "nope" });
      expect(nope).toEqual(null);
    })
  );
});
