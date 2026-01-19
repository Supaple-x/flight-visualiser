import * as THREE from 'three';

/**
 * Trajectory Line - Visualizes flight path
 */
export class TrajectoryLine {
    constructor(sceneManager, flightData) {
        this.sceneManager = sceneManager;
        this.flightData = flightData;
        this.line = null;
        this.centerLat = 0;
        this.centerLon = 0;
        this.groundLevel = 0; // Ground level in local coordinates

        this.createTrajectory();
    }

    /**
     * Create trajectory line from flight data
     */
    createTrajectory() {
        if (!this.flightData || !this.flightData.points || this.flightData.points.length === 0) {
            console.error('No flight data to display');
            return;
        }

        // Calculate center point for GPS conversion
        const bounds = this.flightData.bounds;
        this.centerLat = (bounds.minLat + bounds.maxLat) / 2;
        this.centerLon = (bounds.minLon + bounds.maxLon) / 2;

        // DEBUG: Log trajectory bounds and center
        console.log('🔍 Trajectory Bounds:', {
            bounds: {
                lat: `${bounds.minLat.toFixed(6)} to ${bounds.maxLat.toFixed(6)}`,
                lon: `${bounds.minLon.toFixed(6)} to ${bounds.maxLon.toFixed(6)}`
            },
            center: {
                lat: this.centerLat.toFixed(6),
                lon: this.centerLon.toFixed(6)
            },
            firstPoint: this.flightData.points[0]?.gps
        });

        // Create geometry
        const points = [];
        const colors = [];

        // Color gradient based on altitude
        const minAlt = bounds.minAlt;
        const maxAlt = bounds.maxAlt;
        const altRange = maxAlt - minAlt;

        // Calculate ground level (use minimum altitude as reference)
        const groundPosition = this.sceneManager.gpsToLocal(
            this.centerLat,
            this.centerLon,
            minAlt,
            this.centerLat,
            this.centerLon
        );
        this.groundLevel = groundPosition.y;

        console.log('🔍 Trajectory altitude range:', {
            minAlt: minAlt.toFixed(2),
            maxAlt: maxAlt.toFixed(2),
            groundLevel: this.groundLevel.toFixed(2),
            firstPointAlt: this.flightData.points[0]?.gps?.altitude.toFixed(2),
            lastPointAlt: this.flightData.points[this.flightData.points.length - 1]?.gps?.altitude.toFixed(2)
        });

        for (const point of this.flightData.points) {
            // Convert GPS to local coordinates
            const position = this.sceneManager.gpsToLocal(
                point.gps.lat,
                point.gps.lon,
                point.gps.altitude,
                this.centerLat,
                this.centerLon
            );

            points.push(position);

            // Color gradient: Yellow (start) → Red (end)
            const progress = this.flightData.points.length > 1 ?
                this.flightData.points.indexOf(point) / (this.flightData.points.length - 1) : 0;

            const color = new THREE.Color();
            // Yellow (hue=0.16) to Red (hue=0)
            color.setHSL(0.16 - progress * 0.16, 1.0, 0.5);
            colors.push(color.r, color.g, color.b);
        }

        // Create CurvePath from points
        const curve = new THREE.CatmullRomCurve3(points);

        // Calculate scale-appropriate radius
        // For 150km map, radius should be ~50-100m to be visible
        // For 1km map, radius should be ~0.5m
        const maxDim = Math.max(
            bounds.maxLat - bounds.minLat,
            bounds.maxLon - bounds.minLon
        ) * 111320; // Convert degrees to meters approx

        const tubeRadius = Math.max(0.5, maxDim / 2000);
        console.log(`📏 Dynamic tube radius: ${tubeRadius.toFixed(2)}m (for map size ${maxDim.toFixed(0)}m)`);

        // Create TubeGeometry
        const geometry = new THREE.TubeGeometry(
            curve,
            points.length * 2, // tubularSegments
            tubeRadius, // radius (meters)
            8, // radialSegments
            false // closed
        );

        // Create Vertex Colors
        const count = geometry.attributes.position.count;
        const geometryColors = new Float32Array(count * 3);

        // We need to map colors from the curve points to the tube vertices
        // This is an approximation: we map progress along the tube to the color gradient
        for (let i = 0; i < count; i++) {
            // Calculate progress (0 to 1) based on vertex index
            // TubeGeometry generates vertices ring by ring
            // i / (radialSegments + 1) gives the ring index roughly
            const ringIndex = Math.floor(i / (8 + 1));
            const progress = ringIndex / (points.length * 2);

            const color = new THREE.Color();
            color.setHSL(0.16 - progress * 0.16, 1.0, 0.5);

            geometryColors[i * 3] = color.r;
            geometryColors[i * 3 + 1] = color.g;
            geometryColors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(geometryColors, 3));

        // Create material
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.5,
            metalness: 0.1
        });

        // Create mesh
        this.line = new THREE.Mesh(geometry, material);
        this.line.castShadow = true;
        this.line.receiveShadow = true;
        this.sceneManager.add(this.line);

        // Add start marker
        this.addMarker(points[0], 0x00ff00, 'Start');

        // Add end marker
        this.addMarker(points[points.length - 1], 0xff0000, 'End');

        // Add altitude reference markers every 50m
        this.addAltitudeMarkers(points);

        console.log(`Trajectory created with ${points.length} points (TubeGeometry)`);
    }

    /**
     * Add altitude reference markers along trajectory
     * Разрежённые метки: минимум 100м между ними, без кратности 50м
     */
    addAltitudeMarkers(points) {
        if (points.length === 0) return;

        const markerColor = 0xffff00; // Yellow
        const minDistanceBetweenMarkers = 100; // Минимум 100м между метками

        // Calculate cumulative distance along trajectory
        let cumulativeDistance = 0;
        const distances = [0];

        for (let i = 1; i < points.length; i++) {
            const distance = points[i].distanceTo(points[i - 1]);
            cumulativeDistance += distance;
            distances.push(cumulativeDistance);
        }

        // Собираем все кандидаты на метки (каждые 10 метров высоты)
        const candidates = [];
        const altitudeStep = 10; // Проверяем каждые 10м высоты

        for (let i = 1; i < points.length; i++) {
            const prevAlt = points[i - 1].y;
            const currAlt = points[i].y;

            if (Math.abs(currAlt - prevAlt) < 0.1) continue; // Пропускаем если высота не меняется

            const minAlt = Math.min(prevAlt, currAlt);
            const maxAlt = Math.max(prevAlt, currAlt);

            // Проверяем пересечения уровней высоты
            const minLevel = Math.floor(minAlt / altitudeStep) * altitudeStep;
            const maxLevel = Math.ceil(maxAlt / altitudeStep) * altitudeStep;

            for (let level = minLevel; level <= maxLevel; level += altitudeStep) {
                if (level === 0 || level < minAlt || level > maxAlt) continue;

                // Интерполируем позицию на этой высоте
                const t = (level - prevAlt) / (currAlt - prevAlt);
                const interpPoint = new THREE.Vector3().lerpVectors(points[i - 1], points[i], t);
                const interpDistance = distances[i - 1] + t * points[i].distanceTo(points[i - 1]);

                candidates.push({
                    altitude: Math.round(level),
                    point: interpPoint,
                    distance: Math.round(interpDistance)
                });
            }
        }

        // Разрежаем метки: оставляем только те, что находятся минимум в 100м друг от друга
        const selectedMarkers = [];

        for (const candidate of candidates) {
            // Проверяем расстояние до всех уже выбранных меток
            let tooClose = false;

            for (const selected of selectedMarkers) {
                const dist = candidate.point.distanceTo(selected.point);
                if (dist < minDistanceBetweenMarkers) {
                    tooClose = true;
                    break;
                }
            }

            if (!tooClose) {
                selectedMarkers.push(candidate);
            }
        }

        // Создаём метки для выбранных позиций
        selectedMarkers.forEach(marker => {
            // Create small marker sphere
            const geometry = new THREE.SphereGeometry(1, 8, 8);
            const material = new THREE.MeshBasicMaterial({
                color: markerColor,
                transparent: true,
                opacity: 0.7
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.copy(marker.point);
            sphere.userData.altitude = marker.altitude;
            this.sceneManager.add(sphere);

            // Create text sprite for altitude label with distance
            this.createAltitudeLabel(marker.point, marker.altitude, marker.distance);
        });

        console.log(`Created ${selectedMarkers.length} altitude markers (from ${candidates.length} candidates)`);
    }

    /**
     * Create altitude text label
     */
    createAltitudeLabel(position, altitude, distance) {
        // Create canvas for text
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;

        // Рисуем только белый текст (без фона и обводки)
        context.fillStyle = '#ffffff';
        context.font = 'Bold 20px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(`${altitude}m (${distance}m)`, 128, 32);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true, // Включаем depth test чтобы дальние метки скрывались
            depthWrite: false
        });

        // Create sprite
        const sprite = new THREE.Sprite(material);
        sprite.position.set(position.x, position.y + 5, position.z);
        sprite.scale.set(40, 10, 1); // Wider to fit distance text
        sprite.renderOrder = 1; // Рендерим после основной геометрии
        this.sceneManager.add(sprite);
    }

    /**
     * Add marker at position
     */
    addMarker(position, color, label) {
        // Create sphere marker (80% прозрачная)
        const geometry = new THREE.SphereGeometry(2, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.2  // 80% прозрачность = 20% непрозрачность
        });
        const marker = new THREE.Mesh(geometry, material);
        marker.position.copy(position);
        marker.userData.label = label;
        this.sceneManager.add(marker);

        // Create vertical line from ground level (not absolute zero)
        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(position.x, this.groundLevel, position.z),
            position
        ]);
        const lineMaterial = new THREE.LineBasicMaterial({
            color,
            opacity: 0.5,
            transparent: true
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);
        this.sceneManager.add(line);
    }

    /**
     * Get trajectory points
     */
    getPoints() {
        if (!this.line) return [];

        const positions = this.line.geometry.attributes.position;
        const points = [];

        for (let i = 0; i < positions.count; i++) {
            points.push(new THREE.Vector3(
                positions.getX(i),
                positions.getY(i),
                positions.getZ(i)
            ));
        }

        return points;
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.line) {
            this.line.geometry.dispose();
            this.line.material.dispose();
            this.sceneManager.remove(this.line);
        }
    }
}
