"""Listing data layer for Washington Home Search.

Single place that knows how listings are normalized, stored, merged, and
persisted. It has no web-framework or scraping dependencies so the API
(``app.py``), the refresh CLI (``scraper.py``), the validator
(``validate_data.py``), and the tests can all share it.

Storage model
-------------
* ``properties.json``       Listing data. Published with the static site, so it
                            never holds personal research once written by this
                            module (favorite/rating/notes are reset to defaults).
* ``data/user_state.json``  Personal favorites, ratings, and notes keyed by
                            listing ID. Git-ignored; written atomically and
                            tiny, so toggling a favorite never rewrites the
                            multi-megabyte listing file.

Missing numeric specifications are stored as ``0`` plus the field name in the
listing's ``unknown_fields`` list; use :func:`has_metric` to tell an unknown
value from a reported zero.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import tempfile
import threading
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger("washington-home-search.datastore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROPERTIES_FILE = os.path.join(BASE_DIR, "properties.json")
DATA_JS_FILE = os.path.join(BASE_DIR, "data.js")
USER_STATE_FILE = os.path.join(BASE_DIR, "data", "user_state.json")

USER_FIELDS = ("favorite", "rating", "user_notes")
USER_DEFAULTS: Dict[str, Any] = {"favorite": False, "rating": 0, "user_notes": ""}

# Numeric specs that may be unknown (zero + entry in ``unknown_fields``).
METRIC_FIELDS = ("beds", "baths", "sqft", "lot_sqft", "year_built", "hoa", "garage")

# Provenance fields passed through untouched when a listing carries them.
PASSTHROUGH_FIELDS = (
    "unknown_fields", "source", "source_property_id", "source_listing_id",
    "status", "mls_status", "source_updated_at", "snapshot_date",
)

# Rough bounding box for Washington state; coordinates outside are rejected.
WA_LAT_RANGE = (45.4, 49.1)
WA_LNG_RANGE = (-124.9, -116.8)


# -----------------------------------------------------------------------------
# Coercion helpers
# -----------------------------------------------------------------------------

def to_float(value: Any, default: float = 0.0) -> float:
    """Best-effort float conversion that never raises and rejects NaN/inf."""
    if value is None or isinstance(value, bool):
        return default
    try:
        if isinstance(value, str):
            value = value.replace(",", "").replace("$", "").strip()
        out = float(value)
    except (TypeError, ValueError):
        return default
    return out if math.isfinite(out) else default


def to_int(value: Any, default: int = 0) -> int:
    """Best-effort int conversion (truncating) that never raises."""
    return int(to_float(value, float(default)))


def has_metric(listing: Dict[str, Any], field: str) -> bool:
    """True when ``field`` holds a reported value rather than an unknown.

    Listings that carry ``unknown_fields`` are authoritative; legacy records
    without it fall back to treating ``0`` as unknown.
    """
    value = listing.get(field)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return False
    unknown = listing.get("unknown_fields")
    if isinstance(unknown, list):
        return field not in unknown
    return value > 0


def stable_listing_id(address: str, city: str, price: int) -> str:
    """Deterministic ID for a listing that arrives without one."""
    digest = hashlib.md5(f"{address}_{city}_{price}".encode(), usedforsecurity=False).hexdigest()
    return f"prop_{digest[:12]}"


def clean_photos(photos: Any) -> List[str]:
    """Return de-duplicated http(s) photo URLs from a list or legacy string."""
    if isinstance(photos, str):
        try:
            photos = json.loads(photos.replace("'", '"'))
        except ValueError:
            photos = [p.strip() for p in photos.split(",") if p.strip()]
    if not isinstance(photos, (list, tuple)):
        return []
    seen = set()
    out: List[str] = []
    for photo in photos:
        text = str(photo).strip()
        if text.startswith(("http://", "https://")) and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _coordinate(value: Any, bounds: tuple) -> Optional[float]:
    if value is None or value == "":
        return None
    number = to_float(value, float("nan"))
    if not math.isfinite(number) or not bounds[0] <= number <= bounds[1]:
        return None
    return number


def normalize_property(item: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce a raw record into the strict listing schema.

    Never raises on malformed numeric fields; unusable values become ``0`` /
    ``None``. Raises ``ValueError`` only if ``item`` is not a mapping.
    """
    if not isinstance(item, dict):
        raise ValueError("listing record must be an object")

    address = str(item.get("address") or "Address Available On Request")
    city = str(item.get("city") or "Washington").title()
    price = to_int(item.get("price"))
    baths = to_float(item.get("baths"))
    if baths.is_integer():
        baths = int(baths)  # keep whole-number baths as "2", not "2.0", in JSON

    res: Dict[str, Any] = {
        "id": str(item.get("id") or stable_listing_id(address, city, price)),
        "address": address,
        "city": city,
        "state": str(item.get("state") or "WA"),
        "zip": str(item.get("zip") or ""),
        "price": price,
        "beds": to_int(item.get("beds")),
        "baths": baths,
        "sqft": to_int(item.get("sqft")),
        "lot_sqft": to_int(item.get("lot_sqft")),
        "year_built": to_int(item.get("year_built")),
        "hoa": to_int(item.get("hoa")),
        "garage": max(0, to_int(item.get("garage"))),
        "description": str(item.get("description") or ""),
        "url": str(item.get("url") or ""),
        "photos": clean_photos(item.get("photos", [])),
        "latitude": _coordinate(item.get("latitude"), WA_LAT_RANGE),
        "longitude": _coordinate(item.get("longitude"), WA_LNG_RANGE),
        "favorite": bool(item.get("favorite", False)),
        "rating": min(5, max(0, to_int(item.get("rating")))),
        "user_notes": str(item.get("user_notes") or ""),
    }
    # A coordinate is only meaningful as a pair.
    if res["latitude"] is None or res["longitude"] is None:
        res["latitude"] = res["longitude"] = None

    if "broadband" in item:
        res["broadband"] = item["broadband"]
    for field in PASSTHROUGH_FIELDS:
        if field in item:
            res[field] = item[field]
    # An omitted/invalid metric must never become a reported zero during coercion.
    supplied_unknown = item.get("unknown_fields")
    unknown = [f for f in supplied_unknown if f in METRIC_FIELDS] if isinstance(supplied_unknown, list) else []
    for field in METRIC_FIELDS:
        raw = to_float(item.get(field), float("nan"))
        invalid = (not math.isfinite(raw) or raw < 0
                   or (field in ("sqft", "year_built") and raw == 0))
        legacy_zero = not isinstance(supplied_unknown, list) and raw == 0
        if invalid or legacy_zero or field in unknown:
            res[field] = 0
            if field not in unknown:
                unknown.append(field)
    res["unknown_fields"] = unknown
    return res


