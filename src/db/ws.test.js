const { acqrel } = require("./util");
const { testDbProvider } = require("./testUtil");

const adHocPromise = require("../util/adHocPromise");
const channels = require("./channels");
const ws = require("./ws");

describe("db/ws", () => {
  const withTestDb = testDbProvider();

  it(
    "sends and persists messages",
    withTestDb(async ({ pool, client }) => {
      await acqrel(pool, async (listenClient) => {
        const receivedMessages = [];
        const doneEvent = new adHocPromise();
        const DONE_MESSAGE = "!!! DONE !!!";
        listenClient.on("notification", (n) => {
          if (n.channel !== channels.websocketMessages.name) return;
          if (n.payload === DONE_MESSAGE) {
            doneEvent.resolve();
          } else {
            receivedMessages.push(JSON.parse(n.payload));
          }
        });
        await channels.websocketMessages.listen(listenClient);

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
        await client.query("SELECT pg_notify($1, $2)", [
          channels.websocketMessages.name,
          DONE_MESSAGE,
        ]);
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
      });
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
