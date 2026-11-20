"use strict";

const { ALLOWED_ORIGIN } = require("./nav-policy");

const SONY_VENDOR_ID = 0x054c;
const DUALSENSE_PRODUCT_IDS = new Set([
  0x0ce6, // DualSense
  0x0df2, // DualSense Edge
]);

const LOGITECH_VENDOR_ID = 0x046d;
const LOGITECH_HIDPP_PRODUCT_IDS = new Set([
  0xc262, // G920 Xbox (HID++)
  0xc26e, // G923 Xbox (HID++)
]);

const LOGITECH_WHEEL_PRODUCT_IDS = new Set([
  ...LOGITECH_HIDPP_PRODUCT_IDS,
  0xc299, // G25
  0xc29b, // G27
  0xc29a, // Driving Force GT
  0xc24f, // G29 / G923 PlayStation
]);

const THRUSTMASTER_VENDOR_ID = 0x044f;
const THRUSTMASTER_WHEEL_PRODUCT_IDS = new Set([
  0xb66e, // T300RS
  0xb66f, // T300RS GT
  0xb66d, // T300 Ferrari
  0xb696, // T248
  0xb669, // TX
  0xb692, // T-GT II
  0xb689, // TS-PC / TS-XW
]);

const USAGE_PAGE_GENERIC_DESKTOP = 0x01;
const USAGE_JOYSTICK = 0x04;
const USAGE_GAMEPAD = 0x05;
const USAGE_MULTI_AXIS = 0x08;
const USAGE_PAGE_PID = 0x0f;
const USAGE_PAGE_LOGITECH_HIDPP = 0xff00;

/**
 * True only when the origin/URL string belongs to https://librecorsa.org.
 * @param {unknown} originOrUrl
 * @returns {boolean}
 */
function isAllowedOrigin(originOrUrl) {
  if (typeof originOrUrl !== "string" || originOrUrl.length === 0) return false;
  if (originOrUrl === ALLOWED_ORIGIN) return true;
  try {
    return new URL(originOrUrl).origin === ALLOWED_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Flatten top-level and nested HID collections up to a safe depth.
 * @param {unknown} collections
 * @returns {Array<{ usagePage?: number, usage?: number, outputReports?: unknown[] }>}
 */
function flattenCollections(collections) {
  const out = [];
  if (!Array.isArray(collections)) return out;
  const stack = collections.slice();
  const seen = new Set();
  while (stack.length > 0 && out.length < 256) {
    const col = stack.pop();
    if (!col || typeof col !== "object" || seen.has(col)) continue;
    seen.add(col);
    out.push(col);
    if (Array.isArray(col.children)) {
      for (const child of col.children) stack.push(child);
    }
  }
  return out;
}

/**
 * True when the HID device is a Sony DualSense pad or a known racing wheel.
 * @param {{ vendorId?: number, productId?: number } | null | undefined} device
 * @returns {boolean}
 */
function isDualSense(device) {
  return (
    Boolean(device) &&
    device.vendorId === SONY_VENDOR_ID &&
    DUALSENSE_PRODUCT_IDS.has(device.productId)
  );
}

/**
 * True when the VID/PID matches a known LibreCorsa racing wheel interface.
 * @param {{ vendorId?: number, productId?: number } | null | undefined} device
 * @returns {boolean}
 */
function isKnownWheelIds(device) {
  if (!device) return false;
  if (
    device.vendorId === LOGITECH_VENDOR_ID &&
    LOGITECH_WHEEL_PRODUCT_IDS.has(device.productId)
  ) {
    return true;
  }
  if (
    device.vendorId === THRUSTMASTER_VENDOR_ID &&
    THRUSTMASTER_WHEEL_PRODUCT_IDS.has(device.productId)
  ) {
    return true;
  }
  return false;
}

/**
 * True when collections indicate a gamepad, joystick, multi-axis controller,
 * or HID Physical Interface Device (force feedback). Excludes keyboards,
 * mice, headsets, and security keys.
 * @param {{ collections?: unknown[] } | null | undefined} device
 * @returns {boolean}
 */
function hasGamepadOrWheelUsage(device) {
  const cols = flattenCollections(device && device.collections);
  for (const col of cols) {
    if (col.usagePage === USAGE_PAGE_PID) return true;
    if (
      col.usagePage === USAGE_PAGE_GENERIC_DESKTOP &&
      (col.usage === USAGE_JOYSTICK ||
        col.usage === USAGE_GAMEPAD ||
        col.usage === USAGE_MULTI_AXIS)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Restrict WebHID grants to DualSense controllers, known racing wheels,
 * and standard HID gamepads / joysticks / multi-axis / PID force-feedback devices.
 * @param {{ vendorId?: number, productId?: number, collections?: unknown[] } | null | undefined} device
 * @returns {boolean}
 */
function isAllowedHidDevice(device) {
  if (!device || typeof device !== "object") return false;
  return isDualSense(device) || isKnownWheelIds(device) || hasGamepadOrWheelUsage(device);
}

/**
 * Score a HID interface when select-hid-device receives multiple candidates.
 * Multi-interface wheels expose both an input-only interface and an FFB/PID
 * or output-report interface; higher score wins.
 * @param {{ vendorId?: number, productId?: number, collections?: unknown[] }} device
 * @returns {number}
 */
function scoreHidDevice(device) {
  let score = 0;
  const cols = flattenCollections(device.collections);
  let hasPid = false;
  let hasHidpp = false;
  let hasOutput = false;
  let hasJoystickOrMultiAxis = false;
  let hasGamepad = false;

  for (const col of cols) {
    if (col.usagePage === USAGE_PAGE_PID) hasPid = true;
    if (col.usagePage === USAGE_PAGE_LOGITECH_HIDPP) hasHidpp = true;
    if (Array.isArray(col.outputReports) && col.outputReports.length > 0) hasOutput = true;
    if (col.usagePage === USAGE_PAGE_GENERIC_DESKTOP) {
      if (col.usage === USAGE_JOYSTICK || col.usage === USAGE_MULTI_AXIS) {
        hasJoystickOrMultiAxis = true;
      } else if (col.usage === USAGE_GAMEPAD) {
        hasGamepad = true;
      }
    }
  }

  if (hasPid) score += 100;
  if (isKnownWheelIds(device)) score += 60;
  if (hasOutput) score += isDualSense(device) ? 5 : 50;
  if (
    hasHidpp &&
    device.vendorId === LOGITECH_VENDOR_ID &&
    LOGITECH_HIDPP_PRODUCT_IDS.has(device.productId)
  ) {
    score += 25;
  }
  if (hasJoystickOrMultiAxis) score += 20;
  if (isDualSense(device) || hasGamepad) score += 15;
  return score;
}

/**
 * Pick the best allowed HID device for select-hid-device without a picker dialog.
 * Returns null if the origin is not https://librecorsa.org or no allowed device matches.
 * @param {unknown} deviceList
 * @param {unknown} frameUrl
 * @returns {any | null}
 */
function pickPreferredHidDevice(deviceList, frameUrl) {
  if (!isAllowedOrigin(frameUrl) || !Array.isArray(deviceList)) return null;
  let best = null;
  let bestScore = -1;
  for (const device of deviceList) {
    if (!isAllowedHidDevice(device)) continue;
    const score = scoreHidDevice(device);
    if (score > bestScore) {
      bestScore = score;
      best = device;
    }
  }
  return best;
}

module.exports = {
  isAllowedOrigin,
  isDualSense,
  isKnownWheelIds,
  hasGamepadOrWheelUsage,
  isAllowedHidDevice,
  scoreHidDevice,
  pickPreferredHidDevice,
};
