// server.js
import 'dotenv/config.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mime from 'mime-types';
import JSZip from 'jszip';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

// Internal modules
import { connectToDatabase } from './server/db/index.js';
import authRoutes from './server/routes/auth.js';
import checkoutRoutes from './server/routes/checkout.js';
// NOTE: do NOT import webhook as a router; we mount a raw handler inline
import filesRoutes from './server/routes/files.js';
import { attachUser } from './server/auth/index.js';
import { assertStripeEnv } from './server/bootstrap/envGuard.js';

// Validate required environment variables
assertStripeEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// If behind a proxy/CDN in prod, needed for secure cookies
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
// Security middleware
// ─────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'", 
          "'unsafe-inline'", 
          'https://unpkg.com',
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com'
        ],
        scriptSrc: [
          "'self'", 
          'https://unpkg.com',
          'https://cdn.jsdelivr.net',
          'https://js.stripe.com'
        ],
        scriptSrcAttr: [
          "'unsafe-inline'"
        ],
        frameSrc: [
          "'self'",
          'https://js.stripe.com',
          'https://hooks.stripe.com'
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'https://cdn.jsdelivr.net'
        ],
        connectSrc: [
          "'self'",
          'https://api.tidesandcurrents.noaa.gov',
          'https://api-iwls.dfo-mpo.gc.ca',
          'https://api.stripe.com',
          'https://nominatim.openstreetmap.org'
        ],
      },
    },
  })
);

// CORS (allow your own origin)
app.use(
  cors({
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// Rate limits - more generous for development
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 100, // 100 in dev, 10 in prod
  message: 'Too many authentication attempts, please try again later.',
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 5 : 50, // 50 in dev, 5 in prod
  message: 'Too many checkout attempts, please try again later.',
});

// Session config (store added after DB connects)
let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24h
  },
};

// Session middleware will be applied after DB connection

// ─────────────────────────────────────────────────────────────
// Stripe webhook MUST be mounted BEFORE express.json() using raw body
// ─────────────────────────────────────────────────────────────
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // dynamic import to avoid raw-body conflicts
    const webhookHandler = (await import('./server/routes/webhook.js')).default;
    return webhookHandler(req, res);
  }
);

// Now safe to use JSON parser for normal routes
app.use(express.json());

// www → apex redirect
app.use((req, res, next) => {
  if (req.hostname === 'www.tideincal.com') {
    return res.redirect(301, 'https://tideincal.com' + req.originalUrl);
  }
  next();
});

// Static files FIRST
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', mime.lookup('css'));
      }
    },
  })
);

// Temporary ICS hosting
app.use('/tempICSFile', express.static(path.join(__dirname, 'tempICSFile')));

// Available regions
const availableRegions = ['canada', 'usa'];

// API: regions
app.get('/api/tide-regions', (_req, res) => {
  res.json({ regions: availableRegions });
});

// API: stations by region
app.get('/api/tide-stations', (req, res) => {
  const region = req.query.region;
  const filePath = path.join(__dirname, 'data', `${region}_stations.json`);

  if (!availableRegions.includes(region)) {
    return res.status(400).json({ error: `Region "${region}" is not supported` });
  }

  if (fs.existsSync(filePath)) {
    const tideStations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return res.json(tideStations);
  }

  return res
    .status(404)
    .json({ error: `Tide station data for "${region}" is not available` });
});

// ─────────────────────────────────────────────────────────────
// Routes that don’t require DB (webhook/static) are already above.
// Everything that needs sessions/user comes after DB connection.
// ─────────────────────────────────────────────────────────────
async function startServer() {
  try {
    const { client } = await connectToDatabase();

    // Configure session store with MongoDB
    sessionConfig.store = MongoStore.create({
      client,
      dbName: 'tideincal',
      collectionName: 'sessions',
      ttl: 14 * 24 * 3600, // 14 days
    });

    // Apply session middleware with MongoDB store
    app.use(session(sessionConfig));
    
    // Apply middleware that relies on req.session
    app.use(attachUser);

    // Auth/checkout/file routes (rate-limited where appropriate)
    app.use('/api/auth', authLimiter, authRoutes);
    app.use('/api/checkout', checkoutLimiter, checkoutRoutes);
    app.use('/api/files', filesRoutes);

    // Legacy data generation endpoint (kept for compatibility)
    app.post('/startDataFetch', async (req, res) => {
      const { stationID, stationTitle, country, feet, userTimezone } = req.body;
      try {
        const fileName = await getYearData(
          stationID,
          stationTitle,
          country,
          feet,
          userTimezone
        );
        const fileUrl = `/tempICSFile/${fileName}`;
        res.json({ message: 'Data fetching initiated', fileUrl });
      } catch (error) {
        res.status(500).json({ error: error.toString() });
      }
    });

    // Account page
    app.get('/account', (_req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'account.html'));
    });

    // Home LAST
    app.get('/', (_req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Daily cleanup of old files (legacy; webhook/TTL handles new flow)
    cron.schedule('0 0 * * *', () => {
      const dir = './tempICSFile';
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
        }
      });
    });

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

