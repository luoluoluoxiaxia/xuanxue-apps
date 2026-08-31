from __future__ import annotations

import unittest

from scripts.ci_scope import classify


class CiScopeTests(unittest.TestCase):
    def test_web_only_change_skips_android(self):
        self.assertEqual(classify(["web/public/app.js"]), (True, False))

    def test_android_only_change_skips_web(self):
        self.assertEqual(
            classify(["android/app/src/main/AndroidManifest.xml"]),
            (False, True),
        )

    def test_contract_and_ci_changes_run_both(self):
        self.assertEqual(
            classify(["contracts/openapi/client.openapi.json"]),
            (True, True),
        )
        self.assertEqual(classify([".github/workflows/ci.yml"]), (True, True))

    def test_docs_and_boundary_only_changes_skip_heavy_builds(self):
        self.assertEqual(classify(["README.md", "docs/release.md"]), (False, False))
        self.assertEqual(
            classify(["scripts/check_public_boundary.py"]),
            (False, False),
        )

    def test_unknown_paths_fail_safe_and_initial_runs_force_both(self):
        self.assertEqual(classify(["new-client/runtime.txt"]), (True, True))
        self.assertEqual(classify([], force_all=True), (True, True))


if __name__ == "__main__":
    unittest.main()
