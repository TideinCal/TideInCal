const tideIcon = L.icon({
  iconUrl: 'img/waterdrop.png',
  iconSize: [36, 59],
  iconAnchor: [22, 50],
  clickable: false,
  title: 'Desired Location',
  zIndexOffset: 0,
  riseOnHover: true,
  riseOffset: 250,
});

// Get purchaseId or session_id from URL query string
const urlParams = new URLSearchParams(window.location.search);
const purchaseId = urlParams.get('purchaseId');
const sessionId = urlParams.get('session_id');
const FIRST_DOWNLOAD_VERIFY_KEY = 'firstDownloadVerifyRedirect';

// Initialize variables
let country, stationTitle, stationID, lat, long;
let isSubscriptionPurchase = false;

let csrfToken = null;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/csrf', { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Unable to fetch CSRF token');
  }
  const data = await response.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

// If we have purchaseId, fetch purchase data from API
if (purchaseId) {
  console.log('[dlFile] Attempting to load purchase:', purchaseId);
  
  // Fetch purchase data to get station info
  fetch(`/api/auth/me/purchases`, { credentials: 'include' })
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to fetch purchases: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      const purchases = data.purchases || [];
      // Match against _id (Mongo) or id
      const purchase = purchases.find(p => String(p._id) === purchaseId || String(p.id) === purchaseId);
      
      if (purchase) {
        console.log('[dlFile] Purchase found:', purchase._id);
        
        // Check if this is a subscription purchase
        isSubscriptionPurchase = purchase.product === 'subscription';
        console.log('[dlFile] Purchase type:', isSubscriptionPurchase ? 'subscription' : 'one-time');
        
        // Extract station info from purchase
        const params = purchase.regenerationParams || purchase.metadata || {};
        country = params.country || purchase.metadata?.country;
        stationTitle = params.stationTitle || purchase.metadata?.stationTitle || 'Tide Station';
        stationID = params.stationId || purchase.metadata?.stationId;
        
        // For subscriptions (or missing/placeholder data), try URL params/localStorage
        if (!stationID || !country || !stationTitle || stationTitle === 'Tide Station') {
          const urlStationId = urlParams.get('stationID');
          const urlCountry = urlParams.get('country');
          const urlStationTitle = urlParams.get('stationTitle');
          
          if (urlStationId) stationID = urlStationId;
          if (urlCountry) country = urlCountry;
          if (urlStationTitle) stationTitle = urlStationTitle;
          
          // Fallback to localStorage if still missing
          if (!stationID) stationID = localStorage.getItem('stationID');
          if (!country) country = localStorage.getItem('region');
          if (!stationTitle || stationTitle === 'Tide Station') {
            stationTitle = localStorage.getItem('stationTitle') || stationTitle;
          }
          
          if (!lat) lat = localStorage.getItem('latitude');
          if (!long) long = localStorage.getItem('longitude');
        }
        
        // Use coordinates from metadata if available
        if (params.latitude && params.longitude) {
          lat = params.latitude;
          long = params.longitude;
        }

        // Set display
        const stnNameEl = document.getElementById('stnName');
        if (stnNameEl) {
          stnNameEl.textContent = stationTitle;
        }
        
        // For map, use default location if coordinates not available
        if (!lat || !long) {
          console.warn('[dlFile] Station coordinates missing in purchase, using default.');
          lat = '49.26083';
          long = '-123.11389';
        }
        
        // Initialize map when DOM is ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => initializeMap());
        } else {
          initializeMap();
        }
      } else {
        const foundIds = purchases.map(p => p._id || p.id).join(', ');
        console.error('[dlFile] Purchase not found in user list. Requested:', purchaseId, 'Found IDs:', foundIds);
        // Still allow the page to render the map with default coords
        if (!lat) lat = '49.26083';
        if (!long) long = '-123.11389';
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => initializeMap());
        } else {
          initializeMap();
        }
      }
    })
    .catch(error => {
      console.error('[dlFile] Error loading purchase info:', error);
      // Still allow the page to render the map with default coords
      if (!lat) lat = '49.26083';
      if (!long) long = '-123.11389';
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initializeMap());
      } else {
        initializeMap();
      }
    });
} else {
  // Fallback to localStorage (legacy support)
  country = localStorage.getItem("region");
  stationTitle = localStorage.getItem("stationTitle");
  stationID = localStorage.getItem("stationID");
  lat = localStorage.getItem("latitude");
  long = localStorage.getItem("longitude");
  
  if (stationTitle) {
    const stnNameEl = document.getElementById('stnName');
    if (stnNameEl) {
      stnNameEl.textContent = stationTitle;
    }
  }
  
  // Initialize map when DOM is ready if we have coordinates
  if (lat && long) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => initializeMap());
    } else {
      initializeMap();
    }
  }
}

