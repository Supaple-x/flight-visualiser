import * as THREE from 'three';

/**
 * Waypoints Line - Visualizes mission waypoints
 */
export class WaypointsLine {
    constructor(sceneManager, waypointsData, centerLat, centerLon, groundLevel = 0, homeAltitudeMSL = 0, markerScale = 15) {
        this.sceneManager = sceneManager;
        this.waypointsData = waypointsData;
        this.centerLat = centerLat;
        this.centerLon = centerLon;
        this.groundLevel = groundLevel; // Ground level in local coordinates
        this.homeAltitudeMSL = homeAltitudeMSL; // HOME altitude in MSL (Mean Sea Level) from flight log
        this.markerScale = markerScale; // Scale for markers based on map size

        this.line = null;
        this.markers = [];
        this.group = new THREE.Group();
        this.group.name = 'WaypointsGroup';

        console.log('🗺️ WaypointsLine constructor called with:', {
            waypointsCount: waypointsData?.waypoints?.length,
            centerLat,
            centerLon,
            groundLevel,
            homeAltitudeMSL,
            markerScale
        });

        this.createWaypoints();

        console.log('🗺️ WaypointsLine created:', {
            markersCount: this.markers.length,
            groupChildren: this.group.children.length,
            groupVisible: this.group.visible
        });
    }

    /**
     * Create waypoints visualization
     */
    createWaypoints() {
        if (!this.waypointsData || !this.waypointsData.waypoints || this.waypointsData.waypoints.length === 0) {
            console.error('No waypoints data to display');
            return;
        }

        console.log(`🗺️ Creating ${this.waypointsData.waypoints.length} waypoint markers`);

        const points = [];
        const colors = [];
        const waypoints = this.waypointsData.waypoints;

        // Check if waypoints already have pre-calculated absolute altitude (from MigachevParser)
        const hasPreCalculatedAltitude = waypoints.some(wp => wp.altAbsolute !== undefined);

        // Find HOME waypoint (index 0, current=1) to get its absolute altitude
        let homeAltitudeFromWaypoints = null;
        if (!hasPreCalculatedAltitude) {
            const homeWaypoint = waypoints.find(wp => wp.current === true || wp.index === 0);
            if (homeWaypoint) {
                homeAltitudeFromWaypoints = homeWaypoint.alt;
                console.log('🏠 Found HOME waypoint (index ' + homeWaypoint.index + ') with altitude:', homeAltitudeFromWaypoints.toFixed(2), 'm');
            }
        }

        // Use HOME altitude from waypoints file for calculating other waypoint altitudes
        console.log('⚙️ Altitude mode:', hasPreCalculatedAltitude
            ? 'Using pre-calculated altAbsolute from parser'
            : 'Using waypoints HOME altitude (' + (homeAltitudeFromWaypoints ? homeAltitudeFromWaypoints.toFixed(2) : 'N/A') + 'm) for relative waypoints');

        // Create line and markers for each waypoint
        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];

            // Skip waypoints with zero coordinates
            if (Math.abs(wp.lat) < 0.001 && Math.abs(wp.lon) < 0.001) continue;

            // Waypoint altitude logic:
            // - If altAbsolute is pre-calculated (MigachevParser), use it directly
            // - HOME waypoint (index 0, current=1): already has absolute altitude (MSL) in waypoints file
            // - Other waypoints: have relative altitude (AGL), need to add HOME altitude from waypoints
            let absoluteAltitude;
            if (wp.altAbsolute !== undefined) {
                // Use pre-calculated absolute altitude
                absoluteAltitude = wp.altAbsolute;
            } else if ((wp.current === true || wp.index === 0) && homeAltitudeFromWaypoints !== null) {
                // HOME waypoint already has absolute altitude - use it as is
                absoluteAltitude = wp.alt;
            } else {
                // Other waypoints have relative altitude, add HOME altitude from waypoints file
                absoluteAltitude = wp.alt + (homeAltitudeFromWaypoints || this.homeAltitudeMSL);
            }

            // DEBUG: Log waypoint altitude
            if (i === 0 || i === 1) {
                console.log('🔍 Waypoint altitude (index ' + i + '):', {
                    wpIndex: wp.index,
                    lat: wp.lat,
                    lon: wp.lon,
                    altOriginal: wp.alt,
                    isHOME: wp.current === true || wp.index === 0,
                    homeAltitudeFromWaypoints: homeAltitudeFromWaypoints,
                    homeAltitudeMSL: this.homeAltitudeMSL,
                    altAbsolute: absoluteAltitude,
                    groundLevel: this.groundLevel
                });
            }

            // Convert GPS to local coordinates (using absolute altitude)
            const position = this.sceneManager.gpsToLocal(
                wp.lat,
                wp.lon,
                absoluteAltitude,
                this.centerLat,
                this.centerLon
            );

