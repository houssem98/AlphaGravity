"""
Web research — the third source class, alongside LOCAL and SEC.

This package adds live web research to the existing evidence architecture. It
does NOT add a second architecture: routing still starts at
`app.core.question_class`, evidence still ends at
`app.core.retrieval.citation_provenance`, and the SEC path
(`evidence_gate` -> `edgar_search`) is untouched by everything in here.

The one rule that shapes every module below: **a search snippet is not
evidence.** A snippet is a pointer. Evidence is a passage read out of a page
that was actually fetched, from a URL that passed the SSRF guard, with the
fetch timestamped and the publication date preserved.
"""
