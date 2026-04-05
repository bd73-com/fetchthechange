Check whether the Chrome extension needs rebuilding after a git pull, and if so, build it and produce a new ZIP for Chrome Web Store submission.

## Instructions

1. Verify the `extension/` directory exists. If it does not, print "extension/ directory not found. Has the extension been set up?" and stop.

2. Identify what changed in the last pull by running:
   ```
   git diff HEAD@{1} HEAD --name-only
   ```
   If `HEAD@{1}` is not available (e.g. fresh clone), fall back to:
   ```
   git diff HEAD~1 HEAD --name-only
   ```
   If the diff produces no output at all, print "No changes detected since last pull." and stop.

3. Decide if the extension needs rebuilding or review. Check the changed files against two categories:

   **Direct changes** — require rebuild:
   - `extension/src/**`
   - `extension/manifest.json`
   - `extension/package.json`
   - `extension/tsconfig.json`
   - `extension/scripts/**`

   **Adjacent changes** — require review (the extension may need source updates):
   - `server/routes/extension.ts`
   - `server/middleware/extensionAuth.ts`
   - `client/src/pages/ExtensionAuth.tsx`
   - `server/utils/extensionToken.ts`
   - `shared/routes.ts` (if extension API schemas changed)

   If **direct changes** were found, proceed to step 4 (build).

   If only **adjacent changes** were found, print:
   ```
   ⚠ Extension-adjacent files changed — review needed.

   The following server/client files that the extension depends on were modified:
     • <list of changed adjacent files>

   The extension source was NOT changed. Review whether the extension
   needs matching updates (e.g. new API fields, changed response shape,
   auth flow changes). If updates are needed, make them and re-run
   /extension-release.
   ```
   Then stop. Do not proceed further.

   If **neither** category matched, print:
   ```
   ✓ Extension is up to date — no rebuild needed.

   Changed files were all outside the extension surface area. The existing
   fetchthechange-extension.zip is still valid.
   ```
   Then stop. Do not proceed further.

4. Print a summary of which extension source files changed, grouped by area using these labels:
   - `src/popup/` → `(popup UI)`
   - `src/content/` → `(content scripts)`
   - `src/background/` → `(service worker)`
   - `src/shared/` or `src/auth/` → `(shared utilities)`
   - `manifest.json` → `(manifest)`
   - `scripts/` → `(build scripts)`
   - `package.json` or `tsconfig.json` → `(build config)`

5. Bump the version in `extension/manifest.json`:
   - Read the current `version` field and increment the **patch** number (third digit). Examples: `1.0.0` → `1.0.1`, `1.2.9` → `1.2.10`.
   - Exception: if `extension/manifest.json` itself is in the list of changed files, the version may have been bumped intentionally — use it as-is and do not increment again.
   - Write the updated version back to `extension/manifest.json`.
   - Print: `Version bumped: <old> → <new>` (or `Version already bumped: <version>` if the exception applied).

6. Install dependencies if needed:
   - If `extension/node_modules/` does not exist, or if `extension/package.json` was in the changed files list, run:
     ```
     cd extension && npm install
     ```
   - Otherwise skip this step.

7. Build the extension by running:
   ```
   cd extension && npm run build
   ```
   If the build fails, print the full error output and stop with:
   ```
   ✗ Build failed — see errors above. ZIP was not created.
     Fix the errors and run /extension-release again.
   ```
   If it succeeds, print: `✓ Build succeeded`

8. Create the ZIP:
   - Check whether `extension/node_modules/archiver/` exists. If not, run:
     ```
     cd extension && npm install archiver --no-save
     ```
   - Then create the ZIP using Node:
     ```
     cd extension && node -e "
     const archiver = require('archiver');
     const fs = require('fs');
     const output = fs.createWriteStream('fetchthechange-extension.zip');
     const archive = archiver('zip', { zlib: { level: 9 } });
     archive.pipe(output);
     archive.directory('build/', false);
     output.on('close', () => console.log('ZIP created: ' + archive.pointer() + ' bytes'));
     archive.finalize();
     "
     ```
   - If that fails, fall back to the system zip command:
     ```
     cd extension/build && zip -r ../fetchthechange-extension.zip .
     ```

9. Verify and summarise:
   - Confirm `extension/fetchthechange-extension.zip` exists and is larger than 1 KB:
     ```
     ls -lh extension/fetchthechange-extension.zip
     ```
   - Then print this summary (substituting real values):
     ```
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
       Chrome Extension — Ready to Submit
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

       Version:  <new version>
       ZIP:      extension/fetchthechange-extension.zip

       Changed:
         • <file>  (<area label>)
         • ...

       Next steps:
       1. Go to chrome.google.com/webstore/devconsole
       2. Click your extension → Package tab → Upload new package
       3. Upload fetchthechange-extension.zip
       4. Submit for review

     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     ```

## Error handling

- If `git diff` produces no output at all, print "No changes detected since last pull." and stop.
- If `extension/` directory does not exist, print "extension/ directory not found. Has the extension been set up?" and stop.
- Always print full stdout and stderr on any command failure — never swallow errors silently.
