// Electron main process. Runs the cashish Next.js app in-process (it needs a
// Node server for SQLite + server actions) and shows it in a native macOS
// window. The renderer is tagged with a custom User-Agent so the web app knows
// it's running on the desktop and applies the desktop skin — the hosted web
// build is byte-for-byte the same and never sees that UA.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");

const APP_UA_TAG = "CashishDesktop/1.0";
let serverPort = null;
let win = null;

const LOADING_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{height:100%;margin:0}
  body{background:#f7f5ef;color:#10221b;display:grid;place-items:center;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       -webkit-app-region:drag}
  .wrap{display:flex;flex-direction:column;align-items:center;gap:18px}
  .mark{width:64px;height:64px;border-radius:16px;background:#0f7b5f;
        display:grid;place-items:center;box-shadow:0 8px 30px rgba(16,34,27,.18)}
  .mark svg{width:34px;height:34px;stroke:#fff;fill:none;stroke-width:1.8}
  .name{font-size:20px;font-weight:700;letter-spacing:-.01em}
  .spin{width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(16,34,27,.15);
        border-top-color:#0f7b5f;animation:s .8s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
</style></head><body><div class="wrap">
  <div class="mark"><svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/>
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg></div>
  <div class="name">cashish</div><div class="spin"></div>
</div></body></html>`)}`;

async function startNext() {
  process.env.NODE_ENV = "production";
  const userData = app.getPath("userData");
  // Keep all writable data out of the read-only app bundle.
  process.env.DATABASE_URL = path.join(userData, "cashish.db");
  process.env.CASHISH_DATA_DIR = userData;

  const dir = app.getAppPath();
  const next = require("next");
  const nextApp = next({ dev: false, dir });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handle(req, res));
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      serverPort = server.address().port;
      resolve();
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} ${APP_UA_TAG}`);
  win.once("ready-to-show", () => win.show());
  win.loadURL(LOADING_HTML);

  // External links (e.g. receipt files opened in new tab) go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http") && !url.includes(`127.0.0.1:${serverPort}`)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(async () => {
  createWindow();

  // Dev fast-path: load an already-running `next dev` server instead of
  // starting one in-process. Used by `npm run electron:dev`.
  if (process.env.CASHISH_DEV_URL) {
    if (win) win.loadURL(process.env.CASHISH_DEV_URL);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    return;
  }

  try {
    await startNext();
    if (win) win.loadURL(`http://127.0.0.1:${serverPort}/`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to start cashish server:", err);
    if (win) {
      win.loadURL(
        `data:text/html,<body style="font-family:sans-serif;padding:40px;color:#c0492f">` +
          `<h2>cashish failed to start</h2><pre>${encodeURIComponent(String(err))}</pre></body>`,
      );
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    if (win && serverPort) win.loadURL(`http://127.0.0.1:${serverPort}/`);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
