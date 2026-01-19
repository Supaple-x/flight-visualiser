/**
 * Dual Log Parser
 * Combines GPS-only file with full telemetry file by timestamp synchronization
 */

import { InavLogParser } from './inavLogParser.js';

export class DualLogParser {
    constructor() {
        this.gpsParser = new InavLogParser();
        this.fullLogParser = new InavLogParser();
    }

    /**
     * Parse both files and synchronize data
     * @param {File} gpsFile - GPS-only CSV file
     * @param {File} fullLogFile - Full telemetry CSV file
     * @param {Function} progressCallback - Progress callback
     * @returns {Promise<Object>} Synchronized flight data
     */
    async parse(gpsFile, fullLogFile, progressCallback = null) {
        console.log('🔄 Starting dual-file parsing...');
        console.log('📄 GPS file:', gpsFile.name, (gpsFile.size / 1024).toFixed(1), 'KB');
        console.log('📄 Full log file:', fullLogFile.name, (fullLogFile.size / 1024 / 1024).toFixed(1), 'MB');

        // Parse GPS file
        if (progressCallback) progressCallback(0, 'Загрузка GPS файла...');
        const gpsData = await this.gpsParser.parse(gpsFile, (p) => {
            if (progressCallback) progressCallback(p * 0.3, 'Загрузка GPS файла...');
        });
        console.log('✅ GPS file parsed:', gpsData.points.length, 'points');

        // Parse full log file
        if (progressCallback) progressCallback(30, 'Загрузка полного лога...');
        const fullLogData = await this.fullLogParser.parse(fullLogFile, (p) => {
            if (progressCallback) progressCallback(30 + p * 0.5, 'Загрузка полного лога...');
        });
        console.log('✅ Full log file parsed:', fullLogData.points.length, 'raw entries');

        // Build full log index by timestamp for fast lookup
        if (progressCallback) progressCallback(80, 'Синхронизация данных...');
        const fullLogIndex = this.buildTimeIndex(this.fullLogParser.data);
        console.log('✅ Full log index built:', fullLogIndex.length, 'entries');

        // Show first entry for debugging
        if (fullLogIndex.length > 0) {
            console.log('🔍 First full log entry:', fullLogIndex[0]);
        }

        // Synchronize data
        const synchronizedData = this.synchronizeData(gpsData, fullLogIndex);
        console.log('✅ Data synchronized:', synchronizedData.points.length, 'points');

        // Show first synchronized point for debugging
        if (synchronizedData.points.length > 0) {
            console.log('🔍 First synchronized point:', synchronizedData.points[0]);
        }

        if (progressCallback) progressCallback(100, 'Готово!');

        return synchronizedData;
    }

    /**
     * Build time-indexed array from full log data
     * @param {Array} rawData - Raw data rows from full log
     * @returns {Array} Time-indexed telemetry data
     */
    buildTimeIndex(rawData) {
        const index = [];

        for (const row of rawData) {
            const time = this.fullLogParser.getFieldValue(row, 'time (us)');
            if (!time) continue;

            const entry = {
                time: time, // Keep in microseconds for matching
                attitude: {
                    roll: (this.fullLogParser.getFieldValue(row, 'attitude[0]') || 0) / 10,
                    pitch: (this.fullLogParser.getFieldValue(row, 'attitude[1]') || 0) / 10,
                    yaw: (this.fullLogParser.getFieldValue(row, 'attitude[2]') || 0) / 10
                },
                battery: {
                    voltage: this.fullLogParser.getFieldValue(row, 'vbat') || 0,
                    current: this.fullLogParser.getFieldValue(row, 'amperage') || 0
                },
                motors: [],
                servos: [],
                gyro: {
                    x: this.fullLogParser.getFieldValue(row, 'axisRate[0]') || 0,
                    y: this.fullLogParser.getFieldValue(row, 'axisRate[1]') || 0,
                    z: this.fullLogParser.getFieldValue(row, 'axisRate[2]') || 0
                },
                barometer: {
                    altitude: (this.fullLogParser.getFieldValue(row, 'BaroAlt (cm)') || 0) / 100 // cm to meters
                }
            };

            // Extract motor values (motor[0], motor[1], ...)
            for (let i = 0; i < 8; i++) {
                const motorValue = this.fullLogParser.getFieldValue(row, `motor[${i}]`);
                if (motorValue !== null) {
                    entry.motors.push(motorValue);
                }
            }

            // Extract servo values (servo[0] to servo[15])
            for (let i = 0; i < 16; i++) {
                const servoValue = this.fullLogParser.getFieldValue(row, `servo[${i}]`);
                if (servoValue !== null) {
                    entry.servos.push(servoValue);
                }
            }

            index.push(entry);
        }

        return index;
    }