            // DEBUG: Log converted position
            if (i === 0) {
                console.log('🔍 Waypoint position (first):', {
                    x: position.x.toFixed(2),
                    y: position.y.toFixed(2),
                    z: position.z.toFixed(2)
                });
            }

            points.push(position);

            // Color gradient: Purple (start) → Cyan (end)
            const progress = waypoints.length > 1 ? i / (waypoints.length - 1) : 0;
            const color = new THREE.Color();
            // Purple (hue=0.75) to Cyan (hue=0.5)
            color.setHSL(0.75 - progress * 0.25, 1.0, 0.6);
            colors.push(color.r, color.g, color.b);

            // Create marker (sphere with number)
            // Use displayIndex if available (from MigachevParser), otherwise use loop index + 1
            const markerNumber = wp.displayIndex || (i + 1);
            this.createWaypointMarker(position, markerNumber, wp, color);
        }

        // Create line connecting waypoints with dashed style and glow effect
        if (points.length > 1) {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

            // Create glow line (thicker, semi-transparent background)
            const glowMaterial = new THREE.LineDashedMaterial({
                vertexColors: true,
                linewidth: 4,
                opacity: 0.3,
                transparent: true,
                dashSize: 10,
                gapSize: 5
            });
            const glowLine = new THREE.Line(geometry.clone(), glowMaterial);
            glowLine.computeLineDistances(); // Required for dashed lines
            this.group.add(glowLine);

            // Create main dashed line (brighter, on top)
            const material = new THREE.LineDashedMaterial({
                vertexColors: true,
                linewidth: 2,
                opacity: 0.95,
                transparent: true,
                dashSize: 10,
                gapSize: 5
            });

            this.line = new THREE.Line(geometry, material);
            this.line.computeLineDistances(); // Required for dashed lines
            this.group.add(this.line);
        }

        this.sceneManager.add(this.group);
        console.log(`✅ Created waypoints visualization with ${this.markers.length} markers`);
    }

    /**
     * Create waypoint marker (cube with number label and vertical pole)
     */
    createWaypointMarker(position, number, waypoint, color) {
        const markerGroup = new THREE.Group();

        // Use dynamic cube size based on map scale
        const cubeSize = this.markerScale;
        const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
        const cubeMaterial = new THREE.MeshBasicMaterial({
            color: color,
            opacity: 0.9,
            transparent: true,
            depthTest: true
        });
        const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
        cube.renderOrder = 100;
        markerGroup.add(cube);

        // Add wireframe edges for better visibility
        const edgesGeometry = new THREE.EdgesGeometry(cubeGeometry);
        const edgesMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            linewidth: 2
        });
        const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        markerGroup.add(edges);

        // Add vertical pole from ground to marker for visibility (scaled)
        const poleHeight = Math.max(cubeSize * 3, position.y + cubeSize);
        const poleRadius = cubeSize / 15;
        const poleGeometry = new THREE.CylinderGeometry(poleRadius, poleRadius, poleHeight, 8);
        const poleMaterial = new THREE.MeshBasicMaterial({
            color: color,
            opacity: 0.6,
            transparent: true
        });
        const pole = new THREE.Mesh(poleGeometry, poleMaterial);
        pole.position.y = -poleHeight / 2;
        markerGroup.add(pole);

        console.log(`📍 Creating marker #${number} (size=${cubeSize.toFixed(0)}m) at position:`, {
            x: position.x.toFixed(1),
            y: position.y.toFixed(1),
            z: position.z.toFixed(1)
        });

        // Create number label (using sprite)
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Draw background circle with border
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw number
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${size * 0.55}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(number.toString(), size / 2, size / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            opacity: 1.0,
            transparent: true,
            depthTest: false // Always render on top
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        const spriteSize = this.markerScale * 0.8;
        sprite.scale.set(spriteSize, spriteSize, 1);
        sprite.position.set(0, cubeSize + spriteSize / 2, 0); // Position above cube
        sprite.renderOrder = 999; // Render on top
        markerGroup.add(sprite);

        // Position the group
        markerGroup.position.copy(position);

        // Store marker data
        this.markers.push({
            group: markerGroup,
            number: number,
            waypoint: waypoint,
            position: position
        });

        this.group.add(markerGroup);
    }

    /**
     * Show waypoints
     */
    show() {
        this.group.visible = true;
    }

    /**
     * Hide waypoints
     */
    hide() {
        this.group.visible = false;
    }

    /**
     * Toggle visibility
     */
    toggle() {
        this.group.visible = !this.group.visible;
        return this.group.visible;
    }

    /**
     * Dispose of waypoints
     */
    dispose() {
        if (this.line) {
            this.line.geometry.dispose();
            this.line.material.dispose();
        }

        this.markers.forEach(marker => {
            marker.group.children.forEach(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        });

        this.sceneManager.remove(this.group);
    }
}
