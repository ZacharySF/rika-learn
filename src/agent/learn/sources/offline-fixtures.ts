/**
 * THE OFFLINE FIXTURE NETWORK (docs/learn.md "Running it offline"): a
 * `fetch` that answers every endpoint the source adapters call, with
 * synthetic data shaped like the real replies and derived
 * deterministically from the query (titles contain the query words), so
 * LH_LEARN_OFFLINE_DEMO=1 runs the whole pipeline with nothing leaving
 * the machine. No thumbnails are returned, so the demo loads no remote
 * images. Unknown URLs answer 404, as the real web would.
 */

/** Docs hosts whose pages exist offline (any path; robots.txt allows all). */
export const OFFLINE_DOCS_HOSTS: readonly string[] = [
	"doc.rust-lang.org",
	"docs.python.org",
	"developer.mozilla.org",
	"react.dev",
	"nodejs.org",
	"www.typescriptlang.org",
	"git-scm.com",
	"docs.docker.com",
	"kubernetes.io",
	"go.dev",
	"en.cppreference.com",
	"www.postgresql.org",
	"pytorch.org",
	"numpy.org",
	"scikit-learn.org",
];

/** Topics the offline freeCodeCamp sitemap has articles for. */
const FCC_TOPICS = [
	"rust",
	"python",
	"javascript",
	"typescript",
	"react",
	"css",
	"html",
	"git",
	"sql",
	"linux",
	"docker",
	"kubernetes",
	"go",
	"java",
	"c-plus-plus",
	"node-js",
	"regex",
	"bash",
	"algorithms",
	"data-structures",
	"recursion",
	"linear-algebra",
	"calculus",
	"statistics",
	"machine-learning",
	"web-development",
];

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** FNV-1a: a stable 32-bit hash, so the same query always gives the same data. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h;
}

function videoIdFor(seed: string): string {
	let id = "";
	let h = hash(seed);
	while (id.length < 11) {
		id += ID_ALPHABET[h % 64];
		h = hash(`${seed}:${id}:${h}`);
	}
	return id;
}

function sentence(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim() || "This topic";
	return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "topic"
	);
}

function xml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function body(text: string, contentType: string, status = 200): Response {
	return new Response(text, { status, headers: { "content-type": contentType } });
}

const notFound = (): Response => body("Not found", "text/plain", 404);

function count(url: URL, name: string, fallback: number, max: number): number {
	const value = Number(url.searchParams.get(name));
	return Math.max(1, Math.min(max, Number.isFinite(value) && value > 0 ? value : fallback));
}

// ── Wikipedia ────────────────────────────────────────────────────────

function wikipedia(url: URL): Response {
	const lang = url.hostname.split(".")[0] ?? "en";
	if (url.pathname === "/w/api.php" && url.searchParams.get("list") === "search") {
		const q = sentence(url.searchParams.get("srsearch") ?? "");
		const titles = [q, `History of ${q.toLowerCase()}`, `${q} in practice`];
		const limit = count(url, "srlimit", 3, titles.length);
		return json({
			batchcomplete: true,
			query: {
				searchinfo: { totalhits: titles.length },
				search: titles.slice(0, limit).map((title, i) => ({ ns: 0, title, pageid: hash(title), wordcount: 1200 + i * 900 })),
			},
		});
	}
	const prefix = "/api/rest_v1/page/summary/";
	if (url.pathname.startsWith(prefix)) {
		const key = url.pathname.slice(prefix.length);
		const title = decodeURIComponent(key).replaceAll("_", " ");
		return json({
			type: "standard",
			title,
			displaytitle: title,
			description: `Synthetic offline article about ${title.toLowerCase()}`,
			extract: `${title} is explained here in plain words. This synthetic offline summary stands in for the Wikipedia article so the demo needs no network.`,
			content_urls: { desktop: { page: `https://${lang}.wikipedia.org/wiki/${key}` } },
		});
	}
	return notFound();
}

// ── MIT Learn ────────────────────────────────────────────────────────

