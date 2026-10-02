// `bun run server`: headless LAN server.
import { LAN_PORT } from '@jpkart/core';
import { startServer } from './main';

startServer(Number(process.env.PORT ?? LAN_PORT));
