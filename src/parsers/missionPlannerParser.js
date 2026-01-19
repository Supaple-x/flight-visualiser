/**
 * MissionPlanner TXT Log Parser
 * Parses MissionPlanner .txt log files exported after flight
 *
 * Format example:
 * 11.09.2025 15:37:39 FD 1C 0 0 42 1 1 21 mavlink_global_position_int_t time_boot_ms 37110 lat 562027452 lon 316243852 alt 181220 ...
 */

export class MissionPlannerParser {
    constructor() {
        this.flightData = {
            points: [],
            duration: 0,
            bounds: {
                minLat: Infinity,
                maxLat: -Infinity,
                minLon: Infinity,
                maxLon: -Infinity,
                minAlt: Infinity,
                maxAlt: -Infinity
            },
            source: 'MissionPlanner TXT',
            // Store data from different GPS sources
            gpsRawData: [],
            globalPositionData: []
        };

        // Temporary storage for data indexed by time
        this.dataByTimeRaw = new Map();
        this.dataByTimeGlobal = new Map();

        // Message counters for debugging
        this.messageCount = {
            gps_raw_int: 0,
            global_position_int: 0,
            gps_global_origin: 0,
            attitude: 0,
            vfr_hud: 0,
            other: 0
        };
    }

    /**
     * Parse MissionPlanner .txt file
     * @param {File} file - The .txt file to parse
     * @param {Function} progressCallback - Optional callback for progress updates
     * @returns {Promise<Object>} Flight data object
     */
    async parse(file, progressCallback) {
        console.log('🚁 Starting MissionPlanner TXT parsing...');

        try {
            // Read file as text
            const text = await this.readFileAsText(file);

            if (progressCallback) {
                progressCallback(20);
            }

            console.log(`📄 File size: ${text.length} characters`);

            // Parse lines
            const lines = text.split('\n');
            console.log(`📋 Total lines: ${lines.length}`);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                // Parse MAVLink message line
                this.parseLine(line);

                if (progressCallback && i % 1000 === 0) {
                    const progress = 20 + (i / lines.length) * 70;
                    progressCallback(progress);
                }
            }

            // Convert collected data to flight points
            this.buildFlightPoints();

            // Validate data
            if (this.flightData.points.length === 0) {
                throw new Error('No valid flight data points found in TXT file. Make sure the file contains GLOBAL_POSITION_INT or GPS_RAW_INT messages with valid coordinates (not near 0,0).');
            }

            // Calculate duration
            if (this.flightData.points.length > 0) {
                this.flightData.duration =
                    this.flightData.points[this.flightData.points.length - 1].time -
                    this.flightData.points[0].time;
            }

            if (progressCallback) {
                progressCallback(100);
            }

            console.log('✅ MissionPlanner TXT parsing complete');
            console.log(`📊 Parsed ${this.flightData.points.length} data points`);
            console.log(`⏱️ Flight duration: ${this.flightData.duration.toFixed(2)}s`);

            return this.flightData;

        } catch (error) {
            console.error('❌ Error parsing MissionPlanner TXT:', error);
            throw new Error(`Failed to parse MissionPlanner TXT: ${error.message}`);
        }
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

    /**
     * Parse a single line from the log file
     * Format: DATE TIME ... mavlink_MESSAGE_TYPE_t param1 value1 param2 value2 ...
     */
    parseLine(line) {
        try {
            // Extract message type
            const mavlinkMatch = line.match(/mavlink_(\w+)_t\s+(.+)/);
            if (!mavlinkMatch) return;

            const messageType = mavlinkMatch[1];
            const paramsString = mavlinkMatch[2];

            // Parse parameters into key-value pairs
            const params = this.parseParameters(paramsString);

            // Process specific message types
            switch (messageType) {
                case 'gps_raw_int':
                    this.messageCount.gps_raw_int++;
                    this.processGpsRaw(params);
                    break;
                case 'global_position_int':
                    this.messageCount.global_position_int++;
                    this.processGlobalPosition(params);
                    break;
                case 'gps_global_origin':
                    this.messageCount.gps_global_origin++;
                    this.processGpsGlobalOrigin(params);
                    break;
                case 'attitude':
                    this.messageCount.attitude++;
                    this.processAttitude(params);
                    break;
                case 'vfr_hud':
                    this.messageCount.vfr_hud++;
                    this.processVfrHud(params);
                    break;
                default:
                    this.messageCount.other++;
                    break;
            }
        } catch (error) {
            // Silently skip malformed lines
            // console.warn('Failed to parse line:', error);
        }
    }

