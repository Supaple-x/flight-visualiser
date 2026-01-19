# Руководство разработчика

## Архитектурные принципы

### Модульность

Каждый компонент выполняет одну задачу:
- **Парсеры** - только парсинг данных
- **Scene** - только 3D визуализация
- **Controls** - только управление
- **UI** - только отображение интерфейса

### Слабая связанность

Компоненты взаимодействуют через четкие интерфейсы:

```javascript
// ✅ Хорошо: через методы
playbackController.onUpdate((data) => {
    telemetry.update(data);
});

// ❌ Плохо: прямой доступ к внутренним данным
telemetry.currentPoint = playbackController._internalData.point;
```

### Управление ресурсами

Все компоненты с Three.js объектами имеют метод `dispose()`:

```javascript
class MyComponent {
    constructor() {
        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.Material();
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
```

---

## Добавление новых функций

### 1. Web Workers для парсинга

Создайте `src/parsers/inavLogParser.worker.js`:

```javascript
// inavLogParser.worker.js
self.addEventListener('message', async (e) => {
    const { fileContent } = e.data;

    // Парсинг в отдельном потоке
    const result = parseLog(fileContent);

    self.postMessage({ type: 'complete', data: result });
});
```

Используйте в `inavLogParser.js`:

```javascript
async parse(file, progressCallback) {
    const worker = new Worker(
        new URL('./inavLogParser.worker.js', import.meta.url),
        { type: 'module' }
    );

    return new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                progressCallback?.(e.data.progress);
            } else if (e.data.type === 'complete') {
                resolve(e.data.data);
                worker.terminate();
            }
        };

        worker.onerror = reject;

        // Отправить файл в worker
        const reader = new FileReader();
        reader.onload = () => {
            worker.postMessage({ fileContent: reader.result });
        };
        reader.readAsText(file);
    });
}
```

### 2. Mapbox Terrain Integration

Создайте в `TerrainLoader.js`:

```javascript
async loadMapboxTerrain(bounds, accessToken) {
    const zoom = this.calculateOptimalZoom(bounds);
    const tiles = this.getTileCoordinates(bounds, zoom);

    const terrainData = await Promise.all(
        tiles.map(tile => this.fetchTerrainTile(tile, zoom, accessToken))
    );

    this.generateTerrainMesh(terrainData);
}

async fetchTerrainTile(tile, zoom, accessToken) {
    const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${tile.x}/${tile.y}.pngraw?access_token=${accessToken}`;

    const response = await fetch(url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    return this.decodeTerrainRGB(bitmap);
}

decodeTerrainRGB(bitmap) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const elevations = [];

    for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i];
        const g = imageData.data[i + 1];
        const b = imageData.data[i + 2];

        // Mapbox terrain formula
        const height = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
        elevations.push(height);
    }

    return {
        width: canvas.width,
        height: canvas.height,
        elevations
    };
}
```

### 3. Графики телеметрии

Используйте Chart.js или создайте собственный компонент:

```javascript
// src/ui/TelemetryChart.js
import * as THREE from 'three';

export class TelemetryChart {
    constructor(flightData) {
        this.flightData = flightData;
        this.canvas = document.getElementById('chart');
        this.ctx = this.canvas.getContext('2d');

        this.metrics = {
            altitude: [],
            speed: [],
            battery: []
        };

        this.extractMetrics();
    }

    extractMetrics() {
        for (const point of this.flightData.points) {
            this.metrics.altitude.push({
                x: point.time,
                y: point.gps.altitude
            });
            // ... остальные метрики
        }
    }

    draw() {
        // Рисование графика
        this.drawAxis();
        this.drawLine(this.metrics.altitude, 'blue');
    }
}
```

### 4. Экспорт траектории в KML/GPX

```javascript
// src/exporters/KMLExporter.js
export class KMLExporter {
    static export(flightData) {
        const coordinates = flightData.points
            .map(p => `${p.gps.lon},${p.gps.lat},${p.gps.altitude}`)
            .join('\n');

        const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>INAV Flight</name>
    <Placemark>
      <name>Flight Path</name>
      <LineString>
        <coordinates>
${coordinates}
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

        return kml;
    }

