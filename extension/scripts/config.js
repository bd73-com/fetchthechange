const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
const DEFAULT_BASE_URL = "https://ftc.bd73.com";
const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;

const define = {
  BASE_URL_INJECTED: JSON.stringify(baseUrl),
};

const entries = [
  {
    entryPoints: [path.join(root, "src/background/service-worker.ts")],
    outfile: path.join(buildDir, "service-worker.js"),
    format: "esm",
  },
  {
    entryPoints: [path.join(root, "src/content/picker.ts")],
    outfile: path.join(buildDir, "picker.js"),
    format: "iife",
  },
  {
    entryPoints: [path.join(root, "src/content/auth-relay.ts")],
    outfile: path.join(buildDir, "auth-relay.js"),
    format: "iife",
  },
  {
    entryPoints: [path.join(root, "src/popup/popup.ts")],
    outfile: path.join(buildDir, "popup/popup.js"),
    format: "esm",
  },
];

const staticAssets = [
  { src: "src/content/picker.css", dest: "picker.css" },
  { src: "src/popup/popup.css", dest: "popup/popup.css" },
  { src: "src/popup/index.html", dest: "popup/index.html" },
];

function copyFile(src, dest) {
  const srcPath = path.join(root, src);
  const destPath = path.join(buildDir, dest);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
}

function copyDir(src, dest) {
  const srcPath = path.join(root, src);
  const destPath = path.join(buildDir, dest);
  fs.mkdirSync(destPath, { recursive: true });
  for (const entry of fs.readdirSync(srcPath)) {
    const s = path.join(srcPath, entry);
    const d = path.join(destPath, entry);
    if (fs.statSync(s).isDirectory()) {
      copyDir(path.join(src, entry), path.join(dest, entry));
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function copyStaticAssets() {
  for (const asset of staticAssets) {
    copyFile(asset.src, asset.dest);
  }
  copyDir("icons", "icons");
}

function copyManifest() {
  const manifestSrc = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
  const manifestOut =
    baseUrl !== DEFAULT_BASE_URL
      ? manifestSrc.replaceAll(DEFAULT_BASE_URL, new URL(baseUrl).origin)
      : manifestSrc;
  fs.writeFileSync(path.join(buildDir, "manifest.json"), manifestOut);
}

module.exports = {
  root,
  buildDir,
  baseUrl,
  DEFAULT_BASE_URL,
  define,
  entries,
  staticAssets,
  copyFile,
  copyDir,
  copyStaticAssets,
  copyManifest,
};
