/**
 * Cellular & Network Positioning Service
 * 
 * Provides an authorized, configurable interface for resolving cell-tower observations
 * and network-derived positioning.
 * 
 * Legitimate Android & Telecom Reality:
 * 1. Raw cell tower identifiers (MCC, MNC, LAC/TAC, CellId/CID) represent physical radio base
 *    station antennas, NOT geographical coordinates. Translating cell towers to (latitude, longitude)
 *    requires a licensed positioning database/service (e.g. Google Geolocation API or OpenCellID).
 * 2. When Android master Location Services is turned OFF by the user, Android OS hardware-level
 *    security blocks TelephonyManager cell info queries (returns empty or SecurityException).
 * 3. This service NEVER fabricates coordinates. If no valid coordinates can be derived,
 *    the status is marked as 'UNAVAILABLE' with the specific interruption reason.
 */

// Supported configurable providers
const PROVIDERS = {
  ANDROID_NETWORK: 'ANDROID_NETWORK', // Legitimate Android fused/network provider (default)
  OPENCELLID: 'OPENCELLID',           // OpenCellID API (requires API key)
  GOOGLE: 'GOOGLE_GEOLOCATION',       // Google Geolocation API (requires API key)
};

// Supported normalized location sources
const VALID_SOURCES = ['GPS', 'NETWORK', 'CELL_TOWER', 'LAST_KNOWN'];

// Supported normalized location statuses
const VALID_STATUSES = ['LIVE', 'APPROXIMATE', 'STALE', 'UNAVAILABLE'];

/**
 * Normalize and validate location source
 */
function normalizeLocationSource(source, accuracy = null) {
  if (!source) {
    if (accuracy !== null && accuracy > 100) return 'NETWORK';
    return 'GPS';
  }
  const upper = String(source).trim().toUpperCase();
  if (upper === 'CELL_TOWER' || upper === 'CELL_NETWORK' || upper === 'CELL') return 'CELL_TOWER';
  if (upper === 'NETWORK' || upper === 'FUSED' || upper === 'ANDROID_NETWORK' || upper === 'WIFI') return 'NETWORK';
  if (VALID_SOURCES.includes(upper)) return upper;
  return 'GPS';
}

/**
 * Normalize and validate location status
 */
function normalizeLocationStatus(status) {
  if (!status) return 'LIVE';
  const upper = String(status).trim().toUpperCase();
  if (VALID_STATUSES.includes(upper)) return upper;
  return 'LIVE';
}

/**
 * Determine location status based on source, age, accuracy, and device status
 */
function evaluateLocationStatus({
  locationSource,
  timestamp,
  accuracy,
  isGpsOff = false,
  locationServicesEnabled = true,
  staleThresholdMinutes = 5,
}) {
  // If location services are disabled, status is strictly UNAVAILABLE
  if (isGpsOff || locationServicesEnabled === false || locationServicesEnabled === 0) {
    return 'UNAVAILABLE';
  }

  // Check age of coordinates
  if (timestamp) {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageMinutes = ageMs / (1000 * 60);
    if (ageMinutes > staleThresholdMinutes) {
      return 'STALE';
    }
  }

  // Network / Cell Tower coordinates or low accuracy are marked APPROXIMATE
  if (locationSource === 'NETWORK' || locationSource === 'CELL_TOWER' || (accuracy && accuracy > 50)) {
    return 'APPROXIMATE';
  }

  if (locationSource === 'LAST_KNOWN') {
    return 'STALE';
  }

  return 'LIVE';
}

/**
 * Resolve coordinates from Cell Tower identifiers via configured external provider
 * (where permitted and configured)
 */
async function resolveCellTowerCoordinates({
  mcc,
  mnc,
  lac,
  cellId,
  signalStrength,
  networkType = 'LTE',
}) {
  const provider = process.env.CELLULAR_PROVIDER || PROVIDERS.ANDROID_NETWORK;

  // If no external service configured or using standard Android network location
  if (provider === PROVIDERS.ANDROID_NETWORK || (!process.env.OPENCELLID_API_KEY && !process.env.GOOGLE_GEOLOCATION_API_KEY)) {
    return {
      success: false,
      provider: PROVIDERS.ANDROID_NETWORK,
      reason: 'No external cell triangulation key configured. Using Android Fused/Network location provider.',
    };
  }

  // 1. OpenCellID integration (when API key is provided)
  if (provider === PROVIDERS.OPENCELLID && process.env.OPENCELLID_API_KEY) {
    try {
      const url = `https://opencellid.org/cell/get?key=${process.env.OPENCELLID_API_KEY}&mcc=${mcc}&mnc=${mnc}&lac=${lac}&cellid=${cellId}&format=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data && data.lat && data.lon) {
        return {
          success: true,
          latitude: parseFloat(data.lat),
          longitude: parseFloat(data.lon),
          accuracy: parseFloat(data.range || 500),
          locationSource: 'CELL_TOWER',
          locationStatus: 'APPROXIMATE',
          provider: PROVIDERS.OPENCELLID,
        };
      }
    } catch (err) {
      console.warn('OpenCellID lookup warning:', err.message);
    }
  }

  // 2. Google Geolocation API integration (when API key is provided)
  if (provider === PROVIDERS.GOOGLE && process.env.GOOGLE_GEOLOCATION_API_KEY) {
    try {
      const url = `https://www.googleapis.com/geolocation/v1/geolocate?key=${process.env.GOOGLE_GEOLOCATION_API_KEY}`;
      const payload = {
        cellTowers: [
          {
            cellId: parseInt(cellId, 10),
            locationAreaCode: parseInt(lac, 10),
            mobileCountryCode: parseInt(mcc, 10),
            mobileNetworkCode: parseInt(mnc, 10),
            signalStrength: signalStrength || -80,
          },
        ],
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (data && data.location) {
        return {
          success: true,
          latitude: data.location.lat,
          longitude: data.location.lng,
          accuracy: data.accuracy || 800,
          locationSource: 'CELL_TOWER',
          locationStatus: 'APPROXIMATE',
          provider: PROVIDERS.GOOGLE,
        };
      }
    } catch (err) {
      console.warn('Google Geolocation lookup warning:', err.message);
    }
  }

  return {
    success: false,
    provider,
    reason: 'Cell triangulation service lookup failed or returned no match.',
  };
}

module.exports = {
  PROVIDERS,
  VALID_SOURCES,
  VALID_STATUSES,
  normalizeLocationSource,
  normalizeLocationStatus,
  evaluateLocationStatus,
  resolveCellTowerCoordinates,
};
