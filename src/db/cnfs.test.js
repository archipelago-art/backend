const ethers = require("ethers");

const { ObjectType, newId } = require("./id");
const {
  addCnf,
  canonicalForm,
  matchesCnf,
  projectIdForTraits,
  retrieveCnfs,
  processTraitUpdateQueue,
} = require("./cnfs");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const artblocks = require("./artblocks");
const { testDbProvider } = require("./testUtil");

describe("db/cnfs", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProjects(client, projectIds) {
    const projects = await Promise.all(
      projectIds.map(async (id) => parseProjectData(id, await sc.project(id)))
    );
    const result = [];
    for (const project of projects) {
      const id = await artblocks.addProject({ client, project });
      result.push(id);
    }
    return result;
  }

  async function addTokens(client, artblocksTokenIds) {
    const tokens = await Promise.all(
      artblocksTokenIds.map(async (artblocksTokenId) => ({
        artblocksTokenId,
        rawTokenData: await sc.token(artblocksTokenId),
      }))
    );
    const result = [];
    for (const { artblocksTokenId, rawTokenData } of tokens) {
      const id = await artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData,
      });
      result.push(id);
    }
    return result;
  }

  function dummyId(x) {
    return newId(ObjectType.TRAIT, {
      timestampMs: +new Date("2022-02-02"),
      entropyBuf: Buffer.from(new Uint8Array([0, x])),
    });
  }

  async function findTraitId(client, tokenId, featureName, traitValue) {
    const [{ traits }] = await artblocks.getTokenFeaturesAndTraits({
      client,
      tokenId,
    });
    const trait = traits.find(
      (t) => t.name === featureName && t.value === traitValue
    );
    if (trait == null) {
      throw new Error(
        `token ${tokenId} has no such trait: "${featureName}: ${traitValue}"`
      );
    }
    return trait.traitId;
  }

  describe("canonicalForm", () => {
    const i1 = dummyId(1);
    const i2 = dummyId(2);
    const i3 = dummyId(3);
    if (i1 > i2 || i2 > i3) {
      throw new Error("test invariant violation");
    }
    it("errors if there is an empty CNF", () => {
      expect(() => canonicalForm([])).toThrowError("empty cnf");
    });
    it("errors if a CNF has an empty clause", () => {
      expect(() => canonicalForm([[i1], [], [i3]])).toThrowError(
        "empty clause"
      );
    });
    it("canonicalizes out duplicated terms", () => {
      expect(canonicalForm([[i1, i1]])).toEqual([[i1]]);
    });
    it("canonicalizes out duplicated clauses", () => {
      expect(canonicalForm([[i1], [i1]])).toEqual([[i1]]);
    });
    it("canonicalizes out second-order duplications", () => {
      expect(canonicalForm([[i1, i1], [i1]])).toEqual([[i1]]);
    });
    it("within-clause ordering is canoncalized", () => {
      const c1 = [[i1, i2, i3]];
      const c2 = [[i3, i2, i1]];
      const cx = canonicalForm(c1);
      expect(cx).toEqual(c1);
      expect(cx).toEqual(canonicalForm(c2));
    });
    it("across-clause ordering is canoncalized", () => {
      const c1 = [[i1], [i2, i3]];
      const c2 = [[i3, i2], [i1]];
      const cx = canonicalForm(c1);
      expect(cx).toEqual(c1);
      expect(cx).toEqual(canonicalForm(c2));
    });
  });

  describe("projectIdForTraits", () => {
    it(
      "throws an error if there are no traits",
      withTestDb(async ({ client }) => {
        await expect(projectIdForTraits(client, [])).rejects.toThrow(
          "did not find single unique project id"
        );
      })
    );
    it(
      "throws an error if there are traits from two projects",
      withTestDb(async ({ client }) => {
        const [archetype, squiggles] = await addProjects(client, [
          snapshots.ARCHETYPE,
          snapshots.SQUIGGLES,
        ]);
        await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.PERFECT_CHROMATIC,
        ]);
        const archetypeTraits = await artblocks.getProjectFeaturesAndTraits({
          client,
          projectId: archetype,
        });
        const squiggleTraits = await artblocks.getProjectFeaturesAndTraits({
          client,
          projectId: squiggles,
        });
        const ta = archetypeTraits[0].traits[0].traitId;
        const ts = squiggleTraits[0].traits[0].traitId;
        await expect(projectIdForTraits(client, [ta, ts])).rejects.toThrow(
          "did not find single unique project id"
        );
      })
    );
    it(
      "returns projectId if traits are from same project",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        await addTokens(client, [snapshots.THE_CUBE]);
        const archetypeTraits = await artblocks.getProjectFeaturesAndTraits({
          client,
          projectId: archetype,
        });
        const t1 = archetypeTraits[0].traits[0].traitId;
        const t2 = archetypeTraits[1].traits[0].traitId;
        expect(await projectIdForTraits(client, [t1, t2])).toEqual(archetype);
      })
    );
    it(
      "throws if any trait does not correspond to a project",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        await addTokens(client, [snapshots.THE_CUBE]);
        const archetypeTraits = await artblocks.getProjectFeaturesAndTraits({
          client,
          projectId: archetype,
        });
        const t1 = archetypeTraits[0].traits[0].traitId;
        const t2 = archetypeTraits[1].traits[0].traitId;
        await expect(
          projectIdForTraits(client, [t1, t2, dummyId(1)])
        ).rejects.toThrow("single unique project id");
      })
    );
    it(
      "throws if there's a single nonexistent trait",
      withTestDb(async ({ client }) => {
        await expect(projectIdForTraits(client, [dummyId(1)])).rejects.toThrow(
          "single unique project id"
        );
      })
    );
  });

  describe("matchesCnf", () => {
    it("handles a singleton match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [["a"]];
      expect(matchesCnf(has, cnf)).toBe(true);
    });
    it("handles a singleton non-match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [["z"]];
      expect(matchesCnf(has, cnf)).toBe(false);
    });
    it("handles a strict disjunction match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [["a", "z"]];
      expect(matchesCnf(has, cnf)).toBe(true);
    });
    it("handles a strict disjunction non-match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [["y", "z"]];
      expect(matchesCnf(has, cnf)).toBe(false);
    });
    it("handles a strict conjunction match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [["a"], ["b"]];
      expect(matchesCnf(has, cnf)).toBe(true);
    });
    it("handles a strict conjunction non-match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [["a"], ["z"]];
      expect(matchesCnf(has, cnf)).toBe(false);
    });
    it("handles a representative non-trivial match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [
        ["a", "z"],
        ["b", "c"],
      ];
      expect(matchesCnf(has, cnf)).toBe(true);
    });
    it("handles a representative non-trivial non-match", () => {
      const has = new Set(["a", "b", "c"]);
      const cnf = [
        ["y", "z"],
        ["b", "c"],
      ];
      expect(matchesCnf(has, cnf)).toBe(false);
    });
  });

  describe("addCnf", () => {
    it(
      "adds a new CNF, or returns the ID of an existing one",
      withTestDb(async ({ client }) => {
        const [archetype, squiggles] = await addProjects(client, [
          snapshots.ARCHETYPE,
          snapshots.SQUIGGLES, // just to have another project
        ]);
        const [theCube, tri1, tri2, tri3] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
          snapshots.ARCH_TRIPTYCH_3,
          snapshots.PERFECT_CHROMATIC,
        ]);

        const cnf = [
          [
            await findTraitId(client, theCube, "Palette", "Paddle"),
            await findTraitId(client, theCube, "Palette", "Paddle"), // dupe
          ],
          [
            await findTraitId(client, theCube, "Coloring strategy", "Single"),
            await findTraitId(client, tri1, "Coloring strategy", "Random"),
          ],
        ];

        const cnfId = await addCnf({ client, clauses: cnf });

        // Check that the metadata in `cnfs` is as expected.
        const metadataRes = await client.query(
          `
          SELECT
            project_id AS "projectId",
            canonical_form AS "canonicalForm",
            replace(digest::text, '-', '') AS "digest"
          FROM cnfs
          WHERE cnf_id = $1::cnfid
          `,
          [cnfId]
        );
        const canonicalJson = JSON.stringify(canonicalForm(cnf));
        expect(metadataRes.rows).toEqual([
          {
            projectId: archetype,
            canonicalForm: canonicalJson,
            digest: ethers.utils
              .sha256(ethers.utils.toUtf8Bytes(canonicalJson))
              .slice(2 /* 0x */)
              .slice(32),
          },
        ]);

        // Check that the full CNF can be reconstructed from the data added to
        // `cnf_clauses`.
        const retrievedCnfsSingle = await retrieveCnfs({ client, cnfId });
        // (and that it does the same thing if we filter by project instead)
        const retrievedCnfsProject = await retrieveCnfs({
          client,
          projectId: archetype,
        });
        expect(retrievedCnfsSingle).toEqual(retrievedCnfsProject);
        // (as long as we ask for the right project)
        const retrievedCnfsWrongProject = await retrieveCnfs({
          client,
          projectId: squiggles,
        });
        expect(retrievedCnfsWrongProject).toEqual([]);

        expect(retrievedCnfsSingle[0].clauses).toEqual(canonicalForm(cnf));

        // Check that exactly the right tokens were added.
        const membersRes = await client.query(
          `
          SELECT token_id AS "id" FROM cnf_members
          WHERE cnf_id = $1::cnfid
          `,
          [cnfId]
        );
        const members = membersRes.rows.map((r) => r.id).sort();
        const expectedMembers = [theCube, tri1].sort();
        expect(members).toEqual(expectedMembers);

        // Check that attempting to add the CNF again is a happy no-op,
        // returning the same ID.
        const cnfId2 = await addCnf({ client, clauses: cnf });
        expect(cnfId2).toEqual(cnfId);
      })
    );
  });

  describe("processTraitUpdateQueue", () => {
    it(
      "processes updates, or not, as appropriate",
      withTestDb(async ({ client }) => {
        // The plan:
        //
        // (1) Add a token with trait A.
        // (2) Add CNF#1 [["A"]] and CNF#2 [["B"]].
        // (3) Check that token matches CNF#1 and not CNF#2.
        // (4) Flush the queue (it's non-empty, since tokens were added).
        // (5) Update token to have trait B *instead of* A.
        // (6) Re-check step (3); should be the same (stale).
        // (7) Process from the queue and ensure that we report progress.
        // (8) Check that token matches CNF#2 and not CNF#1.
        // (9) Check that there's nothing to do in the queue.
        async function getQueue() {
          const res = await client.query(
            `
            SELECT token_id AS "id" FROM cnf_trait_update_queue
            ORDER BY token_id
            `
          );
          return res.rows.map((r) => r.id);
        }
        async function getCnfMembers() /*: Map<TokenId, Set<CnfId>> */ {
          const res = await client.query(
            `
            SELECT token_id AS "tokenId", cnf_id AS "cnfId" FROM cnf_members
            ORDER BY token_id, cnf_id
            `
          );
          const result = new Map();
          for (const { tokenId, cnfId } of res.rows) {
            if (!result.has(tokenId)) result.set(tokenId, new Set());
            result.get(tokenId).add(cnfId);
          }
          return result;
        }

        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube, tri1] = await addTokens(client, [
          snapshots.THE_CUBE, // (1)
          snapshots.ARCH_TRIPTYCH_1,
        ]);

        const findShading = (token, value) =>
          findTraitId(client, token, "Shading", value);
        const traitOld = await findShading(theCube, "Bright Morning");
        const traitNew = await findShading(tri1, "Noon");
        // (2)
        const oldCnf = await addCnf({ client, clauses: [[traitOld]] });
        const newCnf = await addCnf({ client, clauses: [[traitNew]] });

        // (3)
        expect(await getCnfMembers()).toEqual(
          new Map([
            [theCube, new Set([oldCnf])],
            [tri1, new Set([newCnf])],
          ])
        );

        // (4)
        expect(await getQueue()).toEqual([theCube, tri1].sort());
        for (let i = 0; i < 2; i++) {
          expect(await processTraitUpdateQueue({ client })).toEqual(
            expect.objectContaining({
              madeProgress: true,
              tokenId: expect.any(String),
            })
          );
        }
        expect(await processTraitUpdateQueue({ client })).toEqual({
          madeProgress: false,
        });
        expect(await getQueue()).toEqual([]);

        // (5) oh no, the sun has moved
        const theCubeDataOld = await sc.token(snapshots.THE_CUBE);
        const theCubeDataNew = (() => {
          const parsed = JSON.parse(theCubeDataOld);
          expect(parsed.features["Shading"]).toEqual("Bright Morning");
          parsed.features["Shading"] = "Noon";
          return JSON.stringify(parsed);
        })();
        await artblocks.updateTokenData({
          client,
          tokenId: theCube,
          rawTokenData: theCubeDataNew,
        });
        expect(await getQueue()).toEqual([theCube]);

        // (6): data still stale
        expect(await getCnfMembers()).toEqual(
          new Map([
            [theCube, new Set([oldCnf])],
            [tri1, new Set([newCnf])],
          ])
        );

        // (7)
        expect(await processTraitUpdateQueue({ client })).toEqual({
          madeProgress: true,
          tokenId: theCube,
          tokenStillQueued: false,
        });

        // (8): data updated
        expect(await getCnfMembers()).toEqual(
          new Map([
            [theCube, new Set([newCnf])],
            [tri1, new Set([newCnf])],
          ])
        );

        // (9)
        expect(await processTraitUpdateQueue({ client })).toEqual({
          madeProgress: false,
        });
      })
    );
  });
});
