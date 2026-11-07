import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { initCache } from './cache/redis.js';
import { apiRouter } from './routes/api.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

async function start() {
  const cache = await initCache();
  app.listen(PORT, () => {
    console.log(`Adaptive Running Coach API listening on http://localhost:${PORT}`);
    console.log(`Cache: ${cache.mode} (${cache.url})`);
    if (!process.env.GARMIN_PERSONAL_API_KEY?.trim()) {
      console.log(
        'Garmin: GARMIN_PERSONAL_API_KEY not set — /api/garmin/runs will return setup instructions',
      );
    } else {
      console.log('Garmin: Personal API key detected');
    }
  });
}

void start();
