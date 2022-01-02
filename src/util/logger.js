const chalk = require("chalk");

/**
 * Simple terminal logger that supports filtering by log level and module.
 * Heavily inspired by <https://docs.rs/env_logger>.
 *
 * Usage:
 *
 *    const log = logger("path/to/your/module");
 *
 *    log.info`doing the thing`;
 *    log.info`did ${things.length} things`;
 *
 * You should use the logging methods as template tag literals when
 * interpolating parameters, so that the string interpolation doesn't happen if
 * the log won't be emitted.
 *
 * Available log levels: `trace`, `debug`, `info`, `warn`, `error`.
 *
 * Set the `LOG` environment variable to configure the logging functionality.
 * To show logs from level "warn" and higher:
 *
 *    LOG=warn
 *
 * To show all logs from any module starting with "mymodule":
 *
 *    LOG=mymodule
 *
 * To show info (and higher) logs from modules starting with "foo", error logs
 * from modules starting with "bar", and warn logs from other modules:
 *
 *    LOG=warn,foo=info,bar=error
 *
 * (If a module matches multiple listed patterns, the last one wins.)
 *
 * A logger parses its configuration at first use. So, if you use `dotenv` to
 * change the value of the log spec environment variable, *and* you exercise
 * the logger before calling `dotenv.config()`, then your configuration may not
 * be taken into account.
 */
function logger(context) {
  return new Logger(context);
}
const ENV_VAR = "LOG";

const LEVELS = Object.freeze({
  TRACE: {
    threshold: 10,
    name: "trace",
    display: chalk.cyan("TRACE"),
  },
  DEBUG: {
    threshold: 20,
    name: "debug",
    display: chalk.blue("DEBUG"),
  },
  INFO: {
    threshold: 30,
    name: "info",
    display: chalk.green("INFO "),
  },
  WARN: {
    threshold: 40,
    name: "warn",
    display: chalk.green("WARN "),
  },
  ERROR: {
    threshold: 50,
    name: "error",
    display: chalk.red("ERROR"),
  },
});

const DEFAULT_LOG_LEVEL = LEVELS.DEBUG;

const OPEN_BRACKET = chalk.gray("[");
const CLOSE_BRACKET = chalk.gray("]");

const THRESHOLD_ALL = 0;
const THRESHOLD_OFF = 60;

class Logger {
  constructor(context) {
    this._context = context;
    this._cachedThreshold = null;

    this.trace = this._makeLogHandler(LEVELS.TRACE);
    this.debug = this._makeLogHandler(LEVELS.DEBUG);
    this.info = this._makeLogHandler(LEVELS.INFO);
    this.warn = this._makeLogHandler(LEVELS.WARN);
    this.error = this._makeLogHandler(LEVELS.ERROR);
  }

  _threshold() {
    let result = this._cachedThreshold;
    if (result == null) {
      this._cachedThreshold = result = this._computeThreshold();
    }
    return result;
  }

  _computeThreshold() {
    const spec = lazyParseSpec(process.env[ENV_VAR]);
    let lastMatch = spec.default;
    for (const { needle, threshold } of spec.contexts) {
      if (this._context.startsWith(needle)) {
        lastMatch = threshold;
      }
    }
    return lastMatch;
  }

  _log(level, parts, interpolands) {
    if (level.threshold < this._threshold()) return;
    if (typeof parts === "string") {
      this
        .error`log handler "${level.name}" called as function instead of template string`;
      return;
    }
    console.error(this._formatMessage(level, parts, interpolands));
  }

  _formatMessage(level, parts, interpolands) {
    const msg = expandTemplate(parts, interpolands);
    const now = new Date().toISOString();
    return `${OPEN_BRACKET}${now} ${level.display} ${this._context}${CLOSE_BRACKET} ${msg}`;
  }

  _makeLogHandler(level) {
    const handler = (parts, ...interpolands) =>
      this._log(level, parts, interpolands);
    handler.isEnabled = () => level.threshold >= this._threshold();
    return handler;
  }
}

function parseSpec(spec) {
  spec = (spec || "").trim() || DEFAULT_LOG_LEVEL.name;
  const result = {
    default: THRESHOLD_OFF,
    contexts: [],
  };

  for (const part of spec.split(",")) {
    const namedThreshold = resolveNamedLevelThreshold(part);
    if (namedThreshold != null) {
      result.default = namedThreshold;
      continue;
    }

    let needle, threshold;
    const equalsIdx = part.indexOf("=");
    if (equalsIdx === -1) {
      needle = part;
      threshold = THRESHOLD_ALL;
    } else {
      needle = part.slice(0, equalsIdx);
      const levelName = part.slice(equalsIdx + 1);
      if (levelName.trim().length === 0) {
        threshold = THRESHOLD_ALL;
      } else {
        threshold = resolveNamedLevelThreshold(levelName);
      }
      if (threshold == null) {
        console.warn("invalid logging spec %s; ignoring it", levelName);
        continue;
      }
    }
    result.contexts.push({ needle, threshold });
  }

  return result;
}

const parsedSpecs = new Map();

function lazyParseSpec(spec) {
  let result = parsedSpecs.get(spec);
  if (result == null) {
    result = parseSpec(spec);
    parsedSpecs.set(spec, result);
  }
  return result;
}

function resolveNamedLevelThreshold(name) {
  const upper = name.toUpperCase();
  if (upper === "OFF") return THRESHOLD_OFF;
  if (upper === "ALL") return THRESHOLD_ALL;
  const level = LEVELS[upper];
  if (level == null) return null;
  return level.threshold;
}

function expandTemplate(parts, interpolands) {
  const result = [];
  for (let i = 0; i < interpolands.length; i++) {
    result.push(parts[i], String(interpolands[i]));
  }
  result.push(parts[parts.length - 1]);
  return result.join("");
}

module.exports = logger;
