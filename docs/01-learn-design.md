# rika-learn: design

rika-learn is a **public rika! module** that forks **LearnHarness** into a "LearnHarness pro max" deeply synced with rika. You ask rika "I want to learn X, where do I start?". It answers with a few priming questions, then streams a roadmap within seconds. Each stage has one best video, one or two readings, and a "More" list behind it. Depth runs from Normal (a couple of hours) to Ultraviolet (semesters to years).

Research: `research/07-learn-feature.md`.

## Terms

- **Roadmap:** a learning plan made of stages, topics, resources and progress.
- **Stage:** one step of a roadmap.
- **Depth:** Normal, High, Super, Ultra or Ultraviolet.
- **Source:** an opt-in place resources come from.

## Locked decisions

- **Base: fork LearnHarness** (from the user's q12 thread, overriding q1 C and refining q1 A).
  - Every existing LearnHarness feature is kept, and only edited where needed.
  - It becomes a Learn view in the Study group, synced with rika: Ask Rika tool, Flashcards, Calendar, Goals, and the star-map look.
  - It is published as the public `rika-learn` module through rika's module loader.
- **Roadmap view (q4 C):** a vertical stage timeline by default, with a Map toggle that draws the same stages as rika-math-style stars.
- **YouTube (q8 A):** official API with the user's own key only, at one search per stage, never one per topic. The cap is about 100 searches a day, and YouTube's terms forbid scraping and caption downloads.
- **AI approval (q11 A):** calls under a daily ceiling are approved automatically; the first run asks the user to set that ceiling. Anything over it gets a review sheet.

## Routine choices

- **q2 depth picker:** five named steps, each showing its time span. Normal is the default.
- **q3 starting level:** priming before the build. Up to three quick questions settle the user's level, then the build starts.
- **q5 resources:** one best video plus one or two readings or exercises per stage; "More" shows the ranked rest.
- **q6 Ultra and Ultraviolet:** the tracks and stages are built immediately, and the first track's resources are filled in. Other tracks fill when opened.
- **q7 progress:** each topic is marked done, learning or skipped. Each stage can be sent to Flashcards or scheduled in Calendar. Quizzes come later.
- **q9 sources:** all six are on.
  - Wikipedia
  - MIT Learn/OCW, freeCodeCamp and Open Library
  - Official docs (robots.txt respected)
  - YouTube, when a key exists
  - arXiv and Semantic Scholar
  - Hacker News and GitHub awesome-lists

  Out: Reddit (its API is closed) and copying roadmap.sh content (its licence is personal use only; linking is fine).
- **q10 web search:** per-site APIs by default, with Brave Search as an optional toggle using the user's own key.
- **q12 models:** fix rika's model-list filter in `web_ai.py`. It currently drops every model that lists a web-search price, which hides Gemini, GPT-5 and Claude, including Rika's own defaults. Then use one fast, cheap model by default for all Learn calls. First confirm in OpenRouter's pricing docs that the web-search price only applies when web search is used.

## Risks

- **LearnHarness is an iframe around an external app today.** Forking it means owning that app's code and its licence; check the licence before publishing.
- **YouTube quota:** heavy days can exhaust it. Show the quota meter and fall back to MIT Learn videos.
- **Latency target:** a Normal build should take under 20 s. Measure it with a real key.

## Next

1. Inspect LearnHarness (source, licence, features).
2. Fork it into `rika-learn`.
3. Build the module loader in rika, shared with rika-math.
4. Fix the model filter.
5. Implement the pipeline, test first.
