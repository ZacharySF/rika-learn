/** GET/PUT /api/learn/settings — Settings → Learn (docs/learn.md "HTTP API"). */
import { LEARN_BAD_JSON, learnBody, learnResponse, learnSettingsView, updateLearnSettings } from "@/src/server";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json(learnSettingsView(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
	const body = await learnBody(req);
	return learnResponse(body === null ? LEARN_BAD_JSON : updateLearnSettings(body));
}
