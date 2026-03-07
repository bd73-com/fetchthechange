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

console.log("Assets copied to build/");
