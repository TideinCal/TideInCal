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

async function refreshAuthUI() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    let user = null;
    
    if (r.ok) {
      const data = await r.json();
      user = data.user;
      console.log('[refreshAuthUI] User authenticated:', user?.email);
    } else {
      console.log('[refreshAuthUI] User not authenticated:', r.status);
    }

                const navLoginBtn    = document.getElementById('navLoginBtn');
                const navLogoutBtn   = document.getElementById('navLogoutBtn');
                const navUserGreeting = document.getElementById('navUserGreeting');
                const navUserName    = document.getElementById('navUserName');
                const menuLoginBtn   = document.getElementById('menuLoginBtn');
                const menuLogoutBtn  = document.getElementById('menuLogoutBtn');
                const menuLogoutContainer = document.getElementById('menuLogoutContainer');
                const menuAccountLink= document.getElementById('menuAccountLink');
                const menuUserName = document.getElementById('menuUserName');

                console.log('[refreshAuthUI] Found elements:', {
                  navLoginBtn: !!navLoginBtn,
                  navLogoutBtn: !!navLogoutBtn,
                  navUserGreeting: !!navUserGreeting,
                  navUserName: !!navUserName,
                  menuLoginBtn: !!menuLoginBtn,
                  menuLogoutBtn: !!menuLogoutBtn,
                  menuLogoutContainer: !!menuLogoutContainer,
                  menuAccountLink: !!menuAccountLink,
                  menuUserName: !!menuUserName
                });

                if (user) {
                  // User is logged in - hide login, show logout and greeting
                  // Desktop navigation
                  navLoginBtn?.classList.add('d-none');
                  if (navLogoutBtn) navLogoutBtn.style.display = 'block';
                  if (navUserGreeting) navUserGreeting.style.display = 'block';
                  if (navUserName) {
                    const displayName = user.firstName || user.email.split('@')[0];
                    navUserName.textContent = displayName;
                  }
                  
                  // Mobile navigation
                  if (menuLoginBtn) menuLoginBtn.style.display = 'none';
                  if (menuLogoutContainer) {
                    menuLogoutContainer.style.display = 'flex';
                    menuLogoutContainer.classList.add('show');
                  }
                  if (menuAccountLink) menuAccountLink.style.display = 'block';
                  if (menuUserName) {
                    const displayName = user.firstName || user.email.split('@')[0];
                    menuUserName.textContent = displayName;
                  }
                  console.log('[refreshAuthUI] Showing logout UI for user:', user.email);
                } else {
                  // User is not logged in - show login, hide logout and greeting
                  // Desktop navigation
                  navLoginBtn?.classList.remove('d-none');
                  if (navLogoutBtn) navLogoutBtn.style.display = 'none';
                  if (navUserGreeting) navUserGreeting.style.display = 'none';
                  
                  // Mobile navigation
                  if (menuLoginBtn) menuLoginBtn.style.display = 'block';
                  if (menuLogoutContainer) {
                    menuLogoutContainer.style.display = 'none';
                    menuLogoutContainer.classList.remove('show');
                  }
                  if (menuAccountLink) menuAccountLink.style.display = 'none';
                  console.log('[refreshAuthUI] Showing login UI');
                }
  } catch (e) {
    console.warn('[refreshAuthUI] Auth state check failed:', e);
                // On error, assume not logged in
                const navLoginBtn    = document.getElementById('navLoginBtn');
                const navLogoutBtn   = document.getElementById('navLogoutBtn');
                const navUserGreeting = document.getElementById('navUserGreeting');
                const menuLoginBtn   = document.getElementById('menuLoginBtn');
                const menuLogoutContainer = document.getElementById('menuLogoutContainer');
                const menuAccountLink= document.getElementById('menuAccountLink');

                // Desktop navigation
                navLoginBtn?.classList.remove('d-none');
                if (navLogoutBtn) navLogoutBtn.style.display = 'none';
                if (navUserGreeting) navUserGreeting.style.display = 'none';
                
                // Mobile navigation
                if (menuLoginBtn) menuLoginBtn.style.display = 'block';
                if (menuLogoutContainer) {
                  menuLogoutContainer.style.display = 'none';
                  menuLogoutContainer.classList.remove('show');
                }
                if (menuAccountLink) menuAccountLink.style.display = 'none';
  }
}