// ─────────────────────────────────────────────────────────────
// ICS generator (existing logic preserved)
// ─────────────────────────────────────────────────────────────
const getYearData = async (id, stationTitle, country, feet, userTimezone) => {
  const year = new Date().getFullYear();
  const nextYr = year + 1;
  const today = new Date();
  const month2d = String(today.getMonth() + 1).padStart(2, '0');
  const day2d = String(today.getDate()).padStart(2, '0');
  let events = [];

  const apiUrl =
    country === 'canada'
      ? `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${id}/data?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T00%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`
      : `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${year}${month2d}${day2d}&end_date=${nextYr}${month2d}${day2d}&station=${id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`;

  const response = await fetch(apiUrl);
  const data = await response.json();
  const tideData = country === 'canada' ? data : data.predictions;

  tideData.forEach((entry, i) => {
    let tide;

    if (country === 'canada') {
      const currentHeight = parseFloat(entry.value);
      const prev = tideData[i - 1] ? parseFloat(tideData[i - 1].value) : null;
      const next = tideData[i + 1] ? parseFloat(tideData[i + 1].value) : null;

      if (prev === null) {
        tide = currentHeight > next ? 'High Tide' : 'Low Tide';
      } else if (next === null) {
        tide = currentHeight > prev ? 'High Tide' : 'Low Tide';
      } else {
        tide =
          currentHeight > prev && currentHeight > next
            ? 'High Tide'
            : 'Low Tide';
      }
    } else {
      tide = entry.type === 'L' ? 'Low Tide' : 'High Tide';
    }

    const tideHeight = feet
      ? `${
        country === 'canada' ? (entry.value * 3.2808399).toFixed(2) : entry.v
      }Ft`
      : `${
        country === 'canada'
          ? entry.value
          : (entry.v / 3.2808399).toFixed(2)
      }M`;

    const rawTime =
      country === 'canada' ? entry.eventDate : `${entry.t}:00`; // add seconds for NOAA

    const startDate = new Date(
      new Date(rawTime).toLocaleString('en-US', { timeZone: userTimezone })
    );
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // +30 min

    const eventUID = `tide-${id}-${startDate.getTime()}-${Math.random()
      .toString(36)
      .substr(2, 6)}@tideincal.com`;

    const eventContent = `BEGIN:VEVENT
UID:${eventUID}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date())}
DTSTART:${formatDateForICS(startDate, country, userTimezone)}
DTEND:${formatDateForICS(endDate, country, userTimezone)}
SUMMARY:${stationTitle} ${tide} @ ${tideHeight}
DESCRIPTION:${tideHeight}Tide at ${stationTitle}
LOCATION:${stationTitle}
STATUS:CONFIRMED
END:VEVENT`;

    events.push(eventContent);
  });

  const calendarName = `Tide - ${stationTitle} - ${year}-${month2d}-${day2d}`;
  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//Tide In Calendar//TideCal//EN
METHOD:PUBLISH
X-WR-CALNAME:${calendarName}
X-WR-TIMEZONE:${userTimezone}
${events.join('\n')}
END:VCALENDAR`;

  const calendarFileNm = `${stationTitle}_${year}_${nextYr}.ics`;
  const filePath = path.join(__dirname, 'tempICSFile', calendarFileNm);
  fs.writeFileSync(filePath, icsContent);
  return calendarFileNm;
};

const formatDateForICS = (date, country, userTimezone) => {
  if (country === 'canada') {
    return new Date(date).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  } else {
    const local = new Date(
      date.toLocaleString('en-US', { timeZone: userTimezone })
    );
    return `${local.getFullYear()}${String(local.getMonth() + 1).padStart(
      2,
      '0'
    )}${String(local.getDate()).padStart(2, '0')}T${String(
      local.getHours()
    ).padStart(2, '0')}${String(local.getMinutes()).padStart(2, '0')}${String(
      local.getSeconds()
    ).padStart(2, '0')}`;
  }
};


//
//     //--------------------- FOR UK -------------------------//
//     // } else if ( country ==="uk") {
//     //
//     //   const uk_year =`http://environment.data.gov.uk/flood-monitoring/id/stations/${id}/readings?startdate=${year}-${month2d}-${day2d}&enddate=${nextYr}-${month2d}-${day2d}`;
//     //   //const uk_year1 =`http://environment.data.gov.uk/flood-monitoring/id/stations/`;
//     //   const respYearUK = await fetch(uk_year);
//     //   const oneYearUK = await respYearUK.json();
//     //   console.log(oneYearUK);
//     //   console.log('cherio');
//     //
//   } else {
//     console.error("Oh shit! You got nothing!")
//   }
// };