    static download(flightData, filename = 'flight.kml') {
        const kml = this.export(flightData);
        const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    }
}
```

---

## Оптимизация производительности

### 1. LOD для траектории

```javascript
// TrajectoryLine.js
class TrajectoryLine {
    createLODTrajectory() {
        const lod = new THREE.LOD();

        // Высокая детализация
        const highDetail = this.createLine(this.allPoints);
        lod.addLevel(highDetail, 0);

        // Средняя детализация (каждая 5-я точка)
        const medDetail = this.createLine(
            this.allPoints.filter((_, i) => i % 5 === 0)
        );
        lod.addLevel(medDetail, 500);

        // Низкая детализация (каждая 20-я точка)
        const lowDetail = this.createLine(
            this.allPoints.filter((_, i) => i % 20 === 0)
        );
        lod.addLevel(lowDetail, 2000);

        this.sceneManager.add(lod);
    }
}
```

### 2. Frustum Culling для terrain tiles

```javascript
class TerrainLoader {
    update(camera) {
        const frustum = new THREE.Frustum();
        const matrix = new THREE.Matrix4().multiplyMatrices(
            camera.projectionMatrix,
            camera.matrixWorldInverse
        );
        frustum.setFromProjectionMatrix(matrix);

        for (const [id, tile] of this.tiles.entries()) {
            tile.visible = frustum.intersectsBox(tile.boundingBox);
        }
    }
}
```

### 3. Прореживание точек при zoom

```javascript
class PlaybackController {
    getVisiblePoints(cameraDistance) {
        const skipFactor = Math.floor(cameraDistance / 100);

        return this.flightData.points.filter((_, i) =>
            i % Math.max(1, skipFactor) === 0
        );
    }
}
```

### 4. Ограничение FPS

```javascript
class SceneManager {
    animate() {
        const targetFPS = 60;
        const targetFrameTime = 1000 / targetFPS;

        let lastTime = performance.now();

        const loop = () => {
            this.animationFrameId = requestAnimationFrame(loop);

            const currentTime = performance.now();
            const deltaTime = currentTime - lastTime;

            if (deltaTime < targetFrameTime) return;

            lastTime = currentTime - (deltaTime % targetFrameTime);

            // Render
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };

        loop();
    }
}
```

---

## Тестирование

### Unit тесты (пример с Vitest)

```javascript
// tests/inavLogParser.test.js
import { describe, it, expect } from 'vitest';
import { InavLogParser } from '../src/parsers/inavLogParser.js';

describe('InavLogParser', () => {
    it('should parse field names correctly', () => {
        const parser = new InavLogParser();
        const line = 'H Field I name:loopIteration,time,GPS_coord[0]';

        parser.parseFieldNames(line);

        expect(parser.fieldNames).toEqual([
            'loopIteration',
            'time',
            'GPS_coord[0]'
        ]);
    });

    it('should convert GPS coordinates correctly', () => {
        const parser = new InavLogParser();
        const value = 559123456; // INAV format

        const degrees = value / 10000000;

        expect(degrees).toBeCloseTo(55.9123456, 6);
    });
});
```

### Интеграционные тесты

```javascript
// tests/visualization.test.js
import { describe, it, expect } from 'vitest';
import { SceneManager } from '../src/scene/SceneManager.js';
import { DroneModel } from '../src/scene/DroneModel.js';

describe('Visualization Integration', () => {
    it('should create scene and add drone', () => {
        const canvas = document.createElement('canvas');
        const sceneManager = new SceneManager(canvas);
        const droneModel = new DroneModel(sceneManager);

        expect(sceneManager.scene.children).toContain(droneModel.model);

        sceneManager.dispose();
        droneModel.dispose();
    });
});
```

---

## Debugging

### Three.js Debugging

```javascript
// Добавьте в SceneManager.js
import { AxesHelper, GridHelper } from 'three';

class SceneManager {
    enableDebugMode() {
        // Оси координат
        const axesHelper = new AxesHelper(100);
        this.scene.add(axesHelper);

        // Bounding boxes
        this.scene.traverse((object) => {
            if (object.isMesh) {
                const box = new THREE.BoxHelper(object, 0xffff00);
                this.scene.add(box);
            }
        });

        // Stats
        const stats = new Stats();
        document.body.appendChild(stats.dom);

        this.onRender(() => stats.update());
    }
}
```

### Логирование парсинга

```javascript
class InavLogParser {
    enableVerboseLogging() {
        this.verbose = true;
    }

    parseDataLine(line) {
        const values = line.split(',');

        if (this.verbose) {
            console.log('Raw values:', values);
            console.log('GPS:', {
                lat: values[this.fieldIndexes['GPS_coord[0]']],
                lon: values[this.fieldIndexes['GPS_coord[1]']]
            });
        }

        // ... остальной код
    }
}
```

---

## Code Style

### Naming Conventions

```javascript
// Классы: PascalCase
class SceneManager {}

// Методы и переменные: camelCase
const flightData = {};
function parseLogFile() {}

// Константы: UPPER_SNAKE_CASE
const MAX_POINTS = 1000;

// Private поля: префикс _
class MyClass {
    _internalState = null;
    publicAPI() {}
}
```

### JSDoc комментарии

```javascript
/**
 * Parse INAV log file
 * @param {File} file - The log file to parse
 * @param {Function} progressCallback - Progress callback (0-100)
 * @returns {Promise<Object>} Parsed flight data
 * @throws {Error} If file format is invalid
 */
async parse(file, progressCallback) {
    // ...
}
```

### Обработка ошибок

```javascript
// ✅ Хорошо
async loadLogFile(file) {
    try {
        const data = await this.parse(file);
        return data;
    } catch (error) {
        console.error('Failed to parse log:', error);
        throw new Error(`Invalid log file: ${error.message}`);
    }
}

// ❌ Плохо
async loadLogFile(file) {
    const data = await this.parse(file); // Необработанная ошибка
    return data;
}
```

---

## Полезные ресурсы

- [Three.js Documentation](https://threejs.org/docs/)
- [INAV BlackBox Format](https://github.com/iNavFlight/blackbox-log-viewer/blob/master/docs/development.md)
- [Mapbox Terrain-RGB](https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
