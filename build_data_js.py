#!/usr/bin/env python3
"""Regenerate browser listing bundles from properties.json (single source of truth).

The workstation prefers the lossless properties.compact.json payload;
data.js exists as a fallback for file:// previews
without a server. Never edit data.js by hand -- rebuild it:

    python build_data_js.py            # rewrite both generated bundles
    python build_data_js.py --check    # exit 1 if either bundle is out of date

Run this after every data refresh, before commit, so the generated files
cannot drift out of sync (validate_data.py and the tests also check it).
"""
import argparse
import json
import sys

from datastore import DATA_JS_FILE, PROPERTIES_FILE, atomic_write_text
from compact_data import COMPACT_FILE, is_compact_current, render_compact_json

PREFIX = "window.WASHINGTON_PROPERTIES = "


def load_listings(path: str = PROPERTIES_FILE) -> list:
    with open(path, "r", encoding="utf-8") as handle:
        listings = json.load(handle)
    if not isinstance(listings, list):
        raise SystemExit(f"{path} must contain a JSON array")
    return listings


def render_data_js(listings: list) -> str:
    """Compact, deterministic JS assignment for the given listings."""
    return PREFIX + json.dumps(listings, ensure_ascii=False, separators=(",", ":")) + ";"


def is_current(listings: list, path: str = DATA_JS_FILE) -> bool:
    try:
        with open(path, "r", encoding="utf-8", newline="") as handle:
            return handle.read() == render_data_js(listings)
    except FileNotFoundError:
        return False


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="verify browser bundles match properties.json without writing")
    args = parser.parse_args(argv)

    listings = load_listings()
    print(f"Loaded {len(listings)} listings from properties.json")

    if args.check:
        if is_current(listings) and is_compact_current(listings):
            print("data.js and properties.compact.json are up to date")
            return 0
        print("Listing bundles are OUT OF DATE; run: python build_data_js.py", file=sys.stderr)
        return 1

    text = render_data_js(listings)
    atomic_write_text(DATA_JS_FILE, text)
    print(f"Wrote data.js ({len(text.encode('utf-8')) / (1024 * 1024):.1f} MB)")
    compact = render_compact_json(listings)
    atomic_write_text(COMPACT_FILE, compact)
    print(f"Wrote properties.compact.json ({len(compact.encode('utf-8')) / (1024 * 1024):.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
