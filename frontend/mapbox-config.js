// Mapbox Configuration for WizzCentral Platform
// This file manages secure Mapbox token access

/**
 * Mapbox Configuration
 * Token is loaded from environment or config
 */
const MapboxConfig = {
    // Your Mapbox access token
    accessToken: 'pk.eyJ1Ijoid2l6emdvIiwiYSI6ImNtYm50cGY0ajFpYW0ybXF0ZnY1ZG1uczMifQ.UPBxYXZeez7n4gAhmjVgSQ',
    
    // Default map style
    style: 'mapbox://styles/mapbox/streets-v12',
    
    // Alternative styles available
    styles: {
        streets: 'mapbox://styles/mapbox/streets-v12',
        light: 'mapbox://styles/mapbox/light-v11',
        dark: 'mapbox://styles/mapbox/dark-v11',
        satellite: 'mapbox://styles/mapbox/satellite-v9',
        satelliteStreets: 'mapbox://styles/mapbox/satellite-streets-v12',
        navigation: 'mapbox://styles/mapbox/navigation-day-v1',
        navigationNight: 'mapbox://styles/mapbox/navigation-night-v1'
    },
    
    // Default center point (Baghdad, Iraq)
    defaultCenter: {
        lat: 33.3152,
        lng: 44.3661
    },
    
    // Default zoom level
    defaultZoom: 10,
    
    // Iraq map bounds to restrict pan area
    bounds: {
        southwest: { lat: 29.0, lng: 38.5 },
        northeast: { lat: 37.5, lng: 48.5 }
    },
    
    // Major Iraqi cities coordinates
    cities: {
        baghdad: { lat: 33.3152, lng: 44.3661, zoom: 11 },
        basra: { lat: 30.5034, lng: 47.7804, zoom: 11 },
        erbil: { lat: 36.1911, lng: 44.0093, zoom: 11 },
        mosul: { lat: 36.3350, lng: 43.1189, zoom: 11 },
        najaf: { lat: 32.0252, lng: 44.3358, zoom: 12 },
        karbala: { lat: 32.6160, lng: 44.0247, zoom: 12 },
        kirkuk: { lat: 35.4681, lng: 44.3922, zoom: 11 },
        sulaymaniyah: { lat: 35.5608, lng: 45.4373, zoom: 11 }
    },
    
    // Geocoding API configuration
    geocoding: {
        endpoint: 'https://api.mapbox.com/geocoding/v5/mapbox.places',
        country: 'IQ', // Restrict to Iraq
        language: 'ar,en', // Arabic and English
        types: 'place,locality,neighborhood,address'
    },
    
    // Drawing tools configuration
    drawing: {
        controls: {
            polygon: true,
            trash: true,
            combine_features: false,
            uncombine_features: false
        },
        styles: [
            {
                'id': 'gl-draw-polygon-fill-inactive',
                'type': 'fill',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'Polygon'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'fill-color': '#3bb2d0',
                    'fill-outline-color': '#3bb2d0',
                    'fill-opacity': 0.1
                }
            },
            {
                'id': 'gl-draw-polygon-fill-active',
                'type': 'fill',
                'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
                'paint': {
                    'fill-color': '#fbb03b',
                    'fill-outline-color': '#fbb03b',
                    'fill-opacity': 0.1
                }
            },
            {
                'id': 'gl-draw-polygon-stroke-inactive',
                'type': 'line',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'Polygon'],
                    ['!=', 'mode', 'static']
                ],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#3bb2d0',
                    'line-width': 2
                }
            },
            {
                'id': 'gl-draw-polygon-stroke-active',
                'type': 'line',
                'filter': ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#fbb03b',
                    'line-width': 2
                }
            },
            {
                'id': 'gl-draw-line-inactive',
                'type': 'line',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'LineString'],
                    ['!=', 'mode', 'static']
                ],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#3bb2d0',
                    'line-width': 2
                }
            },
            {
                'id': 'gl-draw-line-active',
                'type': 'line',
                'filter': ['all',
                    ['==', '$type', 'LineString'],
                    ['==', 'active', 'true']
                ],
                'layout': {
                    'line-cap': 'round',
                    'line-join': 'round'
                },
                'paint': {
                    'line-color': '#fbb03b',
                    'line-width': 2
                }
            },
            {
                'id': 'gl-draw-polygon-and-line-vertex-stroke-inactive',
                'type': 'circle',
                'filter': ['all',
                    ['==', 'meta', 'vertex'],
                    ['==', '$type', 'Point'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'circle-radius': 5,
                    'circle-color': '#fff'
                }
            },
            {
                'id': 'gl-draw-polygon-and-line-vertex-inactive',
                'type': 'circle',
                'filter': ['all',
                    ['==', 'meta', 'vertex'],
                    ['==', '$type', 'Point'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'circle-radius': 3,
                    'circle-color': '#fbb03b'
                }
            },
            {
                'id': 'gl-draw-point-point-stroke-inactive',
                'type': 'circle',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'Point'],
                    ['==', 'meta', 'feature'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'circle-radius': 5,
                    'circle-opacity': 1,
                    'circle-color': '#fff'
                }
            },
            {
                'id': 'gl-draw-point-inactive',
                'type': 'circle',
                'filter': ['all',
                    ['==', 'active', 'false'],
                    ['==', '$type', 'Point'],
                    ['==', 'meta', 'feature'],
                    ['!=', 'mode', 'static']
                ],
                'paint': {
                    'circle-radius': 3,
                    'circle-color': '#3bb2d0'
                }
            },
            {
                'id': 'gl-draw-point-stroke-active',
                'type': 'circle',
                'filter': ['all',
                    ['==', '$type', 'Point'],
                    ['==', 'active', 'true'],
                    ['!=', 'meta', 'midpoint']
                ],
                'paint': {
                    'circle-radius': 7,
                    'circle-color': '#fff'
                }
            },
            {
                'id': 'gl-draw-point-active',
                'type': 'circle',
                'filter': ['all',
                    ['==', '$type', 'Point'],
                    ['!=', 'meta', 'midpoint'],
                    ['==', 'active', 'true']
                ],
                'paint': {
                    'circle-radius': 5,
                    'circle-color': '#fbb03b'
                }
            }
        ]
    },
    
    // Region status colors
    regionColors: {
        ACTIVE: '#10b981',      // Green
        INACTIVE: '#ef4444',    // Red
        MAINTENANCE: '#f59e0b', // Amber
        PENDING: '#6b7280'      // Gray
    },
    
    // Marker options
    markerOptions: {
        draggable: true,
        color: '#10b981'
    }
};

// Initialize Mapbox GL
if (typeof mapboxgl !== 'undefined') {
    mapboxgl.accessToken = MapboxConfig.accessToken;
    console.log('✅ Mapbox GL initialized with access token');
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapboxConfig;
}
