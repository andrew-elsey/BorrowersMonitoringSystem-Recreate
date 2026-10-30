import { APP_NAME } from '@bms/shared';

// Placeholder page. The real app shell is built in FND-5.
export function pageTitle(): string {
  return APP_NAME;
}

export function App() {
  return <h1>{pageTitle()}</h1>;
}
