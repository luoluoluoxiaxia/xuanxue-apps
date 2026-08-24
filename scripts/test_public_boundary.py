from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts import check_public_boundary as boundary


class PublicBoundaryTest(unittest.TestCase):
    def test_scanner_source_is_not_exempt_from_secret_checks(self) -> None:
        violations: list[str] = []
        synthetic_token = b"ghp_" + (b"A" * 36)

        boundary.collect_byte_violations(
            Path("scripts/check_public_boundary.py"), synthetic_token, violations
        )

        self.assertEqual(violations, ["GitHub token: scripts/check_public_boundary.py"])

    def test_scanner_source_is_not_exempt_from_local_path_checks(self) -> None:
        violations: list[str] = []

        boundary.collect_byte_violations(
            Path("scripts/check_public_boundary.py"),
            b"workspace=" + b"/" + b"Users" + b"/example/private",
            violations,
        )

        self.assertEqual(
            violations, ["local absolute path: scripts/check_public_boundary.py"]
        )

    def test_broken_symlink_remains_in_repository_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            link = root / "private-link"
            link.symlink_to("missing-target")

            self.assertEqual(boundary.repository_files(root), [link])


if __name__ == "__main__":
    unittest.main()
