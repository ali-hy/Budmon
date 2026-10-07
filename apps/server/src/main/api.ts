// F-90: the API process. S-2 delivers start-up and configuration handling; the server arrives
// with S-4.
import { readFileSync } from "node:fs";
import { EXIT_CONFIG, loadConfigOrReport } from "../platform/config/startup.js";

function main(): void {
  const config = loadConfigOrReport("api", process.env, readFileSync, (line) =>
    process.stderr.write(`${line}\n`),
  );
  if (config === null) {
    process.exitCode = EXIT_CONFIG;
    return;
  }
  process.stderr.write("api: configuration is valid; the HTTP server arrives with S-4\n");
}

main();
