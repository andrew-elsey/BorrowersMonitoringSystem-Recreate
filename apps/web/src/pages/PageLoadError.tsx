import { Alert } from '../components/Alert';

// The router's errorElement (HRD-5b): shown when a page's code could not be loaded, for example
// after the app was updated or the network dropped. Reloading fetches the current files.
export function PageLoadError() {
  return (
    <main className="mx-auto flex max-w-[560px] flex-col items-start gap-4 px-6 py-12">
      <Alert kind="error">This page could not load. Reload the page to try again.</Alert>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex h-11 cursor-pointer items-center rounded-lg bg-primary px-5 text-base font-semibold text-white hover:bg-primary-hover"
      >
        Reload
      </button>
    </main>
  );
}
