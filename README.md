# rag-canari

*Canari* is French for canary. Miners used to carry a canary into the mine, because it reacted to poisonous air before people did. rag-canari plants a "canary" document in your company's AI assistant and warns you if it reaches someone who shouldn't see it.

It's free, and it answers one question: **can people get documents out of your AI assistant that they aren't allowed to read?**

> **Only test systems you own or have written permission to test.** rag-canari asks questions designed to get around access rules. It won't run until you confirm permission in its settings file with `authorized: true`.

## Why I built it

Many companies now have an AI assistant that answers staff questions from the company's own documents: the handbook, policies, contracts, HR files. The name for this is **RAG** (retrieval-augmented generation). When you ask a question, the assistant first searches the company's documents for anything related, then writes its answer from what it found.

The danger is in that search. Imagine a librarian who fetches books for anyone who asks, including books from the locked staff room. If the assistant searches every document, whoever is asking, an intern's question can pull in the salary file, and the AI will use it in the answer.

I kept seeing teams try to fix this by telling the AI "don't reveal restricted documents". That doesn't work. Ask the question a different way, or ask for a translation, and the document comes out anyway.

I looked for a free tool that tests a company's own assistant for this, logged in as different people, and couldn't find one. The tools I found only test their own practice systems, or need a paid AI subscription. So I built one.

## How it works

Think of a marked banknote. If it turns up somewhere it shouldn't be, you know exactly where it came from.

1. **Plant a marked document.** rag-canari writes a fake but believable restricted document, like "2027 Salary Bands". It contains a unique code (such as `RCAN-7F3K-Q9WM-2HDX`) and a unique number that appear nowhere else. You add it to your assistant so only certain people, say HR, can read it.
2. **Check that HR can find it.** rag-canari asks as an HR user first. If even HR can't get the document, the test can't prove anything, so it says **inconclusive** instead of wrongly saying "all safe".
3. **Try to get it as everyone else.** It asks as each other user, in ten different ways: by the document's title, by its topic, pretending to be HR, telling the assistant to ignore its rules, asking for codes and numbers, asking for a translation, asking for a different format, asking for a hint, asking for a list of all documents, and asking for a summary of everything.
4. **Look for the mark.** If the unique code appears in an answer (even with spaces added or scrambled), or the document is listed as a source, that's proof of a leak. If the unique number appears, that's a strong sign of one.

It needs no AI of its own and no paid account, so it's free and gives the same result every time.

## Try it in 5 minutes

rag-canari comes with a small **practice assistant**: a pretend company chatbot with an intern login, an HR login and a secret salary file. You can watch rag-canari catch a leak without touching a real system.

