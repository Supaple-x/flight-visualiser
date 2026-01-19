import * as THREE from 'three';
import { API_KEYS, MAP_CONFIG } from '../config/api.js';

/**
 * Terrain Loader - Loads and renders terrain data with Google Maps satellite imagery
 */
export class TerrainLoader {
    constructor(sceneManager, bounds) {
        this.sceneManager = sceneManager;
        this.bounds = bounds;
        this.terrainMesh = null;
        this.tilesLoaded = new Map();
        this.textureLoader = new THREE.TextureLoader();

        // Текущие настройки карты
        this.currentZoom = 16; // Уровень детализации (больше = больше детализация)
        this.currentMapType = MAP_CONFIG.MAP_TYPE;
        this.elevationEnabled = false;
        this.elevationData = null;
        this.minElevation = 0; // Минимальная высота местности

        // Callback для статус-бара
        this.statusCallback = null;
    }

    /**
     * Установить callback для обновления статус-бара
     */
    setStatusCallback(callback) {
        this.statusCallback = callback;
    }

    /**
     * Обновить статус
     */
    updateStatus(message, details = {}) {
        if (this.statusCallback) {
            this.statusCallback(message, details);
        }
        console.log('📊', message, details);
    }

    /**
     * Load terrain for given bounds
     * @param {Object} bounds - GPS bounds { minLat, maxLat, minLon, maxLon }
     */
    async loadTerrain(bounds) {
        console.log('🗺️ Loading terrain with Google Maps satellite imagery...');

        if (!API_KEYS.GOOGLE_MAPS) {
            console.warn('⚠️ Google Maps API key not configured. Using plain ground.');
            this.createGroundPlane(bounds);
            return;
        }

        try {
            // Create ground plane with satellite texture
            await this.createSatelliteGroundPlane(bounds);
        } catch (error) {
            console.error('❌ Failed to load satellite imagery:', error);
            console.log('📦 Falling back to plain ground plane');
            this.createGroundPlane(bounds);
        }
    }

    /**
     * Create simple ground plane as placeholder
     */
    createGroundPlane(bounds) {
        // Calculate size in meters
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const centerLon = (bounds.minLon + bounds.maxLon) / 2;

        console.log('🔍 Terrain bounds:', bounds);
        console.log('🔍 Center:', { centerLat, centerLon });

        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos(centerLat * Math.PI / 180);

        const width = Math.abs(bounds.maxLon - bounds.minLon) * metersPerDegreeLon;
        const height = Math.abs(bounds.maxLat - bounds.minLat) * metersPerDegreeLat;

        console.log('🔍 Terrain size:', { width, height });

        const size = Math.max(width, height) * 1.5;

        // Create ground plane
        // Use more segments for fallback plane to show some detail
        const geometry = new THREE.PlaneGeometry(size, size, 10, 10);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.MeshStandardMaterial({
            color: 0x3a5f3a,
            roughness: 0.8,
            metalness: 0.2,
            wireframe: false // Disable wireframe grid
        });

        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.receiveShadow = true;
        this.terrainMesh.position.y = 0;

        this.sceneManager.add(this.terrainMesh);

        console.log('Ground plane created:', { size });
    }


    /**
     * Изменить тип карты
     */
    async setMapType(type) {
        // 'satellite', 'hybrid', 'roadmap'
        this.currentMapType = type;
        await this.reloadTerrain();
    }

    /**
     * Включить/выключить рельеф
     */
    async toggleElevation() {
        this.elevationEnabled = !this.elevationEnabled;

        if (this.elevationEnabled) {
            await this.loadElevationData();
        } else {
            await this.reloadTerrain();
        }
    }

    /**
     * Перезагрузить terrain с текущими настройками
     */
    async reloadTerrain() {
        try {
            // ВАЖНО: Используем null для автоматического zoom, чтобы карта не смещалась
            // при смене типа карты (satellite/hybrid/roadmap)
            await this.createSatelliteGroundPlane(this.bounds, null);
        } catch (error) {
            console.error('❌ Failed to reload terrain:', error);
            this.updateStatus('❌ Ошибка загрузки подложки', { error: error.message });
        }
    }

    /**
     * Dispose terrain resources
     */
    dispose() {
        if (this.terrainMesh) {
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
            this.sceneManager.remove(this.terrainMesh);
        }

        if (this.gridHelper) {
            this.sceneManager.remove(this.gridHelper);
            this.gridHelper = null;
        }

        this.tilesLoaded.clear();
    }

    // Future implementation methods:

    /**
     * Load Mapbox terrain tile
     * @private
     */
    async loadMapboxTile(x, y, zoom) {
        // TODO: Implement Mapbox Terrain-RGB tile loading
        // API: https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw
        // Decode RGB to elevation: height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
    }

