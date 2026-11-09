#!/usr/bin/env python3
"""Extract the CNOSSOS-EU railway source database for the noise engine (ADR-0038).

Usage:
  python3 tools/noise/extract_cnossos_rail.py DIR_2015 DIR_2021_PDF
  python3 tools/noise/extract_cnossos_rail.py DIR_2015 DIR_2021_PDF --check

DIR_2015 is the XHTML of Commission Directive (EU) 2015/996 as published in OJ L 168, 1.7.2015
(https://publications.europa.eu/resource/cellar/a2af495c-1fe0-11e5-a342-01aa75ed71a1.0006.02/DOC_1).
DIR_2021_PDF is the PDF of Commission Delegated Directive (EU) 2021/1226, OJ L 269, 28.7.2021.

The script reads Appendix G (tables G-1 to G-7) of the 2015 text, applies the amendments of
2021/1226 point (20) (new rail roughness, contact filter, track transfer, impact and bridge
tables; the corrected Table G-5 values) and writes crates/noise/data/cnossos-rail.json.
Nothing is typed in by hand: every number comes from one of the two official texts.

Needs `pdftotext` (poppler-utils) for the 2021 PDF.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "crates" / "noise" / "data" / "cnossos-rail.json"

# Nominal 1/3 octave centre frequencies, Hz (the 2015 tables print 316, 3 160 and 6 350; 2021/1226
# corrects them to the nominal values).
FREQS = [
    50,
    63,
    80,
    100,
    125,
    160,
    200,
    250,
    315,
    400,
    500,
    630,
    800,
    1000,
    1250,
    1600,
    2000,
    2500,
    3150,
    4000,
    5000,
    6300,
    8000,
    10000,
]
# Nominal 1/3 octave wavelengths of the 2021 tables, mm.
WAVES = [
    2000,
    1600,
    1250,
    1000,
    800,
    630,
    500,
    400,
    315,
    250,
    200,
    160,
    125,
    100,
    80,
    63,
    50,
    40,
    31.5,
    25,
    20,
    16,
    12.5,
    10,
    8,
    6.3,
    5,
    4,
    3.15,
    2.5,
    2,
    1.6,
    1.25,
    1,
    0.8,
]
# The 2015 wheel roughness table starts at 1 000 mm and prints 120, 12, 3,2 and 1,2 mm for the
# nominal 125, 12.5, 3.15 and 1.25 mm bands.
WAVES_2015 = WAVES[3:]


def num(s: str) -> float:
    """'– 15,0', '- 0,2', '–1,1' → float."""
    t = s.replace("–", "-").replace("−", "-").replace(" ", "").replace(",", ".")
    return float(t)


class _Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables: list[list[list[dict]]] = []
        self.stack: list[list[list[dict]]] = []
        self.cell: dict | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table":
            self.stack.append([])
        elif tag == "tr" and self.stack:
            self.stack[-1].append([])
        elif tag in ("td", "th") and self.stack:
            self.cell = {
                "t": "",
                "cs": int(a.get("colspan", 1)),
                "rs": int(a.get("rowspan", 1)),
            }

    def handle_endtag(self, tag):
        if (
            tag in ("td", "th")
            and self.cell is not None
            and self.stack
            and self.stack[-1]
        ):
            self.stack[-1][-1].append(self.cell)
            self.cell = None
        elif tag == "table" and self.stack:
            self.tables.append(self.stack.pop())

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["t"] += data


def _grid(rows) -> list[list[str]]:
    g: dict[tuple[int, int], str] = {}
    for r, row in enumerate(rows):
        c = 0
        for cell in row:
            while (r, c) in g:
                c += 1
            txt = re.sub(
                r"\s+", " ", html.unescape(cell["t"]).replace("\xa0", " ")
            ).strip()
            for dr in range(cell["rs"]):
                for dc in range(cell["cs"]):
                    g[(r + dr, c + dc)] = txt
            c += cell["cs"]
    nr = max(k[0] for k in g) + 1
    nc = max(k[1] for k in g) + 1
    return [[g.get((r, c), "") for c in range(nc)] for r in range(nr)]


def appendix_g_2015(path: Path) -> list[list[list[str]]]:
    s = path.read_text(encoding="utf-8")
    a = s.find("Database for railway source")
    b = s.find("Database for industrial source", a)
    if a < 0 or b < 0:
        sys.exit(f"{path}: Appendix G not found")
    p = _Tables()
    p.feed(s[a:b])
    tables = [_grid(t) for t in p.tables]
    if len(tables) != 10:
        sys.exit(f"{path}: expected 10 tables in Appendix G, found {len(tables)}")
    return tables


def data_rows(t: list[list[str]], unit: str) -> list[list[str]]:
    return [
        r
        for r in t
        if r[0].endswith(unit) and re.match(r"^[\d ,]+ " + unit + "$", r[0])
    ]


def columns_2015(t, unit, skip_minmax: int, n_rows: int) -> list[list[float]]:
    """Data columns after the label and the min/max columns."""
    rows = data_rows(t, unit)
    if len(rows) != n_rows:
        sys.exit(f"2015 table: expected {n_rows} rows, found {len(rows)}")
    first = 1 + skip_minmax
    return [[num(r[c]) for r in rows] for c in range(first, len(rows[0]))]


def pdf_text(path: Path) -> list[str]:
    out = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return out.splitlines()


_ROW = re.compile(r"^\s*(\d[\d ]*(?:,\d+)?)\s*(mm|Hz)\s+(.*?)\s*[’']?\s*$")


def pdf_block(
    lines: list[str], start: str, stop: str, unit: str, ncol: int
) -> list[list[float]]:
    """Rows of one replaced table in the 2021 PDF, between two marker lines; columns."""
    i = next(k for k, l in enumerate(lines) if start in l)
    j = next(k for k in range(i + 1, len(lines)) if stop in lines[k])
    rows = []
    for l in lines[i:j]:
        m = _ROW.match(l)
        if not m or m.group(2) != unit:
            continue
        vals = re.findall(r"[-–]?\s?\d+,\d", m.group(3))
        if len(vals) != ncol:
            sys.exit(
                f"2021 PDF: row {l.strip()!r} has {len(vals)} values, expected {ncol}"
            )
        rows.append([num(v) for v in vals])
    n = len(WAVES) if unit == "mm" else len(FREQS)
    if len(rows) != n:
        sys.exit(f"2021 PDF ({start!r}): expected {n} rows, found {len(rows)}")
    return [list(c) for c in zip(*rows)]


def render(p2015: Path, p2021: Path) -> str:
    g = appendix_g_2015(p2015)
    lines = pdf_text(p2021)
    if not any("2021/1226" in l for l in lines[:20]):
        sys.exit(f"{p2021}: not Delegated Directive (EU) 2021/1226")

    # G-1, first table (wheel roughness; not amended in 2021). 1 000 mm to 0,8 mm.
    wheel = columns_2015(g[0], "mm", 2, len(WAVES_2015))
    hdr = g[0][1]
    assert hdr[3:] == ["Cast iron tread brake", "Composite brake", "Disk brake"], hdr
    # The 2015 table has no bands above 1 000 mm: the 1 000 mm value applies there.
    wheel = [[c[0]] * 3 + c for c in wheel]

    # G-1, second table (rail roughness), replaced by 2021/1226 (20)(a).
    rail = pdf_block(
        lines,
        "in Table G-1, the second table is replaced",
        "Table G-2 is replaced",
        "mm",
        2,
    )
    # G-2 (contact filter), replaced by (20)(b).
    a3 = pdf_block(
        lines, "Table G-2 is replaced", "the first table of Table G-3", "mm", 5
    )
    # G-3 first table (track transfer), replaced by (20)(c).
    htr = pdf_block(
        lines, "the first table of Table G-3", "Table G-3 is amended", "Hz", 8
    )
    # G-3 second and third tables (wheel, superstructure): 2015 values, labels corrected (20)(d).
    hveh = columns_2015(g[4], "Hz", 2, len(FREQS))
    assert g[4][1][3:] == [
        "Wheel with diameter 920 mm, no measure",
        "Wheel with diameter 840 mm, no measure",
        "Wheel with diameter 680 mm, no measure",
        "Wheel with diameter 1 200 mm, no measure",
    ], g[4][1]
    hsup = columns_2015(g[5], "Hz", 2, len(FREQS))
    # G-4 (impact), replaced by (20)(e).
    impact = pdf_block(lines, "Table G-4 is replaced", "in Table G-5:", "mm", 1)
    # G-5 (traction), 2015 values with the 6 300 Hz row of the 2 200 kW diesel locomotive
    # corrected by (20)(f) to 81,4 (source A) and 80,7 (source B).
    trac = columns_2015(g[7], "Hz", 4, len(FREQS))
    names = g[7][1][5::2]
    assert names == [
        "Diesel locomotive (c. 800 kW)",
        "Diesel locomotive (c. 2 200 kW)",
        "Diesel multiple unit",
        "Electric locomotive",
        "Electric multiple unit",
    ], names
    fix = next(l for l in lines if "4th column, 25th row" in l)
    fa = num(re.search(r"‘([-–\d, ]+)’", fix).group(1))
    fix = next(l for l in lines if "5th column, 25th row" in l)
    fb = num(re.search(r"‘([-–\d, ]+)’", fix).group(1))
    i6300 = FREQS.index(6300)
    assert trac[2][i6300] == 31.4 and trac[3][i6300] == 30.7, (
        trac[2][i6300],
        trac[3][i6300],
    )
    trac[2][i6300], trac[3][i6300] = fa, fb
    # G-6 (aerodynamic), 2015 values (labels corrected in 2021).
    aero_rows = data_rows(g[8], "Hz")
    assert len(aero_rows) == len(FREQS)
    assert g[8][1][5:7] == ["α1", "α2"] and g[8][2][5:7] == ["50", "50"], g[8][:3]
    aero1 = [num(r[5]) for r in aero_rows]
    aero2 = [num(r[6]) for r in aero_rows]
    # G-7 (bridge transfer), replaced by (20)(h).
    hbr = pdf_block(lines, "Table G-7 is replaced", "Appendix I is amended", "Hz", 2)

    r1 = lambda xs: [round(x, 1) for x in xs]
    data = {
        "_comment": "Generated by tools/noise/extract_cnossos_rail.py from the official texts. Do not edit by hand. 1/3 octave bands; wavelengths in mm from long to short, frequencies in Hz.",
        "source": "Commission Directive (EU) 2015/996, Annex II, Appendix G, as amended by Commission Delegated Directive (EU) 2021/1226, Annex point (20).",
        "check": "read: extracted from the OJ L 168 (1.7.2015) XHTML and the OJ L 269 (28.7.2021) PDF.",
        "wavelengths_mm": WAVES,
        "frequencies_hz": FREQS,
        "wheel_roughness": {
            "cast_iron": r1(wheel[0]),
            "composite": r1(wheel[1]),
            "disc": r1(wheel[2]),
        },
        "rail_roughness": {"e": r1(rail[0]), "m": r1(rail[1])},
        "contact_filter": {
            "wheel_load_50kn_d360": r1(a3[0]),
            "wheel_load_50kn_d680": r1(a3[1]),
            "wheel_load_50kn_d920": r1(a3[2]),
            "wheel_load_25kn_d920": r1(a3[3]),
            "wheel_load_100kn_d920": r1(a3[4]),
        },
        "track_transfer": {
            "mono_soft": r1(htr[0]),
            "mono_medium": r1(htr[1]),
            "mono_hard": r1(htr[2]),
            "bi_soft": r1(htr[3]),
            "bi_medium": r1(htr[4]),
            "bi_hard": r1(htr[5]),
            "wooden": r1(htr[6]),
            "direct_fastening_bridge": r1(htr[7]),
        },
        "wheel_transfer": {
            "d920": r1(hveh[0]),
            "d840": r1(hveh[1]),
            "d680": r1(hveh[2]),
            "d1200": r1(hveh[3]),
        },
        "superstructure_transfer": {"eu_standard": r1(hsup[0])},
        "impact_roughness_single": r1(impact[0]),
        "traction": {
            "diesel_loco_800kw": {"a": r1(trac[0]), "b": r1(trac[1])},
            "diesel_loco_2200kw": {"a": r1(trac[2]), "b": r1(trac[3])},
            "dmu": {"a": r1(trac[4]), "b": r1(trac[5])},
            "electric_loco": {"a": r1(trac[6]), "b": r1(trac[7])},
            "emu": {"a": r1(trac[8]), "b": r1(trac[9])},
        },
        "aerodynamic": {
            "v0_kmh": 300.0,
            "vehicle_length_m": 20.0,
            "alpha_a": 50.0,
            "alpha_b": 50.0,
            "lw_a": r1(aero1),
            "lw_b": r1(aero2),
        },
        "bridge_transfer": {"plus10": r1(hbr[0]), "plus15": r1(hbr[1])},
    }
    for name, arr in [("wheel", wheel), ("rail", rail), ("a3", a3), ("impact", impact)]:
        assert all(len(c) == len(WAVES) for c in arr), name
    for name, arr in [
        ("htr", htr),
        ("hveh", hveh),
        ("hsup", hsup),
        ("trac", trac),
        ("hbr", hbr),
    ]:
        assert all(len(c) == len(FREQS) for c in arr), name
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("dir2015", type=Path)
    ap.add_argument("dir2021", type=Path)
    ap.add_argument("--check", action="store_true", help="fail if the JSON differs")
    a = ap.parse_args()
    text = render(a.dir2015, a.dir2021)
    if a.check:
        if OUT.read_text(encoding="utf-8") != text:
            print(
                f"{OUT.relative_to(ROOT)} differs from the official texts",
                file=sys.stderr,
            )
            return 1
        print("cnossos-rail.json matches the official texts")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
