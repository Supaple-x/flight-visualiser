# Примеры использования

## Базовые примеры

### 1. Загрузка и отображение лога

```javascript
import { InavLogParser } from './parsers/inavLogParser.js';
import { SceneManager } from './scene/SceneManager.js';
import { TrajectoryLine } from './scene/TrajectoryLine.js';

// Загрузить файл
const file = document.getElementById('fileInput').files[0];

// Парсинг
const parser = new InavLogParser();
const flightData = await parser.parse(file);

// Создать сцену
const canvas = document.getElementById('scene');
const sceneManager = new SceneManager(canvas);

// Отобразить траекторию
const trajectory = new TrajectoryLine(sceneManager, flightData);

// Фокус камеры
sceneManager.focusOnBounds(flightData.bounds);
```

### 2. Воспроизведение с телеметрией

```javascript
import { PlaybackController } from './controls/PlaybackController.js';
import { Telemetry } from './ui/Telemetry.js';

// Создать контроллеры
const playback = new PlaybackController(flightData, droneModel, cameraController);
const telemetry = new Telemetry();

// Связать обновления
playback.onUpdate((data) => {
    telemetry.update(data.currentPoint, data.nextPoint, data.interpolation);
});

// В render loop
sceneManager.onRender(() => {
    playback.update();
});

// Управление
playback.play();
playback.setSpeed(2.0); // 2x скорость
```

### 3. Переключение режимов камеры

```javascript
import { CameraController } from './controls/CameraController.js';

const cameraController = new CameraController(sceneManager, droneModel);

// Top view
document.getElementById('btnTop').addEventListener('click', () => {
    cameraController.setMode('top');
});

// Follow mode
document.getElementById('btnFollow').addEventListener('click', () => {
    cameraController.setMode('follow');
    cameraController.setFollowDistance(50); // 50 метров
});

// FPV mode
document.getElementById('btnFPV').addEventListener('click', () => {
    cameraController.setMode('fpv');
});

// Обновлять в render loop
sceneManager.onRender(() => {
    cameraController.update();
});
```

---

## Продвинутые примеры

### 4. Загрузка FBX модели с анимацией

```javascript
import { DroneModel } from './scene/DroneModel.js';

const drone = new DroneModel(sceneManager);

// Загрузить FBX
await drone.loadFBXModel('/models/drone.fbx');

// Анимация загрузки
let loadProgress = 0;
const loadInterval = setInterval(() => {
    loadProgress += 1;
    console.log(`Loading: ${loadProgress}%`);

    if (loadProgress >= 100) {
        clearInterval(loadInterval);
        console.log('Model loaded!');
    }
}, 10);

// Настроить масштаб
drone.setScale(0.1);
```

### 5. Кастомная цветовая схема траектории

```javascript
// TrajectoryLine.js - модифицировать createTrajectory()

createTrajectory() {
    // ... существующий код ...

    for (const point of this.flightData.points) {
        const position = this.sceneManager.gpsToLocal(/*...*/);
        points.push(position);

        // Кастомная цветовая схема: по скорости
        const speed = point.gps.speed / 100; // м/с
        const maxSpeed = 30; // м/с
        const speedNormalized = Math.min(speed / maxSpeed, 1.0);

        const color = new THREE.Color();

        if (speed < 5) {
            // Медленно - зелёный
            color.setHex(0x00ff00);
        } else if (speed < 15) {
            // Средне - жёлтый
            color.setHex(0xffff00);
        } else {
            // Быстро - красный
            color.setHex(0xff0000);
        }

        colors.push(color.r, color.g, color.b);
    }

    // ... создание линии ...
}
```

### 6. Множественные траектории (сравнение полётов)

