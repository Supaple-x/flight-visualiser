/**
 * OSD Telemetry CSV Parser
 * Parses CSV files extracted from OSD (On-Screen Display) flight telemetry.
 *
 * CSV columns:
 * timestamp, video_sec, lat, lon, altitude, heading, yaw, airspeed, groundspeed,
 * vspeed, pitch, roll, voltage, current, mode, wp_no, wp_dist, sat, home_dist,
 * total_dist, servo, time_val
 *
 * Data is sparse: GPS/speed fields appear every row (~1s), full telemetry every ~5s.
 * Missing values are interpolated from neighboring rows.
 */

export class OsdTelemetryParser {
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
            source: 'OSD Telemetry'
        };
    }

    /**
     * Parse OSD telemetry CSV file
     * @param {File} file - The .csv file to parse
     * @param {Function} progressCallback - Optional callback for progress updates
     * @param {Object} options - Parser options
     * @param {boolean} options.smooth - Enable artifact smoothing (default: false)
     * @returns {Promise<Object>} Flight data object
     */
    async parse(file, progressCallback = null, options = {}) {
        this.smoothEnabled = options.smooth || false;
        console.log('📡 Starting OSD Telemetry CSV parsing...');

        const text = await file.text();

        if (progressCallback) progressCallback(10, 'Чтение файла...');

        const lines = text.split('\n');
        if (lines.length < 2) {
            throw new Error('CSV file is empty or has no data rows');
        }

        // Parse header
        const header = lines[0].trim().split(',');
        const col = {};
        header.forEach((name, index) => {
            col[name.trim()] = index;
        });

        console.log(`📋 CSV columns (${header.length}):`, header.join(', '));
        console.log(`📋 Data rows: ${lines.length - 1}`);

        if (progressCallback) progressCallback(20, 'Парсинг строк...');

        // First pass: parse all rows into raw data
        const rawPoints = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const fields = this.parseCSVLine(line);

            const lat = this.parseFloat(fields[col['lat']]);
            const lon = this.parseFloat(fields[col['lon']]);

            // Skip rows with invalid GPS
            if (lat === null || lon === null || (lat === 0 && lon === 0)) continue;

            const time = this.parseFloat(fields[col['video_sec']]) ?? 0;
            const altitude = this.parseFloat(fields[col['altitude']]) ?? 0;
            const heading = this.parseFloat(fields[col['heading']]);
            const yaw = this.parseFloat(fields[col['yaw']]);
            const airspeed = this.parseFloat(fields[col['airspeed']]);
            const groundspeed = this.parseFloat(fields[col['groundspeed']]);
            const vspeed = this.parseFloat(fields[col['vspeed']]);
            const pitch = this.parseFloat(fields[col['pitch']]);
            const roll = this.parseFloat(fields[col['roll']]);
            const voltage = this.parseFloat(fields[col['voltage']]);
            const current = this.parseFloat(fields[col['current']]);
            const sat = this.parseFloat(fields[col['sat']]);
            const wpNo = this.parseFloat(fields[col['wp_no']]);
            const homeDist = this.parseFloat(fields[col['home_dist']]);
            const mode = fields[col['mode']]?.trim() || null;

            rawPoints.push({
                time, lat, lon, altitude, heading,
                yaw, airspeed, groundspeed, vspeed,
                pitch, roll, voltage, current, sat,
                wpNo, homeDist, mode
            });

            if (progressCallback && i % 100 === 0) {
                progressCallback(20 + (i / lines.length) * 50, 'Парсинг строк...');
            }
        }

        if (rawPoints.length === 0) {
            throw new Error('No valid GPS data found in CSV');
        }

        console.log(`✅ Parsed ${rawPoints.length} valid rows`);

        if (progressCallback) progressCallback(70, 'Интерполяция данных...');

        // Second pass: interpolate missing values
        this.interpolateGaps(rawPoints);

        // Third pass: smooth artifacts if enabled
        if (this.smoothEnabled) {
            if (progressCallback) progressCallback(80, 'Сглаживание артефактов...');
            const smoothed = this.smoothArtifacts(rawPoints);
            console.log(`🔧 Smoothing: fixed ${smoothed} artifact(s)`);
        }

        if (progressCallback) progressCallback(90, 'Построение точек...');

        // Build flight points
        for (const p of rawPoints) {
            const speed = p.groundspeed ?? p.airspeed ?? 0;

            this.flightData.points.push({
                time: p.time,
                gps: {
                    lat: p.lat,
                    lon: p.lon,
                    altitude: p.altitude,
                    speed: speed,
                    numSat: p.sat ?? 0
                },
                attitude: {
                    roll: p.roll ?? 0,
                    pitch: p.pitch ?? 0,
                    yaw: p.yaw ?? p.heading ?? 0
                },
                voltage: p.voltage,
                current: p.current,
                mode: p.mode,
                waypointNo: p.wpNo,
                homeDist: p.homeDist
            });

            // Update bounds
            this.updateBounds(p.lat, p.lon, p.altitude);
        }

        // Calculate duration
        if (this.flightData.points.length > 0) {
            const lastPoint = this.flightData.points[this.flightData.points.length - 1];
            this.flightData.duration = lastPoint.time;
        }

        console.log(`✅ OSD Telemetry parsed: ${this.flightData.points.length} points, duration: ${this.flightData.duration.toFixed(1)}s`);
        console.log(`📍 Bounds:`, this.flightData.bounds);

        if (progressCallback) progressCallback(100, 'Готово');

        return this.flightData;
    }

    /**
     * Parse a CSV line handling edge cases (trailing commas, etc.)
     */
    parseCSVLine(line) {
        return line.split(',');
    }

    /**
     * Parse a float value, returning null for empty/invalid strings
     */
    parseFloat(value) {
        if (value === undefined || value === null) return null;
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === 'None' || trimmed === 'null') return null;
        const num = Number(trimmed);
        return isNaN(num) ? null : num;
    }

    /**
     * Interpolate missing values in sparse telemetry data.
     * Fields that are always present (lat, lon, altitude, heading, airspeed, groundspeed)
     * don't need interpolation. Sparse fields (yaw, vspeed, pitch, roll, voltage, current, sat)
     * are filled from the nearest available values.
     */
    interpolateGaps(points) {
        const sparseFields = ['yaw', 'vspeed', 'pitch', 'roll', 'voltage', 'current', 'sat'];

        for (const field of sparseFields) {
            let lastKnownIdx = -1;

            for (let i = 0; i < points.length; i++) {
                if (points[i][field] !== null) {
                    // Fill gap between lastKnownIdx and i
                    if (lastKnownIdx >= 0 && i - lastKnownIdx > 1) {
                        const startVal = points[lastKnownIdx][field];
                        const endVal = points[i][field];
                        for (let j = lastKnownIdx + 1; j < i; j++) {
                            const t = (j - lastKnownIdx) / (i - lastKnownIdx);
                            points[j][field] = startVal + (endVal - startVal) * t;
                        }
                    }
                    lastKnownIdx = i;
                }
            }

            // Fill trailing nulls with last known value
            if (lastKnownIdx >= 0) {
                for (let i = lastKnownIdx + 1; i < points.length; i++) {
                    if (points[i][field] === null) {
                        points[i][field] = points[lastKnownIdx][field];
                    }
                }
            }

            // Fill leading nulls with first known value
            if (lastKnownIdx >= 0) {
                const firstKnownIdx = points.findIndex(p => p[field] !== null);
                if (firstKnownIdx > 0) {
                    for (let i = 0; i < firstKnownIdx; i++) {
                        points[i][field] = points[firstKnownIdx][field];
                    }
                }
            }
        }
    }

    /**
     * Smooth artifacts in trajectory data.
     * Detects and fixes:
     * - Altitude outliers (e.g. truncated values like 132 instead of 1320)
     * - GPS coordinate jumps
     * Uses a local window to compare each point against its neighbors.
     */
    smoothArtifacts(points) {
        if (points.length < 5) return 0;

        let fixCount = 0;
        const WINDOW = 5; // neighbors on each side

        // Pass 1: Fix altitude outliers
        for (let i = 0; i < points.length; i++) {
            const start = Math.max(0, i - WINDOW);
            const end = Math.min(points.length - 1, i + WINDOW);

            // Collect neighbor altitudes (excluding current point)
            const neighborAlts = [];
            for (let j = start; j <= end; j++) {
                if (j !== i) neighborAlts.push(points[j].altitude);
            }

            if (neighborAlts.length < 2) continue;

            const median = this.median(neighborAlts);
            const current = points[i].altitude;

            // Detect outlier: if altitude deviates more than 20% from local median
            // and the absolute difference is significant (> 50m)
            const diff = Math.abs(current - median);
            const threshold = Math.max(50, median * 0.2);

            if (diff > threshold) {
                // Interpolate from nearest valid neighbors
                let prevAlt = null, nextAlt = null;
                for (let j = i - 1; j >= Math.max(0, i - WINDOW * 2); j--) {
                    const d = Math.abs(points[j].altitude - median);
                    if (d <= threshold) { prevAlt = points[j].altitude; break; }
                }
                for (let j = i + 1; j <= Math.min(points.length - 1, i + WINDOW * 2); j++) {
                    const d = Math.abs(points[j].altitude - median);
                    if (d <= threshold) { nextAlt = points[j].altitude; break; }
                }

                if (prevAlt !== null && nextAlt !== null) {
                    points[i].altitude = (prevAlt + nextAlt) / 2;
                } else if (prevAlt !== null) {
                    points[i].altitude = prevAlt;
                } else if (nextAlt !== null) {
                    points[i].altitude = nextAlt;
                } else {
                    points[i].altitude = median;
                }

                console.log(`  Fixed altitude at t=${points[i].time.toFixed(1)}s: ${current} -> ${points[i].altitude.toFixed(0)} (median: ${median.toFixed(0)})`);
                fixCount++;
            }
        }

        // Pass 2: Fix GPS coordinate jumps
        for (let i = 1; i < points.length - 1; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            const next = points[i + 1];

            // Calculate distances (approximate, in degrees)
            const dPrevLat = Math.abs(curr.lat - prev.lat);
            const dPrevLon = Math.abs(curr.lon - prev.lon);
            const dNextLat = Math.abs(curr.lat - next.lat);
            const dNextLon = Math.abs(curr.lon - next.lon);
            const dPrevNextLat = Math.abs(next.lat - prev.lat);
            const dPrevNextLon = Math.abs(next.lon - prev.lon);

            // If current point jumps far from both neighbors,
            // but neighbors are close to each other — it's an outlier
            const jumpThreshold = 0.01; // ~1.1 km
            const prevDist = Math.max(dPrevLat, dPrevLon);
            const nextDist = Math.max(dNextLat, dNextLon);
            const neighborDist = Math.max(dPrevNextLat, dPrevNextLon);

            if (prevDist > jumpThreshold && nextDist > jumpThreshold && neighborDist < jumpThreshold) {
                points[i].lat = (prev.lat + next.lat) / 2;
                points[i].lon = (prev.lon + next.lon) / 2;
                console.log(`  Fixed GPS jump at t=${curr.time.toFixed(1)}s`);
                fixCount++;
            }
        }

        return fixCount;
    }

    /**
     * Calculate median of an array of numbers
     */
    median(arr) {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    updateBounds(lat, lon, alt) {
        const b = this.flightData.bounds;
        if (lat < b.minLat) b.minLat = lat;
        if (lat > b.maxLat) b.maxLat = lat;
        if (lon < b.minLon) b.minLon = lon;
        if (lon > b.maxLon) b.maxLon = lon;
        if (alt < b.minAlt) b.minAlt = alt;
        if (alt > b.maxAlt) b.maxAlt = alt;
    }
}
