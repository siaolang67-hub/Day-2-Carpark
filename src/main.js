/**
 * Singapore Carpark Availability, Driving Route & Rates Overseer
 * Pure Vanilla JavaScript (ES6+) Implementation
 * Features:
 *  - Prominent Interactive Map at Top of Page with live pins & route polyline
 *  - Guided Step-by-Step Trip Planner (Origin, Destination, Stay Duration, Vehicle)
 *  - Start Trip & Find Parking CTA button with loading states
 *  - Driving Route Outcome (Shortest distance, driving duration, turn steps)
 *  - Recommended Parking Locations (Top Pick, Lowest Rates, Highest Lots, Closest Walk)
 *  - Smart Detour & Diversion Optimizer (Cost Savings vs Walking Time)
 *  - Complete Carpark Rates Directory & 1-Click Google Maps Integration
 */

import L from "leaflet";

// Application State
const state = {
  // Trip Navigation State
  startLocation: {
    id: "jurong-east",
    name: "Jurong East / Jurong Gateway",
    latitude: 1.3329,
    longitude: 103.7436,
    area: "Jurong"
  },
  selectedLocation: {
    id: "mbs",
    name: "Marina Bay Sands / Bayfront",
    latitude: 1.2834,
    longitude: 103.8607,
    area: "Marina Bay"
  },
  activeDiversionId: null, // null = direct route, or CarParkID for diverted route
  
  // Filtering & Settings
  radiusKm: 1.0,
  vehicleType: "C", // C = Car, Y = Motorcycle, H = Heavy
  durationHours: 2.0,
  agencyFilter: "ALL",
  searchQuery: "",
  sortBy: "recommended", // 'recommended' | 'distance' | 'lots' | 'price'
  
  // Data retrieved from API
  locations: [],
  carparksWithinRadius: [],
  allEvaluatedCarparks: [],
  recommendations: {
    bestOverall: null,
    bestValue: null,
    closest: null,
    highestLots: null
  },
  routeData: {
    directRoute: null,
    destinationParking1Km: null,
    diversionRecommendations: null,
    activeDiversion: null
  },
  counts: {
    locationCount: 0,
    availableLotsCount: 0,
    totalLotsCapacity: 0,
    radiusKm: 1.0
  },
  lastSyncTime: null,
  syncSource: "LTA_VERIFIED_DATASET",
  
  // UI timers & state
  refreshCountdown: 60,
  countdownIntervalId: null,
  isCalculating: false,
  
  // Leaflet references
  map: null,
  startMarker: null,
  centerMarker: null,
  radiusCircle: null,
  routePolylineLayer: null,
  diversionPolylineLayer: null,
  carparkMarkersLayer: null
};

// DOM Element Cache
const elements = {
  srAnnouncements: document.getElementById("sr-announcements"),
  
  // Trip Planner & Guide elements
  startLocationSelect: document.getElementById("start-location-select"),
  swapLocationsBtn: document.getElementById("swap-locations-btn"),
  locationSelect: document.getElementById("location-select"),
  gpsBtn: document.getElementById("gps-btn"),
  durationInput: document.getElementById("duration-input"),
  durationDisplay: document.getElementById("duration-val-display"),
  radiusSelect: document.getElementById("radius-select"),
  vehicleTabs: document.querySelectorAll(".vehicle-tab-btn"),
  agencyChips: document.querySelectorAll(".agency-chip"),
  searchInput: document.getElementById("carpark-search-input"),
  sortButtons: document.querySelectorAll(".sort-btn"),
  startTripBtn: document.getElementById("start-trip-btn"),
  presetStartBtns: document.querySelectorAll(".preset-start-btn"),
  presetDestBtns: document.querySelectorAll(".preset-dest-btn"),
  
  // Driving Route Outcome Card
  routeDistanceVal: document.getElementById("route-distance-val"),
  routeDurationVal: document.getElementById("route-duration-val"),
  routeSummaryText: document.getElementById("route-summary-text"),
  routeEndpointsLabel: document.getElementById("route-endpoints-label"),
  viewStepsBtn: document.getElementById("view-steps-btn"),
  
  // Destination Parking Estimate Card
  dest1kmAvailableLots: document.getElementById("dest-1km-available-lots"),
  dest1kmFacilitiesCount: document.getElementById("dest-1km-facilities-count"),
  dest1kmOccupancyText: document.getElementById("dest-1km-occupancy-text"),
  dest1kmAvgRate: document.getElementById("dest-1km-avg-rate"),
  dest1kmLabel: document.getElementById("dest-1km-label"),
  
  // Smart Diversions
  diversionCardsContainer: document.getElementById("diversion-cards-container"),
  diversionStatusBadgeContainer: document.getElementById("diversion-status-badge-container"),
  
  // Recommendations container
  recommendationCardsContainer: document.getElementById("recommendation-cards-container"),
  
  // List container & badge
  carparkListItems: document.getElementById("carpark-list-items"),
  viewCountBadge: document.getElementById("view-count-badge"),
  mapRadiusHint: document.getElementById("map-radius-hint"),
  
  // Sync status
  syncStatusBadge: document.getElementById("sync-status-badge"),
  syncStatusText: document.getElementById("sync-status-text"),
  refreshDataBtn: document.getElementById("refresh-data-btn"),
  refreshIcon: document.getElementById("refresh-icon"),
  refreshCounter: document.getElementById("refresh-counter"),
  
  // Route steps modal dialog
  routeStepsDialog: document.getElementById("route-steps-dialog"),
  closeRouteStepsBtn: document.getElementById("close-route-steps-btn"),
  routeStepsList: document.getElementById("route-steps-list"),
  routeStepsTitle: document.getElementById("route-steps-title"),
  
  // Carpark details modal dialog
  carparkDialog: document.getElementById("carpark-details-dialog"),
  modalTitle: document.getElementById("modal-title"),
  modalArea: document.getElementById("modal-area"),
  modalAgencyBadge: document.getElementById("modal-agency-badge"),
  modalTypeBadge: document.getElementById("modal-type-badge"),
  modalBodyContent: document.getElementById("modal-body-content"),
  closeModalBtn: document.getElementById("close-modal-btn"),
  modalCloseActionBtn: document.getElementById("modal-close-action-btn"),
  modalDirectionsBtn: document.getElementById("modal-directions-btn")
};

/**
 * Screen Reader Announcement Helper for WCAG 2.1 AA
 */
function announceToScreenReader(message) {
  if (elements.srAnnouncements) {
    elements.srAnnouncements.textContent = message;
  }
}

/**
 * Initialize Leaflet Map at Top of Page
 */
