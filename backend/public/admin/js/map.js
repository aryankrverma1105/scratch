/**
 * Sologix Admin - Leaflet Map Integration Module
 * Manages:
 * 1. Live Employee Tracking Map (with office boundaries and telemetry)
 * 2. Office Geofence Boundary Picker Map (with radius circle slider)
 */

let liveMap = null;
let liveMarkersLayer = null;
let liveOfficesLayer = null;
let showOfficesOnLiveMap = true;

let pickerMap = null;
let pickerMarker = null;
let pickerCircle = null;

// Initialize Live Tracking Map
function initLiveMap() {
  const container = document.getElementById('live-map-view');
  if (!container || liveMap) return;

  // Default centered at Ranchi / India coordinates
  liveMap = L.map('live-map-view').setView([23.3441, 85.309563], 13);

  // Carto Voyager tile layer with authenticated API key
  L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_52zk_1_7ea6294b28eba94d5b65b071', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20
  }).addTo(liveMap);

  liveMarkersLayer = L.layerGroup().addTo(liveMap);
  liveOfficesLayer = L.layerGroup().addTo(liveMap);

  // Map controls
  const recenterBtn = document.getElementById('map-recenter-btn');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', centerLiveMap);
  }

  const toggleOfficesBtn = document.getElementById('map-toggle-offices-btn');
  if (toggleOfficesBtn) {
    toggleOfficesBtn.addEventListener('click', () => {
      showOfficesOnLiveMap = !showOfficesOnLiveMap;
      toggleOfficesBtn.classList.toggle('active', showOfficesOnLiveMap);
      if (showOfficesOnLiveMap) {
        liveMap.addLayer(liveOfficesLayer);
      } else {
        liveMap.removeLayer(liveOfficesLayer);
      }
    });
  }

  refreshLiveMapData();
}

