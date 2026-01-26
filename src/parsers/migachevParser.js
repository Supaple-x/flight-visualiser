/**
 * Мигачев_1 Parser
 * Parses waypoint files in QGC WPL 110 format with extended command support
 *
 * Supported commands:
 * - 16: NAV_WAYPOINT
 * - 17: NAV_LOITER_UNLIM
 * - 18: NAV_LOITER_TURNS
 * - 19: NAV_LOITER_TIME
 * - 20: NAV_RETURN_TO_LAUNCH
 * - 21: NAV_LAND
 * - 22: NAV_TAKEOFF
 * - 84: NAV_TAKEOFF (alternative)
 * - 85: NAV_LAND (alternative)
 * - 183: DO_SET_SERVO (ignored for navigation)
 *
 * Frame types:
 * - 0: MAV_FRAME_GLOBAL (absolute altitude)
 * - 3: MAV_FRAME_GLOBAL_RELATIVE_ALT (altitude relative to HOME)
 */

export class MigachevParser {
    constructor() {
        this.waypoints = [];
        this.homeAltitude = 0;

        // Extended MAVLink command types
        this.COMMANDS = {
            NAV_WAYPOINT: 16,
            NAV_LOITER_UNLIM: 17,
            NAV_LOITER_TURNS: 18,
            NAV_LOITER_TIME: 19,
            NAV_RETURN_TO_LAUNCH: 20,
            NAV_LAND_LOCAL: 21,
            NAV_TAKEOFF_LOCAL: 22,
            NAV_TAKEOFF: 84,
            NAV_LAND: 85,
            DO_SET_SERVO: 183,
            DO_SET_RELAY: 181,
            DO_REPEAT_SERVO: 184,
            DO_DIGICAM_CONTROL: 203,
            DO_MOUNT_CONTROL: 205,
            DO_SET_CAM_TRIGG_DIST: 206
        };

        // Commands that have navigation coordinates
        this.NAV_COMMANDS = [
            this.COMMANDS.NAV_WAYPOINT,
            this.COMMANDS.NAV_LOITER_UNLIM,
            this.COMMANDS.NAV_LOITER_TURNS,
            this.COMMANDS.NAV_LOITER_TIME,
            this.COMMANDS.NAV_RETURN_TO_LAUNCH,
            this.COMMANDS.NAV_LAND_LOCAL,
            this.COMMANDS.NAV_TAKEOFF_LOCAL,
            this.COMMANDS.NAV_TAKEOFF,
            this.COMMANDS.NAV_LAND
        ];

        // Frame types
        this.FRAMES = {
            GLOBAL: 0,           // Absolute altitude (MSL)
            GLOBAL_RELATIVE: 3   // Altitude relative to HOME
        };
    }

