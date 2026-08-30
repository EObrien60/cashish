const { contextBridge } = require("electron");

// Minimal, safe surface. Desktop detection is primarily done server-side via
// the User-Agent; this is here for any renderer-side needs.
contextBridge.exposeInMainWorld("cashish", {
  desktop: true,
  platform: process.platform,
});
