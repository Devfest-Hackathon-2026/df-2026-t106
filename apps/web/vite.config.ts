import { existsSync, readFileSync, statSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/*
 * The site hands out the Chrome extension as a ZIP (it is not on the Chrome Web Store).
 * `npm run zip:ext` writes apps/extension/.output/<name>-<version>-chrome.zip; the build copies it to a
 * stable URL (/download/joren.zip) and passes its version / date / size to the page.
 */
const ext = JSON.parse(readFileSync(new URL("../extension/package.json", import.meta.url), "utf8")) as { name: string; version: string };
const zipPath = new URL(`../extension/.output/${ext.name.replace(/[@/]/g, "")}-${ext.version}-chrome.zip`, import.meta.url);
const zip = existsSync(zipPath) ? statSync(zipPath) : null;
const DOWNLOAD_PATH ="download/joren.zip";

function extensionZip(): Plugin {
  return {
    name: "extension-zip",
    apply: "build",
    generateBundle() {
      if (!zip) {
        this.warn(`extension zip not found (${zipPath.pathname}); run "npm run zip:ext" first — the download button will 404`);
        return;
      }
      this.emitFile({ type: "asset", fileName: DOWNLOAD_PATH, source: readFileSync(zipPath) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), extensionZip()],
  define: {
    __EXT__: JSON.stringify({
      version: ext.version,
      href: `/${DOWNLOAD_PATH}`,
      kb: zip ? Math.round(zip.size / 1024) : 0,
      built: zip ? zip.mtime.toISOString().slice(0, 10) : "",
    }),
  },
});
