/*
 * 拡張機能 (Advanced) = every feature that calls our cloud: the shared cache in Firestore and the
 * review classifier on Cloud Run. One popup switch, OFF by default, so 基本機能 (Gemini Nano + rules
 * on Maps' own data) never sends anything anywhere. The background checks it again before any call.
 */
export const ADVANCED_KEY = "advanced";
export const ADVANCED_DEFAULT = false;

type KV = { get(k: string): Promise<Record<string, unknown>> };
export const advancedOn = async (kv: KV = browser.storage.local) => ((await kv.get(ADVANCED_KEY))[ADVANCED_KEY] ?? ADVANCED_DEFAULT) === true;
