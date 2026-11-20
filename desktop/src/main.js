"use strict";

const path = require("node:path");
const { app, BrowserWindow, Menu, screen, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { APP_URL, decideNavigation } = require("./nav-policy");
const { isAllowedHidDevice, isAllowedOrigin, pickPreferredHidDevice } = require("./hid-policy");

const ALLOWED_PERMISSIONS = new Set([
  "hid",
  "fullscreen",
  "pointerLock",
  "clipboard-sanitized-write",
]);

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Prefer discrete GPU on multi-GPU laptops before Chromium initializes GPU process.
app.commandLine.appendSwitch("force_high_performance_gpu");

if (process.platform === "win32") {
  app.setAppUserModelId("org.librecorsa.desktop");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function toggleFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
}

function buildAppMenu() {
  const isMac = process.platform === "darwin";
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Fullscreen",
          accelerator: "F11",
          registerAccelerator: false,
          click: () => toggleFullscreen(),
        },
        ...(isMac ? [{ role: "togglefullscreen" }] : []),
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
      ],
    },
    ...(isMac
      ? [
          {
            label: "Window",
            submenu: [{ role: "minimize" }, { role: "close" }],
          },
        ]
      : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Configure session permissions and silent WebHID grants for DualSense and racing wheels.
 * @param {Electron.Session} ses
 */
function configureSessionSecurity(ses) {
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const origin = (details && details.securityOrigin) || requestingOrigin;
    return (
      !(details && details.embeddingOrigin) &&
      isAllowedOrigin(origin) &&
      ALLOWED_PERMISSIONS.has(permission)
    );
  });

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || (webContents && webContents.getURL()) || "";
    const isMainFrame = !details || details.isMainFrame !== false;
    callback(isMainFrame && isAllowedOrigin(origin) && ALLOWED_PERMISSIONS.has(permission));
  });

  ses.setDevicePermissionHandler((details) => {
    return (
      details.deviceType === "hid" &&
      isAllowedOrigin(details.origin) &&
      isAllowedHidDevice(details.device)
    );
  });

  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const frameUrl = details.frame ? details.frame.url : "";
    const chosen = pickPreferredHidDevice(details.deviceList, frameUrl);
    callback(chosen ? chosen.deviceId : undefined);
  });
}

/**
 * Lock down navigation and popups for any WebContents created by this app.
 * @param {Electron.WebContents} contents
 */
function attachNavigationGuards(contents) {
  const guardNavigation = (event, url) => {
    const { allowInApp, openExternal } = decideNavigation(url);
    if (!allowInApp) {
      event.preventDefault();
      if (openExternal) {
        void shell.openExternal(url);
      }
    }
  };

  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);

  contents.setWindowOpenHandler(({ url }) => {
    const { allowInApp, openExternal } = decideNavigation(url);
    if (openExternal) {
      void shell.openExternal(url);
    } else if (allowInApp && mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(url);
    }
    return { action: "deny" };
  });
}

function createMainWindow() {
  const { width: workW, height: workH } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1920, Math.max(1024, Math.round(workW * 0.9)));
  const height = Math.min(1080, Math.max(640, Math.round(workH * 0.9)));

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 540,
    title: "LibreCorsa",
    backgroundColor: "#08090D",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "F11" &&
      !input.isAutoRepeat &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift
    ) {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
    // Ignore benign aborted navigations (-3) and non-main-frame subresource errors.
    if (!isMainFrame || errorCode === -3) return;
    if (validatedURL.startsWith("file://")) return;
    void win.loadFile(path.join(__dirname, "offline.html"));
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = win;
  void win.loadURL(APP_URL);
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (err) => {
    console.error("[updater]", err && err.message ? err.message : err);
  });

  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[updater]", err && err.message ? err.message : err);
    });
  };

  setTimeout(check, 5000).unref();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS).unref();
}

app.on("web-contents-created", (_event, contents) => {
  attachNavigationGuards(contents);
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  buildAppMenu();
  configureSessionSecurity(session.defaultSession);
  createMainWindow();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
