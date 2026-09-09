import dotenv from 'dotenv';
import { app } from './app.js';
import { connectDatabase } from './db/connection.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '5001', 10);

async function bootstrap() {
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 AI Interview Prep Kit Backend Server`);
    console.log(`📡 Listening on http://localhost:${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`====================================================`);
  });
}

bootstrap().catch(err => {
  console.error('[Bootstrap Fatal Error]', err);
  process.exit(1);
});
