import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Scene Manager - Manages the Three.js scene
 */
export class SceneManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.animationFrameId = null;
        this.onRenderCallbacks = [];

        this.init();
    }

    /**
     * Initialize the scene
     */
    init() {
        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e27);

        // Create camera
        const aspect = window.innerWidth / window.innerHeight;
        // Increased far clipping plane to 2,000,000 to support large flight areas (e.g. 150km)
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000000);
        this.camera.position.set(0, 100, 200);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Create controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 1000000; // Allow zooming out far enough for 150km maps
        this.controls.maxPolarAngle = Math.PI / 2;

        // Add lights
        this.setupLights();

        // Add grid helper
        this.addGrid();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Start render loop
        this.animate();
    }

    /**
     * Setup scene lighting
     */
    setupLights() {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 200, 100);
        directionalLight.castShadow = true;
        directionalLight.shadow.camera.left = -500;
        directionalLight.shadow.camera.right = 500;
        directionalLight.shadow.camera.top = 500;
        directionalLight.shadow.camera.bottom = -500;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 1000;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        this.scene.add(directionalLight);

        // Hemisphere light for sky effect
        const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x545454, 0.4);
        this.scene.add(hemisphereLight);
    }

    /**
     * Add grid helper
     */
    addGrid() {
        const gridHelper = new THREE.GridHelper(1000, 50, 0x4a90e2, 0x2a2a2a);
        gridHelper.position.y = 0;
        this.scene.add(gridHelper);
    }

    /**
     * Add object to scene
     */
    add(object) {
        this.scene.add(object);
    }

    /**
     * Remove object from scene
     */
    remove(object) {
        this.scene.remove(object);
    }

    /**
     * Register render callback
     */
    onRender(callback) {
        this.onRenderCallbacks.push(callback);
    }

    /**
     * Animation loop
     */
    animate() {
        this.animationFrameId = requestAnimationFrame(() => this.animate());

        // Update controls
        this.controls.update();

        // Call registered callbacks
        this.onRenderCallbacks.forEach(callback => callback());

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Handle window resize
     */
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * Focus camera on bounds
     */
    focusOnBounds(bounds) {
        // Calculate center point
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const centerLon = (bounds.minLon + bounds.maxLon) / 2;

        // Convert GPS to local coordinates (simplified)
        const center = this.gpsToLocal(centerLat, centerLon, 0, centerLat, centerLon);

        // Calculate bounding box size
        const minPoint = this.gpsToLocal(bounds.minLat, bounds.minLon, 0, centerLat, centerLon);
        const maxPoint = this.gpsToLocal(bounds.maxLat, bounds.maxLon, 0, centerLat, centerLon);

        const size = Math.max(
            Math.abs(maxPoint.x - minPoint.x),
            Math.abs(maxPoint.z - minPoint.z),
            bounds.maxAlt - bounds.minAlt
        );

        // Position camera
        const distance = size * 2;
        this.camera.position.set(
            center.x + distance * 0.5,
            center.y + distance * 0.7,
            center.z + distance * 0.5
        );

        // Point camera at center
        this.controls.target.set(center.x, center.y, center.z);
        this.controls.update();
    }

    /**
     * Convert GPS coordinates to local 3D coordinates
     */
    gpsToLocal(lat, lon, alt, centerLat, centerLon) {
        // Simplified conversion - meters per degree at equator
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos(centerLat * Math.PI / 180);

        const x = (lon - centerLon) * metersPerDegreeLon;
        const z = -(lat - centerLat) * metersPerDegreeLat; // Negative Z for north

        // Altitude: check if it's in centimeters (> 10000) or meters
        const y = alt > 10000 ? alt / 100 : alt;

        // DEBUG: Log first conversion
        if (!this._loggedFirstGpsToLocal) {
            console.log('🔍 GPS to Local Conversion (First Point):', {
                input: { lat, lon, alt },
                center: { centerLat, centerLon },
                output: { x, y, z },
                metersPerDegree: { lat: metersPerDegreeLat, lon: metersPerDegreeLon }
            });
            this._loggedFirstGpsToLocal = true;
        }

        return new THREE.Vector3(x, y, z);
    }

    /**
     * Get camera
     */
    getCamera() {
        return this.camera;
    }

    /**
     * Get controls
     */
    getControls() {
        return this.controls;
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }

        window.removeEventListener('resize', () => this.onWindowResize());

        this.controls.dispose();
        this.renderer.dispose();
    }
}
