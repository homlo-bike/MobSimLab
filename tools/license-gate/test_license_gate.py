"""Tests for the licence gate. Run: python -m pytest tools/license-gate."""

import license_gate as g


def test_allows_permissive_and_dual():
    assert g.expression_allowed("MIT")
    assert g.expression_allowed("MIT OR Apache-2.0")
    assert g.expression_allowed("(MIT AND Zlib)")
    assert g.expression_allowed("EPL-2.0 OR GPL-2.0-or-later")  # SUMO
    assert g.expression_allowed("Apache Software License")
    assert g.expression_allowed("Apache-2.0 WITH LLVM-exception")
    assert g.expression_allowed("Mozilla Public License 2.0 (MPL 2.0)")


def test_blocks_gpl2_only_and_non_free():
    assert not g.expression_allowed("GPL-2.0-only")
    assert not g.expression_allowed("GPL-2.0")
    assert not g.expression_allowed("SSPL-1.0")
    assert not g.expression_allowed("BUSL-1.1")
    assert not g.expression_allowed("CC-BY-NC-4.0")
    assert not g.expression_allowed("EPL-2.0")
    assert not g.expression_allowed("")
    assert not g.expression_allowed("GPL-2.0-only WITH LLVM-exception")


def test_check_reports_offenders_and_honours_package_overrides():
    failures = g.check([
        ("npm", "left-pad", "MIT"),
        ("npm", "evil-gpl2", "GPL-2.0-only"),
        ("python", "aequilibrae", "Custom"),
    ])
    assert failures == ["npm: evil-gpl2: 'GPL-2.0-only' is not allowed by the licence policy"]
