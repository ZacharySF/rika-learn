/** PUT /api/learn/roadmaps/:id/topics/:topicId {state} — mark progress. */
import { LEARN_BAD_JSON, learnBody, learnResponse, setTopicStateRequest } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; topicId: string }> };

export async function PUT(req: Request, { params }: Params) {
	const { id, topicId } = await params;
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : setTopicStateRequest(id, topicId, body));
}
