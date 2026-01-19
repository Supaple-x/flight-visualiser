import * as THREE from 'three';
import { InavLogParser } from './parsers/inavLogParser.js';
import { SceneManager } from './scene/SceneManager.js';
import { TrajectoryLine } from './scene/TrajectoryLine.js';
import { DroneModel } from './scene/DroneModel.js';
import { TerrainLoader } from './scene/TerrainLoader.js';
import { CameraController } from './controls/CameraController.js';
import { PlaybackController } from './controls/PlaybackController.js';
import { Telemetry } from './ui/Telemetry.js';
import { Timeline } from './ui/Timeline.js';

// Make THREE available globally for other modules
window.THREE = THREE;

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
        this.sceneManager = null;
        this.trajectoryLine = null;
        this.droneModel = null;
        this.terrainLoader = null;
        this.cameraController = null;
        this.playbackController = null;
        this.telemetry = null;
        this.timeline = null;

        // UI Elements
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.canvasContainer = document.getElementById('canvas-container');
        this.canvas = document.getElementById('scene');
        this.progressBar = document.getElementById('progressBar');
        this.progressText = document.getElementById('progressText');
        this.progressContainer = document.getElementById('progress');

        console.log('📦 UI Elements:', {
            dropZone: !!this.dropZone,
            fileInput: !!this.fileInput,
            canvas: !!this.canvas
        });

        this.init();
    }

    init() {
        console.log('🔧 Initializing app...');
        this.setupFileUpload();
        this.setupCameraButtons();
        console.log('✅ App initialized');
    }

    setupFileUpload() {
        console.log('📂 Setting up file upload handlers...');

        // Click to browse
        this.dropZone.addEventListener('click', () => {
            console.log('🖱️ Drop zone clicked');
            this.fileInput.click();
        });

        // File input change
        this.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                console.log('📄 File selected:', file.name, file.size, 'bytes');
                this.loadLogFile(file);
            }
        });

        // Drag and drop
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

            const file = e.dataTransfer.files[0];
            if (file) {
                console.log('📄 File dropped:', file.name);
                this.loadLogFile(file);
            }
        });

        console.log('✅ File upload handlers set up');
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

    async loadLogFile(file) {
        try {
            console.log(`%c📥 Loading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
                'color: blue; font-weight: bold');

            // Show progress
            this.dropZone.querySelector('.drop-zone__content').style.display = 'none';
            this.progressContainer.style.display = 'block';

            // Parse log file
            console.log('🔍 Starting to parse log file...');
            const parser = new InavLogParser();
            this.flightData = await parser.parse(file, (progress) => {
                console.log(`⏳ Parsing progress: ${progress.toFixed(0)}%`);
                this.updateProgress(progress, 'Parsing log file...');
            });

            console.log('%c✅ Flight data parsed successfully!', 'color: green; font-weight: bold');
            console.log('📊 Flight data:', {
                points: this.flightData.points.length,
                duration: this.flightData.duration.toFixed(2) + 's',
                bounds: this.flightData.bounds
            });

            // Log first few points for debugging
            console.log('🎯 First 3 points:', this.flightData.points.slice(0, 3));

            // Initialize 3D visualization
            this.updateProgress(100, 'Initializing 3D scene...');
            console.log('🎨 Starting 3D visualization...');
            await this.initVisualization();

            // Hide drop zone, show visualization
            this.dropZone.style.display = 'none';
            this.canvasContainer.style.display = 'block';

            console.log('%c🎉 Visualization loaded!', 'color: green; font-size: 18px; font-weight: bold');

        } catch (error) {
            console.error('%c❌ Error loading log file:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);
            alert(`Error loading log file: ${error.message}`);

            // Reset UI
            this.dropZone.querySelector('.drop-zone__content').style.display = 'block';
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
    }

    async initVisualization() {
        console.log('🎬 initVisualization() called');

        try {
            // Create scene manager
            console.log('1️⃣ Creating SceneManager...');
            this.sceneManager = new SceneManager(this.canvas);
            console.log('✅ SceneManager created');

            // Create terrain (ground plane for now)
            console.log('2️⃣ Creating TerrainLoader...');
            this.terrainLoader = new TerrainLoader(this.sceneManager, this.flightData.bounds);
            await this.terrainLoader.loadTerrain(this.flightData.bounds);
            console.log('✅ Terrain loaded');

            // Create trajectory line
            console.log('3️⃣ Creating TrajectoryLine...');
            this.trajectoryLine = new TrajectoryLine(this.sceneManager, this.flightData);
            console.log('✅ Trajectory created');

            // Create drone model
            console.log('4️⃣ Creating DroneModel...');
            this.droneModel = new DroneModel(this.sceneManager);
            console.log('✅ Drone model created');

            // Create camera controller
            console.log('5️⃣ Creating CameraController...');
            this.cameraController = new CameraController(this.sceneManager, this.droneModel);
            console.log('✅ Camera controller created');

            // Create playback controller
            console.log('6️⃣ Creating PlaybackController...');
            this.playbackController = new PlaybackController(
                this.flightData,
                this.droneModel,
                this.cameraController
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

            // Setup render loop callback
            console.log('9️⃣ Setting up render loop...');
            this.sceneManager.onRender(() => {
                this.playbackController.update();
            });
            console.log('✅ Render loop set up');

            // Set timeline duration
            this.timeline.setDuration(this.flightData.duration);
            console.log('⏱️ Timeline duration set:', this.flightData.duration);

            // Focus camera on trajectory
            console.log('🎥 Focusing camera on trajectory...');
            this.sceneManager.focusOnBounds(this.flightData.bounds);
            console.log('✅ Camera focused');

            // Show UI
            this.telemetry.show();
            this.timeline.show();
            console.log('👁️ UI panels shown');

            // Initialize drone at first position
            console.log('🚁 Initializing drone position...');
            this.playbackController.seek(0);
            console.log('✅ Drone positioned');

            console.log('%c✅ Visualization fully initialized!', 'color: green; font-size: 16px; font-weight: bold');

        } catch (error) {
            console.error('%c❌ Error in initVisualization:', 'color: red; font-weight: bold', error);
            console.error('Stack trace:', error.stack);
            throw error;
        }
    }

    dispose() {
        console.log('🗑️ Disposing resources...');
        if (this.sceneManager) {
            this.sceneManager.dispose();
        }
        if (this.trajectoryLine) {
            this.trajectoryLine.dispose();
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
