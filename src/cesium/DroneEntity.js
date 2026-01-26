import * as Cesium from 'cesium';
import { CESIUM_CONFIG } from '../config/cesium.js';

/**
 * DroneEntity - 3D drone model visualization
 * Replaces Three.js DroneModel
 */
export class DroneEntity {
    constructor(cesiumViewer) {
        this.cesiumViewer = cesiumViewer;
        this.viewer = cesiumViewer.getViewer();
        this.entity = null;
        this.currentPosition = null;
        this.currentOrientation = null;
        this.modelScale = 1.0;
        this.modelLoaded = false;

        // Model orientation offset (radians) - adjust if model faces wrong direction
        // 0 = model nose points North (Y+)
        // π/2 (90°) = model nose points East (X+)
        // π (180°) = model nose points South (Y-)
        // -π/2 (-90°) = model nose points West (X-)
        this.modelHeadingOffset = -Math.PI / 2; // Adjust based on your model
    }

    /**
     * Create drone entity with 3D model
     * @param {Object} options - Configuration options
     */
    async create(options = {}) {
        if (!this.viewer) return;

        // Remove existing entity
        this.dispose();

        // Default position (will be updated during playback)
        const defaultPosition = Cesium.Cartesian3.fromDegrees(0, 0, 100);

        // Try to load glTF model, fallback to simple shape
        const modelUri = options.modelPath || CESIUM_CONFIG.model.dronePath;

        try {
            // Check if GLB file exists by trying to fetch it
            const response = await fetch(modelUri, { method: 'HEAD' });

            if (response.ok) {
                this.entity = this.viewer.entities.add({
                    position: defaultPosition,
                    orientation: new Cesium.ConstantProperty(
                        Cesium.Transforms.headingPitchRollQuaternion(
                            defaultPosition,
                            new Cesium.HeadingPitchRoll(0, 0, 0)
                        )
                    ),
                    model: {
                        uri: modelUri,
                        scale: this.modelScale,
                        minimumPixelSize: 64,
                        maximumScale: 20000,
                        runAnimations: true,
                        clampAnimations: true
                    },
                    _isDrone: true
                });

                this.modelLoaded = true;
                console.log(`DroneEntity created with model: ${modelUri}`);
            } else {
                throw new Error(`Model file not found: ${modelUri}`);
            }
        } catch (error) {
            console.warn('Failed to load 3D model, using fallback:', error.message);
            this.createFallbackModel(defaultPosition);
        }
    }

    /**
     * Create fallback model (billboard + point) if glTF fails
     * @param {Cesium.Cartesian3} position
     */
    createFallbackModel(position) {
        // Create a visible drone marker with billboard
        this.entity = this.viewer.entities.add({
            position: position,
            // Point for visibility
            point: {
                pixelSize: 20,
                color: Cesium.Color.LIME,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                heightReference: Cesium.HeightReference.NONE,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            // Label to show drone position
            label: {
                text: 'DRONE',
                font: 'bold 14px sans-serif',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -25),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            // Simple box to represent the drone body
            box: {
                dimensions: new Cesium.Cartesian3(10, 10, 4),
                material: Cesium.Color.GRAY.withAlpha(0.8),
                outline: true,
                outlineColor: Cesium.Color.BLACK
            },
            _isDrone: true
        });

        this.modelLoaded = true;
        console.log('DroneEntity created with fallback model (GLB not found, using marker)');
    }

    /**
     * Update drone position and orientation
     * @param {Object} gpsPosition - {lat, lon, altitude}
     * @param {Object} attitude - {roll, pitch, yaw} in decidegrees
     * @param {Object} nextPosition - Optional next position for heading calculation
     */
    update(gpsPosition, attitude, nextPosition = null) {
        if (!this.entity || !this.viewer) return;

        // Convert GPS to Cartesian
        const position = Cesium.Cartesian3.fromDegrees(
            gpsPosition.lon || gpsPosition.longitude,
            gpsPosition.lat || gpsPosition.latitude,
            gpsPosition.altitude || gpsPosition.alt || 0
        );

        this.currentPosition = position;

        // Calculate heading/pitch/roll
        let heading, pitch, roll;

        if (nextPosition) {
            // Calculate heading towards next position
            const nextCartesian = Cesium.Cartesian3.fromDegrees(
                nextPosition.lon || nextPosition.longitude,
                nextPosition.lat || nextPosition.latitude,
                nextPosition.altitude || nextPosition.alt || 0
            );

            // Calculate heading between positions
            const startCartographic = Cesium.Cartographic.fromCartesian(position);
            const endCartographic = Cesium.Cartographic.fromCartesian(nextCartesian);

            heading = this.calculateHeading(
                startCartographic.latitude,
                startCartographic.longitude,
                endCartographic.latitude,
                endCartographic.longitude
            );

            // Calculate pitch from altitude difference
            const distance = Cesium.Cartesian3.distance(position, nextCartesian);
            const altDiff = endCartographic.height - startCartographic.height;
            pitch = Math.atan2(altDiff, distance) * 0.3; // Reduce pitch effect

            roll = 0;
        } else if (attitude) {
            // Use attitude data (convert from decidegrees to radians)
            heading = Cesium.Math.toRadians((attitude.yaw || 0) / 10);
            pitch = Cesium.Math.toRadians((attitude.pitch || 0) / 10);
            roll = Cesium.Math.toRadians((attitude.roll || 0) / 10);
        } else {
            heading = 0;
            pitch = 0;
            roll = 0;
        }

        // Apply model heading offset to correct model orientation
        heading += this.modelHeadingOffset;

        // Create orientation quaternion
        const hpr = new Cesium.HeadingPitchRoll(heading, pitch, roll);
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

        this.currentOrientation = orientation;

        // Update entity
        this.entity.position = position;
        this.entity.orientation = orientation;
    }

    /**
     * Calculate heading between two points
     * @param {number} lat1 - Start latitude in radians
     * @param {number} lon1 - Start longitude in radians
     * @param {number} lat2 - End latitude in radians
     * @param {number} lon2 - End longitude in radians
     * @returns {number} Heading in radians
     */
    calculateHeading(lat1, lon1, lat2, lon2) {
        const dLon = lon2 - lon1;
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
                  Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        return Math.atan2(y, x);
    }

    /**
     * Set model scale
     * @param {number} scale
     */
    setScale(scale) {
        this.modelScale = scale;
        if (this.entity?.model) {
            this.entity.model.scale = scale;
        }
    }

    /**
     * Get current position
     * @returns {Cesium.Cartesian3}
     */
    getPosition() {
        return this.currentPosition;
    }

    /**
     * Get current orientation
     * @returns {Cesium.Quaternion}
     */
    getOrientation() {
        return this.currentOrientation;
    }

    /**
     * Get the entity
     * @returns {Cesium.Entity}
     */
    getEntity() {
        return this.entity;
    }

    /**
     * Set visibility
     * @param {boolean} visible
     */
    setVisible(visible) {
        if (this.entity) {
            this.entity.show = visible;
        }
    }

    /**
     * Dispose drone entity
     */
    dispose() {
        if (this.viewer && this.entity) {
            this.viewer.entities.remove(this.entity);
            this.entity = null;
        }
        this.currentPosition = null;
        this.currentOrientation = null;
        this.modelLoaded = false;
    }
}
