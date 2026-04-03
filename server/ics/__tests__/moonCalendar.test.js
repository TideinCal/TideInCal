import { describe, it, expect } from 'vitest';
import { generateMoonCalendar } from '../moonCalendar.js';

/**
 * Parse ICS output into an array of event objects with key → value maps.
 */
function parseEvents(ics) {
  const events = [];
  let current = null;
  for (const line of ics.split('\n')) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
    } else if (line === 'END:VEVENT') {
      events.push(current);
      current = null;
    } else if (current) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        current[line.slice(0, colonIdx)] = line.slice(colonIdx + 1);
      }
    }
  }
  return events;
}

function fullMoonEvents(ics) {
  return parseEvents(ics).filter((e) => e.SUMMARY?.includes('🌕'));
}

function eventOnDate(events, yyyymmdd) {
  return events.find((e) => e['DTSTART;VALUE=DATE'] === yyyymmdd);
}

// ─── Timezone date assignment (the core bug fix) ────────────────────────────

describe('timezone date assignment', () => {
  it('places April 2026 full moon on April 1st in America/New_York', () => {
    const ics = generateMoonCalendar('2026-03-28', '2026-04-05', 'America/New_York');
    const moons = fullMoonEvents(ics);
    expect(moons).toHaveLength(1);
    expect(moons[0]['DTSTART;VALUE=DATE']).toBe('20260401');
  });

  it('places April 2026 full moon on April 2nd in UTC', () => {
    const ics = generateMoonCalendar('2026-03-28', '2026-04-05', 'UTC');
    const moons = fullMoonEvents(ics);
    expect(moons).toHaveLength(1);
    expect(moons[0]['DTSTART;VALUE=DATE']).toBe('20260402');
  });

  it('places April 2026 full moon on April 1st in America/Los_Angeles', () => {
    const ics = generateMoonCalendar('2026-03-28', '2026-04-05', 'America/Los_Angeles');
    const moons = fullMoonEvents(ics);
    expect(moons).toHaveLength(1);
    expect(moons[0]['DTSTART;VALUE=DATE']).toBe('20260401');
  });
});

// ─── Traditional moon names for 2026 ───────────────────────────────────────

describe('traditional moon names (2026, America/New_York)', () => {
  const ics = generateMoonCalendar('2026-01-01', '2026-12-31', 'America/New_York');
  const moons = fullMoonEvents(ics);

  const expected = [
    { date: '20260103', name: 'Wolf Moon' },
    { date: '20260201', name: 'Snow Moon' },
    { date: '20260303', name: 'Worm Moon' },
    { date: '20260401', name: 'Pink Moon' },
    { date: '20260501', name: 'Flower Moon' },
    { date: '20260531', name: 'Blue Moon' },
    { date: '20260629', name: 'Strawberry Moon' },
    { date: '20260729', name: 'Buck Moon' },
    { date: '20260828', name: 'Sturgeon Moon' },
    { date: '20260926', name: 'Harvest Moon' },
    { date: '20261026', name: "Hunter's Moon" },
    { date: '20261124', name: 'Beaver Moon' },
    { date: '20261223', name: 'Cold Moon' }
  ];

  it('produces exactly 13 full moons', () => {
    expect(moons).toHaveLength(13);
  });

  for (const { date, name } of expected) {
    it(`${name} on ${date}`, () => {
      const event = eventOnDate(moons, date);
      expect(event).toBeDefined();
      expect(event.SUMMARY).toBe(`🌕 ${name}`);
    });
  }
});

// ─── Blue Moon detection ───────────────────────────────────────────────────

describe('Blue Moon detection', () => {
  const ics = generateMoonCalendar('2026-05-01', '2026-05-31', 'America/New_York');
  const moons = fullMoonEvents(ics);

  it('May 2026 has two full moons', () => {
    expect(moons).toHaveLength(2);
  });

  it('first May full moon is Flower Moon', () => {
    expect(moons[0].SUMMARY).toBe('🌕 Flower Moon');
    expect(moons[0]['DTSTART;VALUE=DATE']).toBe('20260501');
  });

  it('second May full moon is Blue Moon', () => {
    expect(moons[1].SUMMARY).toBe('🌕 Blue Moon');
    expect(moons[1]['DTSTART;VALUE=DATE']).toBe('20260531');
  });
});

// ─── Harvest / Hunter Moon assignment ──────────────────────────────────────

