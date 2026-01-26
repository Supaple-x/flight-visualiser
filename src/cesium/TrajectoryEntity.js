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
    }

    /**
     * Create trajectory from flight data
     * @param {Object} flightData - Parsed flight data with points array
     */
    create(flightData) {
        if (!this.viewer || !flightData?.points?.length) return;

        // Remove existing trajectory
        this.dispose();

        const points = flightData.points;

        // Create positions array
        const positions = points.map(point => {
            const gps = point.gps || point;
            return Cesium.Cartesian3.fromDegrees(
                gps.lon || gps.longitude,
                gps.lat || gps.latitude,
                gps.altitude || gps.alt || 0
            );
        });

        // Create color gradient (Yellow -> Red) based on time/progress
        const colors = this.createGradientColors(points.length);

        // Create polyline with color gradient using PolylineColorAppearance
        // For gradient effect, we create multiple segments
        this.createGradientPolyline(positions, colors);

        console.log(`TrajectoryEntity created with ${points.length} points`);
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
        // For Cesium, we need to create a primitive collection for true per-vertex colors
        // Alternative: create multiple segments with different colors

        // Simple approach: Create PolylineCollection with colored segments
        const scene = this.viewer.scene;

        // Use entity with polyline for simplicity (single color)
        // For full gradient, we'll create segments
        const segmentCount = Math.min(positions.length - 1, 100); // Limit segments for performance
        const step = Math.max(1, Math.floor(positions.length / segmentCount));

        for (let i = 0; i < positions.length - step; i += step) {
            const segmentPositions = [];
            const endIdx = Math.min(i + step + 1, positions.length);

            for (let j = i; j < endIdx; j++) {
                segmentPositions.push(positions[j]);
            }

            const t = i / Math.max(1, positions.length - 1);
            const color = colors[Math.min(Math.floor(t * colors.length), colors.length - 1)];

            this.viewer.entities.add({
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
        }

        // Store reference for visibility toggle
        this.entity = { type: 'trajectory_segments' };
    }

    /**
     * Set trajectory visibility
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.visible = visible;

        // Toggle all trajectory segments
        this.viewer.entities.values.forEach(entity => {
            if (entity.polyline) {
                entity.show = visible;
            }
        });
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
