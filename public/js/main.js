// Define the custom icon for tide stations
const tideIcon = L.icon({
  iconUrl: 'img/waterdrop.png',
  iconSize: [36, 59],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Tide Station',
  zIndexOffset: 0,
  riseOnHover: true,
  riseOffset: 250,
});

// Define the custom icon for the user location
const myIcon = L.icon({
  iconUrl: 'img/redPin.png',
  iconSize: [36, 59],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Current Location',
  zIndexOffset: 1000,
  riseOnHover: true,
  riseOffset: 500,
});



// Declare the map variable at a global scope so it’s accessible throughout the file
let map;

// Dynamically load the popup once a tide icon is selected (bootstrap Card)
const renderModalContent = (title, id, region, lat, lon, type) => {
  localStorage.setItem('region', region);
  localStorage.setItem('stationTitle', title);
  localStorage.setItem('stationID', id);
  localStorage.setItem('latitude', lat);
  localStorage.setItem('longitude', lon);

  return `
     <div class="card">
      <div class="card-body">
        <p class="card-label">Tide Station:</p>
        <h2 class="fw-bolder" id="title">${title}</h2>
        <h6 class="card-text">
          Select "Download File" to get 1 Year Of Tide Data To Your Calendar from this station
        </h6>
        <a href="https://buy.stripe.com/test_00g6rIbmh8x08KY9AA" class="btn">
          <img src="/img/whiteLogo.png" alt="calendar icon">Download File
        </a>
      </div>
    </div>`;
};
//https://buy.stripe.com/28E14o1xvc4vcyZbaY5Rm01 <-- live link

// Fetch and display tide stations from all available regions
const loadTideStations = async () => {
  try {
    // Fetch available regions from the server
    const regionsResponse = await fetch('/api/tide-regions');
    if (!regionsResponse.ok) {
      console.error('Error fetching tide regions');
      return;
    }

    const { regions } = await regionsResponse.json();
    // console.log('Fetched regions:', regions);

    const stationMarkerGroup = L.markerClusterGroup();

    // Fetch and render stations for each region
    for (const region of regions) {
      // console.log(`Fetching stations for region: ${region}`);

      const response = await fetch(`/api/tide-stations?region=${region}`);
      if (!response.ok) {
        console.warn(`Could not load stations for region: ${region}`);
        continue;
      }

      const stations = await response.json();
      // console.log(`Fetched ${stations.length} stations for region: ${region}`);

      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];
        const marker = L.marker([station.lat, station.lon], { icon: tideIcon });

        marker.on('click', () => {
          const content = renderModalContent(
            station.name,
            station.id,
            region,
            station.lat,
            station.lon,
            `${region.toUpperCase()} Tide Station`
          );
          L.popup()
            .setLatLng([station.lat, station.lon])
            .setContent(content)
            .openOn(map);
        });

        stationMarkerGroup.addLayer(marker);
      }
    }

    // Add the marker group to the map
    map.addLayer(stationMarkerGroup);
  } catch (error) {
    console.error('Error loading tide stations:', error);
  }
};

// Initialize the map
const initMap = () => {
  // Initialize the Leaflet map and assign it to the global `map` variable
  map = L.map('map').setView([49.26083, -123.11389], 9);

  L.tileLayer(
    'https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}',
    {
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
      maxZoom: 18,
      id: 'mapbox/streets-v11',
      tileSize: 512,
      zoomOffset: -1,
      accessToken: 'pk.eyJ1Ijoiam5lbHNvbjMzIiwiYSI6ImNqODIxZGpsNjcycnYzMnFueGlkdWQ0a3IifQ.TF0Kw6EQM-dt6bc4EGKM6g',
    }
  ).addTo(map);

  // Enable finding and displaying the user's location
  document.getElementById('mapBtn').addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      const userLocation = L.marker([latitude, longitude], { icon: myIcon }).addTo(map);
      userLocation.setLatLng([latitude, longitude]);
      userLocation.setZIndexOffset(50);
      map.panTo(new L.LatLng(latitude, longitude));
    });
  });

  // Load tide stations onto the map
  loadTideStations();
};

// Call the initMap function to start
initMap();
