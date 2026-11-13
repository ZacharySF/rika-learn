/** POST /api/learn/roadmaps/:id/retry {approved?} — rebuild a failed roadmap in place. */
import { LEARN_BAD_JSON, learnBody, learnResponse, retryRoadmapRequest } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
	const { id } = await params;
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : retryRoadmapRequest(id, body));
}
