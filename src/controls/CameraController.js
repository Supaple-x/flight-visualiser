import * as THREE from 'three';

/**
 * Camera Controller - Manages camera modes
 */
export class CameraController {
    constructor(sceneManager, droneModel) {
        this.sceneManager = sceneManager;
        this.droneModel = droneModel;
        this.camera = sceneManager.getCamera();
        this.controls = sceneManager.getControls();

        // Camera modes
        this.modes = {
            TOP: 'top',
            FOLLOW: 'follow',
            FPV: 'fpv'
        };

        this.currentMode = this.modes.TOP;

        // Follow mode settings
        this.followOffset = new THREE.Vector3(0, 30, 50);
        this.followLookAhead = new THREE.Vector3(0, 0, -20);

        // FPV mode settings
        this.fpvOffset = new THREE.Vector3(0, 2, 0);
        this.fpvLookAhead = new THREE.Vector3(0, 0, -10);

        // Smooth camera transition
        this.targetPosition = new THREE.Vector3();
        this.targetLookAt = new THREE.Vector3();
        this.smoothFactor = 0.1;
    }

    /**
     * Set camera mode
     */
    setMode(mode) {
        if (!Object.values(this.modes).includes(mode)) {
            console.error(`Invalid camera mode: ${mode}`);
            return;
        }

        this.currentMode = mode;

        // Enable/disable orbit controls based on mode
        if (mode === this.modes.TOP) {
            this.controls.enabled = true;
        } else {
            this.controls.enabled = false;
        }

        console.log(`Camera mode set to: ${mode}`);
    }

    /**
     * Update camera based on current mode
     */
    update() {
        switch (this.currentMode) {
            case this.modes.TOP:
                // Orbit controls handle this mode
                break;

            case this.modes.FOLLOW:
                this.updateFollowMode();
                break;

            case this.modes.FPV:
                this.updateFPVMode();
                break;
        }
    }

    /**
     * Update follow mode camera
     */
    updateFollowMode() {
        const dronePos = this.droneModel.getPosition();
        const droneRot = this.droneModel.getRotation();

        // Calculate camera position behind and above the drone
        const offset = this.followOffset.clone();
        offset.applyEuler(droneRot);

        this.targetPosition.copy(dronePos).add(offset);

        // Calculate look-at point ahead of drone
        const lookAhead = this.followLookAhead.clone();
        lookAhead.applyEuler(droneRot);

        this.targetLookAt.copy(dronePos).add(lookAhead);

        // Smooth camera movement
        this.camera.position.lerp(this.targetPosition, this.smoothFactor);
        this.camera.lookAt(this.targetLookAt);
    }

    /**
     * Update FPV mode camera
     */
    updateFPVMode() {
        const dronePos = this.droneModel.getPosition();
        const droneRot = this.droneModel.getRotation();

        // Position camera at drone location with small offset
        const offset = this.fpvOffset.clone();
        offset.applyEuler(droneRot);

        this.targetPosition.copy(dronePos).add(offset);

        // Look ahead in drone's direction
        const lookAhead = this.fpvLookAhead.clone();
        lookAhead.applyEuler(droneRot);

        this.targetLookAt.copy(dronePos).add(lookAhead);

        // Smooth camera movement
        this.camera.position.lerp(this.targetPosition, this.smoothFactor * 2);
        this.camera.lookAt(this.targetLookAt);
    }

    /**
     * Reset to top view
     */
    resetTopView(bounds) {
        this.setMode(this.modes.TOP);
        this.sceneManager.focusOnBounds(bounds);
    }

    /**
     * Get current mode
     */
    getMode() {
        return this.currentMode;
    }

    /**
     * Set follow offset distance
     */
    setFollowDistance(distance) {
        this.followOffset.z = distance;
        this.followOffset.y = distance * 0.6;
    }

    /**
     * Set smooth factor (0-1, higher = faster)
     */
    setSmoothFactor(factor) {
        this.smoothFactor = Math.max(0, Math.min(1, factor));
    }
}
