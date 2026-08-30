// Renders the cashish app icon SVG to a transparent 1024px PNG via sharp.
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="tile" cx="28%" cy="18%" r="120%">
      <stop offset="0%" stop-color="#1aa37c"/>
      <stop offset="46%" stop-color="#0f7b5f"/>
      <stop offset="100%" stop-color="#0a5c47"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="tileClip">
      <rect x="96" y="96" width="832" height="832" rx="188"/>
    </clipPath>
  </defs>
  <rect x="96" y="96" width="832" height="832" rx="188" fill="url(#tile)"/>
  <rect x="96" y="96" width="832" height="832" rx="188" fill="url(#sheen)" clip-path="url(#tileClip)"/>
  <g transform="translate(277,283) scale(19.58)" fill="none" stroke="#ffffff"
     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="12" cy="5.5" rx="8" ry="3" fill="#ffffff" fill-opacity="0.12"/>
    <path d="M4 5.5v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5"/>
    <path d="M4 10.5v5c0 1.66 3.58 3 8 3s8-1.34 8-3v-5"/>
    <path d="M4 15.5v3c0 1.66 3.58 3 8 3s8-1.34 8-3v-3"/>
  </g>
</svg>`;

const out = path.join(__dirname, "..", "build", "icon-1024.png");
sharp(Buffer.from(svg))
  .png()
  .toFile(out)
  .then(() => console.log("wrote", out))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
