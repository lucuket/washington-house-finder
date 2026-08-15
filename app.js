/* ==========================================================================
   Washington Elite House Finder - Application Logic & State Management
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // -------------------------------------------------------------------------
    // Global Application State
    // -------------------------------------------------------------------------
    let allProperties = [];
    let filteredProperties = [];
    let activePhotoIndices = {}; // propId -> index
    let comparisonSet = new Set(); // set of propIds (max 4)
    let activeView = 'split'; // 'split' | 'grid' | 'map' | 'analytics'
    
    // Active Modal Contexts
    let currentLightboxProp = null;
    let currentLightboxIndex = 0;
    let currentNoteProp = null;
    let currentMortgageProp = null;
    let scraperPollTimer = null;

    // Filter Criteria State
    const filterState = {
        search: '',
        city: 'all',
        minPrice: 350000,
        maxPrice: 500000,
        minBeds: 2,
        minBaths: 1.5,
        minSqft: 1200,
        maxSqft: 2000,
        minGarage: 2,
        minLot: 6500,
        maxHoa: 50,
        minRating: 0,
        favoritesOnly: false,
        sortBy: 'default'
    };

    // -------------------------------------------------------------------------
    // DOM Elements Cache
    // -------------------------------------------------------------------------
    const totalCountBadge = document.getElementById('total-count-badge');
    const matchedCountBadge = document.getElementById('matched-count-badge');
    const favoritesCountBadge = document.getElementById('favorites-count-badge');
    const favoritesBadgeBtn = document.getElementById('favorites-badge-btn');
    const resultsCountLabel = document.getElementById('results-count-label');
    const cardsGrid = document.getElementById('cards-grid');
    const emptyStateNotice = document.getElementById('empty-state-notice');
    const btnEmptyReset = document.getElementById('btn-empty-reset');

    // Sidebar Controls
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const citySelect = document.getElementById('city-select');
    const priceMinSlider = document.getElementById('price-min-slider');
    const priceMaxSlider = document.getElementById('price-max-slider');
    const priceRangeDisplay = document.getElementById('price-range-display');
    const bedsPillGroup = document.getElementById('beds-pill-group');
    const bathsPillGroup = document.getElementById('baths-pill-group');
    const sqftMinSlider = document.getElementById('sqft-min-slider');
    const sqftMaxSlider = document.getElementById('sqft-max-slider');
    const sqftRangeDisplay = document.getElementById('sqft-range-display');
    const garagePillGroup = document.getElementById('garage-pill-group');
    const lotSlider = document.getElementById('lot-slider');
    const lotDisplay = document.getElementById('lot-display');
    const hoaSlider = document.getElementById('hoa-slider');
    const hoaDisplay = document.getElementById('hoa-display');
    const ratingFilter = document.getElementById('rating-filter');
    const filterFavoritesToggle = document.getElementById('filter-favorites-toggle');
    const btnResetFilters = document.getElementById('btn-reset-filters');
    const sortDropdown = document.getElementById('sort-dropdown');

    // Market Quick Stats
    const marketAvgPrice = document.getElementById('market-avg-price');
    const marketAvgPpsqft = document.getElementById('market-avg-ppsqft');
    const marketAvgSqft = document.getElementById('market-avg-sqft');

    // Workspace Viewport & View Mode Tabs
    const workspaceViewport = document.getElementById('workspace-viewport');
    const viewTabSplit = document.getElementById('view-tab-split');
    const viewTabGrid = document.getElementById('view-tab-grid');
    const viewTabMap = document.getElementById('view-tab-map');
    const viewTabAnalytics = document.getElementById('view-tab-analytics');
    const mapMarkerCount = document.getElementById('map-marker-count');

    // Modals
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
    const calcValPi = document.getElementById('calc-val-pi');
    const calcValTax = document.getElementById('calc-val-tax');
    const calcValIns = document.getElementById('calc-val-ins');
    const calcValHoa = document.getElementById('calc-val-hoa');
    const calcLoanPrincipal = document.getElementById('calc-loan-principal');
    const calcVisualBar = document.getElementById('calc-visual-bar');

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

    const noteModal = document.getElementById('note-modal');
    const btnCloseNote = document.getElementById('btn-close-note');
    const noteModalAddress = document.getElementById('note-modal-address');
    const starPickerInteractive = document.getElementById('star-picker-interactive');
    const ratingTextLabel = document.getElementById('rating-text-label');
    const noteTextarea = document.getElementById('note-textarea');
    const noteSaveStatus = document.getElementById('note-save-status');
    const btnSaveNote = document.getElementById('btn-save-note');

    const scraperModal = document.getElementById('scraper-modal');
    const btnOpenScraper = document.getElementById('btn-open-scraper');
    const btnCloseScraper = document.getElementById('btn-close-scraper');
    const btnCancelScraper = document.getElementById('btn-cancel-scraper');
    const btnStartLiveScrape = document.getElementById('btn-start-live-scrape');
    const scraperProgressFill = document.getElementById('scraper-progress-fill');
    const scraperStatusText = document.getElementById('scraper-status-text');
    const scraperPctText = document.getElementById('scraper-pct-text');
    const scraperTerminal = document.getElementById('scraper-terminal');

    const btnExportCsv = document.getElementById('btn-export-csv');
    const toastContainer = document.getElementById('toast-container');

    // -------------------------------------------------------------------------
    // Leaflet.js Map Initialization
    // -------------------------------------------------------------------------
    let map = null;
    let markersLayer = null;
    let markerInstances = {}; // propId -> L.Marker

    function initMap() {
        if (map) return;
        const mapElement = document.getElementById('leaflet-map');
        if (!mapElement) return;

        // Washington State Center: ~47.4, -120.5
        map = L.map('leaflet-map', {
            center: [47.4, -120.5],
            zoom: 7,
            zoomControl: true,
            attributionControl: false
        });

        // CartoDB Dark Matter Tiles
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd',
        }).addTo(map);

        markersLayer = L.featureGroup().addTo(map);
    }

    function updateMapMarkers(propertiesToDisplay) {
        if (!map || !markersLayer) return;
        markersLayer.clearLayers();
        markerInstances = {};

        const validCoords = [];

        propertiesToDisplay.forEach(p => {
            if (p.latitude && p.longitude) {
                const formattedPrice = '$' + Math.round(p.price / 1000) + 'k';
                
                const customIcon = L.divIcon({
                    className: 'custom-map-icon-wrapper',
                    html: `<div class="leaflet-price-pin" id="marker-pin-${p.id}">${formattedPrice}</div>`,
                    iconSize: [60, 24],
                    iconAnchor: [30, 12],
                    popupAnchor: [0, -12]
                });

                const marker = L.marker([p.latitude, p.longitude], { icon: customIcon });

                // Rich Popup HTML
                const popupContent = `
                    <div class="map-popup-card" onclick="window.HouseFinderApp.openLightboxById('${p.id}')" style="cursor: pointer;">
                        <img src="${p.photos[0] || ''}" alt="${p.address}" class="popup-img">
                        <div class="popup-info">
                            <span class="popup-price">$${p.price.toLocaleString()}</span>
                            <strong class="popup-address">${p.address}</strong>
                            <span class="popup-specs">${p.beds} Beds • ${p.baths} Baths • ${p.sqft.toLocaleString()} sqft</span>
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent, { maxWidth: 260, className: 'dark-map-popup' });

                marker.on('click', () => {
                    highlightCard(p.id);
                });

                markersLayer.addLayer(marker);
                markerInstances[p.id] = marker;
                validCoords.push([p.latitude, p.longitude]);
            }
        });

        mapMarkerCount.textContent = `${validCoords.length} pins on map`;

        if (validCoords.length > 0) {
            try {
                map.fitBounds(markersLayer.getBounds(), { padding: [40, 40], maxZoom: 13 });
            } catch (e) {
                // Ignore bounds error if coords are single point
            }
        }
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
            if (active) {
                pinEl.classList.add('selected');
            } else {
                pinEl.classList.remove('selected');
            }
        }
    }

    // -------------------------------------------------------------------------
    // Toast Notification System
    // -------------------------------------------------------------------------
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast-msg toast-${type}`;
        
        let iconSvg = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
        `;
        if (type === 'error') {
            iconSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
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
    // Data Fetching & Loading
    // -------------------------------------------------------------------------
    async function loadPropertiesFromApi() {
        try {
            resultsCountLabel.textContent = "Loading Washington homes...";
            const response = await fetch('/api/properties');
            if (!response.ok) throw new Error("Failed to load properties.");
            
            allProperties = await response.json();
            
            // Initialize photo index registry
            allProperties.forEach(p => {
                if (!(p.id in activePhotoIndices)) {
                    activePhotoIndices[p.id] = 0;
                }
            });

            populateCityDropdown();
            applyFilters();
            fetchAndRenderMarketStats();
        } catch (err) {
            console.error("Error loading properties:", err);
            showToast("Failed to load properties database.", "error");
        }
    }

    async function fetchAndRenderMarketStats() {
        try {
            const res = await fetch('/api/stats');
            if (!res.ok) return;
            const stats = await res.json();

            totalCountBadge.textContent = stats.total_listings || allProperties.length;
            favoritesCountBadge.textContent = stats.favorites_count || 0;

            if (marketAvgPrice) marketAvgPrice.textContent = `$${(stats.avg_price || 0).toLocaleString()}`;
            if (marketAvgPpsqft) marketAvgPpsqft.textContent = `$${stats.avg_price_per_sqft || 0}/sqft`;
            if (marketAvgSqft) marketAvgSqft.textContent = `${(stats.avg_sqft || 0).toLocaleString()} sqft`;

            renderAnalyticsDashboard(stats);
        } catch (e) {
            console.warn("Could not fetch stats:", e);
        }
    }

    function populateCityDropdown() {
        const cities = [...new Set(allProperties.map(p => p.city))].sort();
        citySelect.innerHTML = '<option value="all">All Washington Cities</option>';
        cities.forEach(city => {
            const opt = document.createElement('option');
            opt.value = city.toLowerCase();
            opt.textContent = `${city}, WA`;
            citySelect.appendChild(opt);
        });
    }

    // -------------------------------------------------------------------------
    // Filtering, Searching & Sorting Logic
    // -------------------------------------------------------------------------
    function applyFilters() {
        const searchQ = filterState.search.trim().toLowerCase();
        
        filteredProperties = allProperties.filter(p => {
            // City check
            if (filterState.city !== 'all' && p.city.toLowerCase() !== filterState.city) {
                return false;
            }

            // Price range check
            if (p.price < filterState.minPrice || p.price > filterState.maxPrice) {
                return false;
            }

            // Beds & Baths check
            if (p.beds < filterState.minBeds) return false;
            if (p.baths < filterState.minBaths) return false;

            // Sqft range check
            if (p.sqft < filterState.minSqft || p.sqft > filterState.maxSqft) return false;

            // Lot size check
            if (p.lot_sqft < filterState.minLot) return false;

            // Garage check
            if (p.garage < filterState.minGarage) return false;

            // HOA check
            if (p.hoa > filterState.maxHoa) return false;

            // Rating check
            if (filterState.minRating > 0 && (p.rating || 0) < filterState.minRating) return false;

            // Favorites check
            if (filterState.favoritesOnly && !p.favorite) return false;

            // Keyword search
            if (searchQ) {
                const combined = `${p.address} ${p.city} ${p.zip} ${p.description} ${p.user_notes}`.toLowerCase();
                if (!combined.includes(searchQ)) return false;
            }

            return true;
        });

        // Apply Sorting
        sortFilteredProperties();

        // Render UI
        renderGalleryCards();
        updateMapMarkers(filteredProperties);
        updateHeaderCounts();
    }

    function sortFilteredProperties() {
        switch (filterState.sortBy) {
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
                // Default: preserve discovery match order
                break;
        }
    }

    function updateHeaderCounts() {
        matchedCountBadge.textContent = filteredProperties.length;
        const favCount = allProperties.filter(p => p.favorite).length;
        favoritesCountBadge.textContent = favCount;
        resultsCountLabel.textContent = `${filteredProperties.length} homes matched`;

        if (filteredProperties.length === 0) {
            emptyStateNotice.classList.remove('hidden');
            cardsGrid.classList.add('hidden');
        } else {
            emptyStateNotice.classList.add('hidden');
            cardsGrid.classList.remove('hidden');
        }
    }

    // -------------------------------------------------------------------------
    // Card Rendering & Micro-interactions
    // -------------------------------------------------------------------------
    function renderGalleryCards() {
        cardsGrid.innerHTML = '';

        filteredProperties.forEach(p => {
            const card = document.createElement('article');
            card.className = 'property-card';
            card.id = `card-${p.id}`;

            const photoIdx = activePhotoIndices[p.id] || 0;
            const currentPhoto = p.photos[photoIdx] || 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1200&q=80';
            const totalPhotos = p.photos.length || 1;
            const ppsqft = Math.round(p.price / Math.max(1, p.sqft));
            const estMonthly = calculateEstimatedMonthly(p.price, p.hoa);
            const isCompared = comparisonSet.has(p.id);

            // Stars HTML
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                const filledClass = i <= (p.rating || 0) ? 'filled' : '';
                starsHtml += `<span class="star ${filledClass}" data-rate="${i}" title="Rate ${i} stars">★</span>`;
            }

            card.innerHTML = `
                <div class="card-media">
                    <img src="${currentPhoto}" alt="${p.address}" class="card-img" id="img-${p.id}">
                    <span class="card-city-tag">${p.city}, WA</span>
                    
                    <button class="card-favorite-btn ${p.favorite ? 'favorited' : ''}" data-id="${p.id}" title="${p.favorite ? 'Remove from favorites' : 'Add to favorites'}">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="${p.favorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                    </button>

                    ${totalPhotos > 1 ? `
                        <button class="card-nav-arrow prev" data-id="${p.id}" data-dir="-1" title="Previous photo">‹</button>
                        <button class="card-nav-arrow next" data-id="${p.id}" data-dir="1" title="Next photo">›</button>
                        <div class="card-photo-counter" id="counter-${p.id}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <span>${photoIdx + 1}/${totalPhotos}</span>
                        </div>
                    ` : ''}
                </div>

                <div class="card-body">
                    <div class="card-price-row">
                        <span class="card-price">$${p.price.toLocaleString()}</span>
                        <span class="card-mortgage-badge" data-id="${p.id}" title="Click to view Mortgage Breakdown">~$${estMonthly.toLocaleString()}/mo</span>
                    </div>

                    <div class="card-address-block">
                        <strong class="card-street" title="${p.address}">${p.address}</strong>
                        <span class="card-city-zip">${p.city}, WA ${p.zip || ''}</span>
                    </div>

                    <div class="card-specs-grid">
                        <div class="spec-item">
                            <span class="spec-val">${p.beds}</span>
                            <span class="spec-lbl">Beds</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val">${p.baths}</span>
                            <span class="spec-lbl">Baths</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val">${p.sqft.toLocaleString()}</span>
                            <span class="spec-lbl">SqFt</span>
                        </div>
                        <div class="spec-item">
                            <span class="spec-val">${p.garage} Car</span>
                            <span class="spec-lbl">Garage</span>
                        </div>
                    </div>

                    <div class="card-extra-chips">
                        <span class="chip chip-ppsqft">$${ppsqft}/sqft</span>
                        <span class="chip">Lot: ${p.lot_sqft.toLocaleString()} sqft</span>
                        <span class="chip">Built ${p.year_built}</span>
                        <span class="chip">${p.hoa > 0 ? `$${p.hoa}/mo HOA` : 'No HOA'}</span>
                    </div>

                    <div class="card-user-meta">
                        <div class="card-star-rating" data-id="${p.id}" title="Set star rating">
                            ${starsHtml}
                        </div>
                        <button class="card-note-trigger ${p.user_notes ? 'has-note' : ''}" data-id="${p.id}" title="Add/Edit Personal Notes">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            <span>${p.user_notes ? 'Notes Added' : 'Add Note'}</span>
                        </button>
                    </div>

                    <div class="card-footer-actions">
                        <label class="compare-checkbox-label">
                            <input type="checkbox" class="compare-check" data-id="${p.id}" ${isCompared ? 'checked' : ''}>
                            <span>Compare</span>
                        </label>
                        
                        <div class="card-btns-group">
                            <button class="btn btn-secondary btn-sm card-view-gallery-btn" data-id="${p.id}">
                                Photos (${totalPhotos})
                            </button>
                            <a href="${p.url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" title="Open source listing on Realtor.com">
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                            </a>
                        </div>
                    </div>
                </div>
            `;

            // Hover sync with map marker
            card.addEventListener('mouseenter', () => highlightMarker(p.id, true));
            card.addEventListener('mouseleave', () => highlightMarker(p.id, false));

            cardsGrid.appendChild(card);
        });

        attachCardEventListeners();
    }

    function attachCardEventListeners() {
        // Photo cycling navigation buttons
        document.querySelectorAll('.card-nav-arrow').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = btn.getAttribute('data-id');
                const dir = parseInt(btn.getAttribute('data-dir'), 10);
                cycleCardPhoto(propId, dir);
            });
        });

        // Photo click -> Lightbox
        document.querySelectorAll('.card-img, .card-view-gallery-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = el.getAttribute('data-id') || el.id.replace('img-', '');
                openPhotoLightbox(propId);
            });
        });

        // Favorite Toggle
        document.querySelectorAll('.card-favorite-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const propId = btn.getAttribute('data-id');
                await toggleFavorite(propId);
            });
        });

        // Mortgage Badge Click
        document.querySelectorAll('.card-mortgage-badge').forEach(badge => {
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = badge.getAttribute('data-id');
                openMortgageEstimator(propId);
            });
        });

        // Star Rating Clicks
        document.querySelectorAll('.card-star-rating .star').forEach(star => {
            star.addEventListener('click', async (e) => {
                e.stopPropagation();
                const ratingContainer = star.parentElement;
                const propId = ratingContainer.getAttribute('data-id');
                const rateVal = parseInt(star.getAttribute('data-rate'), 10);
                await updatePropertyRating(propId, rateVal);
            });
        });

        // Note Trigger Click
        document.querySelectorAll('.card-note-trigger').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const propId = btn.getAttribute('data-id');
                openNoteEditor(propId);
            });
        });

        // Compare Checkbox Toggle
        document.querySelectorAll('.compare-check').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const propId = chk.getAttribute('data-id');
                if (chk.checked) {
                    if (comparisonSet.size >= 4) {
                        chk.checked = false;
                        showToast("You can compare up to 4 homes at once.", "error");
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
        if (counterEl) counterEl.innerHTML = `
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>${curIdx + 1}/${prop.photos.length}</span>
        `;
    }

    // -------------------------------------------------------------------------
    // REST API Persistence Actions (Favorites, Notes, Ratings)
    // -------------------------------------------------------------------------
    async function toggleFavorite(propId) {
        try {
            const prop = allProperties.find(p => p.id === propId);
            if (!prop) return;

            const res = await fetch(`/api/properties/${propId}/favorite`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ favorite: !prop.favorite })
            });

            if (!res.ok) throw new Error("Failed to update favorite.");
            const updated = await res.json();

            // Update in-memory
            prop.favorite = updated.favorite;
            showToast(prop.favorite ? `Saved "${prop.address}" to favorites!` : `Removed "${prop.address}" from favorites.`);

            applyFilters();
            fetchAndRenderMarketStats();
        } catch (e) {
            console.error("Favorite toggle error:", e);
            showToast("Could not update favorite status.", "error");
        }
    }

    async function updatePropertyRating(propId, rating) {
        try {
            const prop = allProperties.find(p => p.id === propId);
            if (!prop) return;

            const res = await fetch(`/api/properties/${propId}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating: rating })
            });

            if (!res.ok) throw new Error("Failed to save rating.");
            const updated = await res.json();

            prop.rating = updated.rating;
            showToast(`Rated ${rating} ★ for ${prop.address}`);
            applyFilters();
        } catch (e) {
            console.error("Rating update error:", e);
            showToast("Could not save rating.", "error");
        }
    }

    // -------------------------------------------------------------------------
    // Comparison Dock & Matrix Drawer
    // -------------------------------------------------------------------------
    function updateCompareDock() {
        const count = comparisonSet.size;
        compareCountBadge.textContent = `${count} / 4`;

        if (count > 0) {
            compareDock.classList.remove('hidden');
        } else {
            compareDock.classList.add('hidden');
        }

        btnOpenComparisonMatrix.disabled = count < 2;

        // Render 4 slots in dock
        compareThumbnailsRow.innerHTML = '';
        const propArray = Array.from(comparisonSet).map(id => allProperties.find(p => p.id === id)).filter(Boolean);

        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'dock-thumb-slot';
            
            if (i < propArray.length) {
                const p = propArray[i];
                slot.classList.add('filled');
                slot.innerHTML = `
                    <img src="${p.photos[0] || ''}" alt="${p.address}" class="dock-thumb-img" title="${p.address} ($${p.price.toLocaleString()})">
                    <button class="dock-thumb-remove" data-id="${p.id}" title="Remove">✕</button>
                `;
            } else {
                slot.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">+ Add</span>`;
            }
            compareThumbnailsRow.appendChild(slot);
        }

        // Attach remove click listener
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

        let tableHtml = `
            <table class="comparison-table">
                <thead>
                    <tr>
                        <th>Property Details</th>
                        ${props.map(p => `
                            <td>
                                <img src="${p.photos[0] || ''}" class="comp-img-header" alt="${p.address}">
                                <div class="comp-price">$${p.price.toLocaleString()}</div>
                                <strong>${p.address}</strong><br>
                                <span style="font-size: 11px; color: var(--text-secondary);">${p.city}, WA ${p.zip || ''}</span>
                            </td>
                        `).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <th>Monthly Mortgage (Est.)</th>
                        ${props.map(p => `<td><strong style="color: var(--accent-emerald);">~$${calculateEstimatedMonthly(p.price, p.hoa).toLocaleString()}/mo</strong></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Price per SqFt</th>
                        ${props.map(p => `<td><strong>$${Math.round(p.price / Math.max(1, p.sqft))}/sqft</strong></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Bedrooms / Baths</th>
                        ${props.map(p => `<td>${p.beds} Beds • ${p.baths} Baths</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Living Area</th>
                        ${props.map(p => `<td>${p.sqft.toLocaleString()} sqft</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Lot Size</th>
                        ${props.map(p => `<td>${p.lot_sqft.toLocaleString()} sqft (${(p.lot_sqft / 43560).toFixed(2)} acres)</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Garage Spaces</th>
                        ${props.map(p => `<td>${p.garage} Car Attached/Detached</td>`).join('')}
                    </tr>
                    <tr>
                        <th>HOA Monthly Dues</th>
                        ${props.map(p => `<td>${p.hoa > 0 ? `$${p.hoa}/mo` : 'No HOA ($0)'}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Year Built</th>
                        ${props.map(p => `<td>${p.year_built}</td>`).join('')}
                    </tr>
                    <tr>
                        <th>Your Rating</th>
                        ${props.map(p => `<td><span style="color: var(--accent-amber);">${'★'.repeat(p.rating || 0)}${'☆'.repeat(5 - (p.rating || 0))}</span></td>`).join('')}
                    </tr>
                    <tr>
                        <th>Personal Notes</th>
                        ${props.map(p => `<td><em style="color: var(--text-secondary); font-size: 12px;">${p.user_notes || 'No notes added yet'}</em></td>`).join('')}
                    </tr>
                    <tr>
                        <th>External Listing</th>
                        ${props.map(p => `
                            <td>
                                <a href="${p.url}" target="_blank" class="btn btn-primary btn-sm">
                                    View on Realtor.com
                                </a>
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
    // Mortgage & Monthly Payment Estimator
    // -------------------------------------------------------------------------
    function calculateEstimatedMonthly(price, hoa = 0, downPct = 20, rate = 6.65, termYears = 30, taxRate = 1.02, insAnnual = 1200) {
        const principal = price * (1 - (downPct / 100));
        const monthlyRate = (rate / 100) / 12;
        const totalPayments = termYears * 12;

        let monthlyPi = 0;
        if (monthlyRate > 0) {
            monthlyPi = principal * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments)) / (Math.pow(1 + monthlyRate, totalPayments) - 1);
        } else {
            monthlyPi = principal / totalPayments;
        }

        const monthlyTax = (price * (taxRate / 100)) / 12;
        const monthlyIns = insAnnual / 12;
        const total = monthlyPi + monthlyTax + monthlyIns + hoa;

        return Math.round(total);
    }

    function openMortgageEstimator(propId) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop) return;
        currentMortgageProp = prop;

        calcPropAddress.textContent = `Estimated payment for ${prop.address}, ${prop.city}, WA`;
        calcHomePrice.value = prop.price;
        calcDownPct.value = 20;
        calcLoanTerm.value = "30";
        calcInterestRate.value = 6.65;
        calcTaxRate.value = 1.02;
        calcInsurance.value = 1200;
        calcHoaFee.value = prop.hoa || 0;

        recalculateMortgage();
        mortgageModal.classList.remove('hidden');
    }

    function recalculateMortgage() {
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

        // Update visual proportions bar
        if (totalMonthly > 0) {
            const piPct = (monthlyPi / totalMonthly) * 100;
            const taxPct = (monthlyTax / totalMonthly) * 100;
            const insPct = (monthlyIns / totalMonthly) * 100;
            const hoaPct = (hoa / totalMonthly) * 100;

            calcVisualBar.innerHTML = `
                <div class="bar-segment seg-principal" style="width: ${piPct}%;" title="Principal & Interest (${Math.round(piPct)}%)"></div>
                <div class="bar-segment seg-tax" style="width: ${taxPct}%;" title="Property Taxes (${Math.round(taxPct)}%)"></div>
                <div class="bar-segment seg-ins" style="width: ${insPct}%;" title="Insurance (${Math.round(insPct)}%)"></div>
                <div class="bar-segment seg-hoa" style="width: ${hoaPct}%;" title="HOA Dues (${Math.round(hoaPct)}%)"></div>
            `;
        }
    }

    // -------------------------------------------------------------------------
    // Photo Lightbox Modal
    // -------------------------------------------------------------------------
    function openPhotoLightbox(propId, startIdx = 0) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop || !prop.photos || prop.photos.length === 0) return;

        currentLightboxProp = prop;
        currentLightboxIndex = startIdx || activePhotoIndices[propId] || 0;

        lightboxAddress.textContent = `${prop.address}, ${prop.city}, WA`;
        lightboxSpecs.textContent = `${prop.beds} Beds • ${p.baths || prop.baths} Baths • ${prop.sqft.toLocaleString()} sqft • Built ${prop.year_built}`;
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

        // Render thumbnails
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

        // Scroll active thumbnail into view
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
    // Personal Note & Star Rating Editor Modal
    // -------------------------------------------------------------------------
    let currentNoteRating = 0;

    function openNoteEditor(propId) {
        const prop = allProperties.find(p => p.id === propId);
        if (!prop) return;
        currentNoteProp = prop;
        currentNoteRating = prop.rating || 0;

        noteModalAddress.textContent = `${prop.address}, ${prop.city}, WA`;
        noteTextarea.value = prop.user_notes || '';
        noteSaveStatus.textContent = prop.user_notes ? "Notes loaded" : "No notes yet";

        updateInteractiveStarPicker();
        noteModal.classList.remove('hidden');
    }

    function updateInteractiveStarPicker() {
        const stars = starPickerInteractive.querySelectorAll('.star-pick');
        stars.forEach(s => {
            const val = parseInt(s.getAttribute('data-val'), 10);
            if (val <= currentNoteRating) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });

        const labels = ["Not rated", "1 Star - Basic Match", "2 Stars - Fair Option", "3 Stars - Good Contender", "4 Stars - High Priority", "5 Stars - Dream Home"];
        ratingTextLabel.textContent = labels[currentNoteRating] || "Not rated";
    }

    async function saveCurrentNote() {
        if (!currentNoteProp) return;
        try {
            noteSaveStatus.textContent = "Saving...";
            const res = await fetch(`/api/properties/${currentNoteProp.id}/note`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    rating: currentNoteRating,
                    user_notes: noteTextarea.value.trim()
                })
            });

            if (!res.ok) throw new Error("Save note failed.");
            const updated = await res.json();

            currentNoteProp.rating = updated.rating;
            currentNoteProp.user_notes = updated.user_notes;

            noteSaveStatus.textContent = "Saved to database!";
            showToast(`Personal notes saved for ${currentNoteProp.address}`);
            applyFilters();
            setTimeout(() => noteModal.classList.add('hidden'), 400);
        } catch (e) {
            console.error("Note save error:", e);
            noteSaveStatus.textContent = "Save failed";
            showToast("Could not save note.", "error");
        }
    }

    // -------------------------------------------------------------------------
    // Analytics Dashboard Renderer
    // -------------------------------------------------------------------------
    function renderAnalyticsDashboard(stats) {
        if (!stats) return;

        const anAvgPrice = document.getElementById('an-avg-price');
        const anMedianPrice = document.getElementById('an-median-price');
        const anPriceRange = document.getElementById('an-price-range');
        const anAvgPpsqft = document.getElementById('an-avg-ppsqft');
        const priceDistributionBars = document.getElementById('price-distribution-bars');
        const cityDistributionList = document.getElementById('city-distribution-list');
        const garageDistributionList = document.getElementById('garage-distribution-list');

        if (anAvgPrice) anAvgPrice.textContent = `$${(stats.avg_price || 0).toLocaleString()}`;
        if (anMedianPrice) anMedianPrice.textContent = `$${(stats.median_price || 0).toLocaleString()}`;
        if (anPriceRange) anPriceRange.textContent = `$${(stats.min_price || 0).toLocaleString()} – $${(stats.max_price || 0).toLocaleString()}`;
        if (anAvgPpsqft) anAvgPpsqft.textContent = `$${stats.avg_price_per_sqft || 0}/sqft`;

        // Price distribution
        if (priceDistributionBars && stats.price_ranges) {
            priceDistributionBars.innerHTML = '';
            const maxRangeCount = Math.max(...Object.values(stats.price_ranges), 1);
            for (const [bracket, count] of Object.entries(stats.price_ranges)) {
                const pct = Math.round((count / maxRangeCount) * 100);
                const item = document.createElement('div');
                item.className = 'dist-bar-item';
                item.innerHTML = `
                    <div class="dist-bar-label">
                        <span>${bracket}</span>
                        <strong>${count} homes</strong>
                    </div>
                    <div class="dist-track">
                        <div class="dist-fill" style="width: ${pct}%;"></div>
                    </div>
                `;
                priceDistributionBars.appendChild(item);
            }
        }

        // City distribution
        if (cityDistributionList && stats.city_counts) {
            cityDistributionList.innerHTML = '';
            for (const [city, count] of Object.entries(stats.city_counts)) {
                const row = document.createElement('div');
                row.className = 'city-dist-item';
                row.innerHTML = `
                    <span>${city}, WA</span>
                    <span class="city-count-badge">${count}</span>
                `;
                cityDistributionList.appendChild(row);
            }
        }

        // Garage distribution
        if (garageDistributionList && stats.garage_distribution) {
            garageDistributionList.innerHTML = '';
            for (const [garageType, count] of Object.entries(stats.garage_distribution)) {
                const row = document.createElement('div');
                row.className = 'city-dist-item';
                row.innerHTML = `
                    <span>${garageType}</span>
                    <span class="city-count-badge">${count}</span>
                `;
                garageDistributionList.appendChild(row);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Live Scraper Progress & Background Execution
    // -------------------------------------------------------------------------
    function openScraperModal() {
        scraperModal.classList.remove('hidden');
    }

    async function startLiveScrapingJob() {
        btnStartLiveScrape.disabled = true;
        scraperStatusText.textContent = "Starting scraper...";

        try {
            const payload = {
                location: filterState.city !== 'all' ? filterState.city : "Washington",
                price_min: filterState.minPrice,
                price_max: filterState.maxPrice,
                sqft_min: filterState.minSqft,
                sqft_max: filterState.maxSqft,
                beds_min: filterState.minBeds,
                baths_min: filterState.minBaths,
                lot_size_min: filterState.minLot,
                garage_min: filterState.minGarage,
                hoa_max: filterState.maxHoa
            };

            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Scraper could not start.");
            }

            showToast("Live scraper initiated in background!");
            startScraperPolling();
        } catch (e) {
            console.error("Scraper launch failed:", e);
            showToast(e.message, "error");
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

                // Render terminal logs
                if (status.logs && status.logs.length > 0) {
                    scraperTerminal.innerHTML = status.logs.map(line => {
                        let cls = 'term-line';
                        if (line.includes('[MATCH]')) cls += ' match';
                        else if (line.includes('Error') || line.includes('[ERROR]')) cls += ' error';
                        else if (line.includes('Starting') || line.includes('Completed')) cls += ' info';
                        return `<div class="${cls}">> ${line}</div>`;
                    }).join('');
                    scraperTerminal.scrollTop = scraperTerminal.scrollHeight;
                }

                if (!status.is_active && status.progress >= 100) {
                    clearInterval(scraperPollTimer);
                    scraperPollTimer = null;
                    btnStartLiveScrape.disabled = false;
                    showToast("Scraper finished! Reloading database...");
                    await loadPropertiesFromApi();
                }
            } catch (e) {
                console.warn("Polling error:", e);
            }
        }, 1000);
    }

    // -------------------------------------------------------------------------
    // View Switcher & Event Listeners
    // -------------------------------------------------------------------------
    function setViewMode(mode) {
        activeView = mode;
        [viewTabSplit, viewTabGrid, viewTabMap, viewTabAnalytics].forEach(btn => btn.classList.remove('active'));
        workspaceViewport.className = `workspace-viewport view-${mode}`;

        if (mode === 'split') viewTabSplit.classList.add('active');
        if (mode === 'grid') viewTabGrid.classList.add('active');
        if (mode === 'map') viewTabMap.classList.add('active');
        if (mode === 'analytics') viewTabAnalytics.classList.add('active');

        // Trigger map redraw on view change
        if (map && (mode === 'split' || mode === 'map')) {
            setTimeout(() => map.invalidateSize(), 150);
        }
    }

    // View Tabs
    viewTabSplit.addEventListener('click', () => setViewMode('split'));
    viewTabGrid.addEventListener('click', () => setViewMode('grid'));
    viewTabMap.addEventListener('click', () => setViewMode('map'));
    viewTabAnalytics.addEventListener('click', () => setViewMode('analytics'));

    // Search Input with Debounce
    let searchDebounce = null;
    searchInput.addEventListener('input', (e) => {
        const val = e.target.value;
        filterState.search = val;
        clearSearchBtn.classList.toggle('hidden', !val);

        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            applyFilters();
        }, 200);
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

    // Price Dual Sliders
    priceMinSlider.addEventListener('input', () => {
        let min = parseInt(priceMinSlider.value, 10);
        let max = parseInt(priceMaxSlider.value, 10);
        if (min > max - 10000) {
            min = max - 10000;
            priceMinSlider.value = min;
        }
        filterState.minPrice = min;
        priceRangeDisplay.textContent = `$${Math.round(min / 1000)}k – $${Math.round(max / 1000)}k`;
        applyFilters();
    });

    priceMaxSlider.addEventListener('input', () => {
        let min = parseInt(priceMinSlider.value, 10);
        let max = parseInt(priceMaxSlider.value, 10);
        if (max < min + 10000) {
            max = min + 10000;
            priceMaxSlider.value = max;
        }
        filterState.maxPrice = max;
        priceRangeDisplay.textContent = `$${Math.round(min / 1000)}k – $${Math.round(max / 1000)}k`;
        applyFilters();
    });

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
        applyFilters();
    });

    sqftMaxSlider.addEventListener('input', () => {
        let min = parseInt(sqftMinSlider.value, 10);
        let max = parseInt(sqftMaxSlider.value, 10);
        if (max < min + 100) {
            max = min + 100;
            sqftMaxSlider.value = max;
        }
        filterState.maxSqft = max;
        sqftRangeDisplay.textContent = `${min.toLocaleString()} – ${max.toLocaleString()} sqft`;
        applyFilters();
    });

    // Beds Pills
    bedsPillGroup.querySelectorAll('.pill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterState.minBeds = parseInt(btn.getAttribute('data-beds'), 10);
            applyFilters();
        });
    });

    // Baths Pills
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

    // Lot Size Slider
    lotSlider.addEventListener('input', () => {
        const val = parseInt(lotSlider.value, 10);
        filterState.minLot = val;
        lotDisplay.textContent = `${val.toLocaleString()}+ sqft`;
        applyFilters();
    });

    // HOA Slider
    hoaSlider.addEventListener('input', () => {
        const val = parseInt(hoaSlider.value, 10);
        filterState.maxHoa = val;
        hoaDisplay.textContent = val === 0 ? '$0/mo (No HOA)' : `≤ $${val}/mo`;
        applyFilters();
    });

    // Star Rating Filter
    ratingFilter.addEventListener('change', (e) => {
        filterState.minRating = parseInt(e.target.value, 10);
        applyFilters();
    });

    // Favorites Filter
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

    // Reset Filters
    function resetAllFilters() {
        filterState.search = '';
        filterState.city = 'all';
        filterState.minPrice = 350000;
        filterState.maxPrice = 500000;
        filterState.minBeds = 2;
        filterState.minBaths = 1.5;
        filterState.minSqft = 1200;
        filterState.maxSqft = 2000;
        filterState.minGarage = 2;
        filterState.minLot = 6500;
        filterState.maxHoa = 50;
        filterState.minRating = 0;
        filterState.favoritesOnly = false;
        filterState.sortBy = 'default';

        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        citySelect.value = 'all';
        priceMinSlider.value = 350000;
        priceMaxSlider.value = 500000;
        priceRangeDisplay.textContent = '$350k – $500k';
        sqftMinSlider.value = 1200;
        sqftMaxSlider.value = 2000;
        sqftRangeDisplay.textContent = '1,200 – 2,000 sqft';
        lotSlider.value = 6500;
        lotDisplay.textContent = '6,500+ sqft';
        hoaSlider.value = 50;
        hoaDisplay.textContent = '≤ $50/mo';
        ratingFilter.value = '0';
        filterFavoritesToggle.checked = false;
        sortDropdown.value = 'default';

        bedsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-beds') === '2'));
        bathsPillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-baths') === '1.5'));
        garagePillGroup.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-garage') === '2'));

        applyFilters();
        showToast("Filters reset to default.");
    }

    btnResetFilters.addEventListener('click', resetAllFilters);
    btnEmptyReset.addEventListener('click', resetAllFilters);

    // Mortgage Calculator Inputs
    [calcHomePrice, calcDownPct, calcLoanTerm, calcInterestRate, calcTaxRate, calcInsurance, calcHoaFee].forEach(input => {
        input.addEventListener('input', recalculateMortgage);
    });

    // Comparison Actions
    btnOpenComparisonMatrix.addEventListener('click', openComparisonMatrix);
    btnCompareClear.addEventListener('click', () => {
        comparisonSet.clear();
        updateCompareDock();
        renderGalleryCards();
    });

    // Star Picker in Note Modal
    starPickerInteractive.querySelectorAll('.star-pick').forEach(star => {
        star.addEventListener('click', () => {
            currentNoteRating = parseInt(star.getAttribute('data-val'), 10);
            updateInteractiveStarPicker();
        });
    });
    btnSaveNote.addEventListener('click', saveCurrentNote);

    // Lightbox Navigation
    btnLightboxPrev.addEventListener('click', () => stepLightbox(-1));
    btnLightboxNext.addEventListener('click', () => stepLightbox(1));

    // Scraper Modal
    btnOpenScraper.addEventListener('click', openScraperModal);
    btnStartLiveScrape.addEventListener('click', startLiveScrapingJob);

    // CSV Export
    btnExportCsv.addEventListener('click', () => {
        const queryParams = new URLSearchParams();
        if (filterState.city !== 'all') queryParams.append('city', filterState.city);
        if (filterState.minPrice) queryParams.append('min_price', filterState.minPrice);
        if (filterState.maxPrice) queryParams.append('max_price', filterState.maxPrice);
        if (filterState.favoritesOnly) queryParams.append('favorites_only', 'true');

        window.location.href = `/api/export/csv?${queryParams.toString()}`;
        showToast("Downloading CSV export of matching homes...");
    });

    // Modal Close Handlers
    function closeAllModals() {
        [comparisonModal, mortgageModal, photoLightboxModal, noteModal, scraperModal].forEach(m => m.classList.add('hidden'));
    }

    btnCloseComparison.addEventListener('click', () => comparisonModal.classList.add('hidden'));
    btnCloseMortgage.addEventListener('click', () => mortgageModal.classList.add('hidden'));
    btnCloseLightbox.addEventListener('click', () => photoLightboxModal.classList.add('hidden'));
    btnCloseNote.addEventListener('click', () => noteModal.classList.add('hidden'));
    btnCloseScraper.addEventListener('click', () => scraperModal.classList.add('hidden'));
    btnCancelScraper.addEventListener('click', () => scraperModal.classList.add('hidden'));

    // Backdrop Click Close
    [comparisonModal, mortgageModal, photoLightboxModal, noteModal, scraperModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // Keyboard Shortcuts (Arrow keys for lightbox, Escape for all modals)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        } else if (!photoLightboxModal.classList.contains('hidden')) {
            if (e.key === 'ArrowLeft') stepLightbox(-1);
            if (e.key === 'ArrowRight') stepLightbox(1);
        }
    });

    // Expose global methods for popup triggers
    window.HouseFinderApp = {
        openLightboxById: (propId) => openPhotoLightbox(propId)
    };

    // -------------------------------------------------------------------------
    // Initial Boot
    // -------------------------------------------------------------------------
    initMap();
    loadPropertiesFromApi();
});
