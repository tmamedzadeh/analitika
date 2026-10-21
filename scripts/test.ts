import { spawnSync } from "node:child_process";
import process from "node:process";

import { isolateTestEnvironment } from "../src/test/safe-env";

const env = { ...process.env };
isolateTestEnvironment(env);
const forwardedArgs = process.argv.slice(2);
const vitestArgs = forwardedArgs.includes("--watch") ? forwardedArgs : ["run", ...forwardedArgs];

const result = spawnSync(process.execPath, ["--no-env-file", "run", "vitest", ...vitestArgs], {
  env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
