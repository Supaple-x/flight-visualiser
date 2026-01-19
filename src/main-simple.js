// Simplified main.js for testing
console.log('main-simple.js loaded!');

// Test Three.js import
import * as THREE from 'three';
console.log('Three.js loaded:', THREE.REVISION);

// Test DOM access
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded!');

    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        console.log('✅ Drop zone found!');
        dropZone.innerHTML = `
            <div style="color: white; text-align: center; padding: 40px;">
                <h1>✅ Application Loaded Successfully!</h1>
                <p>Three.js version: ${THREE.REVISION}</p>
                <p>The basic structure is working!</p>
            </div>
        `;
    } else {
        console.error('❌ Drop zone not found!');
    }
});
