const { acqrel } = require("./util");
const { testDbProvider } = require("./testUtil");

const emails = require("./emails");

describe("db/emails", () => {
  const withTestDb = testDbProvider();

  it(
    "inserts a single email",
    withTestDb(async ({ client }) => {
      const email = "alice@example.com";
      expect(await emails.addEmailSignup({ client, email })).toBe(true);
      expect(await emails.getEmailSignups({ client })).toEqual([
        { email, createTime: expect.any(Date) },
      ]);
    })
  );

  it(
    "is idempotent",
    withTestDb(async ({ client }) => {
      const email = "alice@example.com";
      expect(await emails.addEmailSignup({ client, email })).toBe(true);
      expect(await emails.addEmailSignup({ client, email })).toBe(false);
      expect(await emails.getEmailSignups({ client })).toEqual([
        { email, createTime: expect.any(Date) },
      ]);
    })
  );
});