    /**
     * Load elevation data from Google Elevation API
     */
    async loadElevationData() {
        this.updateStatus('Загрузка данных о рельефе...', { step: 1, total: 3 });

        const centerLat = (this.bounds.minLat + this.bounds.maxLat) / 2;
        const centerLon = (this.bounds.minLon + this.bounds.maxLon) / 2;

        // Create grid of sample points (10x10 = 121 points, меньше для коротких URL)
        const gridSize = 10;
        const latStep = (this.bounds.maxLat - this.bounds.minLat) / gridSize;
        const lonStep = (this.bounds.maxLon - this.bounds.minLon) / gridSize;

        const locations = [];
        for (let i = 0; i <= gridSize; i++) {
            for (let j = 0; j <= gridSize; j++) {
                const lat = this.bounds.minLat + i * latStep;
                const lon = this.bounds.minLon + j * lonStep;
                locations.push({ lat, lon });
            }
        }

        this.updateStatus('Запрос к Google Elevation API...', {
            step: 2,
            total: 3,
            points: locations.length,
            size: '~50 КБ'
        });

        try {
            const elevations = await this.fetchGoogleElevation(locations);

            this.updateStatus('Применение рельефа к модели...', { step: 3, total: 3 });

            await this.applyElevationToMesh(elevations, gridSize);

            this.updateStatus('✅ Рельеф загружен', { points: elevations.length });
        } catch (error) {
            console.error('❌ Failed to load elevation data:', error);
            this.updateStatus('❌ Ошибка загрузки рельефа', { error: error.message });
            this.elevationEnabled = false;
        }
    }

