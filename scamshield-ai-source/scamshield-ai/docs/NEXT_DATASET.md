# Data status and future evaluation

The SmishX audit and grouped model experiment are complete for release 0.2. See DATA_AUDIT.md, ml/MODEL_V2.md and the final report. The corpus has been downloaded, pinned, audited and evaluated.

Future improvements need a new untouched English evaluation set with reliable dates, source/campaign identifiers, explicit phishing versus advertising labels, permitted research use and a separately reviewed subset. Repeated tuning against this release's test partition would invalidate its untouched status.

Keep raw text outside static hosting and source archives. Audit overlap before splitting and use chronological evaluation only when dates have reliable meaning. Additional languages are outside project scope.
