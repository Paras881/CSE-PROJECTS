# Data and model attribution

The current SMS phishing classifier is trained on an English-scope, deduplicated subset of the SmishX research release by Yizhu Wang and coauthors, associated with SOUPS 2025. Source revision: `116a8c827741e0572563f678d25ed04306b1e3ff`. See [the authors' repository](https://github.com/yizhu-joy/SmishX) and [paper](https://www.usenix.org/conference/soups2025/presentation/wang). The upstream repository carries an MIT notice, copyright 2025 YizhuWang. Raw messages and authors' research code are not included in this source package. The status of every upstream message's separate rights has not been independently established; do not interpret this notice as permission to redistribute the raw corpus.

The separate historical SMS spam baseline adapts UCI's SMS Spam Collection, Almeida and Hidalgo, 2011, [DOI 10.24432/C5CC84](https://doi.org/10.24432/C5CC84), provided by UCI under CC BY 4.0. Training transforms its data into Naive Bayes model parameters. Raw corpus files are not bundled.

The offline comparison uses the English `sentence-transformers/all-MiniLM-L6-v2` encoder, revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`, under Apache 2.0. It is downloaded separately for reproduction; its weights are not bundled with the website. The transformer is frozen during this project's experiments.

Browser-local message checks are not used to retrain these models automatically. The published model vocabulary comes from the research corpus, not from visitors' messages. Derived browser history and model vocabularies should not be treated as an anonymization guarantee.

This attribution notice does not set a distribution licence for the project's own code.