    /**
     * Fetch elevation data from Google Elevation API
     */
    async fetchGoogleElevation(locations) {
        // Google Elevation API supports max 512 locations per request
        const maxLocationsPerRequest = 512;
        const allElevations = [];

        // Try to use CORS proxy, but silently fall back to estimated elevation if it fails
        let useProxy = true;
        let proxyFailed = false;

        for (let i = 0; i < locations.length; i += maxLocationsPerRequest) {
            const batch = locations.slice(i, i + maxLocationsPerRequest);

            if (useProxy && !proxyFailed) {
                const locationsStr = batch.map(l => `${l.lat},${l.lon}`).join('|');
                const apiUrl = `https://maps.googleapis.com/maps/api/elevation/json?locations=${locationsStr}&key=${API_KEYS.GOOGLE_MAPS}`;
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(apiUrl)}`;

                try {
                    const response = await fetch(proxyUrl, {
                        signal: AbortSignal.timeout(5000) // 5 second timeout
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const data = await response.json();

                    if (data.status === 'OK') {
                        allElevations.push(...data.results.map(r => r.elevation));
                        continue; // Success, continue to next batch
                    } else {
                        throw new Error(`API status: ${data.status}`);
                    }
                } catch (error) {
                    // Silently fail and use fallback (only log once)
                    if (!proxyFailed) {
                        console.warn('📍 Elevation API unavailable, using estimated terrain height');
                        proxyFailed = true;
                    }
                }
            }

            // Fallback: use estimated elevation based on flight altitude
            // Terrain is typically 50-100m below flight altitude
            const estimatedTerrainAlt = Math.max(0, (this.bounds.minAlt || 150) - 50);
            allElevations.push(...batch.map(() => estimatedTerrainAlt));
        }

        return allElevations;
    }

    /**
     * Apply elevation data to terrain mesh
     */
    async applyElevationToMesh(elevations, gridSize) {
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos(((this.bounds.minLat + this.bounds.maxLat) / 2) * Math.PI / 180);

        const width = Math.abs(this.bounds.maxLon - this.bounds.minLon) * metersPerDegreeLon;
        const height = Math.abs(this.bounds.maxLat - this.bounds.minLat) * metersPerDegreeLat;

        // Фиксированный размер (большая площадь карты)
        const BASE_RADIUS = 3.0;
        const size = Math.max(width, height) * BASE_RADIUS;

        // Найти минимальную высоту
        this.minElevation = Math.min(...elevations);
        console.log('🏔️ Min elevation:', this.minElevation, 'Max elevation:', Math.max(...elevations));

        // Remove old mesh
        if (this.terrainMesh) {
            this.sceneManager.remove(this.terrainMesh);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
        }

        // Create PlaneGeometry with vertices for elevation
        const geometry = new THREE.PlaneGeometry(size, size, gridSize, gridSize);
        geometry.rotateX(-Math.PI / 2);

        // Apply elevation to vertices (относительно минимальной высоты)
        const vertices = geometry.attributes.position.array;
        for (let i = 0; i < elevations.length; i++) {
            const vertexIndex = i * 3;
            // Смещаем вершины относительно минимальной высоты
            vertices[vertexIndex + 1] = elevations[i] - this.minElevation;
        }

        geometry.computeVertexNormals();

        // Reload texture with same zoom as initial load (to avoid shifting)
        const centerLat = (this.bounds.minLat + this.bounds.maxLat) / 2;
        const centerLon = (this.bounds.minLon + this.bounds.maxLon) / 2;
        // Use null to auto-calculate zoom (same as initial satellite map load)
        const textureUrl = this.buildGoogleMapsStaticUrl(centerLat, centerLon, this.bounds, null);
        const texture = await this.loadTextureAsync(textureUrl);

        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        const material = new THREE.MeshStandardMaterial({
            map: texture,
            side: THREE.DoubleSide
        });

        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.receiveShadow = true;
        this.terrainMesh.castShadow = true;
        // Позиционируем mesh на минимальной высоте местности
        // Траектория тоже привязана к GPS altitude, поэтому все совпадет
        // ВАЖНО: Позиция по X и Z всегда (0, 0) - центр bounds
        this.terrainMesh.position.set(0, this.minElevation, 0);

        this.sceneManager.add(this.terrainMesh);

        console.log('🗺️ Terrain mesh with elevation created:', {
            position: `(${this.terrainMesh.position.x.toFixed(1)}, ${this.terrainMesh.position.y.toFixed(1)}, ${this.terrainMesh.position.z.toFixed(1)})`,
            size: `${size.toFixed(0)}m`,
            elevation: `${this.minElevation.toFixed(1)}m - ${Math.max(...elevations).toFixed(1)}m`
        });
    }

    /**
     * Load Google elevation data (legacy method)
     * @private
     */
    async loadGoogleElevation(locations) {
        return this.fetchGoogleElevation(locations);
    }

    /**
     * Generate terrain mesh from elevation data
     * @private
     */
    generateTerrainMesh(elevationData, width, height) {
        // TODO: Create PlaneGeometry with displacement from elevation data
        // Apply LOD based on camera distance
    }

    /**
     * Create ground plane with satellite imagery
     */
    async createSatelliteGroundPlane(bounds, customZoom = null) {
        const startTime = Date.now();
        this.updateStatus('Создание спутниковой подложки...', { step: 1, total: 3 });

        // Calculate center and size
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const centerLon = (bounds.minLon + bounds.maxLon) / 2;

        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos(centerLat * Math.PI / 180);

        const width = Math.abs(bounds.maxLon - bounds.minLon) * metersPerDegreeLon;
        const height = Math.abs(bounds.maxLat - bounds.minLat) * metersPerDegreeLat;

        // ФИКСИРОВАННЫЙ размер подложки - большая площадь карты
        const BASE_RADIUS = 3.0;
        const baseSize = Math.max(width, height) * BASE_RADIUS;

        this.updateStatus('Подключение к Google Maps Static API...', {
            step: 2,
            total: 3,
            center: `${centerLat.toFixed(6)}, ${centerLon.toFixed(6)}`,
            size: `${width.toFixed(0)}x${height.toFixed(0)}m`
        });

        // Используем customZoom для детализации, но bounds всегда BASE_RADIUS
        const textureUrl = this.buildGoogleMapsStaticUrl(centerLat, centerLon, bounds, customZoom);

        // Estimate file size (approximate)
        const estimatedSizeMB = (MAP_CONFIG.TILE_SIZE * MAP_CONFIG.TILE_SIZE * 3 * MAP_CONFIG.SCALE) / (1024 * 1024);

        this.updateStatus('Загрузка спутникового снимка...', {
            step: 3,
            total: 3,
            zoom: customZoom || 'auto',
            size: `~${estimatedSizeMB.toFixed(2)} МБ`,
            tiles: 1
        });

        const texture = await this.loadTextureAsync(textureUrl);
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        // Remove old terrain if exists
        if (this.terrainMesh) {
            this.sceneManager.remove(this.terrainMesh);
            this.terrainMesh.geometry.dispose();
            this.terrainMesh.material.dispose();
        }

        // Create ground plane с ФИКСИРОВАННЫМ размером
        // Use 1x1 segments when texture is loaded (no need for geometry detail)
        const geometry = new THREE.PlaneGeometry(baseSize, baseSize, 1, 1);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide
        });

        this.terrainMesh = new THREE.Mesh(geometry, material);
        this.terrainMesh.receiveShadow = true;
        // Плоская карта на y=0, но если рельеф был включен, поднимаем на minElevation
        // ВАЖНО: Позиция по X и Z всегда (0, 0) - центр bounds
        const yPosition = this.elevationEnabled && this.minElevation ? this.minElevation : 0;
        this.terrainMesh.position.set(0, yPosition, 0);

        this.sceneManager.add(this.terrainMesh);

        console.log('🗺️ Flat terrain mesh created at y=' + yPosition.toFixed(1) +
            (this.elevationEnabled ? ' (elevation enabled)' : ' (no elevation)'));

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('🗺️ Terrain mesh created:', {
            meshSize: `${baseSize.toFixed(0)}m (FIXED at BASE_RADIUS 3.0x)`,
            zoom: customZoom || 'auto',
            position: `(${this.terrainMesh.position.x.toFixed(1)}, ${this.terrainMesh.position.y.toFixed(1)}, ${this.terrainMesh.position.z.toFixed(1)})`,
            center: `${centerLat.toFixed(6)}, ${centerLon.toFixed(6)}`
        });

        this.updateStatus(`✅ Подложка загружена за ${elapsed}с`, {
            size: `${baseSize.toFixed(0)}m`,
            zoom: customZoom || 'auto'
        });

        // Add a large grid helper on top of the terrain for better visibility/scale context
        // Size = baseSize, divisions = 50
        const gridHelper = new THREE.GridHelper(baseSize, 50, 0xffffff, 0xffffff);
        gridHelper.position.copy(this.terrainMesh.position);
        gridHelper.position.y += 0.5; // Slightly above terrain to avoid z-fighting
        gridHelper.material.opacity = 0.1;
        gridHelper.material.transparent = true;
        this.sceneManager.add(gridHelper);

        // Store grid helper to dispose it later
        this.gridHelper = gridHelper;
    }

    /**
     * Build Google Maps Static API URL
     */
    buildGoogleMapsStaticUrl(centerLat, centerLon, bounds, customZoom = null) {
        const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap';

        // ВАЖНО: ВСЕГДА используем BASE_RADIUS = 3.0 для большой площади карты
        const latDiff = Math.abs(bounds.maxLat - bounds.minLat);
        const lonDiff = Math.abs(bounds.maxLon - bounds.minLon);

        const BASE_RADIUS = 3.0;
        const baseLatDiff = latDiff * BASE_RADIUS;
        const baseLonDiff = lonDiff * BASE_RADIUS;

        const baseMinLat = centerLat - baseLatDiff / 2;
        const baseMaxLat = centerLat + baseLatDiff / 2;
        const baseMinLon = centerLon - baseLonDiff / 2;
        const baseMaxLon = centerLon + baseLonDiff / 2;

        console.log('🗺️ Map request:', {
            originalBounds: `${latDiff.toFixed(6)}°x${lonDiff.toFixed(6)}°`,
            baseBounds: `${baseLatDiff.toFixed(6)}°x${baseLonDiff.toFixed(6)}°`,
            radius: `${BASE_RADIUS}x (FIXED)`,
            zoom: customZoom || 'auto'
        });

        // Вычисляем zoom level для BASE bounds
        const maxDiff = Math.max(baseLatDiff, baseLonDiff);
        let zoom = customZoom;

        if (!customZoom) {
            // Авто-определение zoom по размеру области
            zoom = 16;
            if (maxDiff > 0.01) zoom = 16;
            if (maxDiff > 0.02) zoom = 15;
            if (maxDiff > 0.04) zoom = 14;
            if (maxDiff > 0.08) zoom = 13;
            if (maxDiff > 0.16) zoom = 12;
            if (maxDiff > 0.32) zoom = 11;
            if (maxDiff > 0.64) zoom = 10;
        }

        const params = new URLSearchParams({
            center: `${centerLat},${centerLon}`,
            zoom: zoom.toString(),
            size: `${MAP_CONFIG.TILE_SIZE}x${MAP_CONFIG.TILE_SIZE}`,
            maptype: this.currentMapType || MAP_CONFIG.MAP_TYPE,
            scale: MAP_CONFIG.SCALE.toString(),
            format: MAP_CONFIG.IMAGE_FORMAT,
            // Убрать все надписи и watermarks
            style: 'feature:all|element:labels|visibility:off',
            key: API_KEYS.GOOGLE_MAPS
        });

        // DEBUG: Log map request parameters
        console.log('🔍 Google Maps Request:', {
            center: `${centerLat.toFixed(6)}, ${centerLon.toFixed(6)}`,
            zoom,
            bounds: {
                lat: `${baseMinLat.toFixed(6)} to ${baseMaxLat.toFixed(6)}`,
                lon: `${baseMinLon.toFixed(6)} to ${baseMaxLon.toFixed(6)}`
            }
        });

        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Load texture asynchronously
     */
    loadTextureAsync(url) {
        return new Promise((resolve, reject) => {
            this.textureLoader.load(
                url,
                (texture) => {
                    console.log('✅ Satellite texture loaded successfully');
                    resolve(texture);
                },
                undefined,
                (error) => {
                    console.error('❌ Failed to load satellite texture:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Load satellite texture overlay
     * @private
     */
    async loadSatelliteTexture(bounds, zoom) {
        // TODO: Load Mapbox or Google satellite imagery
        // Apply as texture to terrain mesh
    }
}
