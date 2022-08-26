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

  it(
    "records emails in the email log",
    withTestDb(async ({ client }) => {
      const email = "alice@example.com";
      const topic = "test-topic";
      const templateId = "test-template";
      const templateData = { foo: "bar" };
      const now = new Date();

      await emails.prepareEmail({
        client,
        topic,
        email,
        templateId,
        templateData,
      });
      const emailLog = await emails.getLogForEmail({ client, email });

      expect(emailLog).toHaveLength(1);
      expect(emailLog[0].toEmail).toBe(email);
      expect(emailLog[0].topic).toBe(topic);
      expect(emailLog[0].templateId).toBe(templateId);
      expect(emailLog[0].createTime.valueOf()).toBeGreaterThanOrEqual(
        now.valueOf()
      );
    })
  );
});
