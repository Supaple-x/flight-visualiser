/**
 * API Configuration
 * Храните ваши API ключи здесь
 */

export const API_KEYS = {
    // Google Maps API Key
    // Получите ключ на: https://console.cloud.google.com/apis/credentials
    // Необходимые API:
    // - Maps Static API (для спутниковых снимков)
    // - Elevation API (для данных о высоте)
    GOOGLE_MAPS: 'AIzaSyARM9QqlaKVF32NFOTF82HLCCBJTgOCATo',

    // Mapbox API Key (опционально, для будущего использования)
    // Получите ключ на: https://account.mapbox.com/access-tokens/
    MAPBOX: ''
};

// Настройки карты
export const MAP_CONFIG = {
    // Размер тайла спутникового снимка (пиксели)
    TILE_SIZE: 640, // Максимум для Google Maps Static API

    // Zoom level для спутниковых снимков (выше = детальнее)
    SATELLITE_ZOOM: 18, // 18-20 для детальных снимков

    // Формат изображения
    IMAGE_FORMAT: 'png', // png или jpg

    // Тип карты
    MAP_TYPE: 'satellite', // satellite, hybrid, roadmap

    // Разрешение (для Retina дисплеев)
    SCALE: 2 // 1 или 2
};
