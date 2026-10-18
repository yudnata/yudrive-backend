import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server process terminated.');
  });
});
