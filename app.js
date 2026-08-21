/* ==========================================================================
   Washington Home Search — Application Engine & State Management
   High-Density Property Research Workstation
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // -------------------------------------------------------------------------
    // Global Application State & Storage Keys
    // -------------------------------------------------------------------------
    const STORAGE_PRESETS_KEY = 'wa_home_search_presets_v1';
    const STORAGE_WEIGHTS_KEY = 'wa_home_search_weights_v1';
    const STORAGE_MORTGAGE_KEY = 'wa_home_search_mortgage_v1';
    const STORAGE_RECENT_KEY = 'wa_home_search_recent_v1';
    const STORAGE_DENSITY_KEY = 'wa_home_search_density_v1';
    const STORAGE_USER_DATA_KEY = 'wa_home_search_userdata_v1';

    let allProperties = [];
    let filteredProperties = [];
    let activePhotoIndices = {}; // propId -> current image index
    let comparisonSet = new Set(); // Set of propIds (max 4)
    let activeView = 'split'; // 'split' | 'grid' | 'map' | 'analytics'
    let selectedPropId = null; // currently selected property in drawer
    let currentDrawerIndex = 0;
    let recentPropertyIds = [];

    // Filter Criteria State
    const filterState = {
        search: '',
        city: 'all',
        minPrice: 250000,
        maxPrice: 750000,
        minBeds: 0,
        minBaths: 0,
        minSqft: 800,
        maxSqft: 4000,
        minGarage: 0,
        minLot: 2000,
        minYear: 0,
        maxHoa: 300,
        maxPpsqft: 500,
        minRating: 0,
        favoritesOnly: false,
        sortBy: 'smart_score',
        mapBoundsOnly: false
    };

    // Smart Score Factor Weights (Sum = 100)
    let scoreWeights = {
        ppsqft: 30,
        sqft: 15,
        lot: 15,
        garage: 10,
        year: 10,
        hoa: 10,
        rating: 10
    };

    // User Mortgage Assumptions Defaults
    let mortgageAssumptions = {
        downPct: 20,
        termYears: 30,
        rate: 6.65,
        taxRate: 1.02,
        insurance: 1200
    };

    // City Medians Cache
    let cityMedians = {};
    let marketMedians = { price: 425000, ppsqft: 260, sqft: 1600, lot: 7500 };

    // Modal Contexts & Timers
    let currentLightboxProp = null;
    let currentLightboxIndex = 0;
    let scraperPollTimer = null;
    let searchDebounceTimer = null;
    let mapBoundsDebounceTimer = null;
    let noteSaveDebounceTimer = null;

    // -------------------------------------------------------------------------
    // DOM Element References
    // -------------------------------------------------------------------------
    const totalCountBadge = document.getElementById('total-count-badge');
    const matchedCountBadge = document.getElementById('matched-count-badge');
    const favoritesCountBadge = document.getElementById('favorites-count-badge');
    const favoritesBadgeBtn = document.getElementById('favorites-badge-btn');
    const resultsCountLabel = document.getElementById('results-count-label');
    const activeFilterTags = document.getElementById('active-filter-tags');
    const cardsGrid = document.getElementById('cards-grid');
    const emptyStateNotice = document.getElementById('empty-state-notice');
    const btnEmptyReset = document.getElementById('btn-empty-reset');

    // Sidebar Filter Elements
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const citySelect = document.getElementById('city-select');
    const priceMinSlider = document.getElementById('price-min-slider');
    const priceMaxSlider = document.getElementById('price-max-slider');
    const priceRangeDisplay = document.getElementById('price-range-display');
    const bedsPillGroup = document.getElementById('beds-pill-group');
    const bathsPillGroup = document.getElementById('baths-pill-group');
    const garagePillGroup = document.getElementById('garage-pill-group');
    const sqftMinSlider = document.getElementById('sqft-min-slider');
    const sqftMaxSlider = document.getElementById('sqft-max-slider');
    const sqftRangeDisplay = document.getElementById('sqft-range-display');
    const hoaSlider = document.getElementById('hoa-slider');
    const hoaDisplay = document.getElementById('hoa-display');
    const btnToggleAdvanced = document.getElementById('btn-toggle-advanced');
    const advancedFiltersBody = document.getElementById('advanced-filters-body');
    const lotSlider = document.getElementById('lot-slider');
    const lotDisplay = document.getElementById('lot-display');
    const yearSelect = document.getElementById('year-select');
    const maxPpsqftSlider = document.getElementById('max-ppsqft-slider');
    const maxPpsqftDisplay = document.getElementById('max-ppsqft-display');
    const ratingFilter = document.getElementById('rating-filter');
    const filterFavoritesToggle = document.getElementById('filter-favorites-toggle');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const sortDropdown = document.getElementById('sort-dropdown');

    // Market Quick Stats
    const marketAvgPrice = document.getElementById('market-avg-price');
    const marketAvgPpsqft = document.getElementById('market-avg-ppsqft');
    const marketAvgSqft = document.getElementById('market-avg-sqft');
    const marketAvgLot = document.getElementById('market-avg-lot');

    // Topbar Toolbar Elements
    const btnPresetsMenu = document.getElementById('btn-presets-menu');
    const presetDropdownMenu = document.getElementById('preset-dropdown-menu');
    const activePresetLabel = document.getElementById('active-preset-label');
    const customPresetsList = document.getElementById('custom-presets-list');
    const btnSaveCurrentPreset = document.getElementById('btn-save-current-preset');
    const btnOpenCmdPalette = document.getElementById('btn-open-cmd-palette');
    const btnDensityToggle = document.getElementById('btn-density-toggle');
    const btnOpenScoring = document.getElementById('btn-open-scoring');
    const btnExportCsv = document.getElementById('btn-export-csv');
    const btnOpenScraper = document.getElementById('btn-open-scraper');

    // Workspace & View Tabs
    const workspaceViewport = document.getElementById('workspace-viewport');
    const viewTabSplit = document.getElementById('view-tab-split');
    const viewTabGrid = document.getElementById('view-tab-grid');
    const viewTabMap = document.getElementById('view-tab-map');
    const viewTabAnalytics = document.getElementById('view-tab-analytics');

    // Map Overlays
    const mapMarkerCount = document.getElementById('map-marker-count');
    const mapBoundsFilterToggle = document.getElementById('map-bounds-filter-toggle');
    const btnMapFitResults = document.getElementById('btn-map-fit-results');
    const btnMapResetView = document.getElementById('btn-map-reset-view');

    // Property Detail Drawer Elements
    const propertyDetailDrawer = document.getElementById('property-detail-drawer');
    const drawerBackdrop = document.getElementById('drawer-backdrop');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const btnDrawerPrev = document.getElementById('btn-drawer-prev');
    const btnDrawerNext = document.getElementById('btn-drawer-next');
    const btnDrawerFavorite = document.getElementById('btn-drawer-favorite');
    const drawerAddress = document.getElementById('drawer-address');
    const drawerCityZip = document.getElementById('drawer-city-zip');
    const drawerActiveImg = document.getElementById('drawer-active-img');
    const btnDrawerImgPrev = document.getElementById('btn-drawer-img-prev');
    const btnDrawerImgNext = document.getElementById('btn-drawer-img-next');
    const drawerImgCur = document.getElementById('drawer-img-cur');
    const drawerImgTot = document.getElementById('drawer-img-tot');
    const btnDrawerFullscreen = document.getElementById('btn-drawer-fullscreen');
    const drawerThumbnailsStrip = document.getElementById('drawer-thumbnails-strip');
    const drawerPrice = document.getElementById('drawer-price');
    const drawerEstMonthly = document.getElementById('drawer-est-monthly');
    const drawerSignalsList = document.getElementById('drawer-signals-list');
    const drawerScoreVal = document.getElementById('drawer-score-val');
    const drawerScoreSummary = document.getElementById('drawer-score-summary');
    const drawerScoreBars = document.getElementById('drawer-score-bars');
    const dSpecBeds = document.getElementById('d-spec-beds');
    const dSpecBaths = document.getElementById('d-spec-baths');
    const dSpecSqft = document.getElementById('d-spec-sqft');
    const dSpecPpsqft = document.getElementById('d-spec-ppsqft');
    const dSpecLot = document.getElementById('d-spec-lot');
    const dSpecGarage = document.getElementById('d-spec-garage');
    const dSpecYear = document.getElementById('d-spec-year');
    const dSpecHoa = document.getElementById('d-spec-hoa');
    const drawerDescription = document.getElementById('drawer-description');
    const drawerStarPicker = document.getElementById('drawer-star-picker');
    const drawerRatingText = document.getElementById('drawer-rating-text');
    const drawerNotesTextarea = document.getElementById('drawer-notes-textarea');
    const drawerNoteStatus = document.getElementById('drawer-note-status');
    const btnDrawerCustomizeMortgage = document.getElementById('btn-drawer-customize-mortgage');
    const dMortgageTotal = document.getElementById('d-mortgage-total');
    const dMortgageBar = document.getElementById('d-mortgage-bar');
    const dValPi = document.getElementById('d-val-pi');
    const dValTax = document.getElementById('d-val-tax');
    const dValIns = document.getElementById('d-val-ins');
    const dValHoa = document.getElementById('d-val-hoa');
    const drawerSimilarHomes = document.getElementById('drawer-similar-homes');
    const drawerExternalLink = document.getElementById('drawer-external-link');

    // Modals
    const cmdPaletteModal = document.getElementById('cmd-palette-modal');
    const cmdPaletteInput = document.getElementById('cmd-palette-input');
    const cmdPaletteResults = document.getElementById('cmd-palette-results');

    const scoringModal = document.getElementById('scoring-modal');
    const btnCloseScoring = document.getElementById('btn-close-scoring');
    const btnResetWeights = document.getElementById('btn-reset-weights');
    const btnSaveWeights = document.getElementById('btn-save-weights');

    const compareDock = document.getElementById('compare-dock');
    const compareCountBadge = document.getElementById('compare-count-badge');
    const compareThumbnailsRow = document.getElementById('compare-thumbnails-row');
    const btnOpenComparisonMatrix = document.getElementById('btn-open-comparison-matrix');
    const btnCompareClear = document.getElementById('btn-compare-clear');
    const comparisonModal = document.getElementById('comparison-modal');
    const btnCloseComparison = document.getElementById('btn-close-comparison');
    const comparisonTableWrapper = document.getElementById('comparison-table-wrapper');

    const mortgageModal = document.getElementById('mortgage-modal');
    const btnCloseMortgage = document.getElementById('btn-close-mortgage');
    const calcPropAddress = document.getElementById('calc-prop-address');
    const calcHomePrice = document.getElementById('calc-home-price');
    const calcDownPct = document.getElementById('calc-down-pct');
    const calcDownAmount = document.getElementById('calc-down-amount');
    const calcLoanTerm = document.getElementById('calc-loan-term');
    const calcInterestRate = document.getElementById('calc-interest-rate');
    const calcTaxRate = document.getElementById('calc-tax-rate');
    const calcInsurance = document.getElementById('calc-insurance');
    const calcHoaFee = document.getElementById('calc-hoa-fee');
    const calcTotalMonthly = document.getElementById('calc-total-monthly');
    const calcVisualBar = document.getElementById('calc-visual-bar');
    const calcValPi = document.getElementById('calc-val-pi');
    const calcValTax = document.getElementById('calc-val-tax');
    const calcValIns = document.getElementById('calc-val-ins');
    const calcValHoa = document.getElementById('calc-val-hoa');
    const calcLoanPrincipal = document.getElementById('calc-loan-principal');

    const photoLightboxModal = document.getElementById('photo-lightbox-modal');
    const btnCloseLightbox = document.getElementById('btn-close-lightbox');
    const lightboxAddress = document.getElementById('lightbox-address');
    const lightboxSpecs = document.getElementById('lightbox-specs');
    const lightboxPrice = document.getElementById('lightbox-price');
    const lightboxExternalLink = document.getElementById('lightbox-external-link');
    const lightboxActiveImg = document.getElementById('lightbox-active-img');
    const lightboxCurrentNum = document.getElementById('lightbox-current-num');
    const lightboxTotalNum = document.getElementById('lightbox-total-num');
    const btnLightboxPrev = document.getElementById('btn-lightbox-prev');
    const btnLightboxNext = document.getElementById('btn-lightbox-next');
    const lightboxThumbnailsStrip = document.getElementById('lightbox-thumbnails-strip');

    const scraperModal = document.getElementById('scraper-modal');
    const btnCloseScraper = document.getElementById('btn-close-scraper');
    const btnCancelScraper = document.getElementById('btn-cancel-scraper');
    const btnStartLiveScrape = document.getElementById('btn-start-live-scrape');
    const scraperProgressFill = document.getElementById('scraper-progress-fill');
    const scraperStatusText = document.getElementById('scraper-status-text');
    const scraperPctText = document.getElementById('scraper-pct-text');
    const scraperTerminal = document.getElementById('scraper-terminal');

    const toastContainer = document.getElementById('toast-container');

    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // Leaflet GIS Mapping (Strictly Locked to Washington State)
    // -------------------------------------------------------------------------
    let map = null;
    let markersLayer = null;
    let markerInstances = {}; // propId -> L.Marker

    // Strict Washington State Boundary coordinates (South-West to North-East)
    const WA_SOUTH_WEST = L.latLng(45.45, -125.0);
    const WA_NORTH_EAST = L.latLng(49.10, -116.85);
    const WA_BOUNDS = L.latLngBounds(WA_SOUTH_WEST, WA_NORTH_EAST);

    // Detailed Washington State Border Outline Polygon
    const WA_STATE_COORDS = [
        [49.00, -123.00], [49.00, -117.03], [46.00, -117.03], [46.00, -118.98],
        [45.92, -119.34], [45.83, -119.70], [45.72, -120.20], [45.69, -120.80],
        [45.60, -121.20], [45.64, -121.90], [45.55, -122.40], [45.60, -122.75],
        [46.15, -123.18], [46.25, -124.05], [46.30, -124.08], [46.90, -124.18],
        [47.30, -124.35], [47.90, -124.65], [48.38, -124.72], [48.30, -124.00],
        [48.15, -123.40], [48.15, -122.75], [48.70, -122.50], [49.00, -122.75],
        [49.00, -123.00]
    ];

    const REGION_BOUNDS = {
        'all': { center: [47.35, -120.4], zoom: 7 },
        'everett': { center: [47.97, -122.20], zoom: 11 },
        'puget-sound': { center: [47.25, -122.44], zoom: 10 },
        'spokane': { center: [47.66, -117.42], zoom: 11 },
        'tri-cities': { center: [46.23, -119.14], zoom: 11 },
        'yakima': { center: [46.60, -120.50], zoom: 11 },
        'vancouver': { center: [45.64, -122.66], zoom: 11 }
    };

    function initMap() {
        if (map) return;
        const mapElement = document.getElementById('leaflet-map');
        if (!mapElement) return;

        // Centered strictly over Washington State with hard boundaries
        map = L.map('leaflet-map', {
            center: [47.35, -120.4],
            zoom: 7.2,
            minZoom: 6.5,
            maxZoom: 18,
            maxBounds: WA_BOUNDS,
            maxBoundsViscosity: 1.0, // Strictly keeps map inside Washington State
            zoomControl: true,
            attributionControl: false
        });

        // Clean, bright Realtor Voyager tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd',
            bounds: WA_BOUNDS
        }).addTo(map);

        // 1. Inverted Mask: Solidly covers Canada, Oregon, Idaho, Montana & surrounding world
        // Leaving ONLY Washington State open and visible
        if (window.WASHINGTON_MASK_RINGS) {
            L.polygon(window.WASHINGTON_MASK_RINGS, {
                fillColor: '#f1f5f9',
                fillOpacity: 1.0,
                stroke: true,
                color: '#cbd5e1',
                weight: 1,
                interactive: false
            }).addTo(map);
        }

        // 2. Official High-Precision US Census Bureau Washington State Border Outline
        if (window.WASHINGTON_GEOJSON) {
            L.geoJSON(window.WASHINGTON_GEOJSON, {
                style: {
                    color: '#c82026',
                    weight: 2.5,
                    opacity: 0.85,
                    fill: false
                },
                interactive: false
            }).addTo(map);
        }

        // Marker Cluster Layer with clean Redfin/Zillow count pins
        if (typeof L.markerClusterGroup === 'function') {
            markersLayer = L.markerClusterGroup({
                showCoverageOnHover: false,
                maxClusterRadius: 40,
                spiderfyOnMaxZoom: true,
                iconCreateFunction: function (cluster) {
                    const count = cluster.getChildCount();
                    return L.divIcon({
                        html: `<div class="realtor-cluster-pin"><span>${count}</span></div>`,
                        className: 'custom-cluster-wrapper',
                        iconSize: [36, 36],
                        iconAnchor: [18, 18]
                    });
                }
            });
        } else {
            markersLayer = L.featureGroup();
        }

        map.addLayer(markersLayer);

        // Map movement trigger for bounds search
        map.on('moveend', () => {
            if (filterState.mapBoundsOnly) {
                clearTimeout(mapBoundsDebounceTimer);
                mapBoundsDebounceTimer = setTimeout(() => {
                    applyFilters();
                }, 150);
            }
        });

        map.fitBounds(WA_BOUNDS, { padding: [15, 15] });

        // Ensure map renders properly after DOM paint
        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 150);

        window.addEventListener('resize', () => {
            if (map) map.invalidateSize();
        });

        // Setup Region Quick Jump Pills
        const regionPills = document.querySelectorAll('.map-region-pill');
        regionPills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                regionPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                const reg = pill.getAttribute('data-region');
                if (reg && REGION_BOUNDS[reg]) {
                    const { center, zoom } = REGION_BOUNDS[reg];
                    if (reg === 'all') {
                        map.fitBounds(WA_BOUNDS, { padding: [15, 15] });
                    } else {
                        map.setView(center, zoom, { animate: true });
                    }
                }
            });
        });
    }

    function updateMapMarkers(propertiesToDisplay) {
        if (!map || !markersLayer) return;
        markersLayer.clearLayers();
        markerInstances = {};

        const validCoords = [];

        propertiesToDisplay.forEach(p => {
            if (p.latitude && p.longitude) {
                const formattedPrice = '$' + Math.round(p.price / 1000) + 'k';
                const isFavorited = p.favorite ? '♥ ' : '';

                const customIcon = L.divIcon({
                    className: 'custom-map-icon-wrapper',
                    html: `<div class="realtor-price-pin ${p.favorite ? 'favorited-pin' : ''}" id="marker-pin-${p.id}">${isFavorited}${formattedPrice}</div>`,
                    iconSize: [68, 26],
                    iconAnchor: [34, 13],
                    popupAnchor: [0, -14]
                });

                const marker = L.marker([p.latitude, p.longitude], { icon: customIcon });

                const popupContent = `
                    <div class="map-popup-card" onclick="window.HouseFinderApp.openDrawerById('${p.id}')" style="cursor: pointer;">
                        <img src="${p.photos[0] || ''}" alt="${p.address}" class="popup-img" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=600&q=80'">
                        <div class="popup-info">
                            <span class="popup-price">$${p.price.toLocaleString()}</span>
                            <strong class="popup-address">${p.address}</strong>
                            <span class="popup-specs">${p.beds} Beds • ${p.baths} Baths • ${p.sqft.toLocaleString()} sqft</span>
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent, { maxWidth: 240, className: 'realtor-map-popup' });

                marker.on('click', () => {
                    highlightCard(p.id);
                });

                markersLayer.addLayer(marker);
                markerInstances[p.id] = marker;
                validCoords.push([p.latitude, p.longitude]);
            }
        });

        if (mapMarkerCount) {
            mapMarkerCount.textContent = `${validCoords.length} WA homes`;
        }
    }

    function fitMapToResults() {
        if (!map || !markersLayer) return;
        const bounds = markersLayer.getBounds();
        if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
        } else {
            resetWashingtonView();
        }
    }

    function resetWashingtonView() {
        if (!map) return;
        map.fitBounds(WA_BOUNDS, { padding: [15, 15] });
    }

    function highlightCard(propId) {
        const cardEl = document.getElementById(`card-${propId}`);
        if (cardEl) {
            document.querySelectorAll('.property-card').forEach(c => c.classList.remove('active-highlight'));
            cardEl.classList.add('active-highlight');
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    function highlightMarker(propId, active) {
        const pinEl = document.getElementById(`marker-pin-${propId}`);
        if (pinEl) {
            pinEl.classList.toggle('selected', active);
        }
    }

    // -------------------------------------------------------------------------
    // Toast Notifications
    // -------------------------------------------------------------------------
    function showToast(message, type = 'info') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast-msg toast-${type}`;
        
        let iconSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        if (type === 'error') {
            iconSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
        }
        
        toast.innerHTML = `${iconSvg}<span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    // -------------------------------------------------------------------------
    // Calculations & Value Signals (100% Real Data)
    // -------------------------------------------------------------------------
    function computeMarketMedians() {
        if (!allProperties.length) return;

        cityMedians = {};
        const cityBuckets = {};

        allProperties.forEach(p => {
            const city = p.city || 'Other';
            if (!cityBuckets[city]) cityBuckets[city] = { prices: [], ppsqfts: [], sqfts: [], lots: [] };
            cityBuckets[city].prices.push(p.price);
            if (p.sqft > 0) {
                cityBuckets[city].sqfts.push(p.sqft);
                cityBuckets[city].ppsqfts.push(p.price / p.sqft);
            }
            if (p.lot_sqft > 0) cityBuckets[city].lots.push(p.lot_sqft);
        });

        const medianOf = (arr) => {
            if (!arr || !arr.length) return 0;
            const sorted = [...arr].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        for (const [city, data] of Object.entries(cityBuckets)) {
            cityMedians[city] = {
                price: Math.round(medianOf(data.prices)),
                ppsqft: Math.round(medianOf(data.ppsqfts)),
                sqft: Math.round(medianOf(data.sqfts)),
                lot: Math.round(medianOf(data.lots)),
                count: data.prices.length
            };
        }

        const allPrices = allProperties.map(p => p.price);
        const allSqfts = allProperties.filter(p => p.sqft > 0).map(p => p.sqft);
        const allLots = allProperties.filter(p => p.lot_sqft > 0).map(p => p.lot_sqft);
        const allPpsqfts = allProperties.filter(p => p.sqft > 0).map(p => p.price / p.sqft);

        marketMedians = {
            price: Math.round(medianOf(allPrices)),
            ppsqft: Math.round(medianOf(allPpsqfts)),
            sqft: Math.round(medianOf(allSqfts)),
            lot: Math.round(medianOf(allLots))
        };
    }

    function calculateValueSignals(p) {
        const signals = [];
        const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
        const cityMed = cityMedians[p.city] || marketMedians;

        // $/sqft vs city median
        if (cityMed.ppsqft > 0) {
            const deltaPct = Math.round(((ppsqft - cityMed.ppsqft) / cityMed.ppsqft) * 100);
            if (deltaPct <= -8) {
                signals.push({ label: `↓ ${Math.abs(deltaPct)}% below median $/sqft`, type: 'good' });
            } else if (deltaPct >= 15) {
                signals.push({ label: `↑ ${deltaPct}% above median $/sqft`, type: 'amber' });
            }
        }

        // Lot Size signal
        if (p.lot_sqft >= 10000) {
            const acres = (p.lot_sqft / 43560).toFixed(2);
            signals.push({ label: `★ ${acres} Ac Lot`, type: 'good' });
        }

        // Garage capacity
        if (p.garage >= 3) {
            signals.push({ label: `★ ${p.garage}-Car Garage`, type: 'good' });
        }

        // Low / No HOA
        if (p.hoa === 0) {
            signals.push({ label: '★ No HOA ($0)', type: 'good' });
        } else if (p.hoa <= 35) {
            signals.push({ label: `★ Low HOA ($${p.hoa}/mo)`, type: 'good' });
        }

        // Newer construction
        if (p.year_built >= 2018) {
            signals.push({ label: `★ Built ${p.year_built}`, type: 'good' });
        }

        return signals;
    }

    function computeSmartScore(p) {
        const ppsqft = p.price / Math.max(1, p.sqft);
        const cityMed = cityMedians[p.city] || marketMedians;

        // 1. PPSQFT score (0 - 100): Lower is better
        let scorePpsqft = 50;
        if (cityMed.ppsqft > 0) {
            const ratio = ppsqft / cityMed.ppsqft;
            scorePpsqft = Math.max(0, Math.min(100, Math.round(100 - (ratio - 0.7) * 100)));
        }

        // 2. Living SqFt score (0 - 100): 1200 - 2500 normalized
        const scoreSqft = Math.max(0, Math.min(100, Math.round(((p.sqft - 1000) / 1500) * 100)));

        // 3. Lot Size score (0 - 100): 5000 - 20000 normalized
        const scoreLot = Math.max(0, Math.min(100, Math.round(((p.lot_sqft - 4000) / 16000) * 100)));

        // 4. Garage score (0 - 100)
        const scoreGarage = p.garage >= 3 ? 100 : (p.garage === 2 ? 75 : 40);

        // 5. Year built score (0 - 100)
        const currentYear = new Date().getFullYear();
        const age = Math.max(0, currentYear - (p.year_built || 1980));
        const scoreYear = Math.max(0, Math.min(100, Math.round(100 - (age / 50) * 100)));

        // 6. Low HOA score (0 - 100)
        const scoreHoa = p.hoa === 0 ? 100 : Math.max(0, Math.min(100, Math.round(100 - (p.hoa / 100) * 100)));

        // 7. Rating score (0 - 100)
        const scoreRating = (p.rating || 0) > 0 ? (p.rating / 5) * 100 : 50;

        const totalWeight = scoreWeights.ppsqft + scoreWeights.sqft + scoreWeights.lot + scoreWeights.garage + scoreWeights.year + scoreWeights.hoa + scoreWeights.rating;
        const w = scoreWeights;

        const composite = (
            scorePpsqft * w.ppsqft +
            scoreSqft * w.sqft +
            scoreLot * w.lot +
            scoreGarage * w.garage +
            scoreYear * w.year +
            scoreHoa * w.hoa +
            scoreRating * w.rating
        ) / Math.max(1, totalWeight);

        return {
            total: Math.round(composite),
            factors: {
                ppsqft: { score: scorePpsqft, weight: w.ppsqft, label: `$/sqft vs Median: ${scorePpsqft}/100` },
                sqft: { score: scoreSqft, weight: w.sqft, label: `Living Area: ${scoreSqft}/100` },
                lot: { score: scoreLot, weight: w.lot, label: `Lot Size: ${scoreLot}/100` },
                garage: { score: scoreGarage, weight: w.garage, label: `Garage Spaces: ${scoreGarage}/100` },
                year: { score: scoreYear, weight: w.year, label: `Age / Condition: ${scoreYear}/100` },
                hoa: { score: scoreHoa, weight: w.hoa, label: `Low HOA Benefit: ${scoreHoa}/100` },
                rating: { score: Math.round(scoreRating), weight: w.rating, label: `Personal Rating: ${Math.round(scoreRating)}/100` }
            }
        };
    }

    function findSimilarHomes(targetProp, limit = 4) {
        if (!allProperties.length || !targetProp) return [];

        const targetPpsqft = targetProp.price / Math.max(1, targetProp.sqft);

        const scored = allProperties
            .filter(p => p.id !== targetProp.id)
            .map(p => {
                const ppsqft = p.price / Math.max(1, p.sqft);
                
                // Normalized feature distances
                const dPrice = Math.abs(p.price - targetProp.price) / 150000;
                const dSqft = Math.abs(p.sqft - targetProp.sqft) / 600;
                const dLot = Math.abs(p.lot_sqft - targetProp.lot_sqft) / 8000;
                const dBeds = Math.abs(p.beds - targetProp.beds) / 2;
                const dGarage = Math.abs(p.garage - targetProp.garage) / 2;
                const dCity = p.city.toLowerCase() === targetProp.city.toLowerCase() ? 0 : 0.8;

                const distance = dPrice * 0.3 + dSqft * 0.25 + dCity * 0.2 + dLot * 0.1 + dBeds * 0.1 + dGarage * 0.05;
                return { prop: p, distance };
            });

        scored.sort((a, b) => a.distance - b.distance);
        return scored.slice(0, limit).map(item => item.prop);
    }

    function calculateEstimatedMonthly(price, hoa = 0, customDownPct = null) {
        const downPct = customDownPct !== null ? customDownPct : mortgageAssumptions.downPct;
        const downAmount = price * (downPct / 100);
        const principal = Math.max(0, price - downAmount);
        const monthlyRate = (mortgageAssumptions.rate / 100) / 12;
        const totalPayments = mortgageAssumptions.termYears * 12;

        let monthlyPi = 0;
        if (monthlyRate > 0 && principal > 0) {
            monthlyPi = principal * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) / (Math.pow(1 + monthlyRate, totalPayments) - 1);
        } else if (principal > 0) {
            monthlyPi = principal / totalPayments;
        }

        const monthlyTax = (price * (mortgageAssumptions.taxRate / 100)) / 12;
        const monthlyIns = mortgageAssumptions.insurance / 12;
        const total = monthlyPi + monthlyTax + monthlyIns + hoa;

        return {
            total: Math.round(total),
            pi: Math.round(monthlyPi),
            tax: Math.round(monthlyTax),
            ins: Math.round(monthlyIns),
            hoa: Math.round(hoa),
            principal: Math.round(principal),
            downAmount: Math.round(downAmount)
        };
    }

    // -------------------------------------------------------------------------
    // User Data Local Persistence Helper (Favorites, Notes, Ratings)
    // -------------------------------------------------------------------------
    function getUserDataRegistry() {
        try {
            const raw = localStorage.getItem(STORAGE_USER_DATA_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function persistUserData(propId, updates) {
        try {
            const data = getUserDataRegistry();
            if (!data[propId]) data[propId] = {};
            Object.assign(data[propId], updates);
            localStorage.setItem(STORAGE_USER_DATA_KEY, JSON.stringify(data));
        } catch (e) {}
    }

    // -------------------------------------------------------------------------
    // Data Loading & API Fetching (With GitHub Pages relative path support)
    // -------------------------------------------------------------------------
    async function loadProperties() {
        try {
            if (resultsCountLabel) resultsCountLabel.textContent = "Loading Washington listings...";
            
            let data = null;

            // 1. Check embedded dataset (100% instant local & GitHub Pages offline support)
            if (window.WASHINGTON_PROPERTIES && Array.isArray(window.WASHINGTON_PROPERTIES) && window.WASHINGTON_PROPERTIES.length > 0) {
                data = JSON.parse(JSON.stringify(window.WASHINGTON_PROPERTIES));
            }

            // 2. Try relative static JSON
            if (!data) {
                try {
                    const res = await fetch('properties.json');
                    if (res.ok) data = await res.json();
                } catch (e) {}
            }

            // 3. Try API if backend is running
            if (!data) {
                try {
                    const apiRes = await fetch('/api/properties');
                    if (apiRes.ok) data = await apiRes.json();
                } catch (e) {}
            }

            if (!data) {
                try {
                    const absRes = await fetch('./properties.json');
                    if (absRes.ok) data = await absRes.json();
                } catch (e) {}
            }

            if (!data || !Array.isArray(data)) {
                throw new Error("Could not load properties data.");
            }

            // Merge local storage user data (favorites, notes, ratings)
            const localUserData = getUserDataRegistry();
            data.forEach(p => {
                if (localUserData[p.id]) {
                    const u = localUserData[p.id];
                    if (typeof u.favorite === 'boolean') p.favorite = u.favorite;
                    if (typeof u.rating === 'number') p.rating = u.rating;
                    if (typeof u.user_notes === 'string') p.user_notes = u.user_notes;
                }
            });

            allProperties = data;

            // Initialize photo index registry
            allProperties.forEach(p => {
                if (!(p.id in activePhotoIndices)) activePhotoIndices[p.id] = 0;
            });

            computeMarketMedians();
            populateCityDropdown();
            loadStateFromUrl();
            applyFilters();
            loadSavedPresets();
        } catch (err) {
            console.error("Critical error loading listings:", err);
            showToast("Failed to load listings data.", "error");
        }
    }

    function populateCityDropdown() {
        const cityCounts = {};
        allProperties.forEach(p => {
            const c = p.city || 'Other';
            cityCounts[c] = (cityCounts[c] || 0) + 1;
        });

        const sortedCities = Object.keys(cityCounts).sort();
        citySelect.innerHTML = '<option value="all">All Washington Cities</option>';
        sortedCities.forEach(city => {
            const opt = document.createElement('option');
            opt.value = city.toLowerCase();
            opt.textContent = `${city}, WA (${cityCounts[city]})`;
            citySelect.appendChild(opt);
        });
    }

    // -------------------------------------------------------------------------
    // Filtering, Sorting & Search Engine
    // -------------------------------------------------------------------------
    function applyFilters() {
        const searchTerms = filterState.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const mapBounds = (map && filterState.mapBoundsOnly) ? map.getBounds() : null;

        filteredProperties = allProperties.filter(p => {
            // City check
            if (filterState.city !== 'all' && p.city.toLowerCase() !== filterState.city) return false;

            // Price Range
            if (p.price < filterState.minPrice || p.price > filterState.maxPrice) return false;

            // Beds & Baths
            if (filterState.minBeds > 0 && p.beds < filterState.minBeds) return false;
            if (filterState.minBaths > 0 && p.baths < filterState.minBaths) return false;

            // Garage
            if (filterState.minGarage > 0 && p.garage < filterState.minGarage) return false;

            // Living Area SqFt
            if (p.sqft < filterState.minSqft || p.sqft > filterState.maxSqft) return false;

            // HOA Fee
            if (p.hoa > filterState.maxHoa) return false;

            // Lot Size
            if (p.lot_sqft < filterState.minLot) return false;

            // Year Built
            if (filterState.minYear > 0 && p.year_built < filterState.minYear) return false;

            // Max $/SqFt
            if (filterState.maxPpsqft < 500) {
                const ppsqft = p.price / Math.max(1, p.sqft);
                if (ppsqft > filterState.maxPpsqft) return false;
            }

            // Star Rating
            if (filterState.minRating > 0 && (p.rating || 0) < filterState.minRating) return false;

            // Shortlist / Favorites
            if (filterState.favoritesOnly && !p.favorite) return false;

            // Map Bounds Filter
            if (mapBounds && p.latitude && p.longitude) {
                if (!mapBounds.contains([p.latitude, p.longitude])) return false;
            }

            // Keyword Search (multi-term matching)
            if (searchTerms.length > 0) {
                const corpus = `${p.address} ${p.city} ${p.zip} ${p.description} ${p.user_notes}`.toLowerCase();
                for (const term of searchTerms) {
                    if (!corpus.includes(term)) return false;
                }
            }

            return true;
        });

        // Compute Smart Score for each filtered property
        filteredProperties.forEach(p => {
            p._score = computeSmartScore(p);
        });

        // Sort Properties
        sortFilteredProperties();

        // Render UI
        renderGalleryCards();
        updateMapMarkers(filteredProperties);
        renderActiveFilterTags();
        updateHeaderAndMarketStats();
        syncStateToUrl();
    }

    function sortFilteredProperties() {
        switch (filterState.sortBy) {
            case 'smart_score':
                filteredProperties.sort((a, b) => (b._score?.total || 0) - (a._score?.total || 0));
                break;
            case 'price_asc':
                filteredProperties.sort((a, b) => a.price - b.price);
                break;
            case 'price_desc':
                filteredProperties.sort((a, b) => b.price - a.price);
                break;
            case 'price_per_sqft_asc':
                filteredProperties.sort((a, b) => (a.price / Math.max(1, a.sqft)) - (b.price / Math.max(1, b.sqft)));
                break;
            case 'sqft_desc':
                filteredProperties.sort((a, b) => b.sqft - a.sqft);
                break;
            case 'lot_desc':
                filteredProperties.sort((a, b) => b.lot_sqft - a.lot_sqft);
                break;
            case 'year_desc':
                filteredProperties.sort((a, b) => b.year_built - a.year_built);
                break;
            case 'rating_desc':
                filteredProperties.sort((a, b) => (b.rating || 0) - (a.rating || 0));
                break;
            default:
                break;
        }
    }

    // -------------------------------------------------------------------------
    // Render Gallery Cards (Optimized High-Density List)
    // -------------------------------------------------------------------------
    function renderGalleryCards() {
        cardsGrid.innerHTML = '';

        if (filteredProperties.length === 0) {
            emptyStateNotice.classList.remove('hidden');
            cardsGrid.classList.add('hidden');
            return;
        }

        emptyStateNotice.classList.add('hidden');
        cardsGrid.classList.remove('hidden');

        const fragment = document.createDocumentFragment();

        filteredProperties.forEach(p => {
            const card = document.createElement('article');
            card.className = 'property-card';
            card.id = `card-${p.id}`;
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `${p.address}, ${p.city}, WA. Listing price $${p.price.toLocaleString()}`);

            const photoIdx = activePhotoIndices[p.id] || 0;
            const currentPhoto = p.photos[photoIdx] || 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=80';
            const totalPhotos = p.photos.length || 1;
            const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
            const estMonthly = calculateEstimatedMonthly(p.price, p.hoa);
            const isCompared = comparisonSet.has(p.id);
            const scoreVal = p._score ? p._score.total : 80;
            const signals = calculateValueSignals(p);

            // Stars HTML
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                const filledClass = i <= (p.rating || 0) ? 'filled' : '';
                starsHtml += `<span class="star ${filledClass}" data-rate="${i}" title="Rate ${i} stars">★</span>`;
            }

            // Signals HTML
            let signalsHtml = '';
            signals.slice(0, 2).forEach(s => {
                signalsHtml += `<span class="chip chip-signal-${s.type}">${s.label}</span>`;
            });

            const acres = (p.lot_sqft / 43560).toFixed(2);

            card.innerHTML = `
                <div class="card-media">
                    <img src="${currentPhoto}" alt="${p.address}" class="card-img" id="img-${p.id}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=80'">
                    <div class="card-media-tags-top">
                        <span class="card-city-badge">${p.city}, WA</span>
                    </div>
                    <span class="card-score-badge mono" title="Smart Shortlist Score: ${scoreVal}/100">Score ${scoreVal}</span>
                    
                    <button class="card-favorite-btn ${p.favorite ? 'favorited' : ''}" data-id="${p.id}" title="${p.favorite ? 'Remove from shortlist' : 'Save to shortlist'}" aria-label="Toggle favorite">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="${p.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                    </button>

                    ${totalPhotos > 1 ? `
                        <button class="card-nav-arrow prev" data-id="${p.id}" data-dir="-1" title="Previous photo" aria-label="Previous photo">‹</button>
                        <button class="card-nav-arrow next" data-id="${p.id}" data-dir="1" title="Next photo" aria-label="Next photo">›</button>
                        <div class="card-photo-counter" id="counter-${p.id}">
                            <span>${photoIdx + 1}/${totalPhotos}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="card-body">
                    <div class="card-price-row">
                        <span class="card-price mono">$${p.price.toLocaleString()}</span>
                        <span class="card-mortgage-badge mono" data-id="${p.id}" title="Click to view Mortgage Breakdown">Est. $${estMonthly.total.toLocaleString()}/mo</span>
                    </div>

                    <div class="card-address-block">
                        <strong class="card-street" title="${p.address}">${p.address}</strong>
                        <span class="card-city-zip">${p.city}, WA ${p.zip || ''}</span>
                    </div>

                    <div class="card-specs-grid">
                        <div class="spec-item">
                            <span class="spec-val mono">${p.beds}</span>
                            <span class="spec-lbl">Beds</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val mono">${p.baths}</span>
                            <span class="spec-lbl">Baths</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val mono">${p.sqft.toLocaleString()}</span>
                            <span class="spec-lbl">SqFt</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val mono">${p.garage} Car</span>
                            <span class="spec-lbl">Garage</span>
                        </div>
                    </div>

                    <div class="card-extra-chips">
                        <span class="chip mono">$${ppsqft}/sqft</span>
                        <span class="chip mono">${acres} Ac Lot</span>
                        <span class="chip">Built ${p.year_built}</span>
                        <span class="chip">${p.hoa > 0 ? `$${p.hoa}/mo HOA` : 'No HOA'}</span>
                        ${signalsHtml}
                    </div>

                    <div class="card-user-meta">
                        <div class="card-star-rating" data-id="${p.id}" title="Set rating">
                            ${starsHtml}
                        </div>
                        <button class="card-note-trigger ${p.user_notes ? 'has-note' : ''}" data-id="${p.id}" title="Edit private notes">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span>${p.user_notes ? 'Notes Added' : 'Add Note'}</span>
                        </button>
                    </div>

                    <div class="card-footer-actions">
                        <label class="compare-checkbox-label">
                            <input type="checkbox" class="compare-check" data-id="${p.id}" ${isCompared ? 'checked' : ''}>
                            <span>Compare</span>
                        </label>
                        
                        <button class="btn btn-primary btn-sm card-view-drawer-btn" data-id="${p.id}">
                            View Details
                        </button>
                    </div>
                </div>
            `;

            // Hover marker synchronization
            card.addEventListener('mouseenter', () => highlightMarker(p.id, true));
            card.addEventListener('mouseleave', () => highlightMarker(p.id, false));

            // Card click opens drawer (unless clicking buttons/inputs)
            card.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.card-star-rating')) {
                    return;
                }
                openPropertyDrawer(p.id);
            });

            // Enter key opens drawer
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    openPropertyDrawer(p.id);
                }
            });

            fragment.appendChild(card);
        });

        cardsGrid.appendChild(fragment);
        attachCardDelegatedEvents();
    }

    function attachCardDelegatedEvents() {
        // Photo cycling navigation
        cardsGrid.querySelectorAll('.card-nav-arrow').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = btn.getAttribute('data-id');
                const dir = parseInt(btn.getAttribute('data-dir'), 10);
                cycleCardPhoto(propId, dir);
            });
        });

        // Favorite Button Toggle
        cardsGrid.querySelectorAll('.card-favorite-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const propId = btn.getAttribute('data-id');
                await toggleFavorite(propId);
            });
        });

        // Mortgage Badge Click
        cardsGrid.querySelectorAll('.card-mortgage-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = badge.getAttribute('data-id');
                openMortgageEstimator(propId);
            });
        });

        // Star Rating Clicks
        cardsGrid.querySelectorAll('.card-star-rating .star').forEach(star => {
            star.addEventListener('click', async (e) => {
                e.stopPropagation();
                const container = star.parentElement;
                const propId = container.getAttribute('data-id');
                const rateVal = parseInt(star.getAttribute('data-rate'), 10);
                await updatePropertyRating(propId, rateVal);
            });
        });

        // Note Trigger Click -> Open drawer
        cardsGrid.querySelectorAll('.card-note-trigger, .card-view-drawer-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = btn.getAttribute('data-id');
                openPropertyDrawer(propId);
            });
        });

        // Compare Checkbox Toggle
        cardsGrid.querySelectorAll('.compare-check').forEach(chk => {
            chk.addEventListener('change', (e) => {
                e.stopPropagation();
                const propId = chk.getAttribute('data-id');
                if (chk.checked) {
                    if (comparisonSet.size >= 4) {
                        chk.checked = false;
                        showToast("You can compare up to 4 homes simultaneously.", "error");
                        return;
                    }
                    comparisonSet.add(propId);
                } else {
                    comparisonSet.delete(propId);
                }
                updateCompareDock();
            });
        });
    }

    function cycleCardPhoto(propId, direction) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop || !prop.photos || prop.photos.length <= 1) return;

        let curIdx = activePhotoIndices[propId] || 0;
        curIdx = (curIdx + direction + prop.photos.length) % prop.photos.length;
        activePhotoIndices[propId] = curIdx;

        const imgEl = document.getElementById(`img-${propId}`);
        const counterEl = document.getElementById(`counter-${propId}`);
        if (imgEl) imgEl.src = prop.photos[curIdx];
        if (counterEl) counterEl.innerHTML = `<span>${curIdx + 1}/${prop.photos.length}</span>`;
    }

    // -------------------------------------------------------------------------
    // Active Filters Summary & Tag Removal
    // -------------------------------------------------------------------------
    function renderActiveFilterTags() {
        if (!activeFilterTags) return;
        activeFilterTags.innerHTML = '';

        const tags = [];

        if (filterState.city !== 'all') {
            tags.push({ label: `City: ${filterState.city.toUpperCase()}`, key: 'city', reset: () => { filterState.city = 'all'; citySelect.value = 'all'; } });
        }
        if (filterState.minPrice > 250000 || filterState.maxPrice < 750000) {
            tags.push({ label: `$${Math.round(filterState.minPrice/1000)}k–$${Math.round(filterState.maxPrice/1000)}k`, key: 'price', reset: () => {
                filterState.minPrice = 250000; filterState.maxPrice = 750000;
                priceMinSlider.value = 250000; priceMaxSlider.value = 750000;
                priceRangeDisplay.textContent = '$250k – $750k';
            }});
        }
        if (filterState.minBeds > 0) {
            tags.push({ label: `${filterState.minBeds}+ Beds`, key: 'beds', reset: () => {
                filterState.minBeds = 0;
                bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-beds') === '0'));
            }});
        }
        if (filterState.minBaths > 0) {
            tags.push({ label: `${filterState.minBaths}+ Baths`, key: 'baths', reset: () => {
                filterState.minBaths = 0;
                bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-baths') === '0'));
            }});
        }
        if (filterState.minGarage > 0) {
            tags.push({ label: `${filterState.minGarage}+ Garage`, key: 'garage', reset: () => {
                filterState.minGarage = 0;
                garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === '0'));
            }});
        }
        if (filterState.minSqft > 800 || filterState.maxSqft < 4000) {
            tags.push({ label: `${filterState.minSqft.toLocaleString()}–${filterState.maxSqft.toLocaleString()} sqft`, key: 'sqft', reset: () => {
                filterState.minSqft = 800; filterState.maxSqft = 4000;
                sqftMinSlider.value = 800; sqftMaxSlider.value = 4000;
                sqftRangeDisplay.textContent = '800 – 4,000 sqft';
            }});
        }
        if (filterState.maxHoa < 300) {
            tags.push({ label: `HOA ≤ $${filterState.maxHoa}/mo`, key: 'hoa', reset: () => {
                filterState.maxHoa = 300; hoaSlider.value = 300; hoaDisplay.textContent = '≤ $300/mo';
            }});
        }
        if (filterState.minLot > 2000) {
            tags.push({ label: `Lot ≥ ${filterState.minLot.toLocaleString()} sqft`, key: 'lot', reset: () => {
                filterState.minLot = 2000; lotSlider.value = 2000; lotDisplay.textContent = '2,000+ sqft';
            }});
        }
        if (filterState.minYear > 0) {
            tags.push({ label: `Built ≥ ${filterState.minYear}`, key: 'year', reset: () => {
                filterState.minYear = 0; yearSelect.value = '0';
            }});
        }
        if (filterState.maxPpsqft < 500) {
            tags.push({ label: `≤ $${filterState.maxPpsqft}/sqft`, key: 'ppsqft', reset: () => {
                filterState.maxPpsqft = 500; maxPpsqftSlider.value = 500; maxPpsqftDisplay.textContent = 'No Limit';
            }});
        }
        if (filterState.minRating > 0) {
            tags.push({ label: `${filterState.minRating}+ Stars`, key: 'rating', reset: () => {
                filterState.minRating = 0; ratingFilter.value = '0';
            }});
        }
        if (filterState.favoritesOnly) {
            tags.push({ label: 'Shortlist Only', key: 'favorites', reset: () => {
                filterState.favoritesOnly = false; filterFavoritesToggle.checked = false;
            }});
        }
        if (filterState.search) {
            tags.push({ label: `"${filterState.search}"`, key: 'search', reset: () => {
                filterState.search = ''; searchInput.value = ''; clearSearchBtn.classList.add('hidden');
            }});
        }

        if (tags.length === 0) return;

        tags.forEach(t => {
            const tagEl = document.createElement('span');
            tagEl.className = 'filter-tag';
            tagEl.innerHTML = `${t.label} <button class="filter-tag-remove" aria-label="Remove filter">✕</button>`;
            tagEl.querySelector('.filter-tag-remove').addEventListener('click', () => {
                t.reset();
                applyFilters();
            });
            activeFilterTags.appendChild(tagEl);
        });

        const clearBtn = document.createElement('button');
        clearBtn.className = 'filter-tags-clear-btn';
        clearBtn.textContent = 'Clear all';
        clearBtn.addEventListener('click', resetAllFilters);
        activeFilterTags.appendChild(clearBtn);
    }

    function updateHeaderAndMarketStats() {
        if (totalCountBadge) totalCountBadge.textContent = allProperties.length;
        if (matchedCountBadge) matchedCountBadge.textContent = filteredProperties.length;
        
        const favCount = allProperties.filter(p => p.favorite).length;
        if (favoritesCountBadge) favoritesCountBadge.textContent = favCount;
        if (resultsCountLabel) resultsCountLabel.textContent = `${filteredProperties.length} homes matched`;

        // Compute stats across filtered listings
        if (filteredProperties.length > 0) {
            const prices = filteredProperties.map(p => p.price);
            const sqfts = filteredProperties.filter(p => p.sqft > 0).map(p => p.sqft);
            const lots = filteredProperties.filter(p => p.lot_sqft > 0).map(p => p.lot_sqft);
            const ppsqfts = filteredProperties.filter(p => p.sqft > 0).map(p => p.price / p.sqft);

            const median = (arr) => {
                if (!arr.length) return 0;
                const sorted = [...arr].sort((a, b) => a - b);
                const mid = Math.floor(sorted.length / 2);
                return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            };

            const medPrice = Math.round(median(prices));
            const medPpsqft = Math.round(median(ppsqfts));
            const medSqft = Math.round(median(sqfts));
            const medLot = Math.round(median(lots));

            if (marketAvgPrice) marketAvgPrice.textContent = `$${medPrice.toLocaleString()}`;
            if (marketAvgPpsqft) marketAvgPpsqft.textContent = `$${medPpsqft}/sqft`;
            if (marketAvgSqft) marketAvgSqft.textContent = `${medSqft.toLocaleString()} sqft`;
            if (marketAvgLot) marketAvgLot.textContent = `${medLot.toLocaleString()} sqft`;

            renderAnalyticsView(filteredProperties, { medPrice, medPpsqft, medSqft, medLot, prices, sqfts, ppsqfts });
        }
    }

    // -------------------------------------------------------------------------
    // Property Detail Workstation Drawer
    // -------------------------------------------------------------------------
    function openPropertyDrawer(propId) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop) return;

        selectedPropId = propId;
        currentDrawerIndex = filteredProperties.findIndex(p => p.id === propId);
        if (currentDrawerIndex === -1) currentDrawerIndex = 0;

        recordRecentlyViewed(propId);

        // Header
        drawerAddress.textContent = prop.address;
        drawerCityZip.textContent = `${prop.city}, WA ${prop.zip || ''}`;
        btnDrawerFavorite.classList.toggle('favorited', !!prop.favorite);
        btnDrawerFavorite.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="${prop.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
        `;

        // Gallery Stage
        const photoIdx = activePhotoIndices[prop.id] || 0;
        const totalPhotos = prop.photos.length || 1;
        drawerActiveImg.src = prop.photos[photoIdx] || 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1200&q=80';
        drawerImgCur.textContent = photoIdx + 1;
        drawerImgTot.textContent = totalPhotos;

        drawerThumbnailsStrip.innerHTML = '';
        prop.photos.forEach((src, idx) => {
            const thumb = document.createElement('img');
            thumb.src = src;
            thumb.className = `drawer-thumb ${idx === photoIdx ? 'active' : ''}`;
            thumb.alt = `Photo ${idx + 1}`;
            thumb.addEventListener('click', () => {
                activePhotoIndices[prop.id] = idx;
                drawerActiveImg.src = src;
                drawerImgCur.textContent = idx + 1;
                drawerThumbnailsStrip.querySelectorAll('.drawer-thumb').forEach((t, i) => t.classList.toggle('active', i === idx));
            });
            drawerThumbnailsStrip.appendChild(thumb);
        });

        // Price & Monthly Estimation
        drawerPrice.textContent = `$${prop.price.toLocaleString()}`;
        const estMonthly = calculateEstimatedMonthly(prop.price, prop.hoa);
        drawerEstMonthly.textContent = `~$${estMonthly.total.toLocaleString()}/mo est.`;

        // Value Signals
        drawerSignalsList.innerHTML = '';
        const signals = calculateValueSignals(prop);
        signals.forEach(s => {
            const span = document.createElement('span');
            span.className = `chip chip-signal-${s.type}`;
            span.textContent = s.label;
            drawerSignalsList.appendChild(span);
        });

        // Smart Score
        const scoreObj = computeSmartScore(prop);
        drawerScoreVal.textContent = scoreObj.total;
        drawerScoreBars.innerHTML = '';
        for (const [k, f] of Object.entries(scoreObj.factors)) {
            const row = document.createElement('div');
            row.className = 'score-factor-row';
            row.innerHTML = `
                <span>${f.label}</span>
                <strong class="mono">${f.score}/100</strong>
            `;
            drawerScoreBars.appendChild(row);
        }

        // Specs Grid
        const ppsqft = Math.round(prop.price / Math.max(1, prop.sqft));
        dSpecBeds.textContent = prop.beds;
        dSpecBaths.textContent = prop.baths;
        dSpecSqft.textContent = `${prop.sqft.toLocaleString()} sqft`;
        dSpecPpsqft.textContent = `$${ppsqft}/sqft`;
        dSpecLot.textContent = `${prop.lot_sqft.toLocaleString()} sqft (${(prop.lot_sqft/43560).toFixed(2)} ac)`;
        dSpecGarage.textContent = `${prop.garage} Car`;
        dSpecYear.textContent = prop.year_built;
        dSpecHoa.textContent = prop.hoa > 0 ? `$${prop.hoa}/mo` : 'No HOA ($0)';

        // Description
        drawerDescription.textContent = prop.description || "Washington residential listing.";

        // Personal Rating & Notes
        updateDrawerStarPicker(prop.rating || 0);
        drawerNotesTextarea.value = prop.user_notes || '';
        drawerNoteStatus.textContent = prop.user_notes ? "Notes loaded" : "No notes yet";

        // Mortgage Breakdown
        updateDrawerMortgageBreakdown(prop);

        // Similar Homes
        renderSimilarHomesInDrawer(prop);

        // External Link
        drawerExternalLink.href = prop.url;

        // Reveal Drawer
        propertyDetailDrawer.classList.remove('hidden');
        propertyDetailDrawer.setAttribute('aria-hidden', 'false');
    }

    function closePropertyDrawer() {
        propertyDetailDrawer.classList.add('hidden');
        propertyDetailDrawer.setAttribute('aria-hidden', 'true');
        selectedPropId = null;
    }

    function stepDrawerProperty(direction) {
        if (!filteredProperties.length) return;
        currentDrawerIndex = (currentDrawerIndex + direction + filteredProperties.length) % filteredProperties.length;
        const nextProp = filteredProperties[currentDrawerIndex];
        if (nextProp) {
            openPropertyDrawer(nextProp.id);
            highlightCard(nextProp.id);
        }
    }

    function updateDrawerStarPicker(currentRating) {
        const stars = drawerStarPicker.querySelectorAll('.star-pick');
        stars.forEach(s => {
            const val = parseInt(s.getAttribute('data-val'), 10);
            s.classList.toggle('active', val <= currentRating);
        });

        const labels = ["Not rated", "1 Star - Basic Match", "2 Stars - Fair Option", "3 Stars - Good Contender", "4 Stars - High Priority", "5 Stars - Top Pick"];
        drawerRatingText.textContent = labels[currentRating] || "Not rated";
    }

    function updateDrawerMortgageBreakdown(prop) {
        const est = calculateEstimatedMonthly(prop.price, prop.hoa);
        dMortgageTotal.innerHTML = `$${est.total.toLocaleString()}<span class="per-mo">/mo</span>`;
        dValPi.textContent = `$${est.pi.toLocaleString()}/mo`;
        dValTax.textContent = `$${est.tax.toLocaleString()}/mo`;
        dValIns.textContent = `$${est.ins.toLocaleString()}/mo`;
        dValHoa.textContent = `$${est.hoa.toLocaleString()}/mo`;

        if (est.total > 0) {
            const piPct = (est.pi / est.total) * 100;
            const taxPct = (est.tax / est.total) * 100;
            const insPct = (est.ins / est.total) * 100;
            const hoaPct = (est.hoa / est.total) * 100;

            dMortgageBar.innerHTML = `
                <div class="d-seg d-seg-pi" style="width: ${piPct}%;" title="P&I: $${est.pi}"></div>
                <div class="d-seg d-seg-tax" style="width: ${taxPct}%;" title="Tax: $${est.tax}"></div>
                <div class="d-seg d-seg-ins" style="width: ${insPct}%;" title="Insurance: $${est.ins}"></div>
                <div class="d-seg d-seg-hoa" style="width: ${hoaPct}%;" title="HOA: $${est.hoa}"></div>
            `;
        }
    }

    function renderSimilarHomesInDrawer(targetProp) {
        drawerSimilarHomes.innerHTML = '';
        const similar = findSimilarHomes(targetProp, 4);

        if (!similar.length) {
            drawerSimilarHomes.innerHTML = '<p style="font-size: 11.5px; color: var(--text-muted);">No similar homes found.</p>';
            return;
        }

        similar.forEach(p => {
            const item = document.createElement('div');
            item.className = 'similar-home-item';
            item.innerHTML = `
                <img src="${p.photos[0] || ''}" alt="${p.address}" class="sim-thumb" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=400&q=80'">
                <div class="sim-info">
                    <span class="sim-price mono">$${p.price.toLocaleString()} • ${p.city}</span>
                    <strong class="sim-address">${p.address}</strong>
                    <span style="font-size: 10.5px; color: var(--text-secondary);">${p.beds}b / ${p.baths}ba • ${p.sqft.toLocaleString()} sqft</span>
                </div>
            `;
            item.addEventListener('click', () => {
                openPropertyDrawer(p.id);
                highlightCard(p.id);
            });
            drawerSimilarHomes.appendChild(item);
        });
    }

    // -------------------------------------------------------------------------
    // Persistence Actions (Notes, Ratings, Favorites)
    // -------------------------------------------------------------------------
    async function toggleFavorite(propId) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop) return;

        prop.favorite = !prop.favorite;
        persistUserData(propId, { favorite: prop.favorite });

        try {
            fetch(`/api/properties/${propId}/favorite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ favorite: prop.favorite })
            }).catch(() => {});

            showToast(prop.favorite ? `Saved "${prop.address}" to Shortlist` : `Removed "${prop.address}" from Shortlist`);
            applyFilters();

            if (selectedPropId === propId) {
                btnDrawerFavorite.classList.toggle('favorited', !!prop.favorite);
            }
        } catch (e) {
            console.error("Favorite toggle error:", e);
        }
    }

    async function updatePropertyRating(propId, rating) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop) return;

        prop.rating = rating;
        persistUserData(propId, { rating: rating });

        try {
            fetch(`/api/properties/${propId}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: rating })
            }).catch(() => {});

            showToast(`Rated ${rating} ★ for ${prop.address}`);
            applyFilters();

            if (selectedPropId === propId) {
                updateDrawerStarPicker(rating);
            }
        } catch (e) {
            console.error("Rating update error:", e);
        }
    }

    function saveDrawerNotesDebounced() {
        if (!selectedPropId) return;
        const prop = allProperties.find(p => p.id === selectedPropId);
        if (!prop) return;

        const val = drawerNotesTextarea.value.trim();
        prop.user_notes = val;
        persistUserData(selectedPropId, { user_notes: val });
        drawerNoteStatus.textContent = "Saving...";

        clearTimeout(noteSaveDebounceTimer);
        noteSaveDebounceTimer = setTimeout(async () => {
            try {
                await fetch(`/api/properties/${prop.id}/note`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_notes: val })
                });
                drawerNoteStatus.textContent = "Auto-saved to DB";
            } catch (e) {
                drawerNoteStatus.textContent = "Saved locally";
            }
        }, 300);
    }

    // -------------------------------------------------------------------------
    // Comparison Matrix
    // -------------------------------------------------------------------------
    function updateCompareDock() {
        const count = comparisonSet.size;
        compareCountBadge.textContent = `${count} / 4`;
        compareDock.classList.toggle('hidden', count === 0);
        btnOpenComparisonMatrix.disabled = count < 2;

        compareThumbnailsRow.innerHTML = '';
        const propArray = Array.from(comparisonSet).map(id => allProperties.find(p => p.id === id)).filter(Boolean);

        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'dock-thumb-slot';
            if (i < propArray.length) {
                const p = propArray[i];
                slot.classList.add('filled');
                slot.innerHTML = `
                    <img src="${p.photos[0] || ''}" alt="${p.address}" class="dock-thumb-img" title="${p.address} ($${p.price.toLocaleString()})" loading="lazy">
                    <button class="dock-thumb-remove" data-id="${p.id}" title="Remove" aria-label="Remove">✕</button>
                `;
            } else {
                slot.innerHTML = `<span style="color: var(--text-muted); font-size: 10px;">+ Slot</span>`;
            }
            compareThumbnailsRow.appendChild(slot);
        }

        compareThumbnailsRow.querySelectorAll('.dock-thumb-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                comparisonSet.delete(id);
                updateCompareDock();
                renderGalleryCards();
            });
        });
    }

    function openComparisonMatrix() {
        const props = Array.from(comparisonSet).map(id => allProperties.find(p => p.id === id)).filter(Boolean);
        if (props.length < 2) return;

        const minPrice = Math.min(...props.map(p => p.price));
        const minPpsqft = Math.min(...props.map(p => Math.round(p.price / Math.max(1, p.sqft))));
        const maxSqft = Math.max(...props.map(p => p.sqft));
        const maxLot = Math.max(...props.map(p => p.lot_sqft));
        const maxYear = Math.max(...props.map(p => p.year_built));
        const minHoa = Math.min(...props.map(p => p.hoa));
        const maxRating = Math.max(...props.map(p => p.rating || 0));

        let tableHtml = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Property Details</th>
                        ${props.map(p => `
                            <td>
                                <img src="${p.photos[0] || ''}" class="comp-img-header" alt="${p.address}" loading="lazy">
                                <div class="comp-price">$${p.price.toLocaleString()}</div>
                                <strong>${p.address}</strong><br>
                                <span style="font-size: 11px; color: var(--text-secondary);">${p.city}, WA ${p.zip || ''}</span>
                            </td>
                        `).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th>Price</th>
                        ${props.map(p => `<td class="${p.price === minPrice ? 'best-metric-cell' : ''}">$${p.price.toLocaleString()} ${p.price === minPrice ? '★ (Lowest)' : ''}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Monthly Est. Cost</th>
                        ${props.map(p => `<td><strong style="color: var(--accent-emerald);">~$${calculateEstimatedMonthly(p.price, p.hoa).total.toLocaleString()}/mo</strong></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Price / SqFt</th>
                        ${props.map(p => {
                            const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
                            return `<td class="${ppsqft === minPpsqft ? 'best-metric-cell' : ''}">$${ppsqft}/sqft ${ppsqft === minPpsqft ? '★ (Best Value)' : ''}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <th>Bedrooms / Baths</th>
                        ${props.map(p => `<td>${p.beds} Beds • ${p.baths} Baths</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Living Area</th>
                        ${props.map(p => `<td class="${p.sqft === maxSqft ? 'best-metric-cell' : ''}">${p.sqft.toLocaleString()} sqft ${p.sqft === maxSqft ? '★ (Largest)' : ''}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Lot Size</th>
                        ${props.map(p => `<td class="${p.lot_sqft === maxLot ? 'best-metric-cell' : ''}">${p.lot_sqft.toLocaleString()} sqft (${(p.lot_sqft / 43560).toFixed(2)} ac)</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Garage Spaces</th>
                        ${props.map(p => `<td>${p.garage} Car Workshop/Attached</td>`).join('')}
                    </tr>
                    <tr>
                        <th>HOA Monthly</th>
                        ${props.map(p => `<td class="${p.hoa === minHoa ? 'best-metric-cell' : ''}">${p.hoa > 0 ? `$${p.hoa}/mo` : 'No HOA ($0)'}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Year Built</th>
                        ${props.map(p => `<td class="${p.year_built === maxYear ? 'best-metric-cell' : ''}">${p.year_built}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Personal Rating</th>
                        ${props.map(p => `<td class="${(p.rating || 0) === maxRating && maxRating > 0 ? 'best-metric-cell' : ''}"><span style="color: var(--accent-amber);">${'★'.repeat(p.rating || 0)}${'☆'.repeat(5 - (p.rating || 0))}</span></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Private Notes</th>
                        ${props.map(p => `<td><em style="color: var(--text-secondary); font-size: 11.5px;">${p.user_notes || 'No notes added'}</em></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Action</th>
                        ${props.map(p => `
                            <td>
                                <button class="btn btn-secondary btn-sm" onclick="window.HouseFinderApp.openDrawerById('${p.id}'); document.getElementById('comparison-modal').classList.add('hidden');">
                                    Open Workstation
                                </button>
                            </td>
                        `).join('')}
                    </tr>
                </tbody>
            </table>
        `;

        comparisonTableWrapper.innerHTML = tableHtml;
        comparisonModal.classList.remove('hidden');
    }

    // -------------------------------------------------------------------------
    // Mortgage Estimator Modal
    // -------------------------------------------------------------------------
    function openMortgageEstimator(propId) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop) return;

        calcPropAddress.textContent = `Estimated monthly payment for ${prop.address}, ${prop.city}, WA`;
        calcHomePrice.value = prop.price;
        calcDownPct.value = mortgageAssumptions.downPct;
        calcLoanTerm.value = String(mortgageAssumptions.termYears);
        calcInterestRate.value = mortgageAssumptions.rate;
        calcTaxRate.value = mortgageAssumptions.taxRate;
        calcInsurance.value = mortgageAssumptions.insurance;
        calcHoaFee.value = prop.hoa || 0;

        recalculateMortgageModal();
        mortgageModal.classList.remove('hidden');
    }

    function recalculateMortgageModal() {
        const price = parseFloat(calcHomePrice.value) || 0;
        const downPct = parseFloat(calcDownPct.value) || 0;
        const downAmount = price * (downPct / 100);
        calcDownAmount.value = `$${Math.round(downAmount).toLocaleString()}`;

        const termYears = parseInt(calcLoanTerm.value, 10) || 30;
        const rate = parseFloat(calcInterestRate.value) || 6.65;
        const taxRate = parseFloat(calcTaxRate.value) || 1.02;
        const insAnnual = parseFloat(calcInsurance.value) || 1200;
        const hoa = parseFloat(calcHoaFee.value) || 0;

        const principal = Math.max(0, price - downAmount);
        calcLoanPrincipal.textContent = `$${Math.round(principal).toLocaleString()}`;

        const monthlyRate = (rate / 100) / 12;
        const totalPayments = termYears * 12;

        let monthlyPi = 0;
        if (monthlyRate > 0 && principal > 0) {
            monthlyPi = principal * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) / (Math.pow(1 + monthlyRate, totalPayments) - 1);
        } else if (principal > 0) {
            monthlyPi = principal / totalPayments;
        }

        const monthlyTax = (price * (taxRate / 100)) / 12;
        const monthlyIns = insAnnual / 12;
        const totalMonthly = monthlyPi + monthlyTax + monthlyIns + hoa;

        calcTotalMonthly.innerHTML = `$${Math.round(totalMonthly).toLocaleString()}<span class="per-mo">/mo</span>`;
        calcValPi.textContent = `$${Math.round(monthlyPi).toLocaleString()}/mo`;
        calcValTax.textContent = `$${Math.round(monthlyTax).toLocaleString()}/mo`;
        calcValIns.textContent = `$${Math.round(monthlyIns).toLocaleString()}/mo`;
        calcValHoa.textContent = `$${Math.round(hoa).toLocaleString()}/mo`;

        if (totalMonthly > 0) {
            const piPct = (monthlyPi / totalMonthly) * 100;
            const taxPct = (monthlyTax / totalMonthly) * 100;
            const insPct = (monthlyIns / totalMonthly) * 100;
            const hoaPct = (hoa / totalMonthly) * 100;

            calcVisualBar.innerHTML = `
                <div class="bar-segment seg-principal" style="width: ${piPct}%;" title="Principal & Interest"></div>
                <div class="bar-segment seg-tax" style="width: ${taxPct}%;" title="Property Taxes"></div>
                <div class="bar-segment seg-ins" style="width: ${insPct}%;" title="Insurance"></div>
                <div class="bar-segment seg-hoa" style="width: ${hoaPct}%;" title="HOA Dues"></div>
            `;
        }

        // Persist user assumptions
        mortgageAssumptions = { downPct, termYears, rate, taxRate, insurance: insAnnual };
        try {
            localStorage.setItem(STORAGE_MORTGAGE_KEY, JSON.stringify(mortgageAssumptions));
        } catch (e) {}
    }

    // -------------------------------------------------------------------------
    // Photo Lightbox Modal
    // -------------------------------------------------------------------------
    function openPhotoLightbox(propId, startIdx = 0) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop || !prop.photos || prop.photos.length === 0) return;

        currentLightboxProp = prop;
        currentLightboxIndex = startIdx;

        lightboxAddress.textContent = `${prop.address}, ${prop.city}, WA`;
        lightboxSpecs.textContent = `${prop.beds} Beds • ${prop.baths} Baths • ${prop.sqft.toLocaleString()} sqft • Built ${prop.year_built}`;
        lightboxPrice.textContent = `$${prop.price.toLocaleString()}`;
        lightboxExternalLink.href = prop.url;

        renderLightboxStage();
        photoLightboxModal.classList.remove('hidden');
    }

    function renderLightboxStage() {
        if (!currentLightboxProp) return;
        const photos = currentLightboxProp.photos;
        const total = photos.length;
        if (currentLightboxIndex >= total) currentLightboxIndex = 0;
        if (currentLightboxIndex < 0) currentLightboxIndex = total - 1;

        lightboxActiveImg.src = photos[currentLightboxIndex];
        lightboxCurrentNum.textContent = currentLightboxIndex + 1;
        lightboxTotalNum.textContent = total;

        lightboxThumbnailsStrip.innerHTML = '';
        photos.forEach((src, idx) => {
            const thumb = document.createElement('img');
            thumb.src = src;
            thumb.className = `strip-thumb ${idx === currentLightboxIndex ? 'active' : ''}`;
            thumb.alt = `Photo ${idx + 1}`;
            thumb.addEventListener('click', () => {
                currentLightboxIndex = idx;
                renderLightboxStage();
            });
            lightboxThumbnailsStrip.appendChild(thumb);
        });

        const activeThumb = lightboxThumbnailsStrip.querySelector('.strip-thumb.active');
        if (activeThumb) {
            activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    function stepLightbox(direction) {
        if (!currentLightboxProp) return;
        currentLightboxIndex = (currentLightboxIndex + direction + currentLightboxProp.photos.length) % currentLightboxProp.photos.length;
        renderLightboxStage();
    }

    // -------------------------------------------------------------------------
    // Analytics View Renderer (Reactive to active filters)
    // -------------------------------------------------------------------------
    function renderAnalyticsView(filteredList, stats) {
        const anSampleSize = document.getElementById('an-sample-size');
        const anMedianPrice = document.getElementById('an-median-price');
        const anAvgPrice = document.getElementById('an-avg-price');
        const anPriceRange = document.getElementById('an-price-range');
        const anAvgPpsqft = document.getElementById('an-avg-ppsqft');
        const anMedianSqft = document.getElementById('an-median-sqft');
        const anMedianLot = document.getElementById('an-median-lot');
        const anFavCount = document.getElementById('an-fav-count');
        const anRatedCount = document.getElementById('an-rated-count');
        const priceDistributionBars = document.getElementById('price-distribution-bars');
        const cityDistributionList = document.getElementById('city-distribution-list');
        const garageDistributionList = document.getElementById('garage-distribution-list');
        const yearDistributionList = document.getElementById('year-distribution-list');

        if (anSampleSize) anSampleSize.textContent = filteredList.length;
        if (anMedianPrice) anMedianPrice.textContent = `$${stats.medPrice.toLocaleString()}`;
        
        const meanPrice = filteredList.length ? Math.round(stats.prices.reduce((a, b) => a + b, 0) / filteredList.length) : 0;
        if (anAvgPrice) anAvgPrice.textContent = `$${meanPrice.toLocaleString()}`;
        
        const minPrice = filteredList.length ? Math.min(...stats.prices) : 0;
        const maxPrice = filteredList.length ? Math.max(...stats.prices) : 0;
        if (anPriceRange) anPriceRange.textContent = `$${minPrice.toLocaleString()} – $${maxPrice.toLocaleString()}`;
        
        if (anAvgPpsqft) anAvgPpsqft.textContent = `$${stats.medPpsqft}/sqft`;
        if (anMedianSqft) anMedianSqft.textContent = `${stats.medSqft.toLocaleString()} sqft`;
        if (anMedianLot) anMedianLot.textContent = `${stats.medLot.toLocaleString()} sqft`;

        const favs = filteredList.filter(p => p.favorite).length;
        const rated = filteredList.filter(p => (p.rating || 0) > 0).length;
        if (anFavCount) anFavCount.textContent = favs;
        if (anRatedCount) anRatedCount.textContent = rated;

        // Price distribution
        if (priceDistributionBars) {
            priceDistributionBars.innerHTML = '';
            const brackets = {
                '< $375k': filteredList.filter(p => p.price < 375000).length,
                '$375k–$425k': filteredList.filter(p => p.price >= 375000 && p.price < 425000).length,
                '$425k–$475k': filteredList.filter(p => p.price >= 425000 && p.price < 475000).length,
                '$475k–$550k': filteredList.filter(p => p.price >= 475000 && p.price < 550000).length,
                '$550k+': filteredList.filter(p => p.price >= 550000).length,
            };
            const maxVal = Math.max(...Object.values(brackets), 1);
            for (const [bracket, count] of Object.entries(brackets)) {
                const pct = Math.round((count / maxVal) * 100);
                const item = document.createElement('div');
                item.className = 'dist-bar-item';
                item.innerHTML = `
                    <div class="dist-bar-label">
                        <span>${bracket}</span>
                        <strong class="mono">${count} homes</strong>
                    </div>
                    <div class="dist-track">
                        <div class="dist-fill" style="width: ${pct}%;"></div>
                    </div>
                `;
                priceDistributionBars.appendChild(item);
            }
        }

        // City distribution
        if (cityDistributionList) {
            cityDistributionList.innerHTML = '';
            const cityCounts = {};
            filteredList.forEach(p => {
                const c = p.city || 'Other';
                cityCounts[c] = (cityCounts[c] || 0) + 1;
            });
            for (const [city, count] of Object.entries(cityCounts).sort((a, b) => b[1] - a[1])) {
                const row = document.createElement('div');
                row.className = 'city-dist-item';
                row.innerHTML = `
                    <span>${city}, WA</span>
                    <span class="city-count-badge mono">${count}</span>
                `;
                cityDistributionList.appendChild(row);
            }
        }

        // Garage distribution
        if (garageDistributionList) {
            garageDistributionList.innerHTML = '';
            const garageCounts = { '2 Car': 0, '3+ Car': 0, 'Other': 0 };
            filteredList.forEach(p => {
                if (p.garage >= 3) garageCounts['3+ Car']++;
                else if (p.garage === 2) garageCounts['2 Car']++;
                else garageCounts['Other']++;
            });
            for (const [g, count] of Object.entries(garageCounts)) {
                const row = document.createElement('div');
                row.className = 'city-dist-item';
                row.innerHTML = `
                    <span>${g}</span>
                    <span class="city-count-badge mono">${count}</span>
                `;
                garageDistributionList.appendChild(row);
            }
        }

        // Year distribution
        if (yearDistributionList) {
            yearDistributionList.innerHTML = '';
            const yearCounts = {
                'Pre-1990': filteredList.filter(p => p.year_built < 1990 && p.year_built > 0).length,
                '1990–2009': filteredList.filter(p => p.year_built >= 1990 && p.year_built < 2010).length,
                '2010+ (Modern)': filteredList.filter(p => p.year_built >= 2010).length,
            };
            for (const [y, count] of Object.entries(yearCounts)) {
                const row = document.createElement('div');
                row.className = 'city-dist-item';
                row.innerHTML = `
                    <span>${y}</span>
                    <span class="city-count-badge mono">${count}</span>
                `;
                yearDistributionList.appendChild(row);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Command Palette (Ctrl+K)
    // -------------------------------------------------------------------------
    function openCommandPalette() {
        cmdPaletteInput.value = '';
        renderCommandPaletteResults('');
        cmdPaletteModal.classList.remove('hidden');
        cmdPaletteInput.focus();
    }

    function closeCommandPalette() {
        cmdPaletteModal.classList.add('hidden');
    }

    function renderCommandPaletteResults(query) {
        cmdPaletteResults.innerHTML = '';
        const q = query.trim().toLowerCase();

        const commands = [
            { category: 'Navigation', title: 'Switch to Split View (Cards + Map)', action: () => setViewMode('split'), badge: '1' },
            { category: 'Navigation', title: 'Switch to Listings Only View', action: () => setViewMode('grid'), badge: '2' },
            { category: 'Navigation', title: 'Switch to Full Map View', action: () => setViewMode('map'), badge: '3' },
            { category: 'Navigation', title: 'Open Market Analytics Dashboard', action: () => setViewMode('analytics'), badge: '4' },
            { category: 'Filters', title: 'Show Saved Shortlist Properties Only', action: () => { filterState.favoritesOnly = true; filterFavoritesToggle.checked = true; applyFilters(); }, badge: 'F' },
            { category: 'Filters', title: 'Reset All Search Filters to Default', action: () => resetAllFilters(), badge: 'R' },
            { category: 'Sorting', title: 'Sort by Smart Shortlist Score', action: () => { filterState.sortBy = 'smart_score'; sortDropdown.value = 'smart_score'; applyFilters(); } },
            { category: 'Sorting', title: 'Sort by Price: Low to High', action: () => { filterState.sortBy = 'price_asc'; sortDropdown.value = 'price_asc'; applyFilters(); } },
            { category: 'Sorting', title: 'Sort by Price/SqFt: Low to High', action: () => { filterState.sortBy = 'price_per_sqft_asc'; sortDropdown.value = 'price_per_sqft_asc'; applyFilters(); } },
            { category: 'Tools', title: 'Tune Smart Score Factor Weights', action: () => openScoringModal() },
            { category: 'Tools', title: 'Open Live MLS Scraper Utility', action: () => openScraperModal() },
            { category: 'Tools', title: 'Export Matching Listings to CSV', action: () => exportCsv() },
            { category: 'Tools', title: 'Toggle Layout Density (Compact/Comfortable)', action: () => toggleDensity() },
        ];

        // Add City Quick Filters
        const cities = [...new Set(allProperties.map(p => p.city))].sort();
        cities.forEach(c => {
            commands.push({
                category: 'Jump to City',
                title: `Filter by ${c}, WA`,
                action: () => { filterState.city = c.toLowerCase(); citySelect.value = c.toLowerCase(); applyFilters(); }
            });
        });

        // Add matching property addresses
        if (q.length >= 2) {
            allProperties.filter(p => p.address.toLowerCase().includes(q) || p.city.toLowerCase().includes(q)).slice(0, 5).forEach(p => {
                commands.push({
                    category: 'Property Result',
                    title: `${p.address}, ${p.city} ($${p.price.toLocaleString()})`,
                    action: () => openPropertyDrawer(p.id)
                });
            });
        }

        const filteredCmds = commands.filter(c => !q || c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));

        let currentCat = '';
        filteredCmds.forEach((cmd, idx) => {
            if (cmd.category !== currentCat) {
                currentCat = cmd.category;
                const header = document.createElement('div');
                header.className = 'cmd-category-header';
                header.textContent = currentCat;
                cmdPaletteResults.appendChild(header);
            }

            const item = document.createElement('div');
            item.className = `cmd-item ${idx === 0 ? 'selected' : ''}`;
            item.innerHTML = `
                <div class="cmd-item-left">
                    <span>${cmd.title}</span>
                </div>
                ${cmd.badge ? `<kbd class="kbd-badge">${cmd.badge}</kbd>` : ''}
            `;
            item.addEventListener('click', () => {
                closeCommandPalette();
                cmd.action();
            });
            cmdPaletteResults.appendChild(item);
        });
    }

    // -------------------------------------------------------------------------
    // Saved Search Presets Manager
    // -------------------------------------------------------------------------
    function loadSavedPresets() {
        try {
            const raw = localStorage.getItem(STORAGE_PRESETS_KEY);
            const presets = raw ? JSON.parse(raw) : [];
            customPresetsList.innerHTML = '';

            if (!presets.length) {
                customPresetsList.innerHTML = '<div style="padding: 4px 12px; font-size: 11px; color: var(--text-muted);">No custom presets yet.</div>';
                return;
            }

            presets.forEach((p, idx) => {
                const item = document.createElement('div');
                item.className = 'dropdown-item';
                item.innerHTML = `
                    <span>${p.name}</span>
                    <button class="filter-tag-remove" data-idx="${idx}" title="Delete preset">✕</button>
                `;
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('filter-tag-remove')) {
                        e.stopPropagation();
                        deleteCustomPreset(idx);
                        return;
                    }
                    applyPresetState(p.state);
                    activePresetLabel.textContent = p.name;
                    presetDropdownMenu.classList.add('hidden');
                });
                customPresetsList.appendChild(item);
            });
        } catch (e) {}
    }

    function saveCurrentPreset() {
        const name = prompt("Enter a name for this search preset (e.g., 'Spokane 3-Car Large Lot'):");
        if (!name || !name.trim()) return;

        try {
            const raw = localStorage.getItem(STORAGE_PRESETS_KEY);
            const presets = raw ? JSON.parse(raw) : [];
            presets.push({ name: name.trim(), state: { ...filterState } });
            localStorage.setItem(STORAGE_PRESETS_KEY, JSON.stringify(presets));
            showToast(`Preset "${name.trim()}" saved!`);
            loadSavedPresets();
        } catch (e) {
            showToast("Could not save preset.", "error");
        }
    }

    function deleteCustomPreset(idx) {
        try {
            const raw = localStorage.getItem(STORAGE_PRESETS_KEY);
            let presets = raw ? JSON.parse(raw) : [];
            presets.splice(idx, 1);
            localStorage.setItem(STORAGE_PRESETS_KEY, JSON.stringify(presets));
            loadSavedPresets();
            showToast("Preset deleted.");
        } catch (e) {}
    }

    function applyPresetState(state) {
        Object.assign(filterState, state);
        
        searchInput.value = filterState.search || '';
        citySelect.value = filterState.city || 'all';
        priceMinSlider.value = filterState.minPrice;
        priceMaxSlider.value = filterState.maxPrice;
        priceRangeDisplay.textContent = `$${Math.round(filterState.minPrice/1000)}k – $${Math.round(filterState.maxPrice/1000)}k`;
        sqftMinSlider.value = filterState.minSqft;
        sqftMaxSlider.value = filterState.maxSqft;
        sqftRangeDisplay.textContent = `${filterState.minSqft.toLocaleString()} – ${filterState.maxSqft.toLocaleString()} sqft`;
        hoaSlider.value = filterState.maxHoa;
        hoaDisplay.textContent = filterState.maxHoa === 0 ? '$0/mo (No HOA)' : `≤ $${filterState.maxHoa}/mo`;
        lotSlider.value = filterState.minLot;
        lotDisplay.textContent = `${filterState.minLot.toLocaleString()}+ sqft`;
        yearSelect.value = String(filterState.minYear || 0);
        ratingFilter.value = String(filterState.minRating || 0);
        filterFavoritesToggle.checked = !!filterState.favoritesOnly;

        bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-beds') === String(filterState.minBeds)));
        bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-baths') === String(filterState.minBaths)));
        garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === String(filterState.minGarage)));

        applyFilters();
    }

    // -------------------------------------------------------------------------
    // Smart Score Weights Modal
    // -------------------------------------------------------------------------
    function openScoringModal() {
        document.getElementById('w-ppsqft').value = scoreWeights.ppsqft;
        document.getElementById('w-ppsqft-val').textContent = `${scoreWeights.ppsqft}%`;
        document.getElementById('w-sqft').value = scoreWeights.sqft;
        document.getElementById('w-sqft-val').textContent = `${scoreWeights.sqft}%`;
        document.getElementById('w-lot').value = scoreWeights.lot;
        document.getElementById('w-lot-val').textContent = `${scoreWeights.lot}%`;
        document.getElementById('w-garage').value = scoreWeights.garage;
        document.getElementById('w-garage-val').textContent = `${scoreWeights.garage}%`;
        document.getElementById('w-year').value = scoreWeights.year;
        document.getElementById('w-year-val').textContent = `${scoreWeights.year}%`;
        document.getElementById('w-hoa').value = scoreWeights.hoa;
        document.getElementById('w-hoa-val').textContent = `${scoreWeights.hoa}%`;
        document.getElementById('w-rating').value = scoreWeights.rating;
        document.getElementById('w-rating-val').textContent = `${scoreWeights.rating}%`;

        scoringModal.classList.remove('hidden');
    }

    function saveScoringWeights() {
        scoreWeights.ppsqft = parseInt(document.getElementById('w-ppsqft').value, 10);
        scoreWeights.sqft = parseInt(document.getElementById('w-sqft').value, 10);
        scoreWeights.lot = parseInt(document.getElementById('w-lot').value, 10);
        scoreWeights.garage = parseInt(document.getElementById('w-garage').value, 10);
        scoreWeights.year = parseInt(document.getElementById('w-year').value, 10);
        scoreWeights.hoa = parseInt(document.getElementById('w-hoa').value, 10);
        scoreWeights.rating = parseInt(document.getElementById('w-rating').value, 10);

        try {
            localStorage.setItem(STORAGE_WEIGHTS_KEY, JSON.stringify(scoreWeights));
        } catch (e) {}

        scoringModal.classList.add('hidden');
        showToast("Smart Score weights updated!");
        applyFilters();
    }

    // -------------------------------------------------------------------------
    // URL Hash State Sync (Shareable & Bookmarkable Searches)
    // -------------------------------------------------------------------------
    function syncStateToUrl() {
        const params = new URLSearchParams();
        if (filterState.city !== 'all') params.set('city', filterState.city);
        if (filterState.minPrice > 250000) params.set('minPrice', filterState.minPrice);
        if (filterState.maxPrice < 750000) params.set('maxPrice', filterState.maxPrice);
        if (filterState.minBeds > 0) params.set('beds', filterState.minBeds);
        if (filterState.minBaths > 0) params.set('baths', filterState.minBaths);
        if (filterState.minGarage > 0) params.set('garage', filterState.minGarage);
        if (filterState.minSqft > 800) params.set('minSqft', filterState.minSqft);
        if (filterState.maxSqft < 4000) params.set('maxSqft', filterState.maxSqft);
        if (filterState.maxHoa < 300) params.set('maxHoa', filterState.maxHoa);
        if (filterState.minLot > 2000) params.set('minLot', filterState.minLot);
        if (filterState.minYear > 0) params.set('minYear', filterState.minYear);
        if (filterState.favoritesOnly) params.set('favorites', '1');
        if (filterState.sortBy !== 'smart_score') params.set('sort', filterState.sortBy);
        if (activeView !== 'split') params.set('view', activeView);
        if (filterState.search) params.set('q', filterState.search);

        const hash = params.toString();
        if (window.location.hash.replace('#', '') !== hash) {
            history.replaceState(null, '', hash ? `#${hash}` : window.location.pathname);
        }
    }

    function loadStateFromUrl() {
        const hash = window.location.hash.replace('#', '');
        if (!hash) return;
        const params = new URLSearchParams(hash);

        if (params.has('city')) filterState.city = params.get('city');
        if (params.has('minPrice')) filterState.minPrice = parseInt(params.get('minPrice'), 10);
        if (params.has('maxPrice')) filterState.maxPrice = parseInt(params.get('maxPrice'), 10);
        if (params.has('beds')) filterState.minBeds = parseInt(params.get('beds'), 10);
        if (params.has('baths')) filterState.minBaths = parseFloat(params.get('baths'));
        if (params.has('garage')) filterState.minGarage = parseInt(params.get('garage'), 10);
        if (params.has('minSqft')) filterState.minSqft = parseInt(params.get('minSqft'), 10);
        if (params.has('maxSqft')) filterState.maxSqft = parseInt(params.get('maxSqft'), 10);
        if (params.has('maxHoa')) filterState.maxHoa = parseInt(params.get('maxHoa'), 10);
        if (params.has('minLot')) filterState.minLot = parseInt(params.get('minLot'), 10);
        if (params.has('minYear')) filterState.minYear = parseInt(params.get('minYear'), 10);
        if (params.has('favorites')) filterState.favoritesOnly = params.get('favorites') === '1';
        if (params.has('sort')) filterState.sortBy = params.get('sort');
        if (params.has('q')) filterState.search = params.get('q');
        if (params.has('view')) setViewMode(params.get('view'));

        searchInput.value = filterState.search;
        citySelect.value = filterState.city;
        priceMinSlider.value = filterState.minPrice;
        priceMaxSlider.value = filterState.maxPrice;
        priceRangeDisplay.textContent = `$${Math.round(filterState.minPrice/1000)}k – $${Math.round(filterState.maxPrice/1000)}k`;
        sqftMinSlider.value = filterState.minSqft;
        sqftMaxSlider.value = filterState.maxSqft;
        sqftRangeDisplay.textContent = `${filterState.minSqft.toLocaleString()} – ${filterState.maxSqft.toLocaleString()} sqft`;
        hoaSlider.value = filterState.maxHoa;
        hoaDisplay.textContent = `≤ $${filterState.maxHoa}/mo`;
        lotSlider.value = filterState.minLot;
        lotDisplay.textContent = `${filterState.minLot.toLocaleString()}+ sqft`;
        yearSelect.value = String(filterState.minYear || 0);
        filterFavoritesToggle.checked = filterState.favoritesOnly;
        sortDropdown.value = filterState.sortBy;

        bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-beds') === String(filterState.minBeds)));
        bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-baths') === String(filterState.minBaths)));
        garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === String(filterState.minGarage)));
    }

    // -------------------------------------------------------------------------
    // Recently Viewed Tracking
    // -------------------------------------------------------------------------
    function recordRecentlyViewed(propId) {
        recentPropertyIds = recentPropertyIds.filter(id => id !== propId);
        recentPropertyIds.unshift(propId);
        if (recentPropertyIds.length > 12) recentPropertyIds.pop();
        try {
            localStorage.setItem(STORAGE_RECENT_KEY, JSON.stringify(recentPropertyIds));
        } catch (e) {}
    }

    // -------------------------------------------------------------------------
    // Density Mode Toggle
    // -------------------------------------------------------------------------
    function toggleDensity() {
        const isComfort = document.body.classList.contains('density-comfortable');
        document.body.classList.toggle('density-comfortable', !isComfort);
        document.body.classList.toggle('density-compact', isComfort);
        const mode = isComfort ? 'compact' : 'comfortable';
        try { localStorage.setItem(STORAGE_DENSITY_KEY, mode); } catch (e) {}
        showToast(`Switched to ${mode} density.`);
    }

    // -------------------------------------------------------------------------
    // View Switcher
    // -------------------------------------------------------------------------
    function setViewMode(mode) {
        activeView = mode;
        [viewTabSplit, viewTabGrid, viewTabMap, viewTabAnalytics].forEach(btn => btn.classList.remove('active'));
        workspaceViewport.className = `workspace-viewport view-${mode}`;

        if (mode === 'split') viewTabSplit.classList.add('active');
        if (mode === 'grid') viewTabGrid.classList.add('active');
        if (mode === 'map') viewTabMap.classList.add('active');
        if (mode === 'analytics') viewTabAnalytics.classList.add('active');

        if (map && (mode === 'split' || mode === 'map')) {
            setTimeout(() => map.invalidateSize(), 150);
        }

        syncStateToUrl();
    }

    // -------------------------------------------------------------------------
    // Reset Filters
    // -------------------------------------------------------------------------
    function resetAllFilters() {
        filterState.search = '';
        filterState.city = 'all';
        filterState.minPrice = 250000;
        filterState.maxPrice = 750000;
        filterState.minBeds = 0;
        filterState.minBaths = 0;
        filterState.minSqft = 800;
        filterState.maxSqft = 4000;
        filterState.minGarage = 0;
        filterState.minLot = 2000;
        filterState.minYear = 0;
        filterState.maxHoa = 300;
        filterState.maxPpsqft = 500;
        filterState.minRating = 0;
        filterState.favoritesOnly = false;
        filterState.sortBy = 'smart_score';
        filterState.mapBoundsOnly = false;

        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        citySelect.value = 'all';
        priceMinSlider.value = 250000;
        priceMaxSlider.value = 750000;
        priceRangeDisplay.textContent = '$250k – $750k';
        sqftMinSlider.value = 800;
        sqftMaxSlider.value = 4000;
        sqftRangeDisplay.textContent = '800 – 4,000 sqft';
        hoaSlider.value = 300;
        hoaDisplay.textContent = '≤ $300/mo';
        lotSlider.value = 2000;
        lotDisplay.textContent = '2,000+ sqft';
        yearSelect.value = '0';
        maxPpsqftSlider.value = 500;
        maxPpsqftDisplay.textContent = 'No Limit';
        ratingFilter.value = '0';
        filterFavoritesToggle.checked = false;
        if (mapBoundsFilterToggle) mapBoundsFilterToggle.checked = false;
        sortDropdown.value = 'smart_score';
        activePresetLabel.textContent = 'Presets';

        bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-beds') === '0'));
        bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-baths') === '0'));
        garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === '0'));

        applyFilters();
        showToast("Filters reset to default.");
    }

    // -------------------------------------------------------------------------
    // Instant Client-Side CSV Export (Works 100% on GitHub Pages & Localhost)
    // -------------------------------------------------------------------------
    function exportCsv() {
        if (!filteredProperties.length) {
            showToast("No matching properties to export.", "error");
            return;
        }

        const headers = [
            "Property ID", "Address", "City", "State", "Zip Code",
            "Price ($)", "Bedrooms", "Bathrooms", "Living SqFt", "Lot Size (sqft)",
            "Lot Size (acres)", "Price/SqFt ($)", "Year Built", "HOA Monthly ($)",
            "Garage Spaces", "User Rating", "Shortlist", "Private Notes",
            "Latitude", "Longitude", "Listing URL"
        ];

        const rows = [headers];

        filteredProperties.forEach(p => {
            const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
            const acres = (p.lot_sqft / 43560).toFixed(3);
            const notesClean = (p.user_notes || '').replace(/"/g, '""').replace(/\r?\n/g, ' ');

            rows.push([
                `"${p.id}"`,
                `"${p.address.replace(/"/g, '""')}"`,
                `"${p.city}"`,
                `"${p.state}"`,
                `"${p.zip || ''}"`,
                p.price,
                p.beds,
                p.baths,
                p.sqft,
                p.lot_sqft,
                acres,
                ppsqft,
                p.year_built,
                p.hoa,
                p.garage,
                p.rating || 0,
                p.favorite ? "Yes" : "No",
                `"${notesClean}"`,
                p.latitude || '',
                p.longitude || '',
                `"${p.url}"`
            ]);
        });

        const csvContent = rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `washington_properties_export_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(`Exported ${filteredProperties.length} listings to CSV!`);
    }

    // -------------------------------------------------------------------------
    // Live Scraper Progress
    // -------------------------------------------------------------------------
    function openScraperModal() {
        scraperModal.classList.remove('hidden');
    }

    async function startLiveScrapingJob() {
        btnStartLiveScrape.disabled = true;
        scraperStatusText.textContent = "Connecting to scraper backend...";

        try {
            const payload = {
                location: filterState.city !== 'all' ? filterState.city : "Washington",
                price_min: filterState.minPrice,
                price_max: filterState.maxPrice,
                sqft_min: filterState.minSqft,
                sqft_max: filterState.maxSqft,
                beds_min: filterState.minBeds || 2,
                baths_min: filterState.minBaths || 1.0,
                lot_size_min: filterState.minLot,
                garage_min: filterState.minGarage || 2,
                hoa_max: filterState.maxHoa
            };

            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Scraper backend unavailable.");
            }

            showToast("Live scraper started in background!");
            startScraperPolling();
        } catch (e) {
            console.warn("Scraper backend message:", e);
            scraperStatusText.textContent = "Live scraper runs via local Python backend (python app.py).";
            scraperTerminal.innerHTML += `<div class="term-line info">&gt; Note: Live scraping queries Realtor/Zillow directly via the local Python server. Currently displaying ${allProperties.length} active cached Washington listings.</div>`;
            btnStartLiveScrape.disabled = false;
        }
    }

    function startScraperPolling() {
        if (scraperPollTimer) clearInterval(scraperPollTimer);

        scraperPollTimer = setInterval(async () => {
            try {
                const res = await fetch('/api/status');
                if (!res.ok) return;
                const status = await res.json();

                scraperProgressFill.style.width = `${status.progress}%`;
                scraperPctText.textContent = `${status.progress}%`;
                scraperStatusText.textContent = status.message;

                if (status.logs && status.logs.length > 0) {
                    scraperTerminal.innerHTML = status.logs.map(line => {
                        let cls = 'term-line';
                        if (line.includes('[MATCH]')) cls += ' match';
                        else if (line.includes('Error') || line.includes('[ERROR]')) cls += ' error';
                        else if (line.includes('Starting') || line.includes('Completed') || line.includes('Merged')) cls += ' info';
                        return `<div class="${cls}">&gt; ${line}</div>`;
                    }).join('');
                    scraperTerminal.scrollTop = scraperTerminal.scrollHeight;
                }

                if (!status.is_active && status.progress >= 100) {
                    clearInterval(scraperPollTimer);
                    scraperPollTimer = null;
                    btnStartLiveScrape.disabled = false;
                    showToast("Scraper finished! Updating dataset...");
                    await loadProperties();
                }
            } catch (e) {
                console.warn("Polling error:", e);
            }
        }, 1000);
    }

    // -------------------------------------------------------------------------
    // Event Listeners Binding
    // -------------------------------------------------------------------------
    function setupEventListeners() {
        // Search Input
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value;
            filterState.search = val;
            clearSearchBtn.classList.toggle('hidden', !val);

            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(applyFilters, 150);
        });

        clearSearchBtn.addEventListener('click', () => {
            searchInput.value = '';
            filterState.search = '';
            clearSearchBtn.classList.add('hidden');
            applyFilters();
        });

        // City Selector
        citySelect.addEventListener('change', (e) => {
            filterState.city = e.target.value;
            applyFilters();
        });

        let sliderDebounceTimer = null;
        function triggerFilterDebounced(delay = 40) {
            clearTimeout(sliderDebounceTimer);
            sliderDebounceTimer = setTimeout(() => {
                applyFilters();
            }, delay);
        }

        // Price Dual Sliders
        priceMinSlider.addEventListener('input', () => {
            let min = parseInt(priceMinSlider.value, 10);
            let max = parseInt(priceMaxSlider.value, 10);
            if (min > max - 10000) {
                min = max - 10000;
                priceMinSlider.value = min;
            }
            filterState.minPrice = min;
            priceRangeDisplay.textContent = `$${Math.round(min/1000)}k – $${Math.round(max/1000)}k`;
            triggerFilterDebounced(40);
        });
        priceMinSlider.addEventListener('change', applyFilters);

        priceMaxSlider.addEventListener('input', () => {
            let min = parseInt(priceMinSlider.value, 10);
            let max = parseInt(priceMaxSlider.value, 10);
            if (max < min + 10000) {
                max = min + 10000;
                priceMaxSlider.value = max;
            }
            filterState.maxPrice = max;
            priceRangeDisplay.textContent = `$${Math.round(min/1000)}k – $${Math.round(max/1000)}k`;
            triggerFilterDebounced(40);
        });
        priceMaxSlider.addEventListener('change', applyFilters);

        // SqFt Dual Sliders
        sqftMinSlider.addEventListener('input', () => {
            let min = parseInt(sqftMinSlider.value, 10);
            let max = parseInt(sqftMaxSlider.value, 10);
            if (min > max - 100) {
                min = max - 100;
                sqftMinSlider.value = min;
            }
            filterState.minSqft = min;
            sqftRangeDisplay.textContent = `${min.toLocaleString()} – ${max.toLocaleString()} sqft`;
            triggerFilterDebounced(40);
        });
        sqftMinSlider.addEventListener('change', applyFilters);

        sqftMaxSlider.addEventListener('input', () => {
            let min = parseInt(sqftMinSlider.value, 10);
            let max = parseInt(sqftMaxSlider.value, 10);
            if (max < min + 100) {
                max = min + 100;
                sqftMaxSlider.value = max;
            }
            filterState.maxSqft = max;
            sqftRangeDisplay.textContent = `${min.toLocaleString()} – ${max.toLocaleString()} sqft`;
            triggerFilterDebounced(40);
        });
        sqftMaxSlider.addEventListener('change', applyFilters);

        // Bedrooms Pills
        bedsPillGroup.querySelectorAll('.pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterState.minBeds = parseInt(btn.getAttribute('data-beds'), 10);
                applyFilters();
            });
        });

        // Bathrooms Pills
        bathsPillGroup.querySelectorAll('.pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterState.minBaths = parseFloat(btn.getAttribute('data-baths'));
                applyFilters();
            });
        });

        // Garage Pills
        garagePillGroup.querySelectorAll('.pill-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                filterState.minGarage = parseInt(btn.getAttribute('data-garage'), 10);
                applyFilters();
            });
        });

        // HOA Slider
        hoaSlider.addEventListener('input', () => {
            const val = parseInt(hoaSlider.value, 10);
            filterState.maxHoa = val;
            hoaDisplay.textContent = val === 0 ? '$0/mo (No HOA)' : `≤ $${val}/mo`;
            triggerFilterDebounced(40);
        });
        hoaSlider.addEventListener('change', applyFilters);

        // Advanced Accordion Toggle
        btnToggleAdvanced.addEventListener('click', () => {
            const isHidden = advancedFiltersBody.classList.contains('hidden');
            advancedFiltersBody.classList.toggle('hidden', !isHidden);
            btnToggleAdvanced.setAttribute('aria-expanded', String(isHidden));
        });

        // Advanced: Lot Slider
        lotSlider.addEventListener('input', () => {
            const val = parseInt(lotSlider.value, 10);
            filterState.minLot = val;
            lotDisplay.textContent = `${val.toLocaleString()}+ sqft`;
            triggerFilterDebounced(40);
        });
        lotSlider.addEventListener('change', applyFilters);

        // Advanced: Year Select
        yearSelect.addEventListener('change', (e) => {
            filterState.minYear = parseInt(e.target.value, 10);
            applyFilters();
        });

        // Advanced: Max $/sqft Slider
        maxPpsqftSlider.addEventListener('input', () => {
            const val = parseInt(maxPpsqftSlider.value, 10);
            filterState.maxPpsqft = val;
            maxPpsqftDisplay.textContent = val >= 500 ? 'No Limit' : `≤ $${val}/sqft`;
            triggerFilterDebounced(40);
        });
        maxPpsqftSlider.addEventListener('change', applyFilters);

        // Advanced: Star Rating Filter
        ratingFilter.addEventListener('change', (e) => {
            filterState.minRating = parseInt(e.target.value, 10);
            applyFilters();
        });

        // Shortlist Filter Toggle
        filterFavoritesToggle.addEventListener('change', (e) => {
            filterState.favoritesOnly = e.target.checked;
            applyFilters();
        });
        favoritesBadgeBtn.addEventListener('click', () => {
            filterFavoritesToggle.checked = !filterFavoritesToggle.checked;
            filterState.favoritesOnly = filterFavoritesToggle.checked;
            applyFilters();
        });

        // Sort Dropdown
        sortDropdown.addEventListener('change', (e) => {
            filterState.sortBy = e.target.value;
            applyFilters();
        });

        // Reset Filter Buttons
        btnResetFilters.addEventListener('click', resetAllFilters);
        btnEmptyReset.addEventListener('click', resetAllFilters);

        // Preset Menu
        btnPresetsMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = presetDropdownMenu.classList.contains('hidden');
            presetDropdownMenu.classList.toggle('hidden', !isHidden);
            btnPresetsMenu.setAttribute('aria-expanded', String(isHidden));
        });
        document.addEventListener('click', () => presetDropdownMenu.classList.add('hidden'));

        presetDropdownMenu.querySelectorAll('.dropdown-item[data-preset]').forEach(item => {
            item.addEventListener('click', () => {
                const presetKey = item.getAttribute('data-preset');
                presetDropdownMenu.classList.add('hidden');
                activePresetLabel.textContent = item.textContent;

                switch (presetKey) {
                    case 'all':
                        resetAllFilters();
                        break;
                    case 'best-value':
                        resetAllFilters();
                        filterState.maxPpsqft = 275;
                        maxPpsqftSlider.value = 275;
                        maxPpsqftDisplay.textContent = '≤ $275/sqft';
                        filterState.sortBy = 'price_per_sqft_asc';
                        sortDropdown.value = 'price_per_sqft_asc';
                        applyFilters();
                        break;
                    case 'large-lots':
                        resetAllFilters();
                        filterState.minLot = 8000;
                        lotSlider.value = 8000;
                        lotDisplay.textContent = '8,000+ sqft';
                        filterState.sortBy = 'lot_desc';
                        sortDropdown.value = 'lot_desc';
                        applyFilters();
                        break;
                    case 'three-garage':
                        resetAllFilters();
                        filterState.minGarage = 3;
                        garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === '3'));
                        applyFilters();
                        break;
                    case 'low-hoa':
                        resetAllFilters();
                        filterState.maxHoa = 25;
                        hoaSlider.value = 25;
                        hoaDisplay.textContent = '≤ $25/mo';
                        applyFilters();
                        break;
                    case 'newer-homes':
                        resetAllFilters();
                        filterState.minYear = 2000;
                        yearSelect.value = '2000';
                        filterState.sortBy = 'year_desc';
                        sortDropdown.value = 'year_desc';
                        applyFilters();
                        break;
                }
            });
        });

        btnSaveCurrentPreset.addEventListener('click', (e) => {
            e.stopPropagation();
            presetDropdownMenu.classList.add('hidden');
            saveCurrentPreset();
        });

        // Density Switcher
        btnDensityToggle.addEventListener('click', toggleDensity);

        // Command Palette Trigger & Input
        btnOpenCmdPalette.addEventListener('click', openCommandPalette);
        cmdPaletteInput.addEventListener('input', (e) => renderCommandPaletteResults(e.target.value));

        // Smart Scoring Trigger & Weight Sliders
        btnOpenScoring.addEventListener('click', openScoringModal);
        btnCloseScoring.addEventListener('click', () => scoringModal.classList.add('hidden'));
        ['w-ppsqft', 'w-sqft', 'w-lot', 'w-garage', 'w-year', 'w-hoa', 'w-rating'].forEach(id => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(`${id}-val`);
            if (el && valEl) {
                el.addEventListener('input', () => { valEl.textContent = `${el.value}%`; });
            }
        });
        btnSaveWeights.addEventListener('click', saveScoringWeights);
        btnResetWeights.addEventListener('click', () => {
            scoreWeights = { ppsqft: 30, sqft: 15, lot: 15, garage: 10, year: 10, hoa: 10, rating: 10 };
            openScoringModal();
        });

        // View Tabs
        viewTabSplit.addEventListener('click', () => setViewMode('split'));
        viewTabGrid.addEventListener('click', () => setViewMode('grid'));
        viewTabMap.addEventListener('click', () => setViewMode('map'));
        viewTabAnalytics.addEventListener('click', () => setViewMode('analytics'));

        // Map Overlays
        mapBoundsFilterToggle.addEventListener('change', (e) => {
            filterState.mapBoundsOnly = e.target.checked;
            applyFilters();
        });
        btnMapFitResults.addEventListener('click', fitMapToResults);
        btnMapResetView.addEventListener('click', resetWashingtonView);

        // Drawer Controls
        btnCloseDrawer.addEventListener('click', closePropertyDrawer);
        drawerBackdrop.addEventListener('click', closePropertyDrawer);
        btnDrawerPrev.addEventListener('click', () => stepDrawerProperty(-1));
        btnDrawerNext.addEventListener('click', () => stepDrawerProperty(1));
        btnDrawerFavorite.addEventListener('click', () => {
            if (selectedPropId) toggleFavorite(selectedPropId);
        });

        // Drawer Photo Navigation
        btnDrawerImgPrev.addEventListener('click', () => {
            if (!selectedPropId) return;
            cycleCardPhoto(selectedPropId, -1);
            const prop = allProperties.find(p => p.id === selectedPropId);
            if (prop) openPropertyDrawer(prop.id);
        });
        btnDrawerImgNext.addEventListener('click', () => {
            if (!selectedPropId) return;
            cycleCardPhoto(selectedPropId, 1);
            const prop = allProperties.find(p => p.id === selectedPropId);
            if (prop) openPropertyDrawer(prop.id);
        });
        btnDrawerFullscreen.addEventListener('click', () => {
            if (selectedPropId) {
                const idx = activePhotoIndices[selectedPropId] || 0;
                openPhotoLightbox(selectedPropId, idx);
            }
        });

        // Drawer Star Picker
        drawerStarPicker.querySelectorAll('.star-pick').forEach(star => {
            star.addEventListener('click', () => {
                if (!selectedPropId) return;
                const val = parseInt(star.getAttribute('data-val'), 10);
                updatePropertyRating(selectedPropId, val);
            });
        });

        // Drawer Notes
        drawerNotesTextarea.addEventListener('input', saveDrawerNotesDebounced);

        // Drawer Mortgage Customize Link
        btnDrawerCustomizeMortgage.addEventListener('click', () => {
            if (selectedPropId) openMortgageEstimator(selectedPropId);
        });

        // Comparison Dock & Matrix
        btnOpenComparisonMatrix.addEventListener('click', openComparisonMatrix);
        btnCloseComparison.addEventListener('click', () => comparisonModal.classList.add('hidden'));
        btnCompareClear.addEventListener('click', () => {
            comparisonSet.clear();
            updateCompareDock();
            renderGalleryCards();
        });

        // Mortgage Modal
        btnCloseMortgage.addEventListener('click', () => mortgageModal.classList.add('hidden'));
        [calcHomePrice, calcDownPct, calcLoanTerm, calcInterestRate, calcTaxRate, calcInsurance, calcHoaFee].forEach(input => {
            input.addEventListener('input', recalculateMortgageModal);
        });

        // Lightbox Modal
        btnCloseLightbox.addEventListener('click', () => photoLightboxModal.classList.add('hidden'));
        btnLightboxPrev.addEventListener('click', () => stepLightbox(-1));
        btnLightboxNext.addEventListener('click', () => stepLightbox(1));

        // Scraper Modal
        btnOpenScraper.addEventListener('click', openScraperModal);
        btnCloseScraper.addEventListener('click', () => scraperModal.classList.add('hidden'));
        btnCancelScraper.addEventListener('click', () => scraperModal.classList.add('hidden'));
        btnStartLiveScrape.addEventListener('click', startLiveScrapingJob);

        // CSV Export
        btnExportCsv.addEventListener('click', exportCsv);

        // Global Modal Backdrop Click to Close
        [comparisonModal, mortgageModal, photoLightboxModal, scraperModal, scoringModal, cmdPaletteModal].forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

            // Ctrl/Cmd + K opens command palette
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                openCommandPalette();
                return;
            }

            // Escape key closes modals / drawers
            if (e.key === 'Escape') {
                closePropertyDrawer();
                closeCommandPalette();
                [comparisonModal, mortgageModal, photoLightboxModal, scraperModal, scoringModal].forEach(m => m.classList.add('hidden'));
                return;
            }

            // Ignore typing shortcuts inside inputs
            if (isTyping) return;

            // Slash '/' key focuses search
            if (e.key === '/') {
                e.preventDefault();
                searchInput.focus();
                return;
            }

            // Lightbox Arrow Keys
            if (!photoLightboxModal.classList.contains('hidden')) {
                if (e.key === 'ArrowLeft') stepLightbox(-1);
                if (e.key === 'ArrowRight') stepLightbox(1);
                return;
            }

            // Drawer Navigation (J/K or Up/Down)
            if (!propertyDetailDrawer.classList.contains('hidden')) {
                if (e.key === 'j' || e.key === 'ArrowDown') stepDrawerProperty(1);
                if (e.key === 'k' || e.key === 'ArrowUp') stepDrawerProperty(-1);
                if (e.key === 'f' && selectedPropId) toggleFavorite(selectedPropId);
                return;
            }

            // Quick View mode numbers
            if (e.key === '1') setViewMode('split');
            if (e.key === '2') setViewMode('grid');
            if (e.key === '3') setViewMode('map');
            if (e.key === '4') setViewMode('analytics');
        });
    }

    // -------------------------------------------------------------------------
    // Global API Expose for popups & matrix
    // -------------------------------------------------------------------------
    window.HouseFinderApp = {
        openDrawerById: (id) => openPropertyDrawer(id),
        openLightboxById: (id) => openPhotoLightbox(id)
    };

    // -------------------------------------------------------------------------
    // Initial Boot
    // -------------------------------------------------------------------------
    try {
        const savedDensity = localStorage.getItem(STORAGE_DENSITY_KEY);
        if (savedDensity === 'compact') {
            document.body.classList.remove('density-comfortable');
            document.body.classList.add('density-compact');
        }
        const savedWeights = localStorage.getItem(STORAGE_WEIGHTS_KEY);
        if (savedWeights) scoreWeights = JSON.parse(savedWeights);

        const savedMortgage = localStorage.getItem(STORAGE_MORTGAGE_KEY);
        if (savedMortgage) mortgageAssumptions = JSON.parse(savedMortgage);
    } catch (e) {}

    initMap();
    setupEventListeners();
    loadProperties();
});