function initMap() {
  const mapElement = document.getElementById("leaflet-map");
  if (!mapElement) return;

  // Center on Singapore destination
  state.map = L.map("leaflet-map", {
    center: [state.selectedLocation.latitude, state.selectedLocation.longitude],
    zoom: 14,
    zoomControl: true
  });

  // OpenStreetMap Tile Layer
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(state.map);

  // Layer groups for clean, high-performance updates
  state.routePolylineLayer = L.layerGroup().addTo(state.map);
  state.diversionPolylineLayer = L.layerGroup().addTo(state.map);
  state.carparkMarkersLayer = L.layerGroup().addTo(state.map);

  // Click on map to set custom destination coordinate
  state.map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    setCustomDestination(lat, lng, `Pinned Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
  });

  updateMapLayers();
}

/**
 * Update Map Markers, Radius Circle, and Driving Polylines
 */
function updateMapLayers() {
  if (!state.map) return;

  // 1. Start Marker (Origin)
  if (state.startMarker) state.map.removeLayer(state.startMarker);
  const startLatLng = [state.startLocation.latitude, state.startLocation.longitude];
  
  const startIcon = L.divIcon({
    className: "custom-start-pin",
    html: `
      <div class="relative flex items-center justify-center w-8 h-8 cursor-pointer">
        <span class="relative flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] border-2 border-slate-900 font-black text-xs">
          <span class="material-symbols-outlined text-sm">trip_origin</span>
        </span>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  state.startMarker = L.marker(startLatLng, { icon: startIcon, zIndexOffset: 900 })
    .addTo(state.map)
    .bindPopup(`<b>Start Point (Origin)</b><br>${state.startLocation.name}`);

  // 2. Destination Marker (Target)
  if (state.centerMarker) state.map.removeLayer(state.centerMarker);
  const destLatLng = [state.selectedLocation.latitude, state.selectedLocation.longitude];

  const destIcon = L.divIcon({
    className: "custom-dest-pin",
    html: `
      <div class="relative flex items-center justify-center w-8 h-8 cursor-pointer">
        <span class="absolute w-8 h-8 rounded-full bg-rose-500 opacity-30 ping-ring"></span>
        <span class="relative flex items-center justify-center w-7 h-7 rounded-full bg-rose-600 text-white shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] border-2 border-slate-900">
          <span class="material-symbols-outlined text-sm">location_on</span>
        </span>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });

  state.centerMarker = L.marker(destLatLng, { icon: destIcon, zIndexOffset: 1000 })
    .addTo(state.map)
    .bindPopup(`<b>Target Destination</b><br>${state.selectedLocation.name}`);

  // 3. Shaded Radius Circle around Destination
  if (state.radiusCircle) state.map.removeLayer(state.radiusCircle);
  state.radiusCircle = L.circle(destLatLng, {
    radius: state.radiusKm * 1000,
    color: "#0f172a",
    fillColor: "#3b82f6",
    fillOpacity: 0.12,
    weight: 2.5,
    dashArray: "6, 6"
  }).addTo(state.map);

  // 4. Render Route Polylines
  renderRoutePolylines();
}

/**
 * Render Driving Route Polyline & Detour Walk Legs
 */
function renderRoutePolylines() {
  if (!state.map || !state.routePolylineLayer || !state.diversionPolylineLayer) return;

  state.routePolylineLayer.clearLayers();
  state.diversionPolylineLayer.clearLayers();

  const direct = state.routeData.directRoute;
  if (!direct || !direct.coordinates || direct.coordinates.length === 0) return;

  const activeDiv = state.routeData.activeDiversion;

  if (state.activeDiversionId && activeDiv && activeDiv.route) {
    // 1. Direct route drawn as muted background line
    L.polyline(direct.coordinates, {
      color: "#94a3b8",
      weight: 4,
      dashArray: "4, 6",
      opacity: 0.7
    }).addTo(state.routePolylineLayer);

    // 2. Diversion Driving Leg (Start -> Detour Carpark)
    const driveCoords = activeDiv.route.driveLeg?.coordinates || [];
    if (driveCoords.length > 0) {
      // Outer casing line for bold high-contrast Bento style
      L.polyline(driveCoords, {
        color: "#0f172a",
        weight: 7,
        opacity: 0.95
      }).addTo(state.diversionPolylineLayer);

      // Inner color line (Amber/Orange for diversion route)
      L.polyline(driveCoords, {
        color: "#f59e0b",
        weight: 4,
        opacity: 1
      }).addTo(state.diversionPolylineLayer);
    }

    // 3. Diversion Walking Leg (Carpark -> Destination)
    const walkCoords = activeDiv.route.walkLeg?.coordinates || [];
    if (walkCoords.length > 0) {
      L.polyline(walkCoords, {
        color: "#10b981",
        weight: 4,
        dashArray: "6, 6",
        opacity: 0.95
      }).addTo(state.diversionPolylineLayer);
    }

    // Fit map bounds to encompass start, diversion carpark, and destination
    try {
      const allPoints = [...driveCoords, ...walkCoords, [state.selectedLocation.latitude, state.selectedLocation.longitude]];
      const bounds = L.latLngBounds(allPoints);
      state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    } catch (e) {
      console.warn("Could not fit diversion bounds:", e);
    }
  } else {
    // Direct route: Bold blue line with dark casing
    L.polyline(direct.coordinates, {
      color: "#0f172a",
      weight: 7,
      opacity: 0.95
    }).addTo(state.routePolylineLayer);

    L.polyline(direct.coordinates, {
      color: "#2563eb",
      weight: 4,
      opacity: 1
    }).addTo(state.routePolylineLayer);

    // Fit map bounds to show full route from start to destination
    try {
      const bounds = L.latLngBounds(direct.coordinates);
      state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
    } catch (e) {
      console.warn("Could not fit route bounds:", e);
    }
  }
}

/**
 * Set custom coordinates clicked on map as Destination
 */
function setCustomDestination(lat, lng, customName) {
  state.selectedLocation = {
    id: "custom",
    name: customName || `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
    latitude: lat,
    longitude: lng,
    area: "Singapore"
  };

  // Add custom option to select if not present
  let customOption = elements.locationSelect.querySelector("option[value='custom']");
  if (!customOption) {
    customOption = document.createElement("option");
    customOption.value = "custom";
    elements.locationSelect.appendChild(customOption);
  }
  customOption.textContent = `📍 ${state.selectedLocation.name}`;
  elements.locationSelect.value = "custom";

  state.activeDiversionId = null; // Reset active diversion on destination change
  updateMapLayers();
  fetchRouteAndCarparks();
}

/**
 * Fetch Preset Singapore Locations
 */
async function fetchLocations() {
  try {
    const res = await fetch("/api/locations");
    const data = await res.json();
    state.locations = data.locations || [];

    // Populate Start Location Dropdown
    elements.startLocationSelect.innerHTML = state.locations
      .map(
        (loc) => `
      <option value="${loc.id}" ${loc.id === state.startLocation.id ? "selected" : ""}>
        ${loc.name} (${loc.area})
      </option>
    `
      )
      .join("");

    // Populate Destination Dropdown
    elements.locationSelect.innerHTML = state.locations
      .map(
        (loc) => `
      <option value="${loc.id}" ${loc.id === state.selectedLocation.id ? "selected" : ""}>
        ${loc.name} (${loc.area})
      </option>
    `
      )
      .join("");
  } catch (error) {
    console.error("Failed to load locations:", error);
  }
}

/**
 * Main Combined API Fetcher: Route, 1KM Parking Estimate, Diversions & Radius Carparks
 */
async function fetchRouteAndCarparks() {
  const start = state.startLocation;
  const dest = state.selectedLocation;

  // Set visual calculating feedback on Start Button
  if (elements.startTripBtn) {
    elements.startTripBtn.innerHTML = `
      <span class="material-symbols-outlined text-xl animate-spin">sync</span>
      <span>Calculating Route & Finding Lots...</span>
    `;
    elements.startTripBtn.disabled = true;
  }

  // 1. Fetch Routing & Diversions API
  const routeParams = new URLSearchParams({
    startLat: start.latitude.toString(),
    startLng: start.longitude.toString(),
    destLat: dest.latitude.toString(),
    destLng: dest.longitude.toString(),
    duration: state.durationHours.toString(),
    lotType: state.vehicleType,
    ...(state.activeDiversionId ? { diversionId: state.activeDiversionId } : {})
  });

  // 2. Fetch Nearby Carparks for Radius Grid & Directory
  const nearbyParams = new URLSearchParams({
    lat: dest.latitude.toString(),
    lng: dest.longitude.toString(),
    radius: state.radiusKm.toString(),
    lotType: state.vehicleType,
    duration: state.durationHours.toString(),
    agency: state.agencyFilter
  });

  try {
    const [routeRes, nearbyRes] = await Promise.all([
      fetch(`/api/route?${routeParams.toString()}`),
      fetch(`/api/carparks/nearby?${nearbyParams.toString()}`)
    ]);

    if (routeRes.ok) {
      const routeData = await routeRes.json();
      state.routeData = routeData;
    }

    if (nearbyRes.ok) {
      const nearbyData = await nearbyRes.json();
      state.carparksWithinRadius = nearbyData.carparksWithinRadius || [];
      state.allEvaluatedCarparks = nearbyData.allEvaluatedCarparks || [];
      state.recommendations = nearbyData.recommendations || {};
      state.counts = nearbyData.counts || {
        locationCount: 0,
        availableLotsCount: 0,
        totalLotsCapacity: 0,
        radiusKm: state.radiusKm
      };
      state.lastSyncTime = nearbyData.lastSyncTime;
      state.syncSource = nearbyData.syncSource;
    }

    renderAllViews();
    announceToScreenReader(
      `Trip updated: Route from ${start.name} to ${dest.name} is ${state.routeData.directRoute?.distanceKm || 0} km. Estimated ${state.routeData.destinationParking1Km?.totalAvailableLots || 0} vacant parking lots within 1 km.`
    );
  } catch (err) {
    console.error("Error fetching trip route and carparks:", err);
  } finally {
    if (elements.startTripBtn) {
      elements.startTripBtn.innerHTML = `
        <span class="material-symbols-outlined text-xl">navigation</span>
        <span>Start Trip & Find Parking</span>
      `;
      elements.startTripBtn.disabled = false;
    }
  }
}

/**
 * Render All UI Components
 */
function renderAllViews() {
  renderTripDashboard();
  renderDiversionRecommendations();
  renderRecommendationCards();
  renderCarparkList();
  renderMapMarkers();
  renderRoutePolylines();
  renderSyncStatus();
}

/**
 * 1. Render Trip Dashboard (Shortest Route & 1 KM Destination Parking Estimate)
 */
function renderTripDashboard() {
  const direct = state.routeData.directRoute;
  const parking1Km = state.routeData.destinationParking1Km;

  // Shortest Route Metrics
  if (direct) {
    elements.routeDistanceVal.textContent = `${direct.distanceKm} km`;
    elements.routeDurationVal.textContent = `${direct.durationMins} mins`;
    elements.routeSummaryText.textContent = direct.summary || `Shortest direct route (${direct.distanceKm} km)`;
    elements.routeEndpointsLabel.textContent = `${state.startLocation.name} → ${state.selectedLocation.name}`;
  } else {
    elements.routeDistanceVal.textContent = "-- km";
    elements.routeDurationVal.textContent = "-- mins";
    elements.routeSummaryText.textContent = "Calculating driving path...";
  }

  // 1 KM Destination Parking Estimate Metrics
  if (parking1Km) {
    elements.dest1kmAvailableLots.textContent = parking1Km.totalAvailableLots.toLocaleString();
    elements.dest1kmFacilitiesCount.textContent = parking1Km.carparkCount.toLocaleString();
    elements.dest1kmOccupancyText.textContent = `Occupancy: ${parking1Km.occupancyRate}% (${parking1Km.totalCapacity.toLocaleString()} total)`;
    elements.dest1kmAvgRate.textContent = `Avg: $${parking1Km.avgEstimatedCost.toFixed(2)} / ${state.durationHours}h`;
    elements.dest1kmLabel.textContent = `Within 1.0 km of ${state.selectedLocation.name}`;
  }

  // Update map radius hint & badge
  if (elements.viewCountBadge) {
    elements.viewCountBadge.textContent = `${state.carparksWithinRadius.length} lots nearby`;
  }
  if (elements.mapRadiusHint) {
    elements.mapRadiusHint.textContent = `${state.radiusKm} km radius (${state.carparksWithinRadius.length} carparks)`;
  }
}

/**
 * 2. Render Smart Diversion Recommendations (Lowest Rate & Highest Availability)
 */
function renderDiversionRecommendations() {
  const diversions = state.routeData.diversionRecommendations;
  const activeDiv = state.routeData.activeDiversion;

  // Render active diversion badge
  if (state.activeDiversionId && activeDiv && activeDiv.carpark) {
    elements.diversionStatusBadgeContainer.innerHTML = `
      <div class="flex items-center gap-2 bg-amber-100 text-amber-900 border-2 border-amber-500 px-3 py-1 rounded-xl text-xs font-black">
        <span class="material-symbols-outlined text-sm">alt_route</span>
        <span>Active Detour: <strong>${activeDiv.carpark.Development}</strong></span>
        <button
          type="button"
          onclick="window.resetToDirectRoute()"
          class="ml-1 text-slate-900 hover:text-rose-700 underline cursor-pointer text-[11px]"
          title="Reset to shortest direct route"
        >
          Reset to Direct
        </button>
      </div>
    `;
  } else {
    elements.diversionStatusBadgeContainer.innerHTML = `
      <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">
        Detour Optimizer
      </span>
    `;
  }

  if (!diversions || (!diversions.lowestRate && !diversions.highestAvailability)) {
    elements.diversionCardsContainer.innerHTML = `
      <div class="col-span-full p-6 bg-white border-2 border-slate-900 rounded-3xl text-center text-slate-500 font-bold shadow-[3px_3px_0px_0px_rgba(15,23,42,1)]">
        <span class="material-symbols-outlined text-3xl text-slate-400 mb-1">check_circle</span>
        <p>Direct destination parking is already optimal with adequate vacant lots.</p>
      </div>
    `;
    return;
  }

  const cardsHtml = [];

  // 1. Lowest Rate Diversion Card
  if (diversions.lowestRate) {
    const cp = diversions.lowestRate;
    const isCurrentActive = state.activeDiversionId === cp.CarParkID;

    cardsHtml.push(`
      <div class="bg-white border-2 border-slate-900 rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] flex flex-col justify-between space-y-4 ${isCurrentActive ? 'ring-4 ring-amber-400 bg-amber-50/40' : ''}">
        <div class="space-y-3">
          <!-- Header Badges -->
          <div class="flex items-center justify-between gap-2">
            <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-blue-100 text-blue-900 border-2 border-blue-600 uppercase tracking-tight">
              <span class="material-symbols-outlined text-xs">savings</span>
              Lowest Rate Option
            </span>
            <span class="text-xs font-black text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-lg border border-emerald-300">
              Save ~$${cp.savingsVsAvg.toFixed(2)} vs Avg
            </span>
          </div>

          <!-- Title & Proximity -->
          <div>
            <h3 class="font-black text-lg text-slate-900 tracking-tight">
              ${cp.Development}
            </h3>
            <p class="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
              <span>${cp.Area} &bull; ${cp.Agency}</span>
              <span>&bull;</span>
              <span class="font-bold text-slate-800">${(cp.distanceKm * 1000).toFixed(0)}m from destination (~${cp.walkTimeMins}m walk)</span>
            </p>
          </div>

          <!-- Bento Metric Cells -->
          <div class="grid grid-cols-3 gap-2 pt-1 text-center">
            <div class="bg-slate-50 p-2.5 rounded-2xl border-2 border-slate-900/10">
              <span class="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block mb-0.5">${state.durationHours}h Fee</span>
              <span class="text-xl font-black text-slate-900">$${cp.estimatedCost.toFixed(2)}</span>
            </div>
            <div class="bg-slate-50 p-2.5 rounded-2xl border-2 border-slate-900/10">
              <span class="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block mb-0.5">Available Lots</span>
              <span class="text-xl font-black ${cp.AvailableLots > 30 ? 'text-emerald-600' : 'text-amber-600'}">${cp.AvailableLots}</span>
            </div>
            <div class="bg-slate-50 p-2.5 rounded-2xl border-2 border-slate-900/10">
              <span class="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block mb-0.5">Walk Leg</span>
              <span class="text-xl font-black text-blue-600">~${cp.walkTimeMins}m</span>
            </div>
          </div>

          <div class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <strong>Day Rate:</strong> ${cp.rates.weekdayDay} &bull; <span class="text-emerald-700 font-bold">${cp.rates.gracePeriodMins}m grace</span>
          </div>
        </div>

        <!-- Action Row -->
        <div class="pt-2 border-t-2 border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onclick="window.showCarparkDetails('${cp.CarParkID}')"
            class="px-3.5 py-2 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border-2 border-slate-900 rounded-xl shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer"
          >
            Rate Card
          </button>
          <button
            type="button"
            onclick="window.toggleDiversion('${cp.CarParkID}')"
            class="px-4 py-2 text-xs font-black text-white ${isCurrentActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'} border-2 border-slate-900 rounded-xl shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer flex items-center gap-1.5"
          >
            <span class="material-symbols-outlined text-sm">${isCurrentActive ? 'check_circle' : 'alt_route'}</span>
            <span>${isCurrentActive ? 'Detour Active' : 'Divert to Lowest Rate'}</span>
          </button>
        </div>
      </div>
    `);
  }

  // 2. Highest Availability Diversion Card
  if (diversions.highestAvailability) {
    const cp = diversions.highestAvailability;
    const isCurrentActive = state.activeDiversionId === cp.CarParkID;

    cardsHtml.push(`
      <div class="bg-white border-2 border-slate-900 rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] flex flex-col justify-between space-y-4 ${isCurrentActive ? 'ring-4 ring-amber-400 bg-amber-50/40' : ''}">
        <div class="space-y-3">
          <!-- Header Badges -->
          <div class="flex items-center justify-between gap-2">
            <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-900 border-2 border-emerald-600 uppercase tracking-tight">
              <span class="material-symbols-outlined text-xs">space_dashboard</span>
              Highest Availability Option
            </span>
            <span class="text-xs font-black text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-lg border border-blue-300">
              Guaranteed Lot Buffer
            </span>
          </div>

          <!-- Title & Proximity -->
          <div>
            <h3 class="font-black text-lg text-slate-900 tracking-tight">
              ${cp.Development}
            </h3>
            <p class="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-0.5">
              <span>${cp.Area} &bull; ${cp.Agency}</span>
              <span>&bull;</span>
              <span class="font-bold text-slate-800">${(cp.distanceKm * 1000).toFixed(0)}m from destination (~${cp.walkTimeMins}m walk)</span>
            </p>
          </div>

          <!-- Bento Metric Cells -->
          <div class="grid grid-cols-3 gap-2 pt-1 text-center">
            <div class="bg-slate-50 p-2.5 rounded-2xl border-2 border-slate-900/10">
              <span class="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block mb-0.5">Available Lots</span>
              <span class="text-xl font-black text-emerald-600">${cp.AvailableLots}</span>
            </div>
            <div class="bg-slate-50 p-2.5 rounded-2xl border-2 border-slate-900/10">
              <span class="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block mb-0.5">${state.durationHours}h Fee</span>
              <span class="text-xl font-black text-slate-900">$${cp.estimatedCost.toFixed(2)}</span>
            </div>
            <div class="bg-slate-50 p-2.5 rounded-2xl border-2 border-slate-900/10">
              <span class="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block mb-0.5">Walk Leg</span>
              <span class="text-xl font-black text-blue-600">~${cp.walkTimeMins}m</span>
            </div>
          </div>

          <div class="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
            <strong>Capacity:</strong> ${cp.TotalLots} lots &bull; <span class="text-slate-800 font-bold">${cp.rates.weekdayDay}</span>
          </div>
        </div>

        <!-- Action Row -->
        <div class="pt-2 border-t-2 border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onclick="window.showCarparkDetails('${cp.CarParkID}')"
            class="px-3.5 py-2 text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border-2 border-slate-900 rounded-xl shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer"
          >
            Rate Card
          </button>
          <button
            type="button"
            onclick="window.toggleDiversion('${cp.CarParkID}')"
            class="px-4 py-2 text-xs font-black text-white ${isCurrentActive ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'} border-2 border-slate-900 rounded-xl shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer flex items-center gap-1.5"
          >
            <span class="material-symbols-outlined text-sm">${isCurrentActive ? 'check_circle' : 'alt_route'}</span>
            <span>${isCurrentActive ? 'Detour Active' : 'Divert to High Lots'}</span>
          </button>
        </div>
      </div>
    `);
  }

  elements.diversionCardsContainer.innerHTML = cardsHtml.join("");
}

/**
 * Toggle / Apply Diversion Route Detour
 */
window.toggleDiversion = function (carparkId) {
  if (state.activeDiversionId === carparkId) {
    state.activeDiversionId = null; // Unselect back to direct
  } else {
    state.activeDiversionId = carparkId;
  }
  fetchRouteAndCarparks();
};

/**
 * Reset to Shortest Direct Route
 */
window.resetToDirectRoute = function () {
  state.activeDiversionId = null;
  fetchRouteAndCarparks();
};

/**
 * 3. Render Smart Recommendation Cards
 */
function renderRecommendationCards() {
  const { bestOverall, bestValue, closest, highestLots } = state.recommendations;

  if (!bestOverall) {
    elements.recommendationCardsContainer.innerHTML = `
      <div class="col-span-full p-8 bg-white border-2 border-slate-900 rounded-3xl shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] text-center text-slate-500">
        <span class="material-symbols-outlined text-4xl text-slate-400 mb-2">sentiment_dissatisfied</span>
        <p class="font-extrabold text-slate-800 text-base">No carparks found within ${state.radiusKm} km for this vehicle type.</p>
        <p class="text-xs text-slate-500 mt-1">Try expanding your search radius to 2.5 km or 5.0 km.</p>
      </div>
    `;
    return;
  }

  const recConfigs = [
    {
      title: "Top Pick",
      badge: "Best Overall Pick",
      badgeClass: "bg-emerald-100 text-emerald-900 border-2 border-emerald-600",
      bgClass: "bg-white",
      icon: "verified",
      data: bestOverall,
      desc: "Optimal balance of proximity, lots & rates"
    },
    {
      title: "Best Value",
      badge: "Lowest Rate",
      badgeClass: "bg-blue-100 text-blue-900 border-2 border-blue-600",
      bgClass: "bg-white",
      icon: "savings",
      data: bestValue || bestOverall,
      desc: `Lowest cost for ${state.durationHours}h stay`
    },
    {
      title: "Closest Walk",
      badge: "Shortest Walk",
      badgeClass: "bg-amber-100 text-amber-900 border-2 border-amber-600",
      bgClass: "bg-white",
      icon: "directions_walk",
      data: closest || bestOverall,
      desc: "Shortest walking distance to destination"
    },
    {
      title: "Highest Vacancy",
      badge: "Maximum Lots",
      badgeClass: "bg-purple-100 text-purple-900 border-2 border-purple-600",
      bgClass: "bg-white",
      icon: "space_dashboard",
      data: highestLots || bestOverall,
      desc: "Safest buffer against full occupancy"
    }
  ];

  elements.recommendationCardsContainer.innerHTML = recConfigs
    .map((rec) => {
      const cp = rec.data;
      if (!cp) return "";

      return `
      <article
        class="${rec.bgClass} border-2 border-slate-900 rounded-3xl p-5 shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[6px_6px_0px_0px_rgba(15,23,42,1)] transition flex flex-col justify-between space-y-4 cursor-pointer group focus-within:ring-2 focus-within:ring-blue-600"
        onclick="window.showCarparkDetails('${cp.CarParkID}')"
        tabindex="0"
        role="button"
        aria-label="${rec.title}: ${cp.Development}, ${cp.AvailableLots} lots available, distance ${cp.distanceKm} kilometers, estimated cost $${cp.estimatedCost.toFixed(2)}"
        onkeydown="if(event.key === 'Enter' || event.key === ' '){ window.showCarparkDetails('${cp.CarParkID}'); event.preventDefault(); }"
      >
        <div class="space-y-3">
          <!-- Card Header / Badges -->
          <div class="flex items-center justify-between gap-2">
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-tight ${rec.badgeClass}">
              <span class="material-symbols-outlined text-xs">${rec.icon}</span>
              ${rec.badge}
            </span>
            <span class="text-slate-400 text-[10px] font-mono font-bold uppercase tracking-tighter truncate max-w-[80px]">
              ID: ${cp.CarParkID}
            </span>
          </div>

          <!-- Carpark Title & Location -->
          <div>
            <h3 class="font-black text-lg text-slate-900 group-hover:text-blue-600 transition line-clamp-1 tracking-tight">
              ${cp.Development}
            </h3>
            <div class="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
              <span class="material-symbols-outlined text-sm text-slate-400">near_me</span>
              <span>${(cp.distanceKm * 1000).toFixed(0)}m away (${cp.walkTimeMins}m walk)</span>
            </div>
          </div>

          <!-- Key Bento Stats Metric Blocks -->
          <div class="grid grid-cols-2 gap-2.5 pt-1">
            <div class="bg-slate-50 p-3 rounded-2xl border-2 border-slate-900/10">
              <div class="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider mb-0.5">Available Lots</div>
              <div class="text-2xl font-black ${cp.AvailableLots > 30 ? 'text-emerald-600' : cp.AvailableLots >= 5 ? 'text-amber-600' : 'text-rose-600'}">
                ${cp.AvailableLots}
              </div>
            </div>
            <div class="bg-slate-50 p-3 rounded-2xl border-2 border-slate-900/10">
              <div class="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider mb-0.5">${state.durationHours}h Rate</div>
              <div class="text-2xl font-black text-slate-900">
                $${cp.estimatedCost.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        <!-- Footer / Action button -->
        <div class="pt-2 border-t-2 border-slate-100 flex items-center justify-between">
          <span class="text-[11px] text-slate-500 font-semibold truncate max-w-[130px]" title="${cp.rates.weekdayDay}">
            ${cp.rates.weekdayDay}
          </span>
          <button
            type="button"
            class="px-3 py-1.5 bg-slate-900 text-white text-xs font-black rounded-xl hover:bg-slate-800 shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] transition flex items-center gap-1"
          >
            <span>Rate Card</span>
            <span class="material-symbols-outlined text-xs">arrow_forward</span>
          </button>
        </div>
      </article>
    `;
    })
    .join("");
}

/**
 * 4. Render Carpark Directory & Rates List
 */
function renderCarparkList() {
  let list = [...state.carparksWithinRadius];

  // Search keyword filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(
      (cp) =>
        cp.Development.toLowerCase().includes(q) ||
        cp.Area.toLowerCase().includes(q) ||
        cp.CarParkID.toLowerCase().includes(q)
    );
  }

  // Sort list
  if (state.sortBy === "distance") {
    list.sort((a, b) => a.distanceKm - b.distanceKm);
  } else if (state.sortBy === "lots") {
    list.sort((a, b) => b.AvailableLots - a.AvailableLots);
  } else if (state.sortBy === "price") {
    list.sort((a, b) => a.estimatedCost - b.estimatedCost);
  } else {
    // recommended
    list.sort((a, b) => b.overallScore - a.overallScore);
  }

  if (list.length === 0) {
    elements.carparkListItems.innerHTML = `
      <div class="col-span-full p-8 bg-white border-2 border-slate-900 rounded-3xl shadow-[4px_4px_0px_0px_rgba(15,23,42,1)] text-center text-slate-500">
        <span class="material-symbols-outlined text-4xl text-slate-400 mb-2">search_off</span>
        <p class="font-black text-slate-800 text-base">No carparks found matching your filters.</p>
        <p class="text-xs text-slate-400 mt-1">Try expanding radius or resetting search keywords.</p>
      </div>
    `;
    return;
  }

  elements.carparkListItems.innerHTML = list
    .map((cp, idx) => {
      const lotBadgeClass =
        cp.AvailableLots > 30
          ? "badge-available-high"
          : cp.AvailableLots >= 5
          ? "badge-available-med"
          : "badge-available-low";

      const occupancyRate = cp.TotalLots > 0 ? Math.round(((cp.TotalLots - cp.AvailableLots) / cp.TotalLots) * 100) : 0;

      return `
      <article
        class="bg-white rounded-3xl p-4 sm:p-5 border-2 border-slate-900 shadow-[3px_3px_0px_0px_rgba(15,23,42,1)] hover:shadow-[5px_5px_0px_0px_rgba(15,23,42,1)] transition space-y-3.5"
        aria-labelledby="cp-title-${cp.CarParkID}"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="space-y-1.5 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-lg text-xs font-black bg-slate-900 text-white">
                #${idx + 1}
              </span>
              <span class="px-2.5 py-0.5 rounded-lg text-xs font-black bg-blue-50 text-blue-900 border border-blue-300">
                ${cp.Agency}
              </span>
              ${
                cp.hasEVCharging
                  ? `<span class="px-2.5 py-0.5 rounded-lg text-xs font-black bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                      <span class="material-symbols-outlined text-xs">ev_station</span> EV
                     </span>`
                  : ""
              }
            </div>
            <h3 id="cp-title-${cp.CarParkID}" class="font-black text-lg text-slate-900 tracking-tight">
              ${cp.Development}
            </h3>
            <p class="text-xs text-slate-500 flex items-center gap-2 font-medium">
              <span>${cp.Area}</span> &bull;
              <span class="font-bold text-slate-800">${(cp.distanceKm * 1000).toFixed(0)}m from destination (~${cp.walkTimeMins}m walk)</span>
            </p>
          </div>

          <!-- Live Available Lots Pill -->
          <div class="text-right flex-shrink-0">
            <div class="px-3 py-1.5 rounded-2xl ${lotBadgeClass} text-right shadow-[1px_1px_0px_0px_rgba(15,23,42,1)]">
              <span class="text-lg font-black block leading-tight">${cp.AvailableLots}</span>
              <span class="text-[8px] uppercase font-black tracking-wider block">Available</span>
            </div>
            <span class="text-[10px] text-slate-400 font-bold mt-1 block">${occupancyRate}% full</span>
          </div>
        </div>

        <!-- Parking Rates Details Grid -->
        <div class="bg-slate-50 rounded-2xl p-3.5 border-2 border-slate-900/10 text-xs space-y-2">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Weekday Daytime</span>
              <span class="text-slate-900 font-bold">${cp.rates.weekdayDay}</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Evening / Overnight</span>
              <span class="text-slate-900 font-bold">${cp.rates.weekdayEvening}</span>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-200">
            <div>
              <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Sunday & PH</span>
              <span class="text-slate-900 font-bold">${cp.rates.sundayPh}</span>
            </div>
            <div>
              <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Grace Period</span>
              <span class="text-emerald-700 font-extrabold">${cp.rates.gracePeriodMins} mins grace</span>
            </div>
          </div>
        </div>

        <!-- Action Row -->
        <div class="flex items-center justify-between pt-1 text-xs">
          <div class="flex items-center gap-1.5 font-bold text-slate-700">
            <span class="material-symbols-outlined text-base text-emerald-600">price_check</span>
            <span>Est. ${state.durationHours}h Fee:</span>
            <span class="text-slate-900 text-sm font-black">$${cp.estimatedCost.toFixed(2)}</span>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick="window.centerOnCarpark(${cp.latitude}, ${cp.longitude}, '${cp.CarParkID}')"
              class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-900 bg-white border-2 border-slate-900 hover:bg-slate-100 shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer transition"
              aria-label="Locate ${cp.Development} on map"
            >
              Locate
            </button>
            <button
              type="button"
              onclick="window.showCarparkDetails('${cp.CarParkID}')"
              class="px-3.5 py-1.5 rounded-xl text-xs font-black text-white bg-blue-600 hover:bg-blue-700 border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] cursor-pointer transition flex items-center gap-1"
            >
              Full Rates
            </button>
          </div>
        </div>
      </article>
    `;
    })
    .join("");
}