    /**
     * Parse parameters string into object
     * Example: "time_boot_ms 37110 lat 562027452 lon 316243852" -> {time_boot_ms: 37110, lat: 562027452, ...}
     */
    parseParameters(paramsString) {
        const params = {};
        // Remove everything after "sig" or "Len" as those are metadata
        const cleanString = paramsString.split(/\s+sig\s+/)[0];

        const tokens = cleanString.trim().split(/\s+/);

        for (let i = 0; i < tokens.length - 1; i += 2) {
            const key = tokens[i];
            const value = tokens[i + 1];

            // Skip if value looks like a key (starts with letter and not a number)
            if (!value || value === '') continue;

            // Parse number (handle comma as decimal separator)
            const numValue = parseFloat(value.replace(',', '.'));
            params[key] = isNaN(numValue) ? value : numValue;
        }

        return params;
    }


    /**
     * Process ATTITUDE message
     * Contains: time_boot_ms, roll, pitch, yaw, rollspeed, pitchspeed, yawspeed
     */
    processAttitude(params) {
        if (!params.time_boot_ms) return;

        // Store attitude data temporarily to merge with GPS data later
        const timeMs = params.time_boot_ms;

        if (!this.attitudeByTime) {
            this.attitudeByTime = new Map();
        }

        this.attitudeByTime.set(timeMs, {
            roll: (params.roll || 0) * (180 / Math.PI),
            pitch: (params.pitch || 0) * (180 / Math.PI),
            yaw: (params.yaw || 0) * (180 / Math.PI)
        });
    }

    /**
     * Process VFR_HUD message
     * Contains: airspeed, groundspeed, heading, throttle, alt, climb
     */
    processVfrHud(params) {
        // VFR_HUD doesn't have time_boot_ms, so we'll store it separately
        // and merge it with closest GPS data later
        if (params.groundspeed !== undefined) {
            this.lastSpeed = params.groundspeed;
        }
    }

    /**
     * Process GPS_RAW_INT message
     * Contains: time_usec, lat, lon, alt, satellites_visible, vel, cog
     */
    processGpsRaw(params) {
        if (!params.lat || !params.lon || !params.alt) return;

        // GPS_RAW_INT uses time_usec (microseconds), convert to milliseconds
        let timeMs;
        if (params.time_usec) {
            timeMs = Math.floor(params.time_usec / 1000);
        } else if (params.time_boot_ms) {
            timeMs = params.time_boot_ms;
        } else {
            return; // No timestamp
        }

        const timestamp = timeMs / 1000.0; // Convert to seconds

        // Get or create data entry for this timestamp
        if (!this.dataByTimeRaw.has(timeMs)) {
            this.dataByTimeRaw.set(timeMs, {
                time: timestamp,
                gps: {
                    lat: null,
                    lon: null,
                    altitude: null,
                    speed: 0,
                    numSat: 0
                },
                attitude: {
                    roll: 0,
                    pitch: 0,
                    yaw: 0
                }
            });
        }

        const entry = this.dataByTimeRaw.get(timeMs);

        // MAVLink sends lat/lon as integers (degrees * 1e7)
        entry.gps.lat = params.lat / 1e7;
        entry.gps.lon = params.lon / 1e7;

        // GPS_RAW_INT altitude is in millimeters, convert to meters
        entry.gps.altitude = params.alt / 1000.0;

        // Velocity in cm/s, convert to m/s
        if (params.vel !== undefined && params.vel !== 65535) {
            entry.gps.speed = params.vel / 100.0;
        }

        // Number of satellites
        if (params.satellites_visible !== undefined) {
            entry.gps.numSat = params.satellites_visible;
        }

        // Update bounds only for valid coordinates (not near zero)
        const absLat = Math.abs(entry.gps.lat);
        const absLon = Math.abs(entry.gps.lon);
        if (absLat >= 0.001 || absLon >= 0.001) {
            this.updateBounds(entry.gps.lat, entry.gps.lon, entry.gps.altitude);
        }
    }

