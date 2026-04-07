/* ============================================
   Fog of War - Main Application
   ============================================ */

(function() {
    'use strict';

    // ============================================
    // Configuration
    // ============================================
    const CONFIG = {
        defaultRadius: 50,        // meters to reveal around user
        minRadius: 10,
        maxRadius: 200,
        defaultFogOpacity: 0.95,
        minFogOpacity: 0.5,
        maxFogOpacity: 1.0,
        saveInterval: 10000,      // 10 seconds
        gpsUpdateInterval: 1000,  // 1 second
        gridResolution: 10,       // meters per grid cell
        storageKey: 'fogofwar_progress',
        settingsKey: 'fogofwar_settings',
        // Walking detection
        maxWalkingSpeed: 2.5,     // m/s (~9 km/h) — max speed for walking
        minWalkingDistance: 3,    // meters — min movement to count
        walkingCheckInterval: 5000 // ms — interval to check speed
    };

    // ============================================
    // State
    // ============================================
    const state = {
        map: null,
        userMarker: null,
        userCircle: null,
        watchId: null,
        currentLat: null,
        currentLng: null,
        exploredCells: new Set(),
        totalDistance: 0,
        lastPosition: null,
        startTime: null,
        timerInterval: null,
        isTracking: false,
        isWalking: true,          // assume walking by default
        lastSpeedCheck: null,
        lastSpeedCheckPosition: null,
        settings: {
            radius: CONFIG.defaultRadius,
            fogOpacity: CONFIG.defaultFogOpacity
        },
        canvas: null,
        ctx: null,
        canvasWidth: 0,
        canvasHeight: 0,
        mapBounds: null
    };

    // ============================================
    // Utility Functions
    // ============================================
    function haversineDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function formatDistance(meters) {
        if (meters < 1000) {
            return Math.round(meters) + ' м';
        }
        return (meters / 1000).toFixed(2) + ' км';
    }

    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    function latLngToCell(lat, lng) {
        const resolution = CONFIG.gridResolution / 111320; // Convert meters to degrees (approx)
        const cellLat = Math.round(lat / resolution) * resolution;
        const cellLng = Math.round(lng / resolution) * resolution;
        return `${cellLat.toFixed(6)},${cellLng.toFixed(6)}`;
    }

    function metersToPixelRadius(meters, lat, lng) {
        // Get the container point for the given lat/lng
        const point = state.map.latLngToContainerPoint([lat, lng]);
        // Get the container point for a position offset by the given meters to the east
        // 1 degree longitude ≈ 111320 * cos(lat) meters
        const lngOffset = meters / (111320 * Math.cos(lat * Math.PI / 180));
        const pointOffset = state.map.latLngToContainerPoint([lat, lng + lngOffset]);
        // Return the pixel distance
        return Math.abs(pointOffset.x - point.x);
    }

    function showToast(message, duration = 2000) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.getElementById('app').appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ============================================
    // Storage Functions
    // ============================================
    function saveProgress() {
        try {
            const data = {
                cells: Array.from(state.exploredCells),
                distance: state.totalDistance,
                startTime: state.startTime,
                lastPosition: state.lastPosition,
                savedAt: Date.now()
            };
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
        } catch (e) {
            console.error('Failed to save progress:', e);
        }
    }

    function loadProgress() {
        try {
            const data = localStorage.getItem(CONFIG.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                state.exploredCells = new Set(parsed.cells || []);
                state.totalDistance = parsed.distance || 0;
                state.startTime = parsed.startTime || Date.now();
                state.lastPosition = parsed.lastPosition || null;
                return true;
            }
        } catch (e) {
            console.error('Failed to load progress:', e);
        }
        return false;
    }

    function clearProgress() {
        localStorage.removeItem(CONFIG.storageKey);
        state.exploredCells.clear();
        state.totalDistance = 0;
        state.lastPosition = null;
    }

    function saveSettings() {
        try {
            localStorage.setItem(CONFIG.settingsKey, JSON.stringify(state.settings));
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    }

    function loadSettings() {
        try {
            const data = localStorage.getItem(CONFIG.settingsKey);
            if (data) {
                const parsed = JSON.parse(data);
                state.settings = { ...state.settings, ...parsed };
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }

    function exportProgress() {
        const data = {
            cells: Array.from(state.exploredCells),
            distance: state.totalDistance,
            startTime: state.startTime,
            exportedAt: Date.now(),
            version: '1.0'
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fog-of-war-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        showToast('Прогресс экспортирован!');
    }

    function importProgress(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.cells && Array.isArray(data.cells)) {
                    state.exploredCells = new Set(data.cells);
                    state.totalDistance = data.distance || 0;
                    state.startTime = data.startTime || Date.now();
                    saveProgress();
                    redrawFog();
                    updateStats();
                    showToast('Прогресс импортирован!');
                } else {
                    showToast('Неверный формат файла');
                }
            } catch (err) {
                showToast('Ошибка при импорте');
            }
        };
        reader.readAsText(file);
    }

    // ============================================
    // Map Initialization
    // ============================================
    function initMap() {
        // Default to Moscow if no position yet
        const defaultLat = 55.7558;
        const defaultLng = 37.6173;

        state.map = L.map('map', {
            center: [defaultLat, defaultLng],
            zoom: 15,
            zoomControl: false,
            attributionControl: false
        });

        // OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            crossOrigin: true
        }).addTo(state.map);

        // Handle map resize
        state.map.on('moveend', onMapMove);
        state.map.on('zoomend', onMapMove);
        state.map.on('resize', onMapMove);

        // Initial draw
        setTimeout(() => {
            state.map.invalidateSize();
            initCanvas();
        }, 500);
    }

    function onMapMove() {
        redrawFog();
    }

    // ============================================
    // Canvas & Fog Rendering
    // ============================================
    function initCanvas() {
        const appContainer = document.getElementById('app');
        console.log('initCanvas called, appContainer:', appContainer);

        state.canvas = document.createElement('canvas');
        state.canvas.id = 'fog-canvas';
        state.canvas.style.position = 'absolute';
        state.canvas.style.top = '0';
        state.canvas.style.left = '0';
        state.canvas.style.zIndex = '9999';
        state.canvas.style.pointerEvents = 'none';
        state.canvas.style.width = '100%';
        state.canvas.style.height = '100%';
        state.canvas.style.background = 'transparent';
        appContainer.appendChild(state.canvas);

        state.ctx = state.canvas.getContext('2d');

        console.log('Canvas created, element:', state.canvas);
        console.log('Canvas parent:', state.canvas.parentElement);
        console.log('Canvas computed style:', window.getComputedStyle(state.canvas));

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Redraw on map move/zoom
        state.map.on('move', redrawFog);
        state.map.on('zoomend', function() {
            setTimeout(redrawFog, 100);
        });
    }

    function resizeCanvas() {
        if (!state.canvas) {
            console.log('resizeCanvas skipped: canvas not ready');
            return;
        }

        const size = state.map.getSize();
        if (!size || size.x === 0 || size.y === 0) {
            console.log('resizeCanvas skipped: map size is 0');
            return;
        }

        const dpr = window.devicePixelRatio || 1;

        state.canvas.width = size.x * dpr;
        state.canvas.height = size.y * dpr;
        state.canvas.style.width = size.x + 'px';
        state.canvas.style.height = size.y + 'px';
        state.canvas.style.top = '0px';
        state.canvas.style.left = '0px';

        state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        state.canvasWidth = size.x;
        state.canvasHeight = size.y;

        console.log('Canvas resized:', size.x, 'x', size.y, 'DPR:', dpr);

        redrawFog();
    }

    function redrawFog() {
        if (!state.ctx || !state.map) {
            console.log('redrawFog skipped: ctx or map not ready');
            return;
        }

        if (state.canvasWidth === 0 || state.canvasHeight === 0) {
            console.log('redrawFog skipped: canvas size is 0');
            return;
        }

        const ctx = state.ctx;
        const width = state.canvasWidth;
        const height = state.canvasHeight;
        const fogOpacity = state.settings.fogOpacity;

        console.log('redrawFog:', width, 'x', height, 'cells:', state.exploredCells.size, 'fogOpacity:', fogOpacity);

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw fog layer - always draw white rectangle covering entire canvas
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(255, 255, 255, ${fogOpacity})`;
        ctx.fillRect(0, 0, width, height);

        console.log('Fog drawn with opacity:', fogOpacity);

        // Cut out explored areas
        ctx.globalCompositeOperation = 'destination-out';

        const bounds = state.map.getBounds();

        // Iterate through explored cells and draw revealed circles
        state.exploredCells.forEach(cellKey => {
            const [cellLat, cellLng] = cellKey.split(',').map(Number);

            // Check if cell is visible on screen
            if (cellLat >= bounds.getSouth() && cellLat <= bounds.getNorth() &&
                cellLng >= bounds.getWest() && cellLng <= bounds.getEast()) {

                const point = state.map.latLngToContainerPoint([cellLat, cellLng]);
                const radius = metersToPixelRadius(state.settings.radius, cellLat, cellLng);

                // Create gradient for smooth edges
                const gradient = ctx.createRadialGradient(
                    point.x, point.y, 0,
                    point.x, point.y, radius
                );
                gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
                gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.8)');
                gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        });

        // Reset composite operation
        ctx.globalCompositeOperation = 'source-over';
    }

    // ============================================
    // GPS Tracking
    // ============================================
    function isCordova() {
        return !!window.cordova;
    }

    function requestLocationPermission() {
        return new Promise(function(resolve, reject) {
            if (!isCordova()) {
                console.log('Not Cordova, skipping permission request');
                resolve();
                return;
            }

            console.log('Requesting location permission via Geolocation plugin...');

            // Call cordova-plugin-geolocation's getPermission directly via exec
            // This plugin is properly registered and will show the system permission dialog
            if (cordova.exec) {
                cordova.exec(
                    function(result) {
                        console.log('Permission GRANTED, SDK:', result);
                        resolve();
                    },
                    function(error) {
                        console.error('Permission DENIED:', error);
                        reject(error);
                    },
                    'Geolocation',
                    'getPermission',
                    [true]
                );
            } else {
                console.error('cordova.exec not available');
                reject(new Error('cordova.exec not available'));
            }
        });
    }

    function startTrackingNative() {
        console.log('startTrackingNative called');

        if (!navigator.nativeLocation) {
            console.error('navigator.nativeLocation not available');
            showToast('Нативная геолокация недоступна');
            return;
        }

        state.isTracking = true;

        state.watchId = navigator.nativeLocation.watchPosition(
            onPositionUpdate,
            onPositionError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 30000
            }
        );

        console.log('Native watchPosition started, watchId:', state.watchId);
    }

    function startTracking() {
        if (isCordova() && !window.cordova) {
            showToast('Подождите, приложение загружается...');
            return;
        }

        // Use native location plugin on Cordova
        if (isCordova() && navigator.nativeLocation) {
            console.log('Using native location plugin');
            startTrackingNative();
            return;
        }

        if (!navigator.geolocation) {
            showToast('Геолокация не поддерживается');
            return;
        }

        console.log('Starting geolocation tracking (browser)');

        state.isTracking = true;

        state.watchId = navigator.geolocation.watchPosition(
            onPositionUpdate,
            onPositionError,
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 30000
            }
        );

        console.log('watchPosition started, watchId:', state.watchId);

        // Start timer
        startTimer();
        
        // Auto-save periodically
        setInterval(saveProgress, CONFIG.saveInterval);
    }

    function stopTracking() {
        if (state.watchId !== null) {
            if (isCordova() && navigator.nativeLocation) {
                navigator.nativeLocation.clearWatch(state.watchId);
            } else if (navigator.geolocation) {
                navigator.geolocation.clearWatch(state.watchId);
            }
            state.watchId = null;
        }
        state.isTracking = false;

        if (state.timerInterval) {
            clearInterval(state.timerInterval);
            state.timerInterval = null;
        }
    }

    function onPositionUpdate(position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy || 20;
        const speed = position.coords.velocity; // m/s from GPS

        state.currentLat = lat;
        state.currentLng = lng;

        // Update or create user marker
        updateUserMarker(lat, lng, accuracy);

        // Calculate distance
        if (state.lastPosition) {
            const dist = haversineDistance(
                state.lastPosition.lat,
                state.lastPosition.lng,
                lat,
                lng
            );

            // Check if walking (not in vehicle)
            const now = Date.now();
            if (state.lastSpeedCheck && state.lastSpeedCheckPosition) {
                const timeDiff = (now - state.lastSpeedCheck) / 1000; // seconds
                const distDiff = haversineDistance(
                    state.lastSpeedCheckPosition.lat,
                    state.lastSpeedCheckPosition.lng,
                    lat,
                    lng
                );

                if (timeDiff > 0 && distDiff > 0) {
                    const calculatedSpeed = distDiff / timeDiff; // m/s

                    // Use both GPS speed (if available) and calculated speed
                    const effectiveSpeed = speed !== null && speed >= 0 ? speed : calculatedSpeed;

                    // If speed is too high, likely in vehicle
                    if (effectiveSpeed > CONFIG.maxWalkingSpeed) {
                        if (state.isWalking) {
                            console.log('Speed too high, likely in vehicle:', effectiveSpeed.toFixed(1), 'm/s');
                            state.isWalking = false;
                            showToast('🚗 Обнаружен транспорт — карта не открывается');
                        }
                    } else {
                        if (!state.isWalking) {
                            state.isWalking = true;
                            showToast('🚶 Режим ходьбы — карта открывается');
                        }
                    }
                }
            }

            // Update speed check reference
            if (!state.lastSpeedCheck || (now - state.lastSpeedCheck) > CONFIG.walkingCheckInterval) {
                state.lastSpeedCheck = now;
                state.lastSpeedCheckPosition = { lat, lng };
            }

            // Only count distance and reveal if walking
            if (state.isWalking && dist > CONFIG.minWalkingDistance) {
                state.totalDistance += dist;
                revealArea(lat, lng);
            }
        } else {
            // First position fix
            state.lastSpeedCheck = Date.now();
            state.lastSpeedCheckPosition = { lat, lng };
            revealArea(lat, lng);
        }

        state.lastPosition = { lat, lng };

        // Update UI
        updateStats();

        // Center map on first fix
        if (!state.userMarker) {
            state.map.setView([lat, lng], 16);
        }
    }

    function onPositionError(error) {
        console.error('GPS Error:', error);
        let message = 'Ошибка геолокации';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message = 'Доступ к геолокации запрещён';
                break;
            case error.POSITION_UNAVAILABLE:
                message = 'Позиция недоступна';
                break;
            case error.TIMEOUT:
                message = 'Таймаут геолокации';
                break;
        }
        
        showToast(message);
    }

    function updateUserMarker(lat, lng, accuracy) {
        if (!state.userMarker) {
            // Create custom icon
            const icon = L.divIcon({
                className: 'user-marker-container',
                html: `<div class="user-marker-pulse"></div><div class="user-marker"></div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });

            state.userMarker = L.marker([lat, lng], {
                icon: icon,
                zIndexOffset: 1000
            }).addTo(state.map);

            state.userCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#4285F4',
                fillColor: '#4285F4',
                fillOpacity: 0.15,
                weight: 1
            }).addTo(state.map);
        } else {
            state.userMarker.setLatLng([lat, lng]);
            state.userCircle.setLatLng([lat, lng]);
            state.userCircle.setRadius(accuracy);
        }
    }

    function revealArea(lat, lng) {
        const cellKey = latLngToCell(lat, lng);
        
        if (!state.exploredCells.has(cellKey)) {
            state.exploredCells.add(cellKey);
            redrawFog();
        }
    }

    // ============================================
    // Timer & Stats
    // ============================================
    function startTimer() {
        if (!state.startTime) {
            state.startTime = Date.now();
        }

        state.timerInterval = setInterval(() => {
            updateStats();
        }, 1000);
    }

    function updateStats() {
        // Explored percentage (relative to visible area)
        const bounds = state.map.getBounds();
        const areaWidth = bounds.getEast() - bounds.getWest();
        const areaHeight = bounds.getNorth() - bounds.getSouth();
        const resolutionDeg = CONFIG.gridResolution / 111320;
        const totalCells = Math.ceil((areaWidth / resolutionDeg) * (areaHeight / resolutionDeg));
        
        // Count cells in current view
        let visibleCells = 0;
        const minLat = bounds.getSouth();
        const maxLat = bounds.getNorth();
        const minLng = bounds.getWest();
        const maxLng = bounds.getEast();

        state.exploredCells.forEach(cellKey => {
            const [cellLat, cellLng] = cellKey.split(',').map(Number);
            if (cellLat >= minLat && cellLat <= maxLat && 
                cellLng >= minLng && cellLng <= maxLng) {
                visibleCells++;
            }
        });

        const percent = totalCells > 0 ? Math.min(100, (visibleCells / totalCells) * 100) : 0;
        document.getElementById('explored-percent').textContent = Math.round(percent) + '%';

        // Distance
        document.getElementById('distance').textContent = formatDistance(state.totalDistance);

        // Time
        if (state.startTime) {
            const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
            document.getElementById('time').textContent = formatTime(elapsed);
        }

        // Walking/vehicle mode indicator
        const modeEl = document.getElementById('mode-indicator');
        if (modeEl) {
            if (state.isWalking) {
                modeEl.innerHTML = '<span class="stat-icon">🚶</span>';
                modeEl.title = 'Режим: пешком';
            } else {
                modeEl.innerHTML = '<span class="stat-icon">🚗</span>';
                modeEl.title = 'Режим: транспорт (карта не открывается)';
            }
        }
    }

    // ============================================
    // UI Event Handlers
    // ============================================
    function setupEventListeners() {
        // Start button
        document.getElementById('btn-start').addEventListener('click', async () => {
            document.getElementById('start-screen').classList.add('hidden');

            if (isCordova()) {
                try {
                    await requestLocationPermission();
                } catch (e) {
                    showToast('Разрешение на геолокацию не получено');
                    return;
                }
            }

            startTracking();
        });

        // Center button
        document.getElementById('btn-center').addEventListener('click', () => {
            if (state.currentLat && state.currentLng) {
                state.map.setView([state.currentLat, state.currentLng], state.map.getZoom(), {
                    animate: true
                });
            } else {
                showToast('Позиция ещё не определена');
            }
        });

        // Reset button
        document.getElementById('btn-reset').addEventListener('click', () => {
            document.getElementById('reset-modal').classList.remove('hidden');
        });

        // Cancel reset
        document.getElementById('btn-cancel-reset').addEventListener('click', () => {
            document.getElementById('reset-modal').classList.add('hidden');
        });

        document.getElementById('btn-close-reset').addEventListener('click', () => {
            document.getElementById('reset-modal').classList.add('hidden');
        });

        // Confirm reset
        document.getElementById('btn-confirm-reset').addEventListener('click', () => {
            clearProgress();
            redrawFog();
            updateStats();
            document.getElementById('reset-modal').classList.add('hidden');
            showToast('Прогресс сброшен');
        });

        // Settings button
        document.getElementById('btn-settings').addEventListener('click', () => {
            document.getElementById('settings-modal').classList.remove('hidden');
        });

        // Close settings
        document.getElementById('btn-close-settings').addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('hidden');
        });

        // Radius slider
        const radiusSlider = document.getElementById('radius-slider');
        const radiusValue = document.getElementById('radius-value');
        
        radiusSlider.addEventListener('input', (e) => {
            state.settings.radius = parseInt(e.target.value);
            radiusValue.textContent = state.settings.radius + ' м';
            saveSettings();
            redrawFog();
        });

        // Opacity slider
        const opacitySlider = document.getElementById('opacity-slider');
        const opacityValue = document.getElementById('opacity-value');
        
        opacitySlider.addEventListener('input', (e) => {
            state.settings.fogOpacity = parseInt(e.target.value) / 100;
            opacityValue.textContent = e.target.value + '%';
            saveSettings();
            redrawFog();
        });

        // Export button
        document.getElementById('btn-export').addEventListener('click', () => {
            exportProgress();
        });

        // Import button
        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file').addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importProgress(e.target.files[0]);
                e.target.value = '';
            }
        });

        // Close modals on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        });
    }

    // ============================================
    // Initialization
    // ============================================
    function init() {
        // Load saved data
        loadSettings();
        const hasProgress = loadProgress();

        // Initialize map
        initMap();

        // Setup UI
        setupEventListeners();

        // Restore settings UI
        document.getElementById('radius-slider').value = state.settings.radius;
        document.getElementById('radius-value').textContent = state.settings.radius + ' м';
        document.getElementById('opacity-slider').value = state.settings.fogOpacity * 100;
        document.getElementById('opacity-value').textContent = Math.round(state.settings.fogOpacity * 100) + '%';

        // If we have progress, hide start screen and start tracking
        if (hasProgress && state.exploredCells.size > 0) {
            document.getElementById('start-screen').classList.add('hidden');
            startTracking();
            
            // Restore position if available
            if (state.lastPosition) {
                setTimeout(() => {
                    state.map.setView([state.lastPosition.lat, state.lastPosition.lng], 16);
                }, 1000);
            }
        }

        console.log('Туман Войны initialized!');
    }

    // Start app when DOM is ready
    function waitForReady() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                if (isCordova()) {
                    document.addEventListener('deviceready', init, false);
                } else {
                    init();
                }
            });
        } else {
            if (isCordova()) {
                document.addEventListener('deviceready', init, false);
            } else {
                init();
            }
        }
    }

    waitForReady();

})();
