import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const requested = process.argv.slice(2);
const services = requested.length ? requested : ["frontend", "backend", "smoke"];
if (services.some((service) => !["frontend", "backend", "smoke"].includes(service))) {
  throw new Error("Usage: node tests/run.mjs [frontend|backend|smoke]");
}

const compose = [
  "compose", "-p", `fae-test-${process.pid}`,
  "-f", "tests/docker-compose.test.yml",
];
function docker(args) {
  const result = spawnSync("docker", [...compose, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  for (const service of services) {
    const status = docker(["run", "--build", "--rm", `${service}-tests`]);
    if (status) {
      process.exitCode = status;
      break;
    }
  }
} finally {
  const status = docker(["down", "--remove-orphans"]);
  if (status && !process.exitCode) process.exitCode = status;
}
