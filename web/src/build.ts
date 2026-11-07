declare const __LEXI_BUILD__: string | undefined;

/** Commit and build date of this bundle (vite.config.ts), shown in Settings. */
export const BUILD: string = typeof __LEXI_BUILD__ === "string" ? __LEXI_BUILD__ : "dev";
