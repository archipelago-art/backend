const { acqrel } = require("./util");
const { testDbProvider } = require("./testUtil");

const adHocPromise = require("../util/adHocPromise");
const channels = require("./channels");
const { channel } = require("./events");
const ws = require("./ws");

describe("db/ws", () => {
  const withTestDb = testDbProvider();

  it(
    "sends and persists messages",
    withTestDb(async ({ pool, client }) => {
      await acqrel(pool, async (listenClient) => {
        const receivedMessages = [];
        const doneEvent = new adHocPromise();
        const doneChannel = channel("__test_done");
        listenClient.on("notification", (n) => {
          switch (n.channel) {
            case doneChannel.name:
              doneEvent.resolve();
              break;
            case channels.websocketMessages.name:
              receivedMessages.push(JSON.parse(n.payload));
              break;
          }
        });
        await channels.websocketMessages.listen(listenClient);
        await doneChannel.listen(listenClient);

        const spectralColors = [
          "red",
          "orange",
          "yellow",
          "green",
          "blue",
          "indigo",
          "violet",
        ];
        const aspectralColors = ["magenta", "pink", "gold", "gray"];
        const colorsByTopic = [
          { topic: "spectral", colors: spectralColors },
          { topic: "aspectral", colors: aspectralColors },
        ];

        await client.query("BEGIN");
        await ws.sendMessages({
          client,
          messages: colorsByTopic.flatMap(({ topic, colors }) =>
            colors.map((color) => ({ type: "COLOR", topic, data: { color } }))
          ),
        });
        await client.query("COMMIT");
        await doneChannel.send(client, null);
        await doneEvent.promise;

        expect(receivedMessages).toEqual(
          colorsByTopic.flatMap(({ topic, colors }) =>
            colors.map((color) => ({
              messageId: expect.stringMatching(/[0-9a-fA-F-]{36}/),
              timestamp: expect.any(String),
              type: "COLOR",
              topic,
              data: { color },
            }))
          )
        );

        const storedMessages = await ws.getMessages({
          client,
          topic: "spectral",
          since: new Date(0),
        });
        expect(storedMessages).toHaveLength(spectralColors.length);
        expect(storedMessages).toEqual(
          receivedMessages.filter((m) => m.topic === "spectral")
        ); // in order!

        const allStoredMessages = await ws.getMessages({
          client,
          topic: null,
          since: new Date(0),
        });
        expect(allStoredMessages).toEqual(receivedMessages); // in order!

        await expect(() =>
          ws.getMessages({ client, since: new Date(0) })
        ).rejects.toThrow("must explicitly set `topic` to a string or `null`");
      });
    })
  );

  it(
    "allows filtering by type",
    withTestDb(async ({ pool, client }) => {
      await client.query("BEGIN");
      await ws.sendMessages({
        client,
        messages: ["A", "B", "B", "A"].map((type, i) => ({
          type,
          topic: "top",
          data: i,
        })),
      });
      await client.query("COMMIT");

      const query = { topic: "top", since: new Date(0) };
      const as = await ws.getMessages({ client, ...query, type: "A" });
      const bs = await ws.getMessages({ client, ...query, type: "B" });

      const baseMessage = {
        messageId: expect.stringMatching(/[0-9a-fA-F-]{36}/),
        timestamp: expect.any(String),
        topic: "top",
      };
      expect(as).toEqual([
        { ...baseMessage, type: "A", data: 0 },
        { ...baseMessage, type: "A", data: 3 },
      ]);
      expect(bs).toEqual([
        { ...baseMessage, type: "B", data: 1 },
        { ...baseMessage, type: "B", data: 2 },
      ]);
    })
  );

  it(
    "paginates through messages",
    withTestDb(async ({ pool, client }) => {
      const rounds = 10;
      const messagesPerRound = 3;
      const pageSize = 2; // should not divide `messagesPerRound`

      for (let i = 0; i < rounds; i++) {
        await client.query("BEGIN");
        await ws.sendMessages({
          client,
          messages: Array(messagesPerRound)
            .fill()
            .map((_, j) => ({
              type: "NUMBER",
              topic: "top",
              data: i * messagesPerRound + j,
            })),
        });
        await client.query("COMMIT");
        if (i === 0) await new Promise((res) => setTimeout(res, 1));
      }

      const dump = await ws.getMessages({
        client,
        topic: "top",
        since: new Date(0),
      });
      expect(dump).toHaveLength(rounds * messagesPerRound);
      // Skip the first round of messages. Have to add 1ms to the
      // timestamp because the internal timestamp has micros precision
      // that's almost certainly (p=99.9%) non-integer.
      const t0 = new Date(Date.parse(dump[0].timestamp) + 1);

      const paginatedMessages = [];
      {
        const query = { topic: "top", type: "NUMBER", limit: pageSize };
        let res = await ws.getMessages({ client, ...query, since: t0 });
        let queries = 0;
        while (res.length > 0) {
          paginatedMessages.push(...res);
          res = await ws.getMessages({
            client,
            ...query,
            afterMessageId: res[res.length - 1].messageId,
          });
          if (queries++ > 100) throw new Error("too long; something's wrong");
        }
      }
      expect(paginatedMessages).toEqual(dump.slice(messagesPerRound));
    })
  );

  it(
    "deletes messages older than a given date",
    withTestDb(async ({ pool, client }) => {
      const type = "TYPE";
      const topic = "topic";

      for (const data of [1, 2, 3]) {
        await client.query("BEGIN");
        await ws.sendMessages({
          client,
          messages: [{ type, topic, data }],
        });
        await client.query("COMMIT");
      }

      const allMessages = await ws.getMessages({
        client,
        topic,
        since: new Date(0),
      });
      expect(allMessages).toEqual(
        [1, 2, 3].map((data) => expect.objectContaining({ data }))
      );

      async function getPreciseDate(messageId) {
        const res = await client.query(
          `
          SELECT create_time::text AS "createTime"
          FROM websocket_log
          WHERE message_id = $1::uuid
          `,
          [messageId]
        );
        return res.rows[0].createTime;
      }
      const cutoff = await getPreciseDate(allMessages[1].messageId);

      await ws.expireMessages({ client, before: cutoff });
      const someMessages = await ws.getMessages({
        client,
        topic,
        since: new Date(0),
      });
      expect(someMessages).toEqual(
        [2, 3].map((data) => expect.objectContaining({ data }))
      );
    })
  );
});
