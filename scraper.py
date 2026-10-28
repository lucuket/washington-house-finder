#!/usr/bin/env python3
"""Refresh listings from the permission-gated live scraper (command line).

    python scraper.py --dry-run                       # collect and report, change nothing
    python scraper.py                                 # merge into properties.json, rebuild data.js
    python scraper.py --markets "Spokane, WA" "Tacoma, WA" --price-max 600000

Requires REALTOR_SCRAPING_AUTHORIZED=yes (see README). Results are *merged*
into the existing dataset by listing URL: IDs and personal research are kept,
listings the scrape did not return are retained, and any failure leaves
properties.json untouched.
"""
import argparse
import asyncio
import sys

from build_data_js import DATA_JS_FILE, load_listings, render_data_js
from datastore import PropertyStore, atomic_write_text
from models import SearchCriteria
from scraper_service import ScrapeError, run_live_scraper


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--markets", nargs="+", metavar="CITY, WA",
                        help="markets to query (default: statewide set in scraper_service.py)")
    parser.add_argument("--dry-run", action="store_true", help="collect and report without saving")
    parser.add_argument("--no-build", action="store_true", help="skip regenerating data.js")
    for name, field in SearchCriteria.model_fields.items():
        if name == "location":
            continue
        parser.add_argument(f"--{name.replace('_', '-')}", dest=name, type=type(field.default),
                            default=None, help=f"{field.description} (default {field.default})")
    return parser


async def refresh(args: argparse.Namespace) -> int:
    overrides = {k: getattr(args, k) for k in SearchCriteria.model_fields
                 if getattr(args, k, None) is not None}
    criteria = SearchCriteria(**overrides).model_dump()

    store = PropertyStore()
    before = store.load()
    print(f"Existing dataset: {before} listings")

    try:
        listings = await run_live_scraper(
            criteria, print, lambda _pct, message: print(message), markets=args.markets)
    except ScrapeError as exc:
        print(f"Refresh stopped: {exc}", file=sys.stderr)
        return 1
    if not listings:
        print("No matching listings; existing data was not changed.")
        return 1
    if args.dry_run:
        print(f"Dry run: {len(listings)} listings matched; nothing saved.")
        return 0

    result = store.merge(listings)
    print(f"Merged {result.total} listings ({result.added} new, {result.updated} updated); "
          f"dataset now {len(store)}.")
    if not args.no_build:
        atomic_write_text(DATA_JS_FILE, render_data_js(load_listings()))
        print("Rebuilt data.js.")
    print("Next: update the snapshot date in index.html and data/listing_snapshot.json, "
          "then run python validate_data.py.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(refresh(build_parser().parse_args())))
