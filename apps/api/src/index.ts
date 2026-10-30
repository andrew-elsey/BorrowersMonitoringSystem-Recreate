import { createApp } from './app.js';
import { config } from './lib/config.js';

createApp().listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
