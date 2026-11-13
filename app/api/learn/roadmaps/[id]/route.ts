/** GET/DELETE /api/learn/roadmaps/:id. */
import { deleteRoadmap, getRoadmap, learnResponse } from "@/src/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
	const { id } = await params;
	return learnResponse(getRoadmap(id));
}

export async function DELETE(_req: Request, { params }: Params) {
	const { id } = await params;
	return learnResponse(deleteRoadmap(id));
}