// Auth modal functions
function openAuthModal(mode = 'signup') {
  const modal = document.getElementById('authModal');
  if (!modal) {
    console.error('Auth modal not found');
    return;
  }
  
  // Set active tab
  const loginTab = document.getElementById('loginTab');
  const signupTab = document.getElementById('signupTab');
  const loginPane = document.getElementById('loginPane');
  const signupPane = document.getElementById('signupPane');
  
  if (mode === 'login') {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginPane.classList.add('active', 'show');
    signupPane.classList.remove('active', 'show');
  } else {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupPane.classList.add('active', 'show');
    loginPane.classList.remove('active', 'show');
  }
  
  // Show modal
  if (window.bootstrap?.Modal) {
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
  } else {
    modal.style.display = 'block';
    modal.classList.add('show');
  }
}

async function handleAuth(formData, isSignup = false) {
  try {
    const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
      credentials: 'include'
    });
    
    if (!response.ok) {
      let errorMessage = 'Authentication failed';
      
      if (response.status === 429) {
        errorMessage = 'Too many requests. Please wait a moment and try again.';
      } else {
        try {
          const error = await response.json();
          errorMessage = error.error || 'Authentication failed';
        } catch (e) {
          errorMessage = `Server error (${response.status})`;
        }
      }
      
      throw new Error(errorMessage);
    }
    
    const { user } = await response.json();
    console.log('Authentication successful:', user);
    
    // Close modal
    const modal = document.getElementById('authModal');
    if (window.bootstrap?.Modal) {
      const bsModal = bootstrap.Modal.getInstance(modal);
      bsModal?.hide();
    } else {
      modal.style.display = 'none';
      modal.classList.remove('show');
    }
    
    // Refresh auth UI
    refreshAuthUI();
    
    // If we have pending station context, show plan chooser
    if (pendingStationContext) {
      setTimeout(() => {
        openPlanModal();
      }, 300); // Small delay to ensure modal closes properly
    }
    
    return true;
  } catch (error) {
    console.error('Authentication error:', error);
    alert(error.message);
    return false;
  }
}

// click handlers
document.getElementById('navLoginBtn')?.addEventListener('click', () => openAuthModal('login'));
document.getElementById('menuLoginBtn')?.addEventListener('click', () => openAuthModal('login'));

// Desktop logout button
document.getElementById('navLogoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method:'POST', credentials:'include' });
  refreshAuthUI();
});

// Mobile logout button
document.getElementById('menuLogoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method:'POST', credentials:'include' });
  refreshAuthUI();
});

// Auth form handlers
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    email: formData.get('email'),
    password: formData.get('password')
  };
  await handleAuth(data, false);
});

document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    email: formData.get('email'),
    password: formData.get('password'),
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined
  };
  await handleAuth(data, true);
});

// initial paint
document.addEventListener('DOMContentLoaded', refreshAuthUI);