describe('Harvest and Hunter Moon', () => {
  const ics = generateMoonCalendar('2026-09-01', '2026-11-30', 'America/New_York');
  const moons = fullMoonEvents(ics);

  it('September full moon is Harvest Moon', () => {
    const sep = moons.find((m) => m['DTSTART;VALUE=DATE']?.startsWith('202609'));
    expect(sep).toBeDefined();
    expect(sep.SUMMARY).toBe('🌕 Harvest Moon');
  });

  it('October full moon is Hunter\'s Moon', () => {
    const oct = moons.find((m) => m['DTSTART;VALUE=DATE']?.startsWith('202610'));
    expect(oct).toBeDefined();
    expect(oct.SUMMARY).toBe("🌕 Hunter's Moon");
  });

  it('November full moon is Beaver Moon (not Hunter\'s)', () => {
    const nov = moons.find((m) => m['DTSTART;VALUE=DATE']?.startsWith('202611'));
    expect(nov).toBeDefined();
    expect(nov.SUMMARY).toBe('🌕 Beaver Moon');
  });
});

// ─── Peak times in descriptions ────────────────────────────────────────────

describe('peak times in descriptions', () => {
  const ics = generateMoonCalendar('2026-03-28', '2026-04-05', 'America/New_York');
  const events = parseEvents(ics);

  it('full moon description includes Peak line with EDT', () => {
    const fullMoon = events.find((e) => e.SUMMARY?.includes('🌕'));
    expect(fullMoon.DESCRIPTION).toContain('Peak:');
    expect(fullMoon.DESCRIPTION).toMatch(/EDT|EST/);
  });

  it('full moon description includes traditional name in parentheses', () => {
    const fullMoon = events.find((e) => e.SUMMARY?.includes('🌕'));
    expect(fullMoon.DESCRIPTION).toContain('Full Moon (Pink Moon)');
  });

  it('major non-full-moon phase includes Peak line', () => {
    const newMoon = events.find((e) => e.SUMMARY?.includes('🌑'));
    if (newMoon) {
      expect(newMoon.DESCRIPTION).toContain('Peak:');
    }
  });
});

// ─── Year independence ─────────────────────────────────────────────────────

describe('year independence (2027)', () => {
  const ics = generateMoonCalendar('2027-01-01', '2027-12-31', 'America/New_York');
  const moons = fullMoonEvents(ics);

  it('produces exactly 12 full moons (no Blue Moon in 2027)', () => {
    expect(moons).toHaveLength(12);
  });

  it('no moon is named Blue Moon', () => {
    expect(moons.every((m) => !m.SUMMARY.includes('Blue Moon'))).toBe(true);
  });

  it('has a Harvest Moon', () => {
    expect(moons.some((m) => m.SUMMARY.includes('Harvest Moon'))).toBe(true);
  });

  it("has a Hunter's Moon after Harvest Moon", () => {
    const harvestIdx = moons.findIndex((m) => m.SUMMARY.includes('Harvest Moon'));
    expect(harvestIdx).toBeGreaterThanOrEqual(0);
    expect(harvestIdx + 1).toBeLessThan(moons.length);
    expect(moons[harvestIdx + 1].SUMMARY).toContain("Hunter's Moon");
  });
});

// ─── Edge case: range starting after equinox ───────────────────────────────

describe('range starting after equinox', () => {
  const ics = generateMoonCalendar('2026-10-01', '2026-12-31', 'America/New_York');
  const moons = fullMoonEvents(ics);

  it("October moon is Hunter's Moon (not Harvest)", () => {
    const oct = moons.find((m) => m['DTSTART;VALUE=DATE']?.startsWith('202610'));
    expect(oct).toBeDefined();
    expect(oct.SUMMARY).toBe("🌕 Hunter's Moon");
  });

  it('November moon is Beaver Moon', () => {
    const nov = moons.find((m) => m['DTSTART;VALUE=DATE']?.startsWith('202611'));
    expect(nov).toBeDefined();
    expect(nov.SUMMARY).toBe('🌕 Beaver Moon');
  });
});

// ─── Description format for non-full-moon phases ──────────────────────────

describe('description format', () => {
  const ics = generateMoonCalendar('2026-04-01', '2026-04-01', 'America/New_York');
  const events = parseEvents(ics);

  it('full moon description starts with Lunar phase label', () => {
    const fullMoon = events.find((e) => e.SUMMARY?.includes('🌕'));
    if (fullMoon) {
      expect(fullMoon.DESCRIPTION).toMatch(/^Lunar phase:/);
    }
  });
});

// ─── Daily event coverage ─────────────────────────────────────────────────

describe('daily event coverage', () => {
  const ics = generateMoonCalendar('2026-04-01', '2026-04-07', 'UTC');
  const events = parseEvents(ics).filter((e) => e.UID?.includes('moon-'));

  it('generates one event per day in range', () => {
    expect(events).toHaveLength(7);
  });

  it('events have sequential dates', () => {
    const dates = events.map((e) => e['DTSTART;VALUE=DATE']).sort();
    expect(dates).toEqual([
      '20260401', '20260402', '20260403', '20260404',
      '20260405', '20260406', '20260407'
    ]);
  });
});
