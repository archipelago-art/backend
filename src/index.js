const commands = require("./cli");

async function main() {
  require("dotenv").config();
  const [arg0, ...args] = process.argv.slice(2);
  for (const [name, fn] of commands) {
    if (name === arg0) {
      return await fn(args, name);
    }
  }
  console.error("Unknown command: " + arg0);
  console.error("Available commands:");
  for (const [name] of commands) {
    console.error(" ".repeat(4) + name);
  }
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = process.exitCode || 1;
});
