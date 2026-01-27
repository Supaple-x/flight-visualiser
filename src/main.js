import * as THREE from 'three';

// Cesium CSS (required for Cesium widgets)
import 'cesium/Build/Cesium/Widgets/widgets.css';

import { InavLogParser } from './parsers/inavLogParser.js';
import { DualLogParser } from './parsers/dualLogParser.js';
import { MissionPlannerParser } from './parsers/missionPlannerParser.js';
import { WaypointsParser } from './parsers/waypointsParser.js';
import { DenisLogParser } from './parsers/denisLogParser.js';
import { MigachevParser } from './parsers/migachevParser.js';
import { MissionWaypointsParser } from './parsers/missionWaypointsParser.js';

// Cesium.js imports (new high-quality terrain visualization)
import { CesiumViewer } from './cesium/CesiumViewer.js';
import { TrajectoryEntity } from './cesium/TrajectoryEntity.js';
import { WaypointsEntity } from './cesium/WaypointsEntity.js';
import { DroneEntity } from './cesium/DroneEntity.js';
import { CesiumCameraController } from './cesium/CesiumCameraController.js';

// Legacy Three.js imports (fallback)
import { SceneManager } from './scene/SceneManager.js';
import { TrajectoryLine } from './scene/TrajectoryLine.js';
import { WaypointsLine } from './scene/WaypointsLine.js';
import { DroneModel } from './scene/DroneModel.js';
import { TerrainLoader } from './scene/TerrainLoader.js';
import { CameraController } from './controls/CameraController.js';

import { PlaybackController } from './controls/PlaybackController.js';
import { Telemetry } from './ui/Telemetry.js';
import { Timeline } from './ui/Timeline.js';

// Make THREE available globally for other modules
window.THREE = THREE;

// Use Cesium by default (set to false for legacy Three.js mode)
const USE_CESIUM = true;

console.log('%c✅ main-debug.js loaded!', 'color: green; font-size: 16px; font-weight: bold');
console.log('Three.js version:', THREE.REVISION);

/**
 * Main Application Class - DEBUG VERSION
 */
class FlightVisualizerApp {
    constructor() {
        console.log('📱 FlightVisualizerApp constructor called');

        // State
        this.flightData = null;
        this.waypointsData = null;
        this.missionEvents = null;  // SERVO, CAMERA events
        this.useCesium = USE_CESIUM;

        // Cesium components (new)
        this.cesiumViewer = null;
        this.trajectoryEntity = null;
        this.waypointsEntity = null;
        this.droneEntity = null;
        this.cesiumCameraController = null;

        // Three.js components (legacy fallback)
        this.sceneManager = null;
        this.trajectoryLine = null;
        this.waypointsLine = null;
        this.droneModel = null;
        this.terrainLoader = null;
        this.cameraController = null;

        // Shared
        this.playbackController = null;
        this.telemetry = null;
        this.timeline = null;

        // UI Elements
        this.dropZone = document.getElementById('dropZone');
        this.gpsFileInput = document.getElementById('gpsFileInput');
        this.fullLogFileInput = document.getElementById('fullLogFileInput');
        this.gpsFileStatus = document.getElementById('gpsFileStatus');
        this.fullLogFileStatus = document.getElementById('fullLogFileStatus');
        this.loadButton = document.getElementById('loadButton');

        // Ardupilot UI elements
        this.txtLogFileInput = document.getElementById('txtLogFileInput');
        this.waypointsFileInput = document.getElementById('waypointsFileInput');
        this.txtLogFileStatus = document.getElementById('txtLogFileStatus');
        this.waypointsFileStatus = document.getElementById('waypointsFileStatus');
        this.loadButtonArdupilot = document.getElementById('loadButtonArdupilot');

        // Denis (UD) UI elements
        this.datFileInput = document.getElementById('datFileInput');
        this.datFileStatus = document.getElementById('datFileStatus');
        this.loadButtonDenis = document.getElementById('loadButtonDenis');

        // Мигачев_1 UI elements
        this.migachevFileInput = document.getElementById('migachevFileInput');
        this.migachevFileStatus = document.getElementById('migachevFileStatus');
        this.loadButtonMigachev = document.getElementById('loadButtonMigachev');

        this.canvasContainer = document.getElementById('canvas-container');
        this.canvas = document.getElementById('scene');
        this.progressBar = document.getElementById('progressBar');
        this.progressText = document.getElementById('progressText');
        this.progressContainer = document.getElementById('progress');
        this.exitButton = document.getElementById('exitButton');

        // File state
        this.selectedGpsFile = null;
        this.selectedFullLogFile = null;
        this.selectedTxtLogFile = null;
        this.selectedWaypointsFile = null;
        this.selectedDatFile = null;
        this.selectedMigachevFile = null;

        // Active tab state
        this.activeTab = 'inav';

        console.log('📦 UI Elements:', {
            dropZone: !!this.dropZone,
            gpsFileInput: !!this.gpsFileInput,
            fullLogFileInput: !!this.fullLogFileInput,
            canvas: !!this.canvas
        });

        this.init();
    }

    init() {
        console.log('🔧 Initializing app...');
        this.setupTabs();
        this.setupFileUpload();
        this.setupCameraButtons();
        this.setupExitButton();
        this.setupMapControls();
        console.log('✅ App initialized');
    }