function mitlearn(url: URL): Response {
	if (url.pathname !== "/api/v1/learning_resources_search/") return notFound();
	const q = sentence(url.searchParams.get("q") ?? "");
	const types = url.searchParams.getAll("resource_type");
	const wants = (type: string) => types.length === 0 || types.includes(type);
	const ocw = { code: "ocw", name: "MIT OpenCourseWare" };
	const results: unknown[] = [];
	if (wants("course")) {
		const number = `${(hash(q) % 20) + 1}.${String(hash(`${q}#n`) % 100).padStart(2, "0")}`;
		results.push({
			id: hash(q),
			resource_type: "course",
			title: q,
			readable_id: `${number}+fall_2024`,
			url: `https://ocw.mit.edu/courses/${number.replace(".", "-")}-${slug(q)}-fall-2024/`,
			offered_by: ocw,
			platform: ocw,
			free: true,
			description: `<p>A synthetic offline course on ${xml(q.toLowerCase())}: lectures, notes and problem sets.</p>`,
			runs: [{ year: 2024, instructors: [{ full_name: "Prof. Offline Example" }] }],
		});
	}
	if (wants("video")) {
		for (let i = 1; i <= 2; i++) {
			const title = `Lecture ${i}: ${q}`;
			const videoId = videoIdFor(`mit:${q}:${i}`);
			results.push({
				id: hash(title),
				resource_type: "video",
				resource_category: "Lecture Video",
				title,
				readable_id: videoId,
				url: `https://ocw.mit.edu/courses/offline-${slug(q)}/resources/lecture-${i}/`,
				offered_by: ocw,
				platform: ocw,
				free: true,
				description: null,
				video: { duration: `PT${10 + (hash(title) % 9)}M${hash(title) % 60}S` },
			});
		}
	}
	const limit = count(url, "limit", 10, 50);
	return json({ count: results.length, next: null, previous: null, results: results.slice(0, limit) });
}

// ── freeCodeCamp ─────────────────────────────────────────────────────

function freecodecamp(url: URL): Response {
	const base = "https://www.freecodecamp.org/news";
	if (url.pathname === "/robots.txt") return body(`User-Agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`, "text/plain");
	if (url.pathname === "/news/sitemap.xml") {
		const maps = ["sitemap-pages.xml", "sitemap-posts.xml", "sitemap-authors.xml"];
		return body(
			`<?xml version="1.0" encoding="utf-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps
				.map((m) => `  <sitemap><loc>${base}/${m}</loc><lastmod>2026-11-01T00:00:00.000Z</lastmod></sitemap>`)
				.join("\n")}\n</sitemapindex>\n`,
			"application/xml",
		);
	}
	if (url.pathname === "/news/sitemap-posts.xml") {
		const urls = FCC_TOPICS.flatMap((topic, t) =>
			[
				`learn-${topic}-for-beginners`,
				`${topic}-fundamentals-explained`,
				`${topic}-handbook`,
				`build-${topic}-practice-projects`,
			].map((path, i) => {
				const day = String(((t * 4 + i) % 28) + 1).padStart(2, "0");
				return `  <url><loc>${base}/${path}/</loc><lastmod>2026-10-${day}T00:00:00.000Z</lastmod></url>`;
			}),
		);
		return body(
			`<?xml version="1.0" encoding="utf-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
			"application/xml",
		);
	}
	return notFound();
}

// ── Open Library ─────────────────────────────────────────────────────

function openlibrary(url: URL): Response {
	if (url.pathname !== "/search.json") return notFound();
	const title = url.searchParams.get("title");
	const author = url.searchParams.get("author");
	const q = sentence(url.searchParams.get("q") ?? title ?? "");
	const books = title
		? [{ title: title.trim(), author: author?.trim() || "A. Offline Author" }]
		: [
				{ title: q, author: "A. Offline Author" },
				{ title: `Introduction to ${q.toLowerCase()}`, author: "B. Example" },
				{ title: `${q} in practice`, author: "C. Sample" },
			];
	const docs = books.map((b, i) => ({
		key: `/works/OL${(hash(b.title) % 9_000_000) + 1_000_000}W`,
		title: b.title,
		author_name: [b.author],
		first_publish_year: 1995 + (hash(b.title) % 30),
		edition_count: 12 - i * 3,
	}));
	const limit = count(url, "limit", 10, 100);
	return json({ numFound: docs.length, start: 0, docs: docs.slice(0, limit) });
}

// ── arXiv ────────────────────────────────────────────────────────────

function arxiv(url: URL): Response {
	if (url.pathname !== "/api/query") return notFound();
	const raw = url.searchParams.get("search_query") ?? "";
	const phrase = /^ti:"(.*)"$/.exec(raw)?.[1];
	const subject = sentence(phrase ?? raw.replace(/\ball:/g, "").replace(/\bAND\b/g, " "));
	const titles = phrase ? [subject] : [`A survey of ${subject.toLowerCase()}`, `${subject}: foundations and open problems`];
	const limit = count(url, "max_results", 10, 50);
	const entries = titles.slice(0, limit).map((title) => {
		const h = hash(title);
		const id = `24${String((h % 12) + 1).padStart(2, "0")}.${String(h % 100_000).padStart(5, "0")}`;
		return `  <entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <updated>2024-06-01T00:00:00Z</updated>
    <published>2024-06-01T00:00:00Z</published>
    <title>${xml(title)}</title>
    <summary>A synthetic offline abstract about ${xml(subject.toLowerCase())}, standing in for a real paper.</summary>
    <author><name>Ada Offline</name></author>
    <author><name>Bo Example</name></author>
    <link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/${id}v1" rel="related" type="application/pdf"/>
  </entry>`;
	});
	return body(
		`<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title type="html">ArXiv Query: ${xml(raw)}</title>\n${entries.join("\n")}\n</feed>\n`,
		"application/atom+xml",
	);
}

// ── Semantic Scholar ─────────────────────────────────────────────────

function semanticscholar(url: URL): Response {
	if (url.pathname !== "/graph/v1/paper/search") return notFound();
	const q = sentence(url.searchParams.get("query") ?? "");
	const titles = [q, `A survey of ${q.toLowerCase()}`, `${q}: a tutorial`];
	const limit = count(url, "limit", 10, 100);
	const data = titles.slice(0, limit).map((title, i) => {
		const paperId = hash(title).toString(16).padStart(8, "0");
		return {
			paperId,
			title,
			year: 2015 + (hash(title) % 10),
			url: `https://www.semanticscholar.org/paper/${paperId}`,
			citationCount: 900 - i * 250,
			influentialCitationCount: 90 - i * 25,
			tldr: { model: "tldr@v2.0.0", text: `A synthetic offline paper on ${q.toLowerCase()}.` },
			authors: [{ authorId: "1", name: "Ada Offline" }, { authorId: "2", name: "Bo Example" }],
			openAccessPdf: null,
		};
	});
	return json({ total: data.length, offset: 0, data });
}

