export interface TargetConfig {
  url: string;
  method: "POST" | "GET";
  headers: Record<string, string>;
  /**
   * Request body. `{{prompt}}` is replaced with the question as a JSON string
   * (quotes included), so the body stays valid JSON.
   */
  body?: string;
  /** Where the answer text is in the JSON response, as a path like `answer` or `choices.0.message.content`. Empty means the whole response is text. */
  answer: string;
  /** Optional path to the sources the assistant cites, like `sources[].title`. */
  sources?: string;
}

export interface Identity {
  name: string;
  headers: Record<string, string>;
  /** Extra values merged into the body template, for systems that take the user in the body. */
  vars: Record<string, string>;
}

/** A marked document you planted in the assistant, readable only by `allowed` identities. */
export interface Canary {
  id: string;
  title: string;
  /** A few words about what the document is about, used to aim the questions. */
  topic: string;
  /** A unique code that appears only in this document. Finding it in an answer proves a leak. */
  secret: string;
  /** Other facts unique to the document. Finding one suggests a leak. */
  facts: string[];
  allowed: string[];
}

export interface Settings {
  delayMs: number;
  timeoutMs: number;
  maxRequests: number;
}

export interface Config {
  target: TargetConfig;
  identities: Identity[];
  canaries: Canary[];
  settings: Settings;
}

export interface Reply {
  answer: string;
  sources: string[];
  status: number;
  error?: string;
}

export type LeakKind = "secret" | "source" | "fact";

export interface Leak {
  canary: string;
  identity: string;
  attack: string;
  prompt: string;
  kind: LeakKind;
  /** What was found, with the canary code partly hidden so the report itself doesn't spread it. */
  evidence: string;
}

export type CanaryStatus = "leaked" | "protected" | "inconclusive";

export interface CanaryResult {
  canary: Canary;
  status: CanaryStatus;
  /** Whether an allowed identity could get the document. Without that, "protected" proves nothing. */
  reachable: boolean;
  controlIdentity?: string;
  leaks: Leak[];
}

export interface RunResult {
  target: string;
  startedAt: string;
  finishedAt: string;
  requests: number;
  errors: { identity: string; attack: string; message: string }[];
  canaries: CanaryResult[];
}
