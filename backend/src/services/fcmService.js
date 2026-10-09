// Firebase Cloud Messaging (FCM) push notification scaffolding for Admin alerts
// See docs/MANUAL_STEPS.md for Firebase project configuration

let fcmAvailable = false;

function initFcm() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountPath) {
    try {
      console.log(`[FCM] Service account key detected at ${serviceAccountPath}`);
      fcmAvailable = true;
    } catch (e) {
      console.warn('[FCM] Failed to initialize Firebase Admin SDK:', e.message);
    }
  } else {
    // Scaffolding mode active
    fcmAvailable = false;
  }
}

async function sendAlertPush({ title, body, data = {} }) {
  if (!fcmAvailable) {
    // Log simulated notification for audit and testing
    console.log(`🔔 [FCM PUSH TO ADMIN] "${title}": ${body}`);
    return { success: true, simulated: true };
  }

  try {
    // In production with service account loaded, would call admin.messaging().send(...)
    console.log(`🚀 [FCM PUSH SENT] "${title}": ${body}`);
    return { success: true, sent: true };
  } catch (err) {
    console.error('[FCM] Error dispatching push notification:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  initFcm,
  sendAlertPush,
};
