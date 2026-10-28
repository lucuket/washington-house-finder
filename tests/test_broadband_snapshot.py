import json
from pathlib import Path


def test_nearby_broadband_snapshot_matches_listing_coordinates():
    root = Path(__file__).resolve().parents[1]
    snapshot = json.loads((root / 'data' / 'ispmap_top_deals.json').read_text(encoding='utf-8'))
    listings = {p['id']: p for p in json.loads((root / 'properties.json').read_text(encoding='utf-8'))}
    records = snapshot['listings']
    assert len(records) == 556
    assert sorted(p['rank'] for p in records.values() if 'rank' in p) == list(range(1, 25))
    cities = {'Everett', 'Marysville', 'Lake Stevens', 'Lynnwood', 'Snohomish', 'Bothell', 'Edmonds', 'Hat Island'}
    assert {p['id'] for p in listings.values() if p['city'] in cities} <= records.keys()
    assert snapshot['fcc_data_as_of'] == '2025-12-31'
    for listing_id, record in records.items():
        listing = listings[listing_id]
        for field in ('address', 'city', 'zip', 'latitude', 'longitude'):
            assert record.get(field) == listing.get(field)
        assert record['hex'].startswith('88')
        assert record['providers']
        for provider in record['providers']:
            assert provider['name'] and provider['technology']
            for key in ('download_mbps', 'upload_mbps'):
                assert provider[key] is None or provider[key] >= 0
