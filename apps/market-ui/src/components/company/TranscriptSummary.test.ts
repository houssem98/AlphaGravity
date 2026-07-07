import { isTranscriptDisclaimer } from './TranscriptSummary';

function check(name: string, cond: boolean) {
    if (!cond) throw new Error(`FAIL: ${name}`);
    console.log(`ok - ${name}`);
}

// The exact prod fallback we observed for a thin/absent transcript.
check('flags the prod financials-fallback disclaimer',
    isTranscriptDisclaimer('The provided sources contain only historical revenue and net income figures. They do not include any earnings call transcript excerpts. Therefore, no outlook or summary of an earnings call can be extracted.'));
check('flags "no earnings call"', isTranscriptDisclaimer('There is no earnings call content in the sources.'));
check('passes a real summary', !isTranscriptDisclaimer('**Highlights** Revenue grew 12% to $94B [1]. **Outlook** Management guided to double-digit services growth [2].'));

console.log('\nAll TranscriptSummary checks passed.');
