/* Minimal typings for Chrome's built-in Prompt API (not in lib.dom yet). Used by nanoIntent / nanoLunch. */
declare global {
  interface LMSession {
    prompt(input: string, opts?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
    measureContextUsage(input: string): Promise<number>;
    clone(): Promise<LMSession>;
    destroy(): void;
  }
  // eslint-disable-next-line no-var
  var LanguageModel: {
    availability(opts?: object): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
    create(opts?: object): Promise<LMSession>;
  } | undefined;
}
export {};
