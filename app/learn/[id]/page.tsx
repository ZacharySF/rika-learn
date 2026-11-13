import { RoadmapView } from "@/components/learn/roadmap-view";

/** /learn/<id> — one roadmap. `?view=map` opens the Map; the timeline is
 *  the default. The roadmap itself is fetched client-side so the page
 *  follows the build as it streams. */
export default async function RoadmapPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ view?: string | string[] }>;
}) {
	const [{ id }, { view }] = await Promise.all([params, searchParams]);
	return <RoadmapView key={id} id={id} initialView={view === "map" ? "map" : "timeline"} />;
}