/**
 * 5. Render Interactive Leaflet Map Pins
 */
function renderMapMarkers() {
  if (!state.carparkMarkersLayer) return;

  state.carparkMarkersLayer.clearLayers();

  const list = state.carparksWithinRadius;

  list.forEach((cp) => {
    const lotBgColor =
      cp.AvailableLots > 30 ? "#059669" : cp.AvailableLots >= 5 ? "#d97706" : "#dc2626";

    // Custom HTML Pin with Available Lot count badge
    const markerHtml = `
      <div class="flex flex-col items-center cursor-pointer transform hover:scale-110 transition">
        <div class="px-2 py-0.5 rounded-full text-white font-black text-[11px] shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] border-2 border-slate-900 flex items-center gap-1" style="background-color: ${lotBgColor}">
          <span class="material-symbols-outlined text-[10px]">local_parking</span>
          ${cp.AvailableLots}
        </div>
        <div class="w-2 h-2 rotate-45 -mt-1 border-r-2 border-b-2 border-slate-900" style="background-color: ${lotBgColor}"></div>
      </div>
    `;

    const icon = L.divIcon({
      className: "custom-carpark-marker",
      html: markerHtml,
      iconSize: [44, 30],
      iconAnchor: [22, 28]
    });

    L.marker([cp.latitude, cp.longitude], { icon })
      .addTo(state.carparkMarkersLayer)
      .bindPopup(`
        <div class="text-xs space-y-2 p-1">
          <div class="font-black text-sm text-slate-900">${cp.Development}</div>
          <div class="text-slate-500 font-medium">${cp.Area} &bull; ${cp.Agency}</div>
          <div class="flex items-center justify-between pt-1 border-t-2 border-slate-100">
            <span class="font-extrabold text-emerald-700">${cp.AvailableLots} Lots Free</span>
            <span class="font-bold text-slate-900">${(cp.distanceKm * 1000).toFixed(0)}m</span>
          </div>
          <div class="text-slate-700"><strong>Rates:</strong> ${cp.rates.weekdayDay}</div>
          <div class="pt-1 flex gap-1.5">
            <button
              type="button"
              onclick="window.showCarparkDetails('${cp.CarParkID}')"
              class="flex-1 px-3 py-1.5 bg-blue-600 text-white font-black rounded-xl border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] hover:bg-blue-700 text-center block cursor-pointer"
            >
              Rate Card
            </button>
            <button
              type="button"
              onclick="window.toggleDiversion('${cp.CarParkID}')"
              class="px-3 py-1.5 bg-amber-500 text-slate-900 font-black rounded-xl border-2 border-slate-900 shadow-[2px_2px_0px_0px_rgba(15,23,42,1)] hover:bg-amber-600 text-center block cursor-pointer"
              title="Divert trip to this carpark"
            >
              Divert
            </button>
          </div>
        </div>
      `);
  });
}

