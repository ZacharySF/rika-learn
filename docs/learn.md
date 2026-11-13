# Learn anything

How the rika-learn roadmap feature works: the flow, the code layout, the HTTP API, the rika bridge and the module package. Design decisions: [01-learn-design.md](01-learn-design.md). Research: [../research/07-learn-feature.md](../research/07-learn-feature.md).

## Flow

1. **Entry** (`/learn`): "What do you want to learn?" plus a five-step depth picker. Normal is the default.

   | Depth | Span | Stages | Topics | How it is built |
   |---|---|---|---|---|
   | Normal | a couple of hours | 3–5 | 8–15 | one streamed call writes stages and topics |
   | High | a few hours | 5–7 | 15–30 | one streamed call writes stages and topics |
   | Super | a couple of weeks | 7–10 | 40–80 | streamed stages, then every stage filled in parallel (4 at a time) |
   | Ultra | a semester | 12–16 in 3–4 tracks | 120–200 | streamed tracks and stages; the first track fills now, the rest when opened |
   | Ultraviolet | semesters to years | 20–48 in 4–8 tracks | 300–1,000 | as Ultra |

   The numbers live in `src/core/learn/depth.ts`.
2. **Priming**: one small model call writes up to three multiple-choice questions about the learner's starting point. The prompt reuses LearnHarness's prober doctrine (`src/agent/prompts/prober/10-probe-doctrine.md`: find the floor and the ceiling) cut down to three questions. Every question has a "Not sure" answer, and "Skip questions" goes straight to the build. The answers go into the build prompt; the build writes the level it settled on, which the roadmap shows.
3. **Build**: the skeleton call streams one JSON object per line (`{"roadmap":…}`, `{"track":…}`, `{"stage":…}`, `{"topic":…}`). Each line is validated on its own (`src/core/learn/roadmap.ts`); invalid lines are dropped. As soon as a stage line parses, that stage's resource search starts. The roadmap file is rewritten as lines arrive and a `learn-changed` event tells open windows to refetch, so stages appear one by one.
4. **Resources**: per stage, each enabled source is asked once (YouTube: exactly one `search.list` per stage, then one `videos.list`). Resources the model named (`canon`) are looked up against the sources; anything that cannot be found is dropped. Nothing the model writes is ever used as a link, except an official-docs URL that the docs adapter fetched successfully with robots.txt allowing it. Ranking and dedupe (`src/core/learn/rank.ts`) pick one best video and one (Normal) or two readings or exercises; the rest go under "More".
5. **Views**: the timeline is the default; **Map** draws the same stages as star clusters, one star per topic. Lines between stars mean "learn this first". The legend explains every star.
6. **Progress**: each topic is Done, Learning or Skip. "Send to Flashcards" and "Schedule in Calendar" build JSON payloads and hand them to rika (see [Bridge](#bridge-to-rika)).
7. **Cost**: see [Spending](#spending).

## Code layout

| Layer | Files | What |
|---|---|---|
| core (pure) | `src/core/learn/contracts.ts` | shapes: `Roadmap`, `Stage`, `Topic`, `Resource`, `LearnSettings`, … |
| | `src/core/learn/depth.ts` | depth sizing, sources per depth, eager vs lazy stages |
| | `src/core/learn/sources.ts` | the source catalogue the settings toggles show |
| | `src/core/learn/roadmap.ts` | NDJSON line reader, line validation, roadmap assembly, stage-fill validation |
| | `src/core/learn/rank.ts` | canonical URLs, dedupe, scoring, picks + More, canon matching |
| | `src/core/learn/priming.ts` | priming question validation and the answer flow |
| | `src/core/learn/cost.ts` | estimates per depth, today's spend, the auto/review decision |
| | `src/core/learn/bridge.ts` | Flashcards and Calendar payloads |
| | `src/core/learn/map-layout.ts` | star-map positions |
| agent | `src/agent/learn/` | prompts, the priming call, the build pipeline, stage fill |
| | `src/agent/learn/sources/` | one adapter per source, robots.txt, polite fetch, the source cache seam |
| store | `src/store/learn.ts` | `data/learn/`: roadmaps, settings, spend ledger, YouTube quota, source cache, bridge outbox |
| server | `src/server/learn.ts` | composition: engine from the provider layer, adapters, store; spend gate; build runner |
| shell | `app/learn/`, `app/api/learn/`, `components/learn/` | pages, routes, UI |

## HTTP API

All routes are under `/api/learn`. Bodies are JSON. Errors are `{ "error": "<plain sentence>" }` plus the status below.

| Method and path | Body | Success | Other answers |
|---|---|---|---|
| `GET /settings` | | `LearnSettingsView` | |
| `PUT /settings` | `Partial<LearnSettings>` | `LearnSettingsView` | 400 invalid |
| `GET /estimate?depth=normal&phase=build` | | `{ estimate: CostEstimate, decision: SpendDecision }` | |
| `POST /prime` | `{ topic, depth, approved? }` | `{ questions: PrimingQuestion[] }` | 409 `{ needs: "ceiling" }`, 402 `{ needs: "review", review: SpendReview }`, 503 `{ error, needs: "model" }` |
| `GET /roadmaps` | | `{ roadmaps: RoadmapSummary[] }` | |
| `POST /roadmaps` | `{ topic, depth, answers: PrimingAnswer[], approved? }` | 201 `{ id }` (the build keeps running) | 409, 402, 503 as above |
| `GET /roadmaps/:id` | | `{ roadmap: Roadmap }` | 404 |
| `DELETE /roadmaps/:id` | | `{ ok: true }` | 404 |
| `POST /roadmaps/:id/stages/:stageId/fill` | `{ approved? }` | 202 `{ ok: true }` | 409, 402, 503, 404 |
| `PUT /roadmaps/:id/topics/:topicId` | `{ state: TopicState }` | `{ roadmap }` | 400, 404 |
| `GET /roadmaps/:id/export?kind=flashcards&stage=:stageId` | | `BridgeMessage` | 400, 404 |
| `GET /roadmaps/:id/export?kind=calendar&stage=:stageId&date=YYYY-MM-DD&time=HH:MM&minutes=60` | | `BridgeMessage` | 400, 404 |
| `GET /bridge/outbox` | | `{ items: OutboxItem[] }` | |
| `POST /bridge/outbox` | `BridgeMessage` | 201 `{ id }` | 400 |
| `POST /bridge/outbox/ack` | `{ ids: string[] }` | `{ removed: number }` | |

`LearnSettingsView` is `{ settings: LearnSettings, sources: (SourceInfo & { enabled, available, reason? })[], model: { provider, id, name, fromSlot: boolean } | null, youtube: { used, limit, resetsAt }, spentTodayUsd, keys: { youtube: boolean, brave: boolean } }`.

The server pushes `learn-changed` `{ roadmapId }` on `/api/events` whenever a roadmap file changes (stage streamed in, stage filled, progress). Clients refetch `GET /roadmaps/:id`.

## Spending

- Learn calls the model through the LearnHarness provider layer (`piEngineForSpec`), with your own keys. The default model is your **cheap** model slot: one fast, cheap model for every Learn call. Settings → Learn can pin another model.
- Every call's real cost (from the provider's usage report) is appended to `data/learn/spend.jsonl`.
- Before a call, the server estimates its cost (`src/core/learn/cost.ts`: token budget per depth × the model's catalogue price) and decides:
  - no daily limit set yet → `409 needs: "ceiling"`; the UI asks for one (first run);
  - spent today + estimate ≤ limit → runs without asking;
  - otherwise → `402 needs: "review"`; the UI shows a review sheet (estimate, spent today, limit) and repeats the request with `approved: true` if you choose to go ahead.
- "Today" is your local calendar day.

## Sources

| Toggle | Adapter | Access | Notes |
|---|---|---|---|
| Wikipedia | `wikipedia.ts` | Action API search + REST summary | identifying User-Agent |
| MIT Learn / OpenCourseWare | `mitlearn.ts` | `api.learn.mit.edu` learning-resources search | courses and lecture videos |
| freeCodeCamp | `freecodecamp.ts` | `/news` sitemap, slug match | robots.txt checked |
| Open Library | `openlibrary.ts` | `search.json` | Super and deeper |
| Official docs | `docs.ts` | fetches a model-named docs URL | robots.txt checked first; kept only on a 2xx page |
| YouTube | `youtube.ts` | Data API v3 `search.list` + `videos.list`, your key | one search per stage, 100 searches a day meter, never scraped, no captions, cached results expire after 30 days |
| arXiv | `arxiv.ts` | `export.arxiv.org/api/query` | one request every 3 s |
| Semantic Scholar | `semanticscholar.ts` | Graph API paper search | |
| Hacker News | `hackernews.ts` | Algolia search API | |
| GitHub awesome-lists | `awesome.ts` | REST repository search | |
| Brave Search | `brave.ts` | Web Search API, your key | off by default; only fills gaps |

Every adapter takes its `fetch` as a parameter. Tests pass a fake; nothing in `npm test` touches the network.

## Bridge to rika

rika shows Learn in an iframe. Learn hands study material to rika in two ways; rika's side only has to implement one.

### postMessage (preferred)

Learn → rika (`window.parent.postMessage(message, parentOrigin)`; the parent origin comes from `document.referrer` when there is one):

```json
{ "source": "rika-learn", "version": 1, "id": "0f6c…", "type": "flashcards", "payload": { … } }
```

rika → Learn, within 2.5 s:

```json
{ "source": "rika", "version": 1, "type": "ack", "id": "0f6c…", "ok": true, "message": "Added 6 cards to Learn::Rust::Ownership" }
```

On load Learn also sends `{ "source": "rika-learn", "version": 1, "type": "hello" }`; a reply `{ "source": "rika", "version": 1, "type": "hello" }` makes the UI say "Connected to rika". Learn only accepts messages whose `event.source` is its parent window (and whose origin matches the referrer origin when known).

### HTTP outbox (fallback)

When no ack arrives, Learn stores the message in its outbox (`POST /api/learn/bridge/outbox`) and tells the learner it will be picked up. rika polls `GET /api/learn/bridge/outbox`, imports each item, then calls `POST /api/learn/bridge/outbox/ack` with the ids it imported. Outside rika, the same buttons offer "Download JSON".

### Payloads

`type: "flashcards"`:

```json
{
  "deck": "Learn::Rust::Ownership and borrowing",
  "tags": ["learn", "learn:rm_abc123"],
  "roadmap": { "id": "rm_abc123", "title": "Rust, from zero to ownership" },
  "stage": { "id": "s2", "title": "Ownership and borrowing" },
  "cards": [
    { "guid": "learn-9f2c41d0a7b3e655", "front": "Ownership rules: what should you be able to do?", "back": "Explain the three ownership rules and when a value is dropped.\n\nStage: Ownership and borrowing", "url": "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html" }
  ]
}
```

`guid` is stable for the same roadmap and topic, so sending a stage twice does not duplicate cards (rika checks the guid before inserting).

`type: "calendar"`:

```json
{
  "roadmap": { "id": "rm_abc123", "title": "Rust, from zero to ownership" },
  "stage": { "id": "s2", "title": "Ownership and borrowing" },
  "events": [
    {
      "source_key": "learn:rm_abc123:s2:1",
      "title": "Learn: Ownership and borrowing (1 of 2)",
      "date": "2026-11-14",
      "start": "18:00",
      "minutes": 60,
      "notes": "Topics: Ownership rules, Borrowing, Slices",
      "attachments": [{ "title": "The Rust Book: Understanding Ownership", "url": "https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html" }]
    }
  ]
}
```

`source_key` makes the import idempotent (rika's `create_event` already is on `source_key`). A stage's hours are split into sessions of the chosen length on consecutive days.

### Stub

`scripts/rika-bridge-stub.mjs` is a stand-in for rika's side: a page that iframes Learn, answers `hello`, acks every message and lists what it received, plus an outbox poller. Run it with `node scripts/rika-bridge-stub.mjs --app http://127.0.0.1:3000 --port 3999`.

## Running it offline (tests and screenshots)

`LH_LEARN_OFFLINE_DEMO=1 npm run dev` swaps the model for pi-ai's scripted faux provider and every source for a synthetic fixture network (`src/server/learn-offline.ts`). Nothing leaves the machine, and the whole flow (priming, streaming build, lazy fill, map, bridge) can be clicked through. The screenshots in `docs/screens/` were taken that way.

## rika module

`rika-module.json` describes the package for rika's module loader (api 1, kind `process`): rika starts `node server.js` from the package root with `LH_DATA_DIR={data}`, `PORT={port}`, `HOSTNAME=127.0.0.1`, waits for `GET /`, and shows the view `learn` ("Learn", Study group, first) as an iframe. `LH_START_VIEW=learn` makes `/` open Learn; the knowledge graph stays at `/?view=graph`.

`scripts/package-module` builds the standalone Next server and writes `dist/module/rika-learn-<version>.tar.gz` plus `rika-learn-<version>.tar.gz.sha256`. `.github/workflows/module-release.yml` runs the tests, packages, and attaches both files to the GitHub release for a `v*` tag.
