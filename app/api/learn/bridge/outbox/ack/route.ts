/** POST /api/learn/bridge/outbox/ack {ids} — rika imported these items. */
import { LEARN_BAD_JSON, learnBody, learnResponse, outboxAck } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : outboxAck(body));
}
