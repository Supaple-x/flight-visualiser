import * as Cesium from 'cesium';

/**
 * TrajectoryEntity - Flight path visualization with color gradient
 * Replaces Three.js TrajectoryLine
 */
export class TrajectoryEntity {
    constructor(cesiumViewer) {
        this.cesiumViewer = cesiumViewer;
        this.viewer = cesiumViewer.getViewer();
        this.entity = null;
        this.visible = true;
        this.trailMode = false;
        this.segments = []; // {entity, startIndex, endIndex}
        this.totalPoints = 0;
    }

    /**
     * Create trajectory from flight data
     * @param {Object} flightData - Parsed flight data with points array
     */
    async create(flightData) {
        if (!this.viewer || !flightData?.points?.length) return;

        // Remove existing trajectory
        this.dispose();

        const points = flightData.points;

        // Get first point to sample terrain height
        const firstPoint = points[0].gps || points[0];
        const firstLat = firstPoint.lat || firstPoint.latitude;
        const firstLon = firstPoint.lon || firstPoint.longitude;

        // Sample terrain height at first point
        let terrainHeight = 0;
        try {
            const terrainProvider = this.viewer.terrainProvider;
            if (terrainProvider) {
                const positions = [Cesium.Cartographic.fromDegrees(firstLon, firstLat)];
                const sampledPositions = await Cesium.sampleTerrainMostDetailed(terrainProvider, positions);
                if (sampledPositions && sampledPositions[0]) {
                    terrainHeight = sampledPositions[0].height || 0;
                    console.log(`Terrain height at start: ${terrainHeight.toFixed(1)}m`);
                }
            }
        } catch (error) {
            console.warn('Could not sample terrain height:', error);
        }

        // Use first point's altitude as ground-level MSL reference.
        // GPS altitude is MSL (absolute); first point is typically on the ground at takeoff.
        // Subtracting it gives AGL, then adding Cesium terrain height (ellipsoid) places correctly.
        const firstAlt = (points[0].gps || points[0]).altitude || (points[0].gps || points[0]).alt || 0;
        const groundLevelAlt = firstAlt;
        console.log(`Ground-level MSL altitude: ${groundLevelAlt.toFixed(1)}m (first point)`);

        const positions = points.map(point => {
            const gps = point.gps || point;
            const rawAlt = gps.altitude || gps.alt || 0;
            // MSL → AGL → ellipsoid: (MSL - groundMSL) + terrainEllipsoid
            const absoluteAlt = (rawAlt - groundLevelAlt) + terrainHeight;
            return Cesium.Cartesian3.fromDegrees(
                gps.lon || gps.longitude,
                gps.lat || gps.latitude,
                absoluteAlt
            );
        });

        // Store for drone positioning
        this.terrainHeight = terrainHeight;
        this.groundLevelAlt = groundLevelAlt;

        this.totalPoints = points.length;

        // Create color gradient (Yellow -> Red) based on time/progress
        const colors = this.createGradientColors(points.length);

        // Create polyline with color gradient using PolylineColorAppearance
        // For gradient effect, we create multiple segments
        this.createGradientPolyline(positions, colors);

        console.log(`TrajectoryEntity created with ${points.length} points, ${this.segments.length} segments (terrain offset: ${terrainHeight.toFixed(1)}m)`);
    }

    /**
     * Get terrain height offset (ellipsoid)
     */
    getTerrainHeight() {
        return this.terrainHeight || 0;
    }

    /**
     * Get ground-level MSL altitude used as base reference
     */
    getGroundLevelAlt() {
        return this.groundLevelAlt || 0;
    }

    /**
     * Create gradient colors array (Yellow to Red)
     * @param {number} count - Number of colors
     * @returns {Cesium.Color[]} Array of colors
     */
    createGradientColors(count) {
        const colors = [];
        for (let i = 0; i < count; i++) {
            const t = i / Math.max(1, count - 1);
            // Hue from Yellow (60/360 = 0.167) to Red (0)
            const hue = 0.167 * (1 - t);
            const color = Cesium.Color.fromHsl(hue, 1.0, 0.5, 1.0);
            colors.push(color);
        }
        return colors;
    }

    /**
     * Create polyline with gradient effect
     * @param {Cesium.Cartesian3[]} positions - Array of positions
     * @param {Cesium.Color[]} colors - Array of colors for gradient
     */
    createGradientPolyline(positions, colors) {
        this.segments = [];

        // Use many segments for fine-grained trail mode (each ~1-2 points)
        const segmentCount = Math.min(positions.length - 1, 1000);
        const step = Math.max(1, Math.floor(positions.length / segmentCount));

        for (let i = 0; i < positions.length - step; i += step) {
            const segmentPositions = [];
            const endIdx = Math.min(i + step + 1, positions.length);

            for (let j = i; j < endIdx; j++) {
                segmentPositions.push(positions[j]);
            }

            const t = i / Math.max(1, positions.length - 1);
            const color = colors[Math.min(Math.floor(t * colors.length), colors.length - 1)];

            const entity = this.viewer.entities.add({
                polyline: {
                    positions: segmentPositions,
                    width: 4,
                    material: new Cesium.PolylineGlowMaterialProperty({
                        glowPower: 0.2,
                        color: color
                    }),
                    clampToGround: false
                }
            });

            this.segments.push({
                entity,
                startIndex: i,
                endIndex: endIdx - 1
            });
        }

        this.entity = { type: 'trajectory_segments' };
    }

    /**
     * Enable/disable trail mode (trajectory appears progressively behind the drone)
     * @param {boolean} enabled
     */
    setTrailMode(enabled) {
        this.trailMode = enabled;
        if (!enabled) {
            // Show all segments when trail mode is turned off
            for (const seg of this.segments) {
                seg.entity.show = this.visible;
            }
        }
    }

    /**
     * Update trail visibility based on current playback index.
     * Shows only segments the drone has already passed.
     * @param {number} currentIndex - Current point index from playback
     */
    updateTrail(currentIndex) {
        if (!this.trailMode || !this.visible) return;

        for (const seg of this.segments) {
            // Show segment only after the drone has fully passed it
            seg.entity.show = seg.endIndex <= currentIndex;
        }
    }

    /**
     * Set trajectory visibility
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.visible = visible;

        if (this.trailMode) {
            // In trail mode, don't show all — just keep current state
            // They'll update on next playback tick
            if (!visible) {
                for (const seg of this.segments) {
                    seg.entity.show = false;
                }
            }
        } else {
            for (const seg of this.segments) {
                seg.entity.show = visible;
            }
        }
    }

    /**
     * Get visibility state
     */
    isVisible() {
        return this.visible;
    }

    /**
     * Dispose trajectory entities
     */
    dispose() {
        if (!this.viewer) return;

        // Remove all polyline entities (trajectory segments)
        const toRemove = [];
        this.viewer.entities.values.forEach(entity => {
            if (entity.polyline && !entity.model) {
                toRemove.push(entity);
            }
        });

        toRemove.forEach(entity => {
            this.viewer.entities.remove(entity);
        });

        this.entity = null;
    }
}
