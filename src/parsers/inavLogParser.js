/**
 * INAV BlackBox Log Parser
 * Parses INAV blackbox .txt files and extracts flight data
 */

export class InavLogParser {
    constructor() {
        this.headers = {};
        this.fieldNames = [];
        this.fieldIndexes = {};
        this.data = [];
        this.startTime = 0;
    }

    /**
     * Parse INAV log file
     * @param {File} file - The log file to parse
     * @param {Function} progressCallback - Progress callback (percentage)
     * @returns {Promise<Object>} Parsed flight data
     */
    async parse(file, progressCallback = null) {
        const text = await this.readFile(file);
        const lines = text.split('\n');

        console.log('🔍 Total lines in file:', lines.length);
        console.log('📄 File size:', (file.size / 1024 / 1024).toFixed(2), 'MB');

        let dataLines = 0;
        let maxLines = Infinity; // Parse ALL data lines
        let isFirstLine = true;

        for (let i = 0; i < lines.length && dataLines < maxLines; i++) {
            const line = lines[i].trim();

            if (!line) continue;

            // Check if this is a CSV file (first line is header, not starting with 'H')
            if (isFirstLine && !line.startsWith('H')) {
                console.log('🔍 Detected CSV format (blackbox_decode output)');
                this.parseCSVHeader(line);
                isFirstLine = false;
                continue;
            }
            isFirstLine = false;

            // Parse field names FIRST (more specific match) - for old format
            if (line.startsWith('H Field ')) {
                this.parseFieldNames(line);
            }
            // Parse other header lines
            else if (line.startsWith('H ')) {
                this.parseHeader(line);
            }
            // Parse data lines
            else if (!line.startsWith('H') && !line.startsWith('E')) {
                this.parseDataLine(line);
                dataLines++;

                // Update progress more frequently for better UI feedback
                if (progressCallback && dataLines % 500 === 0) {
                    const progress = Math.min((i / lines.length) * 100, 100);
                    progressCallback(progress);
                    // Allow UI to update by yielding to event loop
                    if (dataLines % 5000 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
            }

            // Event lines
            else if (line.startsWith('E')) {
                // Skip event lines for now
            }
        }

        console.log('📦 Total data lines parsed:', this.data.length);

        return this.processData();
    }

    /**
     * Read file as text
     */
    async readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * Parse header line
     */
    parseHeader(line) {
        // Example: H Product:Blackbox flight data recorder by Nicholas Sherlock
        const match = line.match(/H\s+([^:]+):(.+)/);
        if (match) {
            this.headers[match[1].trim()] = match[2].trim();
        }
    }

    /**
     * Parse CSV header line (from blackbox_decode)
     */
    parseCSVHeader(line) {
        // Example: loopIteration, time (us), axisRate[0], ...
        const fields = line.split(',').map(f => f.trim());

        this.fieldNames = fields;
        // Create field index map for fast lookup
        fields.forEach((field, index) => {
            this.fieldIndexes[field] = index;
        });
        console.log(`✅ CSV header parsed: ${fields.length} fields`);
        console.log('🔍 First 10 fields:', fields.slice(0, 10));
    }

    /**
     * Parse field names line (old format)
     */
    parseFieldNames(line) {
        // Example: H Field I name:loopIteration,time,axisP[0],axisP[1]...
        // Format can be: "H Field I name:..." or "H Field name:..."
        const match = line.match(/H Field [A-Z]\s+([^:]+):(.+)/) ||
                     line.match(/H Field ([^:]+):(.+)/);

        if (match) {
            const frameType = match[1].trim();
            const fields = match[2].split(',').map(f => f.trim());

            if (frameType === 'name') {
                this.fieldNames = fields;
                // Create field index map for fast lookup
                fields.forEach((field, index) => {
                    this.fieldIndexes[field] = index;
                });
                console.log(`✅ Field names set: ${fields.length} fields`);
            }
        }
    }

    /**
     * Parse data line
     */
    parseDataLine(line) {
        const values = line.split(',').map(v => {
            const num = parseFloat(v);
            return isNaN(num) ? v.trim() : num;
        });

        if (values.length > 0) {
            this.data.push(values);
        }
    }

    /**
     * Process parsed data into structured format
     */
    processData() {
        if (this.data.length === 0) {
            throw new Error('No data found in log file');
        }

        // DEBUG: Log available field names
        console.log('🔍 Available field names:', this.fieldNames);
        console.log('🔍 Field indexes:', this.fieldIndexes);

        // DEBUG: Show first data row
        if (this.data.length > 0) {
            console.log('🔍 First data row (first 10 values):', this.data[0].slice(0, 10));
        }

        const flightData = [];
        this.startTime = this.getFieldValue(this.data[0], 'time (us)') ||
                        this.getFieldValue(this.data[0], 'time') || 0;

        // Check if this is a GPS-only file (all times are 0)
        const isGPSOnlyFile = this.data.every(row => {
            const t = this.getFieldValue(row, 'time (us)') ||
                     this.getFieldValue(row, 'time');
            return t === 0 || t === null;
        });

        console.log('🔍 GPS-only file detected:', isGPSOnlyFile);

        // First pass: collect all valid points to find median
        const validCoords = [];
        for (let i = 0; i < this.data.length; i++) {
            let lat = this.getFieldValue(this.data[i], 'GPS_coord[0]');
            let lon = this.getFieldValue(this.data[i], 'GPS_coord[1]');

            if (!lat || !lon || lat === 0 || lon === 0) continue;

            // Convert to decimal format if needed
            const isDecimalFormat = (lat > -180 && lat < 180);
            const latDecimal = isDecimalFormat ? lat : lat / 10000000;
            const lonDecimal = isDecimalFormat ? lon : lon / 10000000;

            // Validate converted coordinates
            if (latDecimal >= -90 && latDecimal <= 90 && lonDecimal >= -180 && lonDecimal <= 180) {
                validCoords.push({ lat: latDecimal, lon: lonDecimal });
            }
        }

        // Calculate median position
        if (validCoords.length > 0) {
            validCoords.sort((a, b) => a.lat - b.lat);
            const medianLat = validCoords[Math.floor(validCoords.length / 2)].lat;
            validCoords.sort((a, b) => a.lon - b.lon);
            const medianLon = validCoords[Math.floor(validCoords.length / 2)].lon;

            console.log('🔍 Median GPS position:', { medianLat, medianLon });

            // Store median for filtering
            this.medianLat = medianLat;
            this.medianLon = medianLon;
        }

        for (let i = 0; i < this.data.length; i++) {
            const point = this.extractFlightPoint(this.data[i], i, isGPSOnlyFile);
            if (point) {
                flightData.push(point);
            }
        }

        console.log(`📊 Processed ${flightData.length} valid GPS points from ${this.data.length} total rows`);

        return {
            headers: this.headers,
            fieldNames: this.fieldNames,
            points: flightData,
            startTime: this.startTime,
            duration: flightData.length > 0 ?
                flightData[flightData.length - 1].time - flightData[0].time : 0,
            bounds: this.calculateBounds(flightData)
        };
    }

    /**
     * Extract flight point data from row
     */
    extractFlightPoint(row, rowIndex = 0, isGPSOnlyFile = false) {
        // Get GPS coordinates - try both naming conventions
        // Old format: GPS_coord[0], GPS_coord[1]
        // New format (blackbox_decode): navPos[0], navPos[1]
        let lat = this.getFieldValue(row, 'GPS_coord[0]');
        let lon = this.getFieldValue(row, 'GPS_coord[1]');

        if (lat === null || lon === null) {
            // Try blackbox_decode format
            lat = this.getFieldValue(row, 'navPos[0]');
            lon = this.getFieldValue(row, 'navPos[1]');
        }

        // DEBUG: Log first few GPS values
        if (!this._debugLoggedGPS) {
            console.log('🔍 GPS Debug - lat:', lat, 'lon:', lon);
            console.log('🔍 navPos[0] index:', this.fieldIndexes['navPos[0]']);
            console.log('🔍 navPos[1] index:', this.fieldIndexes['navPos[1]']);
            this._debugLoggedGPS = true;
        }

        // Skip points without GPS data
        if (lat === null || lon === null || lat === 0 || lon === 0) {
            return null;
        }

        // Check if coordinates are already in decimal degrees (GPS CSV file)
        // or in integer format (degrees * 10^7)
        const isDecimalFormat = (lat > -180 && lat < 180);

        // Convert to decimal degrees if needed for validation
        const latDecimal = isDecimalFormat ? lat : lat / 10000000;
        const lonDecimal = isDecimalFormat ? lon : lon / 10000000;

        // DEBUG: Log coordinate conversion for first point
        if (rowIndex === 0) {
            console.log('🔍 GPS Coordinate Parsing (First Point):', {
                raw: { lat, lon },
                isDecimalFormat,
                converted: { latDecimal, lonDecimal }
            });
        }

        // Skip points with invalid coordinates (check if in reasonable range)
        // Valid latitude: -90 to 90, longitude: -180 to 180
        if (latDecimal < -90 || latDecimal > 90 || lonDecimal < -180 || lonDecimal > 180) {
            if (!this._warnedInvalidGPS) {
                console.warn('⚠️ Skipping invalid GPS point:', { lat: latDecimal, lon: lonDecimal });
                this._warnedInvalidGPS = true;
            }
            return null;
        }

        // Skip points too far from median (likely GPS glitches)
        // Max reasonable distance for a drone flight: 1km = 0.009 degrees (~1km at equator)
        if (this.medianLat && this.medianLon) {
            const latDiff = Math.abs(latDecimal - this.medianLat);
            const lonDiff = Math.abs(lonDecimal - this.medianLon);
            const maxDiff = 0.01; // ~1km

            if (latDiff > maxDiff || lonDiff > maxDiff) {
                if (!this._warnedFarGPS) {
                    console.warn('⚠️ Skipping GPS point too far from median:', {
                        lat: latDecimal,
                        lon: lonDecimal,
                        median: { lat: this.medianLat, lon: this.medianLon },
                        diff: { latDiff, lonDiff }
                    });
                    this._warnedFarGPS = true;
                }
                return null;
            }
        }

        // Time field - try both formats
        let time = this.getFieldValue(row, 'time (us)') ||
                   this.getFieldValue(row, 'time') ||
                   this.getFieldValue(row, 'loopIteration') || 0;

        // For GPS-only files, generate time based on row index
        // Assume GPS updates at ~10Hz (100ms per sample)
        if (isGPSOnlyFile) {
            time = rowIndex * 100000; // 100ms in microseconds
        }

        return {
            time: (time - this.startTime) / 1000000, // Convert to seconds
            gps: {
                lat: isDecimalFormat ? lat : lat / 10000000,
                lon: isDecimalFormat ? lon : lon / 10000000,
                altitude: this.getFieldValue(row, 'GPS_altitude') ||
                         this.getFieldValue(row, 'navPos[2]') || 0,
                speed: this.getFieldValue(row, 'GPS_speed (m/s)') ||
                       this.getFieldValue(row, 'GPS_speed') || 0,
                numSat: this.getFieldValue(row, 'GPS_numSat') || 0
            },
            attitude: {
                roll: (this.getFieldValue(row, 'attitude[0]') || 0) / 10, // decidegrees to degrees
                pitch: (this.getFieldValue(row, 'attitude[1]') || 0) / 10,
                yaw: (this.getFieldValue(row, 'attitude[2]') || 0) / 10
            }
        };
    }

    /**
     * Get field value by name
     */
    getFieldValue(row, fieldName) {
        const index = this.fieldIndexes[fieldName];
        if (index !== undefined && index < row.length) {
            return row[index];
        }
        return null;
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

        // DEBUG: Log calculated bounds
        console.log('🔍 Calculated Bounds:', {
            lat: `${bounds.minLat.toFixed(6)} to ${bounds.maxLat.toFixed(6)}`,
            lon: `${bounds.minLon.toFixed(6)} to ${bounds.maxLon.toFixed(6)}`,
            center: {
                lat: ((bounds.minLat + bounds.maxLat) / 2).toFixed(6),
                lon: ((bounds.minLon + bounds.maxLon) / 2).toFixed(6)
            }
        });

        return bounds;
    }
}
