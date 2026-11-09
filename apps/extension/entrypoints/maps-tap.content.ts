import { installPlaceNav } from "@/lib/placeNav";
import { installTap } from "@/lib/reviewTap";

/**
 * MAIN-world script, two jobs that need the page's own objects:
 *  - wraps the page's fetch so review payloads reach the extension without any extra request
 *    (lib/reviewTap.ts). Must run at document_start, before Maps' own code keeps a reference to fetch.
 *  - opens a place in Maps' SPA without a page load when the 問地圖 panel asks (lib/placeNav.ts).
 * No `browser.*` APIs here; data crosses to the isolated world by postMessage on the page's own origin.
 */
export default defineContentScript({
  matches: ["https://www.google.com/maps/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    installTap(window, (m) => window.postMessage(m, location.origin));
    installPlaceNav(window);
  },
});