You need [Node.js](https://nodejs.org) version 20 or later (the free program that runs rag-canari). Open a terminal, the window where you type commands, and run:

```bash
git clone https://github.com/maryam-salawudeen/rag-canari.git
cd rag-canari
npm install
```

That downloads rag-canari and the small libraries it uses. Now start the practice assistant in its leaky setting:

```bash
npm run demo -- --mode leaky
```

Leave that window open. In a second terminal window, inside the same `rag-canari` folder, run the test:

```bash
npm run check -- run --config examples/demo.yml
```

You'll see something like this:

```
🔴 2027 Salary Bands (salary-bands): LEAKED to intern (10 question(s) got it out)
    intern got it 10 way(s) out of 10:
      - Asked for the document by its title
      - Asked about the document's topic
      ...
    How we know: the canary's secret code appeared in the answer; the canary was listed as a source.
```

The intern got the salary file all ten ways. Now try the other settings. Stop the practice assistant with Ctrl+C, start it again with a different `--mode`, and run the test again. Each setting copies a real mistake companies make, or the fix:

| Setting | What the practice assistant does | Result |
|---|---|---|
| `leaky` | Searches every document, whoever asks | 🔴 Leaked |
| `hides-sources` | Uses the salary file in answers, but hides it from the list of sources | 🔴 Leaked |
| `guarded` | Refuses any question that names the salary file, like an AI told "don't reveal restricted documents" | 🔴 Leaked: asking by name is blocked, but 7 other questions still get it out |
| `safe` | Only searches documents the person asking is allowed to read | 🟢 Protected |

The `guarded` result is the main lesson: telling an AI to keep a secret doesn't keep it secret.

## Test your own assistant

Use a test copy of your assistant if you have one, sometimes called a staging system, rather than the one staff use every day.

**1. Create a settings file.** In a new folder, run:

```bash
npx github:maryam-salawudeen/rag-canari init
```

This creates `rag-canari.yml`, the settings file. Open it in any text editor and change three parts:

- **`target`**: how to reach your assistant. That's its web address, the shape of the message it expects, and where the answer is in its reply. Your developers will know these; `{{prompt}}` marks where each question goes.
- **`identities`**: at least two test logins, one allowed to read the canary document and one not. Each login has a **token**, a long password-like string the assistant uses to know who's asking. Don't paste tokens into the file. Write `${INTERN_TOKEN}` instead, and set the real value in your terminal (`export INTERN_TOKEN=...`), so tokens never end up saved or shared by accident.
- **`authorized: true`**: add this only once you're sure you're allowed to test this system.

Here's what the first two parts look like:

```yaml
target:
  url: https://assistant.example.ca/api/chat
  body: '{"message": {{prompt}}}'
  answer: answer             # where the answer is in the reply
  sources: sources[].title   # optional: where the list of sources is

identities:
  intern:
    headers: { Authorization: "Bearer ${INTERN_TOKEN}" }
  hr-manager:
    headers: { Authorization: "Bearer ${HR_TOKEN}" }
```

**2. Make a canary document.**

```bash
npx github:maryam-salawudeen/rag-canari plant --title "2027 Salary Bands" --topic "salary bands" --allowed hr-manager
```

This writes the document to `canaries/2027-salary-bands.md` and prints a few lines to copy into the `canaries:` part of your settings file. Then add the document to your assistant, with the same permissions as your real restricted documents (in this example, HR only).

**3. Run the test.**

```bash
npx github:maryam-salawudeen/rag-canari run
```

Add `--format markdown --out report.md` to save a report you can share with your team. When you're done, remove the canary document from your assistant.

**Running it from other tools:** when rag-canari finishes, it tells the computer how the test went with a number called an **exit code**: `0` no leaks, `1` a leak was found, `2` the test couldn't run, `3` nothing could be tested. Tools that test code automatically after every change (**CI**) read that number, so a leak can stop a risky change from going live. On GitHub, the Action below does this for you.

## Run it automatically on GitHub

rag-canari is also a GitHub Action: a ready-made tool GitHub can run for you automatically, for example every Monday morning, or each time your team updates the assistant. If a canary leaks, the check turns red and the report appears on the run's summary page. It's like a smoke alarm you test every week, instead of waiting for a fire.

Two things need to be true first:

- **GitHub's computers can reach your assistant.** The test runs on GitHub's computers, so your assistant (ideally a test copy) needs an address they can reach over the internet.
- **The test logins' tokens are saved as secrets.** In your repository, go to **Settings → Secrets and variables → Actions** and add each token, for example `INTERN_TOKEN` and `HR_TOKEN`. Secrets are hidden: they never appear in logs or in the settings file.

Put your `rag-canari.yml` settings file in the repository, then add `.github/workflows/rag-canari.yml`:

```yaml
name: RAG leak test

on:
  workflow_dispatch:        # adds a "Run workflow" button
  schedule:
    - cron: "0 13 * * 1"    # every Monday at 13:00 UTC

permissions:
  contents: read

jobs:
  canary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: maryam-salawudeen/rag-canari@v0
        env:
          INTERN_TOKEN: ${{ secrets.INTERN_TOKEN }}
          HR_TOKEN: ${{ secrets.HR_TOKEN }}
```

| Setting | Default | What it does |
|---|---|---|
| `config` | `rag-canari.yml` | Where your settings file is |
| `fail-on-leak` | `true` | Turn the check red when a canary leaks |
| `fail-on-inconclusive` | `true` | Turn the check red when nothing could be tested, because even an allowed user couldn't find the canary |
| `report` | `rag-canari-report.md` | Where to save the report |

The Action also tells later steps how many canaries leaked (`leaked`) and couldn't be tested (`inconclusive`), if you want to send an alert.

## If it finds a leak

The fix is almost always the same: **the search must check who's asking before it looks, so restricted documents never reach the AI at all.** Back to the librarian: they should check your staff card before going into the locked room, not fetch the book and then hope you don't read it.

For your developers, that usually means:

- Filter search results by the user's permissions inside the search itself. Most **vector databases** (the special databases AI assistants use to find related text) support this with metadata filters, namespaces or a separate index for each group.
- Make sure the list of sources and the answer come from the same filtered results.
- Don't rely on the AI's instructions for access control. Anyone who can type a question can get around them.
- Run rag-canari again to confirm the fix.

Security professionals call this LLM08 (Vector and Embedding Weaknesses) and LLM02 (Sensitive Information Disclosure) in the [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/), the standard list of the biggest security risks in AI applications.

## Limits

- **It only catches what you mark.** It can't see leaks of documents with no canary. Plant one canary for each kind of restricted document and each group of users.
- **It asks each question once.** AI assistants can give a different answer to the same question, so one clean run is good evidence, and several clean runs are better. Run it more than once on important systems.
- **It asks one question at a time.** Leaks that only happen over a longer back-and-forth conversation aren't tested yet.
- **It needs test logins.** You need at least one login that may read the canary and one that may not.

## Development

```bash
npm install
npm test
```

The tests start the practice assistant in each setting and check that rag-canari gets the right result every time. On GitHub, CI also runs the Action itself against the practice assistant. `npm run build` prepares the files in `dist/` and `action/index.cjs`, which are saved in the repository so the `npx github:…` commands and the Action work without an install step.

If you try it, tell me what it found, or a question that got a document out that rag-canari didn't try, and I'll add it.

## Licence

MIT. Use it, change it, share it.
