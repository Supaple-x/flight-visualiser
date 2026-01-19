/**
 * Telemetry UI - Displays flight telemetry data
 */
export class Telemetry {
    constructor() {
        this.elements = {
            time: document.getElementById('time'),
            altitude: document.getElementById('altitude'),
            speed: document.getElementById('speed'),
            gps: document.getElementById('gps'),
            roll: document.getElementById('roll'),
            pitch: document.getElementById('pitch'),
            yaw: document.getElementById('yaw'),
            satellites: document.getElementById('satellites')
        };

        // Extended telemetry elements
        this.extendedElements = {
            battery: document.getElementById('battery'),
            current: document.getElementById('current'),
            motor0: document.getElementById('motor0'),
            motor1: document.getElementById('motor1'),
            gyroX: document.getElementById('gyroX'),
            gyroY: document.getElementById('gyroY'),
            gyroZ: document.getElementById('gyroZ'),
            baroAlt: document.getElementById('baroAlt')
        };

        this.hasExtendedData = false;
        this.setupToggleButtons();
    }

    /**
     * Setup collapse/expand toggle buttons
     */
    setupToggleButtons() {
        // Main telemetry toggle
        const telemetryToggle = document.getElementById('telemetryToggle');
        const telemetryPanel = document.getElementById('telemetry');
        if (telemetryToggle && telemetryPanel) {
            telemetryToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                telemetryPanel.classList.toggle('collapsed');
            });
        }

        // Extended telemetry toggle
        const extendedToggle = document.getElementById('extendedTelemetryToggle');
        const extendedPanel = document.getElementById('extendedTelemetry');
        if (extendedToggle && extendedPanel) {
            extendedToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                extendedPanel.classList.toggle('collapsed');
            });
        }
    }

    /**
     * Update telemetry display
     */
    update(currentPoint, nextPoint, interpolation) {
        if (!currentPoint) return;

        // Check if we have extended data on first call
        if (!this.hasExtendedData) {
            if (currentPoint.battery) {
                console.log('✅ Расширенные данные обнаружены!');
                console.log('🔍 Battery data:', currentPoint.battery);
                this.hasExtendedData = true;
                this.showExtendedPanel();
            } else {
                // Debug: check what we have in current point
                if (!this._debugLogged) {
                    console.log('⚠️ Текущая точка не содержит расширенных данных');
                    console.log('🔍 Структура точки:', Object.keys(currentPoint));
                    console.log('🔍 Полная точка:', currentPoint);
                    this._debugLogged = true;
                }
            }
        }

        // Interpolate values
        const point = this.interpolatePoint(currentPoint, nextPoint, interpolation);

        // Update time
        if (this.elements.time) {
            this.elements.time.textContent = this.formatTime(point.time);
        }

        // Update altitude
        if (this.elements.altitude) {
            this.elements.altitude.textContent = `${point.gps.altitude.toFixed(1)}m`;
        }

        // Update speed
        if (this.elements.speed) {
            // Скорость уже в правильных единицах из парсера
            this.elements.speed.textContent = `${point.gps.speed.toFixed(1)} m/s`;
        }

        // Update GPS coordinates
        if (this.elements.gps) {
            this.elements.gps.textContent =
                `${point.gps.lat.toFixed(6)}, ${point.gps.lon.toFixed(6)}`;
        }

        // Update attitude (already in degrees from parser)
        if (this.elements.roll) {
            this.elements.roll.textContent = `${point.attitude.roll.toFixed(1)}°`;
        }

        if (this.elements.pitch) {
            this.elements.pitch.textContent = `${point.attitude.pitch.toFixed(1)}°`;
        }

        if (this.elements.yaw) {
            this.elements.yaw.textContent = `${point.attitude.yaw.toFixed(1)}°`;
        }

        // Update satellite count
        if (this.elements.satellites) {
            this.elements.satellites.textContent = point.gps.numSat.toString();
        }

        // Update extended telemetry if available
        if (this.hasExtendedData && point.battery) {
            this.updateExtendedTelemetry(point);
        }
    }

    /**
     * Update extended telemetry panel
     */
    updateExtendedTelemetry(point) {
        // Battery
        if (this.extendedElements.battery && point.battery) {
            this.extendedElements.battery.textContent = `${(point.battery.voltage / 100).toFixed(2)}V`;
        }

        // Current
        if (this.extendedElements.current && point.battery) {
            this.extendedElements.current.textContent = `${(point.battery.current / 100).toFixed(2)}A`;
        }

        // Motors - округлено до сотых
        if (this.extendedElements.motor0 && point.motors && point.motors.length > 0) {
            this.extendedElements.motor0.textContent = point.motors[0]?.toFixed(2) || '0.00';
        }

        if (this.extendedElements.motor1 && point.motors && point.motors.length > 1) {
            this.extendedElements.motor1.textContent = point.motors[1]?.toFixed(2) || '0.00';
        }

        // Gyro - округлено до сотых
        if (this.extendedElements.gyroX && point.gyro) {
            this.extendedElements.gyroX.textContent = point.gyro.x.toFixed(2);
        }

        if (this.extendedElements.gyroY && point.gyro) {
            this.extendedElements.gyroY.textContent = point.gyro.y.toFixed(2);
        }

        if (this.extendedElements.gyroZ && point.gyro) {
            this.extendedElements.gyroZ.textContent = point.gyro.z.toFixed(2);
        }

        // Barometer altitude - округлено до сотых
        if (this.extendedElements.baroAlt && point.barometer) {
            this.extendedElements.baroAlt.textContent = `${point.barometer.altitude.toFixed(2)}m`;
        }
    }

    /**
     * Interpolate point data
     */
    interpolatePoint(point1, point2, t) {
        if (!point2 || t === 0) return point1;

        const interpolated = {
            time: point1.time + (point2.time - point1.time) * t,
            gps: {
                lat: point1.gps.lat + (point2.gps.lat - point1.gps.lat) * t,
                lon: point1.gps.lon + (point2.gps.lon - point1.gps.lon) * t,
                altitude: point1.gps.altitude + (point2.gps.altitude - point1.gps.altitude) * t,
                speed: point1.gps.speed + (point2.gps.speed - point1.gps.speed) * t,
                numSat: point1.gps.numSat
            },
            attitude: {
                roll: point1.attitude.roll + (point2.attitude.roll - point1.attitude.roll) * t,
                pitch: point1.attitude.pitch + (point2.attitude.pitch - point1.attitude.pitch) * t,
                yaw: point1.attitude.yaw + (point2.attitude.yaw - point1.attitude.yaw) * t
            }
        };

        // Interpolate extended data if available
        if (point1.battery && point2.battery) {
            interpolated.battery = {
                voltage: point1.battery.voltage + (point2.battery.voltage - point1.battery.voltage) * t,
                current: point1.battery.current + (point2.battery.current - point1.battery.current) * t
            };
        }

        if (point1.motors && point2.motors) {
            interpolated.motors = point1.motors.map((m1, i) => {
                const m2 = point2.motors[i] || m1;
                return m1 + (m2 - m1) * t;
            });
        }

        if (point1.gyro && point2.gyro) {
            interpolated.gyro = {
                x: point1.gyro.x + (point2.gyro.x - point1.gyro.x) * t,
                y: point1.gyro.y + (point2.gyro.y - point1.gyro.y) * t,
                z: point1.gyro.z + (point2.gyro.z - point1.gyro.z) * t
            };
        }

        if (point1.barometer && point2.barometer) {
            interpolated.barometer = {
                altitude: point1.barometer.altitude + (point2.barometer.altitude - point1.barometer.altitude) * t
            };
        }

        return interpolated;
    }

    /**
     * Format time as MM:SS
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Show telemetry panel
     */
    show() {
        const panel = document.getElementById('telemetry');
        if (panel) {
            panel.style.display = 'block';
        }
    }

    /**
     * Show extended telemetry panel
     */
    showExtendedPanel() {
        const extendedPanel = document.getElementById('extendedTelemetry');
        if (extendedPanel) {
            extendedPanel.style.display = 'block';
            console.log('📊 Extended telemetry panel shown');
        }
    }

    /**
     * Hide telemetry panel
     */
    hide() {
        const panel = document.getElementById('telemetry');
        if (panel) {
            panel.style.display = 'none';
        }

        const extendedPanel = document.getElementById('extendedTelemetry');
        if (extendedPanel) {
            extendedPanel.style.display = 'none';
        }

        this.hasExtendedData = false;
    }
}
