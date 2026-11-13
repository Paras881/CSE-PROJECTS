The suite contains 42 examples with intended binary labels and 6 ambiguous examples. On the labelled cases, the classifier recorded 8 true positives, 10 false negatives, 24 true negatives and no false positives. Binary F1 was 61.54 percent and recall was 44.44 percent. These misses are a concrete limit of the current text model.

| Category | Cases | Binary correct | Accepted decisions | Accepted correct |
| --- | --- | --- | --- | --- |
| Credential Request | 6 | 50.00% | 2 | 0.00% |
| Advance Fee | 6 | 16.67% | 3 | 0.00% |
| Ordinary | 6 | 100.00% | 5 | 100.00% |
| Legitimate Fee | 6 | 100.00% | 4 | 100.00% |
| Negated Warning | 6 | 100.00% | 6 | 100.00% |
| Advertising | 6 | 100.00% | 4 | 100.00% |
| Context Limited | 6 | Undefined | 2 | Undefined |
| Obfuscation | 6 | 66.67% | 3 | 66.67% |

The policy accepted 27 of 42 labelled cases and made 6 errors among those accepted decisions. It referred 19 of all 48 cases, including 4 of the 6 ambiguous cases. Two ambiguous examples still received a decision; their correctness is unknown. Coverage and abstention alone are therefore insufficient evidence of trustworthy operation.

All six authored scam-warning and negation examples were assigned the intended non-smishing binary label, but direct credential and advance-fee scenarios remained difficult. Six paired transformations produced one binary prediction flip. Case and whitespace changes and selected zero-width insertions are normalized; separated letters, substitutions and paraphrases can change the representation. This small suite does not establish resistance to arbitrary adversarial text.

The interface exposes independent rule evidence and highlights a disagreement when the model gives a non-smishing decision but the rule concern index is at least 55. That display improvement does not change model parameters, research decisions or the reported metrics.
