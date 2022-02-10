const { ObjectType, newId } = require("./id");
const { addCnf, canonicalForm, projectIdForTraits } = require("./cnfs");

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
});
