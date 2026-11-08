// The GitHub Action: runs the same test as `rag-canari run`, writes the
// report to the job summary, and fails the check when a canary leaks.
import { writeFileSync } from "node:fs";
import * as core from "@actions/core";
import { ConfigError, loadConfig } from "../src/config.js";
import { markdown, summary } from "../src/report.js";
import { plannedRequests, run } from "../src/run.js";

async function main() {
  const configPath = core.getInput("config") || "rag-canari.yml";
  const failOnLeak = core.getInput("fail-on-leak") !== "false";
  const failOnInconclusive = core.getInput("fail-on-inconclusive") !== "false";
  const reportPath = core.getInput("report") || "rag-canari-report.md";

  // Tokens come from the workflow's env (usually repository secrets). Mask
  // every header value so none of them shows up in the logs.
  const config = loadConfig(configPath);
  for (const identity of config.identities) {
    for (const value of [...Object.values(identity.headers), ...Object.values(identity.vars)]) {
      if (value) core.setSecret(value);
    }
  }

  core.info(`Asking up to ${Math.min(plannedRequests(config), config.settings.maxRequests)} questions to ${config.target.url}`);
  const result = await run(config, {
    onProgress: (done, planned) => {
      if (done % 10 === 0 || done === planned) core.info(`${done}/${planned}`);
    },
  });

  const report = markdown(result);
  writeFileSync(reportPath, report + "\n");
  await core.summary.addRaw(report).write();

  const leaked = result.canaries.filter((c) => c.status === "leaked").length;
  const inconclusive = result.canaries.filter((c) => c.status === "inconclusive").length;
  core.setOutput("leaked", leaked);
  core.setOutput("inconclusive", inconclusive);
  core.setOutput("report", reportPath);
  core.info(summary(result));

  if (leaked && failOnLeak) {
    core.setFailed(`${leaked} canary document(s) leaked to people who shouldn't see them. See the job summary.`);
  } else if (inconclusive === result.canaries.length && failOnInconclusive) {
    core.setFailed("No canary could be found even by an allowed user, so nothing was tested. Check the canaries are loaded and the allowed identities are right.");
  }
}

main().catch((err) => {
  core.setFailed(err instanceof ConfigError ? err.message : `rag-canari: ${err instanceof Error ? err.message : err}`);
});
