/** GET /api/learn/estimate?depth=&phase= — the cost hint and the spending decision. */
import { learnEstimate, learnResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
	const url = new URL(req.url);
	return learnResponse(learnEstimate(url.searchParams.get("depth"), url.searchParams.get("phase")));
}
