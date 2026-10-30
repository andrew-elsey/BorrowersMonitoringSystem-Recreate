import { createApp } from './app.ts';
import { config } from './lib/config.ts';

createApp().listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