    /**
     * Process GLOBAL_POSITION_INT message
     * Contains: time_boot_ms, lat, lon, alt, relative_alt, vx, vy, vz, hdg
     * This is EKF-filtered position data
     */
    processGlobalPosition(params) {
        if (!params.time_boot_ms || !params.lat || !params.lon || !params.alt) return;

        const timeMs = params.time_boot_ms;
        const timestamp = timeMs / 1000.0; // Convert to seconds

        // Get or create data entry for this timestamp
        if (!this.dataByTimeGlobal.has(timeMs)) {
            this.dataByTimeGlobal.set(timeMs, {
                time: timestamp,
                gps: {
                    lat: null,
                    lon: null,
                    altitude: null,
                    speed: 0,
                    numSat: 0
                },
                attitude: {
                    roll: 0,
                    pitch: 0,
                    yaw: 0
                }
            });
        }

        const entry = this.dataByTimeGlobal.get(timeMs);

        // GLOBAL_POSITION_INT sends lat/lon as integers (degrees * 1e7)
        entry.gps.lat = params.lat / 1e7;
        entry.gps.lon = params.lon / 1e7;

        // GLOBAL_POSITION_INT altitude is in millimeters, convert to meters
        entry.gps.altitude = params.alt / 1000.0;

        // Calculate speed from vx, vy (in cm/s)
        if (params.vx !== undefined && params.vy !== undefined) {
            const speedCmS = Math.sqrt(params.vx * params.vx + params.vy * params.vy);
            entry.gps.speed = speedCmS / 100.0; // Convert to m/s
        }

        // Heading (in centidegrees, 0..35999)
        if (params.hdg !== undefined && params.hdg !== 65535) {
            entry.gps.heading = params.hdg / 100.0;
        }

        // Update bounds only for valid coordinates (not near zero)
        const absLat = Math.abs(entry.gps.lat);
        const absLon = Math.abs(entry.gps.lon);
        if (absLat >= 0.001 || absLon >= 0.001) {
            this.updateBounds(entry.gps.lat, entry.gps.lon, entry.gps.altitude);
        }
    }

    /**
     * Process GPS_GLOBAL_ORIGIN message
     * Contains: latitude, longitude, altitude
     * This is the reference point (home position), not trajectory data
     */
    processGpsGlobalOrigin(params) {
        if (!params.latitude || !params.longitude) return;

        // Store as reference point (not used for trajectory)
        this.globalOrigin = {
            lat: params.latitude / 1e7,
            lon: params.longitude / 1e7,
            altitude: params.altitude ? params.altitude / 1000.0 : 0
        };

        console.log('📍 GPS Global Origin:', this.globalOrigin);
    }

    /**
     * Update bounds with new coordinates
     */
    updateBounds(lat, lon, alt) {
        this.flightData.bounds.minLat = Math.min(this.flightData.bounds.minLat, lat);
        this.flightData.bounds.maxLat = Math.max(this.flightData.bounds.maxLat, lat);
        this.flightData.bounds.minLon = Math.min(this.flightData.bounds.minLon, lon);
        this.flightData.bounds.maxLon = Math.max(this.flightData.bounds.maxLon, lon);
        this.flightData.bounds.minAlt = Math.min(this.flightData.bounds.minAlt, alt);
        this.flightData.bounds.maxAlt = Math.max(this.flightData.bounds.maxAlt, alt);
    }

