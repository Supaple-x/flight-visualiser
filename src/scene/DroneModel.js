import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Менеджер загрузки для правильной обработки путей к текстурам
const loadingManager = new THREE.LoadingManager();
loadingManager.onError = (url) => {
    console.warn(`Failed to load texture: ${url}`);
};

/**
 * Drone Model - Manages the 3D drone model
 */
export class DroneModel {
    constructor(sceneManager) {
        this.sceneManager = sceneManager;
        this.model = null;
        this.modelPath = null;
        this.currentPosition = new THREE.Vector3();
        this.currentRotation = new THREE.Euler();
        this.scale = 0.01; // Масштаб по умолчанию для FBX моделей (обычно они большие)
        this.isPlaceholder = true; // Флаг для отслеживания типа модели
        this.loadingFBX = false; // Флаг процесса загрузки
        this.highlightSphere = null; // Голубая подсветка вокруг дрона
        this.propeller = null; // Ссылка на винт для анимации
        this.propellerSpeed = 0.5; // Скорость вращения винта (радиан за кадр)
        this.propellerAxis = 'x'; // Ось вращения винта (x, y, или z) - для хвостового ротора обычно X
        this.modelRotationOffset = new THREE.Euler(Math.PI / 2, 0, 0); // Смещение ориентации модели: +90° X (нос вперёд по маршруту)

        // Создаём голубую прозрачную сферу подсветки
        this.createHighlightSphere();

        // Создаём визуальные оси для отладки ориентации
        this.createOrientationAxes();

        // Сначала создаём placeholder
        this.createPlaceholderModel();

        // Автоматически пробуем загрузить FBX модель
        this.tryLoadDefaultModel();
    }

    /**
     * Создать голубую прозрачную сферу вокруг дрона
     */
    createHighlightSphere() {
        const sphereGeo = new THREE.SphereGeometry(5, 32, 32); // Радиус 5м
        const sphereMat = new THREE.MeshBasicMaterial({
            color: 0x4a90e2, // Голубой цвет
            transparent: true,
            opacity: 0.15,   // Сильно прозрачная
            depthWrite: false, // Не пишем в depth buffer
            side: THREE.BackSide // Рендерим внутреннюю сторону для эффекта свечения
        });

        this.highlightSphere = new THREE.Mesh(sphereGeo, sphereMat);
        this.highlightSphere.renderOrder = -1; // Рендерим первой
        this.sceneManager.add(this.highlightSphere);
    }

    /**
     * Создать визуальные оси для отладки ориентации дрона
     * Красная = X (Roll), Зелёная = Y (Pitch), Синяя = Z (Yaw)
     */
    createOrientationAxes() {
        // AxesHelper: Красная = +X, Зелёная = +Y, Синяя = +Z
        this.orientationAxes = new THREE.AxesHelper(10); // Длина 10м
        this.orientationAxes.renderOrder = 999; // Рендерим поверх всего
        this.sceneManager.add(this.orientationAxes);
        console.log('📐 Orientation axes created (R=X/Roll, G=Y/Pitch, B=Z/Yaw)');
    }

    /**
     * Автоматическая попытка загрузки FBX модели по умолчанию
     */
    async tryLoadDefaultModel() {
        const defaultPath = '/models/drone.fbx';

        try {
            console.log('Attempting to load FBX drone model...');
            await this.loadFBXModel(defaultPath);
        } catch (error) {
            console.warn('FBX model not found or failed to load, using placeholder model');
            console.warn('To use a custom model, place it at: public/models/drone.fbx');
        }
    }