# -----------------------------------------------------------------------------
# Atomic file writes
# -----------------------------------------------------------------------------

def atomic_write_text(path: str, text: str) -> None:
    """Write ``text`` to ``path`` so readers never observe a partial file."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_listings(listings: Iterable[Dict[str, Any]], path: str = PROPERTIES_FILE) -> None:
    """Persist publishable listing data (personal research fields reset)."""
    publishable = [{**p, **USER_DEFAULTS} for p in listings]
    atomic_write_text(path, json.dumps(publishable, indent=2, ensure_ascii=False))


# -----------------------------------------------------------------------------
# Store
# -----------------------------------------------------------------------------

@dataclass
class MergeResult:
    added: int = 0
    updated: int = 0

    @property
    def total(self) -> int:
        return self.added + self.updated


class PropertyStore:
    """Thread-safe in-memory listing store with personal-research overlay.

    Records are treated as immutable: updates replace the dict, so lists
    returned by :meth:`all` stay internally consistent for concurrent readers.
    """

    def __init__(self, properties_file: str = PROPERTIES_FILE,
                 user_state_file: str = USER_STATE_FILE) -> None:
        self.properties_file = properties_file
        self.user_state_file = user_state_file
        self._lock = threading.RLock()
        self._listings: List[Dict[str, Any]] = []
        self._index: Dict[str, int] = {}
        self._user_state: Dict[str, Dict[str, Any]] = {}
        # Bumped on every change so callers can cache derived payloads.
        self.version = 0

    # -- loading ---------------------------------------------------------------

    def load(self) -> int:
        """(Re)load listings and user state from disk; returns listing count.

        A missing or unreadable listing file leaves the store empty but never
        touches the file on disk. Individual malformed records are skipped
        with a warning instead of discarding the whole dataset.
        """
        raw: List[Any] = []
        try:
            with open(self.properties_file, "r", encoding="utf-8") as handle:
                loaded = json.load(handle)
            if isinstance(loaded, list):
                raw = loaded
            else:
                logger.error("%s must contain a JSON array", self.properties_file)
        except FileNotFoundError:
            logger.warning("Properties file not found at %s", self.properties_file)
        except (OSError, ValueError) as exc:
            logger.error("Failed to read %s: %s", self.properties_file, exc)

        listings: List[Dict[str, Any]] = []
        skipped = 0
        for record in raw:
            try:
                listings.append(normalize_property(record))
            except ValueError:
                skipped += 1
        if skipped:
            logger.warning("Skipped %d malformed listing records", skipped)

        with self._lock:
            self._user_state = self._read_user_state()
            self._migrate_legacy_user_state(listings)
            self._listings = [self._with_user_state(p) for p in listings]
            self._reindex()
            self.version += 1
        logger.info("Loaded %d listings from %s", len(self._listings), self.properties_file)
        return len(self._listings)

    def _read_user_state(self) -> Dict[str, Dict[str, Any]]:
        try:
            with open(self.user_state_file, "r", encoding="utf-8") as handle:
                state = json.load(handle)
            if isinstance(state, dict):
                return {str(k): v for k, v in state.items() if isinstance(v, dict)}
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as exc:
            logger.error("Failed to read %s: %s", self.user_state_file, exc)
        return {}

    def _migrate_legacy_user_state(self, listings: List[Dict[str, Any]]) -> None:
        """Copy research stored inside properties.json (older versions) into
        the user-state file so it is no longer tied to the published data."""
        migrated = False
        for p in listings:
            if p["id"] in self._user_state:
                continue
            if any(p[f] != USER_DEFAULTS[f] for f in USER_FIELDS):
                self._user_state[p["id"]] = {f: p[f] for f in USER_FIELDS}
                migrated = True
        if migrated:
            self._save_user_state()
            logger.info("Migrated legacy favorites/ratings/notes to %s", self.user_state_file)

    def _save_user_state(self, state: Optional[Dict[str, Dict[str, Any]]] = None) -> None:
        atomic_write_text(self.user_state_file,
                          json.dumps(self._user_state if state is None else state,
                                     indent=2, ensure_ascii=False, sort_keys=True))

    def _with_user_state(self, listing: Dict[str, Any]) -> Dict[str, Any]:
        state = self._user_state.get(listing["id"])
        if not state:
            return listing
        merged = dict(listing)
        if isinstance(state.get("favorite"), bool):
            merged["favorite"] = state["favorite"]
        if isinstance(state.get("rating"), int) and not isinstance(state["rating"], bool):
            merged["rating"] = min(5, max(0, state["rating"]))
        if isinstance(state.get("user_notes"), str):
            merged["user_notes"] = state["user_notes"]
        return merged

    def _reindex(self) -> None:
        self._index = {p["id"]: i for i, p in enumerate(self._listings)}

    # -- reads -----------------------------------------------------------------

    def all(self) -> List[Dict[str, Any]]:
        """Snapshot list of listings. Callers must not mutate the records."""
        with self._lock:
            return list(self._listings)

    def get(self, listing_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            pos = self._index.get(listing_id)
            return self._listings[pos] if pos is not None else None

    def __len__(self) -> int:
        with self._lock:
            return len(self._listings)

    # -- writes ----------------------------------------------------------------

    def update_user(self, listing_id: str, *, rating: Optional[int] = None,
                    user_notes: Optional[str] = None,
                    favorite: Optional[bool] = None) -> Optional[Dict[str, Any]]:
        """Apply personal research changes; returns the new record or ``None``."""
        with self._lock:
            pos = self._index.get(listing_id)
            if pos is None:
                return None
            current = self._listings[pos]
            updated = dict(current)
            if rating is not None:
                updated["rating"] = min(5, max(0, int(rating)))
            if user_notes is not None:
                updated["user_notes"] = str(user_notes)
            if favorite is not None:
                updated["favorite"] = bool(favorite)
            next_state = {**self._user_state, listing_id: {f: updated[f] for f in USER_FIELDS}}
            self._save_user_state(next_state)
            self._user_state = next_state
            self._listings[pos] = updated
            self.version += 1
            return updated

    def toggle_favorite(self, listing_id: str, value: Optional[bool] = None) -> Optional[Dict[str, Any]]:
        with self._lock:
            current = self.get(listing_id)
            if current is None:
                return None
            target = (not current["favorite"]) if value is None else value
            return self.update_user(listing_id, favorite=target)

    def merge(self, scraped: Iterable[Dict[str, Any]]) -> MergeResult:
        """Merge freshly collected listings, matched by listing URL.

        Matches keep their existing ID and personal research; new URLs are
        appended. Listings absent from ``scraped`` are retained (a partial
        scrape is not evidence that a listing is gone). Persists
        ``properties.json`` atomically.
        """
        result = MergeResult()
        with self._lock:
            by_url = {p["url"]: i for i, p in enumerate(self._listings) if p["url"]}
            merged = list(self._listings)
            for raw in scraped:
                new = normalize_property(raw)
                if not new["url"]:
                    continue  # Cannot be matched or linked back to its source.
                pos = by_url.get(new["url"])
                if pos is not None:
                    old = merged[pos]
                    new["id"] = old["id"]
                    for field in USER_FIELDS:
                        new[field] = old[field]
                    merged[pos] = new
                    result.updated += 1
                else:
                    by_url[new["url"]] = len(merged)
                    merged.append(self._with_user_state(new))
                    result.added += 1
            if result.total:
                write_listings(merged, self.properties_file)
                self._listings = merged
                self._reindex()
                self.version += 1
        return result
