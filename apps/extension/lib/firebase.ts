import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth/web-extension";
import { collection, getDocs, getFirestore, query, where, type Firestore } from "firebase/firestore/lite";
import type { Tally } from "./lunchStore";

/*
 * Firebase lives in the background service worker only (never in the Maps page): content scripts
 * call it through runtime messages (see messageRemote). Web config is public by design; access is
 * decided by firestore.rules: a client may only read `tallies`. Votes go to our Cloud Run service
 * (lib/sharedRemote.ts), which keeps them private.
 * Created on first use, not at start-up: Auth refreshes a saved user's token as soon as it starts,
 * and with 拡張機能 off (lib/advanced.ts) nothing may reach our cloud.
 */
let fb: { auth: Auth; db: Firestore } | null = null;
function firebase() {
  if (!fb) {
    const app = initializeApp({
      apiKey: "AIzaSyDZ4g0pb73LOi19qD_ab_hxEVYNpvpI_-c",
      authDomain: "gmap-extension.firebaseapp.com",
      projectId: "gmap-extension",
      storageBucket: "gmap-extension.firebasestorage.app",
      messagingSenderId: "82264202939",
      appId: "1:82264202939:web:f2a8656b0383df72c2939e",
    });
    fb = { auth: getAuth(app), db: getFirestore(app) };
  }
  return fb;
}

let signingIn: Promise<string> | null = null;
/** Anonymous uid; created once, then persisted by Auth across service-worker restarts. */
async function uid() {
  const { auth } = firebase();
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  signingIn ??= signInAnonymously(auth).then((c) => c.user.uid).finally(() => { signingIn = null; });
  return signingIn;
}

/** The anonymous user's ID token (refreshed by the SDK) for services that verify Firebase Auth. */
export async function idToken() {
  await uid();
  return firebase().auth.currentUser!.getIdToken();
}

const IN_MAX = 30; // Firestore `in` limit

/** Public tallies (no uid in them) for these `${meal}~${fid}` keys; one per LUNCH_VERSION that was voted under. */
export async function readTallies(keys: string[]): Promise<Tally[]> {
  const out: Tally[] = [];
  for (let i = 0; i < keys.length; i += IN_MAX) {
    const snap = await getDocs(query(collection(firebase().db, "tallies"), where("key", "in", keys.slice(i, i + IN_MAX))));
    for (const d of snap.docs) out.push(d.data() as Tally);
  }
  return out;
}
