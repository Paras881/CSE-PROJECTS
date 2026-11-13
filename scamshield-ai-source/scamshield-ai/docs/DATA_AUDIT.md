# English scope data audit

The audit ran on 7 November 2026 against SmishX commit `116a8c827741e0572563f678d25ed04306b1e3ff`. The SHA-256 of the 1,200-row CSV is `8d65e373b17477c34e8f1c619e6f59d249e8fca21276cabdd03a55d11a469285`.

After removing 93 normalized duplicate rows and 11 inspected non-English or corrupted records, 1,096 messages remain: 604 legitimate, 267 spam and 225 smishing. No empty rows, invalid labels or conflicting normalized labels were found. The exclusion hashes are in `ml/audit_smishx.py`. Raw messages are excluded from the report and static application.

Normalization uses NFKC, lowercase, zero-width removal and whitespace collapse. Approximate grouping masks URLs, emails and numbers, joins exact masked templates, and joins word-trigram Jaccard similarity at least 0.8 for messages with at least six tokens. Connected components give 948 groups; 80 contain multiple messages and the largest has 14. These groups reduce template leakage but are not verified campaigns.

The three metadata flags each contain two malformed values and are unused for learning. The retained corpus has 509 exact normalized overlaps with UCI SMS Spam Collection. The historical UCI model remains a separate spam baseline and supplies no parameters or examples to the new experiment. Its benchmark cannot validate the new phishing model independently.

The authors' paper describes active-URL selection and public datasets, plus 22 legitimate personal-archive messages. The CSV lacks per-row timestamps, source identifiers and campaign identifiers. There is no temporal or source-generalization claim. The paper's malicious target combines spam and phishing; our positive target is smishing only, so its published accuracy is not directly comparable.

English is the sole product scope. Script checks and inspected exclusions do not certify the language of every short or transliterated message. The app requests English and does not implement reliable automatic language identification.

The upstream repository carries an MIT notice. Rights over each underlying message have not been independently established; raw data stays outside the source package. See `NOTICE.md` and `REFERENCES.md`. Machine-readable audit: `docs/results/data-audit.json`. Reproduction: `ml/MODEL_V2.md`.
