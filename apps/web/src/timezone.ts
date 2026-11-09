// ARCHITECTURE.md 6: dates and times show in the app timezone, not the browser's. APP_TIMEZONE is
// read at build time (vite.config.ts envPrefix), with the same default as the api.
export const TIMEZONE = (import.meta.env.APP_TIMEZONE as string | undefined) || 'Asia/Manila';