    /**
     * Build flight points from collected data
     */
    buildFlightPoints() {
        console.log(`📦 Building flight points...`);
        console.log(`📊 Message statistics:`, this.messageCount);
        console.log(`   - GPS_RAW_INT: ${this.dataByTimeRaw.size} timestamps`);
        console.log(`   - GLOBAL_POSITION_INT: ${this.dataByTimeGlobal.size} timestamps`);

        // Debug: показать примеры данных
        if (this.dataByTimeRaw.size > 0) {
            const firstRaw = Array.from(this.dataByTimeRaw.entries())[0];
            console.log(`   - GPS_RAW_INT sample:`, firstRaw);
        }
        if (this.dataByTimeGlobal.size > 0) {
            const firstGlobal = Array.from(this.dataByTimeGlobal.entries())[0];
            console.log(`   - GLOBAL_POSITION_INT sample:`, firstGlobal);
        }

        // Get sorted attitude data
        const sortedAttitudes = this.attitudeByTime ?
            Array.from(this.attitudeByTime.entries()).sort((a, b) => a[0] - b[0]) : [];

        if (sortedAttitudes.length > 0) {
            console.log(`   - ATTITUDE sample:`, sortedAttitudes[0]);
        }

        // Build GPS_RAW_INT data
        this.flightData.gpsRawData = this.buildDataArray(this.dataByTimeRaw, sortedAttitudes, 'GPS_RAW_INT');

        // Build GLOBAL_POSITION_INT data
        this.flightData.globalPositionData = this.buildDataArray(this.dataByTimeGlobal, sortedAttitudes, 'GLOBAL_POSITION_INT');

        // Use GLOBAL_POSITION_INT as default (if available), otherwise GPS_RAW_INT
        if (this.flightData.globalPositionData.length > 0) {
            this.flightData.points = this.flightData.globalPositionData;
            this.flightData.activeSource = 'global_position_int';
            console.log(`✅ Using GLOBAL_POSITION_INT as default source (${this.flightData.points.length} points)`);
            console.log(`   First point:`, this.flightData.points[0]);
            console.log(`   Last point:`, this.flightData.points[this.flightData.points.length - 1]);
        } else if (this.flightData.gpsRawData.length > 0) {
            this.flightData.points = this.flightData.gpsRawData;
            this.flightData.activeSource = 'gps_raw_int';
            console.log(`✅ Using GPS_RAW_INT as fallback source (${this.flightData.points.length} points)`);
            console.log(`   First point:`, this.flightData.points[0]);
            console.log(`   Last point:`, this.flightData.points[this.flightData.points.length - 1]);
        } else {
            console.warn('⚠️ No GPS data found in either source');
        }

        console.log(`📐 Merged attitude data from ${sortedAttitudes.length} attitude messages`);
        console.log(`📊 Bounds:`, this.flightData.bounds);
    }

