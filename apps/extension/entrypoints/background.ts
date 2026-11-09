import { idToken, readTallies } from "@/lib/firebase";
import { createReportQueue, postReports, serveShared } from "@/lib/sharedRemote";
import { serveClassify } from "@/lib/classifyRemote";
import { advancedOn } from "@/lib/advanced";

// Both cloud paths are 拡張機能: refused (and Firebase never started) while the popup switch is off.
// Shared verdicts: read public tallies from Firestore; votes go, batched, to our service (POST /report).
export default defineBackground(() => {
  const post = postReports(idToken);
  const votes = createReportQueue({
    // the switch may have been turned off while votes waited in the queue: check again at send time
    post: async (reports) => { if (await advancedOn()) await post(reports); },
    onError: (e) => console.warn("[joren] shared vote failed:", e.message),
  });
  serveShared({ read: readTallies, write: (reports) => votes.add(reports) }, () => advancedOn());
  serveClassify(idToken, () => advancedOn());
});
