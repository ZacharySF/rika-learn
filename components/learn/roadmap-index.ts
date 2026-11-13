/**
 * Lookups the roadmap screens need on every render — stage numbers for
 * "Learn first: Stage 2", topic titles for "Needs: …", each topic's stage
 * and plain status, and the progress count. Built once per roadmap
 * version. Pure.
 */
import { roadmapTopicStatuses, type Roadmap, type TopicStatus } from "@/src/core";

export interface RoadmapIndex {
	/** Stage id → its 1-based position in the roadmap. */
	stageNumber: Map<string, number>;
	topicTitle: Map<string, string>;
	/** Topic id → the id of the stage that holds it. */
	topicStage: Map<string, string>;
	status: Map<string, TopicStatus>;
	/** Topics marked done or skipped (the list's "3 of 12 topics done"). */
	done: number;
	total: number;
}

export function indexRoadmap(roadmap: Roadmap): RoadmapIndex {
	const stageNumber = new Map<string, number>();
	const topicTitle = new Map<string, string>();
	const topicStage = new Map<string, string>();
	let done = 0;
	let total = 0;
	roadmap.stages.forEach((stage, i) => {
		stageNumber.set(stage.id, i + 1);
		for (const topic of stage.topics) {
			topicTitle.set(topic.id, topic.title);
			topicStage.set(topic.id, stage.id);
			total++;
			if (topic.state === "done" || topic.state === "skipped") done++;
		}
	});
	return { stageNumber, topicTitle, topicStage, status: roadmapTopicStatuses(roadmap), done, total };
}
