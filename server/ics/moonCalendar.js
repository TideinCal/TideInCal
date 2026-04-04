/**
 * Moon phases ICS calendar using Astronomy Engine.
 * Principal phases (New Moon, First Quarter, Full Moon, Last Quarter) use exact
 * event times from Astronomy Engine and are assigned by local calendar date in
 * the target timezone. Daily moon info is from Astronomy Engine. All lunar and
 * solar eclipses in range are included.
 *
 * Daily evaluation rule: For each local calendar day we evaluate the moon at
 * local noon in the target timezone (the UTC instant that is 12:00 on that
 * local date). Phase name comes from Astronomy.MoonPhase; illumination % from
 * Astronomy.Illumination only.
 */
import * as Astronomy from 'astronomy-engine';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const EIGHT_PHASES = [
  { key: 'new', label: 'New Moon', summary: '🌑 New Moon', isMajor: true },
  { key: 'waxingCrescent', label: 'Waxing Crescent', summary: '🌒 Waxing Crescent', isMajor: false },
  { key: 'firstQuarter', label: 'First Quarter', summary: '🌓 First Quarter', isMajor: true },
  { key: 'waxingGibbous', label: 'Waxing Gibbous', summary: '🌔 Waxing Gibbous', isMajor: false },
  { key: 'full', label: 'Full Moon', summary: '🌕 Full Moon', isMajor: true },
  { key: 'waningGibbous', label: 'Waning Gibbous', summary: '🌖 Waning Gibbous', isMajor: false },
  { key: 'lastQuarter', label: 'Last Quarter', summary: '🌗 Last Quarter', isMajor: true },
  { key: 'waningCrescent', label: 'Waning Crescent', summary: '🌘 Waning Crescent', isMajor: false }
];

const DEFAULT_FULL_MOON_NAMES = {
  1: 'Wolf Moon',
  2: 'Snow Moon',
  3: 'Worm Moon',
  4: 'Pink Moon',
  5: 'Flower Moon',
  6: 'Strawberry Moon',
  7: 'Buck Moon',
  8: 'Sturgeon Moon',
  9: 'Corn Moon',
  10: "Hunter's Moon",
  11: 'Beaver Moon',
  12: 'Cold Moon'
};

/** Approved visibility note for solar eclipses. */
const SOLAR_ECLIPSE_VISIBILITY =
  'Visible from parts of Earth along the eclipse path. Strongest visibility occurs along the central path for total or annular eclipses. Check NASA eclipse resources for exact visibility locations.';

/** Approved visibility note for lunar eclipses. */
const LUNAR_ECLIPSE_VISIBILITY =
  'Visible from regions on the night side of Earth where the Moon is above the horizon. Check NASA eclipse resources for exact visibility details.';

