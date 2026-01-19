/**
 * Denis (UD) Binary Log Parser
 * Parses binary .dat files from Denis drone telemetry system
 *
 * File format:
 * - Binary file with records marked by 0x7E
 * - Record structure: [0x7E] [type 3 bytes] [counter 4] [device_id 4] [data...] [checksum]
 *
 * GPS Types:
 * 1. Known GPS (fixed offsets):
 *    - 0x23 0x52 XX - absolute coordinates (lat at +24, lon at +28, alt at +32)
 *    - 0x27 0x52 XX - relative data
 * 2. Hidden GPS (requires scanning):
 *    - Coordinates can be in ANY record types
 *    - Requires float-scanning with validation
 *
 * Telemetry:
 * - Type: 'KS' (0x4B 0x53)
 * - Size: 77 bytes
 * - Frequency: ~50-100 Hz
 */

export class DenisLogParser {
    constructor() {
        // Data storage
        this.buffer = null;
        this.records = [];
        this.gpsAll = [];
        this.gpsKnown = [];
        this.gpsDiscovered = [];
        this.telemetry = [];

        // Statistics
        this.stats = {
            totalRecords: 0,
            knownGpsCount: 0,
            discoveredGpsCount: 0,
            telemetryCount: 0,
            typeStats: {}
        };

        // Coordinate history for geographic filtering (matching Python)
        this.coordHistory = [];

        // Region bounds for validation
        this.regionCenter = null;
        this.maxRegionRadius = 200; // 200 km (matching Python)
    }

