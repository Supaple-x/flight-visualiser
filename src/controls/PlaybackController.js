/**
 * Playback Controller - Manages flight replay
 * Supports both Cesium.js and Three.js visualization modes
 */
export class PlaybackController {
    constructor(flightData, droneModel, cameraController, isCesium = false) {
        this.flightData = flightData;
        this.droneModel = droneModel;  // DroneModel (Three.js) or DroneEntity (Cesium)
        this.cameraController = cameraController;
        this.isCesium = isCesium;  // True for Cesium, false for Three.js

        this.isPlaying = false;
        this.isLooping = false;
        this.currentIndex = 0;
        this.playbackSpeed = 1.0;
        this.lastUpdateTime = 0;

        // Callbacks
        this.onUpdateCallbacks = [];
        this.onEndCallbacks = [];
    }

    /**
     * Register update callback
     */
    onUpdate(callback) {
        this.onUpdateCallbacks.push(callback);
    }

    /**
     * Register end callback (when playback reaches end)
     */
    onEnd(callback) {
        this.onEndCallbacks.push(callback);
    }

    /**
     * Toggle loop mode
     */
    toggleLoop() {
        this.isLooping = !this.isLooping;
        return this.isLooping;
    }

    /**
     * Set loop mode
     */
    setLoop(enabled) {
        this.isLooping = enabled;
    }

    /**
     * Play/pause toggle
     */
    togglePlayPause() {
        this.isPlaying = !this.isPlaying;

        if (this.isPlaying) {
            this.lastUpdateTime = performance.now();
        }

        return this.isPlaying;
    }

    /**
     * Play
     */
    play() {
        this.isPlaying = true;
        this.lastUpdateTime = performance.now();
    }

    /**
     * Pause
     */
    pause() {
        this.isPlaying = false;
    }

    /**
     * Stop and reset
     */
    stop() {
        this.isPlaying = false;
        this.currentIndex = 0;
        this.updateDronePosition();
    }

    /**
     * Set playback speed
     */
    setSpeed(speed) {
        this.playbackSpeed = Math.max(0.1, Math.min(10, speed));
    }

    /**
     * Update flight data (for GPS source switching)
     */
    setFlightData(flightData) {
        this.flightData = flightData;
        this.currentIndex = 0;
    }

    /**
     * Seek to index
     */
    seek(index) {
        this.currentIndex = Math.max(0, Math.min(this.flightData.points.length - 1, Math.floor(index)));
        this.updateDronePosition();
    }

    /**
     * Seek to time (seconds)
     */
    seekToTime(time) {
        // Find closest point to target time
        let closestIndex = 0;
        let minDiff = Infinity;

        for (let i = 0; i < this.flightData.points.length; i++) {
            const diff = Math.abs(this.flightData.points[i].time - time);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }

        this.seek(closestIndex);
    }

    /**
     * Seek to percentage (0-100)
     */
    seekToPercentage(percentage) {
        const index = Math.floor((percentage / 100) * (this.flightData.points.length - 1));
        this.seek(index);
    }

    /**
     * Update playback (call in animation loop)
     */
    update() {
        if (!this.isPlaying || !this.flightData || this.flightData.points.length === 0) {
            return;
        }

        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastUpdateTime) / 1000; // Convert to seconds
        this.lastUpdateTime = currentTime;

        // Calculate how many points to advance based on time
        // Approximate: assume constant time between points
        const avgTimePerPoint = this.flightData.duration / this.flightData.points.length;
        const pointsToAdvance = (deltaTime * this.playbackSpeed) / avgTimePerPoint;

        this.currentIndex += pointsToAdvance;

        // Loop or stop at end
        if (this.currentIndex >= this.flightData.points.length - 1) {
            if (this.isLooping) {
                // Loop back to start
                this.currentIndex = 0;
                this.lastUpdateTime = performance.now();
            } else {
                // Stop at end
                this.currentIndex = 0; // Reset to start
                this.pause();

                // Trigger end callbacks
                this.onEndCallbacks.forEach(callback => callback());
            }
        }

