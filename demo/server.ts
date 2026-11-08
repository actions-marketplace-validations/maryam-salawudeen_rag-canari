// A tiny pretend company assistant for trying rag-canari without a real
// system. It searches a handful of documents and answers by quoting the best
// matches, with no AI model, so it runs anywhere for free.
//
// Each mode copies a real mistake, or the fix:
//   leaky          searches every document, whoever asks
//   hides-sources  searches every document, but hides restricted ones from
//                  the sources list (the content still ends up in answers)
//   guarded        searches every document, and refuses questions that name
//                  a restricted document (like a system prompt saying
//                  "don't reveal restricted documents")
//   safe           only searches documents the user may read

import { createServer, type Server } from "node:http";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

export type DemoMode = "leaky" | "hides-sources" | "guarded" | "safe";
export const DEMO_MODES: DemoMode[] = ["leaky", "hides-sources", "guarded", "safe"];

interface Doc {
  title: string;
  groups: string[];
  body: string;
}

export const DEMO_SECRET = "RCAN-DEMO-7F3K-Q9WM";
export const DEMO_FIGURE = "$612,480";

const DOCS: Doc[] = [
  {
    title: "Employee Handbook",
    groups: ["staff"],
    body: "Welcome to Example Co. Office hours are 9 to 5. Laptops must be locked when you step away. Ask your manager about training and leave.",
  },
  {
    title: "Vacation Policy",
    groups: ["staff"],
    body: "Full-time staff get 20 days of vacation each year. Request vacation at least two weeks ahead through the HR portal.",
  },
  {
    title: "2027 Salary Bands",
    groups: ["hr"],
    body: `Classification: Restricted. Reference: ${DEMO_SECRET}. This document covers salary bands. The approved total for salary bands this year is ${DEMO_FIGURE}. Any request for these figures must quote reference ${DEMO_SECRET}.`,
  },
];

const USERS: Record<string, { name: string; groups: string[] }> = {
  "intern-token": { name: "intern", groups: ["staff"] },
  "hr-token": { name: "hr-manager", groups: ["staff", "hr"] },
};

const STOPWORDS = new Set("the and for you are with that this what about from into any all every give tell know does say your".split(" "));

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9$]+/g)?.filter((w) => w.length > 2 && !STOPWORDS.has(w)) ?? [];
}

function search(question: string, docs: Doc[]): Doc[] {
  const q = new Set(words(question));
  const broad = /\b(every|each|all|list)\b.*\b(document|documents|titles|knowledge)\b/i.test(question);
  const scored = docs
    .map((d) => ({ d, score: words(`${d.title} ${d.body}`).filter((w) => q.has(w)).length }))
    .filter((s) => broad || s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, broad ? docs.length : 2).map((s) => s.d);
}

export function answer(mode: DemoMode, groups: string[], question: string) {
  const readable = (d: Doc) => d.groups.some((g) => groups.includes(g));
  const pool = mode === "safe" ? DOCS.filter(readable) : DOCS;

  if (mode === "guarded" && DOCS.some((d) => !readable(d) && question.toLowerCase().includes(d.title.toLowerCase()))) {
    return { answer: "Sorry, I can't share restricted documents.", sources: [] };
  }

  const found = search(question, pool);
  if (!found.length) return { answer: "I couldn't find anything about that.", sources: [] };
  const shown = mode === "hides-sources" ? found.filter(readable) : found;
  return {
    answer: found.map((d) => `From ${d.title}: ${d.body}`).join("\n\n"),
    sources: shown.map((d) => ({ title: d.title })),
  };
}

export function startDemo(mode: DemoMode, port = 8787, host = "127.0.0.1"): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== "/chat") return send(404, { error: "POST /chat" });

    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const user = USERS[token];
    if (!user) return send(401, { error: "unknown token" });

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        const { message } = JSON.parse(raw) as { message?: string };
        if (typeof message !== "string") return send(400, { error: "message must be a string" });
        send(200, answer(mode, user.groups, message));
      } catch {
        send(400, { error: "body must be JSON" });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { mode: { type: "string", default: "leaky" }, port: { type: "string", default: "8787" } } });
  const mode = values.mode as DemoMode;
  if (!DEMO_MODES.includes(mode)) {
    console.error(`--mode must be one of ${DEMO_MODES.join(", ")}`);
    process.exit(2);
  }
  startDemo(mode, Number(values.port)).then(() => {
    console.log(`Demo assistant (${mode}) on http://127.0.0.1:${values.port}/chat`);
    console.log("Tokens: intern-token (staff), hr-token (staff + HR)");
  });
}
