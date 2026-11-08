#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILE, ConfigError, loadConfig } from "./config.js";
import { plant } from "./plant.js";
import { markdown, terminal } from "./report.js";
import { hasLeaks, plannedRequests, run } from "./run.js";
const HELP = `rag-canari: tests whether your AI assistant leaks documents people aren't allowed to see.

Usage:
  rag-canari init
      Write an example rag-canari.yml
  rag-canari plant --title <t> --topic <t> --allowed <a,b> [--out <dir>]
      Make a canary document to load into your assistant
  rag-canari run [--config <file>] [--format text|markdown|json] [--out <file>]
      Run the test

Exit codes: 0 no leaks, 1 a leak was found, 2 the test couldn't run, 3 nothing could be tested.
Only test systems you own or have written permission to test.
`;
const EXAMPLE_CONFIG = `# rag-canari config. Tokens come from environment variables, written as \${NAME}.

# Confirm you own this system or have written permission to test it.
authorized: true

target:
  url: http://localhost:8787/chat
  method: POST
  headers:
    Content-Type: application/json
  # {{prompt}} becomes the question, as a JSON string with its quotes.
  body: '{"message": {{prompt}}}'
  # Where the answer is in the JSON response.
  answer: answer
  # Optional: where the cited sources are.
  sources: sources[].title

identities:
  intern:
    headers:
      Authorization: "Bearer \${INTERN_TOKEN}"
  hr-manager:
    headers:
      Authorization: "Bearer \${HR_TOKEN}"

canaries:
  # Make your own with: rag-canari plant --title "2027 Salary Bands" --topic "salary bands" --allowed hr-manager
  - id: salary-bands
    title: "2027 Salary Bands"
    topic: "salary bands"
    secret: RCAN-EXAM-PLE7-CODE
    facts: ["$612,480"]
    allowed: [hr-manager]

settings:
  delay_ms: 300       # pause between questions
  timeout_ms: 60000   # how long to wait for each answer
  max_requests: 300
`;
async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || command === "-h" || command === "--help") {
        process.stdout.write(HELP);
        return 0;
    }
    if (command === "init") {
        if (existsSync(CONFIG_FILE))
            throw new ConfigError(`${CONFIG_FILE} already exists.`);
        writeFileSync(CONFIG_FILE, EXAMPLE_CONFIG);
        process.stdout.write(`Wrote ${CONFIG_FILE}. Edit the target and identities, then make a canary with \`rag-canari plant\`.\n`);
        return 0;
    }
    if (command === "plant") {
        const { values } = parseArgs({
            args: rest,
            options: { title: { type: "string" }, topic: { type: "string" }, allowed: { type: "string" }, out: { type: "string", default: "canaries" } },
        });
        if (!values.title || !values.topic || !values.allowed)
            throw new ConfigError("plant needs --title, --topic and --allowed.");
        const canary = plant({ title: values.title, topic: values.topic, allowed: values.allowed.split(",").map((s) => s.trim()) });
        mkdirSync(values.out, { recursive: true });
        const file = join(values.out, `${canary.id}.md`);
        writeFileSync(file, canary.document);
        process.stdout.write([
            `Wrote ${file}.`,
            "",
            `1. Load it into your assistant's knowledge base, readable only by: ${canary.allowed.join(", ")}.`,
            `2. Add this under canaries: in ${CONFIG_FILE}:`,
            "",
            canary.yaml,
            "",
        ].join("\n"));
        return 0;
    }
    if (command === "run") {
        const { values } = parseArgs({
            args: rest,
            options: { config: { type: "string", default: CONFIG_FILE }, format: { type: "string", default: "text" }, out: { type: "string" } },
        });
        const config = loadConfig(values.config);
        process.stderr.write(`Asking up to ${Math.min(plannedRequests(config), config.settings.maxRequests)} questions…\n`);
        const result = await run(config, {
            onProgress: (done, planned) => process.stderr.write(`\r${done}/${planned}`),
        });
        process.stderr.write("\n\n");
        const output = values.format === "json" ? JSON.stringify(result, null, 2) : values.format === "markdown" ? markdown(result) : terminal(result);
        if (values.out)
            writeFileSync(values.out, output + "\n");
        process.stdout.write(output + "\n");
        if (hasLeaks(result))
            return 1;
        if (result.canaries.every((c) => c.status === "inconclusive"))
            return 3;
        return 0;
    }
    throw new ConfigError(`Unknown command "${command}". Run \`rag-canari --help\`.`);
}
main().then((code) => {
    process.exitCode = code;
}, (err) => {
    process.stderr.write(`rag-canari: ${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 2;
});
