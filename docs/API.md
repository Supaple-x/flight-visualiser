# API Documentation

## Основные классы

### InavLogParser

Парсер INAV BlackBox логов.

```javascript
import { InavLogParser } from './parsers/inavLogParser.js';

const parser = new InavLogParser();
const flightData = await parser.parse(file, (progress) => {
    console.log(`Parsing: ${progress}%`);
});
```

**Методы:**

- `async parse(file, progressCallback)` - Парсит файл и возвращает структуру flight data
  - `file` - File object
  - `progressCallback(percentage)` - Колбэк прогресса (0-100)
  - Returns: `{ headers, fieldNames, points, startTime, duration, bounds }`

**Структура возвращаемых данных:**

```javascript
{
    headers: { Product: "Blackbox...", ... },
    fieldNames: ["loopIteration", "time", "GPS_coord[0]", ...],
    points: [
        {
            time: 0.0,           // секунды
            gps: {
                lat: 55.912345,   // градусы
                lon: 37.890123,   // градусы
                altitude: 125.5,  // метры
                speed: 1200,      // см/с
                numSat: 12        // количество
            },
            attitude: {
                roll: 250,        // децидеградусы
                pitch: -50,       // децидеградусы
                yaw: 1800         // децидеградусы
            }
        },
        ...
    ],
    startTime: 1234567890,       // микросекунды
    duration: 45.32,             // секунды
    bounds: {
        minLat, maxLat,
        minLon, maxLon,
        minAlt, maxAlt
    }
}
```

---

### SceneManager

Управление Three.js сценой.

```javascript
import { SceneManager } from './scene/SceneManager.js';

const sceneManager = new SceneManager(canvas);
sceneManager.add(object);
sceneManager.focusOnBounds(bounds);
```

**Методы:**

- `add(object)` - Добавить объект в сцену
- `remove(object)` - Удалить объект из сцены
- `onRender(callback)` - Зарегистрировать колбэк для каждого фрейма
- `focusOnBounds(bounds)` - Настроить камеру на заданные границы
- `gpsToLocal(lat, lon, alt, centerLat, centerLon)` - Конвертация GPS → 3D координаты
- `getCamera()` - Получить камеру
- `getControls()` - Получить OrbitControls
- `dispose()` - Очистить ресурсы

---

### TrajectoryLine

Визуализация траектории полета.

```javascript
import { TrajectoryLine } from './scene/TrajectoryLine.js';

const trajectory = new TrajectoryLine(sceneManager, flightData);
const points = trajectory.getPoints();
```

**Методы:**

- `getPoints()` - Получить массив Vector3 точек траектории
- `dispose()` - Очистить ресурсы

**Особенности:**

- Цветовая кодировка по высоте (HSL: blue → red)
- Маркеры старта (зелёный) и финиша (красный)
- Вертикальные линии от земли к маркерам

---

### DroneModel

Управление 3D моделью дрона.

```javascript
import { DroneModel } from './scene/DroneModel.js';

const drone = new DroneModel(sceneManager);

// Загрузить FBX модель (опционально)
await drone.loadFBXModel('/models/drone.fbx');

// Обновить позицию и ориентацию
drone.update(position, attitude);
```

**Методы:**

- `async loadFBXModel(path)` - Загрузить FBX модель
  - Заменяет placeholder модель
  - Returns: Promise<Object3D>
- `update(position, attitude)` - Обновить позицию и поворот
  - `position` - Vector3
  - `attitude` - `{ roll, pitch, yaw }` в децидеградусах
- `setScale(scale)` - Установить масштаб модели
- `getPosition()` - Получить текущую позицию (Vector3)
- `getRotation()` - Получить текущий поворот (Euler)
- `setVisible(visible)` - Показать/скрыть модель
- `dispose()` - Очистить ресурсы

**Placeholder модель:**

По умолчанию создаётся простая модель quad:
- Центральный корпус
- 4 луча
- 4 пропеллера
- Красный конус спереди (индикатор направления)

---

### CameraController

Управление режимами камеры.

```javascript
import { CameraController } from './controls/CameraController.js';

const cameraController = new CameraController(sceneManager, droneModel);
cameraController.setMode('follow');
cameraController.update(); // Вызывать в animation loop
```

**Режимы:**

- `top` - Вид сверху, OrbitControls включены
- `follow` - Следование за дроном сзади и сверху
- `fpv` - Вид от первого лица из дрона

**Методы:**

- `setMode(mode)` - Установить режим камеры
  - mode: `'top' | 'follow' | 'fpv'`
- `update()` - Обновить позицию камеры (вызывать каждый фрейм)
- `resetTopView(bounds)` - Сбросить камеру в top view с фокусом на bounds
- `getMode()` - Получить текущий режим
- `setFollowDistance(distance)` - Установить дистанцию для follow режима
- `setSmoothFactor(factor)` - Плавность движения камеры (0-1)

---

### PlaybackController

Контроль воспроизведения полета.

```javascript
import { PlaybackController } from './controls/PlaybackController.js';

const playback = new PlaybackController(flightData, droneModel, cameraController);

// Регистрация колбэка обновления
playback.onUpdate((data) => {
    console.log(`Current time: ${data.currentPoint.time}s`);
});

// Управление воспроизведением
playback.play();
playback.pause();
playback.setSpeed(2.0);
playback.seek(500);

// Вызывать в animation loop
playback.update();
```

