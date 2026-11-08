import { BROAD, TARGETED } from "./attacks.js";
import { attackLabel } from "./run.js";
const KIND_TEXT = {
    secret: "the canary's secret code appeared in the answer",
    source: "the canary was listed as a source",
    fact: "a figure from the canary appeared in the answer",
};
const WHY = [
    "Why this matters: access control has to happen when documents are searched, before the AI model sees them.",
    "Telling the model \"don't reveal restricted documents\" isn't access control, because the right question gets around it.",
    "Filter search results by the user's permissions first, and check your sources list and answer use the same filtered results.",
];
const ATTACKS_PER_IDENTITY = TARGETED.length + BROAD.length;
const REFERENCES = "OWASP Top 10 for LLMs: LLM08 Vector and Embedding Weaknesses, LLM02 Sensitive Information Disclosure.";
export function summary(result) {
    const leaked = result.canaries.filter((c) => c.status === "leaked").length;
    const inconclusive = result.canaries.filter((c) => c.status === "inconclusive").length;
    const protectedCount = result.canaries.length - leaked - inconclusive;
    const parts = [];
    if (leaked)
        parts.push(`${leaked} of ${result.canaries.length} canary document(s) leaked to people who shouldn't see them`);
    if (protectedCount)
        parts.push(`${protectedCount} stayed protected`);
    if (inconclusive)
        parts.push(`${inconclusive} couldn't be tested because even an allowed user couldn't get them`);
    return parts.join("; ") + ".";
}
export function terminal(result) {
    const out = [`rag-canari: ${result.target}`, `${result.requests} questions asked.`, "", summary(result), ""];
    for (const c of result.canaries) {
        out.push(`${icon(c)} ${c.canary.title} (${c.canary.id}): ${statusText(c)}`);
        for (const group of groupLeaks(c.leaks)) {
            out.push(`    ${group.identity} got it ${group.attacks.length} way(s) out of ${group.tried}:`);
            for (const a of group.attacks)
                out.push(`      - ${attackLabel(a)}`);
            out.push(`    How we know: ${group.kinds.map((k) => KIND_TEXT[k]).join("; ")}.`);
            out.push(`    Example: ${group.evidence}`);
        }
        out.push("");
    }
    if (result.errors.length)
        out.push(...errorLines(result), "");
    if (result.canaries.some((c) => c.status === "leaked"))
        out.push(...WHY, "", REFERENCES);
    return out.join("\n");
}
export function markdown(result) {
    const out = [
        "# RAG leak check",
        "",
        `Target: \`${result.target}\` · ${result.requests} questions · ${result.startedAt}`,
        "",
        `**${summary(result)}**`,
        "",
        "| | Canary | Result |",
        "|---|---|---|",
        ...result.canaries.map((c) => `| ${icon(c)} | ${c.canary.title} | ${statusText(c)} |`),
        "",
    ];
    for (const c of result.canaries.filter((c) => c.leaks.length)) {
        out.push(`## ${c.canary.title}`, "", "| Who asked | How | What leaked | Evidence |", "|---|---|---|---|");
        for (const l of c.leaks) {
            out.push(`| ${l.identity} | ${attackLabel(l.attack)} | ${KIND_TEXT[l.kind]} | ${l.evidence.replace(/\|/g, "\\|")} |`);
        }
        out.push("");
    }
    if (result.errors.length)
        out.push("## Errors", "", ...errorLines(result).map((l) => `- ${l}`), "");
    if (result.canaries.some((c) => c.status === "leaked"))
        out.push(...WHY, "", REFERENCES, "");
    return out.join("\n");
}
function statusText(c) {
    if (c.status === "leaked") {
        const who = [...new Set(c.leaks.map((l) => l.identity))].join(", ");
        const questions = new Set(c.leaks.map((l) => `${l.identity}:${l.attack}`)).size;
        return `LEAKED to ${who} (${questions} question(s) got it out)`;
    }
    if (c.status === "protected")
        return `protected (${c.controlIdentity} could get it; nobody else could)`;
    return "inconclusive: no allowed user could get it either, so the test can't tell whether it's protected. Check the document is loaded and the allowed identity is right.";
}
function icon(c) {
    return c.status === "leaked" ? "🔴" : c.status === "protected" ? "🟢" : "⚪";
}
const STRENGTH = ["secret", "source", "fact"];
/** One group per identity, so ten questions that all worked don't make twenty lines. */
function groupLeaks(leaks) {
    const groups = new Map();
    for (const l of leaks) {
        const g = groups.get(l.identity) ?? { identity: l.identity, kinds: [], attacks: [], tried: ATTACKS_PER_IDENTITY, evidence: l.evidence, evidenceKind: l.kind };
        if (!g.kinds.includes(l.kind))
            g.kinds.push(l.kind);
        if (!g.attacks.includes(l.attack))
            g.attacks.push(l.attack);
        // Show the strongest proof as the example.
        if (STRENGTH.indexOf(l.kind) < STRENGTH.indexOf(g.evidenceKind))
            Object.assign(g, { evidence: l.evidence, evidenceKind: l.kind });
        groups.set(l.identity, g);
    }
    return [...groups.values()].map((g) => ({ ...g, kinds: STRENGTH.filter((k) => g.kinds.includes(k)) }));
}
function errorLines(result) {
    const unique = new Map();
    for (const e of result.errors)
        unique.set(`${e.identity}: ${e.message}`, (unique.get(`${e.identity}: ${e.message}`) ?? 0) + 1);
    return [`${result.errors.length} question(s) failed:`, ...[...unique].map(([msg, n]) => `  ${msg}${n > 1 ? ` (${n} times)` : ""}`)];
}
