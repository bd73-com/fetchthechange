const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const { root, buildDir, baseUrl, define, entries, staticAssets, copyFile, copyStaticAssets, copyManifest } = require("./config");

async function main() {
  // Ensure build directory exists
  fs.mkdirSync(buildDir, { recursive: true });

  // Copy static assets and manifest once
  copyStaticAssets();
  copyManifest();

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

  // Watch static assets for changes and re-copy on modification
  const assetWatchers = [];
  for (const asset of staticAssets) {
    const srcPath = path.join(root, asset.src);
    const watcher = fs.watch(srcPath, () => {
      try {
        copyFile(asset.src, asset.dest);
        console.log(`Copied ${asset.src}`);
      } catch (err) {
        console.error(`Failed to copy ${asset.src}:`, err.message);
      }
    });
    assetWatchers.push(watcher);
  }

  // Watch manifest.json separately (needs URL replacement)
  const manifestWatcher = fs.watch(path.join(root, "manifest.json"), () => {
    try {
      copyManifest();
      console.log("Copied manifest.json");
    } catch (err) {
      console.error("Failed to copy manifest.json:", err.message);
    }
  });
  assetWatchers.push(manifestWatcher);

  console.log(`Watching for changes... BASE_URL=${baseUrl}`);
  console.log("Note: Type-checking is skipped in watch mode — run 'npm run typecheck' separately.");

  // Graceful shutdown on Ctrl+C
  process.on("SIGINT", async () => {
    console.log("\nStopping watchers...");
    assetWatchers.forEach((w) => w.close());
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