**Методы:**

- `onUpdate(callback)` - Зарегистрировать колбэк обновления
  - callback получает `{ index, currentPoint, nextPoint, interpolation, percentage, isPlaying }`
- `togglePlayPause()` - Переключить play/pause, returns isPlaying
- `play()` - Начать воспроизведение
- `pause()` - Остановить воспроизведение
- `stop()` - Остановить и сбросить в начало
- `setSpeed(speed)` - Установить скорость (0.1 - 10)
- `seek(index)` - Перемотать к индексу точки
- `seekToTime(seconds)` - Перемотать к времени в секундах
- `seekToPercentage(percentage)` - Перемотать к проценту (0-100)
- `update()` - Обновить состояние (вызывать в animation loop)
- `getState()` - Получить текущее состояние

---

### Telemetry

UI компонент для отображения телеметрии.

```javascript
import { Telemetry } from './ui/Telemetry.js';

const telemetry = new Telemetry();
telemetry.update(currentPoint, nextPoint, interpolation);
telemetry.show();
```

**Методы:**

- `update(currentPoint, nextPoint, interpolation)` - Обновить значения
- `show()` - Показать панель
- `hide()` - Скрыть панель

**Отображаемые данные:**

- Time
- Altitude (m)
- Speed (m/s)
- GPS coordinates
- Roll, Pitch, Yaw (degrees)
- Satellites count

---

### Timeline

UI компонент временной шкалы и контролов.

```javascript
import { Timeline } from './ui/Timeline.js';

const timeline = new Timeline(playbackController);
timeline.setDuration(flightData.duration);
timeline.update(playbackData);
```

**Методы:**

- `update(data)` - Обновить UI из playback данных
- `setDuration(seconds)` - Установить общую длительность
- `show()` - Показать панель
- `hide()` - Скрыть панель
- `reset()` - Сбросить в начальное состояние

---

### TerrainLoader

Загрузка terrain данных (пока placeholder).

```javascript
import { TerrainLoader } from './scene/TerrainLoader.js';

const terrain = new TerrainLoader(sceneManager, bounds);
await terrain.loadTerrain(bounds);
```

**Методы:**

- `async loadTerrain(bounds)` - Загрузить terrain
  - Сейчас создаёт простую плоскость
  - В будущем: Mapbox/Google API
- `dispose()` - Очистить ресурсы

---

## Утилиты

### GPS → Local координаты

Конвертация GPS координат в локальную 3D систему координат:

```javascript
// В SceneManager
const position = sceneManager.gpsToLocal(lat, lon, alt, centerLat, centerLon);
// Returns: Vector3(x, y, z)
```

**Формулы:**

```javascript
metersPerDegreeLat = 111320
metersPerDegreeLon = 111320 * cos(centerLat * π/180)

x = (lon - centerLon) * metersPerDegreeLon
z = -(lat - centerLat) * metersPerDegreeLat  // Инвертировано для North-Up
y = altitude / 100  // Масштабирование высоты
```

### Углы: Decidegrees → Radians

INAV хранит углы в decidegrees (градусы × 10):

```javascript
const radians = (decidegrees / 10) * (Math.PI / 180);
```

Пример:
- INAV: `250` decidegrees
- Degrees: `25°`
- Radians: `0.436` rad

---

## Примеры использования

### Базовая инициализация

```javascript
import { SceneManager } from './scene/SceneManager.js';
import { DroneModel } from './scene/DroneModel.js';
import { InavLogParser } from './parsers/inavLogParser.js';

// Парсинг
const parser = new InavLogParser();
const flightData = await parser.parse(file);

// Сцена
const sceneManager = new SceneManager(canvas);
const drone = new DroneModel(sceneManager);

// Установить позицию дрона
const firstPoint = flightData.points[0];
const position = sceneManager.gpsToLocal(
    firstPoint.gps.lat,
    firstPoint.gps.lon,
    firstPoint.gps.altitude,
    flightData.bounds.minLat,
    flightData.bounds.minLon
);

drone.update(position, firstPoint.attitude);
```

### Полная интеграция

См. [src/main.js](../src/main.js) для полного примера интеграции всех компонентов.

---

## События и колбэки

### SceneManager render loop

```javascript
sceneManager.onRender(() => {
    // Вызывается каждый фрейм
    playbackController.update();
});
```

### PlaybackController updates

```javascript
playbackController.onUpdate((data) => {
    // Вызывается при изменении позиции воспроизведения
    const { currentPoint, nextPoint, interpolation, percentage } = data;

    telemetry.update(currentPoint, nextPoint, interpolation);
    timeline.update(data);
});
```

---

## Константы

```javascript
// GPS конвертация
METERS_PER_DEGREE_LAT = 111320

// INAV единицы
DECIDEGREES_TO_DEGREES = 1/10
GPS_COORD_SCALE = 1e-7       // GPS_coord значения × 10^7
GPS_SPEED_TO_MS = 1/100      // Скорость в см/с

// Производительность
DEFAULT_MAX_PARSE_LINES = 1000
DEFAULT_FPS_LIMIT = 60
```
