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
    const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const API_CANDIDATE = window.location.protocol.startsWith('http')
        && !window.location.hostname.endsWith('.github.io')
        && (!isLocalHost || ['', '5000', '8000'].includes(window.location.port));
    let API_WRITES_ENABLED = false;
    let scraperAvailable = false;
    const STORAGE_THEME_KEY = 'wa_home_search_theme_v1';

    function applyTheme(theme) {
        const dark = theme === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        const button = document.getElementById('btn-theme-toggle');
        button?.setAttribute('aria-pressed', String(dark));
        button?.setAttribute('title', `Switch to ${dark ? 'light' : 'dark'} mode`);
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17212b' : '#ffffff');
    }

    function toggleTheme() {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(STORAGE_THEME_KEY, theme); } catch (_) {}
        applyTheme(theme);
    }

    async function detectBackendCapabilities() {
        if (!API_CANDIDATE) return;
        try {
            const response = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
            if (!response.ok) return;
            const health = await response.json();
            if (health.status !== 'ok' || typeof health.read_only !== 'boolean') return;
            API_WRITES_ENABLED = !health.read_only;
            scraperAvailable = API_WRITES_ENABLED && health.scraping_authorized === true;
            document.getElementById('btn-open-scraper')?.classList.toggle('hidden', !scraperAvailable);
        } catch (_) { /* Static hosting keeps personal research in local storage. */ }
    }

    let allProperties = [];
    let propertyById = new Map();
    let filteredProperties = [];
    let activePhotoIndices = {}; // propId -> current image index
    let comparisonSet = new Set(); // Set of propIds (max 4)
    let activeView = 'grid'; // 'split' | 'grid' | 'map' | 'deals' | 'analytics' | 'odd'
    let selectedPropId = null; // currently selected property in drawer
    let currentDrawerIndex = 0;
    let recentPropertyIds = [];

    function getPropertyById(propId) {
        return propertyById.get(propId) || allProperties.find(p => p.id === propId) || null;
    }

    // Filter Criteria Defaults & Active State
    const FILTER_DEFAULTS = Object.freeze({
        search: '',
        city: 'all',
        minPrice: 200000,
        maxPrice: 750000,
        minBeds: 0,
        minBaths: 0,
        minSqft: 0,
        maxSqft: 6000,
        minGarage: 0,
        minLot: 0,
        minYear: 0,
        maxHoa: 300,
        maxPpsqft: 500,
        minRating: 0,
        favoritesOnly: false,
        fiberOnly: false,
        broadbandType: 'all',
        sortBy: 'smart_score',
        mapBoundsOnly: false
    });

    const filterState = { ...FILTER_DEFAULTS };

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

    // Security & Sanitization Utilities
    function hasListingMetric(property, field) {
        return Number.isFinite(property[field]) && (Array.isArray(property.unknown_fields)
            ? !property.unknown_fields.includes(field)
            : property[field] > 0);
    }

    function listingMetric(property, field, suffix = '') {
        if (!hasListingMetric(property, field)) return 'Unknown';
        const value = field === 'year_built' ? String(property[field]) : property[field].toLocaleString();
        return `${value}${suffix}`;
    }

    function listingHoa(property) {
        if (!hasListingMetric(property, 'hoa')) return 'HOA unknown';
        return property.hoa === 0 ? 'No HOA ($0)' : `$${property.hoa}/mo HOA`;
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function safeUrl(url) {
        if (!url || typeof url !== 'string') return '#';
        const trimmed = url.trim();
        // Reject attribute-breaking characters so interpolated src/href values
        // cannot escape their quotes (dataset URLs are always encoded).
        if (/["'<>\s`]/.test(trimmed)) return '#';
        if (/^(https?:\/\/|mailto:|\/|\.\/)/i.test(trimmed)) {
            return trimmed;
        }
        return '#';
    }

    // Downsizes Realtor CDN photos for small surfaces (cards, popups, deal tiles).
    // Full-resolution URLs are still used in the detail drawer and lightbox.
    function thumbUrl(url, width = 600) {
        if (!url || typeof url !== 'string') return url;
        if (url.indexOf('ap.rdcpix.com') !== -1) {
            return url.replace(/([?&])w=\d+/, '$1w=' + width);
        }
        return url;
    }

    // Neutral inline placeholder for missing or broken listing photos.
    // Preserves zero-fabrication data integrity without displaying arbitrary stock homes.
    const PHOTO_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" fill="none">' +
        '<rect width="400" height="250" fill="#f1f5f9"/>' +
        '<path d="M160 145l40-32 40 32v40h-80z" stroke="#94a3b8" stroke-width="3" stroke-linejoin="round" fill="none"/>' +
        '<path d="M150 145l50-40 50 40" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="230" cy="115" r="8" fill="#94a3b8"/>' +
        '<text x="200" y="210" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="600" fill="#64748b" text-anchor="middle">No Photo Available</text>' +
        '</svg>'
    );

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
    const broadbandFilter = document.getElementById('broadband-filter');
    const filterFavoritesToggle = document.getElementById('filter-favorites-toggle');
    const filterFiberToggle = document.getElementById('filter-fiber-toggle');
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
    const viewTabDeals = document.getElementById('view-tab-deals');
    const viewTabAnalytics = document.getElementById('view-tab-analytics');
    const viewTabOdd = document.getElementById('view-tab-odd');
    const oddFindsGrid = document.getElementById('odd-finds-grid');
    const oddFindsCount = document.getElementById('odd-finds-count');
    const oddFindsEmpty = document.getElementById('odd-finds-empty');
    const btnOddSurprise = document.getElementById('btn-odd-surprise');
    let currentOddFinds = [];
    const oddFindsCache = new Map();

    // Top Deals View Elements
    const dealsViewWrapper = document.getElementById('deals-view-wrapper');
    const dealsEvaluationGrid = document.getElementById('deals-evaluation-grid');
    const dealsTotalCount = document.getElementById('deals-total-count');
    const dealsAvgDiscount = document.getElementById('deals-avg-discount');
    const dealsAvgDollarSavings = document.getElementById('deals-avg-dollar-savings');
    const dealsTopCity = document.getElementById('deals-top-city');
    const dealsFilterPills = document.getElementById('deals-filter-pills');

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
    
    // Drawer Deal Evaluation Card References
    const drawerDealEvalCard = document.getElementById('drawer-deal-eval-card');
    const drawerDealGradeText = document.getElementById('drawer-deal-grade-text');
    const drawerDealScoreBadge = document.getElementById('drawer-deal-score-badge');
    const drawerDealSummaryBox = document.getElementById('drawer-deal-summary-box');
    const drawerDealMetricsGrid = document.getElementById('drawer-deal-metrics-grid');

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

    // Drawer Broadband & Internet (FCC National Broadband Map)
    const btnDrawerFccHeader = document.getElementById('btn-drawer-fcc-header');
    const drawerInternetCard = document.getElementById('drawer-internet-card');
    const drawerFccBroadbandLink = document.getElementById('drawer-fcc-broadband-link');
    const drawerBbMainStatus = document.getElementById('drawer-bb-main-status');
    const drawerFiberCell = document.getElementById('drawer-fiber-cell');
    const drawerFiberAvail = document.getElementById('drawer-fiber-avail');
    const drawerFiberDown = document.getElementById('drawer-fiber-down');
    const drawerFiberUp = document.getElementById('drawer-fiber-up');
    const drawerFiberProviders = document.getElementById('drawer-fiber-providers');
    const drawerCableCell = document.getElementById('drawer-cable-cell');
    const drawerCableAvail = document.getElementById('drawer-cable-avail');
    const drawerCableDown = document.getElementById('drawer-cable-down');
    const drawerCableUp = document.getElementById('drawer-cable-up');
    const drawerCableProviders = document.getElementById('drawer-cable-providers');

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

    // Mobile & iPhone Controls
    const appSidebar = document.getElementById('app-sidebar');
    const btnMobileFilters = document.getElementById('btn-mobile-filters');
    const btnMobileSidebarClose = document.getElementById('btn-mobile-sidebar-close');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const mobNavSplit = document.getElementById('mob-nav-split');
    const mobNavGrid = document.getElementById('mob-nav-grid');
    const mobNavMap = document.getElementById('mob-nav-map');
    const mobNavDeals = document.getElementById('mob-nav-deals');
    const mobNavAnalytics = document.getElementById('mob-nav-analytics');
    const mobNavOdd = document.getElementById('mob-nav-odd');
    const mobNavFilters = document.getElementById('mob-nav-filters');
    const mobileMapPreviewCard = document.getElementById('mobile-map-preview-card');
    const mobilePreviewContent = document.getElementById('mobile-preview-content');
    const btnCloseMobilePreview = document.getElementById('btn-close-mobile-preview');

    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // Leaflet GIS Mapping (Strictly Locked to Washington State)
    // -------------------------------------------------------------------------
    let map = null;
    let markersLayer = null;
    let markerInstances = {}; // propId -> L.Marker
    let mapMarkersDirty = false; // true when filters changed while map was hidden
    function isMapVisible() {
        return activeView === 'split' || activeView === 'map';
    }

    const HAS_LEAFLET = typeof L !== 'undefined';

    // Strict Washington State Boundary coordinates (South-West to North-East)
    const WA_SOUTH_WEST = HAS_LEAFLET ? L.latLng(45.45, -125.0) : null;
    const WA_NORTH_EAST = HAS_LEAFLET ? L.latLng(49.10, -116.85) : null;
    const WA_BOUNDS = HAS_LEAFLET ? L.latLngBounds(WA_SOUTH_WEST, WA_NORTH_EAST) : null;

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
        if (map || !HAS_LEAFLET) return;
        const mapElement = document.getElementById('leaflet-map');
        if (!mapElement) return;

        // Centered strictly over Washington State with tight, responsive focus
        map = L.map('leaflet-map', {
            center: [47.45, -120.5],
            zoom: 7.2,
            minZoom: 6.5,
            maxZoom: 18,
            maxBounds: L.latLngBounds([44.8, -126.0], [49.8, -116.0]),
            maxBoundsViscosity: 0.85,
            zoomControl: false,
            attributionControl: false
        });

        // Add clean zoom controls at bottom-right (Realtor standard, avoids header overlap)
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

        // Keyless, zero-watermark, high-performance GIS basemap layers
        const basemapLayers = {
            'streets': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
                className: 'theme-street-tiles',
                maxZoom: 19,
                attribution: '&copy; Esri, HERE, Garmin, USGS'
            }),
            'satellite': L.layerGroup([
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 19,
                    attribution: '&copy; Esri, Maxar, Earthstar Geographics'
                }),
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 19
                })
            ]),
            'topo': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
                className: 'theme-street-tiles',
                maxZoom: 19,
                attribution: '&copy; Esri, Intermap, USGS'
            })
        };

        let currentBasemapKey = 'streets';
        let currentBasemapLayer = basemapLayers[currentBasemapKey];
        currentBasemapLayer.addTo(map);

        function switchBasemap(key) {
            if (!basemapLayers[key] || key === currentBasemapKey) return;
            map.removeLayer(currentBasemapLayer);
            currentBasemapLayer = basemapLayers[key];
            currentBasemapLayer.addTo(map);
            currentBasemapKey = key;

            const btns = document.querySelectorAll('.map-basemap-btn');
            btns.forEach(b => {
                b.classList.toggle('active', b.getAttribute('data-basemap') === key);
            });
        }

        const basemapBtns = document.querySelectorAll('.map-basemap-btn');
        basemapBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = btn.getAttribute('data-basemap');
                if (mode) switchBasemap(mode);
            });
        });

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
                if (reg === 'all') {
                    resetWashingtonView();
                } else if (reg && REGION_BOUNDS[reg]) {
                    const { center, zoom } = REGION_BOUNDS[reg];
                    map.flyTo(center, zoom, { duration: 0.8 });
                }
            });
        });
    }

    function buildMarkerPopupHtml(p) {
        const bbSummary = getCardBroadbandSummary(p);
        const safeAddr = escapeHtml(p.address);
        const safeFcc = safeUrl(getRegionalBroadbandDetails(p).fccMapUrl);
        const safePhoto = safeUrl(thumbUrl(p.photos && p.photos[0] ? p.photos[0] : '', 600));
        return `
            <div class="map-popup-card" onclick="window.HouseFinderApp.openDrawerById('${escapeHtml(p.id)}')" style="cursor: pointer;">
                <img src="${safePhoto}" alt="${safeAddr}" class="popup-img" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
                <div class="popup-info">
                    <span class="popup-price">$${p.price.toLocaleString()}</span>
                    <strong class="popup-address">${safeAddr}</strong>
                    <span class="popup-specs">${listingMetric(p, 'beds')} Beds • ${listingMetric(p, 'baths')} Baths • ${p.sqft.toLocaleString()} sqft</span>
                    <div style="margin-top: 5px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 4px;">
                        <span style="font-size: 9.5px; color: var(--info-ink); font-weight: 700;">${escapeHtml(bbSummary.badgeText)}</span>
                        <a href="${safeFcc}" target="_blank" rel="noopener noreferrer" style="font-size: 10px; color: var(--brand-primary); font-weight: 700; text-decoration: underline;" onclick="event.stopPropagation();">FCC Map ↗</a>
                    </div>
                </div>
            </div>
        `;
    }

    function updateMapMarkers(propertiesToDisplay) {
        if (!map || !markersLayer) return;
        markersLayer.clearLayers();
        markerInstances = {};

        const validCoords = [];
        const newMarkers = [];

        propertiesToDisplay.forEach(p => {
            if (p.latitude && p.longitude) {
                const formattedPrice = '$' + Math.round(p.price / 1000) + 'k';
                const isFavorited = p.favorite ? '♥ ' : '';

                const customIcon = L.divIcon({
                    className: 'custom-map-icon-wrapper',
                    html: `<div class="realtor-price-pin ${p.favorite ? 'favorited-pin' : ''}" id="marker-pin-${escapeHtml(p.id)}">${isFavorited}${formattedPrice}</div>`,
                    iconSize: [68, 26],
                    iconAnchor: [34, 13],
                    popupAnchor: [0, -14]
                });

                const marker = L.marker([p.latitude, p.longitude], { icon: customIcon });
                marker.bindPopup(() => buildMarkerPopupHtml(p), { maxWidth: 240, className: 'realtor-map-popup' });

                marker.on('click', () => {
                    highlightCard(p.id);
                    if (window.innerWidth <= 768) {
                        showMobileMapPreview(p);
                    }
                });

                newMarkers.push(marker);
                markerInstances[p.id] = marker;
                validCoords.push([p.latitude, p.longitude]);
            }
        });

        if (markersLayer.addLayers && typeof markersLayer.addLayers === 'function') {
            markersLayer.addLayers(newMarkers);
        } else {
            newMarkers.forEach(m => markersLayer.addLayer(m));
        }

        if (mapMarkerCount) {
            mapMarkerCount.textContent = `${validCoords.length} WA homes`;
        }
    }

    function showMobileMapPreview(p) {
        if (!mobileMapPreviewCard || !mobilePreviewContent) return;
        const estMonthly = calculateEstimatedMonthly(p.price, p.hoa);
        const photo = (p.photos && p.photos.length) ? thumbUrl(p.photos[0], 600) : PHOTO_PLACEHOLDER;
        const bbSummary = getCardBroadbandSummary(p);
        
        const safeAddr = escapeHtml(p.address);
        const safeCity = escapeHtml(p.city);
        const safePhoto = safeUrl(photo);
        const safeFcc = safeUrl(getRegionalBroadbandDetails(p).fccMapUrl);
        
        mobilePreviewContent.innerHTML = `
            <img src="${safePhoto}" alt="${safeAddr}" class="mob-prev-img" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
            <div class="mob-prev-details">
                <div class="mob-prev-price mono">$${p.price.toLocaleString()} <span class="mob-prev-mo">~$${estMonthly.total.toLocaleString()}/mo</span></div>
                <strong class="mob-prev-addr" title="${safeAddr}">${safeAddr}</strong>
                <span class="mob-prev-city">${safeCity}, WA • <strong style="color: ${bbSummary.isCableOnly ? 'var(--warning-ink)' : 'var(--info-ink)'}; font-size: 10px;">${bbSummary.badgeText}</strong></span>
                <div class="mob-prev-specs mono">${listingMetric(p, 'beds')}b • ${listingMetric(p, 'baths')}ba • ${p.sqft.toLocaleString()} sf</div>
                <div style="display: flex; gap: 6px; margin-top: 6px;">
                    <button class="btn btn-primary btn-sm mob-prev-open-btn" data-id="${p.id}" style="flex: 1;">Details &rarr;</button>
                    <a href="${safeFcc}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="font-size: 10.5px; padding: 4px 8px; font-weight: 700; color: var(--info-ink);" onclick="event.stopPropagation();">FCC Map ↗</a>
                </div>
            </div>
        `;

        const openBtn = mobilePreviewContent.querySelector('.mob-prev-open-btn');
        if (openBtn) {
            openBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openPropertyDrawer(p.id);
            });
        }
        mobilePreviewContent.onclick = () => openPropertyDrawer(p.id);

        mobileMapPreviewCard.classList.remove('hidden');
    }

    function hideMobileMapPreview() {
        if (mobileMapPreviewCard) mobileMapPreviewCard.classList.add('hidden');
    }

    function fitMapToResults() {
        if (!map || !markersLayer) return;
        const bounds = (markersLayer.getBounds && typeof markersLayer.getBounds === 'function') ? markersLayer.getBounds() : null;
        if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 });
        } else {
            resetWashingtonView();
        }
    }

    function resetWashingtonView() {
        if (!map) return;
        document.querySelectorAll('.map-region-pill').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-region') === 'all');
        });
        map.fitBounds(WA_BOUNDS, { padding: [25, 25] });
        setTimeout(() => { if (map) map.invalidateSize(); }, 100);
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
        
        toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
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
        if (p.hoa > 0 && p.hoa <= 35) {
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
        const scoreLot = hasListingMetric(p, 'lot_sqft') ? Math.max(0, Math.min(100, Math.round(((p.lot_sqft - 4000) / 16000) * 100))) : 50;

        // 4. Garage score (0 - 100)
        const scoreGarage = !hasListingMetric(p, 'garage') ? 50 : p.garage >= 3 ? 100 : (p.garage === 2 ? 75 : 40);

        // 5. Year built score (0 - 100)
        const currentYear = new Date().getFullYear();
        const age = Math.max(0, currentYear - (p.year_built || 1980));
        const scoreYear = hasListingMetric(p, 'year_built') ? Math.max(0, Math.min(100, Math.round(100 - (age / 50) * 100))) : 50;

        // 6. Low HOA score (0 - 100)
        const scoreHoa = !hasListingMetric(p, 'hoa') ? 50 : Math.max(0, Math.min(100, Math.round(100 - (p.hoa / 100) * 100)));

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

    // -------------------------------------------------------------------------
    // Executive Deal & Value Evaluation Algorithm (100% Transparent MLS Analysis)
    // -------------------------------------------------------------------------
    function computeExecutiveDealEvaluation(p) {
        if (!p) return null;
        const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
        const cityMed = cityMedians[p.city] || marketMedians;
        const cityMedPpsqft = (cityMed && cityMed.ppsqft) ? cityMed.ppsqft : 300;
        const ppsqftDiff = cityMedPpsqft - ppsqft;
        const ppsqftPct = Math.round((ppsqftDiff / cityMedPpsqft) * 100);
        const estDollarSavings = Math.round(ppsqftDiff * p.sqft);

        // 1. Price / SqFt Score (0-100)
        let priceScore = 60 + Math.round(ppsqftPct * 1.3);
        priceScore = Math.max(10, Math.min(100, priceScore));

        // 2. Lot Value Score (0-100)
        const acres = p.lot_sqft / 43560;
        let lotScore = 50;
        if (acres >= 0.5) lotScore = 100;
        else if (acres >= 0.25) lotScore = 85 + Math.round((acres - 0.25) * 60);
        else if (acres >= 0.15) lotScore = 70 + Math.round((acres - 0.15) * 150);
        else if (hasListingMetric(p, 'lot_sqft')) lotScore = Math.max(20, Math.round(acres * 400));
        lotScore = Math.min(100, lotScore);

        // 3. Carrying Cost (HOA) Score (0-100)
        let hoaScore = 50;
        if (hasListingMetric(p, 'hoa')) {
            if (p.hoa <= 35) hoaScore = 85;
            else if (p.hoa <= 75) hoaScore = 70;
            else if (p.hoa <= 150) hoaScore = 50;
            else hoaScore = Math.max(10, 50 - Math.round((p.hoa - 150) / 5));
        }

        // 4. Garage & Workshop Capacity (0-100)
        let garageScore = 50;
        if (p.garage >= 3) garageScore = 100;
        else if (p.garage === 2) garageScore = 85;
        else if (p.garage === 1) garageScore = 60;

        // 5. Living Space Efficiency (0-100)
        let spaceScore = 60;
        if (p.sqft >= 2400) spaceScore = 98;
        else if (p.sqft >= 1800) spaceScore = 85 + Math.round((p.sqft - 1800) / 40);
        else if (p.sqft >= 1400) spaceScore = 70 + Math.round((p.sqft - 1400) / 26);
        else spaceScore = Math.max(30, 40 + Math.round((p.sqft - 800) / 20));
        spaceScore = Math.min(100, spaceScore);

        // 6. Age & Modern Efficiency (0-100)
        let ageScore = 50;
        if (p.year_built >= 2015) ageScore = 100;
        else if (p.year_built >= 2000) ageScore = 85 + Math.round((p.year_built - 2000));
        else if (p.year_built >= 1980) ageScore = 65 + Math.round((p.year_built - 1980));
        else if (hasListingMetric(p, 'year_built')) ageScore = Math.max(30, 40 + Math.round((p.year_built - 1940) / 2));
        ageScore = Math.min(100, ageScore);

        // Weighted composite deal score
        const dealScore = Math.round(
            (priceScore * 0.35) +
            (lotScore * 0.20) +
            (hoaScore * 0.15) +
            (spaceScore * 0.15) +
            (garageScore * 0.10) +
            (ageScore * 0.05)
        );

        // Factual Deal Narrative
        const ppsqftText = ppsqftPct > 0 
            ? `priced ${ppsqftPct}% below the ${p.city} median ($${cityMedPpsqft}/sqft)` 
            : `priced at $${ppsqft}/sqft in ${p.city}`;
        const lotText = !hasListingMetric(p, 'lot_sqft') ? 'an unreported lot size' : acres >= 0.2 ? `a substantial ${acres.toFixed(2)}-acre (${p.lot_sqft.toLocaleString()} sqft) parcel` : `a ${p.lot_sqft.toLocaleString()} sqft lot`;
        const hoaText = hasListingMetric(p, 'hoa') ? `$${p.hoa}/mo in reported HOA dues` : `unverified HOA dues`;
        const garageText = !hasListingMetric(p, 'garage') ? 'unreported garage capacity' : p.garage >= 2 ? `a ${p.garage}-car garage` : `${p.garage} garage space`;

        const narrative = `This ${p.city} property offers ${p.sqft.toLocaleString()} sqft ${ppsqftText}, paired with ${lotText}, ${hoaText}, and ${garageText}. The price-per-square-foot comparison is based on the listings in this snapshot.`;

        let grade = "C";
        let gradeLabel = "Fair Value";
        if (dealScore >= 90) { grade = "A+"; gradeLabel = "Exceptional Value Score"; }
        else if (dealScore >= 82) { grade = "A"; gradeLabel = "Strong Value Find"; }
        else if (dealScore >= 74) { grade = "B+"; gradeLabel = "Above Average Value"; }
        else if (dealScore >= 65) { grade = "B"; gradeLabel = "Market Parity"; }

        return {
            dealScore,
            grade,
            gradeLabel,
            ppsqft,
            cityMedPpsqft,
            ppsqftDiff,
            ppsqftPct,
            estDollarSavings,
            acres,
            factors: {
                price: { label: "$/SqFt Advantage", score: priceScore, desc: `${ppsqftPct > 0 ? '-' + ppsqftPct + '%' : '+' + Math.abs(ppsqftPct) + '%'} vs median` },
                lot: { label: "Lot & Acreage Space", score: lotScore, desc: hasListingMetric(p, 'lot_sqft') ? `${acres.toFixed(2)} Acres (${p.lot_sqft.toLocaleString()} sf)` : 'Lot size unknown' },
                hoa: { label: "Carrying Cost Efficiency", score: hoaScore, desc: listingHoa(p) },
                space: { label: "Living Area Usability", score: spaceScore, desc: `${p.sqft.toLocaleString()} SqFt` },
                garage: { label: "Garage & Workshop", score: garageScore, desc: listingMetric(p, 'garage', '-Car Garage') },
                age: { label: "Construction & Era", score: ageScore, desc: `Built ${listingMetric(p, 'year_built')}` }
            },
            narrative
        };
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
    // Order: async fetch first (non-blocking paint), on-demand bundle second
    // (legacy fallback), backend API last (local dev only, never on Pages).
    // -------------------------------------------------------------------------
    let cityBroadband = {};
    let nearbyBroadband = {};
    let nearbyBroadbandMeta = {};

    async function loadProperties() {
        const broadbandRequest = fetch("data/fcc_wa_broadband_by_city.json")
            .then(res => res.ok ? res.json() : {})
            .catch(() => ({}));
        const nearbyRequest = fetch("data/ispmap_top_deals.json")
            .then(res => res.ok ? res.json() : {})
            .catch(() => ({}));
        try {
            if (resultsCountLabel) resultsCountLabel.textContent = "Loading Washington listings...";
            
            let data = null;

            // 1. Try relative static JSON (async; does not block first paint)
            try {
                const res = await fetch('properties.json?v=20261028');
                if (res.ok) data = await res.json();
            } catch (e) {}

            // 2. Load the fallback only if JSON failed; never download both copies
            // during a normal page load. This also supports file:// previews.
            if (!data) {
                if (!Array.isArray(window.WASHINGTON_PROPERTIES)) {
                    try {
                        await new Promise((resolve, reject) => {
                            const script = document.createElement('script');
                            script.src = document.querySelector('script[data-listings-fallback]')?.dataset.listingsFallback || 'data.js';
                            script.onload = resolve;
                            script.onerror = reject;
                            document.head.appendChild(script);
                        });
                    } catch (error) { /* Continue to the optional backend. */ }
                }
                if (Array.isArray(window.WASHINGTON_PROPERTIES)) data = window.WASHINGTON_PROPERTIES;
            }

            // 3. Try API if backend is running (local dev only)
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

            // Shallow-copy each record so downstream mutations (favorite, rating,
            // notes, derived _fields) never touch the shared source array.
            // Nested arrays (photos) are never mutated in place, so a deep
            // clone (2x parse cost on ~5MB) is unnecessary.
            data = data.map(p => ({ ...p, photos: Array.isArray(p.photos) ? p.photos : [] }));

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
            propertyById = new Map();
            oddFindsCache.clear();

            // Initialize photo index registry and precompute derived metrics
            allProperties.forEach(p => {
                propertyById.set(p.id, p);
                if (!(p.id in activePhotoIndices)) activePhotoIndices[p.id] = 0;
                p._ppsqft = Math.round(p.price / Math.max(1, p.sqft));
                p._cityLower = (p.city || '').toLowerCase();
                p._searchCorpus = `${p.address} ${p.city} ${p.zip || ''} ${p.description || ''} ${p.user_notes || ''}`.toLowerCase();
            });

            cityBroadband = await broadbandRequest;
            nearbyBroadbandMeta = await nearbyRequest;
            nearbyBroadband = nearbyBroadbandMeta.listings || {};
            computeMarketMedians();
            populateCityDropdown();
            loadStateFromUrl();
            applyFilters();
            loadSavedPresets();
        } catch (err) {
            console.error("Critical error loading listings:", err);
            if (resultsCountLabel) resultsCountLabel.textContent = "Unable to load listings";
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
    function updateDualRangeTracks() {
        [[priceMinSlider, priceMaxSlider], [sqftMinSlider, sqftMaxSlider]].forEach(([lower, upper]) => {
            if (!lower || !upper) return;
            const minimum = Number(lower.min);
            const span = Number(lower.max) - minimum;
            if (span <= 0) return;
            const percent = value => Math.max(0, Math.min(100, (Number(value) - minimum) / span * 100));
            lower.parentElement.style.setProperty('--range-start', `${percent(lower.value)}%`);
            lower.parentElement.style.setProperty('--range-end', `${percent(upper.value)}%`);
        });
    }

    function applyFilters(resetLimit = true) {
        updateDualRangeTracks();
        const searchTerms = filterState.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const mapBounds = (map && filterState.mapBoundsOnly) ? map.getBounds() : null;

        filteredProperties = allProperties.filter(p => {
            // City check
            if (filterState.city !== 'all' && (p._cityLower || p.city.toLowerCase()) !== filterState.city) return false;

            // Price Range
            if (p.price < filterState.minPrice || (filterState.maxPrice < FILTER_DEFAULTS.maxPrice && p.price > filterState.maxPrice)) return false;

            // Beds & Baths
            if (filterState.minBeds > 0 && (!hasListingMetric(p, 'beds') || p.beds < filterState.minBeds)) return false;
            if (filterState.minBaths > 0 && (!hasListingMetric(p, 'baths') || p.baths < filterState.minBaths)) return false;

            // Garage
            if (filterState.minGarage > 0 && (!hasListingMetric(p, 'garage') || p.garage < filterState.minGarage)) return false;

            // Living Area SqFt
            if (p.sqft < filterState.minSqft || (filterState.maxSqft < FILTER_DEFAULTS.maxSqft && p.sqft > filterState.maxSqft)) return false;

            // HOA Fee (300 = No Limit; when capped, unknown HOA does not pass)
            if (filterState.maxHoa < FILTER_DEFAULTS.maxHoa && (!hasListingMetric(p, 'hoa') || p.hoa > filterState.maxHoa)) return false;

            // Lot Size (0 = Any Lot; when set, unknown lot does not pass)
            if (filterState.minLot > 0 && (!hasListingMetric(p, 'lot_sqft') || p.lot_sqft < filterState.minLot)) return false;

            // Year Built
            if (filterState.minYear > 0 && (!hasListingMetric(p, 'year_built') || p.year_built < filterState.minYear)) return false;

            // Max $/SqFt
            if (filterState.maxPpsqft < FILTER_DEFAULTS.maxPpsqft) {
                const ppsqft = p._ppsqft || (p.price / Math.max(1, p.sqft));
                if (ppsqft > filterState.maxPpsqft) return false;
            }

            // Star Rating
            if (filterState.minRating > 0 && (p.rating || 0) < filterState.minRating) return false;

            // Shortlist / Favorites
            if (filterState.favoritesOnly && !p.favorite) return false;

            // Fiber & High-Speed Internet Filter
            if (filterState.fiberOnly || filterState.broadbandType === 'fiber') {
                const regional = getRegionalBroadbandDetails(p);
                if (!regional.hasFiber) return false;
            } else if (filterState.broadbandType === 'gigabit') {
                const regional = getRegionalBroadbandDetails(p);
                if (!regional.hasGigabit) return false;
            }

            // Map Bounds Filter
            if (mapBounds && (!p.latitude || !p.longitude || !mapBounds.contains([p.latitude, p.longitude]))) return false;

            // Keyword Search (multi-term matching on pre-indexed corpus)
            if (searchTerms.length > 0) {
                const corpus = p._searchCorpus || `${p.address} ${p.city} ${p.zip} ${p.description} ${p.user_notes}`.toLowerCase();
                for (const term of searchTerms) {
                    if (!corpus.includes(term)) return false;
                }
            }

            return true;
        });

        // Filters do not change score inputs. Reuse scores until assumptions,
        // the calendar year, the listing snapshot, or the personal rating changes.
        const scoreVersion = `${Object.values(scoreWeights).join(',')}:${new Date().getFullYear()}`;
        filteredProperties.forEach(p => {
            if (!p._score || p._scoreVersion !== scoreVersion || p._scoreRating !== p.rating) {
                p._score = computeSmartScore(p);
                p._scoreVersion = scoreVersion;
                p._scoreRating = p.rating;
            }
        });

        // Sort Properties
        sortFilteredProperties();

        // Render UI
        renderGalleryCards(resetLimit);
        // Rebuilding hundreds of Leaflet markers while the map is hidden
        // (grid/deals/analytics views) is wasted work; defer until visible.
        if (isMapVisible()) {
            updateMapMarkers(filteredProperties);
        } else {
            mapMarkersDirty = true;
        }
        renderActiveFilterTags();
        updateHeaderAndMarketStats();
        if (activeView === 'deals') renderDealsView();
        if (activeView === 'odd') renderOddFinds();
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
                filteredProperties.sort((a, b) => (a._ppsqft || (a.price / Math.max(1, a.sqft))) - (b._ppsqft || (b.price / Math.max(1, b.sqft))));
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
    // Render Gallery Cards (Optimized High-Performance Batch List)
    // -------------------------------------------------------------------------
    let currentCardLimit = 28;

    function renderGalleryCards(resetLimit = false) {
        if (resetLimit) {
            currentCardLimit = 28;
            if (cardsGrid.parentElement) cardsGrid.parentElement.scrollTop = 0;
        }
        cardsGrid.innerHTML = '';

        if (filteredProperties.length === 0) {
            emptyStateNotice.classList.remove('hidden');
            cardsGrid.classList.add('hidden');
            return;
        }

        emptyStateNotice.classList.add('hidden');
        cardsGrid.classList.remove('hidden');

        const fragment = document.createDocumentFragment();
        const displayBatch = filteredProperties.slice(0, currentCardLimit);

        displayBatch.forEach(p => {
            const card = document.createElement('article');
            card.className = 'property-card';
            card.id = `card-${p.id}`;
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label', `${p.address}, ${p.city}, WA. Listing price $${p.price.toLocaleString()}`);

            const photoIdx = activePhotoIndices[p.id] || 0;
            const currentPhoto = thumbUrl(p.photos[photoIdx], 600) || PHOTO_PLACEHOLDER;
            const totalPhotos = p.photos.length || 1;
            const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
            const estMonthly = calculateEstimatedMonthly(p.price, p.hoa);
            const isCompared = comparisonSet.has(p.id);
            const scoreVal = p._score ? p._score.total : 80;
            const signals = calculateValueSignals(p);
            const dealEval = computeExecutiveDealEvaluation(p);
            const isTopDeal = dealEval && dealEval.dealScore >= 85;

            // Stars HTML
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                const filledClass = i <= (p.rating || 0) ? 'filled' : '';
                starsHtml += `<button class="star ${filledClass}" data-rate="${i}" title="Rate ${i} stars" aria-label="Rate ${i} stars" aria-pressed="${i <= (p.rating || 0)}">★</button>`;
            }

            // On cards, show distinctive differential value signals (e.g. $/sqft vs median) without repeating basic specs
            let signalsHtml = '';
            signals.filter(s => s.label.includes('median')).forEach(s => {
                signalsHtml += `<span class="chip chip-signal-${s.type}">${s.label}</span>`;
            });

            const acres = (p.lot_sqft / 43560).toFixed(2);
            const bbSummary = getCardBroadbandSummary(p);
            const safeAddr = escapeHtml(p.address);
            const safeCity = escapeHtml(p.city);
            const safeZip = escapeHtml(p.zip || '');
            const safeFccUrl = safeUrl(getRegionalBroadbandDetails(p).fccMapUrl);
            const safePhotoUrl = safeUrl(currentPhoto);
            const svUrl = (p.latitude && p.longitude)
                ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.latitude},${p.longitude}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.address}, ${p.city}, WA ${p.zip || ''}`.trim())}`;

            card.innerHTML = `
                <div class="card-media">
                    <img src="${safePhotoUrl}" alt="${safeAddr}" class="card-img" id="img-${p.id}" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
                    <div class="card-media-tags-top">
                        <span class="card-city-badge">${safeCity}, WA</span>
                        ${isTopDeal ? `<span class="card-deal-badge" title="${escapeHtml(dealEval.gradeLabel)}">TOP DEAL</span>` : ''}
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
                        <span class="card-mortgage-badge mono" data-id="${p.id}" title="${hasListingMetric(p, 'hoa') ? 'Click to view mortgage breakdown' : 'Estimate assumes $0 HOA because dues are unknown'}">Est. $${estMonthly.total.toLocaleString()}/mo${hasListingMetric(p, 'hoa') ? "" : "*"}</span>
                    </div>

                    <div class="card-address-block">
                        <strong class="card-street" title="${safeAddr}">${safeAddr}</strong>
                        <span class="card-city-zip">${safeCity}, WA ${safeZip}</span>
                        <a class="listing-source-link" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="View ${safeAddr} on Realtor.com (opens in a new tab)">View home on Realtor.com ↗</a>
                    </div>

                    <div class="card-specs-grid">
                        <div class="spec-item">
                            <span class="spec-val mono">${listingMetric(p, 'beds')}</span>
                            <span class="spec-lbl">Beds</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val mono">${listingMetric(p, 'baths')}</span>
                            <span class="spec-lbl">Baths</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val mono">${p.sqft.toLocaleString()}</span>
                            <span class="spec-lbl">SqFt</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val mono">${listingMetric(p, 'garage', ' Car')}</span>
                            <span class="spec-lbl">Garage</span>
                        </div>
                    </div>

                    <div class="card-extra-chips">
                        <span class="chip mono">$${ppsqft}/sqft</span>
                        <span class="chip mono">${hasListingMetric(p, 'lot_sqft') ? `${acres} Ac Lot` : 'Lot unknown'}</span>
                        <span class="chip">Built ${listingMetric(p, 'year_built')}</span>
                        <span class="chip">${listingHoa(p)}</span>
                        ${signalsHtml}
                    </div>

                    <!-- FCC city coverage, not address-level availability -->
                    <div class="card-broadband-block ${bbSummary.isCableOnly ? 'cable-only-block' : 'fiber-ready-block'}">
                        <div class="bb-card-top-row">
                            <span class="bb-type-pill ${bbSummary.badgeClass}" title="${bbSummary.badgeTitle}">
                                ${escapeHtml(bbSummary.badgeText)}
                            </span>
                            <span class="bb-speed-tag mono" title="${escapeHtml(bbSummary.badgeTitle)}">${escapeHtml(bbSummary.speedText)}</span>
                        </div>
                        <div class="bb-card-providers-row">
                            <span class="bb-prov-prefix">Service:</span>
                            <span class="bb-prov-names" title="${escapeHtml(bbSummary.providersText)}">${escapeHtml(bbSummary.providersText)}</span>
                        </div>
                    </div>

                    <div class="card-user-meta">
                        <div class="card-star-rating" data-id="${p.id}" title="Set rating">
                            ${starsHtml}
                        </div>
                        <div style="display: flex; gap: 5px; align-items: center;">
                            <a href="${safeFccUrl}" target="_blank" rel="noopener noreferrer" class="card-fcc-action-btn" onclick="event.stopPropagation();" title="Open ${safeAddr} on official FCC National Broadband Map">
                                <span>FCC ↗</span>
                            </a>
                            <a href="${safeUrl(svUrl)}" target="_blank" rel="noopener noreferrer" class="card-fcc-action-btn card-sv-action-btn" onclick="event.stopPropagation();" title="Inspect utility pole and exterior ONT in Google Street View">
                                <span>SV ↗</span>
                            </a>
                            <button class="card-note-trigger ${p.user_notes ? 'has-note' : ''}" data-id="${p.id}" title="Edit private notes">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                <span>Note</span>
                            </button>
                        </div>
                    </div>

                    <div class="card-actions">
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

            // Card click opens drawer
            card.addEventListener('click', (e) => {
                // Ignore clicks on specific interactive sub-controls
                if (e.target.closest('.card-star-rating') ||
                    e.target.closest('.compare-checkbox-label') ||
                    e.target.closest('.card-note-trigger') ||
                    e.target.closest('.card-favorite-btn') ||
                    e.target.closest('.card-nav-arrow') ||
                    e.target.closest('.card-view-drawer-btn') ||
                    e.target.closest('a')) {
                    return;
                }
                openPropertyDrawer(p.id);
            });

            // Enter key opens drawer
            card.addEventListener('keydown', (e) => {
                if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    openPropertyDrawer(p.id);
                }
            });

            fragment.appendChild(card);
        });

        // Add Load More button if more cards exist
        if (filteredProperties.length > currentCardLimit) {
            const loadMoreWrapper = document.createElement('div');
            loadMoreWrapper.className = 'load-more-container';
            loadMoreWrapper.style.gridColumn = '1 / -1';
            loadMoreWrapper.style.textAlign = 'center';
            loadMoreWrapper.style.padding = '20px 0';
            loadMoreWrapper.innerHTML = `
                <button class="btn btn-secondary" id="btn-load-more-cards" style="padding: 10px 24px; font-weight: 700; font-size: 13px;">
                    Load More Listings (Showing ${displayBatch.length} of ${filteredProperties.length})
                </button>
            `;
            loadMoreWrapper.querySelector('#btn-load-more-cards').addEventListener('click', () => {
                currentCardLimit += 28;
                renderGalleryCards(false);
            });
            fragment.appendChild(loadMoreWrapper);
        }

        cardsGrid.appendChild(fragment);
        attachCardDelegatedEvents();
    }

    function toggleComparison(propId, shouldAdd, checkboxEl = null) {
        if (shouldAdd) {
            if (comparisonSet.size >= 4 && !comparisonSet.has(propId)) {
                if (checkboxEl) checkboxEl.checked = false;
                showToast("You can compare up to 4 homes simultaneously.", "error");
                return false;
            }
            comparisonSet.add(propId);
        } else {
            comparisonSet.delete(propId);
        }
        document.querySelectorAll(`.compare-check[data-id="${CSS.escape(propId)}"]`).forEach(chk => {
            chk.checked = comparisonSet.has(propId);
        });
        updateCompareDock();
        return true;
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

        // Note Trigger & View Details Click -> Open drawer
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
                toggleComparison(propId, chk.checked, chk);
            });
        });
    }

    function cycleCardPhoto(propId, direction) {
        const prop = getPropertyById(propId);
        if (!prop || !prop.photos || prop.photos.length <= 1) return;

        let curIdx = activePhotoIndices[propId] || 0;
        curIdx = (curIdx + direction + prop.photos.length) % prop.photos.length;
        activePhotoIndices[propId] = curIdx;

        const imgEl = document.getElementById(`img-${propId}`);
        const counterEl = document.getElementById(`counter-${propId}`);
        if (imgEl) imgEl.src = thumbUrl(prop.photos[curIdx], 600);
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
        if (filterState.minPrice > FILTER_DEFAULTS.minPrice || filterState.maxPrice < FILTER_DEFAULTS.maxPrice) {
            tags.push({ label: `$${Math.round(filterState.minPrice/1000)}k–$${Math.round(filterState.maxPrice/1000)}k`, key: 'price', reset: () => {
                filterState.minPrice = FILTER_DEFAULTS.minPrice; filterState.maxPrice = FILTER_DEFAULTS.maxPrice;
                priceMinSlider.value = FILTER_DEFAULTS.minPrice; priceMaxSlider.value = FILTER_DEFAULTS.maxPrice;
                priceRangeDisplay.textContent = '$200k – $750k';
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
        if (filterState.minSqft > FILTER_DEFAULTS.minSqft || filterState.maxSqft < FILTER_DEFAULTS.maxSqft) {
            tags.push({ label: `${filterState.minSqft.toLocaleString()}–${filterState.maxSqft >= FILTER_DEFAULTS.maxSqft ? '6,000+' : filterState.maxSqft.toLocaleString()} sqft`, key: 'sqft', reset: () => {
                filterState.minSqft = FILTER_DEFAULTS.minSqft; filterState.maxSqft = FILTER_DEFAULTS.maxSqft;
                sqftMinSlider.value = FILTER_DEFAULTS.minSqft; sqftMaxSlider.value = FILTER_DEFAULTS.maxSqft;
                sqftRangeDisplay.textContent = '0 – 6,000+ sqft';
            }});
        }
        if (filterState.maxHoa < FILTER_DEFAULTS.maxHoa) {
            tags.push({ label: `HOA ≤ $${filterState.maxHoa}/mo`, key: 'hoa', reset: () => {
                filterState.maxHoa = FILTER_DEFAULTS.maxHoa; hoaSlider.value = FILTER_DEFAULTS.maxHoa; hoaDisplay.textContent = 'No Limit';
            }});
        }
        if (filterState.minLot > FILTER_DEFAULTS.minLot) {
            tags.push({ label: `Lot ≥ ${filterState.minLot.toLocaleString()} sqft`, key: 'lot', reset: () => {
                filterState.minLot = FILTER_DEFAULTS.minLot; lotSlider.value = FILTER_DEFAULTS.minLot; lotDisplay.textContent = 'Any Lot';
            }});
        }
        if (filterState.minYear > 0) {
            tags.push({ label: `Built ≥ ${filterState.minYear}`, key: 'year', reset: () => {
                filterState.minYear = 0; yearSelect.value = '0';
            }});
        }
        if (filterState.maxPpsqft < FILTER_DEFAULTS.maxPpsqft) {
            tags.push({ label: `≤ $${filterState.maxPpsqft}/sqft`, key: 'ppsqft', reset: () => {
                filterState.maxPpsqft = FILTER_DEFAULTS.maxPpsqft; maxPpsqftSlider.value = FILTER_DEFAULTS.maxPpsqft; maxPpsqftDisplay.textContent = 'No Limit';
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
        if (filterState.fiberOnly || filterState.broadbandType === 'fiber') {
            tags.push({ label: 'City fiber coverage', key: 'fiber', reset: () => {
                filterState.fiberOnly = false;
                filterState.broadbandType = 'all';
                if (filterFiberToggle) filterFiberToggle.checked = false;
                if (broadbandFilter) broadbandFilter.value = 'all';
            }});
        } else if (filterState.broadbandType === 'gigabit') {
            tags.push({ label: 'City gigabit coverage', key: 'broadband', reset: () => {
                filterState.broadbandType = 'all';
                if (broadbandFilter) broadbandFilter.value = 'all';
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
            tagEl.innerHTML = `${escapeHtml(t.label)} <button class="filter-tag-remove" aria-label="Remove filter">✕</button>`;
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

    function computeMarketStats(properties) {
        const prices = properties.map(p => p.price).filter(Number.isFinite);
        const sqfts = properties.map(p => p.sqft).filter(v => Number.isFinite(v) && v > 0);
        const lots = properties.filter(p => hasListingMetric(p, 'lot_sqft')).map(p => p.lot_sqft);
        const ppsqfts = properties
            .filter(p => Number.isFinite(p.price) && Number.isFinite(p.sqft) && p.sqft > 0)
            .map(p => p.price / p.sqft);

        const median = (values) => {
            if (!values.length) return 0;
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        };

        return {
            medPrice: Math.round(median(prices)),
            medPpsqft: Math.round(median(ppsqfts)),
            medSqft: Math.round(median(sqfts)),
            medLot: Math.round(median(lots)),
            prices,
            sqfts,
            ppsqfts
        };
    }

    function renderAnalytics() {
        renderAnalyticsView(filteredProperties, computeMarketStats(filteredProperties));
    }

    function updateHeaderAndMarketStats() {
        if (totalCountBadge) totalCountBadge.textContent = allProperties.length;
        if (matchedCountBadge) matchedCountBadge.textContent = filteredProperties.length;
        
        const favCount = allProperties.filter(p => p.favorite).length;
        if (favoritesCountBadge) favoritesCountBadge.textContent = favCount;
        if (resultsCountLabel) resultsCountLabel.textContent = `${filteredProperties.length} homes matched`;

        const stats = computeMarketStats(filteredProperties);
        if (marketAvgPrice) marketAvgPrice.textContent = `$${stats.medPrice.toLocaleString()}`;
        if (marketAvgPpsqft) marketAvgPpsqft.textContent = `$${stats.medPpsqft}/sqft`;
        if (marketAvgSqft) marketAvgSqft.textContent = `${stats.medSqft.toLocaleString()} sqft`;
        if (marketAvgLot) marketAvgLot.textContent = `${stats.medLot.toLocaleString()} sqft`;

        if (activeView === 'analytics') {
            renderAnalyticsView(filteredProperties, stats);
        }
    }

    // FCC city-level summaries are coverage statistics, not address-level service.
    // Verify individual properties using the FCC map or a provider.
    function getRegionalBroadbandDetails(prop) {
        const city = cityBroadband[(prop.city || '').trim().toLowerCase()];
        const fullAddress = `${prop.address}, ${prop.city}, WA ${prop.zip || ''}`.trim();
        const fccMapUrl = prop.latitude && prop.longitude
            ? `https://broadbandmap.fcc.gov/location-summary/fixed?zoom=17.5&vlat=${prop.latitude}&vlon=${prop.longitude}`
            : `https://broadbandmap.fcc.gov/home?addr=${encodeURIComponent(fullAddress)}`;
        return {
            city,
            hasFiber: !!city && city.fiber_100mbps_pct > 0,
            hasGigabit: !!city && city.wired_gigabit_pct > 0,
            fccMapUrl,
            fullAddress
        };
    }

    // Results are tied to the listing identity and coordinates used for the lookup.
    function getNearbyBroadband(prop) {
        const data = nearbyBroadband[prop.id];
        if (!data || data.address !== prop.address || data.city !== prop.city ||
            data.zip !== prop.zip || (data.latitude ?? null) !== (prop.latitude ?? null) ||
            (data.longitude ?? null) !== (prop.longitude ?? null) ||
            !Array.isArray(data.providers)) return null;
        return data;
    }

    function nearbyProviders(data, technology) {
        return data.providers.filter(p => typeof p.technology === 'string' &&
            p.technology.toLowerCase().includes(technology));
    }

    function nearbySpeed(providers, direction) {
        // A combined technology row does not identify which technology has its speed.
        if (providers.some(p => p.technology.includes(','))) return 'Varies by technology';
        const speeds = providers.map(p => p[direction]).filter(n => Number.isFinite(n) && n > 0);
        return speeds.length ? `${Math.max(...speeds).toLocaleString()} Mbps` : 'Not reported';
    }

    function getCardBroadbandSummary(prop) {
        const regional = getRegionalBroadbandDetails(prop);
        const nearby = getNearbyBroadband(prop);
        if (nearby) {
            const fiber = nearbyProviders(nearby, 'fiber');
            const cable = nearbyProviders(nearby, 'cable');
            const wireline = [...fiber, ...cable];
            const speed = nearbySpeed(wireline, 'download_mbps');
            return {
                isCableOnly: !fiber.length && !!cable.length,
                badgeClass: fiber.length ? 'badge-fiber-ready' : 'badge-cable-only',
                badgeText: fiber.length ? 'Fiber reported nearby' : cable.length ? 'Cable reported nearby' : 'Nearby wireline unverified',
                badgeTitle: 'ISPMap neighborhood cell; service at this address is unverified',
                speedText: !wireline.length ? 'No wireline reported nearby' : speed.endsWith(' Mbps') ? `Up to ${speed} nearby` : `${speed} nearby`,
                providersText: wireline.length ? [...new Set(wireline.map(p => p.name))].join(', ') : 'Verify at address',
                chipLabel: 'Nearby broadband', chipTitle: 'ISPMap neighborhood coverage',
                fccUrl: safeUrl(regional.fccMapUrl)
            };
        }
        const city = regional.city;
        const coverage = city ? `${city.fiber_100mbps_pct}% of city homes` : 'City data unavailable';
        return {
            isCableOnly: false,
            badgeClass: 'badge-fiber-ready',
            badgeText: 'City fiber coverage',
            badgeTitle: 'FCC city-level residential coverage at 100 Mbps or faster; not address verification',
            speedText: coverage,
            providersText: 'Address service unverified',
            chipLabel: 'City fiber coverage',
            chipTitle: coverage,
            fccUrl: safeUrl(regional.fccMapUrl)
        };
    }

    // -------------------------------------------------------------------------
    // Property Detail Workstation Drawer
    // -------------------------------------------------------------------------
    function openPropertyDrawer(propId) {
        const prop = getPropertyById(propId);
        if (!prop) return;

        selectedPropId = propId;
        currentDrawerIndex = filteredProperties.findIndex(p => p.id === propId);
        if (currentDrawerIndex === -1) currentDrawerIndex = 0;

        recordRecentlyViewed(propId);

        // Header
        if (drawerAddress) drawerAddress.textContent = prop.address;
        if (drawerCityZip) drawerCityZip.textContent = `${prop.city}, WA ${prop.zip || ''}`;
        if (btnDrawerFavorite) {
            btnDrawerFavorite.classList.toggle('favorited', !!prop.favorite);
            btnDrawerFavorite.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18" fill="${prop.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
            `;
        }

        // Broadband & High-Speed Internet (FCC National Broadband Map & Carrier Verification)
        const bbInfo = getRegionalBroadbandDetails(prop);
        if (drawerFccBroadbandLink) drawerFccBroadbandLink.href = bbInfo.fccMapUrl;
        if (btnDrawerFccHeader) btnDrawerFccHeader.href = bbInfo.fccMapUrl;
        const drawerFccBottom = document.getElementById('drawer-fcc-btn-bottom');
        if (drawerFccBottom) drawerFccBottom.href = bbInfo.fccMapUrl;

        const drawerBbMainStatus = document.getElementById('drawer-bb-main-status');
        const drawerFiberAvail = document.getElementById('drawer-fiber-avail');
        const drawerFiberDown = document.getElementById('drawer-fiber-down');
        const drawerFiberUp = document.getElementById('drawer-fiber-up');
        const drawerFiberProviders = document.getElementById('drawer-fiber-providers');
        const drawerCableAvail = document.getElementById('drawer-cable-avail');
        const drawerCableDown = document.getElementById('drawer-cable-down');
        const drawerCableUp = document.getElementById('drawer-cable-up');
        const drawerCableProviders = document.getElementById('drawer-cable-providers');
        const drawerFiberCell = document.getElementById('drawer-fiber-cell');
        const drawerCableCell = document.getElementById('drawer-cable-cell');

        if (drawerBbMainStatus) {
            drawerBbMainStatus.textContent = 'Address availability unverified';
            drawerBbMainStatus.className = 'drawer-bb-status-pill';
        }
        if (drawerFiberCell) drawerFiberCell.classList.remove('cell-unavailable');
        if (drawerCableCell) drawerCableCell.classList.remove('cell-unavailable');
        if (drawerFiberAvail) { drawerFiberAvail.textContent = 'City coverage'; drawerFiberAvail.className = 'tech-avail-badge'; }
        if (drawerCableAvail) { drawerCableAvail.textContent = 'City coverage'; drawerCableAvail.className = 'tech-avail-badge'; }
        const city = bbInfo.city;
        if (drawerFiberDown) drawerFiberDown.textContent = city ? `${city.fiber_100mbps_pct}%` : 'Unknown';
        if (drawerFiberUp) drawerFiberUp.textContent = city ? `${city.fiber_gigabit_pct}%` : 'Unknown';
        if (drawerFiberProviders) drawerFiberProviders.textContent = 'Verify at address';
        if (drawerCableDown) drawerCableDown.textContent = city ? `${city.cable_100mbps_pct}%` : 'Unknown';
        if (drawerCableUp) drawerCableUp.textContent = city ? `${city.cable_gigabit_pct}%` : 'Unknown';

        // Carrier Verification Action Hub
        const btnVerifyFcc = document.getElementById('btn-verify-fcc');
        const btnVerifyCarrier = document.getElementById('btn-verify-carrier');
        const btnVerifyCarrierLabel = document.getElementById('btn-verify-carrier-label');
        const btnVerifyStreetview = document.getElementById('btn-verify-streetview');
        const btnCopyAddress = document.getElementById('btn-copy-address');
        const btnCopyAddressLabel = document.getElementById('btn-copy-address-label');

        const cleanAddr = `${prop.address}, ${prop.city}, WA ${prop.zip || ''}`.trim();
        const cityLower = (prop.city || '').toLowerCase();

        if (btnVerifyFcc) {
            btnVerifyFcc.href = bbInfo.fccMapUrl;
        }

        if (btnVerifyCarrier && btnVerifyCarrierLabel) {
            if (cityLower.includes('everett') || cityLower.includes('marysville') || cityLower.includes('snohomish') || cityLower.includes('lynnwood') || cityLower.includes('edmonds') || cityLower.includes('lake stevens') || cityLower.includes('bothell') || cityLower.includes('mill creek') || cityLower.includes('kennewick') || cityLower.includes('richland') || cityLower.includes('pasco')) {
                btnVerifyCarrier.href = 'https://ziplyfiber.com/';
                btnVerifyCarrierLabel.textContent = 'Check Ziply Fiber ↗';
            } else if (cityLower.includes('vancouver') || cityLower.includes('camas') || cityLower.includes('ridgefield') || cityLower.includes('battle ground') || cityLower.includes('tacoma') || cityLower.includes('olympia') || cityLower.includes('spokane')) {
                btnVerifyCarrier.href = 'https://www.quantumfiber.com/';
                btnVerifyCarrierLabel.textContent = 'Check Quantum Fiber ↗';
            } else if (cityLower.includes('wenatchee')) {
                btnVerifyCarrier.href = 'https://www.chelanpud.org/fiber';
                btnVerifyCarrierLabel.textContent = 'Check Chelan PUD ↗';
            } else {
                btnVerifyCarrier.href = 'https://www.xfinity.com/';
                btnVerifyCarrierLabel.textContent = 'Check Xfinity / Cable ↗';
            }
        }

        if (btnVerifyStreetview) {
            if (prop.latitude && prop.longitude) {
                btnVerifyStreetview.href = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${prop.latitude},${prop.longitude}`;
            } else {
                btnVerifyStreetview.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanAddr)}`;
            }
        }

        if (btnCopyAddress && btnCopyAddressLabel) {
            btnCopyAddress.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(cleanAddr).then(() => {
                    btnCopyAddress.classList.add('copied');
                    btnCopyAddressLabel.textContent = '✓ Copied!';
                    setTimeout(() => {
                        btnCopyAddress.classList.remove('copied');
                        btnCopyAddressLabel.textContent = 'Copy Address';
                    }, 2000);
                }).catch(() => {
                    showToast('Address: ' + cleanAddr, 'info');
                });
            };
        }
        if (drawerCableProviders) drawerCableProviders.textContent = 'Verify at address';

        const nearby = getNearbyBroadband(prop);
        const notice = document.getElementById('drawer-broadband-notice');
        const fiberLabels = drawerFiberCell?.querySelectorAll('.speed-lbl');
        const cableLabels = drawerCableCell?.querySelectorAll('.speed-lbl');
        if (nearby) {
            const setNearby = (providers, avail, down, up, names, labels) => {
                if (avail) avail.textContent = providers.length ? 'Reported nearby' : 'None reported nearby';
                if (down) down.textContent = nearbySpeed(providers, 'download_mbps');
                if (up) up.textContent = nearbySpeed(providers, 'upload_mbps');
                if (names) names.textContent = providers.length ? [...new Set(providers.map(p => p.name))].join(', ') : 'None reported in cell';
                if (labels?.length >= 2) { labels[0].textContent = 'Max download nearby:'; labels[1].textContent = 'Max upload nearby:'; }
            };
            setNearby(nearbyProviders(nearby, 'fiber'), drawerFiberAvail, drawerFiberDown, drawerFiberUp, drawerFiberProviders, fiberLabels);
            setNearby(nearbyProviders(nearby, 'cable'), drawerCableAvail, drawerCableDown, drawerCableUp, drawerCableProviders, cableLabels);
            if (drawerBbMainStatus) drawerBbMainStatus.textContent = 'Nearby coverage · address unverified';
            if (notice) notice.textContent = `ISPMap reports service somewhere in the surrounding map cell, not necessarily at this property. ${nearby.location_method ? 'ISPMap matched this address; its map position is not independently verified. ' : ''}FCC data as of ${nearbyBroadbandMeta.fcc_data_as_of || 'unknown'}; retrieved ${nearbyBroadbandMeta.retrieved_on || 'unknown'}. Maximum download and upload can come from different providers. Confirm service and speeds with the FCC and provider.`;
        } else {
            for (const labels of [fiberLabels, cableLabels]) {
                if (labels?.length >= 2) { labels[0].textContent = '100 Mbps+ coverage:'; labels[1].textContent = 'Gigabit coverage:'; }
            }
            if (notice) notice.textContent = 'FCC percentages describe residential coverage across the city, not this property. Check the address with the FCC map and provider; availability and speeds can vary by location.';
        }

        // Gallery Stage
        const photoIdx = activePhotoIndices[prop.id] || 0;
        const totalPhotos = prop.photos.length || 1;
        drawerActiveImg.src = prop.photos[photoIdx] || PHOTO_PLACEHOLDER;
        drawerActiveImg.onerror = () => { drawerActiveImg.onerror = null; drawerActiveImg.src = PHOTO_PLACEHOLDER; };
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
        const hoaKnown = hasListingMetric(prop, 'hoa');
        drawerEstMonthly.textContent = `~$${estMonthly.total.toLocaleString()}/mo${hoaKnown ? '' : '*'} est.`;

        // Value Signals
        drawerSignalsList.innerHTML = '';
        const signals = calculateValueSignals(prop);
        signals.forEach(s => {
            const span = document.createElement('span');
            span.className = `chip chip-signal-${s.type}`;
            span.textContent = s.label;
            drawerSignalsList.appendChild(span);
        });

        // Executive Deal & Comprehensive Valuation Card
        const dealEval = computeExecutiveDealEvaluation(prop);
        if (drawerDealEvalCard && dealEval) {
            if (drawerDealGradeText) drawerDealGradeText.textContent = dealEval.gradeLabel.toUpperCase();
            if (drawerDealScoreBadge) drawerDealScoreBadge.textContent = `Deal Score: ${dealEval.dealScore}/100`;
            if (drawerDealSummaryBox) drawerDealSummaryBox.textContent = dealEval.narrative;
            if (drawerDealMetricsGrid) {
                const lotKnown = hasListingMetric(prop, 'lot_sqft');
                const lotLabel = lotKnown ? `${dealEval.acres.toFixed(2)} Ac (${dealEval.factors.lot.score}/100)` : 'Unknown';
                const hoaGood = hoaKnown && prop.hoa <= 35;
                drawerDealMetricsGrid.innerHTML = `
                    <div class="deal-metric-cell">
                        <span class="dmc-label">$/SqFt Delta</span>
                        <strong class="dmc-val ${dealEval.ppsqftPct > 0 ? 'good' : ''} mono">${dealEval.ppsqftPct > 0 ? '↓ ' + dealEval.ppsqftPct + '% vs median' : 'At median'}</strong>
                    </div>
                    <div class="deal-metric-cell">
                        <span class="dmc-label">Gap at City Median $/SqFt</span>
                        <strong class="dmc-val ${dealEval.estDollarSavings > 0 ? 'good' : ''} mono">${dealEval.estDollarSavings > 0 ? '+$' + dealEval.estDollarSavings.toLocaleString() : 'Parity'}</strong>
                    </div>
                    <div class="deal-metric-cell">
                        <span class="dmc-label">Lot &amp; Acreage</span>
                        <strong class="dmc-val ${lotKnown && dealEval.factors.lot.score >= 70 ? 'good' : ''} mono">${lotLabel}</strong>
                    </div>
                    <div class="deal-metric-cell">
                        <span class="dmc-label">Carrying Dues</span>
                        <strong class="dmc-val ${hoaGood ? 'good' : ''} mono">${listingHoa(prop)}</strong>
                    </div>
                `;
            }
        }

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
        dSpecBeds.textContent = listingMetric(prop, 'beds');
        dSpecBaths.textContent = listingMetric(prop, 'baths');
        dSpecSqft.textContent = `${prop.sqft.toLocaleString()} sqft`;
        dSpecPpsqft.textContent = `$${ppsqft}/sqft`;
        dSpecLot.textContent = hasListingMetric(prop, 'lot_sqft') ? `${prop.lot_sqft.toLocaleString()} sqft (${(prop.lot_sqft/43560).toFixed(2)} ac)` : 'Unknown';
        dSpecGarage.textContent = listingMetric(prop, 'garage', ' Car');
        dSpecYear.textContent = listingMetric(prop, 'year_built');
        dSpecHoa.textContent = listingHoa(prop);

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
        drawerExternalLink.href = safeUrl(prop.url);

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
            s.setAttribute('aria-pressed', String(val <= currentRating));
        });

        const labels = ["Not rated", "1 Star - Basic Match", "2 Stars - Fair Option", "3 Stars - Good Contender", "4 Stars - High Priority", "5 Stars - Top Pick"];
        drawerRatingText.textContent = labels[currentRating] || "Not rated";
    }

    function updateDrawerMortgageBreakdown(prop) {
        const est = calculateEstimatedMonthly(prop.price, prop.hoa);
        const hoaKnown = hasListingMetric(prop, 'hoa');
        if (dMortgageTotal) dMortgageTotal.innerHTML = `$${est.total.toLocaleString()}<span class="per-mo">/mo${hoaKnown ? '' : '*'}</span>`;
        if (dValPi) dValPi.textContent = `$${est.pi.toLocaleString()}/mo`;
        if (dValTax) dValTax.textContent = `$${est.tax.toLocaleString()}/mo`;
        if (dValIns) dValIns.textContent = `$${est.ins.toLocaleString()}/mo`;
        if (dValHoa) dValHoa.textContent = hoaKnown ? `$${est.hoa.toLocaleString()}/mo` : 'Unknown ($0 assumed)';

        if (dMortgageBar && est.total > 0) {
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
            const safeAddr = escapeHtml(p.address);
            const safeCity = escapeHtml(p.city);
            const safePhoto = safeUrl(thumbUrl(p.photos && p.photos[0] ? p.photos[0] : '', 400));
            item.innerHTML = `
                <img src="${safePhoto}" alt="${safeAddr}" class="sim-thumb" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
                <div class="sim-info">
                    <span class="sim-price mono">$${p.price.toLocaleString()} • ${safeCity}</span>
                    <strong class="sim-address">${safeAddr}</strong>
                    <span style="font-size: 10.5px; color: var(--text-secondary);">${listingMetric(p, 'beds')}b / ${listingMetric(p, 'baths')}ba • ${p.sqft.toLocaleString()} sqft</span>
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
        const prop = getPropertyById(propId);
        if (!prop) return;

        prop.favorite = !prop.favorite;
        persistUserData(propId, { favorite: prop.favorite });

        try {
            if (API_WRITES_ENABLED) fetch(`/api/properties/${propId}/favorite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ favorite: prop.favorite })
            }).catch(() => {});

            showToast(prop.favorite ? `Saved "${prop.address}" to Shortlist` : `Removed "${prop.address}" from Shortlist`);
            applyFilters(false);

            if (selectedPropId === propId && btnDrawerFavorite) {
                btnDrawerFavorite.classList.toggle('favorited', !!prop.favorite);
                const svg = btnDrawerFavorite.querySelector('svg');
                if (svg) svg.setAttribute('fill', prop.favorite ? 'currentColor' : 'none');
            }
        } catch (e) {
            console.error("Favorite toggle error:", e);
        }
    }

    async function updatePropertyRating(propId, rating) {
        const prop = getPropertyById(propId);
        if (!prop) return;

        if (prop.rating === rating) rating = 0;
        prop.rating = rating;
        persistUserData(propId, { rating: rating });

        try {
            if (API_WRITES_ENABLED) fetch(`/api/properties/${propId}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: rating })
            }).catch(() => {});

            showToast(rating ? `Rated ${rating} ★ for ${prop.address}` : `Rating cleared for ${prop.address}`);
            applyFilters(false);

            if (selectedPropId === propId) {
                updateDrawerStarPicker(rating);
            }
        } catch (e) {
            console.error("Rating update error:", e);
        }
    }

    function saveDrawerNotesDebounced() {
        if (!selectedPropId) return;
        const prop = getPropertyById(selectedPropId);
        if (!prop) return;

        const val = drawerNotesTextarea.value.trim();
        prop.user_notes = val;
        // Persist immediately so closing the page or typing in another home's
        // notes cannot cancel the local save; only the optional API is debounced.
        persistUserData(prop.id, { user_notes: val });
        prop._searchCorpus = `${prop.address || ''} ${prop.city || ''} ${prop.zip || ''} ${prop.description || ''} ${prop.user_notes || ''}`.toLowerCase();
        drawerNoteStatus.textContent = API_WRITES_ENABLED ? "Saving..." : "Saved locally";

        clearTimeout(noteSaveDebounceTimer);
        noteSaveDebounceTimer = setTimeout(async () => {
            if (!API_WRITES_ENABLED) return;
            try {
                const response = await fetch(`/api/properties/${prop.id}/note`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_notes: val })
                });
                if (!response.ok) throw new Error(`API save failed (${response.status})`);
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
        const propArray = Array.from(comparisonSet).map(id => getPropertyById(id)).filter(Boolean);

        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'dock-thumb-slot';
            if (i < propArray.length) {
                const p = propArray[i];
                const safeAddr = escapeHtml(p.address);
                const safePhoto = safeUrl(thumbUrl(p.photos[0] || '', 400));
                slot.classList.add('filled');
                slot.innerHTML = `
                    <img src="${safePhoto}" alt="${safeAddr}" class="dock-thumb-img" title="${safeAddr} ($${p.price.toLocaleString()})" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
                    <button class="dock-thumb-remove" data-id="${escapeHtml(p.id)}" title="Remove" aria-label="Remove">✕</button>
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
                toggleComparison(id, false);
            });
        });
    }

    function openComparisonMatrix() {
        const props = Array.from(comparisonSet).map(id => getPropertyById(id)).filter(Boolean);
        if (props.length < 2) return;

        const minPrice = Math.min(...props.map(p => p.price));
        const minPpsqft = Math.min(...props.map(p => Math.round(p.price / Math.max(1, p.sqft))));
        const maxSqft = Math.max(...props.map(p => p.sqft));
        const knownLotValues = props.filter(p => hasListingMetric(p, 'lot_sqft')).map(p => p.lot_sqft);
        const maxLot = knownLotValues.length ? Math.max(...knownLotValues) : -1;
        const knownYearValues = props.filter(p => hasListingMetric(p, 'year_built')).map(p => p.year_built);
        const maxYear = knownYearValues.length ? Math.max(...knownYearValues) : -1;
        const knownHoaValues = props.filter(p => hasListingMetric(p, 'hoa')).map(p => p.hoa);
        const minHoa = knownHoaValues.length ? Math.min(...knownHoaValues) : -1;
        const maxRating = Math.max(...props.map(p => p.rating || 0));

        let tableHtml = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Property Details</th>
                        ${props.map(p => {
                            const safeAddr = escapeHtml(p.address);
                            const safeCity = escapeHtml(p.city);
                            const safeZip = escapeHtml(p.zip || '');
                            const safePhoto = safeUrl(thumbUrl(p.photos[0] || '', 600));
                            return `
                            <td>
                                <img src="${safePhoto}" class="comp-img-header" alt="${safeAddr}" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
                                <div class="comp-price">$${p.price.toLocaleString()}</div>
                                <strong>${safeAddr}</strong><br>
                                <span style="font-size: 11px; color: var(--text-secondary);">${safeCity}, WA ${safeZip}</span>
                            </td>
                        `}).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th>Price</th>
                        ${props.map(p => `<td class="${p.price === minPrice ? 'best-metric-cell' : ''}">$${p.price.toLocaleString()} ${p.price === minPrice ? '★ (Lowest)' : ''}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Monthly Est. Cost</th>
                        ${props.map(p => {
                            const hoaKnown = hasListingMetric(p, 'hoa');
                            return `<td><strong style="color: var(--accent-emerald);">~$${calculateEstimatedMonthly(p.price, p.hoa).total.toLocaleString()}/mo${hoaKnown ? '' : '*'}</strong></td>`;
                        }).join('')}
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
                        ${props.map(p => `<td>${listingMetric(p, 'beds')} Beds • ${listingMetric(p, 'baths')} Baths</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Living Area</th>
                        ${props.map(p => `<td class="${p.sqft === maxSqft ? 'best-metric-cell' : ''}">${p.sqft.toLocaleString()} sqft ${p.sqft === maxSqft ? '★ (Largest)' : ''}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Lot Size</th>
                        ${props.map(p => `<td class="${hasListingMetric(p, 'lot_sqft') && p.lot_sqft === maxLot ? 'best-metric-cell' : ''}">${hasListingMetric(p, 'lot_sqft') ? `${p.lot_sqft.toLocaleString()} sqft (${(p.lot_sqft / 43560).toFixed(2)} ac)` : 'Unknown'}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Garage Spaces</th>
                        ${props.map(p => `<td>${listingMetric(p, 'garage', ' Car')}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>HOA Monthly</th>
                        ${props.map(p => `<td class="${hasListingMetric(p, 'hoa') && p.hoa === minHoa ? 'best-metric-cell' : ''}">${listingHoa(p)}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Year Built</th>
                        ${props.map(p => `<td class="${hasListingMetric(p, 'year_built') && p.year_built === maxYear ? 'best-metric-cell' : ''}">${listingMetric(p, 'year_built')}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Personal Rating</th>
                        ${props.map(p => `<td class="${(p.rating || 0) === maxRating && maxRating > 0 ? 'best-metric-cell' : ''}"><span style="color: var(--accent-amber);">${'★'.repeat(p.rating || 0)}${'☆'.repeat(5 - (p.rating || 0))}</span></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Private Notes</th>
                        ${props.map(p => `<td><em style="color: var(--text-secondary); font-size: 11.5px;">${escapeHtml(p.user_notes || 'No notes added')}</em></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Internet &amp; Speeds</th>
                        ${props.map(p => {
                            const bbSummary = getCardBroadbandSummary(p);
                            return `<td>
                                <strong style="color: ${bbSummary.isCableOnly ? 'var(--warning-ink)' : 'var(--info-ink)'}; font-size: 11.5px;">${escapeHtml(bbSummary.badgeText)}</strong><br>
                                <span style="font-size: 10.5px; font-weight: 700; color: var(--text-primary);" class="mono">${escapeHtml(bbSummary.speedText)}</span><br>
                                <span style="font-size: 10.5px; color: var(--text-secondary);">${escapeHtml(bbSummary.providersText)}</span><br>
                                <a href="${safeUrl(bbSummary.fccUrl)}" target="_blank" rel="noopener noreferrer" style="font-size: 10.5px; color: var(--brand-primary); font-weight: 700; text-decoration: underline;">
                                    FCC Map ↗
                                </a>
                            </td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <th>Action</th>
                        ${props.map(p => `
                            <td>
                                <button class="btn btn-secondary btn-sm" onclick="window.HouseFinderApp.openDrawerById('${escapeHtml(p.id)}'); document.getElementById('comparison-modal').classList.add('hidden');">
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
        const prop = getPropertyById(propId);
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
        const downPctRaw = parseFloat(calcDownPct.value);
        const downPct = Number.isFinite(downPctRaw) ? downPctRaw : 20;
        const downAmount = price * (downPct / 100);
        calcDownAmount.value = `$${Math.round(downAmount).toLocaleString()}`;

        const termYears = parseInt(calcLoanTerm.value, 10) || 30;
        const rateRaw = parseFloat(calcInterestRate.value);
        const rate = Number.isFinite(rateRaw) ? rateRaw : 6.65;
        const taxRateRaw = parseFloat(calcTaxRate.value);
        const taxRate = Number.isFinite(taxRateRaw) ? taxRateRaw : 1.02;
        const insRaw = parseFloat(calcInsurance.value);
        const insAnnual = Number.isFinite(insRaw) ? insRaw : 1200;
        const hoaRaw = parseFloat(calcHoaFee.value);
        const hoa = Number.isFinite(hoaRaw) ? hoaRaw : 0;

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
        const prop = getPropertyById(propId);
        if (!prop || !prop.photos || prop.photos.length === 0) return;

        currentLightboxProp = prop;
        currentLightboxIndex = startIdx;

        lightboxAddress.textContent = `${prop.address}, ${prop.city}, WA`;
        lightboxSpecs.textContent = `${listingMetric(prop, 'beds')} Beds • ${listingMetric(prop, 'baths')} Baths • ${prop.sqft.toLocaleString()} sqft • Built ${listingMetric(prop, 'year_built')}`;
        lightboxPrice.textContent = `$${prop.price.toLocaleString()}`;
        lightboxExternalLink.href = safeUrl(prop.url);

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
            const sortedCities = Object.entries(cityCounts).sort((a, b) => b[1] - a[1]);
            const visibleCities = sortedCities.slice(0, 12);
            const otherCityCount = sortedCities.slice(12).reduce((sum, [, count]) => sum + count, 0);
            if (otherCityCount > 0) visibleCities.push(['Other cities', otherCityCount]);

            for (const [city, count] of visibleCities) {
                const row = document.createElement('div');
                row.className = 'city-dist-item';
                row.innerHTML = `
                    <span>${escapeHtml(city === 'Other cities' ? city : `${city}, WA`)}</span>
                    <span class="city-count-badge mono">${count}</span>
                `;
                cityDistributionList.appendChild(row);
            }
        }

        // Garage distribution
        if (garageDistributionList) {
            garageDistributionList.innerHTML = '';
            const garageCounts = { '2 Car': 0, '3+ Car': 0, 'Other': 0, 'Unknown': 0 };
            filteredList.forEach(p => {
                if (!hasListingMetric(p, 'garage')) garageCounts['Unknown']++;
                else if (p.garage >= 3) garageCounts['3+ Car']++;
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
                'Pre-1990': filteredList.filter(p => hasListingMetric(p, 'year_built') && p.year_built < 1990).length,
                '1990–2009': filteredList.filter(p => hasListingMetric(p, 'year_built') && p.year_built >= 1990 && p.year_built < 2010).length,
                '2010+ (Modern)': filteredList.filter(p => hasListingMetric(p, 'year_built') && p.year_built >= 2010).length,
                'Unknown': filteredList.filter(p => !hasListingMetric(p, 'year_built')).length,
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
            { category: 'Navigation', title: 'Open Top Value Deals Evaluation View', action: () => setViewMode('deals'), badge: '4' },
            { category: 'Navigation', title: 'Open Market Analytics Dashboard', action: () => setViewMode('analytics'), badge: '5' },
            { category: 'Navigation', title: 'Open Odd Finds: unusual homes and delightful plot twists', action: () => setViewMode('odd'), badge: '6' },
            { category: 'Filters', title: 'Show Saved Shortlist Properties Only', action: () => { filterState.favoritesOnly = true; filterFavoritesToggle.checked = true; applyFilters(); }, badge: 'F' },
            { category: 'Filters', title: 'Filter for Cities with Fiber Coverage', action: () => { filterState.fiberOnly = true; if (filterFiberToggle) filterFiberToggle.checked = true; if (broadbandFilter) broadbandFilter.value = 'fiber'; applyFilters(); }, badge: 'FIBER' },
            { category: 'Filters', title: 'Reset All Search Filters to Default', action: () => resetAllFilters(), badge: 'R' },
            { category: 'Sorting', title: 'Sort by Smart Shortlist Score', action: () => { filterState.sortBy = 'smart_score'; sortDropdown.value = 'smart_score'; applyFilters(); } },
            { category: 'Sorting', title: 'Sort by Price: Low to High', action: () => { filterState.sortBy = 'price_asc'; sortDropdown.value = 'price_asc'; applyFilters(); } },
            { category: 'Sorting', title: 'Sort by Price/SqFt: Low to High', action: () => { filterState.sortBy = 'price_per_sqft_asc'; sortDropdown.value = 'price_per_sqft_asc'; applyFilters(); } },
            { category: 'Tools', title: 'Tune Smart Score Factor Weights', action: () => openScoringModal() },
            ...(scraperAvailable ? [{ category: 'Tools', title: 'Open Live MLS Scraper Utility', action: () => openScraperModal() }] : []),
            { category: 'Appearance', title: 'Toggle Dark / Light Mode', action: () => toggleTheme() },
            { category: 'Filters', title: 'Open Saved Searches and Presets', action: () => setPresetMenuOpen(true) },
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
                    <span>${escapeHtml(cmd.title)}</span>
                </div>
                ${cmd.badge ? `<kbd class="kbd-badge">${escapeHtml(cmd.badge)}</kbd>` : ''}
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
    function setPresetMenuOpen(open, restoreFocus = false) {
        if (!presetDropdownMenu || !btnPresetsMenu) return;
        presetDropdownMenu.classList.toggle('hidden', !open);
        btnPresetsMenu.setAttribute('aria-expanded', String(open));
        if (open) {
            const rect = btnPresetsMenu.getBoundingClientRect();
            const width = Math.min(320, window.innerWidth - 16);
            const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
            const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 80));
            presetDropdownMenu.style.left = `${left}px`;
            presetDropdownMenu.style.top = `${top}px`;
            presetDropdownMenu.style.maxHeight = `${window.innerHeight - top - 12}px`;
            presetDropdownMenu.querySelector('button')?.focus();
        } else if (restoreFocus) btnPresetsMenu.focus();
        if (!open) {
            document.getElementById('preset-save-form')?.classList.add('hidden');
            btnSaveCurrentPreset?.classList.remove('hidden');
        }
    }

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
                const safeName = escapeHtml(p.name);
                item.innerHTML = `
                    <button class="saved-preset-load">${safeName}</button>
                    <button class="filter-tag-remove" data-idx="${idx}" title="Delete preset" aria-label="Delete ${safeName}">✕</button>
                `;
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('filter-tag-remove')) {
                        e.stopPropagation();
                        deleteCustomPreset(idx);
                        return;
                    }
                    applyPresetState(p.state);
                    activePresetLabel.textContent = p.name;
                    setPresetMenuOpen(false, true);
                });
                customPresetsList.appendChild(item);
            });
        } catch (e) {}
    }

    function saveCurrentPreset() {
        const nameInput = document.getElementById('preset-name');
        const name = nameInput?.value.trim().slice(0, 80);
        if (!name || !name.trim()) return;

        try {
            const raw = localStorage.getItem(STORAGE_PRESETS_KEY);
            const presets = raw ? JSON.parse(raw) : [];
            presets.push({ name: name.trim(), state: { ...filterState } });
            localStorage.setItem(STORAGE_PRESETS_KEY, JSON.stringify(presets));
            showToast(`Preset "${name.trim()}" saved!`);
            loadSavedPresets();
            nameInput.value = '';
            setPresetMenuOpen(false, true);
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
        Object.assign(filterState, FILTER_DEFAULTS, state);
        
        searchInput.value = filterState.search || '';
        citySelect.value = filterState.city || 'all';
        priceMinSlider.value = filterState.minPrice;
        priceMaxSlider.value = filterState.maxPrice;
        priceRangeDisplay.textContent = `$${Math.round(filterState.minPrice/1000)}k – $${Math.round(filterState.maxPrice/1000)}k`;
        sqftMinSlider.value = filterState.minSqft;
        sqftMaxSlider.value = filterState.maxSqft;
        sqftRangeDisplay.textContent = `${filterState.minSqft.toLocaleString()} – ${filterState.maxSqft.toLocaleString()} sqft`;
        hoaSlider.value = filterState.maxHoa;
        hoaDisplay.textContent = filterState.maxHoa >= FILTER_DEFAULTS.maxHoa ? 'No Limit' : (filterState.maxHoa === 0 ? '$0/mo (known dues only)' : `≤ $${filterState.maxHoa}/mo`);
        lotSlider.value = filterState.minLot;
        lotDisplay.textContent = filterState.minLot <= 0 ? 'Any Lot' : `${filterState.minLot.toLocaleString()}+ sqft`;
        yearSelect.value = String(filterState.minYear || 0);
        ratingFilter.value = String(filterState.minRating || 0);
        filterFavoritesToggle.checked = !!filterState.favoritesOnly;
        if (filterFiberToggle) filterFiberToggle.checked = !!filterState.fiberOnly;
        if (broadbandFilter) broadbandFilter.value = filterState.broadbandType || (filterState.fiberOnly ? 'fiber' : 'all');

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
        if (filterState.minPrice > FILTER_DEFAULTS.minPrice) params.set('minPrice', filterState.minPrice);
        if (filterState.maxPrice < FILTER_DEFAULTS.maxPrice) params.set('maxPrice', filterState.maxPrice);
        if (filterState.minBeds > 0) params.set('beds', filterState.minBeds);
        if (filterState.minBaths > 0) params.set('baths', filterState.minBaths);
        if (filterState.minGarage > 0) params.set('garage', filterState.minGarage);
        if (filterState.minSqft > FILTER_DEFAULTS.minSqft) params.set('minSqft', filterState.minSqft);
        if (filterState.maxSqft < FILTER_DEFAULTS.maxSqft) params.set('maxSqft', filterState.maxSqft);
        if (filterState.maxHoa < FILTER_DEFAULTS.maxHoa) params.set('maxHoa', filterState.maxHoa);
        if (filterState.minLot > FILTER_DEFAULTS.minLot) params.set('minLot', filterState.minLot);
        if (filterState.minYear > 0) params.set('minYear', filterState.minYear);
        if (filterState.favoritesOnly) params.set('favorites', '1');
        if (filterState.fiberOnly) params.set('fiber', '1');
        if (filterState.broadbandType && filterState.broadbandType !== 'all') params.set('broadband', filterState.broadbandType);
        if (filterState.sortBy !== 'smart_score') params.set('sort', filterState.sortBy);
        if (activeView !== 'grid') params.set('view', activeView);
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

        const parseIntOr = (val, fallback) => {
            const parsed = parseInt(val, 10);
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        const parseFloatOr = (val, fallback) => {
            const parsed = parseFloat(val);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        if (params.has('city')) filterState.city = params.get('city');
        if (params.has('minPrice')) filterState.minPrice = parseIntOr(params.get('minPrice'), FILTER_DEFAULTS.minPrice);
        if (params.has('maxPrice')) filterState.maxPrice = parseIntOr(params.get('maxPrice'), FILTER_DEFAULTS.maxPrice);
        if (params.has('beds')) filterState.minBeds = parseIntOr(params.get('beds'), 0);
        if (params.has('baths')) filterState.minBaths = parseFloatOr(params.get('baths'), 0);
        if (params.has('garage')) filterState.minGarage = parseIntOr(params.get('garage'), 0);
        if (params.has('minSqft')) filterState.minSqft = parseIntOr(params.get('minSqft'), FILTER_DEFAULTS.minSqft);
        if (params.has('maxSqft')) filterState.maxSqft = parseIntOr(params.get('maxSqft'), FILTER_DEFAULTS.maxSqft);
        if (params.has('maxHoa')) filterState.maxHoa = parseIntOr(params.get('maxHoa'), FILTER_DEFAULTS.maxHoa);
        if (params.has('minLot')) filterState.minLot = parseIntOr(params.get('minLot'), FILTER_DEFAULTS.minLot);
        if (params.has('minYear')) filterState.minYear = parseIntOr(params.get('minYear'), 0);
        if (params.has('favorites')) filterState.favoritesOnly = params.get('favorites') === '1';
        if (params.has('fiber')) filterState.fiberOnly = params.get('fiber') === '1';
        if (params.has('broadband')) filterState.broadbandType = params.get('broadband');
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
        hoaDisplay.textContent = filterState.maxHoa >= FILTER_DEFAULTS.maxHoa ? 'No Limit' : (filterState.maxHoa === 0 ? '$0/mo (known dues only)' : `≤ $${filterState.maxHoa}/mo`);
        lotSlider.value = filterState.minLot;
        lotDisplay.textContent = filterState.minLot <= 0 ? 'Any Lot' : `${filterState.minLot.toLocaleString()}+ sqft`;
        yearSelect.value = String(filterState.minYear || 0);
        filterFavoritesToggle.checked = filterState.favoritesOnly;
        if (filterFiberToggle) filterFiberToggle.checked = filterState.fiberOnly || (filterState.broadbandType === 'fiber');
        if (broadbandFilter) broadbandFilter.value = filterState.broadbandType || (filterState.fiberOnly ? 'fiber' : 'all');
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
    // Top Value Deals & Excellent Finds Workstation View
    // -------------------------------------------------------------------------
    let currentDealCityFilter = 'all';

    function renderDealsView(cityFilter = currentDealCityFilter) {
        currentDealCityFilter = cityFilter;
        if (!dealsEvaluationGrid) return;

        // Filter properties based on current global filters + deal city filter
        let candidates = filteredProperties.length ? filteredProperties : allProperties;
        if (cityFilter !== 'all') {
            const filterLower = cityFilter.toLowerCase();
            if (filterLower === 'tri-cities') {
                const triCities = new Set(['kennewick', 'pasco', 'richland']);
                candidates = candidates.filter(p => triCities.has((p.city || '').toLowerCase()));
            } else {
                candidates = candidates.filter(p => (p.city || '').toLowerCase() === filterLower);
            }
        }

        // Evaluate all candidates
        const evaluated = candidates.map(p => ({
            property: p,
            eval: computeExecutiveDealEvaluation(p)
        }));

        // Sort by dealScore descending
        evaluated.sort((a, b) => b.eval.dealScore - a.eval.dealScore);

        // Limit to top 24 best deals
        const topDeals = evaluated.slice(0, 24);

        // Calculate Summary Stats
        if (dealsTotalCount) dealsTotalCount.textContent = topDeals.length;
        if (topDeals.length > 0) {
            const avgDiscount = Math.round(topDeals.reduce((sum, d) => sum + Math.max(0, d.eval.ppsqftPct), 0) / topDeals.length);
            const avgSavings = Math.round(topDeals.reduce((sum, d) => sum + Math.max(0, d.eval.estDollarSavings), 0) / topDeals.length);
            if (dealsAvgDiscount) dealsAvgDiscount.textContent = `${avgDiscount}%`;
            if (dealsAvgDollarSavings) dealsAvgDollarSavings.textContent = `~$${avgSavings.toLocaleString()}`;
            
            const cityCounts = {};
            topDeals.forEach(d => {
                const c = d.property.city;
                cityCounts[c] = (cityCounts[c] || 0) + 1;
            });
            const topC = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0];
            if (dealsTopCity && topC) dealsTopCity.textContent = `${topC[0]} (${topC[1]} deals)`;
        } else {
            if (dealsAvgDiscount) dealsAvgDiscount.textContent = '0%';
            if (dealsAvgDollarSavings) dealsAvgDollarSavings.textContent = '$0';
            if (dealsTopCity) dealsTopCity.textContent = 'None';
        }

        // Render Cards Grid
        dealsEvaluationGrid.innerHTML = '';
        const fragment = document.createDocumentFragment();

        topDeals.forEach((item, index) => {
            const p = item.property;
            const ev = item.eval;
            const primaryPhoto = safeUrl((p.photos && p.photos.length) ? thumbUrl(p.photos[0], 600) : PHOTO_PLACEHOLDER);
            const estMonthly = calculateEstimatedMonthly(p.price, p.hoa);
            const hoaKnown = hasListingMetric(p, 'hoa');
            const safeAddr = escapeHtml(p.address);
            const safeCity = escapeHtml(p.city);
            const safeZip = escapeHtml(p.zip || '');
            const safeId = escapeHtml(p.id);

            const card = document.createElement('div');
            card.className = 'deal-eval-card-item';
            card.innerHTML = `
                <div class="deal-card-top">
                    <div class="deal-thumb-box">
                        <img src="${primaryPhoto}" alt="${safeAddr}" loading="lazy" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'">
                        <span class="deal-rank-badge">#${index + 1} TOP VALUE</span>
                    </div>
                    <div class="deal-top-info">
                        <div class="deal-price-line">
                            <span class="deal-card-price mono">$${p.price.toLocaleString()}</span>
                            <span class="deal-card-monthly mono">~$${estMonthly.total.toLocaleString()}/mo${hoaKnown ? '' : '*'}</span>
                        </div>
                        <span class="deal-card-addr" title="${safeAddr}">${safeAddr}</span>
                        <span class="deal-card-sub">${safeCity}, WA ${safeZip}</span>
                        <a class="listing-source-link" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="View ${safeAddr} on Realtor.com (opens in a new tab)">View home on Realtor.com ↗</a>
                        <div class="deal-card-specs-row mono">
                            <span>${listingMetric(p, 'beds')}b / ${listingMetric(p, 'baths')}ba</span>
                            <span>•</span>
                            <span>${p.sqft.toLocaleString()} sqft</span>
                            <span>•</span>
                            <span>${listingMetric(p, 'garage', ' Car')}</span>
                        </div>
                    </div>
                </div>

                <div class="deal-card-body">
                    <div class="deal-verdict-banner">
                        <div class="deal-verdict-title">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 2 18 2 22 8 12 22 2 8 6 2"></polygon></svg>
                            <span>${escapeHtml(ev.gradeLabel)}</span>
                        </div>
                        <span class="deal-score-pill mono">Deal Score: ${ev.dealScore}/100</span>
                    </div>

                    <div class="deal-savings-highlight-row">
                        <div class="savings-block">
                            <span class="savings-label">$/SqFt vs ${safeCity} Median</span>
                            <span class="savings-val mono">${ev.ppsqftPct > 0 ? '↓ ' + ev.ppsqftPct + '% below median' : 'At median'} ($${ev.ppsqft}/sf)</span>
                        </div>
                        <div class="savings-block">
                            <span class="savings-label">Gap at City Median $/SqFt</span>
                            <span class="savings-val mono">${ev.estDollarSavings > 0 ? '+$' + ev.estDollarSavings.toLocaleString() + ' Value' : 'Parity'}</span>
                        </div>
                    </div>

                    <div class="deal-factor-bars-list">
                        <div class="deal-bar-row">
                            <div class="deal-bar-labels">
                                <span>$/SqFt Advantage ($${ev.ppsqft}/sf vs $${ev.cityMedPpsqft}/sf)</span>
                                <span class="mono">${ev.factors.price.score}/100</span>
                            </div>
                            <div class="deal-bar-track">
                                <div class="deal-bar-fill" style="width: ${ev.factors.price.score}%"></div>
                            </div>
                        </div>
                        <div class="deal-bar-row">
                            <div class="deal-bar-labels">
                                <span>Lot &amp; Land Value (${hasListingMetric(p, 'lot_sqft') ? `${ev.acres.toFixed(2)} Ac / ${p.lot_sqft.toLocaleString()} sf` : 'Unknown lot size'})</span>
                                <span class="mono">${ev.factors.lot.score}/100</span>
                            </div>
                            <div class="deal-bar-track">
                                <div class="deal-bar-fill" style="width: ${ev.factors.lot.score}%"></div>
                            </div>
                        </div>
                        <div class="deal-bar-row">
                            <div class="deal-bar-labels">
                                <span>Carrying Cost Savings (${listingHoa(p)})</span>
                                <span class="mono">${ev.factors.hoa.score}/100</span>
                            </div>
                            <div class="deal-bar-track">
                                <div class="deal-bar-fill" style="width: ${ev.factors.hoa.score}%"></div>
                            </div>
                        </div>
                    </div>

                    <p class="deal-narrative-text">${escapeHtml(ev.narrative)}</p>
                    ${getNearbyBroadband(p) ? `<p class="deal-narrative-text"><strong>${escapeHtml(getCardBroadbandSummary(p).badgeText)}:</strong> ${escapeHtml(getCardBroadbandSummary(p).providersText)} · ${escapeHtml(getCardBroadbandSummary(p).speedText)}. Address unverified.</p>` : ''}
                </div>

                <div class="deal-card-footer">
                    <label class="compare-checkbox-label">
                        <input type="checkbox" class="compare-check" data-id="${safeId}" ${comparisonSet.has(p.id) ? 'checked' : ''}>
                        <span>Compare</span>
                    </label>
                    <button class="btn btn-primary btn-sm deal-open-drawer-btn" data-id="${safeId}">
                        Full Evaluation &rarr;
                    </button>
                </div>
            `;

            card.querySelector('.deal-open-drawer-btn').addEventListener('click', () => {
                openPropertyDrawer(p.id);
            });

            card.querySelector('.compare-check').addEventListener('change', (e) => {
                toggleComparison(p.id, e.target.checked, e.target);
            });

            fragment.appendChild(card);
        });

        dealsEvaluationGrid.appendChild(fragment);
    }

    // -------------------------------------------------------------------------
    // Mobile Off-Canvas Drawer Control
    // -------------------------------------------------------------------------
    // A deliberately narrow collection of clues, audited against the saved
    // descriptions. Generic marketing adjectives and numerical outliers do not
    // qualify. Keep community facilities explicit and retain source evidence.
    function classifyOddFind(property) {
        const description = String(property.description || '');
        const rules = [
            { key: 'shelter', label: 'Bomb shelter', title: 'The downstairs plot twist.', pattern: /\bbomb shelter downstairs\b/i },
            { key: 'silo', label: 'Silo entertaining area', title: 'Dinner at the silo?', pattern: /\ba unique silo entertaining area\b/i },
            { key: 'church', label: 'Church / meeting hall', title: 'Yes, it’s a church.', pattern: /\blong used as a church and meeting hall\b/i, note: 'Residential conversion and occupancy require City approval and buyer verification, per the listing.' },
            { key: 'speakeasy', label: 'Hidden speakeasy', title: 'Your house has a secret nightlife.', pattern: /\bhidden speakeasy lounge\b/i },
            { key: 'hidden-room', label: 'Hidden room', title: 'There’s another room. Somewhere.', pattern: /\bwall safes and a hidden room\b/i },
            { key: 'pool-room', label: 'Enclosed pool room', title: 'The pool gets its own room.', pattern: /\bpermitted [\d,]+ sq ft enclosed pool room\b/i },
            { key: 'treehouse', label: 'Backyard treehouse', title: 'The backyard has an upstairs.', pattern: /\b(?:magical|charming) treehouse\b/i },
            { key: 'climbing', label: 'Climbing wall', title: 'Permission to climb the walls.', pattern: /\bbasketball hoop, and climbing wall\b/i },
            { key: 'a-frame', label: 'A-frame architecture', title: 'A roof with main-character energy.', pattern: /\ba[- ]frame(?:-style)?\s+(?:home|retreat|cabin)\b/i },
            { key: 'airstrip', label: 'Community airstrip', title: 'The neighbors have a runway.', pattern: /\bcommunity(?:-owned)?\b[^.!?]{0,45}\bairstrip\b|\bairstrip within the community\b/i, note: 'The airstrip is a community feature. Verify access and rules.' },
            { key: 'island', label: 'Hat Island ferry access', title: 'Getting home includes a boat.', pattern: /\b(?:private|passenger|foot|Hat Island)\b[^.!?]{0,65}\bferry\b/i, islandOnly: true, note: 'Verify ferry access, schedules, dues and year-round logistics.' },
        ];
        for (const rule of rules) {
            if (rule.islandOnly && property.city !== 'Hat Island' && !/\bon private Hat Island\b/i.test(description)) continue;
            const match = rule.pattern.exec(description);
            if (!match) continue;
            if (/\b(?:could|potential|future|build|imagine|room for|space for)\b[^.!?]{0,65}$/i.test(description.slice(Math.max(0, match.index - 90), match.index))) continue;
            // Quote the sentence containing the actual clue, with enough local
            // context for inspection. Trim long marketing sentences on both ends.
            const before = description.slice(0, match.index);
            const sentenceStart = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '));
            let start = Math.max(sentenceStart < 0 ? 0 : sentenceStart + 2, match.index - 90);
            if (start > 0 && start !== sentenceStart + 2) {
                const wordStart = description.indexOf(' ', start);
                if (wordStart >= 0 && wordStart < match.index) start = wordStart + 1;
            }
            const after = description.slice(match.index + match[0].length);
            const stop = after.search(/[.!?](?:\s|$)/);
            let end = Math.min(description.length, match.index + match[0].length + (stop < 0 ? after.length : stop + 1), match.index + match[0].length + 180);
            if (end < description.length && !/[.!?]$/.test(description.slice(0, end))) {
                const wordEnd = description.lastIndexOf(' ', end);
                if (wordEnd > match.index + match[0].length) end = wordEnd;
            }
            return { key: rule.key, label: rule.label, title: rule.title, note: rule.note || '', evidence: description.slice(start, end).trim(), leadingTrim: start > 0 && start !== sentenceStart + 2, trailingTrim: end < description.length && !/[.!?]$/.test(description.slice(0, end)) };
        }
        return null;
    }

    function selectOddFinds(properties) {
        const counts = new Map();
        const finds = [];
        for (const property of properties) {
            const cached = oddFindsCache.get(property.id);
            const feature = cached && cached.description === property.description && cached.city === property.city
                ? cached.feature : classifyOddFind(property);
            if (!cached || cached.description !== property.description || cached.city !== property.city) oddFindsCache.set(property.id, { description: property.description, city: property.city, feature });
            if (!feature || (counts.get(feature.key) || 0) >= 3) continue;
            counts.set(feature.key, (counts.get(feature.key) || 0) + 1);
            finds.push({ property, feature });
        }
        return finds;
    }

    function renderOddFinds() {
        currentOddFinds = selectOddFinds(filteredProperties);
        oddFindsCount.textContent = `${currentOddFinds.length} odd find${currentOddFinds.length === 1 ? '' : 's'} in your results`;
        oddFindsEmpty.classList.toggle('hidden', currentOddFinds.length > 0);
        btnOddSurprise.disabled = currentOddFinds.length === 0;
        oddFindsGrid.replaceChildren();
        const fragment = document.createDocumentFragment();
        currentOddFinds.forEach(({ property: p, feature }) => {
            const card = document.createElement('article');
            card.className = 'odd-find-card';
            const address = escapeHtml(p.address);
            const photo = safeUrl(thumbUrl(p.photos?.[0] || PHOTO_PLACEHOLDER, 600));
            const monthly = calculateEstimatedMonthly(p.price, p.hoa);
            card.innerHTML = `
                <div class="odd-photo"><img src="${photo}" alt="${address}" loading="lazy" decoding="async" width="600" height="400" onerror="this.onerror=null;this.src='${PHOTO_PLACEHOLDER}'"><span class="odd-feature-label">${escapeHtml(feature.label)}</span></div>
                <div class="odd-card-body">
                    <h3>${escapeHtml(feature.title)}</h3>
                    <div class="odd-price mono">$${p.price.toLocaleString()} <span>$${Math.round(p.price / Math.max(1, p.sqft)).toLocaleString()}/sqft</span></div>
                    <p class="odd-monthly mono">Est. $${monthly.total.toLocaleString()}/mo${hasListingMetric(p, 'hoa') ? '' : '*'}</p>
                    <p class="odd-address"><strong>${address}</strong><br>${escapeHtml(p.city)}, WA ${escapeHtml(p.zip || '')}</p>
                    <a class="listing-source-link" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer" aria-label="View ${address} on Realtor.com (opens in a new tab)">View home on Realtor.com ↗</a>
                    <p class="odd-specs">${listingMetric(p, 'beds')} beds · ${listingMetric(p, 'baths')} baths · ${listingMetric(p, 'sqft')} sqft · Built ${listingMetric(p, 'year_built')}<br>${hasListingMetric(p, 'lot_sqft') ? `${(p.lot_sqft / 43560).toFixed(2)} ac lot` : 'Lot unknown'} · ${hasListingMetric(p, 'garage') ? listingMetric(p, 'garage', '-car garage') : 'Garage unknown'} · ${listingHoa(p)}</p>
                    <div class="odd-evidence"><span>From the listing</span><blockquote>“${feature.leadingTrim ? '…' : ''}${escapeHtml(feature.evidence)}${feature.trailingTrim ? '…' : ''}”</blockquote></div>
                    ${feature.note ? `<p class="odd-feature-note">${escapeHtml(feature.note)}</p>` : ''}
                    <div class="odd-card-actions"><label class="compare-checkbox-label"><input type="checkbox" class="compare-check" data-id="${escapeHtml(p.id)}" ${comparisonSet.has(p.id) ? 'checked' : ''}><span>Compare</span></label><button class="btn btn-secondary btn-sm odd-open-details">Take a look ↗</button></div>
                </div>`;
            card.querySelector('.odd-open-details').addEventListener('click', () => openPropertyDrawer(p.id));
            const checkbox = card.querySelector('input');
            checkbox.setAttribute('aria-label', `Compare ${p.address}`);
            checkbox.addEventListener('change', () => toggleComparison(p.id, checkbox.checked, checkbox));
            fragment.appendChild(card);
        });
        oddFindsGrid.appendChild(fragment);
    }

    function openMobileSidebar() {
        if (appSidebar) {
            appSidebar.inert = false;
            appSidebar.classList.add('mobile-open');
            btnMobileSidebarClose?.focus();
        }
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
    }

    function closeMobileSidebar() {
        if (appSidebar) {
            const mobile = window.matchMedia('(max-width: 768px)').matches;
            if (mobile && appSidebar.contains(document.activeElement)) btnMobileFilters?.focus();
            appSidebar.classList.remove('mobile-open');
            appSidebar.inert = mobile;
        }
        if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
    }

    // -------------------------------------------------------------------------
    // View Switcher
    // -------------------------------------------------------------------------
    function setViewMode(mode) {
        if (!['split', 'grid', 'map', 'deals', 'analytics', 'odd'].includes(mode)) return;
        activeView = mode;
        // Hidden map bounds must not silently restrict a listings-only search.
        const clearMapBounds = !isMapVisible() && filterState.mapBoundsOnly;
        if (clearMapBounds) {
            clearTimeout(mapBoundsDebounceTimer);
            filterState.mapBoundsOnly = false;
            if (mapBoundsFilterToggle) mapBoundsFilterToggle.checked = false;
        }
        [viewTabSplit, viewTabGrid, viewTabMap, viewTabDeals, viewTabAnalytics, viewTabOdd].filter(Boolean).forEach(btn => {
            const isActive = btn.dataset.view === mode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        });
        workspaceViewport.className = `workspace-viewport view-${mode}`;

        if (mode === 'split' && viewTabSplit) viewTabSplit.classList.add('active');
        if (mode === 'grid' && viewTabGrid) viewTabGrid.classList.add('active');
        if (mode === 'map' && viewTabMap) viewTabMap.classList.add('active');
        if (mode === 'deals' && viewTabDeals) {
            viewTabDeals.classList.add('active');
            renderDealsView();
        }
        if (mode === 'analytics' && viewTabAnalytics) {
            viewTabAnalytics.classList.add('active');
            renderAnalytics();
        }
        if (mode === 'odd') renderOddFinds();

        // Sync Mobile Bottom Navigation Tabs
        const mobButtons = [
            { id: 'split', el: mobNavSplit },
            { id: 'grid', el: mobNavGrid },
            { id: 'map', el: mobNavMap },
            { id: 'deals', el: mobNavDeals },
            { id: 'analytics', el: mobNavAnalytics },
            { id: 'odd', el: mobNavOdd }
        ];
        mobButtons.forEach(b => {
            if (b.el) b.el.classList.toggle('active', b.id === mode);
        });

        if (isMapVisible()) {
            initMap();
            if (map) requestAnimationFrame(() => map.invalidateSize({ pan: false }));
            // Flush marker updates that were skipped while the map was hidden.
            if (mapMarkersDirty) {
                mapMarkersDirty = false;
                updateMapMarkers(filteredProperties);
            }
        }

        if (clearMapBounds) applyFilters();
        syncStateToUrl();
    }

    function setupMapResize() {
        const divider = document.getElementById('map-resize-handle');
        const mapPanel = document.getElementById('map-container-wrapper');
        const stacked = window.matchMedia('(max-width: 768px)');
        let dragPointer = null;
        let resizeFrame = null;
        let listingShare = 60;
        const updateShare = (value) => {
            listingShare = Math.max(30, Math.min(75, value));
            workspaceViewport.style.setProperty('--listing-share', `${listingShare}%`);
            divider.setAttribute('aria-valuenow', String(Math.round(listingShare)));
            divider.setAttribute('aria-valuetext', `Listings ${Math.round(listingShare)}%, map ${100 - Math.round(listingShare)}%`);
        };
        const updateOrientation = () => divider.setAttribute('aria-orientation', stacked.matches ? 'horizontal' : 'vertical');
        updateOrientation();
        stacked.addEventListener('change', updateOrientation);
        divider.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || activeView !== 'split') return;
            event.preventDefault();
            divider.focus();
            dragPointer = event.pointerId;
            divider.setPointerCapture(dragPointer);
            workspaceViewport.classList.add('resizing-map');
        });
        divider.addEventListener('pointermove', (event) => {
            if (event.pointerId !== dragPointer) return;
            const bounds = workspaceViewport.getBoundingClientRect();
            const position = stacked.matches ? event.clientY - bounds.top : event.clientX - bounds.left;
            const size = stacked.matches ? bounds.height : bounds.width;
            if (size > 0) updateShare(position / size * 100);
        });
        const stopDrag = () => {
            dragPointer = null;
            workspaceViewport.classList.remove('resizing-map');
        };
        divider.addEventListener('pointerup', stopDrag);
        divider.addEventListener('pointercancel', stopDrag);
        divider.addEventListener('lostpointercapture', stopDrag);
        divider.addEventListener('keydown', (event) => {
            const decrease = stacked.matches ? 'ArrowUp' : 'ArrowLeft';
            const increase = stacked.matches ? 'ArrowDown' : 'ArrowRight';
            if (![decrease, increase, 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            updateShare(event.key === 'Home' ? 30 : event.key === 'End' ? 75 : listingShare + (event.key === increase ? 5 : -5));
        });
        // Leaflet needs its viewport updated when the divider changes either pane.
        new ResizeObserver(() => {
            if (!map || !isMapVisible() || resizeFrame !== null) return;
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                map.invalidateSize({ pan: false });
            });
        }).observe(mapPanel);
    }

    // -------------------------------------------------------------------------
    // Reset Filters
    // -------------------------------------------------------------------------
    function resetAllFilters() {
        Object.assign(filterState, FILTER_DEFAULTS);

        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        citySelect.value = 'all';
        priceMinSlider.value = FILTER_DEFAULTS.minPrice;
        priceMaxSlider.value = FILTER_DEFAULTS.maxPrice;
        priceRangeDisplay.textContent = '$200k – $750k';
        sqftMinSlider.value = FILTER_DEFAULTS.minSqft;
        sqftMaxSlider.value = FILTER_DEFAULTS.maxSqft;
        sqftRangeDisplay.textContent = '0 – 6,000 sqft';
        hoaSlider.value = FILTER_DEFAULTS.maxHoa;
        hoaDisplay.textContent = 'No Limit';
        lotSlider.value = FILTER_DEFAULTS.minLot;
        lotDisplay.textContent = 'Any Lot';
        yearSelect.value = '0';
        maxPpsqftSlider.value = FILTER_DEFAULTS.maxPpsqft;
        maxPpsqftDisplay.textContent = 'No Limit';
        ratingFilter.value = '0';
        filterFavoritesToggle.checked = false;
        if (filterFiberToggle) filterFiberToggle.checked = false;
        if (broadbandFilter) broadbandFilter.value = 'all';
        if (mapBoundsFilterToggle) mapBoundsFilterToggle.checked = false;
        sortDropdown.value = 'smart_score';
        activePresetLabel.textContent = 'Saved searches';

        bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-beds') === '0'));
        bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-baths') === '0'));
        garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === '0'));

        applyFilters();
        showToast("Filters reset to default.");
    }

    // -------------------------------------------------------------------------
    // Instant Client-Side CSV Export (Works 100% on GitHub Pages & Localhost)
    // -------------------------------------------------------------------------
    function sanitizeCsvText(val) {
        let s = String(val ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ');
        if (/^[=+\-@\t\r]/.test(s)) {
            s = `'${s}`;
        }
        return `"${s}"`;
    }

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

            rows.push([
                sanitizeCsvText(p.id),
                sanitizeCsvText(p.address),
                sanitizeCsvText(p.city),
                sanitizeCsvText(p.state),
                sanitizeCsvText(p.zip || ''),
                p.price,
                hasListingMetric(p, 'beds') ? p.beds : '',
                hasListingMetric(p, 'baths') ? p.baths : '',
                p.sqft,
                hasListingMetric(p, 'lot_sqft') ? p.lot_sqft : '',
                hasListingMetric(p, 'lot_sqft') ? acres : '',
                ppsqft,
                hasListingMetric(p, 'year_built') ? p.year_built : '',
                hasListingMetric(p, 'hoa') ? p.hoa : '',
                hasListingMetric(p, 'garage') ? p.garage : '',
                p.rating || 0,
                p.favorite ? "Yes" : "No",
                sanitizeCsvText(p.user_notes || ''),
                p.latitude || '',
                p.longitude || '',
                sanitizeCsvText(p.url || '')
            ]);
        });

        const csvContent = '\ufeff' + rows.map(r => r.join(',')).join('\n');
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
        if (!scraperModal) {
            showToast("Live scraper controls are unavailable in this build.", "error");
            return;
        }

        if (!scraperAvailable) {
            if (btnStartLiveScrape) btnStartLiveScrape.disabled = true;
            if (scraperStatusText) scraperStatusText.textContent = "Python backend required for live scans";
            if (scraperPctText) scraperPctText.textContent = "STATIC";
            if (scraperTerminal) {
                scraperTerminal.innerHTML = `
                    <div class="term-line info">&gt; GitHub Pages is serving a historical listing snapshot; verify availability at the source.</div>
                    <div class="term-line">&gt; Automated refresh requires express written permission from the data provider.</div>
                `;
            }
        } else if (btnStartLiveScrape) {
            btnStartLiveScrape.disabled = false;
        }

        scraperModal.classList.remove('hidden');
    }

    async function startLiveScrapingJob() {
        if (!scraperAvailable) {
            openScraperModal();
            return;
        }

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
            scraperTerminal.innerHTML += `<div class="term-line info">&gt; Live refresh requires permission from the data provider. Currently displaying ${allProperties.length} saved listings; verify current availability.</div>`;
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
                        return `<div class="${cls}">&gt; ${escapeHtml(line)}</div>`;
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
    function setupDialogFocus() {
        const layers = [...document.querySelectorAll('.modal-backdrop'), propertyDetailDrawer, appSidebar];
        const opened = [];
        const returnFocus = new WeakMap();
        const focusables = layer => [...layer.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
            .filter(el => !el.disabled && el.getClientRects().length);
        const observer = new MutationObserver(records => {
            for (const { target } of records) {
                const index = opened.indexOf(target);
                const visible = target === appSidebar ? target.classList.contains('mobile-open')
                    && window.matchMedia('(max-width: 768px)').matches : !target.classList.contains('hidden');
                if (visible && index < 0) {
                    returnFocus.set(target, document.activeElement);
                    opened.push(target);
                    if (!target.contains(document.activeElement)) (focusables(target)[0] || target).focus();
                } else if (!visible && index >= 0) {
                    opened.splice(index, 1);
                    const previous = returnFocus.get(target);
                    if (previous?.isConnected && previous.getClientRects().length) previous.focus();
                }
            }
        });
        layers.filter(Boolean).forEach(layer => observer.observe(layer, { attributes: true, attributeFilter: ['class'] }));
        document.addEventListener('keydown', event => {
            const top = opened.at(-1);
            if (!top) return;
            if (event.key === 'Tab') {
                const items = focusables(top);
                if (!items.length) return;
                if (!top.contains(document.activeElement) || (event.shiftKey && document.activeElement === items[0])
                    || (!event.shiftKey && document.activeElement === items.at(-1))) {
                    event.preventDefault();
                    (event.shiftKey ? items.at(-1) : items[0]).focus();
                }
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (top === propertyDetailDrawer) closePropertyDrawer();
                else if (top === appSidebar) closeMobileSidebar();
                else if (top === cmdPaletteModal) closeCommandPalette();
                else top.classList.add('hidden');
            }
        }, true);
    }

    function setupEventListeners() {
        // Search Input
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const val = e.target.value;
                filterState.search = val;
                if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !val);

                clearTimeout(searchDebounceTimer);
                searchDebounceTimer = setTimeout(applyFilters, 150);
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                filterState.search = '';
                clearSearchBtn.classList.add('hidden');
                applyFilters();
            });
        }

        // City Selector
        if (citySelect) {
            citySelect.addEventListener('change', (e) => {
                filterState.city = e.target.value;
                applyFilters();
            });
        }

        let sliderDebounceTimer = null;
        function triggerFilterDebounced(delay = 40) {
            clearTimeout(sliderDebounceTimer);
            sliderDebounceTimer = setTimeout(() => {
                applyFilters();
            }, delay);
        }

        // Price Dual Sliders
        if (priceMinSlider) {
            priceMinSlider.addEventListener('input', () => {
                let min = parseInt(priceMinSlider.value, 10);
                let max = parseInt(priceMaxSlider.value, 10);
                if (min > max - 10000) {
                    min = max - 10000;
                    priceMinSlider.value = min;
                }
                filterState.minPrice = min;
                if (priceRangeDisplay) priceRangeDisplay.textContent = `$${Math.round(min/1000)}k – $${Math.round(max/1000)}k`;
                priceMinSlider.style.zIndex = min > 500000 ? '3' : '2';
                updateDualRangeTracks();
                triggerFilterDebounced(40);
            });
            priceMinSlider.addEventListener('change', applyFilters);
        }

        if (priceMaxSlider) {
            priceMaxSlider.addEventListener('input', () => {
                let min = parseInt(priceMinSlider.value, 10);
                let max = parseInt(priceMaxSlider.value, 10);
                if (max < min + 10000) {
                    max = min + 10000;
                    priceMaxSlider.value = max;
                }
                filterState.maxPrice = max;
                if (priceRangeDisplay) priceRangeDisplay.textContent = `$${Math.round(min/1000)}k – $${Math.round(max/1000)}k`;
                priceMinSlider.style.zIndex = min > 500000 ? '3' : '2';
                updateDualRangeTracks();
                triggerFilterDebounced(40);
            });
            priceMaxSlider.addEventListener('change', applyFilters);
        }

        // SqFt Dual Sliders
        if (sqftMinSlider) {
            sqftMinSlider.addEventListener('input', () => {
                let min = parseInt(sqftMinSlider.value, 10);
                let max = parseInt(sqftMaxSlider.value, 10);
                if (min > max - 100) {
                    min = max - 100;
                    sqftMinSlider.value = min;
                }
                filterState.minSqft = min;
                if (sqftRangeDisplay) sqftRangeDisplay.textContent = `${min.toLocaleString()} – ${max.toLocaleString()} sqft`;
                sqftMinSlider.style.zIndex = min > 2400 ? '3' : '2';
                updateDualRangeTracks();
                triggerFilterDebounced(40);
            });
            sqftMinSlider.addEventListener('change', applyFilters);
        }

        if (sqftMaxSlider) {
            sqftMaxSlider.addEventListener('input', () => {
                let min = parseInt(sqftMinSlider.value, 10);
                let max = parseInt(sqftMaxSlider.value, 10);
                if (max < min + 100) {
                    max = min + 100;
                    sqftMaxSlider.value = max;
                }
                filterState.maxSqft = max;
                if (sqftRangeDisplay) sqftRangeDisplay.textContent = `${min.toLocaleString()} – ${max.toLocaleString()} sqft`;
                sqftMinSlider.style.zIndex = min > 2400 ? '3' : '2';
                updateDualRangeTracks();
                triggerFilterDebounced(40);
            });
            sqftMaxSlider.addEventListener('change', applyFilters);
        }

        // Bedrooms Pills
        if (bedsPillGroup) {
            bedsPillGroup.querySelectorAll('.pill-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    filterState.minBeds = parseInt(btn.getAttribute('data-beds'), 10);
                    applyFilters();
                });
            });
        }

        // Bathrooms Pills
        if (bathsPillGroup) {
            bathsPillGroup.querySelectorAll('.pill-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    filterState.minBaths = parseFloat(btn.getAttribute('data-baths'));
                    applyFilters();
                });
            });
        }

        // Garage Pills
        if (garagePillGroup) {
            garagePillGroup.querySelectorAll('.pill-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    filterState.minGarage = parseInt(btn.getAttribute('data-garage'), 10);
                    applyFilters();
                });
            });
        }

        // HOA Slider
        if (hoaSlider) {
            hoaSlider.addEventListener('input', () => {
                const val = parseInt(hoaSlider.value, 10);
                filterState.maxHoa = val;
                if (hoaDisplay) hoaDisplay.textContent = val >= FILTER_DEFAULTS.maxHoa ? 'No Limit' : (val === 0 ? '$0/mo (known dues only)' : `≤ $${val}/mo`);
                triggerFilterDebounced(40);
            });
            hoaSlider.addEventListener('change', applyFilters);
        }

        // Advanced Accordion Toggle
        if (btnToggleAdvanced && advancedFiltersBody) {
            btnToggleAdvanced.addEventListener('click', () => {
                const isHidden = advancedFiltersBody.classList.contains('hidden');
                advancedFiltersBody.classList.toggle('hidden', !isHidden);
                btnToggleAdvanced.setAttribute('aria-expanded', String(isHidden));
            });
        }

        // Advanced: Lot Slider
        if (lotSlider) {
            lotSlider.addEventListener('input', () => {
                const val = parseInt(lotSlider.value, 10);
                filterState.minLot = val;
                if (lotDisplay) lotDisplay.textContent = val <= 0 ? 'Any Lot' : `${val.toLocaleString()}+ sqft`;
                triggerFilterDebounced(40);
            });
            lotSlider.addEventListener('change', applyFilters);
        }

        // Advanced: Year Select
        if (yearSelect) {
            yearSelect.addEventListener('change', (e) => {
                filterState.minYear = parseInt(e.target.value, 10);
                applyFilters();
            });
        }

        // Advanced: Max $/sqft Slider
        if (maxPpsqftSlider) {
            maxPpsqftSlider.addEventListener('input', () => {
                const val = parseInt(maxPpsqftSlider.value, 10);
                filterState.maxPpsqft = val;
                if (maxPpsqftDisplay) maxPpsqftDisplay.textContent = val >= 500 ? 'No Limit' : `≤ $${val}/sqft`;
                triggerFilterDebounced(40);
            });
            maxPpsqftSlider.addEventListener('change', applyFilters);
        }

        // Advanced: Star Rating Filter
        if (ratingFilter) {
            ratingFilter.addEventListener('change', (e) => {
                filterState.minRating = parseInt(e.target.value, 10);
                applyFilters();
            });
        }

        // Shortlist Filter Toggle
        if (filterFavoritesToggle) {
            filterFavoritesToggle.addEventListener('change', (e) => {
                filterState.favoritesOnly = e.target.checked;
                applyFilters();
            });
        }
        if (favoritesBadgeBtn && filterFavoritesToggle) {
            favoritesBadgeBtn.addEventListener('click', () => {
                filterFavoritesToggle.checked = !filterFavoritesToggle.checked;
                filterState.favoritesOnly = filterFavoritesToggle.checked;
                applyFilters();
            });
        }

        // Fiber Footprint Filter Toggle & Broadband Dropdown
        if (filterFiberToggle) {
            filterFiberToggle.addEventListener('change', (e) => {
                filterState.fiberOnly = e.target.checked;
                if (broadbandFilter) {
                    broadbandFilter.value = e.target.checked ? 'fiber' : 'all';
                }
                filterState.broadbandType = e.target.checked ? 'fiber' : 'all';
                applyFilters();
            });
        }
        if (broadbandFilter) {
            broadbandFilter.addEventListener('change', (e) => {
                filterState.broadbandType = e.target.value;
                filterState.fiberOnly = (e.target.value === 'fiber');
                if (filterFiberToggle) {
                    filterFiberToggle.checked = (e.target.value === 'fiber');
                }
                applyFilters();
            });
        }

        // Sort Dropdown
        if (sortDropdown) {
            sortDropdown.addEventListener('change', (e) => {
                filterState.sortBy = e.target.value;
                applyFilters();
            });
        }

        // Reset Filter Buttons
        if (btnResetFilters) btnResetFilters.addEventListener('click', resetAllFilters);
        if (btnEmptyReset) btnEmptyReset.addEventListener('click', resetAllFilters);

        // Preset Menu
        if (btnPresetsMenu && presetDropdownMenu) {
            btnPresetsMenu.addEventListener('click', (e) => {
                e.stopPropagation();
                setPresetMenuOpen(presetDropdownMenu.classList.contains('hidden'));
            });
            document.addEventListener('click', (e) => {
                if (!presetDropdownMenu.contains(e.target)) setPresetMenuOpen(false);
            });
            window.addEventListener('resize', () => setPresetMenuOpen(false));
            presetDropdownMenu.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    setPresetMenuOpen(false, true);
                } else if (e.target.tagName !== 'INPUT' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                    e.preventDefault();
                    const buttons = [...presetDropdownMenu.querySelectorAll('button')].filter(button => button.getClientRects().length);
                    const index = buttons.indexOf(document.activeElement);
                    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
                        : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                    buttons[next]?.focus();
                } else if (e.key === 'Tab') {
                    setTimeout(() => {
                        if (!presetDropdownMenu.contains(document.activeElement)) setPresetMenuOpen(false);
                    }, 0);
                }
            });

            presetDropdownMenu.querySelectorAll('.dropdown-item[data-preset]').forEach(item => {
                item.addEventListener('click', () => {
                    const presetKey = item.getAttribute('data-preset');
                    setPresetMenuOpen(false, true);

                    switch (presetKey) {
                        case 'all':
                            resetAllFilters();
                            break;
                        case 'best-value':
                            resetAllFilters();
                            filterState.maxPpsqft = 275;
                            if (maxPpsqftSlider) maxPpsqftSlider.value = 275;
                            if (maxPpsqftDisplay) maxPpsqftDisplay.textContent = '≤ $275/sqft';
                            filterState.sortBy = 'price_per_sqft_asc';
                            if (sortDropdown) sortDropdown.value = 'price_per_sqft_asc';
                            applyFilters();
                            break;
                        case 'large-lots':
                            resetAllFilters();
                            filterState.minLot = 8000;
                            if (lotSlider) lotSlider.value = 8000;
                            if (lotDisplay) lotDisplay.textContent = '8,000+ sqft';
                            filterState.sortBy = 'lot_desc';
                            if (sortDropdown) sortDropdown.value = 'lot_desc';
                            applyFilters();
                            break;
                        case 'three-garage':
                            resetAllFilters();
                            filterState.minGarage = 3;
                            if (garagePillGroup) {
                                garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === '3'));
                            }
                            applyFilters();
                            break;
                        case 'low-hoa':
                            resetAllFilters();
                            filterState.maxHoa = 25;
                            if (hoaSlider) hoaSlider.value = 25;
                            if (hoaDisplay) hoaDisplay.textContent = '≤ $25/mo';
                            applyFilters();
                            break;
                        case 'newer-homes':
                            resetAllFilters();
                            filterState.minYear = 2000;
                            if (yearSelect) yearSelect.value = '2000';
                            filterState.sortBy = 'year_desc';
                            if (sortDropdown) sortDropdown.value = 'year_desc';
                            applyFilters();
                            break;
                    }
                    if (activePresetLabel && presetKey !== 'all') activePresetLabel.textContent = item.textContent;
                });
            });
        }

        if (btnSaveCurrentPreset) {
            btnSaveCurrentPreset.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('preset-save-form')?.classList.remove('hidden');
                btnSaveCurrentPreset.classList.add('hidden');
                document.getElementById('preset-name')?.focus();
            });
        }
        document.getElementById('preset-save-form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            saveCurrentPreset();
        });
        document.getElementById('btn-cancel-preset-save')?.addEventListener('click', () => {
            document.getElementById('preset-save-form').classList.add('hidden');
            btnSaveCurrentPreset.classList.remove('hidden');
            btnSaveCurrentPreset.focus();
        });

        // Density Switcher
        document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
        if (btnDensityToggle) btnDensityToggle.addEventListener('click', toggleDensity);

        // Command Palette Trigger & Input
        if (btnOpenCmdPalette) btnOpenCmdPalette.addEventListener('click', openCommandPalette);
        if (cmdPaletteInput) {
            cmdPaletteInput.addEventListener('input', (e) => renderCommandPaletteResults(e.target.value));
            cmdPaletteInput.addEventListener('keydown', (e) => {
                const items = Array.from(cmdPaletteResults.querySelectorAll('.cmd-item'));
                if (!items.length) return;
                let currentIdx = items.findIndex(item => item.classList.contains('selected'));
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (currentIdx >= 0) items[currentIdx].classList.remove('selected');
                    currentIdx = (currentIdx + 1) % items.length;
                    items[currentIdx].classList.add('selected');
                    items[currentIdx].scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (currentIdx >= 0) items[currentIdx].classList.remove('selected');
                    currentIdx = (currentIdx - 1 + items.length) % items.length;
                    items[currentIdx].classList.add('selected');
                    items[currentIdx].scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (currentIdx >= 0 && items[currentIdx]) {
                        items[currentIdx].click();
                    }
                }
            });
        }

        // Smart Scoring Trigger & Weight Sliders
        if (btnOpenScoring) btnOpenScoring.addEventListener('click', openScoringModal);
        if (btnCloseScoring) btnCloseScoring.addEventListener('click', () => scoringModal && scoringModal.classList.add('hidden'));
        ['w-ppsqft', 'w-sqft', 'w-lot', 'w-garage', 'w-year', 'w-hoa', 'w-rating'].forEach(id => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(`${id}-val`);
            if (el && valEl) {
                el.addEventListener('input', () => { valEl.textContent = `${el.value}%`; });
            }
        });
        if (btnSaveWeights) btnSaveWeights.addEventListener('click', saveScoringWeights);
        if (btnResetWeights) {
            btnResetWeights.addEventListener('click', () => {
                scoreWeights = { ppsqft: 30, sqft: 15, lot: 15, garage: 10, year: 10, hoa: 10, rating: 10 };
                openScoringModal();
            });
        }

        // View Tabs
        if (viewTabSplit) viewTabSplit.addEventListener('click', () => setViewMode('split'));
        if (viewTabGrid) viewTabGrid.addEventListener('click', () => setViewMode('grid'));
        if (viewTabMap) viewTabMap.addEventListener('click', () => setViewMode('map'));
        if (viewTabDeals) viewTabDeals.addEventListener('click', () => setViewMode('deals'));
        if (viewTabAnalytics) viewTabAnalytics.addEventListener('click', () => setViewMode('analytics'));
        if (viewTabOdd) viewTabOdd.addEventListener('click', () => setViewMode('odd'));
        btnOddSurprise.addEventListener('click', () => {
            if (!currentOddFinds.length) return;
            const pick = currentOddFinds[Math.floor(Math.random() * currentOddFinds.length)];
            openPropertyDrawer(pick.property.id);
        });
        document.getElementById('btn-odd-reset').addEventListener('click', resetAllFilters);
        document.getElementById('btn-close-map').addEventListener('click', () => {
            setViewMode('grid');
            (window.innerWidth <= 768 ? mobNavSplit : viewTabSplit).focus();
        });

        // Deals Area Filter Pills
        if (dealsFilterPills) {
            dealsFilterPills.querySelectorAll('.deal-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    dealsFilterPills.querySelectorAll('.deal-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const city = btn.getAttribute('data-city') || 'all';
                    renderDealsView(city);
                });
            });
        }

        // Map Overlays
        if (mapBoundsFilterToggle) {
            mapBoundsFilterToggle.addEventListener('change', (e) => {
                filterState.mapBoundsOnly = e.target.checked;
                applyFilters();
            });
        }
        if (btnMapFitResults) btnMapFitResults.addEventListener('click', fitMapToResults);
        if (btnMapResetView) btnMapResetView.addEventListener('click', resetWashingtonView);

        // Drawer Controls
        if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closePropertyDrawer);
        if (drawerBackdrop) drawerBackdrop.addEventListener('click', closePropertyDrawer);
        if (btnDrawerPrev) btnDrawerPrev.addEventListener('click', () => stepDrawerProperty(-1));
        if (btnDrawerNext) btnDrawerNext.addEventListener('click', () => stepDrawerProperty(1));
        if (btnDrawerFavorite) {
            btnDrawerFavorite.addEventListener('click', () => {
                if (selectedPropId) toggleFavorite(selectedPropId);
            });
        }

        // Drawer Photo Navigation
        function stepDrawerPhoto(direction) {
            if (!selectedPropId) return;
            const prop = getPropertyById(selectedPropId);
            if (!prop || !prop.photos || prop.photos.length <= 1) return;
            let photoIdx = activePhotoIndices[prop.id] || 0;
            photoIdx = (photoIdx + direction + prop.photos.length) % prop.photos.length;
            activePhotoIndices[prop.id] = photoIdx;
            if (drawerActiveImg) drawerActiveImg.src = prop.photos[photoIdx];
            if (drawerImgCur) drawerImgCur.textContent = photoIdx + 1;
            if (drawerThumbnailsStrip) {
                drawerThumbnailsStrip.querySelectorAll('.drawer-thumb').forEach((t, i) => {
                    t.classList.toggle('active', i === photoIdx);
                });
            }
            const cardImg = document.getElementById(`img-${prop.id}`);
            const cardCounter = document.getElementById(`counter-${prop.id}`);
            if (cardImg) cardImg.src = prop.photos[photoIdx];
            if (cardCounter) cardCounter.innerHTML = `<span>${photoIdx + 1}/${prop.photos.length}</span>`;
        }

        if (btnDrawerImgPrev) {
            btnDrawerImgPrev.addEventListener('click', () => stepDrawerPhoto(-1));
        }
        if (btnDrawerImgNext) {
            btnDrawerImgNext.addEventListener('click', () => stepDrawerPhoto(1));
        }
        if (btnDrawerFullscreen) {
            btnDrawerFullscreen.addEventListener('click', () => {
                if (selectedPropId) {
                    const idx = activePhotoIndices[selectedPropId] || 0;
                    openPhotoLightbox(selectedPropId, idx);
                }
            });
        }

        // Drawer Star Picker
        if (drawerStarPicker) {
            drawerStarPicker.querySelectorAll('.star-pick').forEach(star => {
                star.addEventListener('click', () => {
                    if (!selectedPropId) return;
                    const val = parseInt(star.getAttribute('data-val'), 10);
                    updatePropertyRating(selectedPropId, val);
                });
            });
        }

        // Drawer Notes
        if (drawerNotesTextarea) drawerNotesTextarea.addEventListener('input', saveDrawerNotesDebounced);

        // Drawer Mortgage Customize Link
        if (btnDrawerCustomizeMortgage) {
            btnDrawerCustomizeMortgage.addEventListener('click', () => {
                if (selectedPropId) openMortgageEstimator(selectedPropId);
            });
        }

        // Comparison Dock & Matrix
        if (btnOpenComparisonMatrix) btnOpenComparisonMatrix.addEventListener('click', openComparisonMatrix);
        if (btnCloseComparison) btnCloseComparison.addEventListener('click', () => comparisonModal && comparisonModal.classList.add('hidden'));
        if (btnCompareClear) {
            btnCompareClear.addEventListener('click', () => {
                comparisonSet.clear();
                updateCompareDock();
                renderGalleryCards();
            });
        }

        // Mortgage Modal
        if (btnCloseMortgage) btnCloseMortgage.addEventListener('click', () => mortgageModal && mortgageModal.classList.add('hidden'));
        [calcHomePrice, calcDownPct, calcLoanTerm, calcInterestRate, calcTaxRate, calcInsurance, calcHoaFee].filter(Boolean).forEach(input => {
            input.addEventListener('input', recalculateMortgageModal);
        });

        // Lightbox Modal
        if (btnCloseLightbox) btnCloseLightbox.addEventListener('click', () => photoLightboxModal && photoLightboxModal.classList.add('hidden'));
        if (btnLightboxPrev) btnLightboxPrev.addEventListener('click', () => stepLightbox(-1));
        if (btnLightboxNext) btnLightboxNext.addEventListener('click', () => stepLightbox(1));

        // Scraper Modal (Guarded)
        if (btnOpenScraper) btnOpenScraper.addEventListener('click', openScraperModal);
        if (btnCloseScraper) btnCloseScraper.addEventListener('click', () => scraperModal && scraperModal.classList.add('hidden'));
        if (btnCancelScraper) btnCancelScraper.addEventListener('click', () => scraperModal && scraperModal.classList.add('hidden'));
        if (btnStartLiveScrape) btnStartLiveScrape.addEventListener('click', startLiveScrapingJob);

        // CSV Export
        if (btnExportCsv) btnExportCsv.addEventListener('click', exportCsv);

        // Global Modal Backdrop Click to Close
        [comparisonModal, mortgageModal, photoLightboxModal, scraperModal, scoringModal, cmdPaletteModal].filter(Boolean).forEach(modal => {
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
                setPresetMenuOpen(false);
                closeMobileSidebar();
                closePropertyDrawer();
                closeCommandPalette();
                [comparisonModal, mortgageModal, photoLightboxModal, scraperModal, scoringModal]
                    .filter(Boolean)
                    .forEach(m => m.classList.add('hidden'));
                return;
            }

            // Ignore typing shortcuts inside inputs
            if (isTyping) return;

            // Slash '/' key focuses search
            if (e.key === '/' && searchInput) {
                e.preventDefault();
                searchInput.focus();
                return;
            }

            // Lightbox Arrow Keys
            if (photoLightboxModal && !photoLightboxModal.classList.contains('hidden')) {
                if (e.key === 'ArrowLeft') stepLightbox(-1);
                if (e.key === 'ArrowRight') stepLightbox(1);
                return;
            }

            // Drawer Navigation (J/K or Up/Down for properties, Left/Right for photos)
            if (propertyDetailDrawer && !propertyDetailDrawer.classList.contains('hidden')) {
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    stepDrawerPhoto(-1);
                    return;
                }
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    stepDrawerPhoto(1);
                    return;
                }
                if (e.key === 'j' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    stepDrawerProperty(1);
                    return;
                }
                if (e.key === 'k' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    stepDrawerProperty(-1);
                    return;
                }
                if (e.key === 'f' && selectedPropId) {
                    toggleFavorite(selectedPropId);
                    return;
                }
                if (e.key === 'c' && selectedPropId) {
                    toggleComparison(selectedPropId, !comparisonSet.has(selectedPropId));
                    return;
                }
                return;
            }

            if (e.key === 'f') {
                favoritesBadgeBtn?.click();
                return;
            }

            // Quick View mode numbers
            if (e.key === '1') setViewMode('split');
            if (e.key === '2') setViewMode('grid');
            if (e.key === '3') setViewMode('map');
            if (e.key === '4') setViewMode('deals');
            if (e.key === '5') setViewMode('analytics');
            if (e.key === '6') setViewMode('odd');
        });

        // Mobile & iPhone Navigation & Drawer Handlers
        if (btnMobileFilters) btnMobileFilters.addEventListener('click', openMobileSidebar);
        if (btnMobileSidebarClose) btnMobileSidebarClose.addEventListener('click', closeMobileSidebar);
        if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);
        if (mobNavFilters) mobNavFilters.addEventListener('click', openMobileSidebar);
        if (btnCloseMobilePreview) btnCloseMobilePreview.addEventListener('click', hideMobileMapPreview);

        if (mobNavSplit) mobNavSplit.addEventListener('click', () => setViewMode('split'));
        if (mobNavGrid) mobNavGrid.addEventListener('click', () => setViewMode('grid'));
        if (mobNavMap) mobNavMap.addEventListener('click', () => setViewMode('map'));
        if (mobNavDeals) mobNavDeals.addEventListener('click', () => setViewMode('deals'));
        if (mobNavAnalytics) mobNavAnalytics.addEventListener('click', () => setViewMode('analytics'));
        if (mobNavOdd) mobNavOdd.addEventListener('click', () => setViewMode('odd'));
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

    setupEventListeners();
    setupDialogFocus();
    const mobileLayout = matchMedia('(max-width: 768px)');
    const syncSidebarAccess = () => {
        if (!mobileLayout.matches && appSidebar?.classList.contains('mobile-open')) closeMobileSidebar();
        if (appSidebar) appSidebar.inert = mobileLayout.matches && !appSidebar.classList.contains('mobile-open');
    };
    mobileLayout.addEventListener('change', syncSidebarAccess);
    syncSidebarAccess();
    applyTheme(document.documentElement.dataset.theme);
    const systemTheme = matchMedia('(prefers-color-scheme: dark)');
    systemTheme.addEventListener('change', (event) => {
        let saved;
        try { saved = localStorage.getItem(STORAGE_THEME_KEY); } catch (_) {}
        if (saved !== 'light' && saved !== 'dark') applyTheme(event.matches ? 'dark' : 'light');
    });
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_THEME_KEY) applyTheme(event.newValue === 'light' || event.newValue === 'dark'
            ? event.newValue : (systemTheme.matches ? 'dark' : 'light'));
    });
    detectBackendCapabilities();
    setupMapResize();
    loadProperties();
});