    /**
     * Calculate distance between two GPS coordinates in meters
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
     * Build data array from a specific GPS source
     */
    buildDataArray(dataByTime, sortedAttitudes, sourceName) {
        const dataArray = [];
        let validPoints = 0;
        let skippedPoints = 0;
        let invalidCoords = 0;
        let teleportations = 0;

        // Convert map to array and sort by time
        const sortedEntries = Array.from(dataByTime.entries())
            .sort((a, b) => a[0] - b[0]);

        let lastValidPoint = null;

        for (const [timeMs, entry] of sortedEntries) {
            // Only include points that have valid GPS coordinates
            if (entry.gps.lat !== null && entry.gps.lon !== null && entry.gps.altitude !== null) {
                // Skip points with coordinates close to zero (uninitialized GPS)
                const absLat = Math.abs(entry.gps.lat);
                const absLon = Math.abs(entry.gps.lon);

                if (absLat < 0.001 && absLon < 0.001) {
                    invalidCoords++;
                    continue; // Skip this point
                }

                // Filter out GPS glitches (sudden jumps in position)
                if (lastValidPoint) {
                    const distance = this.calculateDistance(
                        lastValidPoint.gps.lat,
                        lastValidPoint.gps.lon,
                        entry.gps.lat,
                        entry.gps.lon
                    );

                    // Calculate time delta (in seconds)
                    const timeDelta = entry.time - lastValidPoint.time;

                    // Calculate altitude change
                    const altChange = Math.abs(entry.gps.altitude - lastValidPoint.gps.altitude);

                    // Maximum reasonable speed: 100 m/s (360 km/h - fast for a drone/plane)
                    const maxReasonableSpeed = 100; // m/s
                    const maxDistance = maxReasonableSpeed * timeDelta;

                    // Maximum reasonable vertical speed: 20 m/s
                    const maxVerticalSpeed = 20; // m/s
                    const maxAltChange = maxVerticalSpeed * Math.max(timeDelta, 0.1);

                    // Filter out impossible movements
                    if (timeDelta > 0) {
                        const horizontalSpeed = distance / timeDelta;
                        const verticalSpeed = altChange / timeDelta;

                        // Skip if horizontal or vertical speed is unreasonable
                        if (horizontalSpeed > maxReasonableSpeed || verticalSpeed > maxVerticalSpeed) {
                            teleportations++;
                            continue; // Skip this point
                        }
                    } else if (distance > 50 || altChange > 10) {
                        // If same timestamp but position changed significantly, skip
                        teleportations++;
                        continue;
                    }
                }
                // Find closest attitude data (within ±500ms)
                let closestAttitude = null;
                let minTimeDiff = 500; // Max 500ms difference

                for (const [attTimeMs, attitude] of sortedAttitudes) {
                    const timeDiff = Math.abs(attTimeMs - timeMs);
                    if (timeDiff < minTimeDiff) {
                        minTimeDiff = timeDiff;
                        closestAttitude = attitude;
                    }
                    // Stop searching if we're moving away
                    if (attTimeMs > timeMs + 500) break;
                }

                // Apply attitude if found
                if (closestAttitude) {
                    entry.attitude.roll = closestAttitude.roll;
                    entry.attitude.pitch = closestAttitude.pitch;
                    entry.attitude.yaw = closestAttitude.yaw;
                }

                dataArray.push(entry);
                lastValidPoint = entry; // Update last valid point
                validPoints++;
            } else {
                skippedPoints++;
            }
        }

        if (invalidCoords > 0) {
            console.log(`   ${sourceName}: skipped ${invalidCoords} points with invalid coordinates (near zero)`);
        }
        if (teleportations > 0) {
            console.log(`   ${sourceName}: skipped ${teleportations} points with GPS teleportations (jumps > 500m)`);
        }
        console.log(`   ${sourceName}: ${validPoints} valid points (skipped ${skippedPoints} incomplete)`);

        // Normalize time to start from 0
        if (dataArray.length > 0) {
            const startTime = dataArray[0].time;
            for (const point of dataArray) {
                point.time -= startTime;
            }

            // Calculate duration
            if (dataArray.length > 1) {
                const duration = dataArray[dataArray.length - 1].time;
                console.log(`   ${sourceName}: duration ${duration.toFixed(1)}s`);
            }
        }

        return dataArray;
    }

    /**
     * Create a flight data point
     */
    createDataPoint(timestamp, lat, lon, alt, attitude = {}) {
        return {
            time: timestamp,
            latitude: lat,
            longitude: lon,
            altitude: alt,
            roll: attitude.roll || 0,
            pitch: attitude.pitch || 0,
            yaw: attitude.yaw || 0,
            speed: attitude.speed || 0,
            satellites: attitude.satellites || 0
        };
    }
}
