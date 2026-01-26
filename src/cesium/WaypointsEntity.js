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
        this.eventEntities = [];
        this.loiterCircleEntities = [];
        this.visible = true;
    }

    /**
     * Create waypoints from mission data
     * @param {Object} waypointsData - Parsed waypoints data
     * @param {Array} events - Optional mission events (SERVO, CAMERA)
     */
    create(waypointsData, events = null) {
        if (!this.viewer || !waypointsData?.waypoints?.length) return;

        // Remove existing waypoints
        this.dispose();

        const waypoints = waypointsData.waypoints;
        const homeAlt = waypointsData.homeAltitude || waypoints[0]?.alt || 0;

        // Create positions array for navigation waypoints only
        const navWaypoints = waypoints.filter(wp =>
            (wp.lat !== 0 || wp.lon !== 0) &&
            (!wp.command || ['WAYPOINT', 'LOITER_TURNS', 'TAKEOFF', 'LAND', 'RTL', 'HOME'].includes(wp.command))
        );

        const positions = navWaypoints.map((wp, index) => {
            const altitude = wp.altAbsolute || (index === 0 ? wp.alt : (wp.alt + homeAlt));
            return Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, altitude);
        });

        // Create dashed line connecting waypoints
        if (positions.length > 1) {
            this.createWaypointLine(positions, navWaypoints.length);
        }

        // Create markers with numbers and command info
        this.createWaypointMarkers(navWaypoints, homeAlt);

        // Create LOITER circles
        this.createLoiterCircles(waypoints, homeAlt);

        // Create event markers (SERVO, CAMERA)
        if (events && events.length > 0) {
            this.createEventMarkers(events);
        }

        console.log(`WaypointsEntity created with ${navWaypoints.length} waypoints, ${this.loiterCircleEntities.length} loiter circles, ${this.eventEntities.length} events`);
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
            const altitude = wp.altAbsolute || (index === 0 ? wp.alt : (wp.alt + homeAlt));
            const position = Cesium.Cartesian3.fromDegrees(wp.lon, wp.lat, altitude);

            // Calculate color for gradient (Purple to Cyan) with transparency
            const t = index / Math.max(1, waypoints.length - 1);
            const hue = 0.75 - t * 0.25;
            const color = Cesium.Color.fromHsl(hue, 0.8, 0.6, 0.35);

            // Determine marker label
            let labelText = String(wp.index !== undefined ? wp.index : index);
            if (wp.command && wp.command !== 'WAYPOINT') {
                labelText += `\n${wp.command}`;
            }

            // Create marker entity
            const entity = this.viewer.entities.add({
                position: position,
                point: {
                    pixelSize: wp.command === 'LOITER_TURNS' ? 20 : 16,
                    color: wp.command === 'LOITER_TURNS' ? Cesium.Color.ORANGE.withAlpha(0.5) : color,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    heightReference: Cesium.HeightReference.NONE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: {
                    text: labelText,
                    font: 'bold 12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -20),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                _isWaypoint: true,
                _waypointIndex: wp.index !== undefined ? wp.index : index
            });

            this.markerEntities.push(entity);
        });
    }

    /**
     * Create LOITER circles visualization
     * @param {Array} waypoints - All waypoints including LOITER_TURNS
     * @param {number} homeAlt
     */
    createLoiterCircles(waypoints, homeAlt) {
        const loiterWaypoints = waypoints.filter(wp =>
            wp.command === 'LOITER_TURNS' && wp.params?.p3 > 0
        );

        loiterWaypoints.forEach(wp => {
            const altitude = wp.altAbsolute || (wp.alt + homeAlt);
            const radius = wp.params.p3; // Radius in meters
            const turns = wp.params.p1;
            const centerLat = wp.lat;
            const centerLon = wp.lon;

            // Create circle positions
            const circlePositions = [];
            const numPoints = 64; // Points for smooth circle

            for (let i = 0; i <= numPoints; i++) {
                const angle = (i / numPoints) * 2 * Math.PI;
                const lat = centerLat + (radius / 111320) * Math.sin(angle);
                const lon = centerLon + (radius / (111320 * Math.cos(centerLat * Math.PI / 180))) * Math.cos(angle);
                circlePositions.push(Cesium.Cartesian3.fromDegrees(lon, lat, altitude));
            }

            // Create circle entity
            const circleEntity = this.viewer.entities.add({
                polyline: {
                    positions: circlePositions,
                    width: 3,
                    material: new Cesium.PolylineDashMaterialProperty({
                        color: Cesium.Color.ORANGE.withAlpha(0.7),
                        dashLength: 12
                    }),
                    clampToGround: false
                },
                _isWaypoint: true,
                _isLoiterCircle: true
            });

            this.loiterCircleEntities.push(circleEntity);

            // Add label at center showing turns info
            const centerEntity = this.viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, altitude),
                label: {
                    text: `${turns}x R${radius}m`,
                    font: 'bold 11px sans-serif',
                    fillColor: Cesium.Color.ORANGE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                _isWaypoint: true,
                _isLoiterLabel: true
            });

            this.loiterCircleEntities.push(centerEntity);

            console.log(`Created LOITER circle: ${turns} turns, radius ${radius}m at (${centerLat.toFixed(4)}, ${centerLon.toFixed(4)})`);
        });
    }

    /**
     * Create event markers (SERVO, CAMERA triggers)
     * @param {Array} events
     */
    createEventMarkers(events) {
        events.forEach((event, index) => {
            const position = Cesium.Cartesian3.fromDegrees(event.lon, event.lat, event.alt || 100);

            let markerColor, markerText, iconText;

            if (event.type === 'SERVO') {
                // Servo event - show as gear/mechanism icon
                markerColor = event.pwm < 1500 ?
                    Cesium.Color.LIME.withAlpha(0.8) :  // LOW = release (green)
                    Cesium.Color.RED.withAlpha(0.8);    // HIGH = close (red)
                markerText = `CH${event.channel}`;
                iconText = event.pwm < 1500 ? '▼' : '▲'; // Down arrow for release, up for close
            } else if (event.type === 'CAMERA') {
                // Camera event
                markerColor = Cesium.Color.CYAN.withAlpha(0.8);
                markerText = 'CAM';
                iconText = '📷';
            } else {
                markerColor = Cesium.Color.YELLOW.withAlpha(0.8);
                markerText = event.type;
                iconText = '⚡';
            }

            const entity = this.viewer.entities.add({
                position: position,
                billboard: {
                    image: this.createEventIcon(markerColor, iconText),
                    width: 32,
                    height: 32,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: {
                    text: `${markerText}\n${event.pwm || ''}`,
                    font: 'bold 10px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.TOP,
                    pixelOffset: new Cesium.Cartesian2(0, 20),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                _isWaypoint: true,
                _isEvent: true,
                _eventType: event.type
            });

            this.eventEntities.push(entity);
        });

        console.log(`Created ${events.length} event markers`);
    }

    /**
     * Create a simple canvas icon for events
     * @param {Cesium.Color} color
     * @param {string} text
     * @returns {HTMLCanvasElement}
     */
    createEventIcon(color, text) {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        // Draw circle background
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, 2 * Math.PI);
        ctx.fillStyle = `rgba(${color.red * 255}, ${color.green * 255}, ${color.blue * 255}, ${color.alpha})`;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw text/icon
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 16, 16);

        return canvas;
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

        // Remove loiter circle entities
        this.loiterCircleEntities.forEach(entity => {
            this.viewer.entities.remove(entity);
        });
        this.loiterCircleEntities = [];

        // Remove event entities
        this.eventEntities.forEach(entity => {
            this.viewer.entities.remove(entity);
        });
        this.eventEntities = [];

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
