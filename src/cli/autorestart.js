const { spawn } = require("node:child_process");
const { stderr, stdout } = require("node:process");

async function sleepUntil(timestamp) {
  const ms = timestamp - Date.now();
  await new Promise((res) => void setTimeout(res, ms));
}

// Runs the provided command in a child process, restarting if it goes
// restartDurationMs without emitting anything to stdout or stderr.
async function runWithAutoRestarts({ cmd, args, restartDurationMs }) {
  let process;
  let lastMessageTimestamp = Date.now();
  function start() {
    if (process != null) {
      process.kill();
    }
    process = spawn(cmd, args);
    process.stdout.on("data", (data) => {
      stdout.write(String(data));
      lastMessageTimestamp = Date.now();
    });
    process.stderr.on("data", (data) => {
      stderr.write(data);
      lastMessageTimestamp = Date.now();
    });
  }
  start();
  while (true) {
    await sleepUntil(lastMessageTimestamp + restartDurationMs);
    if (Date.now() - lastMessageTimestamp >= restartDurationMs) {
      console.log("restarting...");
      lastMessageTimestamp = Date.now();
      start();
    }
  }
}

function autorestart(args) {
  if (args.length < 2) {
    throw new Error(`usage: autorestart restartDurationSecs cmd [...args]`);
  }
  const restartDurationMs = +args[0] * 1000;
  const cmd = args[1];
  args = args.slice(2);
  runWithAutoRestarts({ cmd, args, restartDurationMs });
}

module.exports = autorestart;
