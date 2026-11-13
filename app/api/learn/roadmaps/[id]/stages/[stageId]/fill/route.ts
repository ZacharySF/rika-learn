/** POST /api/learn/roadmaps/:id/stages/:stageId/fill {approved?} — load a stage's topics and resources. */
import { LEARN_BAD_JSON, fillStageRequest, learnBody, learnResponse } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; stageId: string }> };

export async function POST(req: Request, { params }: Params) {
	const { id, stageId } = await params;
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : fillStageRequest(id, stageId, body));
}