function showError(message) {
  console.warn('[dlFile] Error suppressed:', message);
}

function showStatusMessage(message, variant = 'info') {
  const headerContainer = document.querySelector('.section-header-dl .container-fluid');
  let panel = document.getElementById('statusPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'statusPanel';
    headerContainer?.prepend(panel);
  }

  const target = headerContainer || document.body;
  if (!panel.parentNode) {
    target.prepend(panel);
  }

  panel.className = `alert alert-${variant} text-center mb-4`;
  panel.textContent = message;
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setButtonLoading(button, isLoading, label = 'Generating...') {
  if (!button) return;
  if (isLoading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${label}`;
    return;
  }
  button.disabled = false;
  if (button.dataset.originalHtml) {
    button.innerHTML = button.dataset.originalHtml;
  }
}

function initializeMap() {



  // Create Leaflet Map
  let map = L.map('map', {zoomControl: false}).setView([lat, long], 12);
  L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
    center: [lat, long],
    maxZoom: 18,
    id: 'mapbox/streets-v11',
    tileSize: 512,
    zoomOffset: -1,
    accessToken: 'pk.eyJ1Ijoiam5lbHNvbjMzIiwiYSI6ImNqODIxZGpsNjcycnYzMnFueGlkdWQ0a3IifQ.TF0Kw6EQM-dt6bc4EGKM6g'
  }).addTo(map);

  window.dispatchEvent(new Event('resize'));

  // Set the Tide Station to the new map
  const userLocation = L.marker([lat, long], {icon: tideIcon}).addTo(map);
  userLocation.setLatLng([lat, long]);
  map.panTo(new L.LatLng(lat, long));
  map.dragging.disable();
  map.scrollWheelZoom.disable();
  
  setTimeout(() => {
    map.invalidateSize();
  }, 200);
}

// Timer to get downloadable file
let timerStart = () => {
  const loadingModalEl = document.getElementById('loadingModal');
  const loadingModal = bootstrap.Modal.getOrCreateInstance(loadingModalEl);
  loadingModal.show();

  const progressBar = loadingModalEl.querySelector('.progress-bar');
  let progress = 0;
  const interval = 1000; // 1 second interval

  const timer = setInterval(function () {
    progress += (interval / 2000) * 100; // 30 seconds
    if (progressBar) {
      progressBar.style.width = progress + '%';
      progressBar.setAttribute('aria-valuenow', progress);
    }

    if (progress >= 100) {
      clearInterval(timer);
      const getItBtnContainer = document.getElementById('getIt');
      if (getItBtnContainer) getItBtnContainer.classList.remove('d-none');

      // make the call to get the file.
      // Remove any existing listeners to prevent duplicates
      const getItBtn = document.getElementById('getIt');
      const newGetItBtn = getItBtn.cloneNode(true);
      getItBtn.parentNode.replaceChild(newGetItBtn, getItBtn);
      
      newGetItBtn.addEventListener('click', async function () {
        const feetCheck = document.getElementById('feetCheck');
        let isFeet = feetCheck ? feetCheck.checked : true;
        setButtonLoading(newGetItBtn, true);

        try {
          const csrf = await getCsrfToken();
          // If we have purchaseId, determine which endpoint to use
          if (purchaseId) {
            // Use generate endpoint for subscriptions, regenerate for one-time purchases
            if (isSubscriptionPurchase) {
              // Subscription purchase - use generate endpoint
              if (!stationID || !country || !stationTitle) {
                showStatusMessage('Station information is missing. Please select a station first.', 'warning');
                return;
              }

              const response = await fetch('/api/downloads/generate', {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': csrf
                },
                body: JSON.stringify({
                  stationID: stationID,
                  stationTitle: stationTitle,
                  country: country,
                  includeMoon: false,
                  userTimezone: 'UTC',
                  feet: isFeet
                })
              });

              if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to generate file');
              }

              // Get filename from response headers if available
              const contentDisposition = response.headers.get('Content-Disposition');
              let filename = 'tide-calendar.ics';
              if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch) {
                  filename = filenameMatch[1];
                }
              } else if (stationTitle && stationTitle !== 'Tide Station') {
                // Use stationTitle if available and not default
                filename = `${stationTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
              }

              const blob = await response.blob();
              // Create download link
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);

              // Show success state
              showDownloadSuccess();
            } else {
              // One-time purchase - use regenerate endpoint
              const response = await fetch(`/api/downloads/regenerate/${purchaseId}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': csrf
                }
              });

              if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to regenerate file');
              }

              // Get filename from response headers if available
              const contentDisposition = response.headers.get('Content-Disposition');
              let filename = 'tide-calendar.ics';
              if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                if (filenameMatch) {
                  filename = filenameMatch[1];
                }
              } else if (stationTitle && stationTitle !== 'Tide Station') {
                filename = `${stationTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
              }

              const blob = await response.blob();
              // Create download link
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);

              // Show success state
              showDownloadSuccess();
            }
            return;
          }

          // If logged in and subscription is active, use subscription endpoint
          try {
            const entitlementsResponse = await fetch('/api/auth/me/entitlements', { credentials: 'include' });
            if (entitlementsResponse.ok) {
              const entitlements = await entitlementsResponse.json();
              if (entitlements.unlimited && entitlements.subscriptionStatus === 'active') {
                if (!stationID || !country || !stationTitle) {
                  showStatusMessage('Station information is missing. Please select a station first.', 'warning');
                  return;
                }

                const response = await fetch('/api/downloads/generate', {
                  method: 'POST',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrf
                  },
                  body: JSON.stringify({
                    stationID,
                    stationTitle,
                    country,
                    includeMoon: false,
                    userTimezone: 'UTC',
                    feet: isFeet
                  })
                });

                if (!response.ok) {
                  const err = await response.json();
                  throw new Error(err.error || 'Failed to generate file');
                }

                const contentDisposition = response.headers.get('Content-Disposition');
                let filename = 'tide-calendar.ics';
                if (contentDisposition) {
                  const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
                  if (filenameMatch) {
                    filename = filenameMatch[1];
                  }
                } else if (stationTitle && stationTitle !== 'Tide Station') {
                  filename = `${stationTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                showDownloadSuccess();
                return;
              }
            }
          } catch (error) {
            console.error('Subscription check error:', error);
          }

          showStatusMessage('Please log in to download your file.', 'warning');
        } catch (error) {
          console.error('Error:', error);
          showStatusMessage(error.message || 'Failed to download file. Please try again.', 'danger');
        } finally {
          setButtonLoading(newGetItBtn, false);
        }
      });
    }
  }, interval);
}
 /*Carousel for warning */
const tutorialImages = [
  'tut1.jpg',
  'tut2.jpg',
  'tut3.jpg',
  'tut4.jpg',
  'tut5.jpg',
  'tut6.jpg'
];

const totalSlides = tutorialImages.length;
let currentSlide = 1;

function updateCarousel() {
  const img = document.getElementById('carouselImage');
  const counter = document.getElementById('carouselCounter');
  img.src = `/img/tutorial/${tutorialImages[currentSlide - 1]}`;
  counter.textContent = `${currentSlide} / ${totalSlides}`;
}

function nextSlide() {
  currentSlide = currentSlide === totalSlides ? 1 : currentSlide + 1;
  updateCarousel();
}

function prevSlide() {
  currentSlide = currentSlide === 1 ? totalSlides : currentSlide - 1;
  updateCarousel();
}

function showDownloadSuccess() {
  // Hide the modal
  const loadingModalEl = document.getElementById('loadingModal');
  const loadingModal = bootstrap.Modal.getInstance(loadingModalEl);
  if (loadingModal) {
    loadingModal.hide();
  }
  
  redirectToAccountAfterDownload();
}

function redirectToAccountAfterDownload() {
  try {
    localStorage.setItem(FIRST_DOWNLOAD_VERIFY_KEY, Date.now().toString());
  } catch (storageError) {
    console.warn('[dlFile] Unable to store redirect flag:', storageError);
  }
  window.location.href = '/account';
}

document.addEventListener('DOMContentLoaded', function() {
  updateCarousel();
  
  // Set up download button
  const iCalBtn = document.getElementById('iCalDlBtn');
  if (iCalBtn) {
    iCalBtn.addEventListener('click', function () {
      timerStart();
    });
  }
});
//
// document.getElementById('gCalDlBtn').addEventListener('click', function () {
//   timerStart();
// });