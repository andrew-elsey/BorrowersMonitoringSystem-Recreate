import { createApp } from './app.ts';
import { startFlagging } from './jobs/flagging.ts';
import { config } from './lib/config.ts';
import { exitOnUnhandledErrors, startServer } from './server.ts';

exitOnUnhandledErrors();
startServer(createApp(), config.port).on('listening', () => {
  console.log(`API listening on port ${config.port}`);
  void startFlagging();
});
