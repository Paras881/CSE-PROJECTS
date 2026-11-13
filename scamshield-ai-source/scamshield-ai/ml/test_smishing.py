import json
import unittest
from pathlib import Path
import numpy as np
from audit_smishx import normalized, preprocess, template_groups, digest
from train_smishing import counts_metrics, selected_mask

ROOT=Path(__file__).resolve().parents[1]
class SmishingTests(unittest.TestCase):
    def test_templates_group_identifiers_but_not_unrelated_short_messages(self):
        texts=['Your parcel waits at https://a.example/1 reference 123 today', 'Your parcel waits at https://b.example/2 reference 987 today', 'Meet at lunch', 'See you tomorrow']
        rows=[{'id':digest(normalized(t)),'text':t} for t in texts]
        groups=template_groups(rows)
        self.assertEqual(groups[0],groups[1]);self.assertNotEqual(groups[2],groups[3])

    def test_normalization_masks_identifiers_and_preserves_warning_words(self):
        self.assertEqual(preprocess('Share pass\u200bword 123 at https://x.example'), 'share password zznumber at zzurl')

    def test_frozen_manifest_has_disjoint_groups_and_matches_results(self):
        manifest=json.loads((ROOT/'docs/results/split-manifest.json').read_text())
        metrics=json.loads((ROOT/'dist/data/smishing-metrics.json').read_text())
        rows=manifest['rows'];self.assertEqual(len(rows),1096)
        self.assertEqual(len({r['id'] for r in rows}),len(rows))
        groups={s:{r['group'] for r in rows if r['split']==s} for s in ['train','calibration','test']}
        self.assertFalse(groups['train']&groups['test']);self.assertFalse(groups['train']&groups['calibration']);self.assertFalse(groups['calibration']&groups['test'])
        for s,key in [('train','trainRows'),('calibration','calibrationRows'),('test','testRows')]:
            self.assertEqual(sum(r['split']==s for r in rows),metrics['split'][key])

    def test_saved_confusion_recomputes_from_derived_test_observations(self):
        rows=json.loads((ROOT/'docs/results/test-observations.json').read_text())['records']
        reported=json.loads((ROOT/'dist/data/smishing-metrics.json').read_text())['models']['tfidf']
        actual=counts_metrics(np.array([r['target'] for r in rows]),np.array([r['binaryPrediction'] for r in rows]))
        self.assertEqual(actual['confusion'],reported['confusion'])
        accepted=[r for r in rows if not r['review']]
        self.assertEqual(len(accepted),reported['selective']['acceptedCount'])
        self.assertEqual(sum(r['target']!=r['binaryPrediction'] for r in accepted),2)

    def test_review_policy_boundaries_and_coverage_gate(self):
        result=selected_mask(np.array([.25,.75,.5,.1,.9]),np.array([.2,.2,1,.19,1]),np.array([3,3,5,5,2]))
        self.assertEqual(result.tolist(),[True,True,False,False,False])

    def test_empty_precision_denominator_is_unknown(self):
        result=counts_metrics(np.array([0,1]),np.array([0,0]))
        self.assertIsNone(result['precision']);self.assertEqual(result['recall'],0)

if __name__=='__main__': unittest.main()