// ── Hacker News ──────────────────────────────────────────────────────

function hackernews(url: URL): Response {
	if (url.pathname !== "/api/v1/search") return notFound();
	const q = (url.searchParams.get("query") ?? "").trim() || "this";
	const titles = [`Ask HN: What is the best way to learn ${q}?`, `${sentence(q)}: resources that actually helped me`];
	const limit = count(url, "hitsPerPage", 20, 100);
	const hits = titles.slice(0, limit).map((title, i) => ({
		objectID: String(30_000_000 + (hash(title) % 9_000_000)),
		title,
		url: null,
		author: "offline_demo",
		points: 420 - i * 150,
		num_comments: 180 - i * 60,
		created_at: "2025-03-14T12:00:00.000Z",
		_tags: ["story"],
	}));
	return json({ hits, nbHits: hits.length, page: 0, hitsPerPage: limit, query: q });
}

// ── GitHub ───────────────────────────────────────────────────────────

function github(url: URL): Response {
	if (url.pathname !== "/search/repositories") return notFound();
	const topic = (url.searchParams.get("q") ?? "")
		.replace(/\bin:name\b/, "")
		.replace(/^\s*awesome\s+/i, "")
		.trim();
	const name = `awesome-${slug(topic)}`;
	const items = [
		{
			full_name: `offline-lists/${name}`,
			html_url: `https://github.com/offline-lists/${name}`,
			description: `A curated list of ${topic || "learning"} resources (synthetic, offline).`,
			stargazers_count: 5000 + (hash(topic) % 20_000),
			owner: { login: "offline-lists" },
			pushed_at: "2026-09-01T00:00:00Z",
			archived: false,
		},
	];
	return json({ total_count: items.length, incomplete_results: false, items });
}

// ── Brave ────────────────────────────────────────────────────────────

function brave(url: URL, headers: Headers): Response {
	if (url.pathname !== "/res/v1/web/search") return notFound();
	if (!headers.get("x-subscription-token")) return json({ type: "ErrorResponse", error: { code: "SUBSCRIPTION_TOKEN_INVALID" } }, 401);
	const q = sentence(url.searchParams.get("q") ?? "");
	const results = [
		{ title: `${q} — a beginner's guide`, host: "learn.example.org" },
		{ title: `${q} explained with examples`, host: "tutorials.example.net" },
	].map((r) => ({
		title: r.title,
		url: `https://${r.host}/${slug(q)}`,
		description: `Synthetic offline web result about <strong>${xml(q.toLowerCase())}</strong>.`,
		profile: { name: r.host },
		meta_url: { hostname: r.host },
	}));
	return json({ type: "search", web: { type: "search", results } });
}

// ── YouTube ──────────────────────────────────────────────────────────

