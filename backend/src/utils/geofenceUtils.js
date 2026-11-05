/**
 * Geofencing and Distance Calculation Utilities
 * Uses standard Haversine formula on WGS84 ellipsoid
 */

/**
 * Calculates the great-circle distance between two points on the Earth in meters.
 * @param {number} lat1 Latitude of point 1 in degrees
 * @param {number} lon1 Longitude of point 1 in degrees
 * @param {number} lat2 Latitude of point 2 in degrees
 * @param {number} lon2 Longitude of point 2 in degrees
 * @returns {number} Distance in meters rounded to 2 decimal places
 */
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const p1Lat = parseFloat(lat1);
  const p1Lon = parseFloat(lon1);
  const p2Lat = parseFloat(lat2);
  const p2Lon = parseFloat(lon2);

  if (isNaN(p1Lat) || isNaN(p1Lon) || isNaN(p2Lat) || isNaN(p2Lon)) {
    return Infinity;
  }

  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const phi1 = toRad(p1Lat);
  const phi2 = toRad(p2Lat);
  const deltaPhi = toRad(p2Lat - p1Lat);
  const deltaLambda = toRad(p2Lon - p1Lon);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;

  return Math.round(d * 100) / 100;
}

/**
 * Checks whether an office is assigned/applicable to an employee
 * @param {object} office Office database row
 * @param {object} user User database row
 * @returns {boolean}
 */
function isOfficeAuthorizedForUser(office, user) {
  if (!office || office.status !== 'active') return false;
  if (!user) return true;

  // 1. Check user ID assignment if configured
  if (office.assigned_user_ids) {
    try {
      const uids = typeof office.assigned_user_ids === 'string'
        ? JSON.parse(office.assigned_user_ids)
        : office.assigned_user_ids;
      if (Array.isArray(uids) && uids.length > 0) {
        if (uids.map(Number).includes(Number(user.id))) {
          return true;
        }
      }
    } catch (_) {}
  }

  // 2. Check department assignment if configured
  if (office.assigned_departments && user.department) {
    try {
      const depts = typeof office.assigned_departments === 'string'
        ? JSON.parse(office.assigned_departments)
        : office.assigned_departments;
      if (Array.isArray(depts) && depts.length > 0) {
        const userDeptClean = user.department.trim().toLowerCase();
        if (depts.some((d) => String(d).trim().toLowerCase() === userDeptClean)) {
          return true;
        }
      }
    } catch (_) {}
  }

  // 3. If no specific restrictions are set, office is open to all employees
  const hasUserRestriction = Boolean(office.assigned_user_ids && office.assigned_user_ids !== '[]' && office.assigned_user_ids !== '');
  const hasDeptRestriction = Boolean(office.assigned_departments && office.assigned_departments !== '[]' && office.assigned_departments !== '');

  return !hasUserRestriction && !hasDeptRestriction;
}

/**
 * Evaluates whether an employee's coordinates fall inside an authorized active office geofence.
 *
 * @param {object} params
 * @param {number} params.latitude Employee's current latitude
 * @param {number} params.longitude Employee's current longitude
 * @param {number} [params.accuracy] Location accuracy in meters
 * @param {string} [params.locationSource] 'GPS', 'NETWORK', 'FUSED', or 'LAST_KNOWN'
 * @param {object} params.user Employee user record
 * @param {Array<object>} params.activeOffices List of active offices
 * @returns {object} Evaluation result
 */
function evaluateGeofence({ latitude, longitude, accuracy = null, locationSource = 'GPS', user = null, activeOffices = [] }) {
  if (!activeOffices || activeOffices.length === 0) {
    return {
      isInside: true,
      nearestOffice: null,
      distanceFromNearest: 0,
      permittedRadius: 0,
      geofenceResult: 'NO_ACTIVE_GEOFENCE',
      isLowAccuracy: false,
      message: 'No active office geofences configured; check-in allowed directly.',
    };
  }

  // Filter to offices authorized for this user
  let candidateOffices = activeOffices.filter((o) => isOfficeAuthorizedForUser(o, user));
  // If user-specific filtering yields no offices, fallback to all active offices
  if (candidateOffices.length === 0) {
    candidateOffices = activeOffices.filter((o) => o.status === 'active');
  }

  if (candidateOffices.length === 0) {
    return {
      isInside: true,
      nearestOffice: null,
      distanceFromNearest: 0,
      permittedRadius: 0,
      geofenceResult: 'NO_ACTIVE_GEOFENCE',
      isLowAccuracy: false,
      message: 'No active authorized office geofence found; check-in permitted.',
    };
  }

  let nearestOffice = null;
  let minDistance = Infinity;

  for (const office of candidateOffices) {
    const dist = calculateDistanceMeters(latitude, longitude, office.latitude, office.longitude);
    if (dist < minDistance) {
      minDistance = dist;
      nearestOffice = office;
    }
  }

  const radius = nearestOffice ? (parseFloat(nearestOffice.radius_meters) || 100.0) : 100.0;
  const isInside = minDistance <= radius;
  const isLowAccuracy = accuracy !== null && accuracy !== undefined && parseFloat(accuracy) > 200;

  let geofenceResult = isInside ? 'INSIDE' : 'OUTSIDE';
  if (locationSource === 'LAST_KNOWN') {
    geofenceResult = 'STALE_LOCATION';
  }

  return {
    isInside: isInside && locationSource !== 'LAST_KNOWN',
    nearestOffice,
    distanceFromNearest: minDistance,
    permittedRadius: radius,
    geofenceResult,
    isLowAccuracy,
    locationSource,
    accuracy: accuracy ? parseFloat(accuracy) : null,
    message: isInside
      ? `Within authorized geofence for ${nearestOffice.office_name} (${Math.round(minDistance)}m / ${radius}m).`
      : `Outside authorized geofence for ${nearestOffice.office_name} (${Math.round(minDistance)}m, limit ${radius}m). Submitted for review.`,
  };
}

module.exports = {
  calculateDistanceMeters,
  isOfficeAuthorizedForUser,
  evaluateGeofence,
};

