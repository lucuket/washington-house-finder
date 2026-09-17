#!/usr/bin/env python3
"""Regenerate data.js from properties.json (single source of truth).

The live site (GitHub Pages, static) loads listings via async fetch of
properties.json; data.js exists only as a fallback for file:// previews
without a server. Never edit data.js by hand -- rebuild it:

    python3 build_data_js.py

Run this after every scraper run, before commit, so the two files
cannot drift out of sync.
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE_DIR, "properties.json")
DST = os.path.join(BASE_DIR, "data.js")


def main() -> None:
    with open(SRC, "r", encoding="utf-8") as f:
        listings = json.load(f)
    if not isinstance(listings, list):
        raise SystemExit("properties.json must contain a JSON array")
    print(f"Loaded {len(listings)} listings from properties.json")

    payload = json.dumps(listings, ensure_ascii=False, separators=(",", ":"))
    with open(DST, "w", encoding="utf-8") as f:
        f.write("window.WASHINGTON_PROPERTIES = ")
        f.write(payload)
        f.write(";")

    size_mb = os.path.getsize(DST) / (1024 * 1024)
    print(f"Wrote data.js ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
