import { createEvents } from 'ics';
import fetch from 'node-fetch';
import SunCalc from 'suncalc';

export async function generateICS(stationData) {
  const { id: stationID, title: stationTitle, country, includeMoon = false } = stationData;
  
  try {
    // Fetch tide data for the station
    const tideData = await fetchTideData(stationID);
    
    // Generate events
    const events = [];
    
    // Add tide events
    for (const tide of tideData) {
      events.push({
        title: `Tide: ${tide.type}`,
        start: tide.datetime,
        duration: { minutes: 30 },
        description: `${tide.type} tide at ${stationTitle}`,
        location: stationTitle,
        status: 'CONFIRMED',
        busyStatus: 'FREE'
      });
    }
    
    // Add moon events if requested
    if (includeMoon) {
      const moonEvents = await generateMoonEvents(stationTitle);
      events.push(...moonEvents);
    }
    
    // Create ICS content
    const { error, value } = createEvents(events);
    
    if (error) {
      throw new Error(`ICS generation error: ${error}`);
    }
    
    return value;
  } catch (error) {
    console.error('Error generating ICS:', error);
    throw error;
  }
}

async function fetchTideData(stationID) {
  try {
    // This is a placeholder - you'll need to implement the actual tide data fetching
    // based on your existing tide data source
    const response = await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=NOS.COOPS.TAC.WL&begin_date=20250101&end_date=20251231&datum=MLLW&station=${stationID}&time_zone=lst_ldt&units=english&interval=hilo&format=json`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch tide data: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Transform NOAA data to our format
    return data.predictions.map(pred => ({
      type: pred.type === 'H' ? 'High' : 'Low',
      datetime: new Date(pred.t)
    }));
  } catch (error) {
    console.error('Error fetching tide data:', error);
    // Return mock data for now
    return generateMockTideData();
  }
}

function generateMockTideData() {
  // Generate mock tide data for testing
  const events = [];
  const startDate = new Date();
  
  for (let i = 0; i < 30; i++) {
    const date = new Date(startDate.getTime() + (i * 24 * 60 * 60 * 1000));
    
    // High tide
    events.push({
      type: 'High',
      datetime: new Date(date.getTime() + (6 * 60 * 60 * 1000)) // 6 AM
    });
    
    // Low tide
    events.push({
      type: 'Low',
      datetime: new Date(date.getTime() + (18 * 60 * 60 * 1000)) // 6 PM
    });
  }
  
  return events;
}

async function generateMoonEvents(stationTitle) {
  const events = [];
  const startDate = new Date();
  
  for (let i = 0; i < 30; i++) {
    const date = new Date(startDate.getTime() + (i * 24 * 60 * 60 * 1000));
    const moonPhase = SunCalc.getMoonIllumination(date);
    
    // Add moon phase events for significant phases
    const phase = moonPhase.phase;
    if (phase < 0.1 || phase > 0.9) {
      events.push({
        title: 'New Moon',
        start: date,
        duration: { minutes: 60 },
        description: 'New Moon phase',
        location: stationTitle,
        status: 'CONFIRMED',
        busyStatus: 'FREE'
      });
    } else if (phase > 0.4 && phase < 0.6) {
      events.push({
        title: 'Full Moon',
        start: date,
        duration: { minutes: 60 },
        description: 'Full Moon phase',
        location: stationTitle,
        status: 'CONFIRMED',
        busyStatus: 'FREE'
      });
    }
  }
  
  return events;
}
