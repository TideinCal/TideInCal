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
 * @param {string} [stationData.userTimezone='UTC'] - User's timezone
 * @param {boolean} [stationData.feet=false] - Whether to use feet (defaults to meters)
 * @returns {Promise<string>} ICS file content
 */
export async function generateICS(stationData) {
  const { 
    id: stationID, 
    title: stationTitle, 
    country, 
    userTimezone = 'UTC',
    feet = false,
    startDate = null,
    endDate = null
  } = stationData;
  
  try {
    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const fallbackEnd = new Date(start);
    fallbackEnd.setFullYear(fallbackEnd.getFullYear() + 1);
    const end = endDate ? new Date(endDate) : fallbackEnd;

    const startYear = start.getFullYear();
    const endYear = end.getFullYear();
    const startMonth2d = String(start.getMonth() + 1).padStart(2, '0');
    const startDay2d = String(start.getDate()).padStart(2, '0');
    const endMonth2d = String(end.getMonth() + 1).padStart(2, '0');
    const endDay2d = String(end.getDate()).padStart(2, '0');
    let events = [];

    // Fetch tide data from appropriate API
    const apiUrl =
      country === 'canada'
        ? `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${stationID}/data?time-series-code=wlp-hilo&from=${startYear}-${startMonth2d}-${startDay2d}T00%3A00%3A00Z&to=${endYear}-${endMonth2d}-${endDay2d}T00%3A00%3A00Z`
        : `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${startYear}${startMonth2d}${startDay2d}&end_date=${endYear}${endMonth2d}${endDay2d}&station=${stationID}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`;

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
        country === 'canada' ? entry.eventDate : `${entry.t}:00`;

      const startDate = new Date(
        new Date(rawTime).toLocaleString('en-US', { timeZone: userTimezone })
      );
      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // +30 min

      const eventUID = `tide-${stationID}-${startDate.getTime()}-${Math.random()
        .toString(36)
        .substr(2, 6)}@tideincal.com`;

      const eventContent = `BEGIN:VEVENT
UID:${eventUID}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date(), country, userTimezone)}
DTSTART:${formatDateForICS(startDate, country, userTimezone)}
DTEND:${formatDateForICS(endDate, country, userTimezone)}
SUMMARY:🌊 ${stationTitle} ${tide} @ ${tideHeight}
DESCRIPTION:${tideHeight}Tide at ${stationTitle}
LOCATION:${stationTitle}
STATUS:CONFIRMED
END:VEVENT`;

      events.push(eventContent);
    });

    const calendarName = `Tide - ${stationTitle} - ${startYear}-${startMonth2d}-${startDay2d}`;
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
 * Formats a date for ICS format based on country
 */
function formatDateForICS(date, country, userTimezone) {
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
