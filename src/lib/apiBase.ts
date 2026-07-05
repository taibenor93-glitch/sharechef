// Backend base URLs. Empty on the website (same-origin);
// points to Railway inside the native iOS app.
const isNativeApp = window.location.protocol === 'capacitor:'
export const API_BASE = isNativeApp ? 'https://sharechef-production.up.railway.app' : ''
export const WS_BASE = isNativeApp
  ? 'wss://sharechef-production.up.railway.app'
  : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
