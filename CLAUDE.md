# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

INAV Flight Visualizer - 3D visualization of flight data from INAV BlackBox logs, Mission Planner logs (.txt), and waypoints (.waypoints) using Three.js.

## Development Commands

```bash
# Navigate to project directory
cd "C:\Users\kkulagin\Documents\INAV Log Viewer\flight-visualizer"

# Install dependencies
npm install

# Start development server (Vite with hot reload)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**Important**: The dev server runs on `127.0.0.1` (configured in package.json).

## Project Architecture

### Core Application Flow

1. **File Loading** (`main.js`):
   - Supports three log sources: INAV (.GPS + .01), Mission Planner (.txt), and waypoints (.waypoints)
   - Tab-based UI for selecting log source (INAV/ArduPilot/UD)
   - Dual parser system: GPS coordinates + full log data
   - Mission Planner parser extracts GPS data from MAVLink messages (GLOBAL_POSITION_INT, GPS_RAW_INT)

2. **Data Parsing** (`parsers/`):
   - `inavLogParser.js` - Parses INAV BlackBox format
   - `dualLogParser.js` - Combines GPS and full log data
   - `missionPlannerParser.js` - Parses Mission Planner TXT format with MAVLink messages
   - `waypointsParser.js` - Parses QGC WPL 110 format waypoints files

3. **3D Scene Setup** (`scene/`):
   - `SceneManager.js` - Three.js scene, camera, lighting, and GPS to local coordinate conversion
   - `TrajectoryLine.js` - Flight path visualization with Yellow→Red gradient
   - `WaypointsLine.js` - Mission waypoints with Purple→Cyan gradient, dashed line, glow effect
   - `DroneModel.js` - 3D drone representation with orientation
   - `TerrainLoader.js` - Google Maps satellite imagery and elevation data

4. **Controls & UI** (`controls/`, `ui/`):
   - `CameraController.js` - Top/Follow/FPV camera modes
   - `PlaybackController.js` - Timeline playback with speed control
   - `Telemetry.js` - Real-time GPS, altitude, speed, attitude display
   - `Timeline.js` - Interactive timeline scrubber

### Critical Coordinate Systems

**GPS to Local Conversion** (`SceneManager.gpsToLocal()`):
- Converts lat/lon/alt to Three.js local coordinates (meters)
- Uses center point of trajectory as origin (0, 0, 0)
- Altitude handling: checks if value > 10000 (centimeters) and converts to meters
- Returns THREE.Vector3(x, y, z) where:
  - x = longitude offset in meters
  - y = altitude in meters
  - z = -(latitude offset) in meters (negative for north)

**Altitude Systems**:
- **Flight trajectory**: Uses absolute altitude (MSL - Mean Sea Level) from GPS data
- **Waypoints**: HOME (index 0) has absolute MSL altitude, other waypoints have relative altitude (AGL - Above Ground Level)
- **Conversion**: Other waypoints converted by adding HOME waypoint altitude to their relative altitude
- **Ground level**: Calculated from minimum altitude in trajectory for consistent terrain reference

### Waypoints Visualization

**Color Gradients**:
- Flight trajectory (tlog): Yellow (hue=0.16) → Red (hue=0)
- Waypoints mission: Purple (hue=0.75) → Cyan (hue=0.5)

**Waypoints Line Features**:
- Dashed line style with glow effect (two-layer rendering)
- Numbered spheres with sprite labels
- Altitude alignment with flight trajectory through HOME altitude matching

### Terrain System

**TerrainLoader.js**:
- Google Maps Static API for satellite imagery
- Google Elevation API for 3D terrain (11x11 grid of elevation points)
- Fallback to flat ground plane if API unavailable
- Terrain mesh positioned at minimum elevation from API data
- Flat satellite map: 1x1 segments (no visible grid)
- Terrain with elevation: variable segments based on elevation grid

**API Configuration** (`config/api.js`):
- Google Maps API key stored in `API_KEYS.GOOGLE_MAPS`
- Map settings: tile size (640px), zoom level, image format, scale
- **Security Note**: API key is currently visible in code - consider environment variables for production

### File Format Support

**Mission Planner TXT Format**:
- MAVLink message format: timestamp, message_type, params...
- Key messages: GLOBAL_POSITION_INT, GPS_RAW_INT, ATTITUDE, GPS_GLOBAL_ORIGIN
- Altitude in millimeters, converted to meters in parser
- GPS coordinates in 1e7 format (e.g., 562027363 = 56.2027363°)

**QGC WPL 110 Waypoints Format**:
```
QGC WPL 110
index current frame command p1 p2 p3 p4 lat lon alt autocontinue
```
- Index 0 with current=1 indicates HOME position
- Commands: 16=WAYPOINT, 84=TAKEOFF, 85=LAND, 206=CAMERA_TRIGGER
- Navigation waypoints filtered from camera triggers

### Performance Considerations

**Current Limitations**:
- Mission Planner parser: processes all lines (can be slow for 300MB+ files)
- No data throttling or progressive rendering
- All trajectory points rendered simultaneously

**Future Optimizations** (from README):
- Web Workers for parsing large files
- Streaming parsing for 300MB+ files
- LOD (Level of Detail) for trajectory
- Point culling based on zoom level

### UI State Management

**Main App State** (`main.js` FlightVisualizerApp class):
- `flightData` - Parsed flight trajectory data
- `waypointsData` - Parsed waypoints data
- `activeTab` - Current log source ('inav', 'ardupilot', 'ud')
- Scene components (sceneManager, trajectoryLine, waypointsLine, droneModel, terrainLoader)
- Controllers (cameraController, playbackController)
- UI components (telemetry, timeline)

**File Selection**:
- Separate file inputs for each log source
- Status indicators show selected files
- Load button triggers appropriate parser based on active tab

### Common Development Patterns

**Adding New Visualizations**:
1. Create class in `scene/` directory
2. Initialize in `main.js` `initVisualization()` method
3. Add to scene via `sceneManager.add(object)`
4. Dispose resources in `dispose()` and `returnToMenu()` methods

**GPS Data Processing**:
1. Parse file to extract GPS coordinates (lat, lon, alt)
2. Calculate bounds (min/max lat/lon/alt)
3. Convert GPS coordinates to local meters using `sceneManager.gpsToLocal()`
4. Create Three.js geometry with local coordinates

**Altitude Conversion Rules**:
- If altitude > 10000: divide by 100 (centimeters to meters)
- Mission Planner: divide by 1000 (millimeters to meters in parser)
- Waypoints: HOME is absolute, others are relative (add HOME altitude)

## Key Technical Details

### Three.js Setup
- Scene uses standard PerspectiveCamera
- Lighting: HemisphereLight (sky to ground) + DirectionalLight with shadows
- Grid helper and axes helper for reference
- OrbitControls for Top View mode

### Camera Modes
- **Top View**: OrbitControls, user-controlled rotation/pan/zoom
- **Follow**: Camera follows drone from behind and above, smooth lerp
- **FPV**: Camera at drone position with drone's orientation

### Telemetry Panel
- Updates in real-time during playback
- Shows GPS source (GLOBAL_POSITION_INT or GPS_RAW_INT for Mission Planner)
- Displays lat/lon, altitude, speed, roll/pitch/yaw, satellite count
- Positioned in bottom-left corner

### Visibility Controls
- Panel in left side with checkboxes
- "Показать лог" - toggles flight trajectory visibility
- "Показать миссию" - toggles waypoints visibility
- Mission toggle disabled if no waypoints loaded

## Browser Requirements

- Chrome 90+, Firefox 88+, Safari 15+, Edge 90+
- WebGL 2.0 support required
- Recommended: Modern GPU for smooth 3D rendering

## Known Issues

- Group policy may block npm/vite execution on some systems
- Large files (300MB+) may cause browser slowdown during parsing
- Line width rendering varies across browsers (WebGL limitation)

## Development Rules

### Documentation Lookup
**Always use Context7 MCP tool** when working with external libraries (Cesium.js, Three.js, Vite, etc.) to fetch up-to-date documentation. This ensures you're using current API methods and avoiding deprecated features.
