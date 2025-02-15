import fetch from 'sync-fetch';
import fs from 'fs'; //fileSaver

const year = new Date().getFullYear();
const nextYr = year + 1;
const today = new Date();
const month2d = String(today.getMonth() + 1).padStart(2, '0');
const day2d = String(today.getDate()).padStart(2, '0');

// const queryFilter = `?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T00%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`;
const queryFilters = {
  canada: `?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T00%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`,
  usa: `&begin_date=${year}${month2d}${day2d}&end_date=${nextYr}${month2d}${day2d}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`
}
const metadataFilters = {
  canada: queryFilters[`canada`],
  usa: `/mdapi/prod/webapi/stations.json?type=tidepredictions&units=english`
}

const apiUrls = {
  canada: `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations`,
  usa: `https://api.tidesandcurrents.noaa.gov`
  // usa: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${year}${month2d}${day2d}&end_date=${nextYr}${month2d}${day2d}&station=${id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`
};

const outputFile = './data/validated_stations.json';
const outputFileFailed = './data/failed_stations.json';
const maxRetries = 3;

/**
 * Returns list of stations
 * @param {*} region 
 * @returns list of station objects with id, name, latitude, and longitude
 */
function fetchMetadata(region) {
  try {
    console.log(`Fetching metadata for ${region}...`);
    const response = fetch(apiUrls[region] + metadataFilters[region]);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.statusText}`);
    }
    const data = (region == 'usa'? response.json().stations : response.json());
    return data.map((station) => ({
      id: station.id,
      name: station.officialName || station.name || 'Unnamed Station',
      lat: station.latitude || station.lat,
      lon: station.longitude || station.lng,
    }));
  } catch (error) {
    console.error(`Error fetching metadata for ${region}:`, error.message);
    return [];
  }
}

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchOneYearData(station, region, attempt = 1) {
  const stationFilters = {
    canada: `/${station.id}/data`,
    usa: `/api/prod/datagetter?station=${station.id}`

  }
  const url = `${apiUrls[region]}${stationFilters[region]}${queryFilters[region]}`;
  try {
    const response = fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Station ${station.name} (ID: ${station.id}) does not return data.`);
        return false;
      }
      if (response.status === 429 && attempt < maxRetries) {
        console.log(`Rate limit reached. Retrying station ${station.name} in 2 seconds...`);
        
        return fetchOneYearData(station, attempt + 1);
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (region == 'usa'? response.json().predictions : response.json());
    // console.log(`Station ${station.name} (ID: ${station.id}) returned correctly.`);
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error(
      `Failed to fetch data for station ${station.name} (ID: ${station.id}): ${error.message}`
    );
    return false;
  }
}

async function validateStations() {
  const validatedStations = [];
  const failedStations = [];

  for (const region of ['usa', 'canada']){
    const metadata = fetchMetadata(region);
    console.log(`Unverified number of stations for region ${region}: ${metadata.length}`);
    for (const station of metadata){
      // console.log(`Validating station: ${region} ${station.name} (${station.id})`);
      const isValid = fetchOneYearData(station, region);
      if (isValid) {
        validatedStations.push(station);
      } else {
        failedStations.push(station);
      }
      await sleep(500); // 100ms too low. 500 good for canada.
      // if (region == 'canada') await sleep(500);
    }
  }

  console.log(`Validation complete. Valid stations: ${validatedStations.length}`);
  console.log(`Failed stations: ${failedStations.length}`);
  fs.writeFileSync(outputFile, JSON.stringify(validatedStations, null, 2));
  console.log(`Validated stations saved to ${outputFile}`);
    fs.writeFileSync(outputFileFailed, JSON.stringify(failedStations, null, 2));
  console.log(`Failed stations saved to ${outputFileFailed}`);
}

function testUSApi(region){
  const response = fetch(`${apiUrls[region]}${metadataFilters[region]}`);
  const data = response.json(); //data is object with keys "count", "units", "stations", "self"
  console.log(`us stations count raw: ${data.count}`);
  console.log(data.stations[0]);
}

function main() {
  validateStations();
}

main();
