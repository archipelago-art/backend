const ethers = require("ethers");
const luxon = require("luxon");

const contracts = require("../api/contracts");
const accounts = require("../db/accounts");
const emails = require("../db/emails");
const orderbook = require("../db/orderbook");
const projects = require("../db/projects");
const tokens = require("../db/tokens");
const { acqrel } = require("../db/util");
const Cmp = require("../util/cmp");
const log = require("../util/log")(__filename);
const priceToString = require("../util/priceToString");

const DAILY_DIGEST_TEMPLATE_ID = "d-10770321a62e477b88af8a3ea99a77ee";
const PERCENTAGE_OF_FLOOR_FILTER = 0.5;

function index(fk, fv = (x) => x) {
  return (xs) => new Map(xs.map((x) => [fk(x), fv(x)]));
}

// Returns a value for the `dynamicTemplateData` arg to a SendGrid call.
async function prepareTemplateData({ client, account, lastEmailTime }) {
  // Retrieve data necessary to render the email.
  const projectFloors = await orderbook.floorAskForEveryProject({
    client,
  });
  const projectFloorMap = index(
    (x) => x.projectId,
    (x) => x.price
  )(projectFloors);
  const highBidIds = await orderbook.highBidIdsForTokensOwnedBy({
    client,
    account,
  });
  const tokenInfo = await tokens
    .tokenInfoById({ client, tokenIds: highBidIds.map((x) => x.tokenId) })
    .then(index((x) => x.tokenId));
  const bidInfo = await orderbook
    .bidDetails({ client, bidIds: highBidIds.map((x) => x.bidId) })
    .then(index((x) => x.bidId));
  const projectInfo = await projects
    .projectInfoById({
      client,
      projectIds: Array.from(tokenInfo.values(), (x) => x.projectId),
    })
    .then(index((x) => x.projectId));

  // Build the bid data structure to be passed to the template.
  let tokenBids = Array.from(highBidIds, ({ tokenId, bidId }) => {
    const bid = bidInfo.get(bidId);
    const token = tokenInfo.get(tokenId);
    const project = projectInfo.get(token.projectId);

    const onChainTokenId = token.onChainTokenId;
    const contractObject = contracts.contractForAddress(project.tokenContract);
    const lo = String(Number(onChainTokenId) % 1e6).padStart(6, "0");
    const hi = String(Math.floor(Number(onChainTokenId) / 1e6));

    const label = `${project.name} #${token.tokenIndex}`;
    const url = `https://archipelago.art/collections/${project.slug}/${token.tokenIndex}`;
    const imageUrl = `https://static.archipelago.art/tokens/400p/${contractObject.name}/${hi}/${lo}`;
    const formattedPrice = priceToString(String(bid.price));
    const bigIntPrice = BigInt(bid.price);
    const bigIntFloor = BigInt(projectFloorMap.get(project.projectId) || 1);
    const ratioToFloor = Number((bigIntPrice * 100n) / bigIntFloor) / 100;

    const datum = {
      label,
      url,
      imageUrl,
      formattedPrice,
      ratioToFloor,
    };
    return { bid, token, project, datum };
  });

  // Filter and sort the bids
  tokenBids = tokenBids.filter((x) => x.bid.createTime > lastEmailTime);
  tokenBids = tokenBids.filter(
    (x) => x.datum.ratioToFloor >= PERCENTAGE_OF_FLOOR_FILTER
  );

  if (tokenBids.length === 0) {
    return null;
  }
  tokenBids.sort(
    Cmp.first([
      Cmp.comparing((x) => x.ratioToFloor),
      Cmp.comparing((x) => BigInt(x.bid.price), Cmp.rev()),
      Cmp.comparing((x) => x.bid.createTime),
      Cmp.comparing((x) => x.project.name),
      Cmp.comparing((x) => x.token.tokenIndex),
    ])
  );
  tokenBids = tokenBids.map((x) => x.datum);

  const MORE_SIZE = 10;
  return {
    address: ethers.utils.getAddress(account),
    totalBids: highBidIds.length,
    bids: {
      top3: tokenBids.slice(0, 3),
      next3: tokenBids.slice(3, 6),
      more: tokenBids.slice(6, 6 + MORE_SIZE),
    },
  };
}

async function sendOneDigest({
  client,
  account,
  email,
  lastEmailTime,
  isTestEmail = false,
}) {
  await client.query("BEGIN");
  log.info`preparing email for ${account} (since ${lastEmailTime?.toISOString()})`;
  const templateData = await prepareTemplateData({
    client,
    account,
    lastEmailTime,
  });
  if (templateData == null) {
    log.info`no activity; skipping`;
    await client.query("ROLLBACK");
    return;
  }
  if (!isTestEmail) {
    await accounts.touchLastEmailTime({ client, account });
  }
  const preparedEmail = await emails.prepareEmail({
    client,
    topic: "BID_DIGEST",
    email,
    templateId: DAILY_DIGEST_TEMPLATE_ID,
    templateData,
    isTestEmail,
  });
  try {
    await preparedEmail.send();
    await client.query("COMMIT");
    log.info`sent email for ${account}`;
  } catch (e) {
    log.error`error sending email: ${e}`;
    await client.query("ROLLBACK");
  }
}

async function sendAllDigests({ pool }) {
  const zones = await acqrel(pool, (client) =>
    accounts.getTimeZones({ client })
  );
  for (const zone of zones) {
    const timeThere = luxon.DateTime.local({ zone });
    if (!(timeThere.hour >= 10 && timeThere.hour < 18)) {
      continue;
    }
    const threshold = timeThere
      .set({ hour: 18, minute: 0, second: 0, millisecond: 0 })
      .minus({ days: 1 })
      .toJSDate();
    const emailableUsers = await acqrel(pool, (client) =>
      accounts.getEmailableUsers({
        client,
        timeZone: zone,
        threshold,
      })
    );
    console.log(zone, emailableUsers);
    for (const { account, email, lastEmailTime } of emailableUsers) {
      await acqrel(pool, (client) =>
        sendOneDigest({ client, account, email, lastEmailTime })
      );
    }
  }
}

module.exports = {
  prepareTemplateData,
  sendOneDigest,
  sendAllDigests,
};
