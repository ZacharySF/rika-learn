/** GET /api/learn/roadmaps/:id/export?kind=flashcards|calendar&stage=… — a bridge message for rika. */
import { exportRequest, learnResponse } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
	const { id } = await params;
	return learnResponse(exportRequest(id, new URL(req.url).searchParams));
}
