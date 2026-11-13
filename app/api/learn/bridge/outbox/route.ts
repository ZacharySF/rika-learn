/** GET/POST /api/learn/bridge/outbox — messages waiting for rika (docs/learn.md "HTTP outbox"). */
import { LEARN_BAD_JSON, learnBody, learnResponse, outboxAdd, outboxList } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return learnResponse(outboxList());
}

export async function POST(req: Request) {
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : outboxAdd(body));
}
