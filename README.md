# rika-learn

**rika-learn is a fork of [LearnHarness](https://github.com/amosblomqvist/learnharness) made for [rika!](https://github.com/ZacharySF/kitty).** It keeps every LearnHarness feature (probe → teach sessions, practice, the knowledge graph) and adds **Learn anything**: tell it what you want to learn and it builds a roadmap of where to start, with a video and one or two readings at every stage.

It runs on its own like LearnHarness does, and it is also published as the `rika-learn` module that rika's module loader installs as the **Learn** view in the Study group.

## Fork and licence

- Upstream: LearnHarness by Amos Blomqvist, AGPL-3.0-only. The fork starts at upstream **v0.3.8** (commit `3dc8847`), and the full upstream history is kept in this repository.
- This fork is also **AGPL-3.0-only** ([LICENSE](LICENSE)). What changed, and when, is listed in [NOTICE](NOTICE) as AGPL §5 requires.
- Upstream's own README, with its screenshots and the description of the teaching method, is in the history at [`3dc8847:README.md`](https://github.com/ZacharySF/rika-learn/blob/3dc8847/README.md).

## Learn anything

1. **Ask.** Type what you want to learn and pick a depth:

   | Depth | How long it takes |
   |---|---|
   | Normal (default) | a couple of hours |
   | High | a few hours |
   | Super | a couple of weeks |
   | Ultra | a semester |
   | Ultraviolet | semesters to years |

2. **Answer up to three quick questions** so the roadmap starts at your level. You can skip them.
3. **Watch the roadmap stream in.** Stages appear in order, each with topics and what to learn first. Ultra and Ultraviolet are split into tracks: the first track is filled straight away, and the others fill when you open them.
4. **Use the resources.** Each stage shows one best video and one or two readings or exercises; **More** lists the rest, ranked. Every link comes from a real API answer: anything the model names that cannot be found is dropped, and no URL is ever made up.
5. **Switch views.** The timeline is the default. **Map** draws the same stages as a sky of stars, with a legend.
6. **Track progress.** Mark each topic Done, Learning or Skip. Send a stage to rika's Flashcards or schedule it in rika's Calendar.

Sources are toggles in **Settings → Learn**: Wikipedia, MIT Learn/OCW, freeCodeCamp, Open Library, official docs (robots.txt respected), YouTube (your own Data API key: one search per stage, a quota meter, no scraping, results expire after 30 days), arXiv, Semantic Scholar, Hacker News and GitHub awesome-lists, plus Brave Search if you add a key.

Model calls use your own provider keys through the LearnHarness provider layer. Learn uses one fast, cheap model by default (your **cheap** model slot; you can change it under Settings → Agent → Roadmap). Calls run automatically while you are under the daily spending limit you set on first use; anything over it shows a review sheet first.

How it works, the rika bridge and the module format: [docs/learn.md](docs/learn.md). Design notes: [docs/01-learn-design.md](docs/01-learn-design.md) and [research/07-learn-feature.md](research/07-learn-feature.md).

## Development

```bash
npm install
npm run dev          # http://localhost:3000, Learn is at /learn
npm test             # deterministic: no model calls, no network
npm run typecheck
npm run lint
scripts/package-module   # builds rika-learn-<version>.tar.gz + .sha256 for rika
```

The LearnHarness development guide still applies: [docs/development.md](docs/development.md), [docs/architecture.md](docs/architecture.md).
