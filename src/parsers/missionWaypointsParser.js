/**
 * Mission Planner Waypoints Parser
 * Parses QGC WPL 110 format with full command support including LOITER_TURNS
 *
 * Supported commands:
 * - MAV_CMD_NAV_WAYPOINT (16) - Navigate to waypoint
 * - MAV_CMD_NAV_LOITER_TURNS (18) - Loiter for N turns at radius
 * - MAV_CMD_NAV_TAKEOFF (22) - Takeoff from ground
 * - MAV_CMD_NAV_LAND (21) - Land at location
 * - MAV_CMD_NAV_RETURN_TO_LAUNCH (20) - Return to launch
 * - MAV_CMD_DO_SET_SERVO (183) - Set servo position
 * - MAV_CMD_DO_SET_CAM_TRIGG_DIST (206) - Camera trigger
 */

// MAVLink command IDs
const MAV_CMD = {
    NAV_WAYPOINT: 16,
    NAV_LOITER_UNLIM: 17,
    NAV_LOITER_TURNS: 18,
    NAV_LOITER_TIME: 19,
    NAV_RETURN_TO_LAUNCH: 20,
    NAV_LAND: 21,
    NAV_TAKEOFF: 22,
    NAV_LOITER_TO_ALT: 31,
    NAV_LAND_LOCAL: 89,           // Local frame landing (rarely used)
    DO_CHANGE_SPEED: 178,         // Change speed during mission
    DO_SET_SERVO: 183,
    DO_SET_CAM_TRIGG_DIST: 206
};

// Frame types
const MAV_FRAME = {
    GLOBAL: 0,           // Absolute altitude (MSL)
    LOCAL_NED: 1,
    MISSION: 2,
    GLOBAL_RELATIVE_ALT: 3,  // Relative to home altitude
    LOCAL_ENU: 4
};

// Airplane speeds (m/s)
const AIRPLANE_SPEEDS = {
    cruise: 25,      // 90 km/h - cruising speed
    loiter: 18,      // 65 km/h - loitering/turning speed
    climb: 20,       // Climbing speed
    descent: 22,     // Descending speed
    takeoff: 15,     // Takeoff speed
    landing: 12      // Landing approach speed
};

export class MissionWaypointsParser {
    constructor() {
        this.waypoints = [];        // Raw waypoint commands
        this.flightPath = [];       // Generated flight path points
        this.events = [];           // Servo/camera events
        this.homePosition = null;
        this.totalDistance = 0;
        this.totalTime = 0;
        this.currentCruiseSpeed = AIRPLANE_SPEEDS.cruise;  // Can be changed by DO_CHANGE_SPEED
    }

    /**
     * Parse waypoints file and generate flight path
     * @param {File} file - Waypoints file
     * @returns {Object} Parsed mission data with flight path
     */
    async parse(file) {
        const content = await file.text();
        const lines = content.trim().split('\n');

        // Validate header
        if (!lines[0].startsWith('QGC WPL')) {
            throw new Error('Invalid waypoints file format. Expected QGC WPL header.');
        }

        // Parse all waypoint lines
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const wp = this.parseWaypointLine(line);
            if (wp) {
                this.waypoints.push(wp);
            }
        }

        if (this.waypoints.length === 0) {
            throw new Error('No waypoints found in file');
        }

        // Find HOME position (first waypoint with valid coordinates or first WAYPOINT)
        this.findHomePosition();

        // Generate complete flight path with loiter circles
        this.generateFlightPath();

        // Calculate bounds
        const bounds = this.calculateBounds();

        console.log(`Parsed ${this.waypoints.length} commands, generated ${this.flightPath.length} flight points`);
        console.log(`Total distance: ${(this.totalDistance / 1000).toFixed(2)} km`);
        console.log(`Estimated flight time: ${this.formatTime(this.totalTime)}`);

