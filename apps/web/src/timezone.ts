// ARCHITECTURE.md 6: dates and times show in the app timezone, not the browser's. APP_TIMEZONE is
// read at build time (vite.config.ts envPrefix), with the same default as the api.
export const TIMEZONE = (import.meta.env.APP_TIMEZONE as string | undefined) || 'Asia/Manila';

// Today as YYYY-MM-DD in the app timezone, for a date picker's min. The API checks again (BR 7).
export const todayInAppZone = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
