# rag-canari

*Canari* is French for canary. Miners used to carry a canary into the mine, because it reacted to poisonous air before people did. rag-canari plants a canary document in your AI assistant and warns you when it shows up where it shouldn't.

It's a free tool that tests whether your company's AI assistant shows people documents they aren't allowed to see. You plant a marked document that only some users may read, and the checker logs in as everyone else and tries to get it out.

It works with any assistant you can reach over HTTP, needs no AI model or API key, and gives the same result every time.

> **Only test systems you own or have written permission to test.** The checker sends questions designed to get around access controls. It won't run until your config says `authorized: true`.

## Why I built it

Many companies are building AI assistants on top of their own documents: the handbook, policies, contracts, HR files. This is called RAG (retrieval-augmented generation): when you ask a question, the assistant searches the company's documents, then answers using what it found.

The risk is in the search. If it looks through every document, whoever is asking, an intern's question can pull in the salary file, and the AI will happily use it in the answer. I kept seeing teams try to fix this by telling the AI "don't reveal restricted documents". That doesn't work: ask in a different way, or ask for a translation, and the document comes out.

I looked for a free tool that tests a company's own running assistant for this, logged in as different people, and couldn't find one. The tools I found test their own demo systems, or need a paid AI key. So I built one.

## How it works

Think of a marked banknote. If it turns up somewhere it shouldn't be, you know exactly where it came from.

1. **Plant a marked document.** `rag-canari plant` makes a believable restricted document, like "2027 Salary Bands", with a unique code inside it (`RCAN-…`) and a unique figure. You load it into your assistant so that only certain people (say, HR) can read it.
2. **Check it can be found.** The checker asks as someone who *is* allowed. If even they can't get it, the test can't prove anything, so it reports **inconclusive** instead of a false "all safe".
3. **Try to get it out as everyone else.** It asks as each other user in ten ways: by title, by topic, claiming to be HR, telling the assistant to ignore its rules, asking for codes and numbers, a translation, a different format, a hint, a list of all documents, and a summary of everything.
4. **Look for the mark.** If the code shows up in an answer (even spaced out or encoded), or the document is listed as a source, that's a leak. If its figure shows up, that's a strong sign of one.

## Try it in 5 minutes

The repository includes a small practice assistant, so you can see the checker work without a real system. You need [Node.js](https://nodejs.org) 20 or later.

```bash
git clone https://github.com/maryam-salawudeen/rag-canari.git
cd rag-canari
npm install
```

Start the practice assistant in its leaky setting:

```bash
npm run demo -- --mode leaky
```

In a second terminal window, run the checker against it:

```bash
npm run check -- run --config examples/demo.yml
```

You'll see something like:

```
🔴 2027 Salary Bands (salary-bands): LEAKED to intern (10 question(s) got it out)
    intern got it 10 way(s) out of 10:
      - Asked for the document by its title
      - Asked about the document's topic
      ...
    How we know: the canary's secret code appeared in the answer; the canary was listed as a source.
```

Stop the practice assistant (Ctrl+C), start it again with another setting, and run the checker again. Each setting copies a real mistake, or the fix:

| Setting | What it does | Result |
|---|---|---|
| `leaky` | Searches every document, whoever asks | 🔴 Leaked |
| `hides-sources` | Hides restricted documents from the sources list, but still uses their content | 🔴 Leaked |
| `guarded` | Refuses questions that name a restricted document, like a system prompt saying "don't reveal restricted documents" | 🔴 Leaked: the direct question is blocked, but 7 other questions get it out |
| `safe` | Only searches documents the user is allowed to read | 🟢 Protected |

## Test your own assistant

**1. Make a config.** In a new folder:

```bash
npx github:maryam-salawudeen/rag-canari init
```

This writes `rag-canari.yml`. Edit three parts:

- **`target`**: your assistant's address, the request it expects, and where the answer is in its reply. `{{prompt}}` is where the question goes.
- **`identities`**: at least two test accounts, one allowed to read the canary and one not. Put their tokens in environment variables and refer to them as `${NAME}`, so they stay out of the file.
- **`authorized: true`**: only once you're sure you may test this system.

```yaml
target:
  url: https://assistant.example.ca/api/chat
  body: '{"message": {{prompt}}}'
  answer: answer             # or choices.0.message.content, data.reply, ...
  sources: sources[].title   # optional, if it returns citations

identities:
  intern:
    headers: { Authorization: "Bearer ${INTERN_TOKEN}" }
  hr-manager:
    headers: { Authorization: "Bearer ${HR_TOKEN}" }
```

**2. Plant a canary.**

```bash
npx github:maryam-salawudeen/rag-canari plant --title "2027 Salary Bands" --topic "salary bands" --allowed hr-manager
```

It writes `canaries/2027-salary-bands.md` and prints the lines to add under `canaries:` in your config. Load the document into your assistant's knowledge base with the same permissions your real restricted documents have. Use a test or staging system if you have one.

**3. Run the check.**

```bash
npx github:maryam-salawudeen/rag-canari run
```

Add `--format markdown --out report.md` for a report you can share, or `--format json` for other tools. When you're done, delete the canary document from your assistant.

The exit code says what happened, so you can run it in CI after each change to your assistant: `0` no leaks, `1` a leak was found, `2` the test couldn't run, `3` nothing could be tested.

## If it finds a leak

The fix is almost always the same: **filter by the user's permissions when searching, before the AI sees anything.** Most vector databases support this with metadata filters, namespaces or separate indexes per group. After that:

- Make sure the sources list and the answer come from the same filtered results.
- Don't rely on the AI's instructions for access control. Whoever can type a question can get around them.
- Run the checker again to confirm the fix.

This is LLM08 (Vector and Embedding Weaknesses) and LLM02 (Sensitive Information Disclosure) in the [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/).

## Limits

- **It only finds what it looks for.** It won't notice leaks of documents that have no canary. Plant one for each kind of restricted document and each permission group.
- **It asks each question once.** Assistants built on AI models can answer differently each time, so a pass is good evidence, not a guarantee. Run it more than once on important systems.
- **It tests one turn at a time.** Leaks that need a longer conversation aren't tested yet.
- **It needs test accounts.** You need a login for at least one allowed and one restricted user.

## Development

```bash
npm install
npm test
```

The tests start the practice assistant in each setting and check the results. `npm run build` compiles to `dist/`, which is committed so `npx github:…` works without a publish step.

If you try it, tell me what it found, or a question that got a document out that the checker didn't try, and I'll add it.

## Licence

MIT. Use it, change it, share it.