        return {
            waypoints: this.waypoints,
            flightPath: this.flightPath,
            events: this.events,
            bounds: bounds,
            homePosition: this.homePosition,
            homeAltitude: this.homePosition?.alt || 0,
            totalDistance: this.totalDistance,
            totalTime: this.totalTime,
            source: 'Mission Planner Waypoints'
        };
    }

    /**
     * Parse a single waypoint line
     * Format: index current frame command p1 p2 p3 p4 lat lon alt autocontinue
     */
    parseWaypointLine(line) {
        const parts = line.split(/\s+/);
        if (parts.length < 12) return null;

        const [index, current, frame, command, p1, p2, p3, p4, lat, lon, alt, autocontinue] = parts;

        return {
            index: parseInt(index),
            current: parseInt(current),
            frame: parseInt(frame),
            command: parseInt(command),
            params: {
                p1: parseFloat(p1),
                p2: parseFloat(p2),
                p3: parseFloat(p3),
                p4: parseFloat(p4)
            },
            lat: parseFloat(lat),
            lon: parseFloat(lon),
            alt: parseFloat(alt),
            autocontinue: parseInt(autocontinue),
            commandName: this.getCommandName(parseInt(command))
        };
    }

    /**
     * Get human-readable command name
     */
    getCommandName(command) {
        const names = {
            [MAV_CMD.NAV_WAYPOINT]: 'WAYPOINT',
            [MAV_CMD.NAV_LOITER_UNLIM]: 'LOITER_UNLIM',
            [MAV_CMD.NAV_LOITER_TURNS]: 'LOITER_TURNS',
            [MAV_CMD.NAV_LOITER_TIME]: 'LOITER_TIME',
            [MAV_CMD.NAV_RETURN_TO_LAUNCH]: 'RTL',
            [MAV_CMD.NAV_LAND]: 'LAND',
            [MAV_CMD.NAV_TAKEOFF]: 'TAKEOFF',
            [MAV_CMD.NAV_LOITER_TO_ALT]: 'LOITER_TO_ALT',
            [MAV_CMD.NAV_LAND_LOCAL]: 'LAND_LOCAL',
            [MAV_CMD.DO_CHANGE_SPEED]: 'DO_CHANGE_SPEED',
            [MAV_CMD.DO_SET_SERVO]: 'DO_SET_SERVO',
            [MAV_CMD.DO_SET_CAM_TRIGG_DIST]: 'DO_CAM_TRIGG'
        };
        return names[command] || `UNKNOWN_${command}`;
    }

    /**
     * Find HOME position from waypoints
     */
    findHomePosition() {
        // First try to find explicit HOME (index 0 with coordinates)
        const home = this.waypoints.find(wp => wp.index === 0 && (wp.lat !== 0 || wp.lon !== 0));

        if (home) {
            this.homePosition = { lat: home.lat, lon: home.lon, alt: home.alt };
            return;
        }

        // Otherwise, use first navigation waypoint with coordinates
        const firstNav = this.waypoints.find(wp =>
            wp.lat !== 0 && wp.lon !== 0 &&
            [MAV_CMD.NAV_WAYPOINT, MAV_CMD.NAV_TAKEOFF, MAV_CMD.NAV_LOITER_TURNS].includes(wp.command)
        );

        if (firstNav) {
            this.homePosition = { lat: firstNav.lat, lon: firstNav.lon, alt: 0 };
        } else {
            throw new Error('Cannot determine HOME position from waypoints');
        }
    }

    /**
     * Generate complete flight path including loiter circles
     */
    generateFlightPath() {
        let currentPosition = { ...this.homePosition };
        let currentTime = 0;
        let isFirstPoint = true;

        // Don't add HOME if coordinates are (0, 0) - will start from first real waypoint
        const hasValidHome = this.homePosition.lat !== 0 || this.homePosition.lon !== 0;

        if (hasValidHome) {
            // Start at home
            this.flightPath.push({
                lat: currentPosition.lat,
                lon: currentPosition.lon,
                alt: currentPosition.alt,
                altAbsolute: currentPosition.alt,
                time: currentTime,
                speed: 0,
                command: 'HOME',
                waypointIndex: 0
            });
            isFirstPoint = false;
        }

        for (const wp of this.waypoints) {
            // Skip HOME (index 0) - already processed or invalid
            if (wp.index === 0) continue;

            // Skip waypoints without coordinates (servo commands, etc.)
            if (wp.lat === 0 && wp.lon === 0 &&
                wp.command !== MAV_CMD.DO_SET_SERVO &&
                wp.command !== MAV_CMD.DO_SET_CAM_TRIGG_DIST) {
                continue;
            }

            // If this is first real point, update currentPosition
            if (isFirstPoint && (wp.lat !== 0 || wp.lon !== 0)) {
                currentPosition = {
                    lat: wp.lat,
                    lon: wp.lon,
                    alt: this.getAbsoluteAltitude(wp)
                };
                isFirstPoint = false;
            }

            switch (wp.command) {
                case MAV_CMD.NAV_TAKEOFF:
                    currentTime = this.processTakeoff(wp, currentPosition, currentTime);
                    currentPosition.alt = this.getAbsoluteAltitude(wp);
                    break;

                case MAV_CMD.NAV_WAYPOINT:
                    currentTime = this.processWaypoint(wp, currentPosition, currentTime);
                    if (wp.lat !== 0 || wp.lon !== 0) {
                        currentPosition = {
                            lat: wp.lat,
                            lon: wp.lon,
                            alt: this.getAbsoluteAltitude(wp)
                        };
                    }
                    break;

                case MAV_CMD.NAV_LOITER_TURNS:
                    currentTime = this.processLoiterTurns(wp, currentPosition, currentTime);
                    currentPosition = {
                        lat: wp.lat,
                        lon: wp.lon,
                        alt: this.getAbsoluteAltitude(wp)
                    };
                    break;

                case MAV_CMD.NAV_LOITER_UNLIM:
                case MAV_CMD.NAV_LOITER_TIME:
                    // For unlimited/time loiter, just add the point
                    currentTime = this.processWaypoint(wp, currentPosition, currentTime);
                    currentPosition = {
                        lat: wp.lat,
                        lon: wp.lon,
                        alt: this.getAbsoluteAltitude(wp)
                    };
                    break;

                case MAV_CMD.NAV_LAND:
                    currentTime = this.processLanding(wp, currentPosition, currentTime);
                    break;

                case MAV_CMD.NAV_RETURN_TO_LAUNCH:
                    currentTime = this.processRTL(currentPosition, currentTime);
                    break;

                case MAV_CMD.DO_SET_SERVO:
                    this.processServoEvent(wp, currentPosition, currentTime);
                    break;

                case MAV_CMD.DO_SET_CAM_TRIGG_DIST:
                    this.processCameraEvent(wp, currentPosition, currentTime);
                    break;

                case MAV_CMD.DO_CHANGE_SPEED:
                    this.processChangeSpeed(wp, currentTime);
                    break;

                case MAV_CMD.NAV_LAND_LOCAL:
                    // Treat as regular landing - coordinates may be in different format
                    currentTime = this.processLandLocal(wp, currentPosition, currentTime);
                    break;
            }
        }

        this.totalTime = currentTime;
    }

    /**
     * Get absolute altitude (handle relative vs absolute frames)
     */
    getAbsoluteAltitude(wp) {
        if (wp.frame === MAV_FRAME.GLOBAL_RELATIVE_ALT) {
            return (this.homePosition?.alt || 0) + wp.alt;
        }
        return wp.alt;
    }

    /**
     * Process takeoff command
     */
    processTakeoff(wp, currentPos, currentTime) {
        const targetAlt = this.getAbsoluteAltitude(wp);
        const climbHeight = targetAlt - currentPos.alt;
        const climbTime = Math.abs(climbHeight) / AIRPLANE_SPEEDS.takeoff;

        // Add takeoff point
        this.flightPath.push({
            lat: currentPos.lat,
            lon: currentPos.lon,
            alt: targetAlt,
            altAbsolute: targetAlt,
            time: currentTime + climbTime,
            speed: AIRPLANE_SPEEDS.takeoff,
            command: 'TAKEOFF',
            waypointIndex: wp.index
        });

        return currentTime + climbTime;
    }

    /**
     * Process waypoint - fly from current position to waypoint
     */
    processWaypoint(wp, currentPos, currentTime) {
        if (wp.lat === 0 && wp.lon === 0) return currentTime;

        const targetAlt = this.getAbsoluteAltitude(wp);
        const distance = this.calculateDistance(
            currentPos.lat, currentPos.lon,
            wp.lat, wp.lon
        );

        // Determine speed based on altitude change (use currentCruiseSpeed if set by DO_CHANGE_SPEED)
        const altChange = targetAlt - currentPos.alt;
        let speed = this.currentCruiseSpeed || AIRPLANE_SPEEDS.cruise;
        if (altChange > 10) speed = Math.min(speed, AIRPLANE_SPEEDS.climb);
        else if (altChange < -10) speed = Math.min(speed, AIRPLANE_SPEEDS.descent);

        const flightTime = distance / speed;
        this.totalDistance += distance;

        // Add intermediate points for long segments (every 500m)
        const numIntermediatePoints = Math.floor(distance / 500);
        for (let i = 1; i <= numIntermediatePoints; i++) {
            const t = i / (numIntermediatePoints + 1);
            const intLat = currentPos.lat + (wp.lat - currentPos.lat) * t;
            const intLon = currentPos.lon + (wp.lon - currentPos.lon) * t;
            const intAlt = currentPos.alt + (targetAlt - currentPos.alt) * t;

            this.flightPath.push({
                lat: intLat,
                lon: intLon,
                alt: intAlt,
                altAbsolute: intAlt,
                time: currentTime + flightTime * t,
                speed: speed,
                command: 'TRANSIT',
                waypointIndex: wp.index
            });
        }

        // Add waypoint
        this.flightPath.push({
            lat: wp.lat,
            lon: wp.lon,
            alt: targetAlt,
            altAbsolute: targetAlt,
            time: currentTime + flightTime,
            speed: speed,
            command: wp.commandName,
            waypointIndex: wp.index
        });

        return currentTime + flightTime;
    }

    /**
     * Process LOITER_TURNS - generate circular flight path
     * p1 = number of turns
     * p3 = radius in meters
     */
    processLoiterTurns(wp, currentPos, currentTime) {
        const turns = wp.params.p1;
        const radius = wp.params.p3;
        const targetAlt = this.getAbsoluteAltitude(wp);
        const centerLat = wp.lat;
        const centerLon = wp.lon;

        console.log(`LOITER_TURNS: ${turns} turns, radius ${radius}m at (${centerLat}, ${centerLon})`);

        // First, fly to the loiter entry point (east of center)
        const entryLat = centerLat;
        const entryLon = centerLon + this.metersToLon(radius, centerLat);

        // Distance to entry point
        const distanceToEntry = this.calculateDistance(
            currentPos.lat, currentPos.lon,
            entryLat, entryLon
        );

        const transitTime = distanceToEntry / AIRPLANE_SPEEDS.cruise;
        this.totalDistance += distanceToEntry;

        // Add entry point
        this.flightPath.push({
            lat: entryLat,
            lon: entryLon,
            alt: targetAlt,
            altAbsolute: targetAlt,
            time: currentTime + transitTime,
            speed: AIRPLANE_SPEEDS.cruise,
            command: 'LOITER_ENTRY',
            waypointIndex: wp.index
        });

        currentTime += transitTime;

        // Generate circle points
        // Points per turn (more points = smoother circle)
        const pointsPerTurn = 36; // Every 10 degrees
        const totalPoints = turns * pointsPerTurn;
        const circumference = 2 * Math.PI * radius;
        const totalCircleDistance = circumference * turns;
        const circleTime = totalCircleDistance / AIRPLANE_SPEEDS.loiter;
        const timePerPoint = circleTime / totalPoints;

        this.totalDistance += totalCircleDistance;

        for (let i = 1; i <= totalPoints; i++) {
            const angle = (i / pointsPerTurn) * 2 * Math.PI; // Angle in radians

            // Calculate point on circle (clockwise from east)
            const pointLat = centerLat + this.metersToLat(radius * Math.sin(angle));
            const pointLon = centerLon + this.metersToLon(radius * Math.cos(angle), centerLat);

            this.flightPath.push({
                lat: pointLat,
                lon: pointLon,
                alt: targetAlt,
                altAbsolute: targetAlt,
                time: currentTime + timePerPoint * i,
                speed: AIRPLANE_SPEEDS.loiter,
                command: i === totalPoints ? 'LOITER_EXIT' : 'LOITER',
                waypointIndex: wp.index,
                loiterTurn: Math.floor(i / pointsPerTurn) + 1,
                loiterProgress: (i % pointsPerTurn) / pointsPerTurn
            });
        }

        return currentTime + circleTime;
    }

    /**
     * Process landing
     */
    processLanding(wp, currentPos, currentTime) {
        const targetAlt = this.getAbsoluteAltitude(wp);
        const distance = this.calculateDistance(
            currentPos.lat, currentPos.lon,
            wp.lat, wp.lon
        );

        const flightTime = distance / AIRPLANE_SPEEDS.landing;
        this.totalDistance += distance;

        this.flightPath.push({
            lat: wp.lat,
            lon: wp.lon,
            alt: targetAlt,
            altAbsolute: targetAlt,
            time: currentTime + flightTime,
            speed: AIRPLANE_SPEEDS.landing,
            command: 'LAND',
            waypointIndex: wp.index
        });

        return currentTime + flightTime;
    }

    /**
     * Process Return to Launch
     */
    processRTL(currentPos, currentTime) {
        if (!this.homePosition) return currentTime;

        const distance = this.calculateDistance(
            currentPos.lat, currentPos.lon,
            this.homePosition.lat, this.homePosition.lon
        );

        const flightTime = distance / AIRPLANE_SPEEDS.cruise;
        this.totalDistance += distance;

        this.flightPath.push({
            lat: this.homePosition.lat,
            lon: this.homePosition.lon,
            alt: this.homePosition.alt,
            altAbsolute: this.homePosition.alt,
            time: currentTime + flightTime,
            speed: AIRPLANE_SPEEDS.cruise,
            command: 'RTL',
            waypointIndex: -1
        });

        return currentTime + flightTime;
    }

    /**
     * Process servo event (payload release, etc.)
     */
    processServoEvent(wp, currentPos, currentTime) {
        const channel = wp.params.p1;
        const pwm = wp.params.p2;

        this.events.push({
            type: 'SERVO',
            channel: channel,
            pwm: pwm,
            lat: currentPos.lat,
            lon: currentPos.lon,
            alt: currentPos.alt,
            time: currentTime,
            waypointIndex: wp.index,
            description: pwm < 1500 ? 'Servo LOW (release?)' : 'Servo HIGH (close?)'
        });

        console.log(`SERVO event: channel ${channel} = ${pwm} at time ${currentTime.toFixed(1)}s`);
    }

    /**
     * Process camera trigger event
     */
    processCameraEvent(wp, currentPos, currentTime) {
        this.events.push({
            type: 'CAMERA',
            distance: wp.params.p1,
            lat: currentPos.lat,
            lon: currentPos.lon,
            alt: currentPos.alt,
            time: currentTime,
            waypointIndex: wp.index,
            description: wp.params.p1 > 0 ? `Camera every ${wp.params.p1}m` : 'Camera OFF'
        });
    }

    /**
     * Process DO_CHANGE_SPEED command
     * p1 = speed type (0=airspeed, 1=groundspeed)
     * p2 = target speed in m/s
     */
    processChangeSpeed(wp, currentTime) {
        const speedType = wp.params.p1;
        const targetSpeed = wp.params.p2;

        // Update cruise speed for subsequent waypoints
        if (targetSpeed > 0) {
            this.currentCruiseSpeed = targetSpeed;
            console.log(`DO_CHANGE_SPEED: Set ${speedType === 0 ? 'airspeed' : 'groundspeed'} to ${targetSpeed} m/s`);
        }

        this.events.push({
            type: 'SPEED_CHANGE',
            speedType: speedType,
            speed: targetSpeed,
            time: currentTime,
            waypointIndex: wp.index,
            description: `Speed → ${targetSpeed} m/s (${(targetSpeed * 3.6).toFixed(0)} km/h)`
        });
    }

    /**
     * Process NAV_LAND_LOCAL (command 89)
     * Coordinates may be in 1e7 format or local frame
     */
    processLandLocal(wp, currentPos, currentTime) {
        let targetLat = wp.lat;
        let targetLon = wp.lon;

        // Check if coordinates are in 1e7 format (very large numbers)
        if (Math.abs(wp.lat) > 1000000) {
            targetLat = wp.lat / 1e7;
            targetLon = wp.lon / 1e7;
            console.log(`LAND_LOCAL: Converting 1e7 format -> (${targetLat}, ${targetLon})`);
        }

        // If no valid coordinates, land at current position
        if (targetLat === 0 && targetLon === 0) {
            targetLat = currentPos.lat;
            targetLon = currentPos.lon;
        }

        const targetAlt = wp.alt || 0;
        const distance = this.calculateDistance(
            currentPos.lat, currentPos.lon,
            targetLat, targetLon
        );

        const flightTime = distance > 0 ? distance / AIRPLANE_SPEEDS.landing : 0;
        this.totalDistance += distance;

        this.flightPath.push({
            lat: targetLat,
            lon: targetLon,
            alt: targetAlt,
            altAbsolute: targetAlt,
            time: currentTime + flightTime,
            speed: AIRPLANE_SPEEDS.landing,
            command: 'LAND_LOCAL',
            waypointIndex: wp.index
        });

        return currentTime + flightTime;
    }

    /**
     * Calculate distance between two GPS points (Haversine formula)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Convert meters to latitude degrees
     */
    metersToLat(meters) {
        return meters / 111320;
    }

    /**
     * Convert meters to longitude degrees at given latitude
     */
    metersToLon(meters, lat) {
        return meters / (111320 * Math.cos(lat * Math.PI / 180));
    }

    /**
     * Calculate bounds of flight path
     */
    calculateBounds() {
        if (this.flightPath.length === 0) {
            return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0, minAlt: 0, maxAlt: 0 };
        }

        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        let minAlt = Infinity, maxAlt = -Infinity;

        for (const point of this.flightPath) {
            minLat = Math.min(minLat, point.lat);
            maxLat = Math.max(maxLat, point.lat);
            minLon = Math.min(minLon, point.lon);
            maxLon = Math.max(maxLon, point.lon);
            minAlt = Math.min(minAlt, point.alt);
            maxAlt = Math.max(maxAlt, point.alt);
        }

        return { minLat, maxLat, minLon, maxLon, minAlt, maxAlt };
    }

    /**
     * Format time as MM:SS or HH:MM:SS
     */
    formatTime(seconds) {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}
