const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const build = path.join(root, "build");

function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy popup HTML and CSS
copyFileSync(
  path.join(root, "src", "popup", "index.html"),
  path.join(build, "popup", "index.html")
);
copyFileSync(
  path.join(root, "src", "popup", "popup.css"),
  path.join(build, "popup", "popup.css")
);

// Copy picker CSS
copyFileSync(
  path.join(root, "src", "content", "picker.css"),
  path.join(build, "content", "picker.css")
);

// Copy manifest.json
copyFileSync(
  path.join(root, "manifest.json"),
  path.join(build, "manifest.json")
);

// Copy icons
copyDirSync(
  path.join(root, "icons"),
  path.join(build, "icons")
);

// Replace BASE_URL in compiled JS if FTC_BASE_URL env var is set
const baseUrl = process.env.FTC_BASE_URL;
if (baseUrl && baseUrl !== "https://ftc.bd73.com") {
  const defaultUrl = "https://ftc.bd73.com";
  const jsFiles = [];
  function findJs(dir) {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) findJs(full);
      else if (full.endsWith(".js")) jsFiles.push(full);
    }
  }
  findJs(build);
  for (const file of jsFiles) {
    const content = fs.readFileSync(file, "utf8");
    if (content.includes(defaultUrl)) {
      fs.writeFileSync(file, content.replaceAll(defaultUrl, baseUrl));
      console.log(`  Replaced BASE_URL in ${path.relative(build, file)}`);
    }
  }
  // Also update manifest.json content_scripts and host_permissions
  const manifestPath = path.join(build, "manifest.json");
  const manifest = fs.readFileSync(manifestPath, "utf8");
  if (manifest.includes(defaultUrl)) {
    fs.writeFileSync(manifestPath, manifest.replaceAll(defaultUrl, baseUrl));
    console.log("  Replaced BASE_URL in manifest.json");
  }
  console.log(`Assets copied to build/ (BASE_URL=${baseUrl})`);
} else {
  console.log("Assets copied to build/");
}
