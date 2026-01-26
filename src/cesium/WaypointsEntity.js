import * as Cesium from 'cesium';

/**
 * WaypointsEntity - Mission waypoints visualization
 * Replaces Three.js WaypointsLine
 */
export class WaypointsEntity {
    constructor(cesiumViewer) {
        this.cesiumViewer = cesiumViewer;
        this.viewer = cesiumViewer.getViewer();
        this.lineEntity = null;
        this.markerEntities = [];
        this.visible = true;
    }

    /**
     * Create waypoints from mission data
     * @param {Object} waypointsData - Parsed waypoints data
     */
    create(waypointsData) {
        if (!this.viewer || !waypointsData?.waypoints?.length) return;

        // Remove existing waypoints
        this.dispose();

        const waypoints = waypointsData.waypoints;
        const homeAlt = waypointsData.homeAltitude || waypoints[0]?.alt || 0;

        // Create positions array
        const positions = waypoints.map((wp, index) => {
            // First waypoint (HOME) uses absolute altitude, others are relative
            const altitude = index === 0 ? wp.alt : (wp.alt + homeAlt);
            return Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, altitude);
        });

        // Create dashed line connecting waypoints
        this.createWaypointLine(positions, waypoints.length);

        // Create markers with numbers
        this.createWaypointMarkers(waypoints, homeAlt);

        console.log(`WaypointsEntity created with ${waypoints.length} waypoints`);
    }

    /**
     * Create dashed line connecting waypoints (Purple to Cyan gradient)
     * @param {Cesium.Cartesian3[]} positions
     * @param {number} count
     */
    createWaypointLine(positions, count) {
        // Create gradient from Purple (hue=0.75) to Cyan (hue=0.5)
        const segmentCount = positions.length - 1;

        for (let i = 0; i < segmentCount; i++) {
            const t = i / Math.max(1, segmentCount - 1);
            // Hue from Purple (0.75) to Cyan (0.5)
            const hue = 0.75 - t * 0.25;
            const color = Cesium.Color.fromHsl(hue, 0.8, 0.6, 1.0);

            this.viewer.entities.add({
                polyline: {
                    positions: [positions[i], positions[i + 1]],
                    width: 3,
                    material: new Cesium.PolylineDashMaterialProperty({
                        color: color,
                        dashLength: 16,
                        dashPattern: 255
                    }),
                    clampToGround: false
                },
                _isWaypoint: true
            });
        }
    }

    /**
     * Create waypoint markers with labels
     * @param {Array} waypoints
     * @param {number} homeAlt
     */
    createWaypointMarkers(waypoints, homeAlt) {
        waypoints.forEach((wp, index) => {
            const altitude = index === 0 ? wp.alt : (wp.alt + homeAlt);
            const position = Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, altitude);

            // Calculate color for gradient (Purple to Cyan) with transparency
            const t = index / Math.max(1, waypoints.length - 1);
            const hue = 0.75 - t * 0.25;
            const color = Cesium.Color.fromHsl(hue, 0.8, 0.6, 0.35); // 35% opacity

            // Create marker entity
            const entity = this.viewer.entities.add({
                position: position,
                point: {
                    pixelSize: 16,
                    color: color,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.NONE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: {
                    text: String(index),
                    font: 'bold 14px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -20),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                _isWaypoint: true,
                _waypointIndex: index
            });

            this.markerEntities.push(entity);
        });
    }

    /**
     * Set waypoints visibility
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.visible = visible;

        // Toggle all waypoint entities
        this.viewer.entities.values.forEach(entity => {
            if (entity._isWaypoint) {
                entity.show = visible;
            }
        });

        this.markerEntities.forEach(entity => {
            entity.show = visible;
        });
    }

    /**
     * Get visibility state
     */
    isVisible() {
        return this.visible;
    }

    /**
     * Dispose waypoint entities
     */
    dispose() {
        if (!this.viewer) return;

        // Remove line entity
        if (this.lineEntity) {
            this.viewer.entities.remove(this.lineEntity);
            this.lineEntity = null;
        }

        // Remove marker entities
        this.markerEntities.forEach(entity => {
            this.viewer.entities.remove(entity);
        });
        this.markerEntities = [];

        // Remove any remaining waypoint entities
        const toRemove = [];
        this.viewer.entities.values.forEach(entity => {
            if (entity._isWaypoint) {
                toRemove.push(entity);
            }
        });

        toRemove.forEach(entity => {
            this.viewer.entities.remove(entity);
        });
    }
}
