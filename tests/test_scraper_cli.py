"""Both refresh entry points must keep every browser representation current."""
import asyncio
import json

import scraper
from compact_data import unpack_listings
from conftest import make_listing


def test_cli_refresh_rebuilds_both_bundles(make_store, monkeypatch, tmp_path):
    store = make_store([make_listing(id="original")])
    bundle = tmp_path / "data.js"
    compact = tmp_path / "compact.json"
    monkeypatch.setattr(scraper, "PropertyStore", lambda: store)
    monkeypatch.setattr(scraper, "DATA_JS_FILE", str(bundle))
    monkeypatch.setattr(scraper, "COMPACT_FILE", str(compact))
    monkeypatch.setattr(scraper, "load_listings", lambda: json.loads(open(store.properties_file, encoding="utf-8").read()))

    async def collect(*args, **kwargs):
        return [make_listing(id="new", url="https://x/new")]

    monkeypatch.setattr(scraper, "run_live_scraper", collect)
    assert asyncio.run(scraper.refresh(scraper.build_parser().parse_args([]))) == 0
    rows = json.loads(open(store.properties_file, encoding="utf-8").read())
    assert {row['id'] for row in rows} == {'original', 'new'}
    assert unpack_listings(json.loads(compact.read_text(encoding="utf-8"))) == rows
    assert json.loads(bundle.read_text(encoding="utf-8").removeprefix("window.WASHINGTON_PROPERTIES = ").removesuffix(";")) == rows
