import { execSync } from "node:child_process";

import "./load-env-local";

execSync("npx drizzle-kit generate --name init", {
  stdio: "inherit",
  env: process.env,
});
