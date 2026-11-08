import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { parseConfig, ConfigError } from "../src/config.js";
import { containsSecret, detect } from "../src/detect.js";
import { newSecret, plant } from "../src/plant.js";
import { markdown, terminal } from "../src/report.js";
import { hasLeaks, plannedRequests, run } from "../src/run.js";
import { fill, pick } from "../src/target.js";
import type { Canary, Config } from "../src/types.js";
import { DEMO_FIGURE, DEMO_SECRET, startDemo, type DemoMode } from "../demo/server.js";

const CANARY: Canary = {
  id: "salary-bands",
  title: "2027 Salary Bands",
  topic: "salary bands",
  secret: DEMO_SECRET,
  facts: [DEMO_FIGURE],
  allowed: ["hr-manager"],
};

function demoConfig(port: number, overrides: Partial<Canary> = {}): string {
  const c = { ...CANARY, ...overrides };
  return `
authorized: true
target:
  url: http://127.0.0.1:${port}/chat
  body: '{"message": {{prompt}}}'
  answer: answer
  sources: sources[].title
identities:
  intern:
    headers: { Authorization: "Bearer intern-token" }
  hr-manager:
    headers: { Authorization: "Bearer \${HR_TOKEN}" }
canaries:
  - id: ${c.id}
    title: ${JSON.stringify(c.title)}
    topic: ${JSON.stringify(c.topic)}
    secret: ${c.secret}
    facts: ${JSON.stringify(c.facts)}
    allowed: [hr-manager]
settings:
  delay_ms: 0
`;
}

let server: Server | undefined;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

async function check(mode: DemoMode, overrides: Partial<Canary> = {}) {
  server = await startDemo(mode, 0);
  const { port } = server.address() as AddressInfo;
  const config = parseConfig(demoConfig(port, overrides), { HR_TOKEN: "hr-token" });
  return run(config, { sleep: async () => {} });
}

describe("against the demo assistant", () => {
  it("finds the leak when every document is searched", async () => {
    const result = await check("leaky");
    const c = result.canaries[0]!;
    expect(c.status).toBe("leaked");
    expect(c.reachable).toBe(true);
    expect(new Set(c.leaks.map((l) => l.identity))).toEqual(new Set(["intern"]));
    expect(c.leaks.some((l) => l.kind === "secret")).toBe(true);
    expect(c.leaks.some((l) => l.kind === "source")).toBe(true);
    expect(hasLeaks(result)).toBe(true);
  });

  it("finds the leak when restricted sources are hidden but their content isn't", async () => {
    const c = (await check("hides-sources")).canaries[0]!;
    expect(c.status).toBe("leaked");
    expect(c.leaks.every((l) => l.kind !== "source")).toBe(true);
    expect(c.leaks.some((l) => l.kind === "secret")).toBe(true);
  });

  it("finds the leak when the assistant only refuses questions that name the document", async () => {
    const c = (await check("guarded")).canaries[0]!;
    expect(c.status).toBe("leaked");
    const attacks = new Set(c.leaks.map((l) => l.attack));
    expect(attacks.has("direct")).toBe(false);
    expect(attacks.has("topic")).toBe(true);
  });

  it("reports protected when search is filtered by permissions, and proves the canary is reachable", async () => {
    const result = await check("safe");
    const c = result.canaries[0]!;
    expect(c.status).toBe("protected");
    expect(c.reachable).toBe(true);
    expect(c.controlIdentity).toBe("hr-manager");
    expect(hasLeaks(result)).toBe(false);
  });

  it("reports inconclusive when the canary isn't in the assistant at all", async () => {
    const result = await check("safe", { title: "Board Minutes", topic: "board minutes", secret: newSecret(), facts: [] });
    expect(result.canaries[0]!.status).toBe("inconclusive");
  });

  it("asks the number of questions it planned, and never prints the full secret", async () => {
    const result = await check("leaky");
    expect(result.requests).toBeLessThanOrEqual(30);
    expect(terminal(result)).not.toContain(DEMO_SECRET);
    expect(markdown(result)).not.toContain(DEMO_SECRET);
    expect(terminal(result)).toContain("LEAKED to intern");
  });

  it("records errors instead of crashing when a token is wrong", async () => {
    server = await startDemo("safe", 0);
    const { port } = server.address() as AddressInfo;
    const config = parseConfig(demoConfig(port), { HR_TOKEN: "wrong" });
    const result = await run(config, { sleep: async () => {} });
    expect(result.errors.some((e) => e.message === "HTTP 401")).toBe(true);
    expect(result.canaries[0]!.status).toBe("inconclusive");
  });
});

