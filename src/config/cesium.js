/**
 * Cesium.js Configuration
 *
 * ВАЖНО: Зарегистрируйтесь на https://cesium.com/ и получите Access Token
 * Бесплатный tier включает Cesium World Terrain и базовые imagery layers
 */

export const CESIUM_CONFIG = {
    // Cesium Ion Access Token
    // Получите на: https://cesium.com/ion/tokens
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5YjBkMGRjNS05ZGMwLTQ5Y2YtOWFmMC0zMzlkNDI5ZGQ3ODciLCJpZCI6MTk5ODEwLCJpYXQiOjE3MDk2NTAxNzR9.oNKLVfjTbDx1i1gSFHCGmnrEPVKrf7U9fu1WFsuAa6E',

    // Terrain settings
    terrain: {
        // Cesium World Terrain asset ID (бесплатно включен в Ion)
        assetId: 1,
        requestVertexNormals: true,
        requestWaterMask: true
    },

    // Imagery settings (спутниковые снимки)
    imagery: {
        // Bing Maps Aerial (включен в Ion)
        // Или используйте Google Maps 2D Tiles (assetId: 3)
        assetId: 2, // Bing Maps Aerial
    },

    // Default camera settings
    camera: {
        defaultZoomHeight: 5000, // метры
        minZoomHeight: 100,
        maxZoomHeight: 50000000
    },

    // Model settings
    model: {
        // Путь к glTF/GLB модели дрона
        dronePath: '/models/drone.glb',
        // Fallback если glTF недоступен
        fallbackDronePath: '/models/drone.fbx'
    }
};
