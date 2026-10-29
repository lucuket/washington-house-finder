import asyncio
import json
import time

import pytest

pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

import app as app_module  # noqa: E402
from conftest import make_listing  # noqa: E402
from datastore import PropertyStore  # noqa: E402


@pytest.fixture
def client(make_store, monkeypatch):
    store = make_store([
        make_listing(id="a", url="https://x/a", city="Spokane", price=300000),
        make_listing(id="b", url="https://x/b", city="Tacoma", price=500000, unknown_fields=["hoa"]),
    ])
    monkeypatch.setattr(app_module, "store", store)
    monkeypatch.delenv("WHS_READ_ONLY", raising=False)
    monkeypatch.delenv("REALTOR_SCRAPING_AUTHORIZED", raising=False)
    monkeypatch.setattr(app_module, "scrape_job", app_module.ScrapeJobTracker())
    with TestClient(app_module.app) as c:
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["listings"] == 2
    assert body["read_only"] is False and body["scraping_authorized"] is False


def test_appearance_assets_are_served_by_the_local_backend(client):
    icon = client.get('/favicon.svg')
    theme = client.get('/theme.css')
    assert icon.status_code == 200
    assert icon.headers['content-type'].startswith('image/svg+xml')
    assert '<svg' in icon.text
    assert theme.status_code == 200
    assert theme.headers['content-type'].startswith('text/css')
    assert ':root[data-theme="dark"]' in theme.text


def test_properties_filter_sort_and_unknown_marker_preserved(client):
    rows = client.get("/api/properties", params={"city": "tacoma"}).json()
    assert [r["id"] for r in rows] == ["b"]
    assert rows[0]["unknown_fields"] == ["hoa"]
    ordered = client.get("/api/properties", params={"sort_by": "price_desc"}).json()
    assert [r["id"] for r in ordered] == ["b", "a"]


def test_single_property_and_404(client):
    assert client.get("/api/properties/a").json()["id"] == "a"
    assert client.get("/api/properties/zzz").status_code == 404


def test_stats_follow_filters(client):
    assert client.get("/api/stats").json()["total_listings"] == 2
    assert client.get("/api/stats", params={"max_price": 350000}).json()["total_listings"] == 1


def test_csv_export_has_bom_and_header(client):
    r = client.get("/api/export/csv")
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert r.content.startswith(b"\xef\xbb\xbfProperty ID")


def test_note_and_favorite_persist_without_rewriting_listings(client):
    props_file = app_module.store.properties_file
    before = open(props_file, "rb").read()
    r = client.patch("/api/properties/a/note", json={"rating": 5, "user_notes": "love it"})
    assert r.status_code == 200 and r.json()["rating"] == 5
    assert client.post("/api/properties/a/favorite").json()["favorite"] is True
    assert client.post("/api/properties/a/favorite", json={"favorite": False}).json()["favorite"] is False
    assert open(props_file, "rb").read() == before
    assert client.patch("/api/properties/a/note", json={"rating": 9}).status_code == 422
    assert client.patch("/api/properties/zzz/note", json={"rating": 1}).status_code == 404


def test_properties_json_reflects_changes(client):
    first = client.get("/properties.json").json()
    assert first[0]["rating"] == 0
    client.patch("/api/properties/a/note", json={"rating": 3})
    assert client.get("/properties.json").json()[0]["rating"] == 3


def test_read_only_mode_blocks_every_write(client, monkeypatch):
    monkeypatch.setenv("WHS_READ_ONLY", "1")
    assert client.patch("/api/properties/a/note", json={"rating": 1}).status_code == 403
    assert client.post("/api/properties/a/favorite").status_code == 403
    assert client.post("/api/search", json={}).status_code == 403
    assert client.get("/api/properties").status_code == 200


def test_static_whitelist(client):
    assert client.get("/").status_code == 200
    assert client.get("/app.js").status_code == 200
    assert client.get("/data/fcc_wa_broadband_by_city.json").status_code == 200
    for hidden in ("/app.py", "/models.py", "/data/user_state.json", "/.gitignore", "/../app.py"):
        assert client.get(hidden).status_code == 404


def test_cors_only_for_localhost(client):
    ok = client.get("/api/health", headers={"Origin": "http://localhost:5500"})
    bad = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5500"
    assert "access-control-allow-origin" not in bad.headers


def _wait_idle(client, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = client.get("/api/status").json()
        if not status["is_active"]:
            return status
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_search_without_authorization_reports_error_and_frees_slot(client):
    assert client.post("/api/search", json={}).status_code == 200
    status = _wait_idle(client)
    assert status["progress"] == 100 and "Scraper error" in status["message"]
    assert client.post("/api/search", json={}).status_code == 200  # slot was released
    _wait_idle(client)


def test_search_rejects_concurrent_jobs_and_merges_results(client, monkeypatch):
    async def slow_scraper(criteria, log_callback, progress_callback, **_):
        await asyncio.sleep(0.3)
        return [make_listing(id="new", url="https://x/new")]

    monkeypatch.setattr(app_module, "run_live_scraper", slow_scraper)
    assert client.post("/api/search", json={}).status_code == 200
    assert client.post("/api/search", json={}).status_code == 409
    status = _wait_idle(client)
    assert status["matched_count"] == 1
    assert client.get("/api/properties/new").status_code == 200
    on_disk = json.load(open(app_module.store.properties_file, encoding="utf-8"))
    assert {p["id"] for p in on_disk} == {"a", "b", "new"}


def test_invalid_search_criteria_rejected(client):
    assert client.post("/api/search", json={"price_min": -5}).status_code == 422
