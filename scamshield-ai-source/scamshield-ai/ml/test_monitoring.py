import unittest
from monitoring_experiment import ks_distance, summary


class MonitoringExperimentTests(unittest.TestCase):
    def test_ties_in_cdf_distance(self):
        self.assertEqual(ks_distance([1, 1, 2, 3], [1, 2, 2, 3]), .25)
        self.assertEqual(ks_distance([0, 0], [1, 1]), 1.)

    def test_delay_summary_includes_missed_runs_and_prechange_alarms(self):
        result = summary([[2, 12], [], [20]], True, onset=10, observed_length=30)
        self.assertEqual(result["preChangeFalseAlarmRate"], 1/3)
        self.assertEqual(result["detectedAfterChange"], 2)
        self.assertEqual(result["undetectedAfterChange"], 1)
        self.assertEqual(result["medianDelayEventsAmongDetected"], 6.)
        self.assertEqual(result["detectionRate"], 2/3)

    def test_stable_controls_do_not_receive_fictitious_detection_delays(self):
        result = summary([[], [50]], False)
        self.assertEqual(result["stableRunFalseAlarmRate"], .5)
        self.assertIsNone(result["detectionRate"])
        self.assertIsNone(result["medianDelayEventsAmongDetected"])


if __name__ == "__main__":
    unittest.main()
