// Placeholder entry point. The Express server arrives with FND-2 and AUTH-1.
import { APP_NAME } from '@bms/shared';

export function startupMessage(): string {
  return `${APP_NAME} API`;
}