```javascript
class MultiFlightVisualizer {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.flights = [];
    }

    async addFlight(file, color = 0x4a90e2) {
        const parser = new InavLogParser();
        const flightData = await parser.parse(file);

        // Создать траекторию с кастомным цветом
        const trajectory = this.createColoredTrajectory(
            flightData,
            color
        );

        this.flights.push({
            data: flightData,
            trajectory,
            drone: new DroneModel(this.sceneManager)
        });
    }

    createColoredTrajectory(flightData, color) {
        const points = [];
        const colors = [];

        const centerLat = (flightData.bounds.minLat + flightData.bounds.maxLat) / 2;
        const centerLon = (flightData.bounds.minLon + flightData.bounds.maxLon) / 2;

        for (const point of flightData.points) {
            const pos = this.sceneManager.gpsToLocal(
                point.gps.lat,
                point.gps.lon,
                point.gps.altitude,
                centerLat,
                centerLon
            );

            points.push(pos);

            const c = new THREE.Color(color);
            colors.push(c.r, c.g, c.b);
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.LineBasicMaterial({ vertexColors: true });
        const line = new THREE.Line(geometry, material);

        this.sceneManager.add(line);

        return line;
    }

    playAll() {
        this.flights.forEach(flight => {
            const playback = new PlaybackController(
                flight.data,
                flight.drone,
                new CameraController(this.sceneManager, flight.drone)
            );

            playback.play();
        });
    }
}

// Использование
const multiViz = new MultiFlightVisualizer(sceneManager);
await multiViz.addFlight(file1, 0xff0000); // Красный
await multiViz.addFlight(file2, 0x0000ff); // Синий
multiViz.playAll();
```

### 7. Экспорт видео с canvas

```javascript
class VideoExporter {
    constructor(canvas, flightData, playbackController) {
        this.canvas = canvas;
        this.flightData = flightData;
        this.playback = playbackController;
        this.mediaRecorder = null;
        this.chunks = [];
    }

    async startRecording() {
        const stream = this.canvas.captureStream(60); // 60 FPS

        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: 10000000 // 10 Mbps
        });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.saveVideo();
        };

        this.mediaRecorder.start();

        // Автоматически воспроизвести и записать
        this.playback.play();
        this.playback.onUpdate((data) => {
            if (!data.isPlaying) {
                this.stopRecording();
            }
        });
    }

    stopRecording() {
        if (this.mediaRecorder?.state === 'recording') {
            this.mediaRecorder.stop();
        }
    }

    saveVideo() {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'flight-recording.webm';
        a.click();

        URL.revokeObjectURL(url);
    }
}

// Использование
const exporter = new VideoExporter(canvas, flightData, playback);

document.getElementById('btnRecord').addEventListener('click', () => {
    exporter.startRecording();
});
```

### 8. Синхронизация с внешними данными (видео с GoPro)

```javascript
class VideoSyncController {
    constructor(playbackController, videoElement) {
        this.playback = playbackController;
        this.video = videoElement;
        this.syncOffset = 0; // секунды
    }

    setSyncOffset(seconds) {
        this.syncOffset = seconds;
    }

    syncToVideo() {
        this.playback.onUpdate((data) => {
            if (data.isPlaying) {
                const videoTime = data.currentPoint.time + this.syncOffset;
                this.video.currentTime = videoTime;

                if (this.video.paused) {
                    this.video.play();
                }
            } else {
                this.video.pause();
            }
        });
    }

    syncToPlayback() {
        this.video.addEventListener('timeupdate', () => {
            const logTime = this.video.currentTime - this.syncOffset;
            this.playback.seekToTime(logTime);
        });

        this.video.addEventListener('play', () => {
            this.playback.play();
        });

        this.video.addEventListener('pause', () => {
            this.playback.pause();
        });
    }
}

// Использование
const videoSync = new VideoSyncController(playback, videoElement);
videoSync.setSyncOffset(-2.5); // Видео начинается на 2.5с раньше
videoSync.syncToVideo(); // Видео следует за логом
// или
videoSync.syncToPlayback(); // Лог следует за видео
```

### 9. Кеширование parsed данных в IndexedDB

```javascript
class LogCache {
    constructor() {
        this.dbName = 'FlightVisualizerCache';
        this.storeName = 'parsedLogs';
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onerror = reject;
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'fileHash' });
                }
            };
        });
    }

    async hashFile(file) {
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async getCached(file) {
        const hash = await this.hashFile(file);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(hash);

            request.onsuccess = () => resolve(request.result?.data || null);
            request.onerror = reject;
        });
    }

    async cache(file, data) {
        const hash = await this.hashFile(file);

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.put({
                fileHash: hash,
                fileName: file.name,
                data,
                cachedAt: Date.now()
            });

            request.onsuccess = resolve;
            request.onerror = reject;
        });
    }
}

// Использование
const cache = new LogCache();
await cache.init();

async function loadLog(file) {
    // Проверить кеш
    let flightData = await cache.getCached(file);

    if (flightData) {
        console.log('Loaded from cache');
        return flightData;
    }

    // Парсить и закешировать
    const parser = new InavLogParser();
    flightData = await parser.parse(file);

    await cache.cache(file, flightData);

    return flightData;
}
```

