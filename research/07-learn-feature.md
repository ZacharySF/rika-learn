# 07 — Learn: "I want to learn X, where should I start?"

Researched 2026-11-13. This is stage 5 of the plan and, unlike the math module, a **public** feature of rika!. The user types a topic and picks a depth. rika quickly builds a staged roadmap showing where to start, attaches videos (YouTube, when enabled) and other enabled sources to each stage, and organizes it as a star-map-style graph that can be exported to Flashcards and Calendar. There are five depths: **Normal** (a couple of hours of material), **High** (a few hours), **Super** (a couple of weeks), **Ultra** (a semester) and **Ultraviolet** (semesters to years). Every source is an opt-in toggle. No fluff.

Evidence labels (same as 06):
- **[CODE]**: I read it in the worktree `~/projects/kitty-worktrees/quant-math-lab3` (origin/main at `c17d3ce`). Paths are relative to that root.
- **[VERIFIED]**: I loaded the primary page or API on 2026-11-13 and read the value myself.
- **[REPORTED]**: a secondary page or search summary I could not check against the primary source.
- **[INFERENCE]**: my judgement, with no direct source.

---

## 0. Bottom line

1. **Money is not the constraint; speed and the YouTube quota are.** Even a full Ultraviolet build costs under $0.40 on a flash-class model, and a Normal build costs about a quarter of a cent (§4.4). The YouTube Data API is different. Since **June 1 2026, `search.list` has its own bucket of 100 calls per day per project**, at 1 unit per call; every other method shares 10,000 units per day ([quota table](https://developers.google.com/youtube/v3/determine_quota_cost), [revision history](https://developers.google.com/youtube/v3/revision_history)) [VERIFIED]. The brief's "100 of 10,000 units per search" figure is out of date, but the practical ceiling is the same: **about 100 searches a day**. That means one search per stage, never one per node. `videos.list` costs 1 unit for up to 50 IDs, so durations, views and caption flags are almost free.
2. **Pipeline: skeleton → parallel per-stage search → rerank → assemble, streamed.** One LLM call streams the skeleton as **one JSON object per line**. The fetchers for a stage start as soon as its line has been parsed. One small rerank call per stage then matches candidate sources to nodes. Normal finishes in about 15–20 s, and the first stage appears within about 5 s (§4.2). Ultraviolet builds two levels eagerly and expands the rest only when the user opens it.
3. **The LLM names the canonical resources, and the APIs verify them.** The model proposes famous, specific resources ("3Blue1Brown: Essence of Linear Algebra", "MIT 18.06", "*The Rust Book*") along with search hints. rika resolves each one through an API and keeps only resources that exist. Generic search fills the gaps. This is more accurate than ranking raw search results, and it is how roadmap.sh's hand-curated nodes read anyway (§3).
4. **Default sources are keyless, documented APIs:**
   - On by default: Wikipedia, MIT Learn/OCW (its API returns OCW lecture videos *with YouTube IDs*, which costs no YouTube quota [VERIFIED]), Open Library, official docs (fetched through rika's robots-respecting `PublicPages`) and arXiv/Semantic Scholar.
   - YouTube is on whenever the user has added their own key. Brave web search reuses the existing `BRAVE` key. HN is opt-in.
   - Not offered: **Reddit** (new API access closed on Oct 31 2026 [REPORTED]) and **roadmap.sh content** (its license is personal use only; linking is allowed [VERIFIED]).
   - Keyless YouTube (yt-dlp, Invidious, Piped) and transcript scraping break YouTube's ToS ("automated means … scrapers" [VERIFIED](https://www.youtube.com/static?template=terms)). I recommend not shipping them (decision D2).
5. **Nearly all of the plumbing exists** [CODE]:
   - the OpenRouter streaming client with a spend ledger (`core/rika/llm.py`);
   - strict JSON-schema output (`core/triage/openrouter.py`);
   - a polite, cached, robots-aware fetcher (`core/discovery/http.py` + `public_pages.py`);
   - a keystore (add `YOUTUBE`);
   - the Rika tool registry;
   - a generic layered-DAG renderer (`math/TopicGraph.svelte`);
   - the math mastery state machine and acyclic-prerequisite trigger;
   - one-call exporters to Flashcards, Calendar, Study, Goals and Mind maps.

   The new parts are `web_learn.py`, `core/learn/*`, migration `056_learn.sql`, a `Learn` view in the Study group, and the source adapters.
6. **Prerequisite bug to fix first:** rika's model catalogue drops every model that has a non-zero `web_search` price (`web_ai.py:181`) [CODE]. OpenRouter now lists a web-search surcharge on Gemini, OpenAI and Anthropic models. Today **285 of 475 models pass, and none of them are Gemini, GPT-5 or Claude** [VERIFIED live `/api/v1/models`]. That includes Rika's own tier defaults (`router.py:24-31`: `gemini-2.5-flash`, `claude-haiku-4.5`, `gpt-5-mini`), which therefore raise `ModelUnavailable` from `llm.prepare` (`llm.py:94-96`). Models that do pass and fit this feature: `qwen/qwen3.8-flash` ($0.15/$0.47 per M tokens), `deepseek/deepseek-v3.2` ($0.26/$0.38) and `mistralai/mistral-small-3.2-24b-instruct` ($0.10/$0.30). See decision D6.

---

## 1. What rika already has (reuse map)

| Need | Existing code [CODE] | Reuse | Gap |
|---|---|---|---|
| A view in the Study group | `web/src/lib/workspace.ts:4-36` `navigation` (entry shape `{id, label, icon, module}`); Study group at `:69` (`views: ["study","math","learnharness","flashcards","notes","quick-notes","schema","documents"]`); atlas edges `navigationRelations` at `:105-147` (e.g. `["study","learnharness"]` at `:117`); lazy mount in `WorkspacePane.svelte:99-154` (`{:else if view === "learnharness"}` at `:107`) | Add `{id:"learn", label:"Learn", icon:"study", module:"workspace"}`, put it **first** in the Study group, add edges `learn↔study/flashcards/calendar/schema`, and add a lazy `Learn.svelte` branch. | None. |
| The LearnHarness section | `LearnHarness.svelte:1-82` is an iframe on `127.0.0.1:3210`. `web_learnharness.py:1-50` and `learnharness_runtime.py:12-95` start an external AGPL Node app with a scrubbed env. | **Nothing to reuse for data.** It stores nothing in rika's SQLite. Its only value is as a sidecar-process pattern. | Decide whether Learn sits beside it or replaces it in the group (D1). |
| Backend extension | `web_server.py:141-156` `EXTENSIONS` tuple (e.g. `("workspace","web_learnharness")` at `:150`), with `ROUTE_MODULES` at `:130-139`. Each extension provides `get(app,conn,path,query)` / `post(app,conn,path,body)` and returns `None` when the path is not its own; optional `start`/`stop`/`build_applied`. | `("workspace","web_learn")` | None. |
| Paid LLM calls, reviewed and with a ledger | `web_ai.py`: `PROMPTS` `:36-75`, `_spent` `:136` (daily sum of `ai_reviews`, counting `actual_usd` or else `reserved_usd`), `_review` `:262` (bound = bytes + 1024 in, `max_output_tokens` out), `REQUEST` effect `:331-333`, `_completion` `:336` (non-streaming, 90 s, `data_collection:'deny'`, `max_price`), and **batch reservation** `recovery_offer`/`reserve_recovery` `:366-420` (one ceiling for a multi-call batch). Tables are in `migrations/015_ai.sql`; `daily_budget_usd` defaults to `'1.00'`. | A build is a **batch**: reserve one ceiling for the whole depth plan, as `reserve_recovery` does, and settle each call against it. Add a `learn-roadmap` purpose. | `_review` caps input at 60 KB of text and serves one call per approval. A build needs 5–80 calls, so use the batch pattern. |
| Streaming LLM client | `core/rika/llm.py`: `prepare` `:80-115` (`stream:True`, `allow_fallbacks:False`, `require_parameters:True`), `fits_budget` `:118`, `reserve` `:123`, `settle`, `stream(call, on_token)` `:195` (parses SSE, assembles tool calls, never retries); prompt caching only for `anthropic/` and `google/gemini` (`_cacheable`). | **The engine for the skeleton call.** Its `on_token` callback feeds an incremental NDJSON parser, which dispatches each stage's fetches as soon as that stage parses. | `prepare` sends no `response_format`. Add an optional `response_format` argument for rerank calls. |
| Strict JSON output | `core/triage/openrouter.py:56-77`: `response_format: {type:"json_schema", json_schema:{name, strict:True, schema}}`, plus a validator `_answer_text` `:115-133` that requires `finish_reason=="stop"` and checks field types. | Copy for rerank and stage expansion (small, non-streamed, schema-validated). | None. |
| Tier router | `core/rika/router.py:24-31` `DEFAULTS`; `route()` already sends "roadmap" to `standard` (`:37-38`). | Learn uses the **fast** tier for every call at every depth [INFERENCE: the job is listing and naming, not reasoning]. | The defaults are currently filtered out (§0.6). |
| Ask Rika tools | `core/rika/tools.py:54` `Tool(name, description, parameters, effect, run, undo, module, describe)`; `registry()` `:143`. `effect="outward"` with `describe=` puts an approval card in the Rika bar. The loop is `core/rika/loop.py` (`MAX_STEPS=8`, `APPROVAL_TIMEOUT=600`). A result can navigate via `client={"type":"navigate","view":…}`. | New `core/rika/learn_tools.py`, registered in `registry()`: `build_learning_roadmap(topic, depth, sources?)` (outward; the card shows the cost ceiling and YouTube searches), `expand_stage`, `export_roadmap`. | Add `"learn"` to `VIEWS` in `workspace_tools.py:24-28`. |
| Web fetch / scrape | `core/discovery/http.py`: `PoliteHttp(cache_dir, min_interval, cache_ttl_minutes)` `:39`; `USER_AGENT` `:26`; timeout 30 s; per-host minimum interval; on-disk cache keyed by `sha256(method,url,body)`; a 429 raises `RateLimited` without retrying. `core/discovery/public_pages.py`: `_Robots` `:102` (longest-match, `Crawl-delay` honoured, refuses over 60 s); `PublicPages` `:163` (blocks private IPs, pins the IP, caps size at 2 MB, checks robots on every redirect hop, skips a host after a 429); `brave_json` `:307` (fixed-endpoint credentialed call). Brave adapter in `core/discovery/websearch.py:1-140`. Usage template: `web_jobs.py:196-213`. | **Use as is.** Each source gets its own `PoliteHttp` (its own interval and TTL). Keyed APIs (YouTube, S2) get a fixed-endpoint sibling of `brave_json`. Dead-link checks go through `PublicPages`. | `USER_AGENT` says "personal job-search tool" and has no contact URL. Wikimedia and Open Library want an app name plus a contact (§2). Add a Learn UA: `rika/<ver> (+https://github.com/ZacharySF/kitty; learn)`. The fetcher is sequential with no asyncio, so parallelise with a small thread pool, one worker per host. |
| API keys | `core/keys.py:64-69` `KNOWN` (`OPENROUTER`, `ANTHROPIC`, `USAJOBS`, `BRAVE`); read order keyring → `.private/keys` → env; `web_keys.py`; `Keys.svelte` is driven by the backend list. | Add `KeySpec("YOUTUBE","YouTube Data API key","YOUTUBE_API_KEY")` and optionally `KeySpec("S2","Semantic Scholar API key","S2_API_KEY")`. Update the `cli.py` help text. | None. |
| Opt-in source toggles | Build-file settings: `core/builds/kitty-build.schema.json:34-110` (`settings.*`, `additionalProperties:false`, e.g. `opportunities.monitoring` boolean default false); projected to SQLite by `core/builds/project.py:63-125` and edited via `project.editing` `:187-215`. | New `settings.learn` with `{sources:{youtube,wikipedia,courses,books,papers,docs,web,community}, default_depth, language, auto_approve_usd}`, projected to a `learn_settings` row. | Needs a schema entry, `settings_from_rows`/`apply` code and the migration. |
| Background work + live progress | `web_tasks.py` `TaskRunner`: `app.tasks.start(kind, work)`, one task per kind at a time, polled (`TaskStatus.svelte` every 1.5 s, result only). `web_live.py` `app.live.broadcast(dict)` reaches every window. The Rika hub `/api/rika/stream` carries `token/action/approval/plan/navigate`. | Run the build as `app.tasks.start('learn-build:<id>', work)` (the per-roadmap kind lets builds run in parallel) with its own `connect(db_path)`. Push `{"type":"learn.progress", roadmap, stage, node?, phase}` via `app.live.broadcast`. The UI rebuilds from DB rows on reconnect. | The live client needs a handler for `learn.*`. TaskRunner has no progress field, which `learn_builds` (§5) covers. |
| Star-map rendering | `web/src/lib/math/graph.ts`: `Topic{id,strand,title,prereqs,state,progress?,due_at?,why?}` `:7`, `layoutGraph` `:89` (longest-path layers, barycentre order, throws on a cycle, wraps wide layers at `PER_ROW=4`), `strandView` `:48`, `upNext` `:79`. `math/TopicGraph.svelte:10` props `{topics, selected, outside?, onselect}`. `TopicDetail.svelte` (Needs/Unlocks panel). Design lab (not shipped): `web/src/quantlab3/sky/layouts.ts` (`force()` seeded FR, `columns()`, `placeLabels()` collision-avoiding), `milestones/StageMap.svelte` (region panels, depth columns, "mastered of n · hours"). | **Feed TopicGraph unchanged**: map `strand = stage id`, `state = node state`. Use `strandView` to show one stage at a time plus faint outside prerequisites, which keeps Ultra and Ultraviolet readable. Port `StageMap`'s region panels (props instead of module-global `graph.json`) for the overview. | `STRANDS` label table is hard-coded for math; `strandLabel` falls back to the id, so pass stage titles in. The lab layouts close over `TOPICS`, so they need a `(nodes, edges) → pos` refactor. |
| Progress / mastery | `migrations/044_math.sql`: `math_prereqs` with **acyclicity triggers** (`WITH RECURSIVE … RAISE(ABORT,'math prerequisite cycle')`); `core/math/mastery.py` state machine locked → ready → learning → mastered; `states()` returns exactly the TopicGraph shape. Study `RETURN_LADDER=(1,3,7,16,35)` in `core/study.py:24`. | Copy the trigger for `learn_edges`. Reuse the state rule (ready when all prerequisites are done or skipped). Use "marked done / skipped" in place of "3 correct in a row". | Mastery by quiz is a later option (D9). |
| Export: Flashcards | `web_flashcards.py:83-122`; `core/flashcards.py:89 save_deck` (`"Parent::Child"` creates ancestors), `save_note` `:178-202` (fields must match the type; `guid` UNIQUE, no upsert). Existing Rika helper `_add_card` `workspace_tools.py:406`. The AI flashcard prompt in `web_ai.PROMPTS` requires `source_quote`. | Deck `Learn::<Topic>::<Stage>`, tag `learn:<roadmap_id>`, deterministic `guid = sha1(roadmap,node,front)`. Check for an existing guid before inserting. | None. |
| Export: Calendar | `core/calendar.py:24-28` `EVENT_FIELDS` (incl. `attachments` ≤25 `{title,url}`, `source_key`, `subject_id`); `create_event` `:333-342` is **idempotent on `source_key`**. Precedent: `study/PlansView.svelte:93-99` `exportBlock` with `source_key:"study-plan:<id>"`. `study.generate_plan` `core/study.py:650` spreads minutes over days. | `source_key = "learn:<roadmap>:<stage|node>"`. A stage's sources go into `attachments`. Scheduling reuses the generate-plan idea (hours per week + start date). | None. |
| Export: Study / Goals / Mind map / Notes | `study.save_entity` `core/study.py:444-475` (subjects, tasks with `checklist`); `math/focus.ts:22-40` auto-creates a Study subject; `goals.create`/`link` (`core/goals.py:348,390`; `LINK_KINDS` `:35-50`, CHECK constraint in `049_rika_goals.sql`); `schema_maps.create` with a portable `{format:"kitty-schema",version:1,graph:{nodes,edges}}` (limits `MAX_NODES=300`, `MAX_EDGES=600`); `POST /api/notes/pages`. | Roadmap → Study subject. Stage → `study_task` with the nodes as its checklist. "Learn X" → goal with a "stages done" measure. Stage graph → mind map (`topic` nodes with `url`, `tree` edges). | A goal link kind `learn_roadmap` needs a migration (CHECK list) plus entries in `LINK_KINDS`/`VIEWS`/`LABELS`. Ultraviolet maps over 300 nodes must be exported per track. |
| Brain-dump approve-ticked-items UI | `rika_plans` + `RikaPlan.svelte` (from the loop's `decide_plan`) | The pattern for "choose which stages to export". | None. |
| Things that do not exist | No YouTube, transcript, Wikipedia, arXiv, yt-dlp or Invidious code anywhere in `src/` or `web/src/` [CODE, searched]. | None. | All source adapters are new. |

---

## 2. Sources

### 2.1 Source table

| Source | Access | Auth | Rate limit / quota | ToS / robots constraints | Good for |
|---|---|---|---|---|---|
| **YouTube Data API v3** | `search.list` (`q`, `type=video\|playlist`, `videoDuration=short\|medium\|long`, `videoCaption`, `videoEmbeddable`, `relevanceLanguage`, `publishedAfter`, `order`, `maxResults ≤ 50`) → `videos.list?part=snippet,contentDetails,statistics,status&id=…` (≤ 50 IDs) → optional `channels.list` | **API key** (public data needs no OAuth) | **Since 2026-06-01, `search.list` has its own bucket of 100 calls/day, at 1 unit per call**; `videos.list`/`channels.list`/`playlistItems.list` cost 1 unit each against **10,000 units/day**; `captions.list` costs 50; the quota resets at midnight Pacific ([quota](https://developers.google.com/youtube/v3/determine_quota_cost), [revisions](https://developers.google.com/youtube/v3/revision_history)) [VERIFIED] | [Developer policies](https://developers.google.com/youtube/terms/developer-policies) [VERIFIED]: unauthorized API data may be stored ≤ **30 days**, then refreshed or deleted (III.E.4); no "new or derived data or metrics" from API data (III.E.4.h); **no scraping** of YouTube (III.E.6); no caching of audiovisual content. `captions.download` needs edit permission on the video ([docs](https://developers.google.com/youtube/v3/docs/captions/download)) [VERIFIED], so **third-party transcripts are not available officially**. | Videos and playlists per stage: duration, views, recency, the caption-exists flag, chapters in the description, embeddability. |
| yt-dlp | `yt-dlp "ytsearch25:<q>" --flat-playlist -J` (metadata, no download) [INFERENCE: flag behaviour]; can also fetch auto-captions | none | YouTube throttles and blocks by IP. Full YouTube support now needs `yt-dlp-ejs` plus a JS runtime (Deno/Node/Bun/QuickJS) ([README](https://github.com/yt-dlp/yt-dlp/blob/master/README.md), [#15012](https://github.com/yt-dlp/yt-dlp/issues/15012)) [VERIFIED] | Violates YouTube ToS: no access "using any automated means (such as robots, botnets or scrapers)" except public search engines or with written permission ([ToS](https://www.youtube.com/static?template=terms)) [VERIFIED]. Breaks often. | Keyless fallback and transcripts. **Not recommended** for a public app. |
| Invidious | `/api/v1/search?q=&type=video`, `/api/v1/videos/:id`, `/api/v1/captions/:id` on a public or self-hosted instance ([instances](https://api.invidious.io/)) | none | Depends on the instance; public instances are "rate-limit roulette" [REPORTED](https://sumguy.com/invidious-piped-redlib-nitter-2026/) | YouTube sent Invidious a cease-and-desist in 2023 ([Vice](https://www.vice.com/en/article/youtube-tells-open-source-privacy-software-invidious-to-shut-down)). The transcript endpoint was broken in Dec 2025 ([#5571](https://github.com/iv-org/invidious/issues/5571)) [REPORTED]. It is still scraping YouTube at one remove. | At most, a user-supplied self-hosted URL. |
| Piped | `/search`, `/streams/:id` | none | Most public instances are dead ("Is Piped dead? Answer: yes", [#4257](https://github.com/TeamPiped/Piped/issues/4257), ~Aug 2026) [REPORTED] | Same as Invidious. | **Do not build on it.** |
| youtube-transcript-api (Python) | Unofficial InnerTube/timedtext scrape | none | Blocked from cloud IPs ([#511](https://github.com/jdepoix/youtube-transcript-api/issues/511)); a desktop app runs on a residential IP, so it usually works [INFERENCE] | Scraping, so against the ToS. | Transcript relevance. **Off and unshipped** (D3). |
| **Wikipedia (Wikimedia APIs)** | REST `GET /api/rest_v1/page/summary/{title}`; Action API `action=query&prop=links\|categories\|extracts`, `list=search` | none (OAuth optional) | **New in 2026** ([rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits)) [VERIFIED]: 10 req/min unidentified; **200 req/min with a compliant User-Agent (contact URL or email)**; ≤ 3 concurrent requests; honour `Retry-After`, else wait ≥ 5 s | [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy). Content is CC BY-SA 4.0, so show attribution if text is excerpted. | Grounding the skeleton (definitions, "see also" / prerequisite hints) and a 1-paragraph "what is it" per stage. Always cheap. |
| **MIT OCW via the MIT Learn API** | `GET https://api.learn.mit.edu/api/v1/learning_resources_search/?q=&offered_by=ocw&limit=` returns courses plus `content_files` (lecture videos carry the **YouTube ID** in `readable_id`, e.g. 18.06SC "Geometry of Linear Algebra" → `My5w4MXWBew`) | none | Undocumented [INFERENCE]. Use 1 req/s. | `ocw.mit.edu/robots.txt` is `Allow: /` [VERIFIED]. OCW content is CC BY-NC-SA, so link it, do not copy it. | Ultra/Ultraviolet backbone courses; lecture videos that **cost no YouTube search quota** (resolve details with `videos.list` at 1 unit per 50). |
| Khan Academy | Public API removed in 2020 ([notice](https://support.khanacademy.org/hc/en-us/community/posts/360055082872-API-removal-notice)); the site serves a bot "Client Challenge" to non-browsers [VERIFIED: `robots.txt` returned the challenge page] | none | None usable | No API, and anti-bot. Link only. | School-level math and science. Resolve through Brave (`site:khanacademy.org`) or LLM proposals. Link checks report "unverified", not "dead". |
| freeCodeCamp | News articles via the sitemap (`/news/sitemap.xml`) or Brave `site:freecodecamp.org/news`; courses mostly on the YouTube channel; curriculum on GitHub | none | `PublicPages` pacing (2 s/host) | `robots.txt`: `Allow: /` [VERIFIED] | Programming and web dev: long full-course videos (on YouTube) and tutorials. |
| **arXiv API** | `GET http://export.arxiv.org/api/query?search_query=&max_results=` (Atom) | none | **≤ 1 request per 3 s, one connection at a time** ([ToU](https://info.arxiv.org/help/api/tou.html)) [VERIFIED] | Metadata reuse is allowed; link to the abstract pages. | Super and above for research-flavoured topics: "survey", "tutorial" and "review" papers. Never on the Normal critical path because of the 3 s pacing. |
| **Semantic Scholar API** | `/graph/v1/paper/search?query=&fields=title,year,citationCount,influentialCitationCount,openAccessPdf,tldr` | Optional key (`x-api-key`) | Without a key: 1,000 req/s **shared by all unauthenticated users** ([S2 API](https://www.semanticscholar.org/product/api)) [REPORTED via search snippet]. With a key the introductory rate is 1 RPS [REPORTED]. | API license terms; attribute. | Ranking papers by `influentialCitationCount`; finding the canonical survey; `tldr` for a one-line "why". |
| Official docs sites | Model-proposed URL (e.g. `doc.rust-lang.org/book`) → `PublicPages.fetch` (robots checked); optional `/llms.txt` ([llmstxt.org](https://llmstxt.org/)) | none | Per-host interval, `Crawl-delay` honoured | robots.txt checked on every hop [CODE] | The **primary** resource for any tool or language topic; usually the best "start here". |
| GitHub awesome-lists | Repo search `awesome <topic>` via REST, then the README via `raw.githubusercontent.com` | Optional token | REST **60 req/h unauthenticated, 5,000 req/h with a token** ([docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)) [VERIFIED]; search has its own lower limit | Licenses vary per list. **Mine links, do not copy the prose.** | Candidate link pool for Super and above; repos to practise on. |
| **Open Library** | `GET https://openlibrary.org/search.json?q=&fields=key,title,author_name,first_publish_year,edition_count` | none | **1 req/s by default, 3 req/s with a User-Agent that includes app name and contact email** ([API](https://openlibrary.org/developers/api)) [VERIFIED]. "Not intended as a data backend for third-party services", and no HTML scraping | Use for lookups only; never bulk | Textbooks for Super and above: verify the title, author and edition the LLM names; link the borrow page. |
| roadmap.sh | `github.com/nilbuild/developer-roadmap`, `roadmaps/<slug>/content/<topic>@<id>.md` (a description plus typed links `[@official@…]`, `[@article@…]`, `[@video@…]`) [VERIFIED sample] | none | GitHub limits | **License: personal use only. Content may not be taken out of the repository or republished; sharing links is allowed** ([license](https://raw.githubusercontent.com/nilbuild/developer-roadmap/master/license)) [VERIFIED] | **Link only:** when the topic matches one of its ~90 roadmap slugs, show "community roadmap: roadmap.sh/<slug>". Never ingest. |
| Reddit | OAuth Data API | OAuth app with Reddit's approval | 100 QPM per client ID | Approval required for new clients since 2025-11-11 ([Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564)). **New requests closed 2026-10-31; public access ends March 2027; RSS ends 2026-11-13** ([Data365 summary](https://data365.co/blog/reddit-api-pricing), [Decrypt](https://decrypt.co/379892/reddit-killing-rss-feeds-and-public-api-access-to-fight-ai-scrapers)) [REPORTED] | **Not offered.** |
| **HN Algolia** | `GET https://hn.algolia.com/api/v1/search?query=learn%20X&tags=story` [VERIFIED working] | none | 10,000 req/h per IP; at most 1,000 hits per query ([API page](https://hn.algolia.com/api), via [datatooly](https://datatooly.xyz/guides/hacker-news-algolia-api-reference)) [REPORTED] | Public API | "Ask HN: how do I learn X" threads, as a **link pool** for programming and startup topics. Off by default. |
| Brave Search API | `core/discovery/websearch.py` with `site:` filters [CODE] | Existing `BRAVE` key | $5 per 1,000 requests, with monthly free credits ([pricing](https://brave.com/search/api/)) [VERIFIED page] | API terms | Gap filler: Khan Academy, freeCodeCamp, university pages, docs the LLM did not know. Note that each query costs more than the whole Normal LLM bill. |

### 2.2 YouTube specifics

- **One `search.list` per stage, `maxResults=25`.** Build `q` from the stage's LLM-written query, not from node titles. Set `type=video`, `videoEmbeddable=true`, `safeSearch=moderate`, `relevanceLanguage=<ui lang>`, and pick `videoDuration` per depth: `medium` (4–20 min) for Normal and High, `any` above. Then make **one `videos.list` call per 50 candidate IDs** to get `contentDetails.duration`, `contentDetails.caption`, `statistics.viewCount/likeCount`, `snippet.publishedAt/channelId/description/defaultAudioLanguage` and `status.embeddable/privacyStatus`.
- **Courses:** from Super up, add 1–3 `type=playlist` searches per roadmap and `playlistItems.list` (1 unit) for the length.
- **Searches per build:** Normal 4, High 6, Super 11, Ultra 17, Ultraviolet 10 eager plus 1 per expanded stage (§4.4). With a personal key that allows about 25 Normal builds or 6 Ultra builds a day.
- **Key policy:** the key must be **the user's own (BYOK)**. A shared key baked into the public app would pool all users into 100 searches a day [INFERENCE].
- **Searches the LLM avoids:** canonical resources it names are first looked up in the MIT Learn result set (it carries YouTube IDs) and the local source cache. Search runs only on a miss.
- **Policy-safe storage:** store the video ID, title, channel, duration, `fetched_at` and our own fit note. Refresh (`videos.list` at 1 unit per 50 IDs) any row older than 30 days when the roadmap opens. The refresh doubles as the dead-video check, since deleted or private videos drop out.
- **Do not display a computed "quality score".** View and like counts appear exactly as returned. Our ordering is a private ranking decision, and the reason shown is a short text, not a metric [INFERENCE on III.E.4.h; see D2].
- **Playback:** embed with `youtube-nocookie.com/embed/<id>?start=<s>`. Chapters parsed from the description (`00:00 Title` lines) give deep links per node at no quota cost.

### 2.3 Transcripts for ranking

There is no official route: `captions.download` requires edit rights [VERIFIED]. The unofficial routes scrape YouTube. Use these signals instead, all available within the ToS:
- **chapters** from the description;
- the **description text**;
- `contentDetails.caption` (captions exist);
- the title, matched against the node's objective terms.

If the user opts in later (D3), use transcripts only to **verify the top 1–2 picks per stage** after the roadmap is already on screen. Never put them on the critical path.

### 2.4 Source toggles to offer

| Toggle (UI label) | Backed by | Default | Notes |
|---|---|---|---|
| **Videos (YouTube)** | YouTube Data API (BYOK) | On when the `YOUTUBE` key exists; otherwise off, with an "Add key" link | Shows "searches left today ≈ N" |
| **Reference** | Wikipedia | On | Keyless; grounds the skeleton |
| **Courses** | MIT Learn/OCW API, plus Khan Academy and freeCodeCamp through proposals and Brave | On | MIT lecture videos appear even with YouTube off (as links) |
| **Books** | Open Library | On for Super and above | Verify-only |
| **Papers** | arXiv + Semantic Scholar | Auto for Super and above when the skeleton flags the topic as `research` | arXiv is serial and runs in the background |
| **Docs & repos** | Official docs through `PublicPages`, plus GitHub awesome-lists | On | robots-respecting |
| **Web search** | Brave (existing key) | Off; enable when the `BRAVE` key exists | Paid per query |
| **Community** | HN Algolia | Off | Link pool only |
| Not offered | Reddit (closed), roadmap.sh ingestion (license), Piped (dead), yt-dlp/Invidious (ToS) | — | roadmap.sh can appear as a single outbound link |

---

## 3. Prior art

| Product | Structure | Resources per step | What is fast / slow | Take for rika |
|---|---|---|---|---|
| **roadmap.sh** | Hand-curated node graph (sections → topics), ~90 roadmaps ([readme](https://github.com/nilbuild/developer-roadmap/blob/master/readme.md)). Each topic node is one markdown file: a 1–3 sentence description plus **typed links** (`@official`, `@article`, `@video`) [VERIFIED sample `python/aiohttp`]. Per-node progress (done / in progress / skip) [INFERENCE from the UI]. The "AI Tutor" ([roadmap.sh/ai](https://roadmap.sh/ai)) generates a course, guide, roadmap or quiz for any topic [REPORTED]. | 2–6 typed links per node | Curated roadmaps are instant (static). AI ones are generated on demand. | Node = short description + 2–4 **typed** resources. `skip` is a first-class state. Show a link out when a curated roadmap exists. |
| **Google Learn About** | Conversational; "learning cards" such as *common misconceptions*, *stop and think* and *test your knowledge*, plus images and videos; highlight a phrase for "What is this?" ([help](https://support.google.com/websearch/answer/15662709?hl=en)) [VERIFIED] | Inline images and videos per answer | Per-turn generation; no persistent plan | Per-node "common misconception" and "check yourself" lines, **optional**, kept to one line each. |
| **NotebookLM** | Source-grounded notebook. *Discover sources* pulls web sources into a notebook ([blog](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-discover-sources)); Studio has a study guide, mind map, timeline, flashcards and quizzes ([flashcards](https://support.google.com/notebooklm/answer/16958963?hl=en)), and Video Overviews ([blog](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-video-overviews-studio-upgrades)) | Up to ~10 discovered sources [INFERENCE] | Source discovery and text artifacts take seconds. Audio and Video Overviews take minutes [INFERENCE]. | Ground the skeleton in fetched reference text (Wikipedia/MIT) rather than the model alone. Flashcards come from sources, which rika's `source_quote` rule already enforces. |
| **ChatGPT study mode** | System-prompt mode: Socratic questions, scaffolded steps, knowledge checks; no stored roadmap ([OpenAI](https://openai.com/index/chatgpt-study-mode), [Ars](https://arstechnica.com/ai/2025/07/chatgpts-new-study-mode-is-designed-to-help-you-learn-not-just-give-answers)) | None by default | Per-turn | Not a roadmap. Matches rika's Ask Rika plus the Study guide. Do not duplicate it. |
| **Gemini Guided Learning** | Step-by-step walkthroughs that **automatically embed diagrams and YouTube videos** in answers; quizzes, flashcards and study guides ([Workspace update](https://workspaceupdates.googleblog.com/2025/08/gemini-study-tools.html), [blog](https://blog.google/outreach-initiatives/education/guided-learning)) [VERIFIED] | 1–2 videos inline | Per-turn; fast | Users already expect a relevant YouTube video next to each step. rika makes that persistent and ordered. |
| **Perplexity Learn mode** | Guided, step-by-step answers; adapts to level by asking a few questions; inline flashcards, MCQ and free-response; "progress tracking" through mini-quizzes ([help](https://www.perplexity.ai/help-center/en/articles/12120542-what-is-learn-mode)) [VERIFIED] | Cited web sources | Search-speed (seconds). Deep Research takes minutes. | Ask **at most one** calibration question (current level), or infer it from the prompt. |
| **Coursera / edX paths** | Program → courses → modules → video, reading and quiz items, with time estimates ("N months at H h/week"); Coursera Coach AI on top ([Coursera blog](https://blog.coursera.org/announcing-ai-powered-capabilities-enabling-educators-to-use-coursera-coach-to-deliver-interactive-personalized-instruction)) | Many first-party items | Static catalogue (instant); the paths are human-authored | The **Ultra/Ultraviolet hierarchy** (track → course/stage → unit → node) and **hours per week** as the scheduling input. |
| **Khanmigo** | AI tutor on top of Khan's course → unit → lesson → skill structure with mastery levels [INFERENCE: structure from the product]; coaches rather than giving answers ([NBER w35620](https://www.nber.org/system/files/working_papers/w35620/w35620.pdf), [Khan blog](https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings)) | First-party exercises | Instant: the structure is pre-built | Mastery-based states fit the existing math state machine (D9). |

**Pattern** [INFERENCE]: every fast product either has a **pre-built graph** (roadmap.sh, Coursera, Khan) or generates **one turn at a time** (ChatGPT, Gemini, Perplexity). The slow products are the ones that do research or synthesis over many sources (Deep Research, NotebookLM overviews). rika's trick is to generate a **small graph in one streamed call** (it reads like a pre-built graph within seconds) and to attach sources **per stage in parallel**, so nothing waits on all of the research.

---

## 4. Fast pipeline

### 4.1 Depth levels: size, effort and latency

Hours are total learner time. Stages are the coloured "strands"; nodes are the stars.

| Depth | Learner time | Levels | Stages | Nodes | Resources | Extra per stage | Target: first stage visible / complete |
|---|---|---|---|---|---|---|---|
| **Normal** | ~2 h (1.5–3) | stage → node | 3–5 | 8–15 | 1 primary per node (≤ 1 video per node; total video ≤ 60% of hours) | — | ≤ 5 s / **≤ 20 s** (hard cap 30 s) |
| **High** | ~5 h (3–8) | stage → node | 5–7 | 15–30 | 1 primary + 1 alternative | 1 "check yourself" item | ≤ 5 s / ≤ 45 s |
| **Super** | ~2 weeks ≈ 20–40 h | stage → node | 7–10 | 40–80 | 2–3 per node, including docs/book | 1 practice project, 1 book chapter | ≤ 8 s / ≤ 90 s |
| **Ultra** | 1 semester ≈ 15 wk × 8–10 h ≈ 120–150 h | stage (≈ week/unit) → node | 12–16 | 120–200 | Course-level primary (an OCW course or playlist) + 1–2 per node | checkpoint/mini-exam, papers if `research` | ≤ 10 s / ≤ 3 min, streaming |
| **Ultraviolet** | semesters to years ≈ 300–1,500 h | track → stage → node | 4–8 tracks × 5–8 = 20–48 stages | 300–1,000 (**lazy**) | Per track: 1 backbone course + books. Per node: as Ultra, filled on expansion | capstone per track | Tracks and stages ≤ 15 s. Eager first track ≤ 3 min. Each further stage expands in ≤ 20 s **when opened**. "Expand all" runs in the background (~10–20 min). |

The fetch strategy also scales with depth:
- Normal and High: Wikipedia, MIT, docs and YouTube only.
- Super adds books, awesome-lists and playlists.
- Ultra adds papers and checkpoints.
- Ultraviolet adds tracks, capstones and lazy expansion.

### 4.2 Call plan

```
user: topic + depth + toggles
  │
  ├─0  cache lookup  (normalized topic, depth, level, lang, prompt_ver)     ~0 ms
  ├─1  grounding (parallel, ≤ 1.5 s budget, optional):
  │      Wikipedia search+summary (1–2 calls) · MIT Learn search (1 call)
  │      → ≤ 1.5k tokens of context; anything late is dropped
  ├─2  SKELETON — one streamed LLM call, NDJSON, fast tier
  │      line 1: {"roadmap":{title, level, volatility: evergreen|fast, research: bool, hours}}
  │      then per stage: {"stage":{id, title, why, hours, query, canon:[{kind,title,by,hint}]}}
  │      then per node:  {"node":{id, stage, title, objective, minutes, prereqs:[ids], kind}}
  │      (stages are emitted before their nodes, so stage fetches start early)
  │      Super+: this call emits stages only; step 2b expands each stage in parallel
  │        (one strict-JSON call per stage, ≤ 4 concurrent)
  ├─3  PER-STAGE FETCH (starts the moment a stage line parses; thread pool, 1 worker/host)
  │      resolve `canon` items first (MIT result set, local source cache, Open Library, docs URL)
  │      YouTube: 1 search.list (25) → 1 videos.list per 50 IDs
  │      other enabled sources: 1 query each, ≤ 2 s timeout per source
  ├─4  PRE-RANK (deterministic, local, < 5 ms per stage) → top 8 videos + top 6 others
  ├─5  RERANK + ASSIGN — one strict-JSON LLM call per stage (parallel, ≤ 4 concurrent)
  │      in: stage nodes + ≤ 14 candidates (id, title, channel, duration, year, 200-char desc, chapters)
  │      out: {node_id: [{cand_id, role: primary|alt|deep|practice, reason ≤ 12 words, start_s?}]}
  ├─6  ASSEMBLE: validate DAG (acyclic trigger), dedupe, write rows, broadcast learn.progress
  └─7  BACKGROUND (after "ready"): link checks, arXiv (3 s pacing), playlist lengths,
       optional transcript verification (D3)
```

**Why NDJSON rather than a strict schema for the skeleton:** the skeleton is the only long output. One object per line lets `llm.stream(on_token)` dispatch stage *k*'s fetches while stage *k+1* is still being generated, which hides all of the source latency except the last stage's. Each line is validated on its own against a small schema. If a line fails, it is retried once in a strict-JSON "repair this line" call, and the node is dropped if the retry also fails [INFERENCE]. Rerank and expansion calls are small, so they use the strict `response_format` json_schema pattern from `triage/openrouter.py` (D8).

**Normal latency budget** [INFERENCE: assumes a flash-class model at ~1 s to first token and ~100–150 tok/s, and API round-trips of 0.3–1 s]:

| Step | Time | Overlaps with |
|---|---|---|
| Cache + grounding | 0–1.5 s | — |
| Skeleton (~1.2k output tokens) | 1 s TTFT + ~8–12 s | Stage 1 visible at ~3–4 s |
| Stage fetch (YouTube search + videos.list + Wikipedia) | ~1–2 s per stage | the skeleton stream |
| Rerank (~2k in / 0.25k out) | ~2–3 s per stage | the next stages' fetches |
| Assemble + write | < 0.2 s | — |
| **Total** | **≈ 14–19 s** | |

Above Normal, the per-stage critical path is the same; deeper builds just stream more stages. For Super and above, the stage list (~0.8–1.2k tokens) arrives in ~6–9 s, and the expansions run 4 at a time.

### 4.3 Prompt rules ("no fluff")

Fixed in the system prompt; the validator checks the parts it can [INFERENCE]:
- No introductions, motivation or "Great question". The output is data only.
- `objective` is one sentence that starts with a verb ("Compute…", "Explain…", "Build…") and is at most 20 words. `why` is at most 15 words.
- `reason` for a resource is at most 12 words and must state what it covers or why it fits ("Visual intuition for eigenvectors; 17 min; pairs with node 3").
- Every node has `minutes`, and the stage sums must land within ±25% of the depth's hour budget. The validator rescales or drops nodes to fit.
- `canon` lists only resources the model is confident exist. Anything that fails to resolve is dropped silently, never shown as a fabricated link.
- No generic resources ("search online", "read the docs" without a URL).
- Stage 1 must be startable in under 10 minutes: the first node of the first stage is the "where to start" answer.

### 4.4 Cost, tokens and quota per depth

Token assumptions [INFERENCE]: skeleton ≈ 80 output tokens per stage + 60 per node; rerank ≈ 2–5k in / 0.25–0.7k out per stage. Prices are live OpenRouter prices on 2026-11-13 [VERIFIED]. `*` marks models the current rika catalogue filter excludes (§0.6).

| Depth | LLM calls | Tokens in / out | qwen3.8-flash ($0.15/$0.47) | deepseek-v3.2 ($0.26/$0.38) | gemini-2.5-flash-lite* ($0.10/$0.40) | gemini-3-flash* ($0.50/$3.00) | Ledger reservation† (qwen) | YouTube searches / other units |
|---|---|---|---|---|---|---|---|---|
| Normal | 5 | 9.5k / 2.2k | **$0.0025** | $0.0033 | $0.0018 | $0.011 | $0.011 | 4 / ~2 |
| High | 7 | 16.5k / 4.5k | $0.0046 | $0.0060 | $0.0035 | $0.022 | $0.018 | 6 / ~3 |
| Super | 19 | 51k / 10.7k | $0.013 | $0.017 | $0.009 | $0.058 | $0.052 | 11 / ~8 |
| Ultra | 29 | 107k / 25k | $0.028 | $0.037 | $0.021 | $0.13 | $0.096 | 17 / ~12 |
| Ultraviolet (eager: tracks + stages + first track) | 17 | 62k / 17.6k | $0.018 | $0.023 | $0.013 | $0.084 | $0.056 | 10 / ~8 |
| Ultraviolet (everything expanded, 40 stages) | 81 | 302k / 72k | $0.079 | $0.106 | $0.059 | $0.37 | $0.27 | 45 / ~40 |

† rika reserves conservatively: about one token per byte of input plus `max_output_tokens` (2048 by default) per call (`llm.py:111-114`, `web_ai._review`). The default `daily_budget_usd` of $1.00 covers every depth. A fully expanded Ultraviolet build on Gemini 3 Flash is the only one that takes a noticeable share of it.

Brave queries, at $0.005 each, cost more than the Normal LLM bill. Use them only when `canon` resolution and the keyless sources leave a node empty. The binding limit is **YouTube's 100 searches a day**: show "≈ N searches left today" in the depth picker and fall back to MIT Learn videos plus cached results when it runs out.

### 4.5 Caching

| Layer | Key | TTL | Where |
|---|---|---|---|
| Roadmap skeleton | `sha256(normalize(topic), depth, level, lang, model, prompt_ver)` | Until the user regenerates | `learn_builds.cache_key` (SQLite); reusing it means zero LLM calls |
| Source search results | `(source, normalized query, params)` | YouTube ≤ 30 d (policy); Wikipedia 7 d; MIT 7 d; Open Library 30 d; arXiv/S2 7 d; HN 1 d | `PoliteHttp` disk cache (`cache_dir/learn/<source>/`), TTL by mtime [CODE] |
| Resolved source records | canonical URL / video ID | YouTube: refresh at 30 d; others: re-check link at 14 d | `learn_sources.fetched_at / checked_at` |
| LLM prompt prefix | stable system prompt + schema | provider-side | `llm._cacheable` (Anthropic/Gemini only) [CODE]; keep the system prompt byte-stable and put the topic last |
| Canonical-resource memo | `(kind, title, by)` → source ID | 30 d | `learn_sources` lookup before any search. Popular resources (3Blue1Brown, CS50, MIT 18.06) resolve once and are reused across roadmaps. |

### 4.6 Ranking

**Videos** (deterministic pre-rank; the LLM makes the final pick among the top 8) [INFERENCE: weights to tune]:

| Signal | From | Rule |
|---|---|---|
| Duration fit | `contentDetails.duration` vs the node's `minutes` | Score peaks in [0.5×, 1.5×] of target. Penalise < 3 min (Shorts) and > 2.5× (unless it is a lecture and the depth is Ultra or above, or it has chapters covering the node, which gives a `start_s` deep link). Per-depth targets: Normal/High 6–25 min, Super 10–45, Ultra/UV 20–90. |
| Relevance | title + description + chapter titles vs node objective terms | BM25-style term overlap (local, no embeddings); the LLM rerank has the final say |
| Channel quality | `snippet.channelId` | (a) a small curated allowlist of known educational channels [INFERENCE: e.g. 3Blue1Brown, MIT OpenCourseWare, freeCodeCamp.org, StatQuest, Khan Academy, CrashCourse]; (b) channels the user has thumbed up or blocked (`learn_feedback`); (c) whether it was already chosen for an earlier stage (series coherence bonus). No subscriber-count formula (policy). |
| Recency | `publishedAt` | Weighted only when the skeleton marks `volatility: fast` (frameworks, cloud, AI tools): decay with a half-life of ~2 years. Ignored for `evergreen` topics (math, physics, history). |
| Engagement | `viewCount`, `likeCount` | Used only as a **filter**, never displayed as a score: drop < 1k views unless allowlisted or recent (< 6 months) [INFERENCE on policy III.E.4.h] |
| Accessibility | `contentDetails.caption`, `defaultAudioLanguage`, `status.embeddable` | Bonus for captions; require the language to match; embeddable for in-app play |
| Hygiene | `search.list` filters, title regex | `safeSearch=moderate`; drop "reaction", "#shorts", livestream VODs > 3 h unless the depth is Ultra or above |
| Transcript relevance | (only with D3 enabled) | Verify the top pick covers ≥ 60% of the node's key terms; otherwise demote. Runs after "ready". |

**Other sources:** resolved `canon` items rank first. Then, by kind: official docs (tools), OCW course (Ultra and above), textbook (Super and above), survey paper (`research` topics), article. Within a kind, Semantic Scholar's `influentialCitationCount` and Open Library's `edition_count` serve as authority signals.

### 4.7 Dedupe

- **Canonical URL:** lowercase the host; strip `utm_*`, `fbclid` and `ref`; rewrite `youtu.be/<id>`, `m.youtube.com` and `/embed/<id>` to `youtube.com/watch?v=<id>`; drop trailing slashes and `#fragment` (keep `t=`/`start` as `start_s`); drop the `www.` difference. Store it in `learn_sources.canonical` UNIQUE.
- **Same resource, many forms:** an MIT lecture's YouTube ID equals the YouTube search hit. A playlist and its member videos: keep the playlist for the stage and individual videos for nodes, and never show both at the same level. Open Library editions are grouped by work key.
- **Within a roadmap:** a resource is primary for at most one node. Later uses become `alt` with "(also used in stage N)". Near-duplicate titles from the same channel (token Jaccard > 0.8) are collapsed.
- **Nodes:** the skeleton validator merges nodes whose normalised titles match within a stage, and rejects duplicate IDs.

### 4.8 Dead-link checks

- **YouTube:** `videos.list` on the stored IDs. Missing, `privacyStatus != public` or `embeddable == false` means dead or "watch on YouTube". Runs at build time (free with the metadata call) and on open when `fetched_at` is more than 30 days old.
- **Web:** `PublicPages.fetch` (GET, robots-checked, 2 MB cap) after "ready", at most 1 request per host every 2 s. Outcomes:
  - `2xx` → ok;
  - `404/410` → dead (auto-swap in the next candidate);
  - `401/403/429` or a bot-challenge page (e.g. Khan Academy's "Client Challenge") → **unverified** (kept, marked with a hollow dot);
  - `robots disallow` → kept as a link and not fetched.
- **APIs** (Wikipedia, Open Library, arXiv, S2, MIT): the API response itself proves existence.
- Re-check every 14 days for roadmaps opened in that window. Never re-check archived roadmaps.

### 4.9 Regenerate and expand

- **Regenerate stage:** re-run step 2b, or the stage's skeleton slice, with the neighbouring stages as fixed context and the user's feedback ("too basic", "more practice"). Nodes with progress are kept. 1 LLM call plus 1 YouTube search.
- **Expand stage** (one depth level deeper for that stage only): split each node into 2–4 sub-nodes, re-run fetch and rerank. This is the Ultraviolet lazy path as well.
- **Swap resource:** the next candidate from `learn_candidates` (kept from the build). No API call.
- **"Not this channel":** adds a `learn_feedback` block, re-ranks locally, and applies to future builds.

---

## 5. Data model and UI

### 5.1 Migration `056_learn.sql` (sketch)

The latest migration is `055_apply_accounts.sql`, so this is next; numbers are enforced by `tests/test_migration_numbers.py` [CODE]. Style follows `049_rika_goals.sql` and `044_math.sql`.

```sql
CREATE TABLE learn_settings (               -- projected from build.json settings.learn
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sources_json TEXT NOT NULL DEFAULT '{"youtube":true,"wikipedia":true,"courses":true,"books":true,"papers":true,"docs":true,"web":false,"community":false}',
  default_depth TEXT NOT NULL DEFAULT 'normal' CHECK (default_depth IN ('normal','high','super','ultra','ultraviolet')),
  language TEXT NOT NULL DEFAULT 'en',
  auto_approve_usd TEXT NOT NULL DEFAULT '0',   -- D5
  revision INTEGER NOT NULL DEFAULT 1);
INSERT INTO learn_settings(id) VALUES (1);

CREATE TABLE learn_roadmaps (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, title TEXT NOT NULL,
  depth TEXT NOT NULL CHECK (depth IN ('normal','high','super','ultra','ultraviolet')),
  level TEXT,                                 -- beginner|some|advanced (inferred or asked once)
  volatility TEXT CHECK (volatility IN ('evergreen','fast')), research INTEGER NOT NULL DEFAULT 0,
  hours REAL, hours_per_week REAL, start_date TEXT, -- scheduling inputs for export
  state TEXT NOT NULL CHECK (state IN ('building','ready','partial','failed','archived')),
  subject_id TEXT, goal_id TEXT,              -- links once exported
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);

CREATE TABLE learn_stages (
  id TEXT PRIMARY KEY, roadmap_id TEXT NOT NULL REFERENCES learn_roadmaps(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES learn_stages(id) ON DELETE CASCADE, -- Ultraviolet: track → stage
  position INTEGER NOT NULL, title TEXT NOT NULL, why TEXT, hours REAL, query TEXT,
  expanded INTEGER NOT NULL DEFAULT 1,        -- 0 = lazy (Ultraviolet), nodes not yet built
  revision INTEGER NOT NULL DEFAULT 1);

CREATE TABLE learn_nodes (
  id TEXT PRIMARY KEY,                        -- '<roadmap>:<slug>' ≤ 64, matches TopicGraph ids
  roadmap_id TEXT NOT NULL REFERENCES learn_roadmaps(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES learn_stages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, title TEXT NOT NULL, objective TEXT NOT NULL, minutes INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('concept','skill','project','checkpoint')),
  state TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo','learning','done','skipped')),
  done_at TEXT, fsrs TEXT, due_at TEXT,       -- optional review (D9), FSRS like math_mastery
  revision INTEGER NOT NULL DEFAULT 1);
-- 'locked'/'ready' are derived (all prereqs done|skipped), as in math mastery.states().

CREATE TABLE learn_edges (
  node_id TEXT NOT NULL REFERENCES learn_nodes(id) ON DELETE CASCADE,
  prereq_id TEXT NOT NULL REFERENCES learn_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (node_id, prereq_id), CHECK (node_id <> prereq_id));
-- + learn_edges_acyclic_insert/update triggers: copy 044_math.sql's WITH RECURSIVE … RAISE(ABORT,…)

CREATE TABLE learn_sources (                  -- shared across roadmaps (canonical-resource memo)
  id TEXT PRIMARY KEY, canonical TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,                     -- youtube|wikipedia|mit|openlibrary|arxiv|s2|docs|github|hn|web
  kind TEXT NOT NULL CHECK (kind IN ('video','playlist','course','docs','article','book','paper','repo','discussion')),
  external_id TEXT, title TEXT NOT NULL, author TEXT, duration_s INTEGER, published_at TEXT,
  license TEXT, meta_json TEXT NOT NULL DEFAULT '{}',   -- chapters, caption flag, counts as returned
  fetched_at TEXT NOT NULL,                   -- YouTube rows: refresh or delete after 30 d (policy)
  link_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked','ok','unverified','dead')),
  checked_at TEXT);

CREATE TABLE learn_node_sources (
  node_id TEXT NOT NULL REFERENCES learn_nodes(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES learn_sources(id),
  role TEXT NOT NULL CHECK (role IN ('primary','alt','deep','practice')),
  rank INTEGER NOT NULL, reason TEXT NOT NULL, start_s INTEGER,
  watched INTEGER NOT NULL DEFAULT 0,         -- per-resource progress
  PRIMARY KEY (node_id, source_id));
CREATE TABLE learn_stage_sources (            -- stage-level backbone (course, playlist, book)
  stage_id TEXT NOT NULL REFERENCES learn_stages(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES learn_sources(id), role TEXT NOT NULL, reason TEXT NOT NULL,
  PRIMARY KEY (stage_id, source_id));
CREATE TABLE learn_candidates (               -- unpicked ranked candidates, for instant swap
  stage_id TEXT NOT NULL REFERENCES learn_stages(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES learn_sources(id), prerank REAL NOT NULL,
  PRIMARY KEY (stage_id, source_id));

CREATE TABLE learn_builds (                   -- progress, resume, cost and quota accounting
  id TEXT PRIMARY KEY, roadmap_id TEXT NOT NULL REFERENCES learn_roadmaps(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,                        -- 'full' | 'stage:<id>' | 'expand:<id>' | 'refresh'
  cache_key TEXT, model TEXT, prompt_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','completed','partial','failed')),
  ai_reservation TEXT,                        -- ai_reviews.id (batch ceiling)
  youtube_searches INTEGER NOT NULL DEFAULT 0, youtube_units INTEGER NOT NULL DEFAULT 0,
  phases_json TEXT NOT NULL DEFAULT '{}', error TEXT,
  started_at TEXT NOT NULL, finished_at TEXT);
CREATE INDEX learn_builds_daily ON learn_builds(started_at); -- "YouTube searches left today"

CREATE TABLE learn_feedback (                 -- channel/source thumbs, applied to future ranking
  target_kind TEXT NOT NULL CHECK (target_kind IN ('channel','source')), target TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('good','block')), created_at TEXT NOT NULL,
  PRIMARY KEY (target_kind, target));
```

The goal link kind `learn_roadmap` needs an `ALTER` of the `goal_links` CHECK. SQLite can't alter a CHECK in place, so this is a table rebuild, done in the same migration with `-- foreign_keys: off` as other migrations do [CODE: migration directives].

### 5.2 API (`web_learn.py`)

| Route | Does |
|---|---|
| `GET /api/learn` | List roadmaps, settings, YouTube searches left today, key presence |
| `POST /api/learn/preview {topic, depth, sources?}` | Returns the plan: call count, **maximum cost** (batch ceiling), YouTube searches, ETA → effect id and digest (as in `web_ai._review`) |
| `POST /api/learn/build {effect_id, digest, confirmed}` | Reserves the batch and starts `app.tasks.start('learn-build:<id>')` → `{roadmap_id, task}` |
| `GET /api/learn/roadmap?id` | Roadmap + stages + nodes (in the TopicGraph shape via `states()`) + sources |
| `POST /api/learn/node {id, revision, state}` | Done / skip / learning |
| `POST /api/learn/stage/{regenerate,expand} {id, feedback?}` | Preview + approve, same flow |
| `POST /api/learn/source/{swap,feedback,watched}` | Local only, no API calls |
| `POST /api/learn/export {roadmap_id, targets:[flashcards,calendar,study,goal,mindmap,notes], stages?, hours_per_week?, start_date?}` | In-process calls to the existing core functions (§1), idempotent by `source_key`/`guid` |

Ask Rika: `build_learning_roadmap` is `effect="outward"`, and its `describe` returns "Build a Normal roadmap for 'Rust': ≤ $0.01, 4 YouTube searches". On approval it runs the same task and returns `client={"type":"navigate","view":"learn"}`. `export_roadmap` is `"change"` with an undo (delete the created deck notes and events by `source_key`).

### 5.3 UI sketch (`web/src/lib/learn/Learn.svelte`)

```
┌ Learn ───────────────────────────────────────────────────────────────────────┐
│ I want to learn [ linear algebra for ML ______________________ ]  [Build ↵]  │
│ Depth  (•Normal ~2h) ( High ~5h ) ( Super ~2wk ) ( Ultra ~semester ) ( UV )  │
│ Sources [Videos ✓ 96 left] [Reference ✓] [Courses ✓] [Books] [Papers]        │
│         [Docs ✓] [Web $] [Community]        est. ≤ $0.01 · 4 searches · ~20s │
├──────────────────────────────────────┬───────────────────────────────────────┤
│ Stage strip:  ①Vectors ②Matrices ③Eigen ④SVD ⑤PCA      3/14 done · 1.6h left │
│                                      │ ③.2  Eigenvectors as invariant axes    │
│   (TopicGraph: strand = stage;       │ Compute eigenpairs of a 2×2 matrix.    │
│    strandView for one stage +        │ Needs ✓③.1  Unlocks ○④.1   ~25 min    │
│    faint outside prereqs;            │ ▶ 3Blue1Brown · Eigenvectors… 17:15   │
│    stars fill as nodes complete;     │   "Visual intuition; pairs with ③.1"  │
│    building stages pulse)            │ ▷ alt: MIT 18.06 L21 (from 4:10)      │
│                                      │ ☰ Wikipedia: Eigenvalues… (ref)       │
│                                      │ [Done] [Skip—know it] [Swap] [⋯]      │
├──────────────────────────────────────┴───────────────────────────────────────┤
│ [Regenerate stage] [Expand stage] [Export ▾ Flashcards · Calendar · Study ·  │
│  Goal · Mind map · Notes]                         [Start studying → focus]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **While building:** stage chips appear as the NDJSON lines parse. Nodes pop in as stars. Source rows show skeleton shimmer until their stage's rerank lands. "Ready" is announced per stage, not only at the end.
- **Start here:** the first `ready` node of stage 1 is highlighted and opens by default. This is the answer to "where should I start?".
- **Overview:** for Ultra and Ultraviolet, use a `StageMap`-style region view (one panel per stage or track, "done of n · hours"). Click into a stage to get the TopicGraph `strandView`. Collapsed Ultraviolet stages show as dim, unexpanded clusters with an "Expand" action.
- **Progress:** node `done` or `skipped` unlocks its dependents (the state rule from `mastery.states`). A stage's progress is the share of its nodes done. `watched` ticks are per resource. "Start studying" reuses `math/focus.ts` (auto Study subject + focus timer).
- **Export dialog:** a checklist of stages (the `RikaPlan` pattern).
  - Calendar asks for hours per week and a start date, then spreads node minutes into events (`source_key learn:<roadmap>:<node>`, attachments = the node's sources).
  - Flashcards runs one LLM call per stage with the existing grounded-flashcards prompt, using node objectives and resource reasons as the source text. Deck `Learn::<Topic>::<Stage>`.

---

## 6. Decisions for the user

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Where Learn lives | (a) New **Learn** view, first in the Study group, plus a Rika tool; (b) replace the LearnHarness iframe in the group; (c) Ask Rika only | **(a).** LearnHarness is an external AGPL app with no rika data (§1). Keep it but move it after Learn. A dedicated view is needed for the graph, progress and export. The Rika tool is the fast entry point ("Rika, I want to learn X"). |
| **D2** | YouTube access | (a) **Official API, BYOK only**; (b) official + opt-in keyless (yt-dlp or a self-hosted Invidious URL) behind a ToS warning; (c) keyless only | **(a)** for the public app. Keyless paths break the YouTube ToS (§2.1) and fail often (yt-dlp now needs a JS runtime; Piped is dead). Without a key, MIT Learn still supplies OCW lecture videos with YouTube IDs. Also decide: show view counts as returned, never a computed score (policy III.E.4.h). |
| **D3** | Transcripts for ranking | (a) None: chapters, description and caption flag only; (b) opt-in, post-ready verification of top picks via youtube-transcript-api; (c) always-on | **(a) at launch.** No official route exists, and it is slow. Revisit (b) only if rankings prove weak in testing. |
| **D4** | Web search for "other sources" | (a) Keyless per-site APIs only (Wikipedia, MIT, Open Library, arXiv/S2, docs through robots-checked fetch); (b) plus **Brave** (existing key) as a gap filler; (c) OpenRouter's web plugin | **(a) default, (b) as the "Web" toggle.** Brave costs $0.005 a query, which is more than a whole Normal LLM build. Use it only when canon resolution leaves a node empty. (c) is blocked by rika's surcharge filter and is harder to bound. |
| **D5** | Cost approval UX | (a) Every build gets a preview card (the current `ai_request` contract); (b) **auto-approve under a user-set ceiling** (e.g. ≤ $0.05 and within the daily budget), with a review card above it; (c) no approval | **(b), with the ceiling defaulting to $0** (so it behaves like (a) until the user opts in). Normal and High cost under 2¢, and a click before every 20-second build defeats "should not take long". Super and above always show the card, because of the YouTube quota. |
| **D6** | Model and the catalogue filter | (a) Use what passes today (`qwen/qwen3.8-flash`, `deepseek/deepseek-v3.2`, `mistral-small-3.2`); (b) **relax `web_ai.py:181`** to ignore the `web_search` surcharge when a request does not enable the web plugin (and keep `max_price` capped); (c) a per-feature model setting | **(b) plus a fast-tier default for Learn.** The filter currently hides every Gemini, GPT-5 and Claude model, including Rika's own defaults (§0.6). That is a separate bug worth fixing now. [INFERENCE] OpenRouter charges `web_search` only when web search is used; confirm against the OpenRouter pricing docs before relaxing. |
| **D7** | Ultraviolet build strategy | (a) Eager full build (~81 calls, 45 YouTube searches, ~10–20 min); (b) **lazy: tracks + stages + first track eagerly, other stages on open**, with an "Expand all in background" button; (c) cap Ultraviolet at Ultra size | **(b).** The first view comes in ≤ 15 s, it fits the 100 searches a day, and nobody needs year 3's videos on day 1. YouTube's 30-day storage rule would force a refresh of eagerly fetched far-future picks anyway. |
| **D8** | Skeleton output format | (a) **Streamed NDJSON, per-line validation + one repair call**; (b) strict `json_schema`, non-streamed; (c) Rika tool-calls per stage | **(a) for the skeleton, (b) for rerank and expansion.** Streaming is what hits < 20 s for Normal, because fetches overlap generation. Strict schemas suit the small calls. |
| **D9** | Progress model | (a) **Done / skip / learning ticks, plus per-resource "watched"**; (b) math-style mastery (quiz or FSRS per node); (c) both, with (b) opt-in per roadmap | **(a) now, (c) later.** Generic topics lack a problem bank. The reused state rule still gives locked/ready. Spaced review comes through the Flashcards export, which already has FSRS. |
| **D10** | Default source toggles and level calibration | Toggles: (a) everything keyless on; (b) **Reference, Courses, Docs on; Books on at Super+; Papers auto for `research` topics; Videos on with key; Web and Community off**. Calibration: ask one "your level?" question, or infer it from the prompt | **(b)**, and **infer the level** from the prompt ("for ML", "refresher") with a one-tap level chip on the result to regenerate. Perplexity asks a few questions; rika should ask none by default, to stay fast. |

**Checks to run once this is implemented** (main agent): `tests/test_migration_numbers.py`; a unit test for the NDJSON stream parser (partial lines, malformed lines, the repair path); the acyclic-trigger test copied from math; a `PoliteHttp` mock-transport test per source adapter; an end-to-end timing run for Normal against the 20 s target with a real key.