    /**
     * Create placeholder model (simple quad shape)
     */
    createPlaceholderModel() {
        const group = new THREE.Group();

        // Central body
        const bodyGeometry = new THREE.BoxGeometry(4, 1, 4);
        const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
        group.add(body);

        // Arms (4 arms for quadcopter)
        const armGeometry = new THREE.CylinderGeometry(0.3, 0.3, 8, 8);
        const armMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });

        for (let i = 0; i < 4; i++) {
            const arm = new THREE.Mesh(armGeometry, armMaterial);
            arm.rotation.z = Math.PI / 2;

            const angle = (i * Math.PI) / 2;
            arm.position.x = Math.cos(angle) * 4;
            arm.position.z = Math.sin(angle) * 4;

            group.add(arm);

            // Propeller (simple disc)
            const propGeometry = new THREE.CylinderGeometry(2, 2, 0.1, 16);
            const propMaterial = new THREE.MeshStandardMaterial({
                color: 0x4a90e2,
                transparent: true,
                opacity: 0.7
            });
            const prop = new THREE.Mesh(propGeometry, propMaterial);
            prop.position.x = Math.cos(angle) * 8;
            prop.position.z = Math.sin(angle) * 8;
            prop.position.y = 0.5;

            group.add(prop);
        }

        // Front indicator (red cone) - показывает направление полёта
        const noseGeometry = new THREE.ConeGeometry(0.5, 2, 8);
        const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const nose = new THREE.Mesh(noseGeometry, noseMaterial);
        nose.rotation.x = Math.PI / 2;
        nose.position.z = -3;
        group.add(nose);

        this.model = group;
        this.sceneManager.add(this.model);
        this.isPlaceholder = true;

        console.log('Placeholder drone model created');
    }

    /**
     * Load FBX model with automatic texture support
     * @param {string} path - Путь к FBX файлу (например: '/models/drone.fbx')
     * @param {number} targetSize - Желаемый размер модели в метрах (по умолчанию 2-3м)
     */
    async loadFBXModel(path, targetSize = 2.5) {
        // Предотвращаем множественные одновременные загрузки
        if (this.loadingFBX) {
            console.warn('Model loading already in progress');
            return;
        }

        this.loadingFBX = true;

        return new Promise((resolve, reject) => {
            const loader = new FBXLoader(loadingManager);

            loader.load(
                path,
                (fbx) => {
                    // Сохраняем текущую позицию и ориентацию
                    const currentPos = this.currentPosition.clone();
                    const currentRot = this.currentRotation.clone();

                    // Удаляем предыдущую модель (placeholder или старую FBX)
                    if (this.model) {
                        this.sceneManager.remove(this.model);
                        this.disposeModel(this.model);
                    }

                    // Вычисляем bounding box для автоматического масштабирования
                    const box = new THREE.Box3().setFromObject(fbx);
                    const size = box.getSize(new THREE.Vector3());
                    const maxDim = Math.max(size.x, size.y, size.z);

                    // Вычисляем масштаб для достижения targetSize
                    const autoScale = targetSize / maxDim;

                    // Центрируем модель относительно её геометрии
                    const center = box.getCenter(new THREE.Vector3());
                    fbx.position.sub(center);

                    // Оборачиваем в Group для корректного управления позицией
                    const modelGroup = new THREE.Group();
                    modelGroup.add(fbx);

                    // Применяем масштаб
                    // Если был установлен кастомный scale через setScale(), используем его
                    const finalScale = (this.scale && this.scale > 1) ? this.scale : autoScale;
                    modelGroup.scale.set(finalScale, finalScale, finalScale);
                    console.log(`  📏 Final model scale: ${finalScale.toFixed(2)} (auto=${autoScale.toFixed(4)}, custom=${this.scale})`);

                    // Обновляем размер сферы подсветки
                    if (this.highlightSphere) {
                        const sphereScale = finalScale / autoScale * 2; // пропорционально размеру модели
                        this.highlightSphere.scale.set(sphereScale, sphereScale, sphereScale);
                        console.log(`  🔵 Highlight sphere scaled: ${sphereScale.toFixed(2)}`);
                    }

                    // Обновляем длину осей ориентации
                    if (this.orientationAxes) {
                        const axesScale = finalScale * 2;
                        this.orientationAxes.scale.set(axesScale, axesScale, axesScale);
                    }

                    // Загружаем текстуры вручную из папки /Textures/
                    const textureLoader = new THREE.TextureLoader();
                    const texturesToLoad = [
                        { key: 'TP_1_02_BC', path: '/Textures/TP_1_02/T_TP-1_02_BC.png' },
                        { key: 'TP_1_02_N', path: '/Textures/TP_1_02/T_TP-1_02_N.png' },
                        { key: 'TP_1_02_ORM', path: '/Textures/TP_1_02/T_TP-1_02_ORM.png' },
                        { key: 'TP_1_01_BC', path: '/Textures/TP-1_01/T_TP-1_01_BC.png' },
                        { key: 'TP_1_01_N', path: '/Textures/TP-1_01/T_TP-1_01_N.png' },
                        { key: 'TP_1_01_ORM', path: '/Textures/TP-1_01/T_TP-1_01_ORM.png' }
                    ];

                    const loadedTextures = {};
                    const texturePromises = texturesToLoad.map(({ key, path }) => {
                        return new Promise((resolve) => {
                            textureLoader.load(
                                path,
                                (texture) => {
                                    // ВАЖНО: Дожидаемся полной загрузки изображения
                                    const waitForImage = () => {
                                        if (texture.image && texture.image.complete && texture.image.width > 0) {
                                            // Base Color (BC) текстуры используют SRGB, остальные - Linear
                                            if (key.includes('BC')) {
                                                texture.colorSpace = THREE.SRGBColorSpace;
                                            } else {
                                                texture.colorSpace = THREE.LinearSRGBColorSpace;
                                            }

                                            // ВАЖНО: Unreal Engine экспортирует с перевёрнутыми V координатами!
                                            texture.flipY = true;
                                            // Используем ClampToEdge чтобы текстура не повторялась (может вызывать полосы)
                                            texture.wrapS = THREE.ClampToEdgeWrapping;
                                            texture.wrapT = THREE.ClampToEdgeWrapping;
                                            // Включаем фильтрацию для сглаживания
                                            texture.minFilter = THREE.LinearMipmapLinearFilter;
                                            texture.magFilter = THREE.LinearFilter;
                                            texture.anisotropy = 4; // Анизотропная фильтрация
                                            texture.generateMipmaps = true;
                                            texture.needsUpdate = true;

                                            loadedTextures[key] = texture;
                                            console.log(`  ✓ Загружена текстура: ${key} (${texture.image.width}x${texture.image.height})`);
                                            resolve();
                                        } else {
                                            // Ждём ещё немного
                                            setTimeout(waitForImage, 10);
                                        }
                                    };

                                    waitForImage();
                                },
                                undefined,
                                (error) => {
                                    console.warn(`  ⚠ Не удалось загрузить текстуру ${key}: ${error.message || error}`);
                                    resolve(); // Не блокируем загрузку модели
                                }
                            );
                        });
                    });

                    // Ждём загрузки текстур перед применением
                    Promise.all(texturePromises).then(() => {
                        console.log(`  ✅ Загружено ${Object.keys(loadedTextures).length} текстур, применяем к материалам...`);

                        // Настраиваем тени и материалы
                        fbx.traverse((child) => {
                            if (child.isMesh) {
                                child.castShadow = true;
                                child.receiveShadow = true;
                                child.frustumCulled = false;

                                // Проверяем UV координаты
                                if (child.geometry) {
                                    const hasUV = !!child.geometry.attributes.uv;
                                    const hasUV2 = !!child.geometry.attributes.uv2;
                                    console.log(`  📐 Geometry UV: ${hasUV}, UV2: ${hasUV2}, vertices: ${child.geometry.attributes.position?.count}`);

                                    if (hasUV) {
                                        const uvArray = child.geometry.attributes.uv.array;
                                        console.log(`    - UV канал: первые 6 значений = [${uvArray.slice(0, 6).join(', ')}]`);
                                    }

                                    // Добавляем UV2 для ambient occlusion (если нет)
                                    if (!child.geometry.attributes.uv2 && hasUV) {
                                        child.geometry.setAttribute('uv2', child.geometry.attributes.uv);
                                    }

                                    // Явно помечаем геометрию для обновления
                                    child.geometry.attributes.uv.needsUpdate = true;
                                }

                                if (child.material) {
                                    const materials = Array.isArray(child.material)
                                        ? child.material
                                        : [child.material];

                                    materials.forEach((material, idx) => {
                                        // DEBUG: Информация о материале
                                        console.log(`  🔍 Найден материал: "${material.name}" (тип: ${material.type})`);

                                        // Конвертируем MeshPhongMaterial в MeshStandardMaterial для поддержки PBR текстур
                                        if (material.type === 'MeshPhongMaterial') {
                                            const oldMaterial = material;
                                            console.log(`    - Старые значения: цвет #${oldMaterial.color.getHexString()}, свечение #${oldMaterial.emissive.getHexString()}`);

                                            const newMaterial = new THREE.MeshStandardMaterial({
                                                name: oldMaterial.name,
                                                // Используем нейтральный цвет для поддержки текстур (белый умножается на текстуру)
                                                color: 0xffffff,
                                                emissive: 0x000000, // Без эмиссии
                                                side: oldMaterial.side,
                                                transparent: oldMaterial.transparent,
                                                opacity: oldMaterial.opacity,
                                                // Настройки по умолчанию для PBR (будут переопределены картами)
                                                roughness: 0.8,
                                                metalness: 0.2
                                            });

                                            // Заменяем материал
                                            if (Array.isArray(child.material)) {
                                                child.material[idx] = newMaterial;
                                            } else {
                                                child.material = newMaterial;
                                            }
                                            material = newMaterial;
                                            console.log(`  🔄 Конвертирован в MeshStandardMaterial`);
                                        }

                                        // Удаляем старую сломанную текстуру
                                        if (material.map && material.map.image && !material.map.image.complete) {
                                            material.map.dispose();
                                            material.map = null;
                                        }

                                        // Применяем загруженные текстуры по имени материала
                                        const matName = material.name ? material.name.toLowerCase() : '';

                                        if (matName.includes('tp_1_02') || matName.includes('tp-1_02')) {
                                            if (loadedTextures['TP_1_02_BC']) {
                                                const bcTex = loadedTextures['TP_1_02_BC'];

                                                // Проверяем что изображение действительно загружено
                                                if (bcTex.image && bcTex.image.width > 0 && bcTex.image.height > 0) {
                                                    // Применяем базовую цветную текстуру
                                                    material.map = bcTex;
                                                    material.map.needsUpdate = true;

                                                    // Normal map
                                                    if (loadedTextures['TP_1_02_N']) {
                                                        material.normalMap = loadedTextures['TP_1_02_N'];
                                                        material.normalMap.needsUpdate = true;
                                                    }

                                                    // ORM = Occlusion + Roughness + Metalness в одной текстуре (Unreal Engine формат)
                                                    // R = Ambient Occlusion, G = Roughness, B = Metallic
                                                    const ormTex = loadedTextures['TP_1_02_ORM'];
                                                    if (ormTex) {
                                                        ormTex.needsUpdate = true;
                                                        material.aoMap = ormTex;
                                                        material.roughnessMap = ormTex;
                                                        material.metalnessMap = ormTex;
                                                        material.aoMapIntensity = 1.0;
                                                    }

                                                    console.log(`  ✓ Применены текстуры TP_1_02 к "${material.name}"`);
                                                    console.log(`    - BC: ${bcTex.image.width}x${bcTex.image.height}px, Normal: ${!!material.normalMap}, ORM: ${!!ormTex}`);
                                                } else {
                                                    console.error(`  ❌ Текстура TP_1_02_BC загружена, но изображение невалидно!`, bcTex.image);
                                                }
                                            } else {
                                                console.warn(`  ⚠ TP_1_02 textures not loaded!`);
                                            }
                                        } else if (matName.includes('tp_1_01') || matName.includes('tp-1_01')) {
                                            if (loadedTextures['TP_1_01_BC']) {
                                                const bcTex = loadedTextures['TP_1_01_BC'];

                                                // Проверяем что изображение действительно загружено
                                                if (bcTex.image && bcTex.image.width > 0 && bcTex.image.height > 0) {
                                                    // Применяем базовую цветную текстуру
                                                    material.map = bcTex;
                                                    material.map.needsUpdate = true;

                                                    // Normal map
                                                    if (loadedTextures['TP_1_01_N']) {
                                                        material.normalMap = loadedTextures['TP_1_01_N'];
                                                        material.normalMap.needsUpdate = true;
                                                    }

                                                    // ORM = Occlusion + Roughness + Metalness в одной текстуре (Unreal Engine формат)
                                                    // R = Ambient Occlusion, G = Roughness, B = Metallic
                                                    const ormTex = loadedTextures['TP_1_01_ORM'];
                                                    if (ormTex) {
                                                        ormTex.needsUpdate = true;
                                                        material.aoMap = ormTex;
                                                        material.roughnessMap = ormTex;
                                                        material.metalnessMap = ormTex;
                                                        material.aoMapIntensity = 1.0;
                                                    }

                                                    console.log(`  ✓ Применены текстуры TP_1_01 к "${material.name}"`);
                                                    console.log(`    - BC: ${bcTex.image.width}x${bcTex.image.height}px, Normal: ${!!material.normalMap}, ORM: ${!!ormTex}`);
                                                } else {
                                                    console.error(`  ❌ Текстура TP_1_01_BC загружена, но изображение невалидно!`, bcTex.image);
                                                }
                                            } else {
                                                console.warn(`  ⚠ TP_1_01 textures not loaded!`);
                                            }
                                        } else {
                                            // Если не можем определить - применяем первую доступную
                                            if (Object.keys(loadedTextures).length > 0) {
                                                const firstBC = loadedTextures['TP_1_02_BC'] || loadedTextures['TP_1_01_BC'];
                                                if (firstBC && firstBC.image && firstBC.image.width > 0) {
                                                    material.map = firstBC;
                                                    material.normalMap = loadedTextures['TP_1_02_N'] || loadedTextures['TP_1_01_N'];
                                                    material.aoMap = loadedTextures['TP_1_02_ORM'] || loadedTextures['TP_1_01_ORM'];
                                                    material.roughnessMap = loadedTextures['TP_1_02_ORM'] || loadedTextures['TP_1_01_ORM'];
                                                    material.metalnessMap = loadedTextures['TP_1_02_ORM'] || loadedTextures['TP_1_01_ORM'];
                                                    console.warn(`  ⚠ Material "${material.name}": applied default texture (unknown material name)`);
                                                } else {
                                                    console.error(`  ❌ No valid textures available for "${material.name}"`);
                                                }
                                            }
                                        }

                                        // Настройки материала
                                        material.side = THREE.DoubleSide;
                                        material.depthWrite = true;
                                        material.depthTest = true;

                                        if (material.transparent && material.opacity < 0.1) {
                                            material.transparent = false;
                                            material.opacity = 1.0;
                                        }

                                        // Настройки для работы с картами roughness и metalness
                                        // Карты умножаются на эти базовые значения
                                        if (material.roughnessMap) {
                                            material.roughness = 1.0; // Полная интенсивность карты
                                        } else {
                                            material.roughness = 0.5; // Значение по умолчанию если нет карты
                                        }

                                        if (material.metalnessMap) {
                                            material.metalness = 1.0; // Полная интенсивность карты
                                        } else {
                                            material.metalness = 0.1; // Значение по умолчанию если нет карты
                                        }

                                        // Убедимся, что цвет не перебивает текстуру (белый = нейтральный множитель)
                                        if (material.map) {
                                            material.color.setHex(0xffffff);
                                        }

                                        // DEBUG: Итоговое состояние материала
                                        console.log(`    📊 Итоговое состояние материала:`, {
                                            цвет: material.color ? '#' + material.color.getHexString() : 'нет',
                                            базоваяТекстура: !!material.map,
                                            нормаль: !!material.normalMap,
                                            AO: !!material.aoMap,
                                            шероховатость: material.roughness,
                                            металличность: material.metalness
                                        });

                                        material.needsUpdate = true;
                                    });
                                } else {
                                    // Создаём материал с текстурой
                                    child.material = new THREE.MeshStandardMaterial({
                                        map: loadedTextures['TP_1_02_BC'] || null,
                                        normalMap: loadedTextures['TP_1_02_N'] || null,
                                        color: 0xcccccc,
                                        side: THREE.DoubleSide,
                                        metalness: 0.5,
                                        roughness: 0.5
                                    });
                                    console.warn('  Created default material with texture');
                                }
                            }
                        });

                        console.log(`  ✅ Все материалы обработаны и текстуры применены`);

                        // ВАЖНО: Явно обновляем все материалы после установки текстур
                        fbx.traverse((child) => {
                            if (child.isMesh && child.material) {
                                const materials = Array.isArray(child.material) ? child.material : [child.material];
                                materials.forEach(mat => {
                                    mat.needsUpdate = true;
                                });
                            }
                        });

                        console.log(`  🔄 Все материалы помечены для обновления`);
                    });

                    // Устанавливаем новую модель
                    this.model = modelGroup;
                    this.modelPath = path;
                    this.isPlaceholder = false;

                    // Восстанавливаем позицию и ориентацию
                    this.model.position.copy(currentPos);
                    this.model.rotation.copy(currentRot);

                    // Убедимся что модель видима
                    this.model.visible = true;

                    // Добавляем в сцену
                    this.sceneManager.add(this.model);

                    this.loadingFBX = false;

                    console.log(`✓ FBX model loaded successfully from: ${path}`);
                    console.log(`  Size: ${maxDim.toFixed(2)}m → ${targetSize}m (scale: ${autoScale.toFixed(4)})`);

                    // Считаем mesh и vertices
                    let meshCount = 0;
                    let totalVertices = 0;
                    this.model.traverse((child) => {
                        if (child.isMesh) {
                            meshCount++;
                            if (child.geometry && child.geometry.attributes.position) {
                                totalVertices += child.geometry.attributes.position.count;
                            }
                        }
                    });
                    console.log(`  Geometry: ${meshCount} meshes, ${totalVertices.toLocaleString()} vertices`);

                    // Find propeller for animation
                    this.findPropeller();

                    // Для debug можно раскомментировать:
                    // this.addDebugHelpers();
                    // this.printTextureInfo();

                    resolve(this.model);
                },
                (progress) => {
                    if (progress.total > 0) {
                        const percent = (progress.loaded / progress.total * 100).toFixed(1);
                        console.log(`Loading model: ${percent}% (${progress.loaded}/${progress.total} bytes)`);
                    }
                },
                (error) => {
                    this.loadingFBX = false;
                    console.error('✗ Error loading FBX model:', error);

                    // Если модели нет, убеждаемся что placeholder остался
                    if (!this.model || !this.model.parent) {
                        console.log('Falling back to placeholder model');
                        this.createPlaceholderModel();
                    }

                    reject(error);
                }
            );
        });
    }

    /**
     * Update drone position and rotation
     * @param {THREE.Vector3} position - Current position
     * @param {Object} attitude - Attitude data (roll, pitch, yaw in decidegrees)
     * @param {THREE.Vector3} nextPosition - Optional next position for heading calculation
     */
    update(position, attitude, nextPosition = null) {
        if (!this.model) return;

        // Update position
        this.currentPosition.copy(position);
        this.model.position.copy(position);

        let yaw, pitch, roll;

        // If we have next position, calculate heading towards it
        if (nextPosition && !position.equals(nextPosition)) {
            // Calculate direction vector
            const direction = new THREE.Vector3().subVectors(nextPosition, position);

            // Calculate yaw (heading) from direction
            yaw = Math.atan2(direction.x, -direction.z);

            // Calculate pitch from altitude difference
            const horizontalDist = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
            pitch = Math.atan2(direction.y, horizontalDist) * 0.3; // Reduce pitch effect

            roll = 0; // No roll for waypoint navigation
        } else {
            // Use attitude data (convert from INAV decidegrees to radians)
            roll = (attitude.roll / 10) * (Math.PI / 180);
            pitch = (attitude.pitch / 10) * (Math.PI / 180);
            yaw = (attitude.yaw / 10) * (Math.PI / 180);
        }

        // Apply rotation: first model offset (to orient the model correctly),
        // then navigation rotation (yaw to face direction)
        //
        // Strategy: Apply yaw offset separately, then combine with pitch adjustment

        // Adjust yaw by model's Y offset (model's forward direction relative to nav forward)
        const yawOffset = this.modelRotationOffset.y;
        const adjustedYaw = yaw + yawOffset;

        // Create navigation rotation with adjusted yaw
        const navRotation = new THREE.Euler(pitch, adjustedYaw, roll, 'YXZ');
        const navQuat = new THREE.Quaternion().setFromEuler(navRotation);

        // Apply X and Z offset separately (model tilt correction)
        const tiltOffset = new THREE.Euler(this.modelRotationOffset.x, 0, this.modelRotationOffset.z);
        const tiltQuat = new THREE.Quaternion().setFromEuler(tiltOffset);

        // Combine: first tilt the model, then apply navigation (with yaw offset already included)
        navQuat.multiply(tiltQuat);

        // Apply combined rotation
        this.model.quaternion.copy(navQuat);
        this.currentRotation.setFromQuaternion(navQuat);

        // Animate propeller
        this.animatePropeller();

        // Обновляем позицию голубой сферы подсветки
        if (this.highlightSphere) {
            this.highlightSphere.position.copy(position);
        }

        // Обновляем позицию и ротацию визуальных осей
        if (this.orientationAxes) {
            this.orientationAxes.position.copy(position);
            this.orientationAxes.rotation.copy(this.currentRotation);
        }

        // Обновляем debug helpers если они есть
        if (this.debugHelpers && this.debugHelpers.length > 0) {
            // Обновляем позицию сферы и осей
            if (this.debugHelpers[0]) { // Сфера
                this.debugHelpers[0].position.copy(position);
            }
            if (this.debugHelpers[1]) { // Оси
                this.debugHelpers[1].position.copy(position);
                this.debugHelpers[1].rotation.copy(this.currentRotation);
            }
            if (this.debugHelpers[2]) { // Bounding box
                const box = new THREE.Box3().setFromObject(this.model);
                this.debugHelpers[2].box = box;
            }
        }
    }

    /**
     * Set model scale
     * @param {number} scale - Масштаб модели
     */
    setScale(scale) {
        this.scale = scale;
        console.log(`📏 DroneModel.setScale(${scale.toFixed(2)})`);
        if (this.model) {
            this.model.scale.set(scale, scale, scale);
        }
        // Также масштабируем сферу подсветки и оси
        if (this.highlightSphere) {
            const sphereScale = scale * 0.8;
            this.highlightSphere.scale.set(sphereScale, sphereScale, sphereScale);
        }
        if (this.orientationAxes) {
            const axesScale = scale * 2;
            this.orientationAxes.scale.set(axesScale, axesScale, axesScale);
        }
    }

    /**
     * Find and store reference to propeller mesh for animation
     */
    findPropeller() {
        if (!this.model) return;

        // First, list all mesh names for debugging
        const meshNames = [];
        this.model.traverse((child) => {
            if (child.isMesh) {
                meshNames.push(child.name || 'unnamed');
            }
        });
        console.log('🔍 Model mesh names:', meshNames.join(', '));

        this.model.traverse((child) => {
            if (child.isMesh) {
                const name = child.name.toLowerCase();
                // Look for propeller, rotor, blade, vint, винт in mesh name
                if (name.includes('propeller') || name.includes('rotor') ||
                    name.includes('blade') || name.includes('prop') ||
                    name.includes('vint') || name.includes('винт') || name.includes('лопасть')) {
                    this.propeller = child;
                    console.log(`🚁 Found propeller: "${child.name}"`);
                }
            }
        });

        // If not found by name, try to find by geometry (small cylindrical objects)
        if (!this.propeller) {
            this.model.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    const box = new THREE.Box3().setFromObject(child);
                    const size = box.getSize(new THREE.Vector3());
                    // Propeller is typically flat (one dimension much smaller)
                    const minDim = Math.min(size.x, size.y, size.z);
                    const maxDim = Math.max(size.x, size.y, size.z);
                    if (minDim < maxDim * 0.1 && !this.propeller) {
                        // Check if it's positioned at the tail (negative Z in local coords)
                        if (child.position.z < -0.3 || child.name.toLowerCase().includes('tail')) {
                            this.propeller = child;
                            console.log(`🚁 Found propeller by shape: "${child.name}"`);
                        }
                    }
                }
            });
        }

        if (!this.propeller) {
            console.log('⚠️ Propeller not found in model. Use droneModel.setPropellerByName("meshName") to set manually.');
        }
    }

    /**
     * Manually set propeller by mesh name
     * @param {string} meshName - Name of the mesh to use as propeller
     */
    setPropellerByName(meshName) {
        if (!this.model) return;

        this.model.traverse((child) => {
            if (child.isMesh && child.name === meshName) {
                this.propeller = child;
                console.log(`🚁 Propeller manually set: "${child.name}"`);
            }
        });
    }

    /**
     * Animate propeller rotation
     */
    animatePropeller() {
        if (this.propeller) {
            // Rotate around the configured axis
            switch (this.propellerAxis) {
                case 'x':
                    this.propeller.rotation.x += this.propellerSpeed;
                    break;
                case 'y':
                    this.propeller.rotation.y += this.propellerSpeed;
                    break;
                case 'z':
                default:
                    this.propeller.rotation.z += this.propellerSpeed;
                    break;
            }
        }
    }

    /**
     * Set propeller rotation axis
     * @param {string} axis - 'x', 'y', or 'z'
     */
    setPropellerAxis(axis) {
        this.propellerAxis = axis;
        console.log(`🚁 Propeller axis set to: ${axis}`);
    }

    /**
     * Set propeller animation speed
     * @param {number} speed - Rotation speed in radians per frame
     */
    setPropellerSpeed(speed) {
        this.propellerSpeed = speed;
        console.log(`🚁 Propeller speed set to: ${speed}`);
    }

    /**
     * Set model rotation offset (to correct model's default orientation)
     * @param {number} x - X rotation in degrees
     * @param {number} y - Y rotation in degrees
     * @param {number} z - Z rotation in degrees
     */
    setModelRotationOffset(x, y, z) {
        this.modelRotationOffset.set(
            x * Math.PI / 180,
            y * Math.PI / 180,
            z * Math.PI / 180
        );
        console.log(`📐 Model rotation offset set to: (${x}°, ${y}°, ${z}°)`);
    }

    /**
     * Ручная загрузка FBX модели с пользовательским путём
     * @param {string} path - Путь к FBX файлу
     * @param {number} targetSize - Желаемый размер модели в метрах
     */
    async loadCustomModel(path, targetSize = 2.5) {
        try {
            await this.loadFBXModel(path, targetSize);
            console.log('Custom model loaded successfully');
        } catch (error) {
            console.error('Failed to load custom model:', error);
            throw error;
        }
    }

    /**
     * Get current position
     */
    getPosition() {
        return this.currentPosition.clone();
    }

    /**
     * Get current rotation
     */
    getRotation() {
        return this.currentRotation.clone();
    }

    /**
     * Show/hide model
     */
    setVisible(visible) {
        if (this.model) {
            this.model.visible = visible;
        }
    }

    /**
     * Add debug helpers to visualize model position and orientation
     */
    addDebugHelpers() {
        if (!this.model) return;

        // Удаляем старые helpers если есть
        if (this.debugHelpers) {
            this.debugHelpers.forEach(helper => {
                this.sceneManager.remove(helper);
            });
        }
        this.debugHelpers = [];

        // 1. Яркая сфера на позиции модели
        const sphereGeo = new THREE.SphereGeometry(3, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.7,
            depthTest: false
        });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.copy(this.model.position);
        this.sceneManager.add(sphere);
        this.debugHelpers.push(sphere);

        // 2. Оси координат (XYZ)
        const axesHelper = new THREE.AxesHelper(10);
        axesHelper.position.copy(this.model.position);
        this.sceneManager.add(axesHelper);
        this.debugHelpers.push(axesHelper);

        // 3. Bounding Box Helper
        const box = new THREE.Box3().setFromObject(this.model);
        const boxHelper = new THREE.Box3Helper(box, 0x00ff00);
        this.sceneManager.add(boxHelper);
        this.debugHelpers.push(boxHelper);

        console.log('  🔍 Debug helpers added (pink sphere + axes + bounding box)');
    }

    /**
     * Remove debug helpers
     */
    removeDebugHelpers() {
        if (this.debugHelpers) {
            this.debugHelpers.forEach(helper => {
                this.sceneManager.remove(helper);
            });
            this.debugHelpers = [];
            console.log('Debug helpers removed');
        }
    }

    /**
     * Toggle wireframe mode for debugging
     */
    toggleWireframe() {
        if (!this.model) return;

        this.model.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material];

                materials.forEach(mat => {
                    mat.wireframe = !mat.wireframe;
                    mat.needsUpdate = true;
                });
            }
        });

        console.log('Wireframe mode toggled');
    }

    /**
     * Показать/скрыть оси ориентации
     */
    toggleOrientationAxes() {
        if (this.orientationAxes) {
            this.orientationAxes.visible = !this.orientationAxes.visible;
            console.log('📐 Orientation axes:', this.orientationAxes.visible ? 'VISIBLE' : 'HIDDEN');
        }
    }

    /**
     * Print detailed texture and material information
     */
    printTextureInfo() {
        if (!this.model) {
            console.log('No model loaded');
            return;
        }

        console.log('=== TEXTURE AND MATERIAL INFO ===');

        let meshIndex = 0;
        this.model.traverse((child) => {
            if (child.isMesh) {
                console.log(`\nMesh ${meshIndex}: ${child.name || 'unnamed'}`);

                const materials = Array.isArray(child.material)
                    ? child.material
                    : [child.material];

                materials.forEach((mat, matIndex) => {
                    console.log(`  Material ${matIndex}:`, {
                        type: mat.type,
                        color: mat.color ? '#' + mat.color.getHexString() : 'none',

                        // Текстуры
                        hasColorMap: !!mat.map,
                        colorMapSrc: mat.map ? mat.map.image?.currentSrc || mat.map.image?.src : 'none',

                        hasNormalMap: !!mat.normalMap,
                        normalMapSrc: mat.normalMap ? mat.normalMap.image?.currentSrc : 'none',

                        hasMetalnessMap: !!mat.metalnessMap,
                        hasRoughnessMap: !!mat.roughnessMap,

                        // Свойства
                        metalness: mat.metalness,
                        roughness: mat.roughness,
                        transparent: mat.transparent,
                        opacity: mat.opacity,
                        side: mat.side === THREE.FrontSide ? 'FrontSide' :
                              mat.side === THREE.BackSide ? 'BackSide' : 'DoubleSide'
                    });
                });

                meshIndex++;
            }
        });

        console.log(`\nTotal meshes: ${meshIndex}`);
    }

    /**
     * Dispose model resources
     */
    disposeModel(object) {
        object.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => material.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.model) {
            this.sceneManager.remove(this.model);
            this.disposeModel(this.model);
            this.model = null;
        }
    }
}
