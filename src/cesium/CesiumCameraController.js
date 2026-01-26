import * as Cesium from 'cesium';

/**
 * CesiumCameraController - Camera control with multiple modes
 * Replaces Three.js CameraController
 */
export class CesiumCameraController {
    constructor(cesiumViewer, droneEntity) {
        this.cesiumViewer = cesiumViewer;
        this.viewer = cesiumViewer.getViewer();
        this.droneEntity = droneEntity;
        this.mode = 'TOP';
        this.followOffset = new Cesium.Cartesian3(-100, 0, 50); // Behind and above
        this.fpvOffset = new Cesium.Cartesian3(0, 0, 2); // Slightly above drone center
        this.preRenderListener = null;
    }

    /**
     * Set camera mode
     * @param {string} mode - 'TOP', 'FOLLOW', or 'FPV'
     */
    setMode(mode) {
        const previousMode = this.mode;
        this.mode = mode;

        // Remove previous mode listeners
        this.removeListeners();

        switch (mode) {
            case 'TOP':
                this.enableTopView();
                break;
            case 'FOLLOW':
                this.enableFollowMode();
                break;
            case 'FPV':
                this.enableFPVMode();
                break;
        }

        console.log(`Camera mode changed: ${previousMode} -> ${mode}`);
    }

    /**
     * Get current mode
     * @returns {string}
     */
    getMode() {
        return this.mode;
    }

    /**
     * Enable top view mode (free camera control)
     */
    enableTopView() {
        // Stop tracking any entity
        this.viewer.trackedEntity = undefined;

        // Reset camera to default controls
        this.viewer.scene.screenSpaceCameraController.enableRotate = true;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = true;
        this.viewer.scene.screenSpaceCameraController.enableZoom = true;
        this.viewer.scene.screenSpaceCameraController.enableTilt = true;
        this.viewer.scene.screenSpaceCameraController.enableLook = true;
    }

    /**
     * Enable follow mode (camera follows drone from behind)
     */
    enableFollowMode() {
        if (!this.droneEntity?.getEntity()) {
            console.warn('Drone entity not available for follow mode');
            return;
        }

        // Use Cesium's built-in entity tracking
        this.viewer.trackedEntity = this.droneEntity.getEntity();

        // Alternative: custom follow with offset
        // this.setupFollowListener();
    }

    /**
     * Enable FPV mode (first person view from drone)
     */
    enableFPVMode() {
        if (!this.droneEntity) {
            console.warn('Drone entity not available for FPV mode');
            return;
        }

        // Disable default camera controls
        this.viewer.trackedEntity = undefined;
        this.viewer.scene.screenSpaceCameraController.enableRotate = false;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = false;
        this.viewer.scene.screenSpaceCameraController.enableZoom = false;
        this.viewer.scene.screenSpaceCameraController.enableTilt = false;
        this.viewer.scene.screenSpaceCameraController.enableLook = false;

        // Setup FPV update listener
        this.setupFPVListener();
    }

    /**
     * Setup custom follow camera listener
     */
    setupFollowListener() {
        this.preRenderListener = this.viewer.scene.preRender.addEventListener(() => {
            if (this.mode !== 'FOLLOW') return;

            const dronePosition = this.droneEntity?.getPosition();
            const droneOrientation = this.droneEntity?.getOrientation();

            if (!dronePosition || !droneOrientation) return;

            // Calculate camera position behind and above drone
            const transform = Cesium.Matrix4.fromRotationTranslation(
                Cesium.Matrix3.fromQuaternion(droneOrientation),
                dronePosition
            );

            const cameraOffset = Cesium.Matrix4.multiplyByPoint(
                transform,
                this.followOffset,
                new Cesium.Cartesian3()
            );

            // Update camera
            this.viewer.camera.setView({
                destination: cameraOffset,
                orientation: {
                    direction: Cesium.Cartesian3.subtract(
                        dronePosition,
                        cameraOffset,
                        new Cesium.Cartesian3()
                    ),
                    up: Cesium.Cartesian3.UNIT_Z
                }
            });
        });
    }

    /**
     * Setup FPV camera listener
     */
    setupFPVListener() {
        this.preRenderListener = this.viewer.scene.preRender.addEventListener(() => {
            if (this.mode !== 'FPV') return;

            const dronePosition = this.droneEntity?.getPosition();
            const droneOrientation = this.droneEntity?.getOrientation();

            if (!dronePosition || !droneOrientation) return;

            // Get drone's forward direction
            const rotationMatrix = Cesium.Matrix3.fromQuaternion(droneOrientation);
            const forward = Cesium.Matrix3.getColumn(rotationMatrix, 1, new Cesium.Cartesian3());
            const up = Cesium.Matrix3.getColumn(rotationMatrix, 2, new Cesium.Cartesian3());

            // Position camera slightly above drone center
            const cameraPosition = Cesium.Cartesian3.add(
                dronePosition,
                Cesium.Cartesian3.multiplyByScalar(up, this.fpvOffset.z, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

            // Set camera
            this.viewer.camera.position = cameraPosition;
            this.viewer.camera.direction = forward;
            this.viewer.camera.up = up;
        });
    }

    /**
     * Remove camera listeners
     */
    removeListeners() {
        if (this.preRenderListener) {
            this.preRenderListener();
            this.preRenderListener = null;
        }

        // Re-enable default controls
        this.viewer.scene.screenSpaceCameraController.enableRotate = true;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = true;
        this.viewer.scene.screenSpaceCameraController.enableZoom = true;
        this.viewer.scene.screenSpaceCameraController.enableTilt = true;
        this.viewer.scene.screenSpaceCameraController.enableLook = true;
    }

    /**
     * Focus camera on bounds
     * @param {Object} bounds - {minLat, maxLat, minLon, maxLon}
     * @param {number} duration - Animation duration
     */
    focusOnBounds(bounds, duration = 2) {
        this.cesiumViewer.focusOnBounds(bounds, duration);
    }

    /**
     * Fly to a specific position
     * @param {Object} position - {lat, lon, altitude}
     * @param {number} duration - Animation duration
     */
    flyTo(position, duration = 1) {
        this.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                position.lon,
                position.lat,
                position.altitude || 1000
            ),
            duration: duration
        });
    }

    /**
     * Set follow mode offset
     * @param {number} back - Distance behind drone
     * @param {number} up - Height above drone
     */
    setFollowOffset(back, up) {
        this.followOffset = new Cesium.Cartesian3(-back, 0, up);
    }

    /**
     * Dispose controller
     */
    dispose() {
        this.removeListeners();
        this.viewer.trackedEntity = undefined;
    }
}