/** search.list → videos.list hand-off: titles of the ids the offline
 *  search returned, so details carry query-shaped titles. */
const offlineVideos = new Map<string, { title: string; channel: string }>();
const CHANNELS = ["Offline Academy", "Synthetic Lectures", "Demo Explains"];

function youtube(url: URL): Response {
	if (!url.searchParams.get("key")) {
		return json({ error: { code: 403, message: "The request is missing a valid API key.", errors: [{ reason: "forbidden" }] } }, 403);
	}
	if (url.pathname === "/youtube/v3/search") {
		const q = sentence(url.searchParams.get("q") ?? "");
		const duration = url.searchParams.get("videoDuration") ?? "any";
		const labels = ["explained", "in 15 minutes", "for beginners", "worked examples", "common mistakes", "visual intuition"];
		const items = labels.slice(0, count(url, "maxResults", 5, 50)).map((label, i) => {
			const videoId = videoIdFor(`yt:${q}:${duration}:${i}`);
			const title = `${q} ${label}`;
			const channel = CHANNELS[i % CHANNELS.length] ?? "Offline Academy";
			offlineVideos.set(videoId, { title, channel });
			return {
				kind: "youtube#searchResult",
				id: { kind: "youtube#video", videoId },
				snippet: { title, channelTitle: channel, liveBroadcastContent: "none" },
			};
		});
		return json({ kind: "youtube#searchListResponse", pageInfo: { totalResults: items.length }, items });
	}
	if (url.pathname === "/youtube/v3/videos") {
		const ids = (url.searchParams.get("id") ?? "").split(",").filter(Boolean).slice(0, 50);
		const items = ids.map((id) => {
			const known = offlineVideos.get(id);
			const h = hash(id);
			return {
				kind: "youtube#video",
				id,
				snippet: {
					publishedAt: `20${18 + (h % 8)}-0${(h % 9) + 1}-15T12:00:00Z`,
					channelId: `UCoffline${(h % 3) + 1}`,
					title: known?.title ?? `Offline lesson ${id}`,
					description: "A synthetic offline video for the demo.\n00:00 Intro\n03:00 Main idea\n09:00 Recap",
					channelTitle: known?.channel ?? "Offline Academy",
					liveBroadcastContent: "none",
					defaultAudioLanguage: "en",
				},
				contentDetails: { duration: `PT${6 + (h % 12)}M${h % 60}S`, caption: h % 2 === 0 ? "true" : "false" },
				statistics: { viewCount: String(50_000 + (h % 900_000)), likeCount: String(2_000 + (h % 40_000)) },
				status: { privacyStatus: "public", embeddable: true },
			};
		});
		return json({ kind: "youtube#videoListResponse", pageInfo: { totalResults: items.length }, items });
	}
	return notFound();
}

// ── Official docs ────────────────────────────────────────────────────

function docsPage(url: URL): Response {
	if (url.pathname === "/robots.txt") return body("User-agent: *\nAllow: /\n", "text/plain");
	const section = url.pathname.split("/").filter(Boolean).map(sentence).join(" · ");
	const title = `${section || "Documentation"} — ${url.hostname} (offline)`;
	return body(
		`<!doctype html><html><head><meta charset="utf-8"><title>${xml(title)}</title></head><body><h1>${xml(title)}</h1><p>Synthetic offline documentation page.</p></body></html>`,
		"text/html; charset=utf-8",
	);
}

// ── Router ───────────────────────────────────────────────────────────

function route(url: URL, headers: Headers): Response {
	const host = url.hostname;
	if (host.endsWith(".wikipedia.org")) return wikipedia(url);
	if (OFFLINE_DOCS_HOSTS.includes(host)) return docsPage(url);
	switch (host) {
		case "api.learn.mit.edu":
			return mitlearn(url);
		case "www.freecodecamp.org":
			return freecodecamp(url);
		case "openlibrary.org":
			return openlibrary(url);
		case "export.arxiv.org":
			return arxiv(url);
		case "api.semanticscholar.org":
			return semanticscholar(url);
		case "hn.algolia.com":
			return hackernews(url);
		case "api.github.com":
			return github(url);
		case "api.search.brave.com":
			return brave(url, headers);
		case "www.googleapis.com":
			return youtube(url);
		default:
			return notFound();
	}
}

/** Drop-in `fetch` for SourceContext in offline mode. */
export const offlineFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
	const request = input instanceof Request ? input : undefined;
	const url = new URL(request ? request.url : input instanceof URL ? input.href : String(input));
	init?.signal?.throwIfAborted();
	const headers = new Headers(request?.headers);
	new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
	return route(url, headers);
};
