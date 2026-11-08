import type { Identity, Reply, TargetConfig } from "./types.js";

/**
 * Sends one question to the assistant as one identity and pulls out the
 * answer text and any cited sources.
 */
export async function ask(target: TargetConfig, identity: Identity, prompt: string, timeoutMs: number): Promise<Reply> {
  const values: Record<string, string> = { ...identity.vars, prompt };
  const url = fill(target.url, values, encodeURIComponent);
  const body = target.method === "POST" && target.body ? fill(target.body, values, (v) => JSON.stringify(v)) : undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method: target.method,
      headers: { ...target.headers, ...identity.headers },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { answer: "", sources: [], status: 0, error: timedOut ? `no answer within ${timeoutMs / 1000}s` : `couldn't reach ${new URL(url).host}` };
  }

  const text = await res.text();
  if (!res.ok) return { answer: text, sources: [], status: res.status, error: `HTTP ${res.status}` };
  if (!target.answer) return { answer: text, sources: [], status: res.status };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { answer: text, sources: [], status: res.status, error: "the response wasn't JSON, but target.answer expects a JSON path" };
  }
  return {
    answer: flatten(pick(json, target.answer)).join("\n"),
    sources: target.sources ? flatten(pick(json, target.sources)) : [],
    status: res.status,
  };
}

/** Replaces `{{name}}` placeholders, encoding each value for where it goes. */
export function fill(template: string, values: Record<string, string>, encode: (v: string) => string): string {
  return template.replace(/\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g, (match, name: string) =>
    name in values ? encode(values[name]!) : match,
  );
}

/**
 * Reads a value from a JSON document by a short path: `answer`,
 * `choices.0.message.content`, or `sources[].title` to collect a field from
 * every item in a list.
 */
export function pick(value: unknown, path: string): unknown {
  let current: unknown[] = [value];
  for (const part of path.split(".").filter(Boolean)) {
    const each = part.endsWith("[]");
    const key = each ? part.slice(0, -2) : part;
    const next: unknown[] = [];
    for (const item of current) {
      const v = key === "" ? item : get(item, key);
      if (each && Array.isArray(v)) next.push(...v);
      else if (v !== undefined) next.push(v);
    }
    current = next;
  }
  return current.length === 1 ? current[0] : current;
}

function get(item: unknown, key: string): unknown {
  if (item === null || typeof item !== "object") return undefined;
  if (Array.isArray(item) && /^\d+$/.test(key)) return item[Number(key)];
  return (item as Record<string, unknown>)[key];
}

function flatten(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (typeof value === "object") return [JSON.stringify(value)];
  return [String(value)];
}
