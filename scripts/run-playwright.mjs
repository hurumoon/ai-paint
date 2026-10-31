import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const env = { ...process.env };

for (const key of Object.keys(env)) {
  if (key.toLowerCase() === "no_color") {
    delete env[key];
  }
}

const playwrightCli = resolve(
  repoRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js"
);

const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    cwd: repoRoot,
    env,
    stdio: "inherit",
    shell: false,
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
