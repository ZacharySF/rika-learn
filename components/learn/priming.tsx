"use client";
/**
 * PRIMING (docs/learn.md Flow 2): up to three quick multiple-choice
 * questions, one at a time, so the roadmap starts at the learner's level.
 * Every question carries "Not sure", and "Skip questions" goes straight to
 * the build with whatever was answered so far.
 */
import { Loader2Icon } from "lucide-react";
import type { PrimingQuestion } from "@/src/core";
import { Button } from "@/components/ui/button";

export const NOT_SURE = "Not sure";

export function PrimingQuestions({
	question,
	index,
	total,
	onAnswer,
	onSkip,
}: {
	question: PrimingQuestion;
	/** 0-based position of this question. */
	index: number;
	total: number;
	/** Receives the chosen option's label, or "Not sure". */
	onAnswer: (answer: string) => void;
	onSkip: () => void;
}) {
	return (
		<section aria-labelledby="priming-title" className="flex flex-col gap-4" data-testid="priming">
			<div>
				<h2 id="priming-title" className="font-prose text-lg text-foreground">
					A few quick questions so the roadmap starts at your level
				</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					Question {index + 1} of {total}
				</p>
			</div>
			<div className="rounded-lg border border-border bg-card p-4">
				<p className="font-prose text-(length:--lh-prose-size) text-foreground">{question.question}</p>
				<div className="mt-3 flex flex-col gap-2">
					{question.options.map((option) => (
						<Button key={option.id} variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left" onClick={() => onAnswer(option.label)}>
							{option.label}
						</Button>
					))}
					<Button variant="ghost" className="h-auto justify-start whitespace-normal py-2 text-left text-muted-foreground" onClick={() => onAnswer(NOT_SURE)}>
						{NOT_SURE}
					</Button>
				</div>
			</div>
			<div>
				<Button variant="link" className="px-0 text-muted-foreground" onClick={onSkip}>
					Skip questions
				</Button>
			</div>
		</section>
	);
}

/** A clear "we are working on it" line. */
export function WorkingState({ label }: { label: string }) {
	return (
		<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader2Icon aria-hidden className="size-4 animate-spin" />
			{label}
		</p>
	);
}