    /**
     * Parse Migachev_1 waypoints file
     * @param {File} file - The waypoints file
     * @returns {Promise<Object>} Parsed waypoints data
     */
    async parse(file) {
        console.log('🚀 Мигачев_1: Starting parsing...');

        try {
            const text = await this.readFileAsText(file);
            const lines = text.split('\n');

            if (lines.length === 0 || !lines[0].startsWith('QGC WPL')) {
                throw new Error('Invalid file format. Expected QGC WPL format.');
            }

            const version = lines[0].trim();
            console.log(`📄 Мигачев_1: ${version} detected (${lines.length} lines)`);

            // Parse all waypoints
            this.waypoints = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const waypoint = this.parseLine(line, i);
                if (waypoint) {
                    this.waypoints.push(waypoint);
                }
            }

            console.log(`✅ Мигачев_1: Parsed ${this.waypoints.length} total waypoints`);

            // Find first waypoint with valid coordinates to use as reference
            const firstValidWaypoint = this.waypoints.find(wp =>
                this.hasValidCoordinates(wp) && this.isNavigationCommand(wp.command)
            );

            if (firstValidWaypoint) {
                // Use first valid waypoint's coordinates as HOME reference
                this.homeAltitude = this.estimateHomeAltitude(firstValidWaypoint);
                console.log(`🏠 Мигачев_1: HOME altitude estimated: ${this.homeAltitude}m (from waypoint ${firstValidWaypoint.index})`);
            }

            // Filter navigation waypoints with valid coordinates
            const navWaypoints = this.waypoints.filter(wp =>
                this.isNavigationCommand(wp.command) && this.hasValidCoordinates(wp)
            );

            // Convert relative altitudes to absolute
            const processedWaypoints = this.processAltitudes(navWaypoints);

            console.log(`📍 Мигачев_1: Navigation waypoints: ${processedWaypoints.length}`);
            this.logWaypointsSummary(processedWaypoints);

            // Calculate bounds
            const bounds = this.calculateBounds(processedWaypoints);

            return {
                waypoints: processedWaypoints,
                allWaypoints: this.waypoints,
                bounds: bounds,
                homeAltitude: this.homeAltitude,
                source: 'migachev'
            };

        } catch (error) {
            console.error('❌ Мигачев_1: Parsing error:', error);
            throw error;
        }
    }

    /**
     * Parse single waypoint line
     */
    parseLine(line, lineNumber) {
        const parts = line.split(/\s+/);

        if (parts.length < 12) {
            console.warn(`⚠️ Line ${lineNumber}: insufficient fields (${parts.length}/12)`);
            return null;
        }

        const waypoint = {
            index: parseInt(parts[0]),
            current: parseInt(parts[1]) === 1,
            frame: parseInt(parts[2]),
            command: parseInt(parts[3]),
            param1: parseFloat(parts[4]),
            param2: parseFloat(parts[5]),
            param3: parseFloat(parts[6]),
            param4: parseFloat(parts[7]),
            lat: parseFloat(parts[8]),
            lon: parseFloat(parts[9]),
            alt: parseFloat(parts[10]),
            autocontinue: parseInt(parts[11]) === 1
        };

        waypoint.commandName = this.getCommandName(waypoint.command);
        waypoint.frameName = this.getFrameName(waypoint.frame);

        return waypoint;
    }

    /**
     * Check if waypoint has valid GPS coordinates
     */
    hasValidCoordinates(waypoint) {
        return Math.abs(waypoint.lat) > 0.001 || Math.abs(waypoint.lon) > 0.001;
    }

    /**
     * Check if command is a navigation command
     */
    isNavigationCommand(command) {
        return this.NAV_COMMANDS.includes(command);
    }

    /**
     * Estimate HOME altitude from first valid waypoint
     * For relative altitude missions, HOME is typically at ground level
     */
    estimateHomeAltitude(firstWaypoint) {
        // If first waypoint uses relative altitude frame, assume HOME is at 0
        // Otherwise use the altitude value as reference
        if (firstWaypoint.frame === this.FRAMES.GLOBAL_RELATIVE) {
            return 0; // Ground level
        }
        return firstWaypoint.alt;
    }

    /**
     * Process waypoint altitudes - convert relative to absolute
     */
    processAltitudes(waypoints) {
        return waypoints.map((wp, index) => {
            const processed = { ...wp };

            // For relative altitude frame, add HOME altitude
            if (wp.frame === this.FRAMES.GLOBAL_RELATIVE) {
                processed.altAbsolute = this.homeAltitude + wp.alt;
                processed.altType = 'relative';
            } else {
                processed.altAbsolute = wp.alt;
                processed.altType = 'absolute';
            }

            // Assign sequential number for display (1-based, excluding HOME placeholder)
            processed.displayIndex = index + 1;

            return processed;
        });
    }

    /**
     * Get human-readable command name
     */
    getCommandName(command) {
        const names = {
            [this.COMMANDS.NAV_WAYPOINT]: 'WAYPOINT',
            [this.COMMANDS.NAV_LOITER_UNLIM]: 'LOITER',
            [this.COMMANDS.NAV_LOITER_TURNS]: 'LOITER_TURNS',
            [this.COMMANDS.NAV_LOITER_TIME]: 'LOITER_TIME',
            [this.COMMANDS.NAV_RETURN_TO_LAUNCH]: 'RTL',
            [this.COMMANDS.NAV_LAND_LOCAL]: 'LAND',
            [this.COMMANDS.NAV_TAKEOFF_LOCAL]: 'TAKEOFF',
            [this.COMMANDS.NAV_TAKEOFF]: 'TAKEOFF',
            [this.COMMANDS.NAV_LAND]: 'LAND',
            [this.COMMANDS.DO_SET_SERVO]: 'SERVO',
            [this.COMMANDS.DO_SET_RELAY]: 'RELAY',
            [this.COMMANDS.DO_DIGICAM_CONTROL]: 'CAMERA',
            [this.COMMANDS.DO_SET_CAM_TRIGG_DIST]: 'CAM_TRIGGER'
        };
        return names[command] || `CMD_${command}`;
    }

    /**
     * Get human-readable frame name
     */
    getFrameName(frame) {
        const names = {
            0: 'GLOBAL',
            1: 'LOCAL_NED',
            2: 'MISSION',
            3: 'GLOBAL_REL',
            4: 'LOCAL_ENU',
            6: 'GLOBAL_INT',
            10: 'GLOBAL_TERRAIN'
        };
        return names[frame] || `FRAME_${frame}`;
    }

    /**
     * Calculate geographic bounds
     */
    calculateBounds(waypoints) {
        const bounds = {
            minLat: Infinity,
            maxLat: -Infinity,
            minLon: Infinity,
            maxLon: -Infinity,
            minAlt: Infinity,
            maxAlt: -Infinity
        };

        for (const wp of waypoints) {
            if (!this.hasValidCoordinates(wp)) continue;

            bounds.minLat = Math.min(bounds.minLat, wp.lat);
            bounds.maxLat = Math.max(bounds.maxLat, wp.lat);
            bounds.minLon = Math.min(bounds.minLon, wp.lon);
            bounds.maxLon = Math.max(bounds.maxLon, wp.lon);

            const alt = wp.altAbsolute || wp.alt;
            bounds.minAlt = Math.min(bounds.minAlt, alt);
            bounds.maxAlt = Math.max(bounds.maxAlt, alt);
        }

        // Handle edge case of no valid waypoints
        if (bounds.minLat === Infinity) {
            return null;
        }

        return bounds;
    }

    /**
     * Log waypoints summary for debugging
     */
    logWaypointsSummary(waypoints) {
        console.log('📋 Мигачев_1: Waypoints summary:');
        waypoints.forEach(wp => {
            console.log(`   ${wp.displayIndex}. ${wp.commandName} @ (${wp.lat.toFixed(6)}, ${wp.lon.toFixed(6)}) alt=${wp.alt}m (${wp.altType})`);
        });
    }

    /**
     * Read file as text with encoding detection
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file, 'UTF-8');
        });
    }
}
