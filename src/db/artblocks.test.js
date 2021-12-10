const { acqrel } = require("./util");
const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const adHocPromise = require("../util/adHocPromise");

describe("db/artblocks", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProjects(client, projectIds) {
    const projects = await Promise.all(
      projectIds.map(async (id) => parseProjectData(id, await sc.project(id)))
    );
    for (const project of projects) {
      await artblocks.addProject({ client, project });
    }
    return projects;
  }
  async function addTokens(client, tokenIds) {
    const tokens = await Promise.all(
      tokenIds.map(async (id) => ({
        tokenId: id,
        rawTokenData: await sc.token(id),
      }))
    );
    for (const { tokenId, rawTokenData } of tokens) {
      await artblocks.addToken({ client, tokenId, rawTokenData });
    }
    return tokens;
  }

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const [archetypeInput, _] = await addProjects(client, [
        snapshots.ARCHETYPE,
        snapshots.SQUIGGLES,
      ]);
      const expected = {
        projectId: 23,
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
      };
      expect(
        await artblocks.getProject({ client, projectId: snapshots.ARCHETYPE })
      ).toEqual(expected);
      expect(
        await artblocks.getProject({ client, projectId: snapshots.SQUIGGLES })
      ).toEqual(
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
      const [squiggles] = await addProjects(client, [snapshots.SQUIGGLES]);
      await artblocks.addProject({ client, project: archetype1 });
      await artblocks.addProject({ client, project: archetype2 });
      await addTokens(client, [
        snapshots.PERFECT_CHROMATIC,
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
      ]);
      expect(
        await artblocks.getProject({ client, projectId: snapshots.SQUIGGLES })
      ).toEqual(
        expect.objectContaining({
          projectId: snapshots.SQUIGGLES,
          name: squiggles.name,
          numTokens: 1,
        })
      );
      expect(
        await artblocks.getProject({ client, projectId: snapshots.ARCHETYPE })
      ).toEqual(
        expect.objectContaining({
          projectId: snapshots.ARCHETYPE,
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
          if (n.channel === artblocks.newTokensChannel.name) {
            postgresEvent.resolve(n.payload);
          } else {
            postgresEvent.reject("unexpected channel: " + n.channel);
          }
        });
        await artblocks.newTokensChannel.listen(listenClient);

        const projectId = snapshots.ARCHETYPE;
        const tokenId = snapshots.THE_CUBE;
        await addProjects(client, [projectId]);
        await addTokens(client, [tokenId]);

        expect(await artblocks.getProject({ client, projectId })).toEqual(
          expect.objectContaining({
            numTokens: 1,
          })
        );
        const eventValue = await postgresEvent.promise;
        expect(JSON.parse(eventValue)).toEqual({ projectId, tokenId });
      });
    })
  );

  it(
    'inserts token data when "features" is an array',
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.GALAXISS]);
      await addTokens(client, [snapshots.GALAXISS_FEATURES_ARRAY]);
      const actualFeatures = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId: snapshots.GALAXISS,
      });
      expect(actualFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "0",
            traits: [
              expect.objectContaining({
                value: "Pleasant palette",
                tokens: [snapshots.GALAXISS_FEATURES_ARRAY],
              }),
            ],
          }),
          expect.objectContaining({
            name: "1",
            traits: [
              expect.objectContaining({
                value: "Night theme",
                tokens: [snapshots.GALAXISS_FEATURES_ARRAY],
              }),
            ],
          }),
        ])
      );
    })
  );

  it(
    "inserts data whose features are strings, numbers, or null",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.BYTEBEATS]);
      await addTokens(client, [snapshots.BYTEBEATS_NULL_FEATURE]);
      const actualFeatures = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId: snapshots.BYTEBEATS,
      });
      expect(actualFeatures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Tint",
            traits: [
              expect.objectContaining({
                value: "Electric",
                tokens: [snapshots.BYTEBEATS_NULL_FEATURE],
              }),
            ],
          }),
          expect.objectContaining({
            name: "Sample Rate",
            traits: [
              expect.objectContaining({
                value: 4978,
                tokens: [snapshots.BYTEBEATS_NULL_FEATURE],
              }),
            ],
          }),
          expect.objectContaining({
            name: "Progressions",
            traits: [
              expect.objectContaining({
                value: null,
                tokens: [snapshots.BYTEBEATS_NULL_FEATURE],
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
      const tokenId = snapshots.PERFECT_CHROMATIC;
      await addProjects(client, [snapshots.SQUIGGLES]);
      const rawTokenData = JSON.stringify({ features: "hmm" });
      await expect(
        artblocks.addToken({
          client,
          tokenId,
          rawTokenData,
        })
      ).rejects.toThrow("expected object or array");
    })
  );

  it(
    "inserts token data for 404s",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: null,
      });
      const actualFeatures = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId: snapshots.ARCHETYPE,
      });
      expect(actualFeatures).toEqual([]);
    })
  );

  it(
    "computes unfetched token IDs for a single project",
    withTestDb(async ({ client }) => {
      const projectId = 12;
      const baseTokenId = projectId * 1e6;
      const maxInvocations = 6;
      const scriptJson = JSON.stringify({ aspectRatio: "1" });
      await artblocks.addProject({
        client,
        project: { projectId, name: "Test", maxInvocations, scriptJson },
      });
      await artblocks.addToken({
        client,
        tokenId: baseTokenId + 2,
        rawTokenData: JSON.stringify({ features: {} }),
      });
      await artblocks.addToken({
        client,
        tokenId: baseTokenId + 4,
        rawTokenData: null,
      });
      expect(
        await artblocks.getUnfetchedTokenIds({ client, projectId })
      ).toEqual([0, 1, 3, 4, 5].map((i) => baseTokenId + i));
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
      { tokenId: 1000002, rawTokenData: null },
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
    await Promise.all(
      projects.map((p) => artblocks.addProject({ client, project: p }))
    );
    await Promise.all(
      tokens.map((t) =>
        artblocks.addToken({
          client,
          tokenId: t.tokenId,
          rawTokenData: t.rawTokenData,
        })
      )
    );
  }

  it(
    "computes unfetched token IDs across all projects",
    withTestDb(async ({ client }) => {
      const p1 = 1e6 * 1;
      const p2 = 1e6 * 2;
      await addTestData(client);
      expect(await artblocks.getAllUnfetchedTokenIds({ client })).toEqual([
        ...[p1 + 2, p1 + 3, p1 + 4],
        ...[p2 + 3, p2 + 4],
      ]);
    })
  );

  it(
    "doesn't permit updating token data",
    withTestDb(async ({ client }) => {
      await addTestData(client);
      await expect(() =>
        artblocks.addToken({
          client,
          tokenId: 1000001,
          rawTokenData: JSON.stringify({ features: { Size: "weird" } }),
        })
      ).rejects.toThrow('unique constraint "tokens_pkey"');
    })
  );

  it(
    "supports getProjectFeaturesAndTraits",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      await addTokens(client, [
        snapshots.THE_CUBE,
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
      ]);
      const projectId = snapshots.ARCHETYPE;
      const res = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId,
      });
      const id = expect.any(Number);
      const expected = [
        {
          id,
          name: "Coloring strategy",
          traits: [
            { id, value: "Group", tokens: [23000045, 23000467] },
            { id, value: "Random", tokens: [23000036] },
            { id, value: "Single", tokens: [23000250] },
          ],
        },
        {
          id,
          name: "Framed",
          traits: [
            {
              id,
              value: "Yep",
              tokens: [23000036, 23000045, 23000250, 23000467],
            },
          ],
        },
        {
          id,
          name: "Layout",
          traits: [
            { id, value: "Chaos", tokens: [23000250] },
            { id, value: "Order", tokens: [23000036, 23000045, 23000467] },
          ],
        },
        {
          id,
          name: "Palette",
          traits: [
            {
              id,
              value: "Paddle",
              tokens: [23000036, 23000045, 23000250, 23000467],
            },
          ],
        },
        {
          id,
          name: "Scene",
          traits: [
            { id, value: "Cube", tokens: [23000250] },
            { id, value: "Flat", tokens: [23000036, 23000045, 23000467] },
          ],
        },
        {
          id,
          name: "Shading",
          traits: [
            { id, value: "Bright Morning", tokens: [23000250] },
            { id, value: "Noon", tokens: [23000036, 23000045, 23000467] },
          ],
        },
      ];
      expect(res).toEqual(expected);
      const featureIds = res.map((f) => f.id);
      expect(featureIds).toEqual(Array.from(new Set(featureIds)));
      const traitIds = res.flatMap((f) => f.traits.map((t) => t.id));
      expect(traitIds).toEqual(Array.from(new Set(traitIds)));
    })
  );

  it(
    "supports getTokenFeaturesAndTraits",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      const tokenId = snapshots.THE_CUBE;
      await addTokens(client, [tokenId]);
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        tokenId,
      });
      expect(res).toEqual([
        {
          tokenId: snapshots.THE_CUBE,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(Number),
              name: "Framed",
              traitId: expect.any(Number),
              value: "Yep",
            },
            {
              featureId: expect.any(Number),
              name: "Scene",
              traitId: expect.any(Number),
              value: "Cube",
            },
          ]),
        },
      ]);
    })
  );

  it(
    "supports getting features from a certain token ID upward",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE, snapshots.BYTEBEATS]);
      expect(snapshots.BYTEBEATS_NULL_FEATURE).toBeGreaterThan(
        snapshots.ARCH_TRIPTYCH_3
      );
      await addTokens(client, [
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
        snapshots.BYTEBEATS_NULL_FEATURE,
      ]);
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId: snapshots.ARCHETYPE,
        minTokenId: snapshots.ARCH_TRIPTYCH_2,
      });
      expect(res).toEqual([
        {
          tokenId: snapshots.ARCH_TRIPTYCH_2,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(Number),
              name: "Scene",
              traitId: expect.any(Number),
              value: "Flat",
            },
          ]),
        },
        {
          tokenId: snapshots.ARCH_TRIPTYCH_3,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(Number),
              name: "Scene",
              traitId: expect.any(Number),
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
      await addProjects(client, [snapshots.ARCHETYPE]);
      await addTokens(client, [
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_3,
      ]);
      const triptych2RawData = await sc.token(snapshots.ARCH_TRIPTYCH_2);
      const triptych2WithoutTraits = JSON.stringify({
        ...JSON.parse(triptych2RawData),
        features: {},
      });
      await artblocks.addToken({
        client,
        tokenId: snapshots.ARCH_TRIPTYCH_2,
        rawTokenData: triptych2WithoutTraits,
      });
      const res = await artblocks.getTokenFeaturesAndTraits({
        client,
        projectId: snapshots.ARCHETYPE,
        minTokenId: snapshots.ARCH_TRIPTYCH_1,
        maxTokenId: snapshots.ARCH_TRIPTYCH_3,
      });
      expect(res).toEqual([
        {
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(Number),
              name: "Scene",
              traitId: expect.any(Number),
              value: "Flat",
            },
          ]),
        },
        {
          tokenId: snapshots.ARCH_TRIPTYCH_2,
          traits: [],
        },
        {
          tokenId: snapshots.ARCH_TRIPTYCH_3,
          traits: expect.arrayContaining([
            {
              featureId: expect.any(Number),
              name: "Scene",
              traitId: expect.any(Number),
              value: "Flat",
            },
          ]),
        },
      ]);
    })
  );

  it(
    "supports getTokenSummaries",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      const tokenId1 = snapshots.ARCH_TRIPTYCH_1;
      const tokenId2 = snapshots.ARCH_TRIPTYCH_2;
      const tokenId3 = snapshots.ARCH_TRIPTYCH_3;
      await addTokens(client, [tokenId1, tokenId2, tokenId3]);
      const res = await artblocks.getTokenSummaries({
        client,
        tokenIds: [tokenId1, tokenId2],
      });
      expect(res).toEqual([
        {
          tokenId: 23000036,
          name: "Archetype",
          artistName: "Kjetil Golid",
          slug: "archetype",
          aspectRatio: 1,
        },
        {
          tokenId: 23000045,
          name: "Archetype",
          artistName: "Kjetil Golid",
          slug: "archetype",
          aspectRatio: 1,
        },
      ]);
    })
  );

  it(
    "notifies for image progress",
    withTestDb(async ({ pool, client }) => {
      await addProjects(client, [
        snapshots.SQUIGGLES,
        snapshots.ELEVATED_DECONSTRUCTIONS,
        snapshots.ARCHETYPE,
        snapshots.BYTEBEATS,
        snapshots.GALAXISS,
      ]);

      function progress(projectId, completedThroughTokenId) {
        return { projectId, completedThroughTokenId };
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
        expect(
          progressEvents.sort((a, b) => a.projectId - b.projectId)
        ).toEqual([
          progress(snapshots.SQUIGGLES, 3),
          progress(snapshots.ARCHETYPE, 23000005),
          progress(snapshots.GALAXISS, 31000001),
          progress(snapshots.BYTEBEATS, null),
        ]);
      });
    })
  );
});
