# Pinned map dependencies

These are unmodified upstream distribution files, kept locally so listing and
map startup do not depend on a public CDN. They replace the same versions
previously loaded from unpkg; no additional runtime library was introduced.

| Package | Version | Source | License |
| --- | --- | --- | --- |
| Leaflet | 1.9.4 | https://unpkg.com/leaflet@1.9.4/dist/ | BSD-2-Clause, `leaflet/LICENSE` |
| Leaflet.markercluster | 1.5.3 | https://unpkg.com/leaflet.markercluster@1.5.3/dist/ | MIT, `markercluster/LICENSE` |

The Leaflet JS and CSS were verified against the SHA-256 integrity values
already used in index.html before being copied. Preserve the licenses and the
relative `leaflet/images/` paths when updating. Map imagery and listing photos
still require their external providers.
