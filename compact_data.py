"""Lossless photo URL packing for the browser's smaller startup payload.

The source listing array and offline data.js remain unchanged. Each packed
gallery stores a common prefix, a common suffix, and the original middle parts.
No URLs, listing fields, or photo ordering are discarded.
"""
import json
import os
from os.path import commonprefix

from datastore import BASE_DIR

COMPACT_FILE = os.path.join(BASE_DIR, "properties.compact.json")
FORMAT = "whs-photos-v1"


def pack_listings(listings: list) -> dict:
    records = []
    for listing in listings:
        record = dict(listing)
        photos = listing.get("photos", [])
        if len(photos) > 1:
            prefix = commonprefix(photos)
            suffix = commonprefix([url[len(prefix):][::-1] for url in photos])[::-1]
            end = -len(suffix) if suffix else None
            packed = [prefix, suffix, [url[len(prefix):end] for url in photos]]
            if len(json.dumps(packed, ensure_ascii=False)) < len(json.dumps(photos, ensure_ascii=False)):
                record["photos"] = packed
        records.append(record)
    return {"format": FORMAT, "listings": records}


def unpack_listings(payload: dict) -> list:
    if payload.get("format") != FORMAT:
        raise ValueError("Unsupported compact listing format")
    records = []
    for listing in payload["listings"]:
        record = dict(listing)
        photos = listing.get("photos", [])
        if len(photos) == 3 and isinstance(photos[2], list):
            prefix, suffix, parts = photos
            record["photos"] = [prefix + part + suffix for part in parts]
        records.append(record)
    return records


def render_compact_json(listings: list) -> str:
    return json.dumps(pack_listings(listings), ensure_ascii=False, separators=(",", ":"))


def is_compact_current(listings: list, path: str = COMPACT_FILE) -> bool:
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read() == render_compact_json(listings)
    except FileNotFoundError:
        return False
