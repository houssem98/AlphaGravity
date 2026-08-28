// The answer's evidence state, shown honestly.
//
// The backend decides whether an answer is actually supported and sends the
// verdict on the `answer` event as `answer_state`. Nothing in the UI read that
// field, so an answer whose body said "no supporting evidence found" was
// rendered in exactly the same confident frame as a fully cited one.
//
// Deliberately not a confidence score. A number invites a reader to average
// away a hard verdict, and a percentage derived from the model's own
// self-report is not evidence of anything. These states are tied to evidence:
// they come from the retrieval gate, or from citation verdicts computed against
// the passages themselves.

import { AlertTriangle } from 'lucide-react';
import type { AnswerState, GravityCitation } from '../../hooks/useGravitySearch';
import { copyForState, flaggedCount } from '../../lib/answerState';

interface Props {
    state: AnswerState | null;
    citations: GravityCitation[];
}

export default function AnswerStateBanner({ state, citations }: Props) {
    // A flagged citation is worth surfacing even when the gate called the answer
    // answerable: the verdicts are computed after the gate has run.
    const flagged = flaggedCount(citations);
    const copy = copyForState(state);
    if (!copy && flagged === 0) return null;

    const tone = copy?.tone ?? 'warn';
    const color = tone === 'bad' ? 'var(--down)' : 'oklch(0.785 0.170 72)';
    const title = copy?.title ?? `${flagged} citation${flagged === 1 ? '' : 's'} did not check out`;
    const body = copy?.body
        ?? 'At least one citation does not match the source it points at. Open the sources to check.';

    return (
        <div className="rounded-[var(--radius-lg)] border p-3.5 mb-3"
             style={{ borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
                      background: `color-mix(in oklch, ${color} 8%, transparent)` }}>
            <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color }} />
                <div className="min-w-0">
                    <div className="font-display text-[13px] font-semibold" style={{ color }}>{title}</div>
                    <div className="text-[12.5px] text-[var(--text-2)] mt-0.5">{body}</div>
                    {copy && flagged > 0 && (
                        <div className="text-[12px] text-[var(--text-3)] mt-1">
                            {flagged} citation{flagged === 1 ? '' : 's'} also failed verification.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
