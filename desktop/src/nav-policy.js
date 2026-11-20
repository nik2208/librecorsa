"use strict";

const APP_URL = "https://librecorsa.org/play";
const ALLOWED_ORIGIN = "https://librecorsa.org";

/**
 * Parse a URL string safely, returning null for malformed input.
 * @param {unknown} rawUrl
 * @returns {URL | null}
 */
function parseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

/**
 * True only for HTTPS URLs on librecorsa.org.
 * @param {unknown} rawUrl
 * @returns {boolean}
 */
function isAllowedAppUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  return url !== null && url.origin === ALLOWED_ORIGIN;
}

/**
 * True for http(s) URLs outside librecorsa.org, which should open in the OS browser.
 * Dangerous schemes (file:, javascript:, smb:, etc.) return false.
 * @param {unknown} rawUrl
 * @returns {boolean}
 */
function isExternalBrowserUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  if (url === null) return false;
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return url.origin !== ALLOWED_ORIGIN;
}

/**
 * Decide how the Electron main window should handle a navigation or popup target.
 * @param {unknown} rawUrl
 * @returns {{ allowInApp: boolean, openExternal: boolean }}
 */
function decideNavigation(rawUrl) {
  if (isAllowedAppUrl(rawUrl)) {
    return { allowInApp: true, openExternal: false };
  }
  if (isExternalBrowserUrl(rawUrl)) {
    return { allowInApp: false, openExternal: true };
  }
  return { allowInApp: false, openExternal: false };
}

module.exports = {
  APP_URL,
  ALLOWED_ORIGIN,
  isAllowedAppUrl,
  isExternalBrowserUrl,
  decideNavigation,
};
