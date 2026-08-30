import fetch from 'node-fetch';

/**
 * Generates ICS calendar content for a tide station.
 * Moon phases are intentionally NOT included here; they are delivered
 * via a separate moon phases calendar to avoid duplicate events.
 *
 * @param {Object} stationData - Station information
 * @param {string} stationData.id - Station ID
 * @param {string} stationData.title - Station title/name
 * @param {string} stationData.country - 'usa' or 'canada'
 * @param {string} [stationData.userTimezone='UTC'] - User's timezone for calendar metadata
 * @param {string} [stationData.stationTimezone='UTC'] - Station's IANA timezone, used for tide date boundaries
 * @param {boolean} [stationData.feet=false] - Whether to use feet (defaults to meters)
 * @returns {Promise<string>} ICS file content
 */
export async function generateICS(stationData) {
  const {
    id: stationID,
    title: stationTitle,
    country,
    userTimezone = 'UTC',
    stationTimezone = 'UTC',
    feet = false,
    startDate = null,
    endDate = null
  } = stationData;

  try {
    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const fallbackEnd = new Date(start);
    fallbackEnd.setUTCFullYear(fallbackEnd.getUTCFullYear() + 1);
    const end = endDate ? new Date(endDate) : fallbackEnd;
    const timezone = stationTimezone && String(stationTimezone).trim()
      ? String(stationTimezone).trim()
      : 'UTC';
    const localStartDate = getLocalDateKey(start, timezone);
    const localEndDate = getLocalDateKey(end, timezone);
    const intendedStartMs = localDateToUtcMs(localStartDate, timezone);
    const intendedEndMs = localDateToUtcMs(addDaysToDateKey(localEndDate, 1), timezone);
    const requestStart = new Date(intendedStartMs - 24 * 60 * 60 * 1000);
    const requestEnd = new Date(intendedEndMs + 24 * 60 * 60 * 1000);

    let events = [];

    // Fetch tide data from appropriate API
    const apiUrl =
      country === 'canada'
        ? `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${stationID}/data?time-series-code=wlp-hilo&from=${encodeURIComponent(requestStart.toISOString())}&to=${encodeURIComponent(requestEnd.toISOString())}`
        : `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${formatNoaaDate(requestStart)}&end_date=${formatNoaaDate(requestEnd)}&station=${stationID}&product=predictions&datum=MLLW&time_zone=gmt&interval=hilo&units=english&application=DataAPI_Sample&format=json`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch tide data: ${response.statusText}`);
    }
    
    const data = await response.json();
    const tideData = country === 'canada' ? data : data.predictions;

    if (!tideData || tideData.length === 0) {
      throw new Error('No tide data returned from API');
    }

    // Process each tide entry
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
        country === 'canada' ? entry.eventDate : entry.t;
      const tideDate = country === 'canada'
        ? parseIsoInstant(rawTime)
        : parseNoaaGmtInstant(rawTime);

      if (tideDate.getTime() < intendedStartMs || tideDate.getTime() >= intendedEndMs) {
        return;
      }

      const tideEndDate = new Date(tideDate.getTime() + 30 * 60 * 1000); // +30 min
      const eventUID = `tide-${country}-${stationID}-${tideDate.getTime()}@tideincal.com`;

      const eventContent = `BEGIN:VEVENT
UID:${eventUID}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date())}
DTSTART:${formatDateForICS(tideDate)}
DTEND:${formatDateForICS(tideEndDate)}
SUMMARY:🌊 ${stationTitle} ${tide} @ ${tideHeight}
DESCRIPTION:${tideHeight}Tide at ${stationTitle}
LOCATION:${stationTitle}
STATUS:CONFIRMED
END:VEVENT`;

      events.push(eventContent);
    });

    const calendarName = `Tide - ${stationTitle} - ${localStartDate}`;
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//Tide In Calendar//TideCal//EN
METHOD:PUBLISH
X-WR-CALNAME:${calendarName}
X-WR-TIMEZONE:${userTimezone}
${events.join('\n')}
END:VCALENDAR`;

    return icsContent;
  } catch (error) {
    console.error('Error generating ICS:', error);
    throw error;
  }
}

/**
 * Formats a date as a UTC date-time for ICS.
 */
function formatDateForICS(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatNoaaDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function parseIsoInstant(value) {
  const normalized = String(value).trim();
  const isoWithoutTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized);
  const date = new Date(isoWithoutTimezone ? `${normalized}Z` : normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Canadian tide timestamp: ${value}`);
  }
  return date;
}

function parseNoaaGmtInstant(value) {
  const normalized = String(value).trim();
  const isoValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(normalized)
    ? normalized.replace(' ', 'T') + 'Z'
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(normalized)
      ? normalized + 'Z'
      : normalized;
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid NOAA tide timestamp: ${value}`);
  }
  return date;
}

function getLocalDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getTimezoneOffsetMs(utcMs, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(utcMs));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const localAsUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return localAsUtcMs - utcMs;
}

function localDateToUtcMs(dateKey, timezone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  let utcMs = Date.UTC(year, month - 1, day);
  for (let i = 0; i < 3; i += 1) {
    utcMs = Date.UTC(year, month - 1, day) - getTimezoneOffsetMs(utcMs, timezone);
  }
  return utcMs;
}

function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Merges tide and Golden Hour ICS into one calendar (tide + Golden Hour combined).
 * Extracts all VEVENT blocks from both and wraps in a single VCALENDAR.
 * @param {string} tideIcs - Full ICS string from generateICS
 * @param {string} goldenIcs - Full ICS string from generateGoldenHourICS
 * @param {string} calendarName - X-WR-CALNAME value
 * @param {string} [userTimezone='UTC'] - X-WR-TIMEZONE
 * @returns {string} Combined ICS content
 */
export function mergeTideAndGoldenHourICS(tideIcs, goldenIcs, calendarName, userTimezone = 'UTC') {
  const veventRegex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/g;
  const tideEvents = (tideIcs.match(veventRegex) || []).join('\n');
  const goldenEvents = (goldenIcs.match(veventRegex) || []).join('\n');
  const allEvents = [tideEvents, goldenEvents].filter(Boolean).join('\n');
  return `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//Tide In Calendar//TideCal+GoldenHour//EN
METHOD:PUBLISH
X-WR-CALNAME:${(calendarName || 'Tide + Golden Hour').replace(/\n/g, ' ')}
X-WR-TIMEZONE:${userTimezone}
${allEvents}
END:VCALENDAR`;
}
