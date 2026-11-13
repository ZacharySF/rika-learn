/**
 * MIT Learn adapter: learning_resources_search for free courses and
 * lecture videos. OCW lecture videos carry their YouTube id in
 * `readable_id`, so they become embeddable video picks with no YouTube
 * quota spent. Synthetic records shaped like the live API (2026-11).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mitlearn } from "../src/agent/learn/sources/mitlearn.ts";
import { fakeSources, json, stageQuery, text, type Route } from "./learn-sources-fakes.ts";

const OCW = { code: "ocw", name: "MIT OpenCourseWare" };

const RESULTS = [
	{
		resource_type: "video",
		resource_category: "Lecture Video",
		title: "Vector Spaces and Subspaces",
		readable_id: "AbCdEfGh123",
		url: "https://ocw.mit.edu/courses/18-00-synthetic/resources/vector-spaces/",
		offered_by: OCW,
		description: null,
		image: { url: "https://i.ytimg.com/vi/AbCdEfGh123/hqdefault.jpg" },
		video: { duration: "PT16M36S" },
	},
	{
		resource_type: "course",
		title: "Synthetic Linear Algebra",
		readable_id: "18.00SC+fall_2011",
		url: "https://ocw.mit.edu/courses/18-00sc-synthetic-linear-algebra-fall-2011/",
		offered_by: OCW,
		description: "<p>This course covers <em>matrix</em> theory.</p>",
		image: { url: "https://ocw.mit.edu/image.jpg" },
		runs: [{ year: 2011, instructors: [{ full_name: "Prof. Synthetic" }] }],
	},
	{
		resource_type: "video",
		title: "Not a YouTube video",
		readable_id: "76edf1d9e65644a0885d3bcfd4105fd4",
		url: "https://video.example.test/1",
		offered_by: null,
		video: { duration: "PT47S" },
	},
	{ resource_type: "podcast", title: "A podcast", url: "https://pod.example.test/", readable_id: "p1" },
];

const route: Route = () => json({ count: RESULTS.length, next: null, previous: null, results: RESULTS });

describe("mitlearn.search", () => {
	it("asks for free courses and videos with the query and limit", async () => {
		const fake = fakeSources(route);
		await mitlearn.search(stageQuery({ limit: 6 }), fake.ctx);
		const url = fake.calls[0]?.url;
		assert.equal(url?.origin + (url?.pathname ?? ""), "https://api.learn.mit.edu/api/v1/learning_resources_search/");
		assert.equal(url?.searchParams.get("q"), "vector spaces introduction");
		assert.equal(url?.searchParams.get("limit"), "6");
		assert.deepEqual(url?.searchParams.getAll("resource_type"), ["course", "video"]);
		assert.equal(url?.searchParams.get("free"), "true");
	});

	it("maps OCW lecture videos to videos with their YouTube id and courses to courses", async () => {
		const fake = fakeSources(route);
		const found = await mitlearn.search(stageQuery(), fake.ctx);
		assert.deepEqual(found, [
			{
				source: "mitlearn",
				kind: "video",
				title: "Vector Spaces and Subspaces",
				url: "https://www.youtube.com/watch?v=AbCdEfGh123",
				by: "MIT OpenCourseWare",
				minutes: 17,
				thumbnail: "https://i.ytimg.com/vi/AbCdEfGh123/hqdefault.jpg",
				videoId: "AbCdEfGh123",
			},
			{
				source: "mitlearn",
				kind: "course",
				title: "Synthetic Linear Algebra",
				url: "https://ocw.mit.edu/courses/18-00sc-synthetic-linear-algebra-fall-2011/",
				by: "MIT OpenCourseWare · Prof. Synthetic",
				description: "This course covers matrix theory.",
				year: 2011,
				thumbnail: "https://ocw.mit.edu/image.jpg",
			},
		]);
	});

	it("returns [] and a reason on failure", async () => {
		const fake = fakeSources(() => text("", 500));
		assert.deepEqual(await mitlearn.search(stageQuery(), fake.ctx, fake.onError), []);
		assert.deepEqual(fake.errors, ["MIT Learn / OpenCourseWare answered with an error (HTTP 500)."]);
	});

	it("answers a repeated search from the cache", async () => {
		const fake = fakeSources(route);
		await mitlearn.search(stageQuery(), fake.ctx);
		await mitlearn.search(stageQuery(), fake.ctx);
		assert.equal(fake.calls.length, 1);
	});
});

describe("mitlearn.resolve", () => {
	it("confirms a course by its MIT course number, searching by the course name", async () => {
		const fake = fakeSources(route);
		const hit = await mitlearn.resolve?.({ kind: "course", title: "MIT 18.00SC Linear Algebra" }, stageQuery(), fake.ctx);
		assert.equal(hit?.kind, "course");
		assert.equal(hit?.canon, true);
		assert.equal(fake.calls[0]?.url.searchParams.get("q"), "Linear Algebra", "the search finds names, not numbers");
		assert.deepEqual(fake.calls[0]?.url.searchParams.getAll("resource_type"), ["course"]);
	});

	it("prefers the exact course number over a variant and never takes a longer number", async () => {
		const course = (readable_id: string, slug: string) => ({
			resource_type: "course",
			title: "Linear Algebra",
			readable_id,
			url: `https://ocw.mit.edu/courses/${slug}/`,
			offered_by: OCW,
		});
		const fake = fakeSources(() =>
			json({ results: [course("18.065+spring_2018", "18-065"), course("18.06SC+fall_2011", "18-06sc"), course("18.06+spring_2010", "18-06")] }),
		);
		const hit = await mitlearn.resolve?.({ kind: "course", title: "MIT 18.06: Linear Algebra" }, stageQuery(), fake.ctx);
		assert.equal(hit?.url, "https://ocw.mit.edu/courses/18-06/");
		const variant = await mitlearn.resolve?.({ kind: "course", title: "18.06SC Linear Algebra" }, stageQuery(), fake.ctx);
		assert.equal(variant?.url, "https://ocw.mit.edu/courses/18-06sc/");
	});

	it("confirms a course or video by title", async () => {
		const fake = fakeSources(route);
		const course = await mitlearn.resolve?.({ kind: "course", title: "Synthetic Linear Algebra" }, stageQuery(), fake.ctx);
		assert.equal(course?.url, "https://ocw.mit.edu/courses/18-00sc-synthetic-linear-algebra-fall-2011/");
		const video = await mitlearn.resolve?.({ kind: "video", title: "Vector spaces and subspaces" }, stageQuery(), fake.ctx);
		assert.equal(video?.videoId, "AbCdEfGh123");
	});

	it("returns null on a miss or failure", async () => {
		const fake = fakeSources(route);
		assert.equal(await mitlearn.resolve?.({ kind: "course", title: "Quantum Field Theory" }, stageQuery(), fake.ctx), null);
		const down = fakeSources(() => text("", 500));
		assert.equal(await mitlearn.resolve?.({ kind: "course", title: "Synthetic Linear Algebra" }, stageQuery(), down.ctx), null);
	});

	it("resolves courses and videos", () => {
		assert.deepEqual(mitlearn.resolves, ["course", "video"]);
	});
});