function normalizeDateUtcStart(date) {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Noon UTC on the given UTC calendar day. Used only as reference when resolving local-noon instant. */
function noonUtcOnDay(date) {
  const d = normalizeDateUtcStart(date);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

/** Next calendar day in YYYY-MM-DD (UTC date arithmetic, for boundary search only). */
function nextDayKey(dateKey) {
  const d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns the UTC instant that is local noon (12:00) on the given local calendar
 * date in the given timezone. Used as the single consistent daily evaluation time
 * for moon phase and illumination: one evaluation per local day at local noon.
 */
function getUtcForLocalNoon(localDateKeyStr, timezone, referenceUtcMs) {
  const low = referenceUtcMs - MS_PER_DAY * 2;
  const high = referenceUtcMs + MS_PER_DAY * 2;
  let tMin = low;
  let tMax = high;
  for (let t = low; t <= high; t += 60 * 60 * 1000) {
    if (localDateKey(new Date(t), timezone) === localDateKeyStr) {
      tMin = t;
      break;
    }
  }
  const nextKey = nextDayKey(localDateKeyStr);
  for (let t = tMin; t <= high; t += 60 * 60 * 1000) {
    if (localDateKey(new Date(t), timezone) === nextKey) {
      tMax = t;
      break;
    }
  }
  return new Date(Math.round((tMin + tMax) / 2));
}

function formatUtcStamp(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Returns the local calendar date (YYYY-MM-DD) in the given IANA timezone for the given UTC moment.
 */
function localDateKey(utcDate, timezone) {
  const d = new Date(utcDate);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(d);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const day = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${day}`;
}

/**
 * Format local date key as ICS VALUE=DATE (YYYYMMDD).
 */
function localDateToIcsValue(localDateKeyStr) {
  return localDateKeyStr.replace(/-/g, '');
}

/**
 * Format a UTC date as local date and time string in the target timezone (for descriptions).
 */
function formatPeakInTimezone(utcDate, timezone) {
  return new Date(utcDate).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' });
}

/**
 * Principal phase dates from Astronomy Engine: SearchMoonQuarter + NextMoonQuarter.
 * Quarter: 0 = New Moon, 1 = First Quarter, 2 = Full Moon, 3 = Last Quarter.
 * Returns Maps of local date key (YYYY-MM-DD) → peak UTC Date for each principal phase.
 */
function getPrincipalPhaseDatesByLocal(startMs, endMs, timezone) {
  const newSet = new Map();
  const firstQuarterSet = new Map();
  const fullSet = new Map();
  const lastQuarterSet = new Map();
  const endMsInclusive = endMs + MS_PER_DAY - 1;

  let mq = Astronomy.SearchMoonQuarter(new Date(startMs - MS_PER_DAY * 2));
  while (mq.time.date.getTime() <= endMsInclusive) {
    const peakMs = mq.time.date.getTime();
    if (peakMs >= startMs) {
      const localKey = localDateKey(mq.time.date, timezone);
      if (mq.quarter === 0) newSet.set(localKey, mq.time.date);
      else if (mq.quarter === 1) firstQuarterSet.set(localKey, mq.time.date);
      else if (mq.quarter === 2) fullSet.set(localKey, mq.time.date);
      else lastQuarterSet.set(localKey, mq.time.date);
    }
    mq = Astronomy.NextMoonQuarter(mq);
    if (mq.time.date.getTime() > endMsInclusive + MS_PER_DAY * 32) break;
  }

  return { new: newSet, firstQuarter: firstQuarterSet, full: fullSet, lastQuarter: lastQuarterSet };
}

/**
 * Compute traditional full moon names for all full moons that fall within the
 * generated date range. Searches a wider window so Harvest/Hunter Moon assignment
 * is correct even when the range starts after the autumnal equinox.
 *
 * Algorithm: default month name → Blue Moon override (second in month) →
 * Harvest Moon (closest to autumnal equinox) → Hunter's Moon (next after Harvest).
 */
function getTraditionalFullMoonNames(startMs, endMs, timezone) {
  const wideStartMs = startMs - MS_PER_DAY * 90;
  const wideEndMs = endMs + MS_PER_DAY * 90;

  const allFullMoons = [];
  let mq = Astronomy.SearchMoonQuarter(new Date(wideStartMs - MS_PER_DAY * 35));
  while (mq.time.date.getTime() <= wideEndMs) {
    if (mq.quarter === 2) {
      const localKey = localDateKey(mq.time.date, timezone);
      const parts = localKey.split('-');
      allFullMoons.push({
        peakDate: mq.time.date,
        localDateKey: localKey,
        localYear: parseInt(parts[0], 10),
        localMonth: parseInt(parts[1], 10),
        peakMs: mq.time.date.getTime()
      });
    }
    mq = Astronomy.NextMoonQuarter(mq);
    if (mq.time.date.getTime() > wideEndMs + MS_PER_DAY * 35) break;
  }

  const years = [...new Set(allFullMoons.map((fm) => fm.localYear))];
  const equinoxByYear = {};
  for (const year of years) {
    try {
      equinoxByYear[year] = Astronomy.Seasons(year).sep_equinox.date.getTime();
    } catch (_) {
      equinoxByYear[year] = new Date(Date.UTC(year, 8, 22, 12)).getTime();
    }
  }

  const names = new Map();

  for (const fm of allFullMoons) {
    names.set(fm.localDateKey, DEFAULT_FULL_MOON_NAMES[fm.localMonth] || 'Full Moon');
  }

  const monthYearGroups = {};
  for (const fm of allFullMoons) {
    const key = `${fm.localYear}-${fm.localMonth}`;
    if (!monthYearGroups[key]) monthYearGroups[key] = [];
    monthYearGroups[key].push(fm);
  }
  for (const group of Object.values(monthYearGroups)) {
    if (group.length > 1) {
      for (let i = 1; i < group.length; i++) {
        names.set(group[i].localDateKey, 'Blue Moon');
      }
    }
  }

  for (const year of years) {
    const equinoxMs = equinoxByYear[year];
    if (!equinoxMs) continue;
    let harvestFm = null;
    let minDist = Infinity;
    for (const fm of allFullMoons) {
      const dist = Math.abs(fm.peakMs - equinoxMs);
      if (dist < 45 * MS_PER_DAY && dist < minDist) {
        minDist = dist;
        harvestFm = fm;
      }
    }
    if (harvestFm) {
      names.set(harvestFm.localDateKey, 'Harvest Moon');
      const idx = allFullMoons.indexOf(harvestFm);
      if (idx >= 0 && idx + 1 < allFullMoons.length) {
        names.set(allFullMoons[idx + 1].localDateKey, "Hunter's Moon");
      }
    }
  }

  return names;
}

/**
 * Daily descriptive moon phase for non-principal days only. Uses Astronomy.MoonPhase
 * (cycle position 0–360°) and Astronomy.Illumination for display.
 * Must never output New Moon, First Quarter, Full Moon, or Last Quarter — those
 * are reserved for the exact principal-phase event logic. Returns only one of:
 * Waxing Crescent, Waxing Gibbous, Waning Gibbous, Waning Crescent.
 */
function getDailyMoonFromAstronomy(evalDateUtc) {
  const lon = Astronomy.MoonPhase(evalDateUtc);
  const ill = Astronomy.Illumination(Astronomy.Body.Moon, evalDateUtc);
  const illumination = Math.round(ill.phase_fraction * 1000) / 10;

  let idx;
  if (lon >= 337.5 || lon < 22.5) {
    idx = lon < 22.5 ? 1 : 7;
  } else if (lon < 67.5) {
    idx = 1;
  } else if (lon < 112.5) {
    idx = lon < 90 ? 1 : 3;
  } else if (lon < 157.5) {
    idx = 3;
  } else if (lon < 202.5) {
    idx = lon < 180 ? 3 : 5;
  } else if (lon < 247.5) {
    idx = 5;
  } else if (lon < 292.5) {
    idx = lon < 270 ? 5 : 7;
  } else {
    idx = 7;
  }

  const info = EIGHT_PHASES[idx];
  return {
    phaseName: info.label,
    phaseKey: info.key,
    summary: info.summary,
    illumination
  };
}

const MAJOR_LABELS = {
  new: { phaseName: 'New Moon', summary: '🌑 New Moon', illumination: 0 },
  firstQuarter: { phaseName: 'First Quarter', summary: '🌓 First Quarter', illumination: 50 },
  full: { phaseName: 'Full Moon', summary: '🌕 Full Moon', illumination: 100 },
  lastQuarter: { phaseName: 'Last Quarter', summary: '🌗 Last Quarter', illumination: 50 }
};

function eclipseKindToLunarTitle(kind) {
  switch (kind) {
    case Astronomy.EclipseKind.Penumbral:
      return 'Penumbral Lunar Eclipse';
    case Astronomy.EclipseKind.Partial:
      return 'Partial Lunar Eclipse';
    case Astronomy.EclipseKind.Total:
      return 'Total Lunar Eclipse';
    default:
      return 'Lunar Eclipse';
  }
}

function eclipseKindToSolarTitle(kind) {
  switch (kind) {
    case Astronomy.EclipseKind.Partial:
      return 'Partial Solar Eclipse';
    case Astronomy.EclipseKind.Annular:
      return 'Annular Solar Eclipse';
    case Astronomy.EclipseKind.Total:
      return 'Total Solar Eclipse';
    default:
      return 'Solar Eclipse';
  }
}

/**
 * Collect all lunar and solar eclipses whose peak falls within [startMs, endMs] (inclusive of full range).
 * Each returned item: { title, peakDate, localDateKey, visibilityNote, isLunar }.
 */
function getEclipsesInRange(startMs, endMs, timezone) {
  const results = [];
  const endMsInclusive = endMs + MS_PER_DAY - 1;

  let le = Astronomy.SearchLunarEclipse(new Date(startMs - MS_PER_DAY * 15));
  while (le.peak.date.getTime() <= endMsInclusive) {
    if (le.peak.date.getTime() >= startMs) {
      results.push({
        title: eclipseKindToLunarTitle(le.kind),
        peakDate: le.peak.date,
        localDateKey: localDateKey(le.peak.date, timezone),
        visibilityNote: LUNAR_ECLIPSE_VISIBILITY,
        isLunar: true
      });
    }
    le = Astronomy.NextLunarEclipse(le.peak);
    if (le.peak.date.getTime() > endMsInclusive + MS_PER_DAY * 400) break;
  }

  let se = Astronomy.SearchGlobalSolarEclipse(new Date(startMs - MS_PER_DAY * 15));
  while (se.peak.date.getTime() <= endMsInclusive) {
    if (se.peak.date.getTime() >= startMs) {
      results.push({
        title: eclipseKindToSolarTitle(se.kind),
        peakDate: se.peak.date,
        localDateKey: localDateKey(se.peak.date, timezone),
        visibilityNote: SOLAR_ECLIPSE_VISIBILITY,
        isLunar: false
      });
    }
    se = Astronomy.NextGlobalSolarEclipse(se.peak);
    if (se.peak.date.getTime() > endMsInclusive + MS_PER_DAY * 400) break;
  }

  return results;
}

/** Build DESCRIPTION lines for a daily moon event (phase, illumination, optional tidal line). */
function buildMoonDescription(phaseName, illumination, isMajor, opts = {}) {
  const { traditionalName, peakTimeStr } = opts;
  const phaseLabel = traditionalName ? `${phaseName} (${traditionalName})` : phaseName;
  const lines = [`Lunar phase: ${phaseLabel}`];
  if (peakTimeStr) {
    lines.push(`Peak: ${peakTimeStr}`);
  }
  lines.push(`Illumination: ${illumination}%`);
  if (isMajor) {
    if (phaseName === 'New Moon' || phaseName === 'Full Moon') {
      lines.push('Tidal ranges are often stronger near full and new moons.');
    } else if (phaseName === 'First Quarter' || phaseName === 'Last Quarter') {
      lines.push('Tidal ranges are often more moderate near quarter moons.');
    }
  }
  return lines.join('\\n');
}

/** Build DESCRIPTION for an eclipse event: type, peak date/time in target TZ, visibility note. */
function buildEclipseDescription(title, peakDate, timezone, visibilityNote) {
  const lines = [
    title,
    `Peak: ${formatPeakInTimezone(peakDate, timezone)}`,
    visibilityNote
  ];
  return lines.join('\\n');
}

/**
 * Add one calendar year, respecting month boundaries and leap years.
 */
export function addCalendarYear(date) {
  const d = new Date(date);
  const year = d.getUTCFullYear() + 1;
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  return new Date(Date.UTC(year, month, day));
}

/**
 * Generate moon phases ICS calendar: one all-day event per day in the range (by local date in target timezone),
 * plus one event per eclipse. Principal phases are assigned by local calendar date from Astronomy Engine exact times.
 * Daily moon data is from Astronomy Engine at noon UTC for that day (descriptive only).
 *
 * @param {Date|string} startDate - start of range (inclusive), date-only
 * @param {Date|string} endDate - end of range (inclusive), date-only
 * @param {string} [userTimezone='UTC'] - IANA timezone for local date assignment and peak time display
 * @returns {string} ICS calendar content
 */
export function generateMoonCalendar(startDate, endDate, userTimezone = 'UTC') {
  const startUtc = normalizeDateUtcStart(startDate);
  const endUtc = normalizeDateUtcStart(endDate);
  const startMs = startUtc.getTime();
  const endMs = endUtc.getTime();
  const dtStamp = formatUtcStamp(new Date());
  const events = [];
  const timezone = userTimezone && String(userTimezone).trim() ? userTimezone.trim() : 'UTC';

  const majorDates = getPrincipalPhaseDatesByLocal(startMs, endMs, timezone);
  const eclipses = getEclipsesInRange(startMs, endMs, timezone);
  const traditionalNames = getTraditionalFullMoonNames(startMs, endMs, timezone);

  const localStart = localDateKey(new Date(startMs), timezone);
  const localEnd = localDateKey(new Date(endMs + MS_PER_DAY - 1), timezone);
  const localDateToEvalTime = new Map();
  for (let t = startMs - MS_PER_DAY; t <= endMs + MS_PER_DAY; t += MS_PER_DAY) {
    const dayStart = new Date(t);
    const evalTime = noonUtcOnDay(dayStart);
    const localKey = localDateKey(evalTime, timezone);
    if (localKey >= localStart && localKey <= localEnd && !localDateToEvalTime.has(localKey)) {
      localDateToEvalTime.set(localKey, evalTime);
    }
  }

  const sortedLocalDates = [...localDateToEvalTime.keys()].sort();
  for (const localKey of sortedLocalDates) {
    const referenceUtc = localDateToEvalTime.get(localKey);
    const evalTime = getUtcForLocalNoon(localKey, timezone, referenceUtc.getTime());
    const phaseInfo = getDailyMoonFromAstronomy(evalTime);
    let phaseName, summary, isMajor, illumination;
    let peakDate = null;
    let traditionalName = null;
    if (majorDates.new.has(localKey)) {
      phaseName = MAJOR_LABELS.new.phaseName;
      summary = MAJOR_LABELS.new.summary;
      isMajor = true;
      illumination = MAJOR_LABELS.new.illumination;
      peakDate = majorDates.new.get(localKey);
    } else if (majorDates.firstQuarter.has(localKey)) {
      phaseName = MAJOR_LABELS.firstQuarter.phaseName;
      summary = MAJOR_LABELS.firstQuarter.summary;
      isMajor = true;
      illumination = MAJOR_LABELS.firstQuarter.illumination;
      peakDate = majorDates.firstQuarter.get(localKey);
    } else if (majorDates.full.has(localKey)) {
      traditionalName = traditionalNames.get(localKey) || null;
      phaseName = MAJOR_LABELS.full.phaseName;
      summary = traditionalName ? `🌕 ${traditionalName}` : MAJOR_LABELS.full.summary;
      isMajor = true;
      illumination = MAJOR_LABELS.full.illumination;
      peakDate = majorDates.full.get(localKey);
    } else if (majorDates.lastQuarter.has(localKey)) {
      phaseName = MAJOR_LABELS.lastQuarter.phaseName;
      summary = MAJOR_LABELS.lastQuarter.summary;
      isMajor = true;
      illumination = MAJOR_LABELS.lastQuarter.illumination;
      peakDate = majorDates.lastQuarter.get(localKey);
    } else {
      phaseName = phaseInfo.phaseName;
      summary = phaseInfo.summary;
      isMajor = false;
      illumination = phaseInfo.illumination;
    }

    const dtStart = localDateToIcsValue(localKey);
    const dtEnd = dtStart;
    const uid = `moon-${dtStart}@tideincal.com`;
    const isNearMajorBleed =
      illumination >= 99 || illumination <= 1 || (illumination >= 48 && illumination <= 52);
    const summaryLine =
      isMajor || isNearMajorBleed ? summary : `${summary} @ ${illumination}%`;
    const peakTimeStr = peakDate ? formatPeakInTimezone(peakDate, timezone) : null;
    const description = buildMoonDescription(phaseName, illumination, isMajor, {
      traditionalName,
      peakTimeStr
    });

    events.push(`BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dtStamp}
SUMMARY:${summaryLine}
DTSTART;VALUE=DATE:${dtStart}
DTEND;VALUE=DATE:${dtEnd}
DESCRIPTION:${description}
END:VEVENT`);
  }

  eclipses.forEach((eclipse, i) => {
    const dtStart = localDateToIcsValue(eclipse.localDateKey);
    const uid = `eclipse-${dtStart}-${i}-${eclipse.isLunar ? 'lunar' : 'solar'}@tideincal.com`;
    const description = buildEclipseDescription(
      eclipse.title,
      eclipse.peakDate,
      timezone,
      eclipse.visibilityNote
    );
    events.push(`BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dtStamp}
SUMMARY:${eclipse.title}
DTSTART;VALUE=DATE:${dtStart}
DTEND;VALUE=DATE:${dtStart}
DESCRIPTION:${description}
END:VEVENT`);
  });

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TideInCal//MoonPhases//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Moon Phases
${events.join('\n')}
END:VCALENDAR`;
}
