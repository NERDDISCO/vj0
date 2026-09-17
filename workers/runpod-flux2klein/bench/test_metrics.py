import unittest
from metrics import distribution, parse_sizes, throughput


class MetricsTests(unittest.TestCase):
    def test_empty_does_not_masquerade_as_zero_latency(self):
        self.assertIsNone(distribution([])["p95"])

    def test_percentiles_include_tail_stall(self):
        d = distribution([10] * 95 + [210] * 5)
        self.assertEqual(d["p50"], 10)
        self.assertAlmostEqual(d["p95"], 20)
        self.assertEqual(d["p99"], 210)

    def test_wall_time_fps_includes_non_gpu_work(self):
        self.assertEqual(throughput(60, 3), 20)
        with self.assertRaises(ValueError):
            throughput(1, 0)

    def test_nonfinite_measurements_rejected(self):
        for invalid in (float("nan"), float("inf"), -1):
            with self.assertRaises(ValueError):
                distribution([invalid])

    def test_resolution_validation(self):
        self.assertEqual(parse_sizes("512x288,1024x576"), [(512, 288), (1024, 576)])
        for invalid in ("512x289", "0x0", "8192x8192"):
            with self.assertRaises(ValueError):
                parse_sizes(invalid)


if __name__ == "__main__":
    unittest.main()
