"""The startup payload must preserve every field and every photo byte-for-byte."""
import json

import pytest

from compact_data import COMPACT_FILE, pack_listings, unpack_listings
from datastore import PROPERTIES_FILE


@pytest.mark.parametrize("photos", [[], ["https://x/one.jpg"],
    ["https://x/a.jpg", "https://x/a.jpg"],
    ["https://x/long-common-prefix/photo-1.jpg?w=1080", "https://x/long-common-prefix/photo-2.jpg?w=1080"],
    ["https://x/猫.jpg", "https://y/🌲.webp", "https://z/different"],
])
def test_photo_packing_is_lossless_and_does_not_mutate(photos):
    listing = {"id": "one", "photos": photos, "unknown_fields": ["hoa"], "user_notes": "private"}
    source = json.loads(json.dumps([listing]))
    assert unpack_listings(pack_listings(source)) == [listing]
    assert source == [listing]


def test_entire_generated_payload_matches_the_source():
    with open(PROPERTIES_FILE, encoding="utf-8") as handle:
        listings = json.load(handle)
    with open(COMPACT_FILE, encoding="utf-8") as handle:
        payload = json.load(handle)
    assert unpack_listings(payload) == listings


def test_unknown_payload_format_is_rejected():
    with pytest.raises(ValueError):
        unpack_listings({"format": "future-format", "listings": []})
