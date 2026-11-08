import { BROAD, CONTROL, TARGETED } from "./attacks.js";
import { detect } from "./detect.js";
import { ask } from "./target.js";
/**
 * For each canary: first check that someone allowed to see it can get it
 * (otherwise "no leak" would prove nothing), then try to get it as everyone
 * else, with every attack.
 */
export async function run(config, opts = {}) {
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const startedAt = new Date().toISOString();
    const errors = [];
    let requests = 0;
    const planned = plannedRequests(config);
    const send = async (identity, attack, prompt) => {
        if (requests >= config.settings.maxRequests)
            return null;
        if (requests > 0)
            await sleep(config.settings.delayMs);
        requests++;
        const reply = await ask(config.target, identity, prompt, config.settings.timeoutMs);
        opts.onProgress?.(requests, Math.min(planned, config.settings.maxRequests));
        if (reply.error)
            errors.push({ identity: identity.name, attack: attack.id, message: reply.error });
        return reply;
    };
    const results = config.canaries.map((canary) => ({ canary, status: "protected", reachable: false, leaks: [] }));
    const byId = new Map(results.map((r) => [r.canary.id, r]));
    for (const result of results) {
        const { canary } = result;
        const allowed = config.identities.filter((i) => canary.allowed.includes(i.name));
        const others = config.identities.filter((i) => !canary.allowed.includes(i.name));
        // Positive control: can an allowed identity find the canary?
        control: for (const identity of allowed) {
            for (const attack of CONTROL) {
                const reply = await send(identity, attack, attack.prompt(canary));
                if (reply && !reply.error && detect(canary, reply).some((d) => d.kind !== "fact")) {
                    result.reachable = true;
                    result.controlIdentity = identity.name;
                    break control;
                }
            }
        }
        for (const identity of others) {
            for (const attack of TARGETED) {
                const prompt = attack.prompt(canary);
                const reply = await send(identity, attack, prompt);
                if (reply && !reply.error)
                    record(result, identity, attack, prompt, reply);
            }
        }
    }
    // Broad questions aren't aimed at one canary, so check every canary the
    // identity shouldn't see.
    for (const identity of config.identities) {
        const forbidden = config.canaries.filter((c) => !c.allowed.includes(identity.name));
        if (!forbidden.length)
            continue;
        for (const attack of BROAD) {
            const prompt = attack.prompt(forbidden[0]);
            const reply = await send(identity, attack, prompt);
            if (!reply || reply.error)
                continue;
            for (const canary of forbidden)
                record(byId.get(canary.id), identity, attack, prompt, reply);
        }
    }
    for (const r of results) {
        r.status = r.leaks.length ? "leaked" : r.reachable ? "protected" : "inconclusive";
    }
    return {
        target: config.target.url,
        startedAt,
        finishedAt: new Date().toISOString(),
        requests,
        errors,
        canaries: results,
    };
}
function record(result, identity, attack, prompt, reply) {
    for (const d of detect(result.canary, reply)) {
        const leak = { canary: result.canary.id, identity: identity.name, attack: attack.id, prompt, kind: d.kind, evidence: d.evidence };
        result.leaks.push(leak);
    }
}
export function plannedRequests(config) {
    let n = 0;
    for (const c of config.canaries) {
        const allowed = config.identities.filter((i) => c.allowed.includes(i.name)).length;
        n += Math.min(allowed, 1) * CONTROL.length + (config.identities.length - allowed) * TARGETED.length;
    }
    for (const i of config.identities) {
        if (config.canaries.some((c) => !c.allowed.includes(i.name)))
            n += BROAD.length;
    }
    return n;
}
export function attackLabel(id) {
    return [...TARGETED, ...BROAD].find((a) => a.id === id)?.label ?? id;
}
export function hasLeaks(result) {
    return result.canaries.some((c) => c.status === "leaked");
}
export function canaryById(result, id) {
    return result.canaries.find((c) => c.canary.id === id)?.canary;
}