// Offcanvas: close on click; smooth-scroll to anchors AFTER it closes
window.addEventListener('DOMContentLoaded', () => {
  const offcanvasEl = document.getElementById('mainOffcanvas');
  if (!offcanvasEl) return;

  const NAV_OFFSET = 56; // your fixed navbar height

  // 1) Force-close on any link/button inside the offcanvas
  offcanvasEl.addEventListener('click', (e) => {
    const item = e.target.closest('a,button');
    if (!item) return;

    // If it's a hash link, we’ll handle scroll below.
    const href = item.getAttribute('href') || '';
    const isHash = href.startsWith('#');

    // Use Bootstrap API if available; otherwise fall back to removing classes
    const hideOffcanvas = () => {
      if (window.bootstrap?.Offcanvas) {
        const oc = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
        oc.hide();
      } else {
        offcanvasEl.classList.remove('show');
        document.body.classList.remove('offcanvas-backdrop'); // best-effort fallback
      }
    };

    // If it’s a hash link, we prevent default and scroll after hidden
    if (isHash) {
      e.preventDefault();
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (!target) { hideOffcanvas(); return; }

      const onHidden = () => {
        offcanvasEl.removeEventListener('hidden.bs.offcanvas', onHidden);
        const y = target.getBoundingClientRect().top + window.pageYOffset - NAV_OFFSET;
        window.scrollTo({ top: y, behavior: 'smooth' });
      };

      offcanvasEl.addEventListener('hidden.bs.offcanvas', onHidden);
      hideOffcanvas();
      return;
    }

    // Non-hash items (e.g., /account) → just close
    hideOffcanvas();
  });
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
        <button class="btn download-btn" onclick="handleDownloadClick('${id}', '${title}', '${region}')">
          <img src="/img/whiteLogo.png" alt="calendar icon">Download File
        </button>
      </div>
    </div>`;
};

// Handle download button click
// Global variables to store station context for plan chooser
let pendingStationContext = null;

async function handleDownloadClick(stationID, stationTitle, country) {
  try {
    // Store station context for later use
    pendingStationContext = { stationID, stationTitle, country };

    // Check if user is authenticated
    const authResponse = await fetch('/api/auth/me', { credentials: 'include' });

    if (!authResponse.ok) {
      // User not authenticated, show auth modal
      openAuthModal('signup');
      return;
    }

    const { user } = await authResponse.json();

    if (!user) {
      // User not authenticated, show auth modal
      openAuthModal('signup');
      return;
    }

    // User is authenticated, show plan chooser
    openPlanModal();

  } catch (error) {
    console.error('Download error:', error);
    alert('Failed to start checkout process. Please try again.');
  }
}

// Make handleDownloadClick globally available
window.handleDownloadClick = handleDownloadClick;

// Plan chooser modal functions
function openPlanModal() {
  const modal = document.getElementById('planModal');
  if (!modal) {
    console.error('Plan modal not found');
    return;
  }

  // Show modal
  if (window.bootstrap?.Modal) {
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
  } else {
    modal.style.display = 'block';
    modal.classList.add('show');
  }
}

async function selectPlan(plan) {
  try {
    if (!pendingStationContext && plan === 'single') {
      throw new Error('Station context missing for single plan');
    }

    // Prepare checkout data
    const checkoutData = {
      plan: plan
    };

    // Add station info for single plan
    if (plan === 'single' && pendingStationContext) {
      checkoutData.stationID = pendingStationContext.stationID;
      checkoutData.stationTitle = pendingStationContext.stationTitle;
      checkoutData.country = pendingStationContext.country;
    }

    // Close plan modal
    const modal = document.getElementById('planModal');
    if (window.bootstrap?.Modal) {
      const bsModal = bootstrap.Modal.getInstance(modal);
      bsModal?.hide();
    } else {
      modal.style.display = 'none';
      modal.classList.remove('show');
    }

    // Create checkout session
    const response = await fetch('/api/checkout/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutData),
      credentials: 'include'
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create checkout session');
    }

    const { url } = await response.json();

    // Redirect to Stripe checkout
    window.location.href = url;

  } catch (error) {
    console.error('Plan selection error:', error);
    alert('Failed to start checkout process. Please try again.');
  }
}

// Make selectPlan globally available
window.selectPlan = selectPlan;

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




  // Function to find and display user's location
  function findMyLocation() {
    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      const userLocation = L.marker([latitude, longitude], { icon: myIcon }).addTo(map);
      userLocation.setLatLng([latitude, longitude]);
      userLocation.setZIndexOffset(50);
      map.panTo(new L.LatLng(latitude, longitude));
    });
  }

  // Connect all "Find My Location" buttons to the location functionality
  document.getElementById('mapBtn')?.addEventListener('click', findMyLocation);
  
  // Desktop menu "Find My Location" button
  document.querySelector('a[href="#map"]')?.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent default anchor behavior
    findMyLocation();
  });
  
  // Mobile menu "Find My Location" button  
  document.querySelector('a[href="#mapSection"]')?.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent default anchor behavior
    findMyLocation();
  });

  // Load tide stations onto the map
  loadTideStations();
};

// Wait for DOM to be ready before initializing the map
document.addEventListener('DOMContentLoaded', () => {
  initMap();
});