    /**
     * Find closest telemetry entry by timestamp
     * @param {Number} targetTime - Target time in seconds
     * @param {Array} fullLogIndex - Full log time index
     * @param {Number} startTime - Start time offset in microseconds
     * @returns {Object|null} Closest telemetry entry
     */
    findClosestEntry(targetTime, fullLogIndex, startTime) {
        if (fullLogIndex.length === 0) return null;

        // Convert target time back to microseconds and add offset
        const targetMicros = targetTime * 1000000 + startTime;

        // Debug first few searches
        if (!this._debugSearchLogged) {
            console.log('🔍 Time search debug:');
            console.log('  GPS startTime:', startTime, 'microseconds');
            console.log('  Target time (sec):', targetTime);
            console.log('  Target time (μs):', targetMicros);
            console.log('  Full log first time:', fullLogIndex[0].time);
            console.log('  Full log last time:', fullLogIndex[fullLogIndex.length - 1].time);
            console.log('  Time range full log:', fullLogIndex[0].time, '-', fullLogIndex[fullLogIndex.length - 1].time);
            this._debugSearchLogged = true;
        }

        // Binary search for closest entry
        let left = 0;
        let right = fullLogIndex.length - 1;
        let closestIndex = 0;
        let closestDiff = Math.abs(fullLogIndex[0].time - targetMicros);

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const diff = Math.abs(fullLogIndex[mid].time - targetMicros);

            if (diff < closestDiff) {
                closestDiff = diff;
                closestIndex = mid;
            }

            if (fullLogIndex[mid].time < targetMicros) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        // Debug first match attempt
        if (!this._debugMatchLogged) {
            console.log('🔍 First match attempt:');
            console.log('  Closest diff:', closestDiff, 'microseconds (', (closestDiff / 1000).toFixed(1), 'ms )');
            console.log('  Tolerance:', 100000, 'microseconds ( 100 ms )');
            console.log('  Match found:', closestDiff < 100000);
            this._debugMatchLogged = true;
        }

        // Only return if within 100ms tolerance
        if (closestDiff < 100000) { // 100ms in microseconds
            return fullLogIndex[closestIndex];
        }

        return null;
    }

    /**
     * Synchronize GPS data with full log telemetry
     * @param {Object} gpsData - Parsed GPS data
     * @param {Array} fullLogIndex - Full log time index
     * @returns {Object} Synchronized flight data
     */
    synchronizeData(gpsData, fullLogIndex) {
        const synchronizedPoints = [];
        let matchedCount = 0;

        // Check if GPS file has synthetic time (starts at 0)
        const gpsStartTime = this.gpsParser.startTime;
        const fullLogStartTime = fullLogIndex.length > 0 ? fullLogIndex[0].time : 0;
        const fullLogEndTime = fullLogIndex.length > 0 ? fullLogIndex[fullLogIndex.length - 1].time : 0;
        const fullLogDuration = fullLogEndTime - fullLogStartTime;
        const gpsDuration = gpsData.points.length > 0 ?
            (gpsData.points[gpsData.points.length - 1].time - gpsData.points[0].time) : 0;

        console.log('🔍 Synchronization strategy:');
        console.log('  GPS: startTime =', gpsStartTime, ', duration =', gpsDuration.toFixed(1), 's');
        console.log('  Full log: startTime =', fullLogStartTime, ', duration =', (fullLogDuration / 1000000).toFixed(1), 's');

        // If GPS starts at 0 and full log doesn't, use proportional matching
        const useProportionalMatching = (gpsStartTime === 0 && fullLogStartTime > 1000000);

        if (useProportionalMatching) {
            console.log('  Using PROPORTIONAL matching (GPS synthetic time detected)');

            for (let i = 0; i < gpsData.points.length; i++) {
                const gpsPoint = gpsData.points[i];

                // Calculate proportional position in full log
                const gpsProgress = i / gpsData.points.length; // 0 to 1
                const fullLogIndex_target = Math.floor(gpsProgress * fullLogIndex.length);
                const telemetry = fullLogIndex[fullLogIndex_target];

                if (telemetry) {
                    synchronizedPoints.push({
                        ...gpsPoint,
                        attitude: telemetry.attitude,
                        battery: telemetry.battery,
                        motors: telemetry.motors,
                        servos: telemetry.servos,
                        gyro: telemetry.gyro,
                        barometer: telemetry.barometer
                    });
                    matchedCount++;
                } else {
                    synchronizedPoints.push(gpsPoint);
                }
            }
        } else {
            console.log('  Using TIMESTAMP matching');

            for (const gpsPoint of gpsData.points) {
                // Find closest telemetry entry
                const telemetry = this.findClosestEntry(
                    gpsPoint.time,
                    fullLogIndex,
                    gpsStartTime
                );

                if (telemetry) {
                    // Merge GPS point with telemetry
                    synchronizedPoints.push({
                        ...gpsPoint,
                        attitude: telemetry.attitude,
                        battery: telemetry.battery,
                        motors: telemetry.motors,
                        servos: telemetry.servos,
                        gyro: telemetry.gyro,
                        barometer: telemetry.barometer
                    });
                    matchedCount++;
                } else {
                    // Keep GPS point even if no telemetry match
                    synchronizedPoints.push(gpsPoint);
                }
            }
        }

        console.log(`📊 Synchronized ${matchedCount} of ${gpsData.points.length} GPS points with telemetry`);
        console.log(`📊 Match rate: ${(matchedCount / gpsData.points.length * 100).toFixed(1)}%`);

        return {
            ...gpsData,
            points: synchronizedPoints,
            telemetryMatchRate: matchedCount / gpsData.points.length
        };
    }
}
