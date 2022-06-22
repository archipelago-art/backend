const crypto = require("crypto");

const channels = require("./channels");

/**
 * Records zero or more WebSocket messages in the database and sends them over
 * the `websocket_messages` channel. Each message should be an object with
 * three fields:
 *
 *  - `type`: A string like "ASK_PLACED" or "TOKEN_TRANSFERRED".
 *  - `topic`: A string; WebSocket clients will need to be subscribed to this
 *      topic to receive the message.
 *  - `data`: An arbitrary JSON-serializable value.
 *
 * For example, the following call will send two WebSocket messages:
 *
 *    await sendMessages({
 *      client,
 *      messages: [
 *        {
 *          type: "TOKEN_MINTED",
 *          topic: "archetype",
 *          data: {
 *            slug: "archetype",
 *            tokenIndex: 250,
 *          },
 *        },
 *        {
 *          type: "TOKEN_TRANSFERRED",
 *          topic: "chromie-squiggle",
 *          data: {
 *            slug: "chromie-squiggle",
 *            tokenIndex: 7583,
 *            from: "0x...",
 *            to: "0x...",
 *          },
 *        },
 *      ],
 *    });
 *
 * The end user on the WebSocket will receive messages like:
 *
 *    {
 *      "messageId": "a13f4b1a-4b90-7bf1-c7c9-1925a819ca9a",
 *      "timestamp": "2001-02-03T04:05:06.789Z",
 *      "type": "TOKEN_MINTED",
 *      "topic": "archetype",
 *      "data": {
 *        "slug": "archetype",
 *        "tokenIndex": 1
 *      }
 *    }
 *
 * (but JSON-formatted compactly instead of legibly).
 *
 * The caller is advised to call this method within a transaction, to ensure
 * that the recording and sending of the WebSocket messages is atomic.
 */
async function sendMessages({ client, messages }) {
  const messageIds = Array(messages.length);
  const types = Array(messages.length);
  const topics = Array(messages.length);
  const datas = Array(messages.length);
  for (let i = 0; i < messages.length; i++) {
    messageIds[i] = crypto.randomBytes(16).toString("hex");
    types[i] = messages[i].type;
    topics[i] = messages[i].topic;
    datas[i] = JSON.stringify(messages[i].data);
  }
  messageIds.sort();
  const res = await client.query(
    `
    INSERT INTO websocket_log(message_id, create_time, message_type, topic, data)
    VALUES (
      unnest($1::uuid[]),
      now(),
      unnest($2::text[]),
      unnest($3::text[]),
      unnest($4::jsonb[])
    )
    RETURNING
      message_id AS "messageId",
      create_time AS "createTime",
      message_type AS "messageType",
      topic AS "topic",
      data AS "data"
    `,
    [messageIds, types, topics, datas]
  );
  const wsMessages = res.rows.map(formatWebsocketMessage);
  await channels.websocketMessages.sendMany(client, wsMessages);
}

/**
 * Retrieves all messages posted with the given topic since the given date.
 *
 * The result is an array of objects that can be JSON-serialized and sent out
 * over a WebSocket.
 */
async function getMessages({ client, topic, since }) {
  if (topic === undefined) {
    throw new Error("must explicitly set `topic` to a string or `null`");
  }
  const res = await client.query(
    `
    SELECT
      message_id AS "messageId",
      create_time AS "createTime",
      message_type AS "messageType",
      topic AS "topic",
      data AS "data"
    FROM websocket_log
    WHERE
      (topic = $1::text OR $1 IS NULL)
      AND create_time > $2::timestamptz
    ORDER BY create_time, message_id
    `,
    [topic, since]
  );
  return res.rows.map(formatWebsocketMessage);
}

function formatWebsocketMessage({
  messageId /*: string (UUID) */,
  createTime /*: Date */,
  messageType /*: string */,
  topic /*: string */,
  data /*: JsonValue */,
}) /*: string */ {
  return {
    messageId,
    timestamp: createTime.toISOString(),
    type: messageType,
    topic,
    data,
  };
}

/**
 * Deletes all WebSocket messages stored before the given date.
 */
async function expireMessages({ client, before }) {
  await client.query(
    "DELETE FROM websocket_log WHERE create_time < $1::timestamptz",
    [before]
  );
}

module.exports = {
  sendMessages,
  getMessages,
  expireMessages,
};