// Refresh Live Tracking Data
async function refreshLiveMapData() {
  if (!liveMap) return;

  try {
    const data = await apiRequest('/api/admin/live-locations');
    const employees = data.employees || [];
    const offices = data.offices || [];

    liveMarkersLayer.clearLayers();
    liveOfficesLayer.clearLayers();

    // 1. Draw office boundary circles
    offices.forEach(off => {
      if (!off.latitude || !off.longitude) return;
      const lat = parseFloat(off.latitude);
      const lng = parseFloat(off.longitude);
      const radius = parseFloat(off.radius_meters || 100);

      const circle = L.circle([lat, lng], {
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.15,
        weight: 2,
        radius: radius,
      });

      circle.bindPopup(`
        <div style="font-family: inherit; font-size: 13px;">
          <strong style="color: #60a5fa; font-size: 14px;">${escapeHtml(off.office_name)}</strong><br>
          <span style="color: #94a3b8;">${escapeHtml(off.address || 'No address')}</span><br>
          <div style="margin-top: 6px;">
            <strong>Radius:</strong> ${radius} metres<br>
            <strong>Status:</strong> ${off.status === 'active' ? '<span style="color: #34d399;">Active Geofence</span>' : '<span style="color: #f87171;">Inactive</span>'}
          </div>
        </div>
      `);
      liveOfficesLayer.addLayer(circle);

      // Office center icon
      const officeIcon = L.divIcon({
        className: 'office-custom-marker',
        html: `<div style="background: #1e3a8a; border: 2px solid #60a5fa; width: 14px; height: 14px; border-radius: 50%;"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });
      const marker = L.marker([lat, lng], { icon: officeIcon });
      liveOfficesLayer.addLayer(marker);
    });

    // 2. Draw employee markers
    const bounds = [];
    employees.forEach(emp => {
      if (!emp.latitude || !emp.longitude) return;
      const lat = parseFloat(emp.latitude);
      const lng = parseFloat(emp.longitude);
      bounds.push([lat, lng]);

      // Marker color logic
      let markerColor = '#10b981'; // Green inside
      let statusLabel = 'Inside Geofence';

      if (emp.review_status === 'pending_review' || emp.geofence_status === 'outside') {
        markerColor = '#f59e0b'; // Amber review/outside
        statusLabel = 'Outside Geofence (Review)';
      } else if (!emp.is_active_session) {
        markerColor = '#64748b'; // Gray checked out
        statusLabel = 'Checked Out';
      }

      const empIcon = L.divIcon({
        className: 'employee-custom-marker',
        html: `
          <div style="
            background: ${markerColor};
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: 2px solid #ffffff;
            box-shadow: 0 0 8px ${markerColor};
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
            color: #000;">
          </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const marker = L.marker([lat, lng], { icon: empIcon });
      const batteryStr = emp.battery_percentage !== null ? `${emp.battery_percentage}%` : 'N/A';
      const sourceStr = emp.location_source || 'GPS';
      const accuracyStr = emp.accuracy ? `${Math.round(emp.accuracy)}m` : 'N/A';

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 13px; min-width: 180px;">
          <strong style="font-size: 14px;">${escapeHtml(emp.employee_name || 'Employee')}</strong><br>
          <span style="color: #94a3b8; font-size: 12px;">ID: ${emp.employee_id || emp.id} | ${escapeHtml(emp.department || 'General')}</span>
          <hr style="border: 0; border-top: 1px solid #334155; margin: 8px 0;">
          <div style="line-height: 1.6;">
            <strong>Status:</strong> <span style="color: ${markerColor}; font-weight: bold;">${statusLabel}</span><br>
            <strong>Nearest Office:</strong> ${escapeHtml(emp.office_name || 'None')}<br>
            <strong>Distance:</strong> ${emp.distance_from_office ? Math.round(emp.distance_from_office) + 'm' : 'N/A'}<br>
            <strong>Source:</strong> ${sourceStr} (Acc: ${accuracyStr})<br>
            <strong>Battery:</strong> ${batteryStr}<br>
            <strong>APK Version:</strong> v${escapeHtml(emp.user_app_version || emp.app_version || '1.0 (Not reported)')}<br>
            <strong>Last Update:</strong> ${emp.last_update_ist || emp.updated_at || 'Just now'}
          </div>
        </div>
      `);
      liveMarkersLayer.addLayer(marker);
    });

    if (bounds.length > 0 && !window._mapCenteredOnce) {
      liveMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      window._mapCenteredOnce = true;
    }
  } catch (err) {
    console.error('Failed to load live map data:', err);
  }
}

function centerLiveMap() {
  if (!liveMap || !liveMarkersLayer) return;
  const layers = liveMarkersLayer.getLayers();
  if (layers.length === 0) {
    liveMap.setView([23.3441, 85.309563], 13);
    return;
  }
  const group = L.featureGroup(layers);
  liveMap.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 15 });
}

// Initialize Office Picker Map in the Editor
function initOfficePickerMap() {
  const container = document.getElementById('office-picker-map');
  if (!container) return;

  if (pickerMap) {
    pickerMap.invalidateSize();
    return;
  }

  const defaultLat = 23.3441;
  const defaultLng = 85.309563;

  pickerMap = L.map('office-picker-map').setView([defaultLat, defaultLng], 14);

  L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_52zk_1_7ea6294b28eba94d5b65b071', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20
  }).addTo(pickerMap);

  pickerMarker = L.marker([defaultLat, defaultLng], { draggable: true }).addTo(pickerMap);
  pickerCircle = L.circle([defaultLat, defaultLng], {
    color: '#3b82f6',
    fillColor: '#3b82f6',
    fillOpacity: 0.2,
    weight: 2,
    radius: 150
  }).addTo(pickerMap);

  // Click on map to place pin
  pickerMap.on('click', (e) => {
    updatePickerLocation(e.latlng.lat, e.latlng.lng);
  });

  // Drag marker
  pickerMarker.on('dragend', (e) => {
    const latlng = e.target.getLatLng();
    updatePickerLocation(latlng.lat, latlng.lng);
  });

  // Slider change
  const radiusSlider = document.getElementById('office-radius');
  if (radiusSlider) {
    radiusSlider.addEventListener('input', (e) => {
      const radius = parseFloat(e.target.value);
      const display = document.getElementById('radius-val-display');
      if (display) display.textContent = `${radius} m`;
      if (pickerCircle) pickerCircle.setRadius(radius);
    });
  }

  // Inputs change
  const latInput = document.getElementById('office-lat');
  const lngInput = document.getElementById('office-lng');
  if (latInput && lngInput) {
    const onCoordChange = () => {
      const lat = parseFloat(latInput.value);
      const lng = parseFloat(lngInput.value);
      if (!isNaN(lat) && !isNaN(lng)) {
        updatePickerLocation(lat, lng, false);
      }
    };
    latInput.addEventListener('change', onCoordChange);
    lngInput.addEventListener('change', onCoordChange);
  }
}

function updatePickerLocation(lat, lng, updateInputs = true) {
  const roundedLat = parseFloat(lat.toFixed(6));
  const roundedLng = parseFloat(lng.toFixed(6));

  if (pickerMarker) pickerMarker.setLatLng([roundedLat, roundedLng]);
  if (pickerCircle) pickerCircle.setLatLng([roundedLat, roundedLng]);

  if (updateInputs) {
    const latInput = document.getElementById('office-lat');
    const lngInput = document.getElementById('office-lng');
    if (latInput) latInput.value = roundedLat;
    if (lngInput) lngInput.value = roundedLng;
  }
}

function setPickerMapCoords(lat, lng, radius) {
  if (!pickerMap) initOfficePickerMap();
  const validLat = parseFloat(lat) || 23.3441;
  const validLng = parseFloat(lng) || 85.309563;
  const validRadius = parseFloat(radius) || 150;

  updatePickerLocation(validLat, validLng, true);
  if (pickerCircle) pickerCircle.setRadius(validRadius);
  pickerMap.setView([validLat, validLng], 14);
}