    /**
     * Parse Denis .dat binary file
     * @param {File} file - The .dat file to parse
     * @param {Function} progressCallback - Optional callback for progress updates
     * @returns {Promise<Object>} Flight data object
     */
    async parse(file, progressCallback = null) {
        console.log('🚁 Starting Denis .dat parsing...');
        console.log('📄 File size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

        try {
            // Read file as ArrayBuffer
            this.buffer = await this.readFileAsArrayBuffer(file);
            const view = new DataView(this.buffer);

            if (progressCallback) progressCallback(10);

            // Step 1: Find all records
            console.log('🔍 Step 1: Scanning for records...');
            this.findAllRecords(view);
            console.log(`✅ Found ${this.records.length} records`);

            if (progressCallback) progressCallback(30);

            // Step 2: Parse known GPS types
            console.log('🔍 Step 2: Parsing known GPS types...');
            this.parseKnownGPS(view);
            console.log(`✅ Found ${this.gpsKnown.length} known GPS points`);

            // Update region center after known GPS (matching Python)
            if (this.coordHistory.length > 0) {
                this.updateRegionCenter();
                console.log(`📍 Region center: ${this.regionCenter[0].toFixed(6)}, ${this.regionCenter[1].toFixed(6)}`);
            }

            if (progressCallback) progressCallback(50);

            // Step 3: Scan for hidden GPS coordinates
            console.log('🔍 Step 3: Scanning for hidden GPS...');
            this.scanForHiddenGPS(view);
            console.log(`✅ Found ${this.gpsDiscovered.length} discovered GPS points`);

            if (progressCallback) progressCallback(70);

            // Step 4: Parse telemetry
            console.log('🔍 Step 4: Parsing telemetry...');
            this.parseTelemetry(view);
            console.log(`✅ Found ${this.telemetry.length} telemetry records`);

            if (progressCallback) progressCallback(80);

            // Step 5: Combine and filter GPS data
            console.log('🔍 Step 5: Filtering and combining GPS data...');
            this.combineAndFilterGPS();
            console.log(`✅ Total GPS points after filtering: ${this.gpsAll.length}`);

            if (progressCallback) progressCallback(90);

            // Step 6: Convert to flight data format
            console.log('🔍 Step 6: Converting to flight data format...');
            const flightData = this.convertToFlightData();

            if (progressCallback) progressCallback(100);

            console.log('✅ Denis .dat parsing complete');
            console.log(`📊 Statistics:`, this.stats);

            return flightData;

        } catch (error) {
            console.error('❌ Error parsing Denis .dat:', error);
            throw new Error(`Failed to parse Denis .dat: ${error.message}`);
        }
    }

    /**
     * Read file as ArrayBuffer
     */
    readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Find all records in the binary file (marked by 0x7E)
     */
    findAllRecords(view) {
        const MARKER = 0x7E;
        const records = [];

        for (let i = 0; i < view.byteLength - 12; i++) {
            if (view.getUint8(i) === MARKER) {
                // Found marker, read record metadata
                const type1 = view.getUint8(i + 1);
                const type2 = view.getUint8(i + 2);
                const type3 = view.getUint8(i + 3);
                const typeHex = this.toHex(type1) + this.toHex(type2) + this.toHex(type3);

                // Read counter (4 bytes, little-endian)
                const counter = view.getUint32(i + 4, true);

                // Read device_id (4 bytes, little-endian)
                const deviceId = view.getUint32(i + 8, true);

                // Estimate record size (search for next marker or use fixed sizes)
                let recordSize = this.estimateRecordSize(view, i);

                records.push({
                    offset: i,
                    type1,
                    type2,
                    type3,
                    typeHex,
                    counter,
                    deviceId,
                    size: recordSize
                });

                // Count type statistics
                this.stats.typeStats[typeHex] = (this.stats.typeStats[typeHex] || 0) + 1;
            }
        }

        this.records = records;
        this.stats.totalRecords = records.length;
    }

    /**
     * Estimate record size by finding next marker
     */
    estimateRecordSize(view, offset) {
        const MARKER = 0x7E;
        const maxSize = 1024; // Maximum reasonable record size

        for (let i = offset + 12; i < Math.min(offset + maxSize, view.byteLength); i++) {
            if (view.getUint8(i) === MARKER) {
                return i - offset;
            }
        }

        return Math.min(maxSize, view.byteLength - offset);
    }

    /**
     * Parse known GPS record types (0x23 0x52 XX)
     * EXACT MATCH to Python: struct.unpack('<f', ...) - float32, little-endian
     */
    parseKnownGPS(view) {
        let debugCount = 0;
        for (const record of this.records) {
            // Check for known GPS type: 0x23 0x52 XX
            if (record.type1 === 0x23 && record.type2 === 0x52) {
                // GPS data at fixed offsets (Python: record[24:28], record[28:32], record[32:36])
                const latOffset = record.offset + 24;
                const lonOffset = record.offset + 28;
                const altOffset = record.offset + 32;

                // Check bounds
                if (altOffset + 4 > view.byteLength) continue;

                try {
                    // Python: struct.unpack('<f', ...) = getFloat32(offset, true)
                    const latitude = view.getFloat32(latOffset, true);
                    const longitude = view.getFloat32(lonOffset, true);
                    const altitude = view.getFloat32(altOffset, true);

                    // Debug first few records
                    if (debugCount < 5) {
                        console.log(`🔍 DEBUG Known GPS #${debugCount}:`, {
                            offset: record.offset,
                            typeHex: record.typeHex,
                            latitude,
                            longitude,
                            altitude,
                            isValid: this.isValidGPS(latitude, longitude, altitude)
                        });
                        debugCount++;
                    }

                    // Validate coordinates
                    if (this.isValidGPS(latitude, longitude, altitude)) {
                        const gpsPoint = {
                            source: 'KNOWN_TYPE',
                            typeHex: record.typeHex,
                            latitude: latitude,
                            longitude: longitude,
                            altitude: altitude,
                            counter: record.counter,
                            recordOffset: record.offset
                        };

                        this.gpsKnown.push(gpsPoint);
                        this.gpsAll.push(gpsPoint); // Add to gpsAll immediately (matching Python)
                        this.stats.knownGpsCount++;

                        // Update coord history (matching Python)
                        this.coordHistory.push([latitude, longitude]);
                    }
                } catch (e) {
                    // Skip invalid reads
                }
            }
        }
    }

    /**
     * Scan for hidden GPS coordinates in all records
     * EXACT MATCH to Python: find_gps_in_record() - float32 scanning
     */
    scanForHiddenGPS(view) {
        const discovered = [];
        let debugCount = 0;
        let processedRecords = 0;

        for (const record of this.records) {
            // Skip already known GPS types
            if (record.type1 === 0x23 && record.type2 === 0x52) continue;
            if (record.type1 === 0x27 && record.type2 === 0x52) continue;

            // Skip KS telemetry
            if (record.type1 === 0x4B && record.type2 === 0x53) continue;

            processedRecords++;
            if (processedRecords % 50000 === 0) {
                console.log(`   Обработано: ${processedRecords.toLocaleString()} записей...`);
            }

            // Scan every 4-byte boundary in record (Python: range(4, min(len(record) - 8, 80)))
            const startOffset = record.offset + 4;
            const endOffset = Math.min(record.offset + Math.min(record.size - 8, 80), view.byteLength - 8);

            for (let offset = startOffset; offset < endOffset; offset += 4) {
                try {
                    // Python: struct.unpack('<f', record[offset:offset+4])
                    const lat = view.getFloat32(offset, true);
                    const lon = view.getFloat32(offset + 4, true);

                    // Basic validation (matching Python)
                    if (!this.isValidGPS(lat, lon, 0)) continue;
                    if (Math.abs(lat) < 1.0 && Math.abs(lon) < 1.0) continue;

                    // Geographic coherence check
                    if (!this.isGeographicallyCoherent(lat, lon, 50)) continue;

                    // Region check (if we have history)
                    if (this.coordHistory.length > 10) {
                        if (!this.isInReasonableRegion(lat, lon)) continue;
                    }

                    // Try to get altitude
                    let alt = null;
                    if (offset + 12 <= view.byteLength) {
                        try {
                            const altCandidate = view.getFloat32(offset + 8, true);
                            if (altCandidate > -500 && altCandidate < 10000) {
                                alt = altCandidate;
                            }
                        } catch (e) {
                            // Altitude not available
                        }
                    }

                    // Debug first discovery
                    if (debugCount < 3) {
                        console.log(`🔍 DEBUG Discovered GPS #${debugCount}:`, {
                            offset,
                            typeHex: record.typeHex,
                            latitude: lat,
                            longitude: lon,
                            altitude: alt
                        });
                        debugCount++;
                    }

                    const gpsPoint = {
                        source: 'DISCOVERED',
                        typeHex: record.typeHex,
                        latitude: lat,
                        longitude: lon,
                        altitude: alt,
                        counter: record.counter,
                        recordOffset: offset
                    };

                    discovered.push(gpsPoint);
                    this.gpsAll.push(gpsPoint); // Add to gpsAll immediately (matching Python)

                    // Update coord history (matching Python)
                    this.coordHistory.push([lat, lon]);

                    // Update region center periodically
                    if (this.coordHistory.length % 100 === 0) {
                        this.updateRegionCenter();
                    }

                    // Only take first GPS candidate from each record
                    break;

                } catch (e) {
                    // Skip invalid reads
                }
            }
        }

        this.gpsDiscovered = discovered;
        this.stats.discoveredGpsCount = discovered.length;
    }

    /**
     * Parse telemetry records (type 'KS' - 0x4B 0x53)
     */
    parseTelemetry(view) {
        for (const record of this.records) {
            // Check for telemetry type: 'KS' (0x4B 0x53)
            if (record.type1 === 0x4B && record.type2 === 0x53) {
                // Telemetry data parsing (simplified - add actual fields as needed)
                this.telemetry.push({
                    counter: record.counter,
                    offset: record.offset,
                    type: 'KS'
                });
                this.stats.telemetryCount++;
            }
        }
    }

    /**
     * Validate GPS coordinates
     */
    isValidGPS(lat, lon, alt) {
        // Check basic range
        if (lat < -90 || lat > 90) return false;
        if (lon < -180 || lon > 180) return false;
        if (alt < -500 || alt > 10000) return false; // Reasonable altitude range

        // Filter out common invalid values
        if (lat === 0 && lon === 0) return false;
        if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) return false;

        // Check for NaN or Infinity
        if (!isFinite(lat) || !isFinite(lon) || !isFinite(alt)) return false;

        return true;
    }

