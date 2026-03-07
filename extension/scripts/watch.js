const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const buildDir = path.join(root, "build");
const baseUrl = process.env.BASE_URL || "https://ftc.bd73.com";

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

async function main() {
  // Ensure build directory exists
  fs.mkdirSync(buildDir, { recursive: true });

  // Copy static assets once
  copyFile("src/content/picker.css", "picker.css");
  copyFile("src/popup/popup.css", "popup/popup.css");
  copyFile("src/popup/index.html", "popup/index.html");
  copyFile("manifest.json", "manifest.json");
  copyDir("icons", "icons");

  const contexts = [];

  for (const entry of entries) {
    const ctx = await esbuild.context({
      entryPoints: entry.entryPoints,
      bundle: true,
      format: entry.format,
      outfile: entry.outfile,
      define,
      sourcemap: "inline",
      plugins: [
        {
          name: "rebuild-log",
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length === 0) {
                console.log(`Rebuilt ${path.relative(root, entry.outfile)}`);
              }
            });
          },
        },
      ],
    });
    await ctx.watch();
    contexts.push(ctx);
  }

  console.log(`Watching for changes... BASE_URL=${baseUrl}`);

  // Graceful shutdown on Ctrl+C
  process.on("SIGINT", async () => {
    console.log("\nStopping watchers...");
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    process.exit(0);
  });
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
