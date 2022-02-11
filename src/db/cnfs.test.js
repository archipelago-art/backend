const ethers = require("ethers");

const { ObjectType, newId } = require("./id");
const {
  addCnf,
  canonicalForm,
  matchesCnf,
  projectIdForTraits,
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
        const [archetype] = await addProjects(client, [
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

        async function findTraitId(tokenId, featureName, traitValue) {
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
        const cnf = [
          [
            await findTraitId(theCube, "Palette", "Paddle"),
            await findTraitId(theCube, "Palette", "Paddle"), // dupe
          ],
          [
            await findTraitId(theCube, "Coloring strategy", "Single"),
            await findTraitId(tri1, "Coloring strategy", "Random"),
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
        const clausesRes = await client.query(
          `
          SELECT clause_idx AS "i", trait_id AS "traitId" FROM cnf_clauses
          WHERE cnf_id = $1::cnfid
          ORDER BY clause_idx, trait_id
          `,
          [cnfId]
        );
        const retrievedCnf = [];
        for (const { i, traitId } of clausesRes.rows) {
          if (i >= retrievedCnf.length) retrievedCnf.push([]);
          retrievedCnf[retrievedCnf.length - 1].push(traitId);
        }
        expect(canonicalForm(retrievedCnf)).toEqual(canonicalForm(cnf));

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
});
