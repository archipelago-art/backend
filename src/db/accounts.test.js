const ethers = require("ethers");

const { testDbProvider } = require("./testUtil");
const { hexToBuf } = require("./util");

const accounts = require("./accounts");

describe("db/accounts", () => {
  const withTestDb = testDbProvider();

  function makeWallet(nonce) {
    const privateKey = ethers.utils.id(String(nonce));
    return new ethers.Wallet(privateKey);
  }
  let wallet1;
  beforeAll(() => {
    wallet1 = makeWallet(1);
  });

  async function getPendingConfirmationNonces({ client, account }) {
    const res = await client.query(
      `
      SELECT nonce FROM pending_email_confirmations
      WHERE account = $1::address
      `,
      [hexToBuf(account)]
    );
    return res.rows.map((r) => r.nonce);
  }

  async function doAuth({ client, signer }) {
    const timestamp = 1651003500;
    const signature = await accounts.signLoginRequest({ signer, timestamp });
    const authToken = await accounts.signIn({ client, timestamp, signature });

    const account = await signer.getAddress();
    const email = `${account.toLowerCase()}@eth.example.com`;
    await accounts.setEmailUnconfirmed({ client, authToken, email });

    const nonces = await getPendingConfirmationNonces({ client, account });
    if (nonces.length !== 1) {
      throw new Error(`expected 1 nonce for ${account}, got ${nonces.length}`);
    }
    const [nonce] = nonces;
    await accounts.confirmEmail({
      client,
      address: account,
      authToken,
      nonce,
    });
    return { email, authToken };
  }

  it("signs and verifies a login message", async () => {
    const signer = wallet1;
    const timestamp = 1651003500;
    const signature = await accounts.signLoginRequest({ signer, timestamp });
    expect(ethers.utils.arrayify(signature)).toHaveLength(65);
    const verifiedAddress = await accounts.verifyLoginRequest({
      timestamp,
      signature,
    });
    expect(verifiedAddress).toEqual(await signer.getAddress());
  });

  it(
    "gets user details only if a valid auth token is presented",
    withTestDb(async ({ client }) => {
      const signer = wallet1;
      const account = await signer.getAddress();
      const timestamp = 1651003500;
      const signature = await accounts.signLoginRequest({ signer, timestamp });
      // TODO: validate that timestamp is roughly current

      const authToken = await accounts.signIn({ client, timestamp, signature });
      expect(await accounts.getUserDetails({ client, authToken })).toEqual({
        account,
        email: null,
        preferences: null,
      });

      await accounts.signOut({ client, authToken });
      await expect(
        accounts.getUserDetails({ client, authToken })
      ).rejects.toThrow("unknown auth token");
    })
  );

  it(
    "sets, confirms, and clears an email address",
    withTestDb(async ({ client }) => {
      const signer = wallet1;
      const account = await signer.getAddress();
      const timestamp = 1651003500;
      const signature = await accounts.signLoginRequest({ signer, timestamp });
      const authToken = await accounts.signIn({ client, timestamp, signature });

      const getDetails = () => accounts.getUserDetails({ client, authToken });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });

      // Setting email should go through a confirmation flow.
      const email = "alice@example.com";
      await accounts.setEmailUnconfirmed({ client, authToken, email });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });
      const nonce = await (async () => {
        const nonces = await getPendingConfirmationNonces({ client, account });
        expect(nonces).toEqual([expect.any(String)]);
        return nonces[0];
      })();

      const confirmRes = await accounts.confirmEmail({
        client,
        address: account,
        authToken,
        nonce,
      });
      expect(confirmRes).toEqual(authToken);
      expect(await getDetails()).toEqual({ account, email, preferences: {} });
      {
        const nonces = await getPendingConfirmationNonces({ client, account });
        expect(nonces).toEqual([]);
      }

      // Clearing email should update immediately.
      await accounts.setEmailUnconfirmed({ client, authToken, email: null });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });
      {
        const nonces = await getPendingConfirmationNonces({ client, account });
        expect(nonces).toEqual([]);
      }
    })
  );

  it(
    "updates preferences",
    withTestDb(async ({ client }) => {
      const signer = wallet1;
      const account = await signer.getAddress();

      const { authToken, email } = await doAuth({ client, signer });

      async function getPreferences() {
        const details = await accounts.getUserDetails({ client, authToken });
        return details.preferences;
      }
      expect(await getPreferences()).toEqual({});

      const tz = "America/Los_Angeles";
      await accounts.updatePreferences({
        client,
        authToken,
        newPreferences: {
          [accounts.PREF_BID_EMAILS]: true,
          [accounts.PREF_EMAIL_TIMEZONE]: tz,
        },
      });
      expect(await getPreferences()).toEqual({
        [accounts.PREF_BID_EMAILS]: true,
        [accounts.PREF_EMAIL_TIMEZONE]: tz,
      });

      await accounts.updatePreferences({
        client,
        authToken,
        newPreferences: { [accounts.PREF_BID_EMAILS]: false },
      });
      expect(await getPreferences()).toEqual({
        [accounts.PREF_BID_EMAILS]: false,
        [accounts.PREF_EMAIL_TIMEZONE]: tz,
      });
    })
  );

  it(
    "retains the old email while a new one is being confirmed",
    withTestDb(async ({ client }) => {
      const signer = wallet1;
      const account = await signer.getAddress();
      const timestamp = 1651003500;
      const signature = await accounts.signLoginRequest({ signer, timestamp });
      const authToken = await accounts.signIn({ client, timestamp, signature });

      const getDetails = () => accounts.getUserDetails({ client, authToken });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });

      const getUniqueNonce = async () => {
        const nonces = await getPendingConfirmationNonces({ client, account });
        expect(nonces).toEqual([expect.any(String)]);
        return nonces[0];
      };

      const email1 = "alice.one@example.com";
      await accounts.setEmailUnconfirmed({ client, authToken, email: email1 });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });
      const nonce1 = await getUniqueNonce();
      await accounts.confirmEmail({
        client,
        address: account,
        authToken,
        nonce: nonce1,
      });
      expect(await getDetails()).toEqual({
        account,
        email: email1,
        preferences: {},
      });

      const email2 = "alice.two@example.com";
      await accounts.setEmailUnconfirmed({
        client,
        address: account,
        authToken,
        email: email2,
      });
      // Neither yet changed nor cleared.
      expect(await getDetails()).toEqual({
        account,
        email: email1,
        preferences: {},
      });

      const nonce2 = await getUniqueNonce();
      await accounts.confirmEmail({
        client,
        address: account,
        authToken,
        nonce: nonce2,
      });
      expect(await getDetails()).toEqual({
        account,
        email: email2,
        preferences: {},
      });
    })
  );

  it(
    "mints a new auth token at email confirmation if none is provided",
    withTestDb(async ({ client }) => {
      const signer = wallet1;
      const account = await signer.getAddress();
      const timestamp = 1651003500;
      const signature = await accounts.signLoginRequest({ signer, timestamp });
      const authToken = await accounts.signIn({ client, timestamp, signature });

      const getDetails = () => accounts.getUserDetails({ client, authToken });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });

      const email = "alice@example.com";
      await accounts.setEmailUnconfirmed({ client, authToken, email });
      expect(await getDetails()).toEqual({
        account,
        email: null,
        preferences: null,
      });
      const nonce = await (async () => {
        const nonces = await getPendingConfirmationNonces({ client, account });
        expect(nonces).toEqual([expect.any(String)]);
        return nonces[0];
      })();

      const confirmRes = await accounts.confirmEmail({
        client,
        address: account,
        authToken: null,
        nonce,
      });
      expect(confirmRes).toEqual(expect.any(String));
      expect(confirmRes).not.toEqual(authToken);
      expect(
        await accounts.getUserDetails({ client, authToken: confirmRes })
      ).toEqual({ account, email, preferences: {} });
    })
  );
});
