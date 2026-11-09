import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Joren",
    description: "Ask Google Maps in one sentence and find where the regulars eat.",
    // Chrome 138: first stable release with the Prompt API (Gemini Nano) for extensions; README, site and doc say 138+
    minimum_chrome_version: "138",
    permissions: ["storage"],
    // the background calls the review-warning service directly (services/classify on Cloud Run)
    host_permissions: ["https://classify-82264202939.asia-northeast1.run.app/*"],
    action: { default_title: "Joren" },
    // content script registers these @font-face URLs on google.com/maps
    web_accessible_resources: [{ resources: ["fonts/*"], matches: ["https://www.google.com/*"] }],
  },
});
