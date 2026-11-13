/** GET /api/learn/roadmaps — saved roadmaps; POST {topic, depth, answers, approved?} — start a build. */
import { LEARN_BAD_JSON, createRoadmapRequest, learnBody, learnResponse, listRoadmaps } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return learnResponse(listRoadmaps());
}

export async function POST(req: Request) {
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : createRoadmapRequest(body));
}
