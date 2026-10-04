const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const repositoryRoot = resolve(__dirname, "../../..");
const e2eEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  E2E_TEST_MODE: "true",
  API_PORT: "4001",
  MONGODB_URI: "mongodb://127.0.0.1:27018/smartretail_e2e?replicaSet=rs0&directConnection=true",
  REDIS_URL: "redis://127.0.0.1:6379/1",
  WEB_ORIGIN: "http://127.0.0.1:3001",
};

function runSeed(script, environment) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath must be available to prepare the isolated E2E database");
  const result = spawnSync(
    process.execPath,
    [npmCli, "run", script, "-w", "@smartretail/api"],
    { cwd: repositoryRoot, env: environment, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${String(result.status)}`);
}

module.exports = async function globalSetup() {
  runSeed("seed", { ...e2eEnvironment, E2E_TEST_MODE: "false", ALLOW_DEMO_SEED_RESET: "true" });
  runSeed("seed:e2e", { ...e2eEnvironment, E2E_TEST_WORKER_SLOTS: "4" });
};