/**
 * 6. Update LTA DataMall Connection Status
 */
function renderSyncStatus() {
  if (state.syncSource === "LTA_DATAMALL_LIVE") {
    elements.syncStatusBadge.className =
      "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-50 text-emerald-900 border-2 border-emerald-600";
    elements.syncStatusText.textContent = "LTA LIVE ACTIVE";
  } else {
    elements.syncStatusBadge.className =
      "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black bg-blue-50 text-blue-900 border-2 border-blue-600";
    elements.syncStatusText.textContent = "LTA VERIFIED DATASET";
  }
}

/**
 * 7. Center Map on specific carpark
 */
window.centerOnCarpark = function (lat, lng, carparkId) {
  if (state.map) {
    state.map.setView([lat, lng], 17);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

/**
 * 8. Open Route Steps Modal Dialog
 */
function openRouteStepsDialog() {
  const direct = state.routeData.directRoute;
  if (!direct || !direct.steps) return;

  elements.routeStepsTitle.textContent = `Steps: ${state.startLocation.name} → ${state.selectedLocation.name}`;

  elements.routeStepsList.innerHTML = direct.steps
    .map(
      (step, idx) => `
    <div class="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border-2 border-slate-900/10">
      <div class="w-6 h-6 rounded-full bg-blue-600 text-white font-black text-xs flex items-center justify-center flex-shrink-0">
        ${idx + 1}
      </div>
      <div class="flex-1">
        <p class="font-bold text-slate-900 text-xs">${step.instruction}</p>
        <div class="flex items-center gap-3 text-[11px] text-slate-500 mt-1 font-semibold">
          <span>${step.distanceM >= 1000 ? `${(step.distanceM / 1000).toFixed(1)} km` : `${step.distanceM} m`}</span>
          <span>&bull;</span>
          <span>~${Math.max(1, Math.round(step.durationS / 60))} min</span>
        </div>
      </div>
    </div>
  `
    )
    .join("");

  if (typeof elements.routeStepsDialog.showModal === "function") {
    elements.routeStepsDialog.showModal();
  }
}

/**
 * 9. Show Modal Details for Carpark
 */
window.showCarparkDetails = function (carparkId) {
  const carpark = state.allEvaluatedCarparks.find((cp) => cp.CarParkID === carparkId) ||
    state.carparksWithinRadius.find((cp) => cp.CarParkID === carparkId);

  if (!carpark) return;

  elements.modalTitle.textContent = carpark.Development;
  elements.modalArea.textContent = `${carpark.Area} • ID: ${carpark.CarParkID}`;
  elements.modalAgencyBadge.textContent = carpark.Agency;
  elements.modalTypeBadge.textContent =
    carpark.LotType === "C" ? "Cars" : carpark.LotType === "Y" ? "Motorcycles" : "Heavy Vehicles";

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${state.startLocation.latitude},${state.startLocation.longitude}&destination=${carpark.latitude},${carpark.longitude}`;
  elements.modalDirectionsBtn.href = googleMapsUrl;

  const lotBadgeClass =
    carpark.AvailableLots > 30
      ? "badge-available-high"
      : carpark.AvailableLots >= 5
      ? "badge-available-med"
      : "badge-available-low";

  elements.modalBodyContent.innerHTML = `
    <!-- Live Availability Header Block -->
    <div class="flex items-center justify-between p-5 rounded-2xl ${lotBadgeClass} shadow-[2px_2px_0px_0px_rgba(15,23,42,1)]">
      <div>
        <span class="text-[10px] uppercase font-black tracking-wider block">Live Vacancy</span>
        <span class="text-3xl font-black">${carpark.AvailableLots} Available</span>
      </div>
      <div class="text-right">
        <span class="text-xs font-bold block">Capacity: ${carpark.TotalLots} Lots</span>
        <span class="text-xs font-black block">${((carpark.AvailableLots / Math.max(1, carpark.TotalLots)) * 100).toFixed(0)}% Vacant</span>
      </div>
    </div>

    <!-- Distance & Walk info from current pin -->
    <div class="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border-2 border-slate-900/10">
      <div>
        <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Distance to Destination</span>
        <span class="font-black text-slate-900 text-base">${(carpark.distanceKm * 1000).toFixed(0)} meters</span>
      </div>
      <div>
        <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Estimated Walk</span>
        <span class="font-black text-slate-900 text-base">~${carpark.walkTimeMins} minutes</span>
      </div>
    </div>

    <!-- Rates Breakdown Matrix -->
    <div class="space-y-2">
      <h4 class="font-black text-slate-900 text-sm flex items-center gap-1.5">
        <span class="material-symbols-outlined text-base text-blue-600">payments</span>
        Official Parking Rates Matrix
      </h4>
      <div class="border-2 border-slate-900 rounded-2xl overflow-hidden divide-y-2 divide-slate-100 text-xs">
        <div class="p-3.5 bg-white flex justify-between gap-2">
          <span class="font-bold text-slate-500">Weekday Daytime:</span>
          <span class="font-black text-slate-900 text-right">${carpark.rates.weekdayDay}</span>
        </div>
        <div class="p-3.5 bg-slate-50 flex justify-between gap-2">
          <span class="font-bold text-slate-500">Weekday Evening / Night:</span>
          <span class="font-black text-slate-900 text-right">${carpark.rates.weekdayEvening}</span>
        </div>
        <div class="p-3.5 bg-white flex justify-between gap-2">
          <span class="font-bold text-slate-500">Saturday Rate:</span>
          <span class="font-black text-slate-900 text-right">${carpark.rates.saturday}</span>
        </div>
        <div class="p-3.5 bg-slate-50 flex justify-between gap-2">
          <span class="font-bold text-slate-500">Sunday & Public Holidays:</span>
          <span class="font-black text-slate-900 text-right">${carpark.rates.sundayPh}</span>
        </div>
        <div class="p-3.5 bg-white flex justify-between gap-2">
          <span class="font-bold text-slate-500">Grace Period:</span>
          <span class="font-black text-emerald-700 text-right">${carpark.rates.gracePeriodMins} Minutes (Free Exit)</span>
        </div>
        ${
          carpark.rates.freeParkingWindow
            ? `<div class="p-3.5 bg-emerald-50 flex justify-between gap-2 text-emerald-900">
                <span class="font-bold">Free Parking Window:</span>
                <span class="font-black text-right">${carpark.rates.freeParkingWindow}</span>
               </div>`
            : ""
        }
      </div>
    </div>

    <!-- Facility Attributes -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
      <div class="p-3 rounded-2xl border-2 border-slate-900/10 bg-slate-50">
        <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Height Limit</span>
        <span class="font-black text-slate-900">${carpark.heightLimit ? `${carpark.heightLimit} meters` : "Standard 2.0m"}</span>
      </div>
      <div class="p-3 rounded-2xl border-2 border-slate-900/10 bg-slate-50">
        <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">EV Charging</span>
        <span class="font-black text-slate-900">${carpark.hasEVCharging ? "Available" : "None"}</span>
      </div>
      <div class="p-3 rounded-2xl border-2 border-slate-900/10 bg-slate-50">
        <span class="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Coordinates</span>
        <span class="font-mono font-bold text-slate-900">${carpark.latitude.toFixed(3)}, ${carpark.longitude.toFixed(3)}</span>
      </div>
    </div>
  `;

  if (typeof elements.carparkDialog.showModal === "function") {
    elements.carparkDialog.showModal();
  }
};

/**
 * Event Listeners & Interactive Handlers
 */
function setupEventListeners() {
  // 1. Primary Action: Start Trip Button
  if (elements.startTripBtn) {
    elements.startTripBtn.addEventListener("click", () => {
      fetchRouteAndCarparks();
      // Scroll smoothly to the outcome section
      const outcomeElem = document.getElementById("outcome-heading");
      if (outcomeElem) {
        outcomeElem.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // 2. Start Location Select Change
  elements.startLocationSelect.addEventListener("change", (e) => {
    const locId = e.target.value;
    const found = state.locations.find((l) => l.id === locId);
    if (found) {
      state.startLocation = found;
      updateMapLayers();
      fetchRouteAndCarparks();
    }
  });

  // 3. Destination Location Select Change
  elements.locationSelect.addEventListener("change", (e) => {
    const locId = e.target.value;
    const found = state.locations.find((l) => l.id === locId);
    if (found) {
      state.selectedLocation = found;
      state.activeDiversionId = null;
      updateMapLayers();
      fetchRouteAndCarparks();
    }
  });

  // 4. Quick Preset Start Buttons
  elements.presetStartBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetId = btn.getAttribute("data-preset-start");
      const found = state.locations.find((l) => l.id === presetId);
      if (found) {
        state.startLocation = found;
        elements.startLocationSelect.value = presetId;
        updateMapLayers();
        fetchRouteAndCarparks();
      }
    });
  });

  // 5. Quick Preset Destination Buttons
  elements.presetDestBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetId = btn.getAttribute("data-preset-dest");
      const found = state.locations.find((l) => l.id === presetId);
      if (found) {
        state.selectedLocation = found;
        state.activeDiversionId = null;
        elements.locationSelect.value = presetId;
        updateMapLayers();
        fetchRouteAndCarparks();
      }
    });
  });

  // 6. Swap Start Point & Destination Button
  elements.swapLocationsBtn.addEventListener("click", () => {
    const temp = state.startLocation;
    state.startLocation = state.selectedLocation;
    state.selectedLocation = temp;

    elements.startLocationSelect.value = state.startLocation.id;
    elements.locationSelect.value = state.selectedLocation.id;

    state.activeDiversionId = null;
    updateMapLayers();
    fetchRouteAndCarparks();
  });

  // 7. GPS Button for Start Point
  elements.gpsBtn.addEventListener("click", () => {
    if ("geolocation" in navigator) {
      elements.gpsBtn.innerHTML = `<span class="material-symbols-outlined text-xs animate-spin">sync</span> Locating...`;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          elements.gpsBtn.innerHTML = `<span class="material-symbols-outlined text-xs text-emerald-600">my_location</span> Use GPS`;
          state.startLocation = {
            id: "gps-start",
            name: "My GPS Location",
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            area: "Singapore"
          };

          let customOption = elements.startLocationSelect.querySelector("option[value='gps-start']");
          if (!customOption) {
            customOption = document.createElement("option");
            customOption.value = "gps-start";
            elements.startLocationSelect.appendChild(customOption);
          }
          customOption.textContent = `📍 My GPS Location (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`;
          elements.startLocationSelect.value = "gps-start";

          updateMapLayers();
          fetchRouteAndCarparks();
        },
        (err) => {
          elements.gpsBtn.innerHTML = `<span class="material-symbols-outlined text-xs text-emerald-600">my_location</span> Use GPS`;
          console.warn("GPS Geolocation error:", err.message);
          alert("Could not access your GPS location. Please check browser location permissions or choose a preset location.");
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      alert("Geolocation is not supported in this browser.");
    }
  });

  // 8. Radius Select Change
  elements.radiusSelect.addEventListener("change", (e) => {
    state.radiusKm = parseFloat(e.target.value) || 1.0;
    updateMapLayers();
    fetchRouteAndCarparks();
  });

  // 9. Vehicle Type Radio Buttons
  elements.vehicleTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.vehicleTabs.forEach((b) => {
        b.setAttribute("aria-checked", "false");
        b.className = "vehicle-tab-btn px-1.5 py-1 text-[11px] font-bold rounded-md text-slate-600 hover:text-slate-900 transition cursor-pointer";
      });
      btn.setAttribute("aria-checked", "true");
      btn.className = "vehicle-tab-btn px-1.5 py-1 text-[11px] font-extrabold rounded-md bg-blue-600 text-white transition cursor-pointer";
      state.vehicleType = btn.getAttribute("data-type") || "C";
      fetchRouteAndCarparks();
    });
  });

  // 10. Stay Duration Slider
  elements.durationInput.addEventListener("input", (e) => {
    const hours = parseFloat(e.target.value) || 2.0;
    state.durationHours = hours;
    elements.durationDisplay.textContent = `${hours.toFixed(1)} hrs`;
    fetchRouteAndCarparks();
  });

  // 11. Agency Filter Chips
  elements.agencyChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      elements.agencyChips.forEach((c) => {
        c.className = "agency-chip px-2.5 py-1 rounded-lg border-2 border-slate-900 bg-white text-slate-700 font-bold hover:bg-slate-100 shadow-[1px_1px_0px_0px_rgba(15,23,42,1)] cursor-pointer text-[11px]";
      });
      chip.className = "agency-chip px-2.5 py-1 rounded-lg border-2 border-slate-900 bg-blue-600 text-white font-extrabold shadow-[1px_1px_0px_0px_rgba(15,23,42,1)] cursor-pointer text-[11px]";
      state.agencyFilter = chip.getAttribute("data-agency") || "ALL";
      fetchRouteAndCarparks();
    });
  });

  // 12. Search Input
  elements.searchInput.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderCarparkList();
  });

  // 13. Sort Buttons
  elements.sortButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.sortButtons.forEach((b) => {
        b.className = "sort-btn px-2.5 py-1 rounded-lg border-2 border-slate-900 bg-white text-slate-700 font-bold hover:bg-slate-100 shadow-[1px_1px_0px_0px_rgba(15,23,42,1)] cursor-pointer text-xs";
      });
      btn.className = "sort-btn px-2.5 py-1 rounded-lg border-2 border-slate-900 bg-blue-600 text-white font-extrabold shadow-[1px_1px_0px_0px_rgba(15,23,42,1)] cursor-pointer text-xs";
      state.sortBy = btn.getAttribute("data-sort") || "recommended";
      renderCarparkList();
    });
  });

  // 14. View Route Steps Modal Button
  elements.viewStepsBtn.addEventListener("click", () => {
    openRouteStepsDialog();
  });

  elements.closeRouteStepsBtn.addEventListener("click", () => {
    elements.routeStepsDialog.close();
  });

  // 15. Manual Refresh Button
  elements.refreshDataBtn.addEventListener("click", async () => {
    elements.refreshIcon.classList.add("animate-spin");
    state.refreshCountdown = 60;
    try {
      await fetch("/api/carparks/sync", { method: "POST" });
      await fetchRouteAndCarparks();
      await fetchTrafficIncidentsAndTrainAlerts();
    } finally {
      setTimeout(() => {
        elements.refreshIcon.classList.remove("animate-spin");
      }, 500);
    }
  });

  // 16. Carpark Modal Close Handlers
  elements.closeModalBtn.addEventListener("click", () => {
    elements.carparkDialog.close();
  });
  elements.modalCloseActionBtn.addEventListener("click", () => {
    elements.carparkDialog.close();
  });
  elements.carparkDialog.addEventListener("click", (e) => {
    const dialogDimensions = elements.carparkDialog.getBoundingClientRect();
    if (
      e.clientX < dialogDimensions.left ||
      e.clientX > dialogDimensions.right ||
      e.clientY < dialogDimensions.top ||
      e.clientY > dialogDimensions.bottom
    ) {
      elements.carparkDialog.close();
    }
  });

  // 17. Bus Arrival Check Button & Input
  const fetchBusBtn = document.getElementById("fetch-bus-btn");
  const busStopInput = document.getElementById("bus-stop-code-input");
  if (fetchBusBtn && busStopInput) {
    fetchBusBtn.addEventListener("click", () => {
      const code = busStopInput.value.trim();
      if (code) fetchBusArrivals(code);
    });
    busStopInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const code = busStopInput.value.trim();
        if (code) fetchBusArrivals(code);
      }
    });
  }
}

/**
 * Fetch and render LTA Traffic Incidents & Train Alerts
 */
async function fetchTrafficIncidentsAndTrainAlerts() {
  const incidentsListEl = document.getElementById("traffic-incidents-list");
  const mrtPillEl = document.getElementById("mrt-status-pill");

  try {
    const [incidentsRes, trainRes] = await Promise.all([
      fetch("/api/lta/traffic-incidents").then((r) => r.json()),
      fetch("/api/lta/train-alerts").then((r) => r.json())
    ]);

    // Update MRT Status
    if (mrtPillEl && trainRes) {
      const isNormal = trainRes.status === 1;
      mrtPillEl.className = `text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${
        isNormal
          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
          : "bg-rose-100 text-rose-800 border-rose-300 animate-pulse"
      }`;
      mrtPillEl.textContent = isNormal ? "MRT All Lines Normal" : "MRT Service Alert";
    }

    // Render Traffic Incidents
    if (incidentsListEl) {
      const incidents = incidentsRes?.incidents || [];
      if (incidents.length === 0) {
        incidentsListEl.innerHTML = `
          <div class="p-3.5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-emerald-900 font-bold text-xs flex items-center gap-2">
            <span class="material-symbols-outlined text-emerald-600 text-base">check_circle</span>
            <span>No major expressway accidents or road closures reported at this time.</span>
          </div>
        `;
        return;
      }

      incidentsListEl.innerHTML = incidents.slice(0, 4).map((inc) => {
        let typeBadge = "bg-amber-100 text-amber-900 border-amber-300";
        if (inc.Type?.toLowerCase().includes("accident")) {
          typeBadge = "bg-rose-100 text-rose-900 border-rose-300";
        } else if (inc.Type?.toLowerCase().includes("roadwork")) {
          typeBadge = "bg-blue-100 text-blue-900 border-blue-300";
        }

        return `
          <div class="p-3 bg-slate-50 border-2 border-slate-900/10 rounded-2xl hover:border-slate-900/30 transition">
            <div class="flex items-center justify-between gap-2 mb-1">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-black border ${typeBadge} uppercase tracking-wider">
                ${inc.Type || "Incident"}
              </span>
              <span class="text-[10px] font-bold text-slate-400">LTA Realtime</span>
            </div>
            <p class="text-xs text-slate-800 font-medium leading-relaxed">${inc.Message || "Slow traffic advisory in effect."}</p>
          </div>
        `;
      }).join("");
    }
  } catch (err) {
    console.warn("Error fetching traffic incidents:", err);
  }
}

/**
 * Fetch and render LTA Bus Arrivals (v3)
 */
async function fetchBusArrivals(busStopCode = "83139") {
  const busListEl = document.getElementById("bus-arrivals-list");
  if (!busListEl) return;

  busListEl.innerHTML = `
    <div class="p-3 bg-slate-50 border-2 border-slate-900/10 rounded-2xl animate-pulse text-slate-500 font-bold text-xs">
      Querying LTA v3 BusArrival for stop ${busStopCode}...
    </div>
  `;

  try {
    const res = await fetch(`/api/lta/bus-arrival?BusStopCode=${encodeURIComponent(busStopCode)}`);
    const json = await res.json();
    const services = json?.data?.Services || [];

    if (services.length === 0) {
      busListEl.innerHTML = `
        <div class="p-3.5 bg-slate-50 border-2 border-slate-900/10 rounded-2xl text-slate-600 font-bold text-xs">
          No active bus services found for stop code "${busStopCode}".
        </div>
      `;
      return;
    }

    const formatEta = (isoString) => {
      if (!isoString) return "-";
      const diffMs = new Date(isoString).getTime() - Date.now();
      const diffMins = Math.round(diffMs / 60000);
      if (diffMins <= 0) return "Arr";
      return `${diffMins}m`;
    };

    const getLoadColor = (load) => {
      if (load === "SEA") return "bg-emerald-100 text-emerald-800 border-emerald-300"; // Seats Avail
      if (load === "SDA") return "bg-amber-100 text-amber-800 border-amber-300"; // Standing Avail
      if (load === "LSD") return "bg-rose-100 text-rose-800 border-rose-300"; // Limited Standing
      return "bg-slate-100 text-slate-800 border-slate-300";
    };

    busListEl.innerHTML = services.slice(0, 5).map((s) => {
      const eta1 = formatEta(s.NextBus?.EstimatedArrival);
      const eta2 = formatEta(s.NextBus2?.EstimatedArrival);
      const eta3 = formatEta(s.NextBus3?.EstimatedArrival);
      const load1 = s.NextBus?.Load || "SEA";
      const type1 = s.NextBus?.Type === "DD" ? "Double Deck" : "Single Deck";

      return `
        <div class="p-2.5 bg-slate-50 border-2 border-slate-900/10 rounded-2xl flex items-center justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <span class="w-10 h-8 flex items-center justify-center bg-blue-600 text-white font-black text-xs rounded-xl border-2 border-slate-900 shadow-[1px_1px_0px_0px_rgba(15,23,42,1)]">
              ${s.ServiceNo}
            </span>
            <div>
              <span class="text-[10px] font-bold text-slate-500 block uppercase">${s.Operator || "SBST"} &bull; ${type1}</span>
              <span class="text-[10px] font-extrabold px-1.5 py-0.2 rounded border ${getLoadColor(load1)}">
                ${load1 === 'SEA' ? 'Seats Avail' : load1 === 'SDA' ? 'Standing' : 'Crowded'}
              </span>
            </div>
          </div>
          
          <div class="flex items-center gap-1.5 font-black text-xs">
            <span class="px-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-900 font-black shadow-xs">${eta1}</span>
            <span class="px-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-600 text-[11px]">${eta2}</span>
            <span class="px-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-400 text-[11px]">${eta3}</span>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    busListEl.innerHTML = `
      <div class="p-3 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-800 font-bold text-xs">
        Failed to fetch bus arrivals for stop ${busStopCode}.
      </div>
    `;
  }
}

/**
 * 60-Second Auto-Poll & Refresh Timer
 */
function startRefreshTimer() {
  state.countdownIntervalId = setInterval(() => {
    state.refreshCountdown--;
    if (state.refreshCountdown <= 0) {
      state.refreshCountdown = 60;
      fetchRouteAndCarparks();
      fetchTrafficIncidentsAndTrainAlerts();
    }
    if (elements.refreshCounter) {
      elements.refreshCounter.textContent = `${state.refreshCountdown}s`;
    }
  }, 1000);
}

/**
 * App Bootstrapper
 */
async function bootstrap() {
  initMap();
  setupEventListeners();
  await fetchLocations();
  await fetchRouteAndCarparks();
  await Promise.all([
    fetchTrafficIncidentsAndTrainAlerts(),
    fetchBusArrivals("83139")
  ]);
  startRefreshTimer();
}

// Start application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