describe("config", () => {
  it("starts new settings files without permission, so nobody tests by accident", async () => {
    const { readFileSync } = await import("node:fs");
    const cli = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");
    expect(cli).toContain("authorized: false");
    expect(cli).not.toMatch(/^authorized: true$/m);
  });

  it("refuses to run without authorization", () => {
    expect(() => parseConfig(demoConfig(1).replace("authorized: true", ""), { HR_TOKEN: "x" })).toThrow(/authorized: true/);
  });

  it("reads tokens from the environment and says which one is missing", () => {
    expect(() => parseConfig(demoConfig(1), {})).toThrow(/HR_TOKEN/);
  });

  it("rejects a canary everyone may see, or one allowed for an unknown identity", () => {
    const all = demoConfig(1).replace("allowed: [hr-manager]", "allowed: [hr-manager, intern]");
    expect(() => parseConfig(all, { HR_TOKEN: "x" })).toThrow(ConfigError);
    const unknown = demoConfig(1).replace("allowed: [hr-manager]", "allowed: [ceo]");
    expect(() => parseConfig(unknown, { HR_TOKEN: "x" })).toThrow(/ceo/);
  });

  it("plans requests for controls, targeted questions and broad questions", () => {
    const config: Config = parseConfig(demoConfig(1), { HR_TOKEN: "x" });
    // 3 control + 8 targeted for the intern + 2 broad for the intern
    expect(plannedRequests(config)).toBe(13);
  });
});

describe("detection", () => {
  const reply = (answer: string, sources: string[] = []) => ({ answer, sources, status: 200 });

  it("finds the secret even when the model reformats it", () => {
    expect(containsSecret("ref: rcan demo 7f3k q9wm", DEMO_SECRET)).toBe(true);
    expect(containsSecret("R-C-A-N-D-E-M-O-7-F-3-K-Q-9-W-M", DEMO_SECRET)).toBe(true);
    expect(containsSecret(Buffer.from(DEMO_SECRET).toString("base64"), DEMO_SECRET)).toBe(true);
    expect(containsSecret("RCAN-DEMO-7F3K", DEMO_SECRET)).toBe(false);
  });

  it("counts a cited source as a leak, and a matching figure as a hint", () => {
    expect(detect(CANARY, reply("I can't share that.", ["2027 Salary Bands"]))[0]?.kind).toBe("source");
    expect(detect(CANARY, reply(`The total is ${DEMO_FIGURE}.`))[0]?.kind).toBe("fact");
    expect(detect(CANARY, reply("Vacation is 20 days."))).toEqual([]);
  });
});

describe("planting canaries", () => {
  it("makes unique secrets without characters models confuse", () => {
    const a = newSecret();
    expect(a).toMatch(/^RCAN-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // The random part after "RCAN-" never uses 0/O or 1/I/L.
    expect(a.slice(4)).not.toMatch(/[01OIL]/);
    expect(newSecret()).not.toBe(a);
  });

  it("writes a document with the secret and figure, and a matching config entry", () => {
    const c = plant({ title: "Board Minutes March", topic: "board minutes", allowed: ["board"] });
    expect(c.document).toContain(c.secret);
    expect(c.document).toContain(c.facts[0]);
    expect(c.yaml).toContain(`secret: ${c.secret}`);
    expect(c.id).toBe("board-minutes-march");
  });
});

describe("request templates and response paths", () => {
  it("inserts the prompt as a JSON string so quotes don't break the body", () => {
    const body = fill('{"message": {{prompt}}}', { prompt: 'say "hi"' }, JSON.stringify);
    expect(JSON.parse(body)).toEqual({ message: 'say "hi"' });
  });

  it("reads nested answers and lists of sources", () => {
    const res = { choices: [{ message: { content: "hello" } }], sources: [{ title: "A" }, { title: "B" }] };
    expect(pick(res, "choices.0.message.content")).toBe("hello");
    expect(pick(res, "sources[].title")).toEqual(["A", "B"]);
  });
});