    /**
     * Filter GPS data (sort, deduplicate, clean outliers)
     * Note: gpsAll is already populated during parsing (matching Python)
     */
    combineAndFilterGPS() {
        if (this.gpsAll.length === 0) {
            console.log('⚠️ No GPS data found');
            return;
        }

        console.log(`📊 Processing ${this.gpsAll.length} GPS points...`);

        // Step 1: Sort by recordOffset (file order) to ensure correct trajectory
        // Do NOT sort by counter as it might be unreliable/reset
        this.gpsAll.sort((a, b) => a.recordOffset - b.recordOffset);

        // Step 2: Remove duplicates (same coordinates within 1m) - matching Python
        const unique = [];
        for (const point of this.gpsAll) {
            if (unique.length === 0) {
                unique.push(point);
                continue;
            }

            const last = unique[unique.length - 1];
            const dist = this.calculateDistance(
                last.latitude,
                last.longitude,
                point.latitude,
                point.longitude
            );

            // Only add if different location (>1m away) - matching Python
            if (dist > 0.001) { // 0.001 km = 1 meter
                unique.push(point);
            }
        }

        if (unique.length < this.gpsAll.length) {
            console.log(`🔍 Removed ${this.gpsAll.length - unique.length} duplicate points`);
        }

        // Step 3: Keep only the largest cluster of points (removes distant outliers)
        // This fixes the issue where the drone "teleports" 30km away
        const clustered = this.keepLargestCluster(unique);

        if (clustered.length < unique.length) {
            console.log(`🧹 Removed ${unique.length - clustered.length} outlier points (kept largest cluster)`);
        }

        this.gpsAll = clustered;
    }

