/**
 * QGroundControl Waypoints Parser
 * Parses .waypoints files (QGC WPL format)
 *
 * Format: QGC WPL 110
 * index current frame command p1 p2 p3 p4 lat lon alt autocontinue
 */

export class WaypointsParser {
    constructor() {
        this.waypoints = [];

        // MAVLink command types we care about
        this.COMMANDS = {
            WAYPOINT: 16,        // MAV_CMD_NAV_WAYPOINT
            TAKEOFF: 84,         // MAV_CMD_NAV_TAKEOFF
            LAND: 85,            // MAV_CMD_NAV_LAND
            LOITER_TIME: 19,     // MAV_CMD_NAV_LOITER_TIME
            LOITER_UNLIM: 17,    // MAV_CMD_NAV_LOITER_UNLIM
            RETURN_TO_LAUNCH: 20 // MAV_CMD_NAV_RETURN_TO_LAUNCH
        };
    }

    /**
     * Parse .waypoints file
     * @param {File} file - The .waypoints file
     * @returns {Promise<Object>} Waypoints data
     */
    async parse(file) {
        console.log('🗺️ Starting waypoints parsing...');

        try {
            const text = await this.readFileAsText(file);
            const lines = text.split('\n');

            if (lines.length === 0 || !lines[0].startsWith('QGC WPL')) {
                throw new Error('Invalid waypoints file format. Expected QGC WPL format.');
            }

            console.log(`📄 QGC WPL file detected (${lines.length} lines)`);

            // Parse waypoints (skip header line)
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const waypoint = this.parseLine(line);
                if (waypoint) {
                    this.waypoints.push(waypoint);
                }
            }

            console.log(`✅ Parsed ${this.waypoints.length} waypoints`);

            // Filter only navigation waypoints (exclude camera triggers, etc)
            const navWaypoints = this.waypoints.filter(wp => this.isNavigationCommand(wp.command));
            console.log(`   Navigation waypoints: ${navWaypoints.length}`);

            return {
                waypoints: navWaypoints,
                allWaypoints: this.waypoints,
                bounds: this.calculateBounds(navWaypoints)
            };

        } catch (error) {
            console.error('❌ Error parsing waypoints:', error);
            throw error;
        }
    }

    /**
     * Parse single waypoint line
     */
    parseLine(line) {
        const parts = line.split(/\s+/);
        if (parts.length < 12) return null;

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

        // Get command type name
        waypoint.commandName = this.getCommandName(waypoint.command);

        return waypoint;
    }

    /**
     * Check if command is a navigation command (has coordinates)
     */
    isNavigationCommand(command) {
        return command === this.COMMANDS.WAYPOINT ||
               command === this.COMMANDS.TAKEOFF ||
               command === this.COMMANDS.LAND ||
               command === this.COMMANDS.LOITER_TIME ||
               command === this.COMMANDS.LOITER_UNLIM ||
               command === this.COMMANDS.RETURN_TO_LAUNCH;
    }

    /**
     * Get human-readable command name
     */
    getCommandName(command) {
        switch (command) {
            case this.COMMANDS.WAYPOINT: return 'WAYPOINT';
            case this.COMMANDS.TAKEOFF: return 'TAKEOFF';
            case this.COMMANDS.LAND: return 'LAND';
            case this.COMMANDS.LOITER_TIME: return 'LOITER';
            case this.COMMANDS.LOITER_UNLIM: return 'LOITER_UNLIM';
            case this.COMMANDS.RETURN_TO_LAUNCH: return 'RTL';
            default: return `CMD_${command}`;
        }
    }

    /**
     * Calculate bounds from waypoints
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
            // Skip waypoints with zero coordinates (like camera triggers)
            if (Math.abs(wp.lat) < 0.001 && Math.abs(wp.lon) < 0.001) continue;

            bounds.minLat = Math.min(bounds.minLat, wp.lat);
            bounds.maxLat = Math.max(bounds.maxLat, wp.lat);
            bounds.minLon = Math.min(bounds.minLon, wp.lon);
            bounds.maxLon = Math.max(bounds.maxLon, wp.lon);
            bounds.minAlt = Math.min(bounds.minAlt, wp.alt);
            bounds.maxAlt = Math.max(bounds.maxAlt, wp.alt);
        }

        return bounds;
    }

    /**
     * Read file as text
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }
}
