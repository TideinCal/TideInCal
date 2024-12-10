const fs = require('fs');
const fetch = require('node-fetch');

// URLs for tide station data
const urls = {
  canada: 'https://api-iwls.dfo-mpo.gc.ca/api/v1/stations',
  usa: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/tidepredstations.json',
};

// Function to fetch and validate tide stations
const validateStations = async () => {
  for (const [region, url] of Object.entries(urls)) {
    try {
      console.log(`Fetching data for ${region}...`);
      const response = await fetch(url);
      const data = await response.json();

      let validatedStations = [];

      if (region === 'canada') {
        // Filter Canadian stations with valid data
        validatedStations = data
          .filter(
            (station) =>
              station.type === 'PERMANENT' &&
              station.timeSeries.some((ts) => ts.code === 'wlp-hilo')
          )
          .map((station) => ({
            id: station.id,
            name: station.officialName,
            lat: station.latitude,
            lon: station.longitude,
          }));
      } else if (region === 'usa') {
        // Map NOAA stations
        validatedStations = data.stationList.map((station) => ({
          id: station.stationId,
          name: station.name,
          lat: station.lat,
          lon: station.lon,
        }));
      }

      // Save validated data to JSON file
      const filePath = `./data/${region}_stations.json`;
      fs.writeFileSync(filePath, JSON.stringify(validatedStations, null, 2));
      console.log(`${region} stations saved to ${filePath}`);
    } catch (error) {
      console.error(`Failed to process ${region}:`, error);
    }
  }
};

validateStations();
