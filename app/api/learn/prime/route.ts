/** POST /api/learn/prime {topic, depth, approved?} — up to three priming questions. */
import { LEARN_BAD_JSON, learnBody, learnResponse, primeRequest } from "@/src/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : await primeRequest(body));
}
