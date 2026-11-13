"""Tests protecting the training/evaluation boundary and inference arithmetic."""
import unittest

from train_baseline import deduplicate, evaluate, fit, predict, split_rows, tokenize


class BaselineTests(unittest.TestCase):
    def test_conflicting_and_duplicate_groups_do_not_leak(self):
        rows, cleaning = deduplicate([
            ("ham", "Meet at 10!"), ("ham", "MEET at 10."),
            ("spam", "FREE prize"), ("ham", "free prize"), ("spam", "!!!"),
        ])
        self.assertEqual(len(rows), 1)
        self.assertEqual(cleaning["duplicateRowsRemoved"], 1)
        self.assertEqual(cleaning["conflictingRowsRemoved"], 2)
        self.assertEqual(cleaning["emptyTokenRowsRemoved"], 1)

    def test_split_is_repeatable_disjoint_and_stratified(self):
        rows = [(label, f"{label} message {number}") for label in ("ham", "spam") for number in range(20)]
        first = split_rows(rows)
        self.assertEqual(first, split_rows(list(reversed(rows))))
        train, test = first
        self.assertEqual(len(test), 8)
        self.assertEqual(sum(label == "spam" for label, _ in test), 4)
        self.assertFalse(set(train) & set(test))

    def test_vocabulary_uses_only_training_words(self):
        model = fit([("ham", "meeting today"), ("spam", "claim prize")], min_df=1)
        self.assertNotIn("heldout", model["vocabulary"])
        unknown = predict("heldout heldout", model)
        self.assertEqual(unknown["knownTokenCount"], 0)
        self.assertEqual(unknown["totalTokenCount"], 2)
        self.assertEqual(unknown["score"], 0.5)

    def test_token_contributions_reconstruct_log_odds(self):
        import math
        model = fit([("ham", "meeting today"), ("spam", "claim prize")], min_df=1)
        result = predict("claim prize prize meeting", model)
        contribution = sum(item["weight"] for item in result["topTokens"])
        self.assertAlmostEqual(math.log(result["score"] / (1 - result["score"])),
                               model["logPrior"][1] - model["logPrior"][0] + contribution)

    def test_metrics_count_errors_without_hiding_imbalance(self):
        model = fit([("ham", "meeting today"), ("spam", "claim prize")], min_df=1)
        metrics = evaluate([("spam", "claim"), ("ham", "meeting"), ("ham", "prize"), ("spam", "today")], model)
        self.assertEqual(set(metrics["confusionMatrix"].values()), {1})
        self.assertEqual(metrics["precision"], 0.5)
        self.assertEqual(metrics["recall"], 0.5)
        self.assertEqual(metrics["falsePositiveRate"], 0.5)

    def test_ascii_tokenizer_contract(self):
        self.assertEqual(tokenize("FREE free FrEe 123! Café"), ["free", "free", "free", "123", "caf"])


if __name__ == "__main__":
    unittest.main()