    /**
     * Keep only the largest cluster of points
     * Groups points that are within 10km of each other.
     * Keeps the group with the most points.
     */
    keepLargestCluster(points) {
        if (points.length === 0) return [];

        const clusters = [];
        let currentCluster = [points[0]];

        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];

            const dist = this.calculateDistance(
                prev.latitude, prev.longitude,
                curr.latitude, curr.longitude
            );

            // If jump is > 10km, start new cluster
            if (dist > 10) {
                clusters.push(currentCluster);
                currentCluster = [];
            }
            currentCluster.push(curr);
        }
        clusters.push(currentCluster);

        // Find largest cluster
        let largest = clusters[0];
        for (const cluster of clusters) {
            if (cluster.length > largest.length) {
                largest = cluster;
            }
        }

        console.log(`🧩 Found ${clusters.length} clusters. Keeping largest with ${largest.length} points.`);
        return largest;
    }

    /**
     * Calculate distance between two GPS coordinates (Haversine formula)
     * Returns distance in METERS (matching Python)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth radius in KM (matching Python)
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Returns in KM (matching Python)
    }

    /**
     * Check geographic coherence - matching Python: is_geographically_coherent()
     */
    isGeographicallyCoherent(lat, lon, maxJumpKm = 50) {
        if (this.coordHistory.length === 0) {
            return true;
        }

        // Check recent coordinates (last 10)
        const recentCoords = this.coordHistory.slice(-10);
        let minDistance = Infinity;

        for (const [histLat, histLon] of recentCoords) {
            const dist = this.calculateDistance(lat, lon, histLat, histLon);
            minDistance = Math.min(minDistance, dist);
        }

        return minDistance < maxJumpKm;
    }

    /**
     * Check if coordinate is in reasonable region - matching Python: is_in_reasonable_region()
     */
    isInReasonableRegion(lat, lon) {
        if (this.regionCenter === null) {
            return true;
        }

        const distance = this.calculateDistance(lat, lon, this.regionCenter[0], this.regionCenter[1]);
        return distance < this.maxRegionRadius;
    }

    /**
     * Update region center using median - matching Python: update_region_center()
     */
    updateRegionCenter() {
        if (this.coordHistory.length === 0) {
            return;
        }

        const lats = this.coordHistory.map(c => c[0]);
        const lons = this.coordHistory.map(c => c[1]);

        const latsSorted = lats.slice().sort((a, b) => a - b);
        const lonsSorted = lons.slice().sort((a, b) => a - b);

        const medianLat = latsSorted[Math.floor(latsSorted.length / 2)];
        const medianLon = lonsSorted[Math.floor(lonsSorted.length / 2)];

        this.regionCenter = [medianLat, medianLon];
    }

    /**
     * Interpolate missing altitude values - matching Python logic
     * Интерполяция высоты (нет падений на 0) - matching Python
     */
    interpolateAltitude(points) {
        // Find points with valid altitude (> 0 and finite) - matching Python: alt > 0
        const withAlt = [];
        let invalidCount = 0;
        for (let i = 0; i < points.length; i++) {
            if (points[i].altitude && isFinite(points[i].altitude) && points[i].altitude > 0) {
                withAlt.push({ idx: i, alt: points[i].altitude });
            } else {
                invalidCount++;
            }
        }

        console.log(`   📊 Altitude stats: ${withAlt.length} valid, ${invalidCount} need interpolation`);

        if (withAlt.length === 0) {
            // No altitude data, set all to 100.0 - matching Python default
            console.log(`   ⚠️ No altitude data, setting all to 100.0m`);
            points.forEach(p => p.altitude = 100.0);
            return points;
        }

        // Get altitude range
        const altitudes = withAlt.map(a => a.alt);
        const minAlt = Math.min(...altitudes);
        const maxAlt = Math.max(...altitudes);
        console.log(`   ✅ Высота: ${minAlt.toFixed(1)} - ${maxAlt.toFixed(1)} м`);

        // Interpolate missing values - matching Python: alt is None or alt <= 0
        let interpolatedCount = 0;
        for (let i = 0; i < points.length; i++) {
            if (!points[i].altitude || !isFinite(points[i].altitude) || points[i].altitude <= 0) {
                interpolatedCount++;
                // Find nearest points with altitude
                let before = null, after = null;

                // Search backwards for previous valid altitude
                for (let j = withAlt.length - 1; j >= 0; j--) {
                    if (withAlt[j].idx < i) {
                        before = withAlt[j];
                        break;
                    }
                }

                // Search forwards for next valid altitude
                for (let j = 0; j < withAlt.length; j++) {
                    if (withAlt[j].idx > i) {
                        after = withAlt[j];
                        break;
                    }
                }

                // Interpolate
                if (before && after) {
                    // Linear interpolation (better than Python's simple average)
                    const ratio = (i - before.idx) / (after.idx - before.idx);
                    points[i].altitude = before.alt + (after.alt - before.alt) * ratio;
                } else if (before) {
                    points[i].altitude = before.alt;
                } else if (after) {
                    points[i].altitude = after.alt;
                } else {
                    points[i].altitude = 100.0; // matching Python default
                }
            }
        }

        if (interpolatedCount > 0) {
            console.log(`   ✅ Интерполировано ${interpolatedCount} точек высоты`);
        }

        return points;
    }

    /**
     * Convert parsed data to flight data format (compatible with visualization)
     */
    convertToFlightData() {
        if (this.gpsAll.length === 0) {
            throw new Error('No valid GPS data found in file');
        }

        // Interpolate missing altitudes
        this.interpolateAltitude(this.gpsAll);

        // Log start and end points
        const startGps = this.gpsAll[0];
        const endGps = this.gpsAll[this.gpsAll.length - 1];
        console.log(`   ✅ Старт: ${startGps.latitude.toFixed(6)}, ${startGps.longitude.toFixed(6)}, ${startGps.altitude.toFixed(2)}m`);
        console.log(`   ✅ Финиш: ${endGps.latitude.toFixed(6)}, ${endGps.longitude.toFixed(6)}, ${endGps.altitude.toFixed(2)}m`);

        // Convert to flight points format
        const points = [];
        const startCounter = this.gpsAll[0].counter;
        const endCounter = this.gpsAll[this.gpsAll.length - 1].counter;

        // Determine time strategy
        const counterDiff = endCounter - startCounter;

        // Define thresholds
        const MAX_DURATION_SECONDS = 48 * 3600; // 48 hours

        let timeDivisor = 100.0; // Default 100Hz (10ms)
        let strategy = 'DEFAULT_100HZ';

        // Check if default 100Hz assumption yields unreasonable duration
        const durationAt100Hz = counterDiff / 100.0;

        if (durationAt100Hz > MAX_DURATION_SECONDS) {
            // Try Microseconds (1MHz)
            const durationAt1MHz = counterDiff / 1000000.0;
            if (durationAt1MHz > 0 && durationAt1MHz < MAX_DURATION_SECONDS) {
                timeDivisor = 1000000.0;
                strategy = 'DETECTED_MICROSECONDS';
            } else {
                // Try 10kHz (0.1ms)
                const durationAt10kHz = counterDiff / 10000.0;
                if (durationAt10kHz > 0 && durationAt10kHz < MAX_DURATION_SECONDS) {
                    timeDivisor = 10000.0;
                    strategy = 'DETECTED_10KHZ';
                } else {
                    // Fallback to synthetic if nothing makes sense
                    strategy = 'SYNTHETIC_100HZ';
                }
            }
        }

        console.log('⏱️ Time calculation strategy:', {
            startCounter,
            endCounter,
            diff: counterDiff,
            durationAt100Hz: durationAt100Hz.toFixed(1) + 's',
            selectedStrategy: strategy,
            divisor: timeDivisor
        });

        // First pass: Create points with time
        for (let i = 0; i < this.gpsAll.length; i++) {
            const gps = this.gpsAll[i];

            // Calculate time
            let time;
            if (strategy === 'SYNTHETIC_100HZ') {
                // Fallback: 10ms per point
                time = i * 0.01;
            } else {
                time = (gps.counter - startCounter) / timeDivisor;
            }

            points.push({
                time: time,
                gps: {
                    lat: gps.latitude,
                    lon: gps.longitude,
                    altitude: gps.altitude,
                    speed: 0, // Will calculate in second pass
                    numSat: 0
                },
                attitude: {
                    roll: 0,
                    pitch: 0,
                    yaw: 0
                },
                _meta: {
                    source: gps.source,
                    typeHex: gps.typeHex,
                    counter: gps.counter
                }
            });
        }

        // Second pass: Calculate smoothed speed
        // Use a sliding window (e.g. +/- 5 points) to reduce noise
        const WINDOW_SIZE = 5;

        for (let i = 0; i < points.length; i++) {
            let speed = 0;

            // Need enough points for window
            if (i >= WINDOW_SIZE && i < points.length - WINDOW_SIZE) {
                const p1 = points[i - WINDOW_SIZE];
                const p2 = points[i + WINDOW_SIZE];

                const dt = p2.time - p1.time;
                if (dt > 0.001) { // Avoid division by zero
                    const dist = this.calculateDistance(
                        p1.gps.lat, p1.gps.lon,
                        p2.gps.lat, p2.gps.lon
                    ) * 1000; // km to meters

                    speed = dist / dt;
                }
            } else if (i > 0) {
                // Fallback for edges: simple diff
                const p1 = points[i - 1];
                const p2 = points[i];
                const dt = p2.time - p1.time;
                if (dt > 0.001) {
                    const dist = this.calculateDistance(
                        p1.gps.lat, p1.gps.lon,
                        p2.gps.lat, p2.gps.lon
                    ) * 1000;
                    speed = dist / dt;
                }
            }

            // Clamp unreasonable speeds (e.g. > 100 m/s is likely noise for most drones)
            // But don't clamp too hard if it's a fast plane
            if (speed > 300) speed = 0; // Likely teleportation/noise

            points[i].gps.speed = speed;
        }

        // Calculate bounds
        const bounds = this.calculateBounds(points);

        // Calculate duration
        const duration = points.length > 0 ?
            points[points.length - 1].time - points[0].time : 0;

        // Calculate region size
        const regionSize = this.calculateRegionSize(bounds);

        return {
            points: points,
            duration: duration,
            bounds: bounds,
            source: 'Denis (UD) .dat',
            // Denis-specific metadata
            denisMetadata: {
                totalRecords: this.stats.totalRecords,
                knownGpsCount: this.stats.knownGpsCount,
                discoveredGpsCount: this.stats.discoveredGpsCount,
                totalGpsPoints: this.gpsAll.length,
                telemetryCount: this.stats.telemetryCount,
                regionCenter: this.regionCenter ? {
                    lat: this.regionCenter[0],
                    lon: this.regionCenter[1]
                } : null,
                regionSize: regionSize,
                typeStatistics: this.stats.typeStats
            }
        };
    }

    /**
     * Calculate bounds of flight data
     */
    calculateBounds(points) {
        if (points.length === 0) {
            return {
                minLat: 0, maxLat: 0,
                minLon: 0, maxLon: 0,
                minAlt: 0, maxAlt: 0
            };
        }

        const bounds = {
            minLat: Infinity,
            maxLat: -Infinity,
            minLon: Infinity,
            maxLon: -Infinity,
            minAlt: Infinity,
            maxAlt: -Infinity
        };

        for (const point of points) {
            bounds.minLat = Math.min(bounds.minLat, point.gps.lat);
            bounds.maxLat = Math.max(bounds.maxLat, point.gps.lat);
            bounds.minLon = Math.min(bounds.minLon, point.gps.lon);
            bounds.maxLon = Math.max(bounds.maxLon, point.gps.lon);
            bounds.minAlt = Math.min(bounds.minAlt, point.gps.altitude);
            bounds.maxAlt = Math.max(bounds.maxAlt, point.gps.altitude);
        }

        return bounds;
    }

    /**
     * Calculate region size in kilometers
     */
    calculateRegionSize(bounds) {
        const latDist = this.calculateDistance(
            bounds.minLat, bounds.minLon,
            bounds.maxLat, bounds.minLon
        ) / 1000;

        const lonDist = this.calculateDistance(
            bounds.minLat, bounds.minLon,
            bounds.minLat, bounds.maxLon
        ) / 1000;

        return {
            latKm: latDist,
            lonKm: lonDist,
            description: `${latDist.toFixed(2)} × ${lonDist.toFixed(2)} km`
        };
    }

    /**
     * Helper: Convert byte to hex string
     */
    toHex(byte) {
        return byte.toString(16).padStart(2, '0').toUpperCase();
    }
}
