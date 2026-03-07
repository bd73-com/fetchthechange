const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
const zipPath = path.join(root, "fetchthechange-extension.zip");

if (!fs.existsSync(buildDir)) {
  console.error("Build directory not found. Run 'npm run build' first.");
  process.exit(1);
}

// Remove existing zip if present
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Create zip from build directory
execSync(`cd "${buildDir}" && zip -r "${zipPath}" .`, { stdio: "inherit" });

const stats = fs.statSync(zipPath);
console.log(`\nPackaged: fetchthechange-extension.zip (${(stats.size / 1024).toFixed(1)} KB)`);
