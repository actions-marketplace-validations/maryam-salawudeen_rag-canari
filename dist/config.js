import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
export const CONFIG_FILE = "rag-canari.yml";
const DEFAULT_SETTINGS = { delayMs: 300, timeoutMs: 60_000, maxRequests: 300 };
export class ConfigError extends Error {
}
export function loadConfig(path = CONFIG_FILE, env = process.env) {
    if (!existsSync(path))
        throw new ConfigError(`No config file at ${path}. Run \`rag-canari init\` to create one.`);
    return parseConfig(readFileSync(path, "utf8"), env);
}
/**
 * The checker sends many requests that try to break access controls, so it
 * refuses to run until the config says the person running it may test the
 * system. That line also documents the permission for anyone reading later.
 */
export function parseConfig(text, env = process.env) {
    const raw = (parse(text) ?? {});
    if (raw.authorized !== true) {
        throw new ConfigError("Set `authorized: true` in the config to confirm you own this system or have written permission to test it. Testing someone else's system without permission can be illegal.");
    }
    const target = parseTarget(raw.target, env);
    const identities = parseIdentities(raw.identities, env);
    const canaries = parseCanaries(raw.canaries, identities);
    const settings = parseSettings(raw.settings);
    return { target, identities, canaries, settings };
}
function parseTarget(value, env) {
    const t = object(value, "target");
    const url = string(t.url, "target.url");
    try {
        new URL(url);
    }
    catch {
        throw new ConfigError(`target.url isn't a valid URL: ${url}`);
    }
    const method = (t.method === undefined ? "POST" : string(t.method, "target.method").toUpperCase());
    if (method !== "POST" && method !== "GET")
        throw new ConfigError("target.method must be POST or GET.");
    return {
        url: substitute(url, env),
        method,
        headers: stringMap(t.headers ?? { "Content-Type": "application/json" }, "target.headers", env),
        body: t.body === undefined ? undefined : string(t.body, "target.body"),
        answer: t.answer === undefined ? "" : string(t.answer, "target.answer"),
        sources: t.sources === undefined ? undefined : string(t.sources, "target.sources"),
    };
}
function parseIdentities(value, env) {
    const map = object(value, "identities");
    const identities = Object.entries(map).map(([name, v]) => {
        const entry = object(v ?? {}, `identities.${name}`);
        return {
            name,
            headers: stringMap(entry.headers ?? {}, `identities.${name}.headers`, env),
            vars: stringMap(entry.vars ?? {}, `identities.${name}.vars`, env),
        };
    });
    if (identities.length < 2) {
        throw new ConfigError("List at least two identities: one allowed to see a canary and one that isn't.");
    }
    return identities;
}
function parseCanaries(value, identities) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new ConfigError("List at least one canary. Run `rag-canari plant` to make one.");
    }
    const names = new Set(identities.map((i) => i.name));
    return value.map((v, i) => {
        const c = object(v, `canaries[${i}]`);
        const id = string(c.id, `canaries[${i}].id`);
        const secret = string(c.secret, `canaries[${id}].secret`);
        if (secret.length < 8)
            throw new ConfigError(`canaries[${id}].secret is too short to be unique. Use \`rag-canari plant\` to make one.`);
        const allowed = Array.isArray(c.allowed) ? c.allowed.map(String) : [];
        const unknown = allowed.filter((a) => !names.has(a));
        if (unknown.length)
            throw new ConfigError(`canaries[${id}].allowed names identities that aren't defined: ${unknown.join(", ")}`);
        if (allowed.length === identities.length) {
            throw new ConfigError(`canaries[${id}] is allowed for every identity, so there's nobody to test it against.`);
        }
        return {
            id,
            title: string(c.title, `canaries[${id}].title`),
            topic: string(c.topic, `canaries[${id}].topic`),
            secret,
            facts: Array.isArray(c.facts) ? c.facts.map(String).filter((f) => f.length >= 4) : [],
            allowed,
        };
    });
}
function parseSettings(value) {
    if (value === undefined)
        return DEFAULT_SETTINGS;
    const s = object(value, "settings");
    const num = (v, fallback) => (typeof v === "number" && v >= 0 ? v : fallback);
    return {
        delayMs: num(s.delay_ms, DEFAULT_SETTINGS.delayMs),
        timeoutMs: num(s.timeout_ms, DEFAULT_SETTINGS.timeoutMs),
        maxRequests: num(s.max_requests, DEFAULT_SETTINGS.maxRequests),
    };
}
/** `${NAME}` is replaced from the environment, so tokens stay out of the config file. */
export function substitute(value, env) {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
        const v = env[name];
        if (v === undefined)
            throw new ConfigError(`The config uses \${${name}}, but that environment variable isn't set.`);
        return v;
    });
}
function object(value, where) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ConfigError(`${where} must be a map of keys and values.`);
    return value;
}
function string(value, where) {
    if (typeof value !== "string" || !value.trim())
        throw new ConfigError(`${where} must be a non-empty string.`);
    return value;
}
function stringMap(value, where, env) {
    const map = object(value, where);
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, substitute(String(v), env)]));
}
