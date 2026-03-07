const { execSync } = require("child_process");
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
const baseUrl = process.env.BASE_URL || "https://ftc.bd73.com";

async function main() {
  // Step 1: Type-check
  console.log("Type-checking...");
  try {
    execSync("npx tsc --noEmit", { cwd: root, stdio: "inherit" });
  } catch {
    console.error("Type-check failed. Aborting build.");
    process.exit(1);
  }

  // Step 2: Clean build directory
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true });
  }
  fs.mkdirSync(buildDir, { recursive: true });

  // Step 3: Bundle all entry points
  const define = {
    BASE_URL_INJECTED: JSON.stringify(baseUrl),
  };
  const sourcemap = process.env.NODE_ENV !== "production" ? "inline" : false;

  await Promise.all([
    // Service worker — ESM (MV3 supports ES module service workers)
    esbuild.build({
      entryPoints: [path.join(root, "src/background/service-worker.ts")],
      bundle: true,
      format: "esm",
      outfile: path.join(buildDir, "service-worker.js"),
      define,
      sourcemap,
    }),

    // Picker content script — IIFE (injected into arbitrary pages)
    esbuild.build({
      entryPoints: [path.join(root, "src/content/picker.ts")],
      bundle: true,
      format: "iife",
      outfile: path.join(buildDir, "picker.js"),
      define,
      sourcemap,
    }),

    // Auth relay content script — IIFE (declared in manifest)
    esbuild.build({
      entryPoints: [path.join(root, "src/content/auth-relay.ts")],
      bundle: true,
      format: "iife",
      outfile: path.join(buildDir, "auth-relay.js"),
      define,
      sourcemap,
    }),

    // Popup — ESM (loaded inside extension HTML page via <script type="module">)
    esbuild.build({
      entryPoints: [path.join(root, "src/popup/popup.ts")],
      bundle: true,
      format: "esm",
      outfile: path.join(buildDir, "popup/popup.js"),
      define,
      sourcemap,
    }),
  ]);

  // Step 4: Copy static assets
  copyFile("src/content/picker.css", "picker.css");
  copyFile("src/popup/popup.css", "popup/popup.css");
  copyFile("src/popup/index.html", "popup/index.html");
  copyFile("manifest.json", "manifest.json");
  copyDir("icons", "icons");

  console.log(`Build complete. BASE_URL=${baseUrl}`);
}

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