### 10. Пользовательские маркеры на траектории

```javascript
class TrajectoryMarkers {
    constructor(sceneManager, flightData) {
        this.sceneManager = sceneManager;
        this.flightData = flightData;
        this.markers = [];
    }

    addMarker(timeSeconds, label, color = 0xff0000) {
        // Найти ближайшую точку
        const point = this.findPointAtTime(timeSeconds);
        if (!point) return;

        // Создать маркер
        const geometry = new THREE.SphereGeometry(3, 16, 16);
        const material = new THREE.MeshBasicMaterial({ color });
        const marker = new THREE.Mesh(geometry, material);

        const position = this.sceneManager.gpsToLocal(
            point.gps.lat,
            point.gps.lon,
            point.gps.altitude,
            this.centerLat,
            this.centerLon
        );

        marker.position.copy(position);
        marker.userData = { label, point };

        this.sceneManager.add(marker);
        this.markers.push(marker);

        // Добавить текст
        this.addLabel(position, label);

        return marker;
    }

    addLabel(position, text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        ctx.font = '32px Arial';
        ctx.fillStyle = 'white';
        ctx.fillText(text, 10, 40);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(spriteMaterial);

        sprite.position.copy(position);
        sprite.position.y += 10;
        sprite.scale.set(20, 5, 1);

        this.sceneManager.add(sprite);
    }

    findPointAtTime(timeSeconds) {
        return this.flightData.points.find(p =>
            Math.abs(p.time - timeSeconds) < 0.1
        );
    }

    // Автоматические маркеры
    addAutoMarkers() {
        // Максимальная высота
        const maxAltPoint = this.flightData.points.reduce((max, p) =>
            p.gps.altitude > max.gps.altitude ? p : max
        );
        this.addMarker(maxAltPoint.time, 'Max Altitude', 0x00ff00);

        // Максимальная скорость
        const maxSpeedPoint = this.flightData.points.reduce((max, p) =>
            p.gps.speed > max.gps.speed ? p : max
        );
        this.addMarker(maxSpeedPoint.time, 'Max Speed', 0xffff00);
    }
}

// Использование
const markers = new TrajectoryMarkers(sceneManager, flightData);

// Добавить вручную
markers.addMarker(15.5, 'Loop Start', 0xff00ff);
markers.addMarker(18.2, 'Loop End', 0xff00ff);

// Автоматические маркеры
markers.addAutoMarkers();
```

---

## Интеграция с другими библиотеками

### Chart.js для графиков

```html
<!-- index.html -->
<canvas id="altitudeChart"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

```javascript
import Chart from 'chart.js/auto';

class TelemetryCharts {
    constructor(flightData) {
        this.flightData = flightData;
        this.createAltitudeChart();
    }

    createAltitudeChart() {
        const ctx = document.getElementById('altitudeChart').getContext('2d');

        const data = {
            labels: this.flightData.points.map(p => p.time.toFixed(1)),
            datasets: [{
                label: 'Altitude (m)',
                data: this.flightData.points.map(p => p.gps.altitude),
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        };

        new Chart(ctx, {
            type: 'line',
            data,
            options: {
                responsive: true,
                plugins: {
                    title: {
                        display: true,
                        text: 'Altitude Over Time'
                    }
                }
            }
        });
    }
}
```

### Mapbox GL JS для 2D карты

```javascript
import mapboxgl from 'mapbox-gl';

class MapOverlay {
    constructor(flightData) {
        mapboxgl.accessToken = 'YOUR_MAPBOX_TOKEN';

        this.map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/satellite-v9',
            center: [
                (flightData.bounds.minLon + flightData.bounds.maxLon) / 2,
                (flightData.bounds.minLat + flightData.bounds.maxLat) / 2
            ],
            zoom: 15
        });

        this.addFlightPath(flightData);
    }

    addFlightPath(flightData) {
        this.map.on('load', () => {
            this.map.addSource('route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: flightData.points.map(p => [
                            p.gps.lon,
                            p.gps.lat,
                            p.gps.altitude
                        ])
                    }
                }
            });

            this.map.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                paint: {
                    'line-color': '#ff0000',
                    'line-width': 3
                }
            });
        });
    }
}
```

---

Эти примеры показывают как расширить базовый функционал приложения для различных use cases!