    setupTabs() {
        console.log('📑 Setting up tabs...');

        const tabs = document.querySelectorAll('.log-tab');
        const tabContents = {
            'inav': document.getElementById('inavTabContent'),
            'ardupilot': document.getElementById('ardupilotTabContent'),
            'ud': document.getElementById('udTabContent'),
            'migachev': document.getElementById('migachevTabContent')
        };

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabType = tab.dataset.tab;
                console.log('📑 Switching to tab:', tabType);

                // Update active tab
                tabs.forEach(t => t.classList.remove('log-tab--active'));
                tab.classList.add('log-tab--active');

                // Update active content
                Object.keys(tabContents).forEach(key => {
                    if (key === tabType) {
                        tabContents[key]?.classList.add('tab-content--active');
                    } else {
                        tabContents[key]?.classList.remove('tab-content--active');
                    }
                });

                // Update active tab state
                this.activeTab = tabType;
            });
        });

        console.log('✅ Tabs set up');
    }

    setupFileUpload() {
        console.log('📂 Setting up file upload handlers...');

        // GPS file input
        const gpsLabel = this.gpsFileInput.closest('.file-label');
        gpsLabel?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.gpsFileInput.click();
        });

        this.gpsFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 GPS file selected:', file.name);
                this.selectedGpsFile = file;
                this.gpsFileStatus.textContent = file.name;
                this.gpsFileStatus.classList.add('file-selected');
                this.updateLoadButton();
            }
        });

        // Full log file input
        const fullLogLabel = this.fullLogFileInput.closest('.file-label');
        fullLogLabel?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.fullLogFileInput.click();
        });

        this.fullLogFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 Full log file selected:', file.name);
                this.selectedFullLogFile = file;
                this.fullLogFileStatus.textContent = file.name;
                this.fullLogFileStatus.classList.add('file-selected');
                this.updateLoadButton();
            }
        });

        // Load button
        this.loadButton?.addEventListener('click', () => {
            this.loadFiles();
        });

        // ===== Ardupilot file inputs =====

        // TXT Log file input
        const txtLogLabel = this.txtLogFileInput?.closest('.file-label');
        txtLogLabel?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.txtLogFileInput.click();
        });

        this.txtLogFileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 TXT Log file selected:', file.name);
                this.selectedTxtLogFile = file;
                this.txtLogFileStatus.textContent = file.name;
                this.txtLogFileStatus.classList.add('file-selected');
                this.updateLoadButtonArdupilot();
            }
        });

        // Waypoints file input
        const waypointsLabel = this.waypointsFileInput?.closest('.file-label');
        waypointsLabel?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.waypointsFileInput.click();
        });

        this.waypointsFileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 Waypoints file selected:', file.name);
                this.selectedWaypointsFile = file;
                this.waypointsFileStatus.textContent = file.name;
                this.waypointsFileStatus.classList.add('file-selected');
                this.updateLoadButtonArdupilot();
            }
        });

        // Load button for Ardupilot
        this.loadButtonArdupilot?.addEventListener('click', () => {
            this.loadFilesArdupilot();
        });

        // ===== Denis (UD) file inputs =====

        // DAT file input
        const datFileLabel = this.datFileInput?.closest('.file-label');
        datFileLabel?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.datFileInput.click();
        });

        this.datFileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 DAT file selected:', file.name);
                this.selectedDatFile = file;
                this.datFileStatus.textContent = file.name;
                this.datFileStatus.classList.add('file-selected');
                this.updateLoadButtonDenis();
            }
        });

        // Load button for Denis
        this.loadButtonDenis?.addEventListener('click', () => {
            this.loadFilesDenis();
        });

        // ===== Мигачев_1 file inputs =====

        // Migachev file input
        const migachevFileLabel = this.migachevFileInput?.closest('.file-label');
        migachevFileLabel?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.migachevFileInput.click();
        });

        this.migachevFileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 Мигачев file selected:', file.name);
                this.selectedMigachevFile = file;
                this.migachevFileStatus.textContent = file.name;
                this.migachevFileStatus.classList.add('file-selected');
                this.updateLoadButtonMigachev();
            }
        });

        // Load button for Мигачев
        this.loadButtonMigachev?.addEventListener('click', () => {
            this.loadFilesMigachev();
        });

        // Drag and drop for entire drop zone
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drop-zone--active');
        });

        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drop-zone--active');
        });

        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drop-zone--active');

            const files = Array.from(e.dataTransfer.files);
            console.log('📄 Files dropped:', files.map(f => f.name));

            // Auto-assign files based on size (GPS files are usually smaller)
            if (files.length === 1) {
                // Single file - assume it's GPS file
                this.selectedGpsFile = files[0];
                this.gpsFileStatus.textContent = files[0].name;
                this.gpsFileStatus.classList.add('file-selected');
            } else if (files.length >= 2) {
                // Sort by size
                files.sort((a, b) => a.size - b.size);
                // Smaller file = GPS, larger file = full log
                this.selectedGpsFile = files[0];
                this.selectedFullLogFile = files[1];
                this.gpsFileStatus.textContent = files[0].name;
                this.fullLogFileStatus.textContent = files[1].name;
                this.gpsFileStatus.classList.add('file-selected');
                this.fullLogFileStatus.classList.add('file-selected');
            }

            this.updateLoadButton();
        });

        console.log('✅ File upload handlers set up');
    }

    updateLoadButton() {
        if (this.selectedGpsFile) {
            this.loadButton.style.display = 'block';
        } else {
            this.loadButton.style.display = 'none';
        }
    }

    updateLoadButtonArdupilot() {
        if (this.selectedTxtLogFile) {
            this.loadButtonArdupilot.style.display = 'block';
        } else {
            this.loadButtonArdupilot.style.display = 'none';
        }
    }

    updateLoadButtonDenis() {
        if (this.selectedDatFile) {
            this.loadButtonDenis.style.display = 'block';
        } else {
            this.loadButtonDenis.style.display = 'none';
        }
    }

    updateLoadButtonMigachev() {
        if (this.selectedMigachevFile) {
            this.loadButtonMigachev.style.display = 'block';
        } else {
            this.loadButtonMigachev.style.display = 'none';
        }
    }

    setupCameraButtons() {
        const topButton = document.getElementById('cameraTop');
        const followButton = document.getElementById('cameraFollow');
        const fpvButton = document.getElementById('cameraFPV');

        const buttons = [topButton, followButton, fpvButton];

        topButton?.addEventListener('click', () => {
            console.log('📷 Camera: Top view');
            this.setCameraMode('top', topButton, buttons);
        });

        followButton?.addEventListener('click', () => {
            console.log('📷 Camera: Follow mode');
            this.setCameraMode('follow', followButton, buttons);
        });

        fpvButton?.addEventListener('click', () => {
            console.log('📷 Camera: FPV mode');
            this.setCameraMode('fpv', fpvButton, buttons);
        });
    }

    setupExitButton() {
        if (!this.exitButton) return;

        this.exitButton.addEventListener('click', () => {
            console.log('🚪 Exit button clicked');
            this.returnToMenu();
        });
    }

    setupMapControls() {
        const mapTypeSelect = document.getElementById('mapTypeSelect');
        const toggleElevationBtn = document.getElementById('mapToggleElevation');

        if (mapTypeSelect) {
            mapTypeSelect.addEventListener('change', async (e) => {
                if (this.terrainLoader) {
                    await this.terrainLoader.setMapType(e.target.value);
                }
            });
        }

        if (toggleElevationBtn) {
            const svgIcon = toggleElevationBtn.querySelector('svg').outerHTML;

            toggleElevationBtn.addEventListener('click', async () => {
                if (this.terrainLoader) {
                    await this.terrainLoader.toggleElevation();

                    // Обновить текст кнопки
                    if (this.terrainLoader.elevationEnabled) {
                        toggleElevationBtn.innerHTML = svgIcon + ' Выкл. рельеф';
                        toggleElevationBtn.classList.add('btn--active');
                    } else {
                        toggleElevationBtn.innerHTML = svgIcon + ' Рельеф';
                        toggleElevationBtn.classList.remove('btn--active');
                    }
                }
            });
        }
    }

    updateStatusBar(message, details = {}) {
        const statusBar = document.getElementById('statusBar');
        const statusText = document.getElementById('statusText');
        const statusDetails = document.getElementById('statusDetails');

        if (!statusBar || !statusText) return;

        statusText.textContent = message;

        if (Object.keys(details).length > 0) {
            const detailsText = Object.entries(details)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' | ');
            statusDetails.textContent = detailsText;
        } else {
            statusDetails.textContent = '';
        }
    }

    returnToMenu() {
        console.log('🔄 Returning to main menu...');

        // Stop playback
        if (this.playbackController) {
            this.playbackController.pause();
        }

        // Dispose resources
        this.dispose();

        // Hide visualization
        this.canvasContainer.style.display = 'none';
        if (this.exitButton) {
            this.exitButton.style.display = 'none';
        }

        // Hide UI panels
        if (this.telemetry) {
            this.telemetry.hide();
        }
        if (this.timeline) {
            this.timeline.hide();
        }

        // Hide GPS source panel
        const gpsSourcePanel = document.getElementById('gpsSourcePanel');
        if (gpsSourcePanel) {
            gpsSourcePanel.style.display = 'none';
        }

        // Hide visibility panel
        const visibilityPanel = document.getElementById('visibilityPanel');
        if (visibilityPanel) {
            visibilityPanel.style.display = 'none';
        }

        // Show drop zone
        this.dropZone.style.display = 'block';
        this.dropZone.querySelector('.drop-zone__content').style.display = 'block';
        this.progressContainer.style.display = 'none';

        // Reset state
        this.flightData = null;
        this.waypointsData = null;
        this.sceneManager = null;
        this.trajectoryLine = null;
        this.waypointsLine = null;
        this.droneModel = null;
        this.terrainLoader = null;
        this.cameraController = null;
        this.playbackController = null;
        this.telemetry = null;
        this.timeline = null;

        // Clear file inputs and state - INAV
        this.gpsFileInput.value = '';
        this.fullLogFileInput.value = '';
        this.selectedGpsFile = null;
        this.selectedFullLogFile = null;
        this.gpsFileStatus.textContent = 'Не выбран';
        this.fullLogFileStatus.textContent = 'Не выбран';
        this.gpsFileStatus.classList.remove('file-selected');
        this.fullLogFileStatus.classList.remove('file-selected');
        this.loadButton.style.display = 'none';

        // Clear file inputs and state - Ardupilot
        if (this.txtLogFileInput) this.txtLogFileInput.value = '';
        if (this.waypointsFileInput) this.waypointsFileInput.value = '';
        this.selectedTxtLogFile = null;
        this.selectedWaypointsFile = null;
        if (this.txtLogFileStatus) this.txtLogFileStatus.textContent = 'Не выбран';
        if (this.waypointsFileStatus) this.waypointsFileStatus.textContent = 'Не выбран';
        if (this.txtLogFileStatus) this.txtLogFileStatus.classList.remove('file-selected');
        if (this.waypointsFileStatus) this.waypointsFileStatus.classList.remove('file-selected');
        if (this.loadButtonArdupilot) this.loadButtonArdupilot.style.display = 'none';

        // Clear file inputs and state - Denis
        if (this.datFileInput) this.datFileInput.value = '';
        this.selectedDatFile = null;
        if (this.datFileStatus) this.datFileStatus.textContent = 'Не выбран';
        if (this.datFileStatus) this.datFileStatus.classList.remove('file-selected');
        if (this.loadButtonDenis) this.loadButtonDenis.style.display = 'none';

        // Clear file inputs and state - Мигачев_1
        if (this.migachevFileInput) this.migachevFileInput.value = '';
        this.selectedMigachevFile = null;
        if (this.migachevFileStatus) this.migachevFileStatus.textContent = 'Не выбран';
        if (this.migachevFileStatus) this.migachevFileStatus.classList.remove('file-selected');
        if (this.loadButtonMigachev) this.loadButtonMigachev.style.display = 'none';

        console.log('✅ Returned to main menu');
    }

    setCameraMode(mode, activeButton, allButtons) {
        if (!this.cameraController) {
            console.warn('⚠️ Camera controller not initialized yet');
            return;
        }

        this.cameraController.setMode(mode);

        // Update button states
        allButtons.forEach(btn => btn?.classList.remove('btn--active'));
        activeButton?.classList.add('btn--active');
    }

    async loadFiles() {
        try {
            if (!this.selectedGpsFile) {
                alert('Please select a GPS file');
                return;
            }

            console.log(`%c📥 Loading files:`, 'color: blue; font-weight: bold');
            console.log('  GPS file:', this.selectedGpsFile.name, `(${(this.selectedGpsFile.size / 1024).toFixed(1)} KB)`);
            if (this.selectedFullLogFile) {
                console.log('  Full log:', this.selectedFullLogFile.name, `(${(this.selectedFullLogFile.size / 1024 / 1024).toFixed(1)} MB)`);
            }

            // Show progress
            document.body.style.cursor = 'wait'; // Изменить курсор на "ожидание"
            this.dropZone.querySelector('.drop-zone__content').style.display = 'none';
            this.progressContainer.style.display = 'block';

            // Parse files
            if (this.selectedFullLogFile) {
                // Use dual parser
                console.log('🔍 Using dual-file parser...');
                const dualParser = new DualLogParser();
                this.flightData = await dualParser.parse(
                    this.selectedGpsFile,
                    this.selectedFullLogFile,
                    (progress, text) => {
                        console.log(`⏳ ${text}: ${progress.toFixed(0)}%`);
                        this.updateProgress(progress, text);
                    }
                );
            } else {
                // Use single parser (GPS only)
                console.log('🔍 Using single-file parser (GPS only)...');
                const parser = new InavLogParser();
                this.flightData = await parser.parse(this.selectedGpsFile, (progress) => {
                    console.log(`⏳ Parsing progress: ${progress.toFixed(0)}%`);
                    this.updateProgress(progress, 'Загрузка GPS файла...');
                });
            }

            console.log('%c✅ Flight data parsed successfully!', 'color: green; font-weight: bold');
            console.log('📊 Flight data:', {
                points: this.flightData.points.length,
                duration: this.flightData.duration.toFixed(2) + 's',
                bounds: this.flightData.bounds,
                hasExtendedTelemetry: !!(this.flightData.points[0]?.battery)
            });

            // Log first few points for debugging
            console.log('🎯 First 3 points:', this.flightData.points.slice(0, 3));

            // Initialize 3D visualization
            this.updateProgress(100, 'Инициализация 3D сцены...');
            console.log('🎨 Starting 3D visualization...');
            await this.initVisualization();

            // Hide drop zone, show visualization
            document.body.style.cursor = 'default'; // Вернуть нормальный курсор
            this.dropZone.style.display = 'none';
            this.canvasContainer.style.display = 'block';

            console.log('%c🎉 Visualization loaded!', 'color: green; font-size: 18px; font-weight: bold');

        } catch (error) {
            console.error('%c❌ Error loading files:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);
            alert(`Error loading files: ${error.message}`);

            // Reset UI
            document.body.style.cursor = 'default'; // Вернуть нормальный курсор
            this.dropZone.querySelector('.drop-zone__content').style.display = 'block';
            this.progressContainer.style.display = 'none';
        }
    }

    async loadFilesArdupilot() {
        try {
            if (!this.selectedTxtLogFile) {
                alert('Please select a TXT log file');
                return;
            }

            console.log(`%c📥 Loading MissionPlanner files:`, 'color: blue; font-weight: bold');
            console.log('  TXT Log file:', this.selectedTxtLogFile.name, `(${(this.selectedTxtLogFile.size / 1024).toFixed(1)} KB)`);
            if (this.selectedWaypointsFile) {
                console.log('  Waypoints:', this.selectedWaypointsFile.name, `(${(this.selectedWaypointsFile.size / 1024).toFixed(1)} KB)`);
            }

            // Show progress
            document.body.style.cursor = 'wait';
            const ardupilotContent = document.getElementById('ardupilotTabContent');
            if (ardupilotContent) {
                ardupilotContent.style.display = 'none';
            }
            this.progressContainer.style.display = 'block';

            // Parse TXT file
            console.log('🔍 Parsing MissionPlanner TXT file...');
            const parser = new MissionPlannerParser();
            this.flightData = await parser.parse(this.selectedTxtLogFile, (progress) => {
                console.log(`⏳ Parsing progress: ${progress.toFixed(0)}%`);
                this.updateProgress(progress, 'Парсинг TXT файла...');
            });

            // Parse waypoints file if provided
            if (this.selectedWaypointsFile) {
                console.log('🗺️ Parsing waypoints file...');
                const waypointsParser = new WaypointsParser();
                this.waypointsData = await waypointsParser.parse(this.selectedWaypointsFile);
                console.log('✅ Waypoints parsed:', this.waypointsData.waypoints.length, 'waypoints');
            } else {
                this.waypointsData = null;
            }

            console.log('%c✅ Flight data parsed successfully!', 'color: green; font-weight: bold');
            console.log('📊 Flight data:', {
                points: this.flightData.points.length,
                duration: this.flightData.duration.toFixed(2) + 's',
                bounds: this.flightData.bounds,
                source: this.flightData.source
            });

            // Log first few points for debugging
            console.log('🎯 First 3 points:', this.flightData.points.slice(0, 3));

            // Initialize 3D visualization
            this.updateProgress(100, 'Инициализация 3D сцены...');
            console.log('🎨 Starting 3D visualization...');
            await this.initVisualization();

            // Hide drop zone, show visualization
            document.body.style.cursor = 'default';
            this.dropZone.style.display = 'none';
            this.canvasContainer.style.display = 'block';

            console.log('%c🎉 Visualization loaded!', 'color: green; font-size: 18px; font-weight: bold');

        } catch (error) {
            console.error('%c❌ Error loading MissionPlanner files:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);
            alert(`Error loading MissionPlanner files: ${error.message}`);

            // Reset UI
            document.body.style.cursor = 'default';
            const ardupilotContent = document.getElementById('ardupilotTabContent');
            if (ardupilotContent) {
                ardupilotContent.style.display = 'block';
            }
            this.progressContainer.style.display = 'none';
        }
    }

    async loadFilesDenis() {
        try {
            if (!this.selectedDatFile) {
                alert('Please select a DAT file');
                return;
            }

            console.log(`%c📥 Loading Denis (UD) files:`, 'color: blue; font-weight: bold');
            console.log('  DAT file:', this.selectedDatFile.name, `(${(this.selectedDatFile.size / 1024 / 1024).toFixed(2)} MB)`);

            // Show progress
            document.body.style.cursor = 'wait';
            const udContent = document.getElementById('udTabContent');
            if (udContent) {
                udContent.style.display = 'none';
            }
            this.progressContainer.style.display = 'block';

            // Parse DAT file
            console.log('🔍 Parsing Denis .dat file...');
            const parser = new DenisLogParser();
            this.flightData = await parser.parse(this.selectedDatFile, (progress) => {
                console.log(`⏳ Parsing progress: ${progress.toFixed(0)}%`);
                this.updateProgress(progress, 'Парсинг DAT файла...');
            });

            console.log('%c✅ Flight data parsed successfully!', 'color: green; font-weight: bold');
            console.log('📊 Flight data:', {
                points: this.flightData.points.length,
                duration: this.flightData.duration.toFixed(2) + 's',
                bounds: this.flightData.bounds,
                source: this.flightData.source
            });

            // Log Denis-specific metadata
            if (this.flightData.denisMetadata) {
                console.log('📊 Denis Metadata:', this.flightData.denisMetadata);
                console.log(`   Total records: ${this.flightData.denisMetadata.totalRecords}`);
                console.log(`   Known GPS: ${this.flightData.denisMetadata.knownGpsCount}`);
                console.log(`   Discovered GPS: ${this.flightData.denisMetadata.discoveredGpsCount}`);
                console.log(`   Total GPS points: ${this.flightData.denisMetadata.totalGpsPoints}`);
                console.log(`   Telemetry records: ${this.flightData.denisMetadata.telemetryCount}`);
                console.log(`   Region: ${this.flightData.denisMetadata.regionSize?.description || 'N/A'}`);
            }

            // Log first few points for debugging
            console.log('🎯 First 3 points:', this.flightData.points.slice(0, 3));

            // Initialize 3D visualization
            this.updateProgress(100, 'Инициализация 3D сцены...');
            console.log('🎨 Starting 3D visualization...');
            await this.initVisualization();

            // Hide drop zone, show visualization
            document.body.style.cursor = 'default';
            this.dropZone.style.display = 'none';
            this.canvasContainer.style.display = 'block';

            console.log('%c🎉 Visualization loaded!', 'color: green; font-size: 18px; font-weight: bold');

        } catch (error) {
            console.error('%c❌ Error loading Denis files:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);
            alert(`Error loading Denis files: ${error.message}`);

            // Reset UI
            document.body.style.cursor = 'default';
            const udContent = document.getElementById('udTabContent');
            if (udContent) {
                udContent.style.display = 'block';
            }
            this.progressContainer.style.display = 'none';
        }
    }

    async loadFilesMigachev() {
        try {
            if (!this.selectedMigachevFile) {
                alert('Пожалуйста, выберите файл маршрута');
                return;
            }

            console.log(`%c📥 Loading mission file:`, 'color: blue; font-weight: bold');
            console.log('  File:', this.selectedMigachevFile.name, `(${(this.selectedMigachevFile.size / 1024).toFixed(2)} KB)`);

            // Show progress
            document.body.style.cursor = 'wait';
            const migachevContent = document.getElementById('migachevTabContent');
            if (migachevContent) {
                migachevContent.style.display = 'none';
            }
            this.progressContainer.style.display = 'block';

            // Detect file format by reading first line
            const fileContent = await this.selectedMigachevFile.text();
            const firstLine = fileContent.trim().split('\n')[0];
            const isQGCFormat = firstLine.startsWith('QGC WPL');

            console.log(`🔍 Detected format: ${isQGCFormat ? 'QGC WPL (Mission Planner)' : 'Migachev custom'}`);
            this.updateProgress(30, 'Парсинг файла маршрута...');

            let missionData;

            if (isQGCFormat) {
                // Use new Mission Planner parser with LOITER support
                console.log('🔍 Using MissionWaypointsParser (with LOITER_TURNS support)...');
                const parser = new MissionWaypointsParser();

                // Create a new File object from the content we already read
                const file = new File([fileContent], this.selectedMigachevFile.name);
                missionData = await parser.parse(file);

                console.log('%c✅ Mission parsed successfully!', 'color: green; font-weight: bold');
                console.log('📊 Mission data:', {
                    commands: missionData.waypoints.length,
                    flightPoints: missionData.flightPath.length,
                    events: missionData.events.length,
                    totalDistance: (missionData.totalDistance / 1000).toFixed(2) + ' km',
                    totalTime: parser.formatTime(missionData.totalTime),
                    bounds: missionData.bounds
                });

                // Store events for visualization
                this.missionEvents = missionData.events;

                // Store waypoints for visualization (original commands)
                this.waypointsData = {
                    waypoints: missionData.waypoints.filter(wp =>
                        wp.lat !== 0 || wp.lon !== 0
                    ).map(wp => ({
                        index: wp.index,
                        lat: wp.lat,
                        lon: wp.lon,
                        alt: wp.alt,
                        altAbsolute: wp.frame === 3 ? (missionData.homePosition?.alt || 0) + wp.alt : wp.alt,
                        command: wp.commandName,
                        params: wp.params
                    })),
                    bounds: missionData.bounds,
                    homeAltitude: missionData.homePosition?.alt || 0,
                    allWaypoints: missionData.waypoints
                };

                // Create flight data from generated flight path
                const flightPoints = missionData.flightPath.map((point, index) => ({
                    time: point.time,
                    gps: {
                        lat: point.lat,
                        lon: point.lon,
                        altitude: point.altAbsolute || point.alt,
                        speed: point.speed,
                        numSat: 0
                    },
                    attitude: {
                        roll: 0,
                        pitch: 0,
                        yaw: 0
                    },
                    command: point.command,
                    waypointIndex: point.waypointIndex,
                    loiterTurn: point.loiterTurn,
                    loiterProgress: point.loiterProgress
                }));

                this.flightData = {
                    points: flightPoints,
                    duration: missionData.totalTime,
                    bounds: missionData.bounds,
                    source: 'Mission Planner',
                    events: missionData.events,
                    totalDistance: missionData.totalDistance
                };

            } else {
                // Use original Migachev parser
                console.log('🔍 Using MigachevParser...');
                const parser = new MigachevParser();

                // Create a new File object from the content
                const file = new File([fileContent], this.selectedMigachevFile.name);
                this.waypointsData = await parser.parse(file);

                console.log('%c✅ Waypoints parsed successfully!', 'color: green; font-weight: bold');
                console.log('📊 Waypoints data:', {
                    waypoints: this.waypointsData.waypoints.length,
                    bounds: this.waypointsData.bounds,
                    homeAltitude: this.waypointsData.homeAltitude
                });

                // Create flight data from waypoints (old logic)
                const waypoints = this.waypointsData.waypoints;
                const ASSUMED_CRUISE_SPEED = 15;

                const calculateDistance = (lat1, lon1, lat2, lon2) => {
                    const R = 6371000;
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                              Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    return R * c;
                };

                const flightPoints = waypoints.map((wp, index) => {
                    let estimatedSpeed = 0;
                    if (index < waypoints.length - 1) {
                        estimatedSpeed = ASSUMED_CRUISE_SPEED;
                    }

                    return {
                        time: index,
                        gps: {
                            lat: wp.lat,
                            lon: wp.lon,
                            altitude: wp.altAbsolute || wp.alt || 0,
                            speed: estimatedSpeed,
                            speedEstimated: true,
                            numSat: 0
                        },
                        attitude: { roll: 0, pitch: 0, yaw: 0 }
                    };
                });

                const bounds = this.waypointsData.bounds;
                if (!isFinite(bounds.minAlt)) bounds.minAlt = 0;
                if (!isFinite(bounds.maxAlt)) bounds.maxAlt = 500;

                this.flightData = {
                    points: flightPoints,
                    duration: Math.max(1, flightPoints.length - 1),
                    bounds: bounds,
                    source: 'migachev'
                };
            }

            console.log('📊 Flight data created:', {
                points: this.flightData.points.length,
                duration: this.flightData.duration.toFixed(1) + 's',
                bounds: this.flightData.bounds
            });

            // Initialize 3D visualization
            this.updateProgress(100, 'Инициализация 3D сцены...');
            console.log('🎨 Starting 3D visualization...');
            await this.initVisualization();

            // Hide drop zone, show visualization
            document.body.style.cursor = 'default';
            this.dropZone.style.display = 'none';
            this.canvasContainer.style.display = 'block';

            console.log('%c🎉 Mission visualization loaded!', 'color: green; font-size: 18px; font-weight: bold');

        } catch (error) {
            console.error('%c❌ Error loading mission file:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);
            alert(`Ошибка загрузки файла: ${error.message}`);

            // Reset UI
            document.body.style.cursor = 'default';
            const migachevContent = document.getElementById('migachevTabContent');
            if (migachevContent) {
                migachevContent.style.display = 'block';
            }
            this.progressContainer.style.display = 'none';
        }
    }

    updateProgress(percentage, text) {
        if (this.progressBar) {
            this.progressBar.style.width = `${percentage}%`;
        }
        if (this.progressText) {
            this.progressText.textContent = text;
        }
        // Update percentage display
        const progressPercentage = document.getElementById('progressPercentage');
        if (progressPercentage) {
            progressPercentage.textContent = `${Math.round(percentage)}%`;
        }
    }

    async initVisualization() {
        console.log('🎬 initVisualization() called');
        console.log(`🌍 Using ${this.useCesium ? 'Cesium.js (Google Earth quality)' : 'Three.js (legacy)'}`);

        try {
            if (this.useCesium) {
                await this.initCesiumVisualization();
            } else {
                await this.initThreeJsVisualization();
            }
        } catch (error) {
            console.error('%c❌ Error in initVisualization:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);

            // Fallback to Three.js if Cesium fails
            if (this.useCesium) {
                console.warn('⚠️ Cesium failed, falling back to Three.js...');
                this.useCesium = false;
                await this.initThreeJsVisualization();
            } else {
                throw error;
            }
        }
    }

    /**
     * Initialize visualization using Cesium.js (high quality terrain like Google Earth)
     */
    async initCesiumVisualization() {
        console.log('🌍 Initializing Cesium.js visualization...');

        // Create Cesium viewer with World Terrain
        console.log('1️⃣ Creating CesiumViewer...');
        this.cesiumViewer = new CesiumViewer('cesiumContainer');

        // Wait for Cesium to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('✅ CesiumViewer created with World Terrain');

        // Create trajectory entity (with terrain height sampling)
        console.log('2️⃣ Creating TrajectoryEntity...');
        this.trajectoryEntity = new TrajectoryEntity(this.cesiumViewer);
        await this.trajectoryEntity.create(this.flightData);
        const terrainHeight = this.trajectoryEntity.getTerrainHeight();
        console.log('✅ Trajectory created');

        // Create waypoints entity if data exists
        if (this.waypointsData && this.waypointsData.waypoints.length > 0) {
            console.log('3️⃣ Creating WaypointsEntity...');
            this.waypointsEntity = new WaypointsEntity(this.cesiumViewer);
            // Pass events for visualization (SERVO, CAMERA markers)
            const events = this.flightData?.events || this.missionEvents || null;
            this.waypointsEntity.create(this.waypointsData, events, terrainHeight);
            console.log('✅ Waypoints created');
        }

        // Create drone entity
        console.log('4️⃣ Creating DroneEntity...');
        this.droneEntity = new DroneEntity(this.cesiumViewer);
        await this.droneEntity.create();
        console.log('✅ Drone created');

        // Create camera controller
        console.log('5️⃣ Creating CesiumCameraController...');
        this.cesiumCameraController = new CesiumCameraController(this.cesiumViewer, this.droneEntity);
        console.log('✅ Camera controller created');

        // Focus camera on flight bounds
        console.log('📷 Focusing camera on bounds...');
        await this.cesiumViewer.focusOnBounds(this.flightData.bounds);

        // Store terrain height in flight data for playback
        this.flightData.terrainHeight = terrainHeight;

        // Create playback controller (adapted for Cesium)
        console.log('6️⃣ Creating PlaybackController...');
        this.playbackController = new PlaybackController(
            this.flightData,
            this.droneEntity,        // DroneEntity instead of DroneModel
            this.cesiumCameraController,  // CesiumCameraController instead of CameraController
            true                     // isCesium flag
        );
        console.log('✅ Playback controller created');

        // Create UI components
        console.log('7️⃣ Creating UI components...');
        this.telemetry = new Telemetry();
        this.timeline = new Timeline(this.playbackController);
        console.log('✅ UI components created');

        // Setup playback callbacks
        console.log('8️⃣ Setting up callbacks...');
        this.playbackController.onUpdate((data) => {
            this.telemetry.update(data.currentPoint, data.nextPoint, data.interpolation);
            this.timeline.update(data);
        });
        console.log('✅ Callbacks set up');

        // Setup Cesium render loop
        console.log('9️⃣ Setting up Cesium render loop...');
        const viewer = this.cesiumViewer.getViewer();
        viewer.scene.preRender.addEventListener(() => {
            this.playbackController.update();
        });
        console.log('✅ Render loop set up');

        // Finish common UI setup
        this.finishVisualizationSetup();

        // Expose drone entity for debugging
        window.droneEntity = this.droneEntity;
        window.cesiumViewer = this.cesiumViewer;
        console.log('🔧 Debug: window.droneEntity and window.cesiumViewer available');

        console.log('%c✅ Cesium visualization fully initialized!', 'color: green; font-size: 16px; font-weight: bold');
    }

    /**
     * Initialize visualization using Three.js (legacy fallback)
     */
    async initThreeJsVisualization() {
        console.log('🎮 Initializing Three.js visualization (legacy)...');

        // Show canvas, hide Cesium container
        const cesiumContainer = document.getElementById('cesiumContainer');
        if (cesiumContainer) cesiumContainer.style.display = 'none';
        if (this.canvas) this.canvas.style.display = 'block';

        // Create scene manager
        console.log('1️⃣ Creating SceneManager...');
        this.sceneManager = new SceneManager(this.canvas);
        console.log('✅ SceneManager created');

        // Create terrain
        console.log('2️⃣ Creating TerrainLoader...');
        this.terrainLoader = new TerrainLoader(this.sceneManager, this.flightData.bounds);
        this.terrainLoader.setStatusCallback((message, details) => {
            this.updateStatusBar(message, details);
        });
        await this.terrainLoader.loadTerrain(this.flightData.bounds);
        console.log('✅ Terrain loaded');

        // Create trajectory line
        console.log('3️⃣ Creating TrajectoryLine...');
        this.trajectoryLine = new TrajectoryLine(this.sceneManager, this.flightData);
        console.log('✅ Trajectory created');

        // Calculate map scale
        const mapWidth = Math.max(
            (this.flightData.bounds.maxLat - this.flightData.bounds.minLat) * 111320,
            (this.flightData.bounds.maxLon - this.flightData.bounds.minLon) * 111320 * Math.cos((this.flightData.bounds.minLat + this.flightData.bounds.maxLat) / 2 * Math.PI / 180)
        );
        const markerScale = Math.max(15, Math.min(1000, mapWidth / 200));

        // Create waypoints if data exists
        if (this.waypointsData && this.waypointsData.waypoints.length > 0) {
            console.log('3.5️⃣ Creating WaypointsLine...');
            const centerLat = (this.flightData.bounds.minLat + this.flightData.bounds.maxLat) / 2;
            const centerLon = (this.flightData.bounds.minLon + this.flightData.bounds.maxLon) / 2;
            const groundLevel = this.trajectoryLine ? this.trajectoryLine.groundLevel : 0;
            const homeAltitudeMSL = this.flightData.points[0]?.gps?.altitude || this.flightData.bounds.minAlt || 0;
            this.waypointsLine = new WaypointsLine(
                this.sceneManager, this.waypointsData, centerLat, centerLon,
                groundLevel, homeAltitudeMSL, markerScale
            );
            console.log('✅ Waypoints created');
        }

        // Create drone model
        console.log('4️⃣ Creating DroneModel...');
        this.droneModel = new DroneModel(this.sceneManager);
        const objectScale = Math.max(5, Math.min(500, mapWidth / 500));
        const droneSize = Math.max(5, Math.min(50, objectScale / 5));
        this.droneModel.setScale(droneSize / 2.5);
        console.log('✅ Drone model created');

        // Create camera controller
        console.log('5️⃣ Creating CameraController...');
        this.cameraController = new CameraController(this.sceneManager, this.droneModel);
        this.sceneManager.focusOnBounds(this.flightData.bounds);
        console.log('✅ Camera controller created');

        // Create playback controller
        console.log('6️⃣ Creating PlaybackController...');
        this.playbackController = new PlaybackController(
            this.flightData, this.droneModel, this.cameraController, false
        );
        console.log('✅ Playback controller created');

        // Create UI components
        console.log('7️⃣ Creating UI components...');
        this.telemetry = new Telemetry();
        this.timeline = new Timeline(this.playbackController);

        // Setup callbacks
        this.playbackController.onUpdate((data) => {
            this.telemetry.update(data.currentPoint, data.nextPoint, data.interpolation);
            this.timeline.update(data);
        });

        // Setup render loop
        this.sceneManager.onRender(() => {
            this.playbackController.update();
        });

        // Finish common UI setup
        this.finishVisualizationSetup();

        // Expose for debugging
        window.droneModel = this.droneModel;
        console.log('🔧 Debug: window.droneModel available');

        console.log('%c✅ Three.js visualization fully initialized!', 'color: green; font-size: 16px; font-weight: bold');
    }

    /**
     * Common UI setup after visualization initialization
     */
    finishVisualizationSetup() {
        // Set timeline duration
        this.timeline.setDuration(this.flightData.duration);

        // Show UI
        this.telemetry.show();
        this.timeline.show();

        // Setup panels
        this.setupGpsSourcePanel();
        this.setupVisibilityPanel();
        this.setupDenisStatsPanel();

        // Show status bar and map controls
        const statusBar = document.getElementById('statusBar');
        const mapControls = document.getElementById('mapControls');
        if (statusBar) statusBar.style.display = 'block';
        if (mapControls) mapControls.style.display = 'flex';

        // Toggle logos
        const logoUpload = document.getElementById('logoUpload');
        const logoViz = document.getElementById('logoViz');
        if (logoUpload) logoUpload.style.display = 'none';
        if (logoViz) logoViz.style.display = 'block';

        // Show exit button
        if (this.exitButton) {
            this.exitButton.style.display = 'inline-flex';
        }

        // Initialize drone at first position
        this.playbackController.seek(0);
        console.log('✅ Drone positioned at start');
    }

    setupGpsSourcePanel() {
        // Only show for MissionPlanner data that has multiple GPS sources
        if (this.flightData.source !== 'MissionPlanner TXT') {
            console.log('ℹ️ GPS source panel not needed (not MissionPlanner data)');
            return;
        }

        const hasMultipleSources =
            this.flightData.gpsRawData?.length > 0 &&
            this.flightData.globalPositionData?.length > 0;

        if (!hasMultipleSources) {
            console.log('ℹ️ GPS source panel not needed (only one GPS source available)');
            return;
        }

        console.log('📡 Setting up GPS source panel...');

        const panel = document.getElementById('gpsSourcePanel');
        if (!panel) {
            console.warn('⚠️ GPS source panel element not found');
            return;
        }

        panel.style.display = 'block';

        // Setup toggle button
        const toggleButton = document.getElementById('gpsSourceToggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                panel.classList.toggle('collapsed');
            });
        }

        // Setup radio button event listeners
        const radioButtons = document.querySelectorAll('input[name="gpsSource"]');
        radioButtons.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.switchGpsSource(e.target.value);
                }
            });
        });

        // Set initial selection based on activeSource
        if (this.flightData.activeSource) {
            const activeRadio = document.getElementById(
                this.flightData.activeSource === 'global_position_int' ? 'gpsSourceGlobal' : 'gpsSourceRaw'
            );
            if (activeRadio) {
                activeRadio.checked = true;
            }
        }

        console.log('✅ GPS source panel ready');
    }

    switchGpsSource(source) {
        console.log(`🔄 Switching GPS source to: ${source}`);

        // Determine which data array to use
        let newPoints;
        if (source === 'global_position_int' && this.flightData.globalPositionData?.length > 0) {
            newPoints = this.flightData.globalPositionData;
        } else if (source === 'gps_raw_int' && this.flightData.gpsRawData?.length > 0) {
            newPoints = this.flightData.gpsRawData;
        } else {
            console.error('❌ Invalid GPS source or no data available');
            return;
        }

        // Store current playback state
        const wasPlaying = this.playbackController?.isPlaying;

        // Stop playback
        if (this.playbackController) {
            this.playbackController.pause();
        }

        // Update flight data points
        this.flightData.points = newPoints;
        this.flightData.activeSource = source;

        console.log(`📊 Switched to ${newPoints.length} points from ${source}`);

        // Redraw trajectory
        if (this.trajectoryLine) {
            this.trajectoryLine.dispose();
        }
        this.trajectoryLine = new TrajectoryLine(this.sceneManager, this.flightData);

        // Reset playback to beginning
        if (this.playbackController) {
            this.playbackController.setFlightData(this.flightData);
            this.playbackController.seek(0);
        }

        // Update timeline
        if (this.timeline) {
            this.timeline.reset();
        }

        console.log('✅ GPS source switched successfully');
    }

    setupVisibilityPanel() {
        console.log('👁️ Setting up visibility controls panel...');

        const panel = document.getElementById('visibilityPanel');
        if (!panel) {
            console.warn('⚠️ Visibility panel element not found');
            return;
        }

        panel.style.display = 'block';

        // Setup toggle button
        const toggleButton = document.getElementById('visibilityToggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                panel.classList.toggle('collapsed');
            });
        }

        // Setup trajectory visibility toggle
        const trajectoryToggle = document.getElementById('toggleTrajectory');
        if (trajectoryToggle) {
            trajectoryToggle.addEventListener('change', (e) => {
                if (this.trajectoryLine) {
                    if (e.target.checked) {
                        this.trajectoryLine.line.visible = true;
                    } else {
                        this.trajectoryLine.line.visible = false;
                    }
                    console.log(`🔄 Trajectory visibility: ${e.target.checked}`);
                }
            });
        }

        // Setup waypoints visibility toggle
        const waypointsToggle = document.getElementById('toggleWaypoints');
        if (waypointsToggle) {
            // Disable if no waypoints loaded
            if (!this.waypointsLine) {
                waypointsToggle.disabled = true;
                waypointsToggle.parentElement.style.opacity = '0.5';
                waypointsToggle.parentElement.style.cursor = 'not-allowed';
            } else {
                waypointsToggle.addEventListener('change', (e) => {
                    if (this.waypointsLine) {
                        if (e.target.checked) {
                            this.waypointsLine.show();
                        } else {
                            this.waypointsLine.hide();
                        }
                        console.log(`🔄 Waypoints visibility: ${e.target.checked}`);
                    }
                });
            }
        }

        console.log('✅ Visibility controls panel ready');
    }

    setupDenisStatsPanel() {
        // Only show for Denis data
        if (this.flightData.source !== 'Denis (UD) .dat') {
            console.log('ℹ️ Denis stats panel not needed (not Denis data)');
            return;
        }

        if (!this.flightData.denisMetadata) {
            console.log('⚠️ Denis metadata not available');
            return;
        }

        console.log('📊 Setting up Denis statistics panel...');

        const panel = document.getElementById('denisStatsPanel');
        if (!panel) {
            console.warn('⚠️ Denis stats panel element not found');
            return;
        }

        panel.style.display = 'block';

        // Setup toggle button
        const toggleButton = document.getElementById('denisStatsToggle');
        if (toggleButton) {
            toggleButton.addEventListener('click', () => {
                panel.classList.toggle('collapsed');
            });
        }

        // Populate statistics
        const meta = this.flightData.denisMetadata;

        document.getElementById('denisStatRecords').textContent = meta.totalRecords.toLocaleString();
        document.getElementById('denisStatKnownGPS').textContent = meta.knownGpsCount.toLocaleString();
        document.getElementById('denisStatDiscoveredGPS').textContent = meta.discoveredGpsCount.toLocaleString();
        document.getElementById('denisStatTotalGPS').textContent = meta.totalGpsPoints.toLocaleString();
        document.getElementById('denisStatTelemetry').textContent = meta.telemetryCount.toLocaleString();

        // Calculate ratio
        const ratio = meta.telemetryCount > 0 ?
            (meta.telemetryCount / meta.totalGpsPoints).toFixed(1) : 'N/A';
        document.getElementById('denisStatRatio').textContent = `${ratio}:1 (telem:gps)`;

        // Region center
        if (meta.regionCenter) {
            const centerText = `${meta.regionCenter.lat.toFixed(6)}, ${meta.regionCenter.lon.toFixed(6)}`;
            document.getElementById('denisStatRegionCenter').textContent = centerText;
        }

        // Region size
        if (meta.regionSize) {
            document.getElementById('denisStatRegionSize').textContent = meta.regionSize.description;
        }

        console.log('✅ Denis statistics panel ready');
    }

    dispose() {
        console.log('🗑️ Disposing resources...');
        if (this.sceneManager) {
            this.sceneManager.dispose();
        }
        if (this.trajectoryLine) {
            this.trajectoryLine.dispose();
        }
        if (this.waypointsLine) {
            this.waypointsLine.dispose();
        }
        if (this.droneModel) {
            this.droneModel.dispose();
        }
        if (this.terrainLoader) {
            this.terrainLoader.dispose();
        }
        console.log('✅ Resources disposed');
    }
}

// Initialize app when DOM is ready
console.log('⏳ Waiting for DOM...');
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('✅ DOM loaded, creating app...');
        window.app = new FlightVisualizerApp();
    });
} else {
    console.log('✅ DOM already loaded, creating app...');
    window.app = new FlightVisualizerApp();
}
