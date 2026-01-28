import * as THREE from 'three';
import { CmdScale } from './commands.js';

export class ScaleManager {
    constructor(viewer, snappingManager, onCommandExecuted) {
        this.viewer = viewer;
        this.snappingManager = snappingManager;
        this.onCommandExecuted = onCommandExecuted;

        this.isActive = false;
        this.isPickingCenter = false;
        this.selectedObjects = [];
        this.centerPoint = null;

        // UI Elements
        this.modal = document.getElementById('scale-modal');
        this.input = document.getElementById('scale-factor-input');
        this.btn = document.getElementById('scale-btn');
        this.confirmBtn = document.getElementById('scale-confirm-btn');
        this.cancelBtn = document.getElementById('scale-cancel-btn');
        this.closeBtn = document.getElementById('scale-modal-close');

        this.bindEvents();
    }

    bindEvents() {
        if (this.confirmBtn) this.confirmBtn.addEventListener('click', () => this.onConfirmScale());
        if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.closeModal());
        if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.closeModal());

        // Canvas Click for Point Picking
        this.viewer.renderer.domElement.addEventListener('click', (e) => this.onCanvasClick(e));

        // Initial Button State
        this.updateButtonState();
    }

    activate(selectedObjects) {
        if (!selectedObjects || selectedObjects.length === 0) return;

        this.selectedObjects = selectedObjects;
        this.isActive = true;
        this.isPickingCenter = true;

        // Highlight button
        if (this.btn) this.btn.classList.add('bg-cyan-500/20', 'text-cyan-400');

        console.log('[ScaleManager] Activated. Pick a center point.');
        // Change cursor
        this.viewer.renderer.domElement.style.cursor = 'crosshair';
    }

    deactivate() {
        this.isActive = false;
        this.isPickingCenter = false;
        this.selectedObjects = [];
        this.centerPoint = null;

        // Reset button
        if (this.btn) this.btn.classList.remove('bg-cyan-500/20', 'text-cyan-400');

        this.closeModal();
        this.viewer.renderer.domElement.style.cursor = '';
        console.log('[ScaleManager] Deactivated.');
    }

    updateButtonState(selection = []) {
        if (this.btn) {
            if (selection.length > 0) {
                this.btn.disabled = false;
                this.btn.classList.remove('opacity-50', 'cursor-not-allowed', 'group-is-disabled');
            } else {
                this.btn.disabled = true;
                this.btn.classList.add('opacity-50', 'cursor-not-allowed', 'group-is-disabled');
                if (this.isActive) this.deactivate();
            }
        }
    }

    onCanvasClick(event) {
        if (!this.isActive || !this.isPickingCenter) return;
        if (event.target !== this.viewer.renderer.domElement) return;

        event.stopImmediatePropagation();
        event.stopPropagation();

        // Use Snapped Point if active, otherwise raycast
        let point = null;
        if (this.snappingManager && this.snappingManager.activeSnap) {
            point = this.snappingManager.activeSnap.point.clone();
        } else {
            point = this.getMouseWorldPosition(event);
        }

        if (point) {
            this.centerPoint = point;
            this.isPickingCenter = false;
            this.viewer.renderer.domElement.style.cursor = '';
            this.openModal();
        }
    }

    getMouseWorldPosition(event) {
        const rect = this.viewer.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        const vec = new THREE.Vector3(x, y, 0);
        vec.unproject(this.viewer.camera);
        vec.z = 0;
        return vec;
    }

    openModal() {
        if (this.modal) {
            this.modal.classList.remove('hidden');
            if (this.input) {
                this.input.value = "1.0";
                this.input.focus();
                this.input.select();
            }
        }
    }

    closeModal() {
        if (this.modal) this.modal.classList.add('hidden');
        // If we closed without confirming, should we cancel the operation?
        if (this.isActive && !this.isPickingCenter) {
            // User cancelled at modal stage -> Reset to picking or exit?
            // Let's exit.
            this.deactivate();
        }
    }

    onConfirmScale() {
        if (!this.input) return;

        // 1. Replace comma with dot
        let valStr = this.input.value.replace(/,/g, '.');

        // 2. Evaluate expression (e.g. "240/278")
        let factor = NaN;
        try {
            // Simple safety check: allow only digits, operators, dot, and spaces
            if (/^[0-9\.\+\-\*\/\s\(\)]+$/.test(valStr)) {
                // Use Function constructor for a safer-than-eval alternative for simple math
                factor = new Function('return ' + valStr)();
            }
        } catch (e) {
            console.error("Invalid math expression:", valStr, e);
        }

        if (isNaN(factor) || factor === 0 || !isFinite(factor)) {
            alert("Invalid scale factor");
            return;
        }

        this.applyScale(factor);
        this.closeModal();
        this.deactivate();
    }

    applyScale(factor) {
        console.log(`[ScaleManager] Scaling ${this.selectedObjects.length} objects by ${factor} from center`, this.centerPoint);

        const cmd = new CmdScale(this.viewer, this.selectedObjects, this.centerPoint, factor);
        // Do NOT execute here - let CommandHistory do it
        // cmd.execute(); 

        // Push to history (which executes it)
        if (this.onCommandExecuted) {
            this.onCommandExecuted(cmd);
        }
    }
}
