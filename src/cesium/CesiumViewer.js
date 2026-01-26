import * as Cesium from 'cesium';
import { CESIUM_CONFIG } from '../config/cesium.js';

/**
 * CesiumViewer - Main Cesium.js viewer with World Terrain
 * Replaces Three.js SceneManager + TerrainLoader
 */
export class CesiumViewer {
    constructor(containerId) {
        this.containerId = containerId;
        this.viewer = null;
        this.isInitialized = false;

        this.init();
    }

    /**
     * Initialize Cesium Viewer with World Terrain and imagery
     */
    async init() {
        // Set Cesium Ion access token
        Cesium.Ion.defaultAccessToken = CESIUM_CONFIG.accessToken;

        // Create viewer with basic settings first
        this.viewer = new Cesium.Viewer(this.containerId, {
            // Disable default UI elements (we have our own)
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            fullscreenButton: false,
            vrButton: false,
            infoBox: false,
            selectionIndicator: false,

            // Scene mode (3D globe)
            sceneMode: Cesium.SceneMode.SCENE3D,

            // Performance settings
            requestRenderMode: false
        });

        // Add World Terrain asynchronously
        try {
            const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
                requestVertexNormals: true,
                requestWaterMask: true
            });
            this.viewer.terrainProvider = terrainProvider;
            console.log('✅ World Terrain loaded');
        } catch (error) {
            console.warn('⚠️ Failed to load World Terrain:', error);
        }

        // Add Bing Maps imagery
        try {
            const imageryProvider = await Cesium.IonImageryProvider.fromAssetId(2);
            this.viewer.imageryLayers.addImageryProvider(imageryProvider);
            console.log('✅ Bing Maps imagery loaded');
        } catch (error) {
            console.warn('⚠️ Failed to load imagery:', error);
        }

        // Configure scene settings
        this.configureScene();

        this.isInitialized = true;
        console.log('🌍 CesiumViewer initialized');
    }

    /**
     * Configure scene settings for better visuals
     */
    configureScene() {
        const scene = this.viewer.scene;

        // Enable depth testing against terrain
        scene.globe.depthTestAgainstTerrain = true;

        // Atmosphere settings
        scene.skyAtmosphere.show = true;
        scene.fog.enabled = true;

        // Lighting
        scene.globe.enableLighting = true;

        // High quality rendering
        scene.highDynamicRange = true;
        scene.msaaSamples = 4;

        // Set sun position based on current time
        this.viewer.clock.currentTime = Cesium.JulianDate.now();
    }

    /**
     * Fly camera to bounds (replaces SceneManager.focusOnBounds)
     * @param {Object} bounds - {minLat, maxLat, minLon, maxLon, minAlt, maxAlt}
     * @param {number} duration - Animation duration in seconds
     */
    async focusOnBounds(bounds, duration = 2) {
        if (!this.viewer) return;

        // Calculate center
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const centerLon = (bounds.minLon + bounds.maxLon) / 2;
        const centerAlt = ((bounds.minAlt || 0) + (bounds.maxAlt || 1000)) / 2;

        // Calculate distance based on bounds size
        const latDiff = bounds.maxLat - bounds.minLat;
        const lonDiff = bounds.maxLon - bounds.minLon;
        const maxDiff = Math.max(latDiff, lonDiff);

        // Approximate camera height (degrees to meters, then some padding)
        const heightInMeters = maxDiff * 111320 * 1.5;

        // Fly to the location
        await this.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                centerLon,
                centerLat,
                Math.max(centerAlt + heightInMeters, 1000)
            ),
            orientation: {
                heading: Cesium.Math.toRadians(0),
                pitch: Cesium.Math.toRadians(-45),
                roll: 0
            },
            duration: duration
        });
    }

    /**
     * Set map type (satellite, hybrid, roadmap)
     * @param {string} type - 'satellite', 'hybrid', or 'roadmap'
     */
    async setMapType(type) {
        if (!this.viewer) return;

        // Remove existing imagery layers (except base)
        while (this.viewer.imageryLayers.length > 1) {
            this.viewer.imageryLayers.remove(this.viewer.imageryLayers.get(1));
        }

        let assetId;
        switch (type) {
            case 'satellite':
                assetId = 2; // Bing Maps Aerial
                break;
            case 'hybrid':
                assetId = 3; // Bing Maps Aerial with Labels
                break;
            case 'roadmap':
                assetId = 4; // Bing Maps Road
                break;
            default:
                assetId = CESIUM_CONFIG.imagery.assetId;
        }

        try {
            const imageryProvider = await Cesium.IonImageryProvider.fromAssetId(assetId);
            this.viewer.imageryLayers.addImageryProvider(imageryProvider);
        } catch (error) {
            console.error('Failed to change map type:', error);
        }
    }

    /**
     * Toggle terrain elevation visibility
     * @param {boolean} enabled - Whether to show terrain elevation
     */
    setTerrainEnabled(enabled) {
        if (!this.viewer) return;

        if (enabled) {
            this.viewer.terrainProvider = Cesium.createWorldTerrain({
                requestVertexNormals: true,
                requestWaterMask: true
            });
        } else {
            this.viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
        }
    }

    /**
     * Add entity to the viewer
     * @param {Cesium.Entity} entity
     */
    addEntity(entity) {
        if (!this.viewer) return null;
        return this.viewer.entities.add(entity);
    }

    /**
     * Remove entity from the viewer
     * @param {Cesium.Entity} entity
     */
    removeEntity(entity) {
        if (!this.viewer || !entity) return;
        this.viewer.entities.remove(entity);
    }

    /**
     * Clear all entities
     */
    clearEntities() {
        if (!this.viewer) return;
        this.viewer.entities.removeAll();
    }

    /**
     * Get the Cesium Viewer instance
     */
    getViewer() {
        return this.viewer;
    }

    /**
     * Get the Cesium Scene
     */
    getScene() {
        return this.viewer?.scene;
    }

    /**
     * Get the Cesium Camera
     */
    getCamera() {
        return this.viewer?.camera;
    }

    /**
     * Get the Cesium Clock
     */
    getClock() {
        return this.viewer?.clock;
    }

    /**
     * Dispose and clean up resources
     */
    dispose() {
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
        this.isInitialized = false;
    }
}
