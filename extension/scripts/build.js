const { execSync } = require("child_process");
const esbuild = require("esbuild");
const fs = require("fs");
const { root, buildDir, baseUrl, define, entries, copyStaticAssets, copyManifest } = require("./config");

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
  const sourcemap = process.env.NODE_ENV !== "production" ? "inline" : false;

  await Promise.all(
    entries.map((entry) =>
      esbuild.build({
        entryPoints: entry.entryPoints,
        bundle: true,
        format: entry.format,
        outfile: entry.outfile,
        define,
        sourcemap,
      })
    )
  );

  // Step 4: Copy static assets and manifest
  copyStaticAssets();
  copyManifest();

  console.log(`Build complete. BASE_URL=${baseUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
