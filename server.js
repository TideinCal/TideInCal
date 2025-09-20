import 'dotenv/config.js'
import express from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mime from "mime-types";
import JSZip from 'jszip';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

// Import our modules
import { connectToDatabase } from './server/db/index.js';
import authRoutes from './server/routes/auth.js';
import checkoutRoutes from './server/routes/checkout.js';
import webhookRoutes from './server/routes/webhook.js';
import filesRoutes from './server/routes/files.js';
import { attachUser } from './server/auth/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrc: ["'self'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.tidesandcurrents.noaa.gov", "https://api-iwls.dfo-mpo.gc.ca"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: 'Too many authentication attempts, please try again later.'
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: 'Too many checkout attempts, please try again later.'
});

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.json());

// www → apex redirect
app.use((req, res, next) => {
  if (req.hostname === 'www.tideincal.com') {
    return res.redirect(301, 'https://tideincal.com' + req.originalUrl);
  }
  next();
});

// Serve static files from the 'public' directory FIRST (before API routes)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', mime.lookup('css'));
    }
  }
}));

// Available regions with functional APIs or data
const availableRegions = ['canada', 'usa']; // Add 'uk', 'australia' when ready

// Attach user to all requests
app.use(attachUser);

// Serve tempICSFile directory
app.use('/tempICSFile', express.static(path.join(__dirname, 'tempICSFile')));

// API routes
app.get('/api/tide-regions', (req, res) => {
  res.json({ regions: availableRegions });
});

app.get('/api/tide-stations', (req, res) => {
  const region = req.query.region;
  const filePath = path.join(__dirname, 'data', `${region}_stations.json`);

  if (!availableRegions.includes(region)) {
    return res.status(400).json({ error: `Region "${region}" is not supported` });
  }

  if (fs.existsSync(filePath)) {
    const tideStations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(tideStations);
  } else {
    res.status(404).json({ error: `Tide station data for "${region}" is not available` });
  }
});

// Authentication routes
app.use('/api/auth', authLimiter, authRoutes);

// Checkout routes
app.use('/api/checkout', checkoutLimiter, checkoutRoutes);

// Stripe webhook (no rate limiting for webhooks)
app.use('/api/stripe', webhookRoutes);

// Files routes
app.use('/api/files', filesRoutes);

// POST route for starting the data fetch process
app.post('/startDataFetch', async (req, res) => {
  const { stationID, stationTitle, country, feet, userTimezone } = req.body;
  // console.log(`received: ${JSON.stringify(req.body)}`);
  // console.log('Received request:', { stationID, stationTitle, country, feet, userTimezone });

  try {
    const fileName = await getYearData(stationID, stationTitle, country, feet, userTimezone);
    const fileUrl = `/tempICSFile/${fileName}`;
    res.json({ message: 'Data fetching initiated', fileUrl });
  } catch (error) {
    // console.error('Error fetching data:', error);
    res.status(500).json({ error: error.toString() });
  }
});

// Homepage route (serves / only) - should be LAST
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Cleanup old ICS files daily ( WILL NEED TO CHANGE THIS)
cron.schedule('0 0 * * *', () => {
  const dir = './tempICSFile';
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    if (Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath);
    }
  });
  // console.log('Old ICS files cleaned up!');
});


// Initialize database connection and start server
async function startServer() {
  try {
    await connectToDatabase();
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

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
      // USA logic
      tide = entry.type === 'L' ? 'Low Tide' : 'High Tide';
    }

    const tideHeight = feet
      ? `${
        country === 'canada'
          ? (entry.value * 3.2808399).toFixed(2)
          : entry.v
      }Ft`
      : `${
        country === 'canada'
          ? entry.value
          : (entry.v / 3.2808399).toFixed(2)
      }M`;

    const rawTime = country === 'canada' ? entry.eventDate : `${entry.t}:00`; // ensure seconds are present

    const startDate = new Date(
      new Date(rawTime).toLocaleString('en-US', { timeZone: userTimezone })
    );

    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 minutes later
    console.log(`[DEBUG] ${stationTitle} | ${entry.t || entry.eventDate} → ${startDate.toISOString()} (${tide})`);

    // ✅ Generate unique UID per event
    const eventUID = `tide-${id}-${startDate.getTime()}-${Math.random().toString(36).substr(2, 6)}@tideincal.com`;

    // ✅ ICS Event Content
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

  // ✅ Unique calendar name to avoid conflicts
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
// Format date for ICS
const formatDateForICS = (date, country, userTimezone) => {
  if (country === 'canada') {
    return new Date(date)
      .toISOString()
      .replace(/[-:]/g, '')
      .split('.')[0] + 'Z';
  } else {
    const local = new Date(date.toLocaleString('en-US', { timeZone: userTimezone }));
    return `${local.getFullYear()}${String(local.getMonth() + 1).padStart(2, '0')}${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}${String(local.getMinutes()).padStart(2, '0')}${String(local.getSeconds()).padStart(2, '0')}`;
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