        this.updateDronePosition();
    }

    /**
     * Update drone position based on current index
     */
    updateDronePosition() {
        if (!this.flightData || this.flightData.points.length === 0) {
            return;
        }

        const index = Math.floor(this.currentIndex);
        const nextIndex = Math.min(index + 1, this.flightData.points.length - 1);
        const t = this.currentIndex - index; // Interpolation factor

        const point = this.flightData.points[index];
        const nextPoint = this.flightData.points[nextIndex];

        // Interpolate attitude
        const attitude = this.interpolateAttitude(point.attitude, nextPoint.attitude, t);

        if (this.isCesium) {
            // Cesium mode: use GPS coordinates directly
            const gpsPosition = this.interpolateGpsPosition(point, nextPoint, t);

            // Get next GPS position for heading calculation
            const nextGpsPosition = (index < this.flightData.points.length - 1)
                ? this.interpolateGpsPosition(nextPoint, this.flightData.points[Math.min(nextIndex + 1, this.flightData.points.length - 1)], 0)
                : null;

            // Update drone entity with GPS position
            this.droneModel.update(gpsPosition, attitude, nextGpsPosition);
        } else {
            // Three.js mode: convert to local coordinates
            const position = this.interpolatePosition(point, nextPoint, t);

            // Get next position for heading calculation
            const nextPosition = (index < this.flightData.points.length - 1)
                ? this.interpolatePosition(nextPoint, this.flightData.points[Math.min(nextIndex + 1, this.flightData.points.length - 1)], 0)
                : null;

            // Update drone model (pass nextPosition for heading calculation)
            this.droneModel.update(position, attitude, nextPosition);
        }

        // Update camera
        if (this.cameraController?.update) {
            this.cameraController.update();
        }

        // Trigger callbacks
        this.notifyUpdate(point, nextPoint, t);
    }

    /**
     * Interpolate GPS position (for Cesium mode)
     */
    interpolateGpsPosition(point1, point2, t) {
        const baseAltitude = point1.gps.altitude + (point2.gps.altitude - point1.gps.altitude) * t;
        // Convert MSL to ellipsoid: subtract ground-level MSL, add terrain ellipsoid height
        const terrainHeight = this.flightData?.terrainHeight || 0;
        const groundLevelAlt = this.flightData?.groundLevelAlt || 0;

        return {
            lat: point1.gps.lat + (point2.gps.lat - point1.gps.lat) * t,
            lon: point1.gps.lon + (point2.gps.lon - point1.gps.lon) * t,
            altitude: (baseAltitude - groundLevelAlt) + terrainHeight
        };
    }

    /**
     * Interpolate position between two points
     */
    interpolatePosition(point1, point2, t) {
        const centerLat = (this.flightData.bounds.minLat + this.flightData.bounds.maxLat) / 2;
        const centerLon = (this.flightData.bounds.minLon + this.flightData.bounds.maxLon) / 2;

        // Get positions in 3D space
        const pos1 = this.gpsToLocal(point1.gps.lat, point1.gps.lon, point1.gps.altitude, centerLat, centerLon);
        const pos2 = this.gpsToLocal(point2.gps.lat, point2.gps.lon, point2.gps.altitude, centerLat, centerLon);

        // Linear interpolation
        return pos1.clone().lerp(pos2, t);
    }

    /**
     * Interpolate attitude
     */
    interpolateAttitude(att1, att2, t) {
        return {
            roll: att1.roll + (att2.roll - att1.roll) * t,
            pitch: att1.pitch + (att2.pitch - att1.pitch) * t,
            yaw: att1.yaw + (att2.yaw - att1.yaw) * t
        };
    }

    /**
     * Convert GPS to local coordinates (same as SceneManager)
     */
    gpsToLocal(lat, lon, alt, centerLat, centerLon) {
        const THREE = window.THREE;
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos(centerLat * Math.PI / 180);

        const x = (lon - centerLon) * metersPerDegreeLon;
        const z = -(lat - centerLat) * metersPerDegreeLat;

        // Altitude: check if it's in centimeters (> 10000) or meters
        const y = alt > 10000 ? alt / 100 : alt;

        return new THREE.Vector3(x, y, z);
    }

    /**
     * Notify update callbacks
     */
    notifyUpdate(currentPoint, nextPoint, interpolation) {
        const data = {
            index: this.currentIndex,
            currentPoint,
            nextPoint,
            interpolation,
            percentage: (this.currentIndex / (this.flightData.points.length - 1)) * 100,
            isPlaying: this.isPlaying
        };

        this.onUpdateCallbacks.forEach(callback => callback(data));
    }

    /**
     * Get current playback state
     */
    getState() {
        return {
            isPlaying: this.isPlaying,
            isLooping: this.isLooping,
            currentIndex: this.currentIndex,
            totalPoints: this.flightData ? this.flightData.points.length : 0,
            playbackSpeed: this.playbackSpeed,
            percentage: this.flightData ?
                (this.currentIndex / (this.flightData.points.length - 1)) * 100 : 0
        };
    }
}
