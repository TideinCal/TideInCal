// Define the custom icon for tide stations
const tideIcon = L.icon({
  iconUrl: '/img/tideStations.png',
  iconSize: [59, 59],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Tide Station',
  zIndexOffset: 0,
  riseOnHover: true,
  riseOffset: 250,
});

console.log('Tide icon created:', tideIcon);

// Define the custom icon for the user location
const myIcon = L.icon({
  iconUrl: '/img/homeIcon.png',
  iconSize: [59, 59],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Current Location',
  zIndexOffset: 1000,
  riseOnHover: true,
  riseOffset: 500,
});

console.log('User location icon created:', myIcon);



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
        <a href="https://buy.stripe.com/28E14o1xvc4vcyZbaY5Rm01" class="btn">
          <img src="/img/whiteLogo.png" alt="calendar icon">Download File
        </a>
      </div>
    </div>`;
};

//https://buy.stripe.com/test_00g6rIbmh8x08KY9AA <-- Test Link

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

    const stationMarkerGroup = L.markerClusterGroup();

    // Fetch and render stations for each region
    for (const region of regions) {
      try {
        const response = await fetch(`/api/tide-stations?region=${region}`);
        if (!response.ok) {
          console.warn(`Could not load stations for region: ${region}`);
          continue;
        }

        const stations = await response.json();

      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];

        // Extract coordinates with fallback for different property names
        const lat = station.lat || station.latitude || station.Latitude;
        const lon = station.lon || station.lng || station.longitude || station.Longitude;

        // Skip stations without valid numeric coordinates
        if (typeof lat !== 'number' || typeof lon !== 'number' ||
            isNaN(lat) || isNaN(lon) ||
            lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          console.warn(`Skipping station with invalid coordinates:`, station);
          continue;
        }

        const marker = L.marker([lat, lon], { icon: tideIcon });

        marker.on('click', () => {
          const content = renderModalContent(
            station.name,
            station.id,
            region,
            lat,
            lon,
            `${region.toUpperCase()} Tide Station`
          );
          L.popup()
            .setLatLng([lat, lon])
            .setContent(content)
            .openOn(map);
        });

        stationMarkerGroup.addLayer(marker);
      }
      } catch (error) {
        console.error(`Error loading stations for region ${region}:`, error);
        continue;
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
  console.log('Initializing map...');
  console.log('Map element:', document.getElementById('map'));

  // Initialize the Leaflet map and assign it to the global `map` variable
  map = L.map('map').setView([49.26083, -123.11389], 3);
  console.log('Map created:', map);

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

  // Add geocoder control with Nominatim provider
  const provider = new L.Control.Geocoder.Nominatim({
    geocodingQueryParams: {
      countrycodes: 'us,ca',
      limit: 5
    }
  });

  const geocoder = L.Control.geocoder({
    position: 'topright',
    placeholder: 'Search for a place...',
    defaultMarkGeocode: false,
    geocoder: provider
  }).addTo(map);

  // Handle geocoder results
  geocoder.on('markgeocode', function(e) {
    const result = e.geocode;
    const latlng = result.center;

    // Pan to the result location with zoom level 12
    map.setView(latlng, 12);

    // Add a temporary marker at the searched location
    const searchMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'search-marker',
        html: '<div style="background-color: #007bff; width: 20px; height: 20px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      })
    }).addTo(map);



    // Remove the marker after 5 seconds
    setTimeout(() => {
      map.removeLayer(searchMarker);
    }, 5000);
  });




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

// Wait for DOM to be ready before initializing the map
document.addEventListener('DOMContentLoaded', () => {
  initMap();
});
