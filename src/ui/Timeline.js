/**
 * Timeline UI - Manages playback timeline and controls
 */
export class Timeline {
    constructor(playbackController) {
        this.playbackController = playbackController;

        // Elements
        this.timelineSlider = document.getElementById('timeline');
        this.currentTimeLabel = document.getElementById('currentTime');
        this.totalTimeLabel = document.getElementById('totalTime');
        this.playPauseButton = document.getElementById('playPause');
        this.speedSelect = document.getElementById('playbackSpeed');
        this.loopButton = document.getElementById('loopButton');

        // State
        this.isDragging = false;
        this.duration = 0;

        this.setupEventListeners();
        this.setupPlaybackEndHandler();
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Timeline slider
        if (this.timelineSlider) {
            this.timelineSlider.addEventListener('input', (e) => {
                this.isDragging = true;
                const percentage = parseFloat(e.target.value);
                this.playbackController.seekToPercentage(percentage);
            });

            this.timelineSlider.addEventListener('change', () => {
                this.isDragging = false;
            });
        }

        // Play/pause button
        if (this.playPauseButton) {
            this.playPauseButton.addEventListener('click', () => {
                const isPlaying = this.playbackController.togglePlayPause();
                this.updatePlayPauseButton(isPlaying);
            });
        }

        // Speed select
        if (this.speedSelect) {
            this.speedSelect.addEventListener('change', (e) => {
                const speed = parseFloat(e.target.value);
                this.playbackController.setSpeed(speed);
            });
        }

        // Loop button
        if (this.loopButton) {
            this.loopButton.addEventListener('click', () => {
                const isLooping = this.playbackController.toggleLoop();
                this.updateLoopButton(isLooping);
            });
        }
    }

    /**
     * Setup playback end handler
     */
    setupPlaybackEndHandler() {
        this.playbackController.onEnd(() => {
            // Update play/pause button to show play icon
            this.updatePlayPauseButton(false);
        });
    }

    /**
     * Update timeline from playback state
     */
    update(data) {
        // Update slider position (only if not dragging)
        if (!this.isDragging && this.timelineSlider) {
            this.timelineSlider.value = data.percentage.toFixed(2);
        }

        // Update time labels
        if (data.currentPoint) {
            const currentTime = data.currentPoint.time;

            if (this.currentTimeLabel) {
                this.currentTimeLabel.textContent = this.formatTime(currentTime);
            }
        }
    }

    /**
     * Set total duration
     */
    setDuration(duration) {
        this.duration = duration;

        if (this.totalTimeLabel) {
            this.totalTimeLabel.textContent = this.formatTime(duration);
        }

        if (this.timelineSlider) {
            this.timelineSlider.max = 100;
            this.timelineSlider.value = 0;
        }
    }

    /**
     * Update play/pause button appearance
     */
    updatePlayPauseButton(isPlaying) {
        if (!this.playPauseButton) return;

        // Update button icon
        this.playPauseButton.innerHTML = isPlaying ?
            // Pause icon
            `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
            </svg>` :
            // Play icon
            `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>`;
    }

    /**
     * Update loop button appearance
     */
    updateLoopButton(isLooping) {
        if (!this.loopButton) return;

        if (isLooping) {
            this.loopButton.classList.add('btn--active');
        } else {
            this.loopButton.classList.remove('btn--active');
        }
    }

    /**
     * Format time as MM:SS
     */
    formatTime(seconds) {
        if (!isFinite(seconds) || isNaN(seconds)) return '0:00';

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * Show controls panel
     */
    show() {
        const panel = document.getElementById('controls');
        if (panel) {
            panel.style.display = 'block';
        }
    }

    /**
     * Hide controls panel
     */
    hide() {
        const panel = document.getElementById('controls');
        if (panel) {
            panel.style.display = 'none';
        }
    }

    /**
     * Reset timeline
     */
    reset() {
        if (this.timelineSlider) {
            this.timelineSlider.value = 0;
        }

        if (this.currentTimeLabel) {
            this.currentTimeLabel.textContent = '0:00';
        }

        this.updatePlayPauseButton(false);
    }
}
