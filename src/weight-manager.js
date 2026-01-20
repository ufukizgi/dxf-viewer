import * as THREE from 'three';
import { MATERIALS, DEFAULT_MATERIAL_ID } from './materials.js';

export class WeightManager {
    constructor(viewer, languageManager, snappingManager, onCloseCallback) {
        this.viewer = viewer;
        this.languageManager = languageManager;
        this.snappingManager = snappingManager;
        this.onCloseCallback = onCloseCallback;

        this.currentMaterialId = DEFAULT_MATERIAL_ID;
        this.selectedObjects = [];
        this.calculationResult = null;
        this.isEnabled = false;

        // Visualization
        this.previewMesh = null;
        this.previewMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.3,
            depthTest: false,
            side: THREE.DoubleSide
        });

        // Template placement mode
        this.templateMode = false;
        this.templateGroup = null;
        this.templateCenter = null;
        this.geometryCenter = null;
        this.templateScale = 1.0;
        this.scrollSteps = 0;
        this.originalSceneState = null;

        // Print mode
        this.printMode = false;

        // Calculated values storage for placeholders
        this.calculatedValues = {};
    }

    init() {
        this.createUI();
        this.bindEvents();
    }

    createUI() {
        this.panel = document.getElementById('weight-panel');
        this.btn = document.getElementById('weight-btn');

        // Template popup elements
        this.templatePopup = document.getElementById('template-popup');
        this.templateSelector = document.getElementById('template-selector');
        this.addTemplateBtn = document.getElementById('add-template-btn');

        // Scale panel
        this.scalePanel = document.getElementById('scale-panel');

        // Print button
        this.printBtn = document.getElementById('print-btn');
    }

    bindEvents() {
        if (this.btn) {
            this.btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.isEnabled) {
                    this.togglePanel();
                }
            });
        }

        const selector = document.getElementById('material-selector');
        if (selector) {
            selector.addEventListener('change', (e) => {
                this.currentMaterialId = e.target.value;
                this.calculateAndRender();
            });
        }

        // Add Template button
        if (this.addTemplateBtn) {
            this.addTemplateBtn.addEventListener('click', () => this.openTemplatePopup());
        }

        // Template popup close/cancel buttons
        const closeBtn = document.getElementById('template-popup-close');
        const cancelBtn = document.getElementById('template-cancel-btn');
        const okBtn = document.getElementById('template-ok-btn');

        if (closeBtn) closeBtn.addEventListener('click', () => this.closeTemplatePopup());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeTemplatePopup());
        if (okBtn) okBtn.addEventListener('click', () => this.onTemplateSelected());

        // Print button
        if (this.printBtn) {
            this.printBtn.addEventListener('click', () => this.enterPrintMode());
        }

        // ESC key handler for template mode
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.templateMode) {
                this.exitTemplatePlacementMode(true);
            }
        });

    }

    update(selectedObjects) {
        this.selectedObjects = selectedObjects || [];

        const closedGeoms = this.filterClosedGeometries(this.selectedObjects);
        this.isEnabled = closedGeoms.length > 0;

        // Update button state
        if (this.btn) {
            if (this.isEnabled) {
                this.btn.classList.remove('opacity-50', 'cursor-not-allowed');
                this.btn.classList.add('hover:bg-white/10');
            } else {
                this.btn.classList.add('opacity-50', 'cursor-not-allowed');
                this.btn.classList.remove('hover:bg-white/10');
            }
        }

        // Show/hide weight panel based on whether closed geometries are selected
        if (this.panel) {
            if (this.isEnabled) {
                this.panel.classList.remove('hidden');
                this.calculateAndRender();
            } else {
                this.panel.classList.add('hidden');
                this.clearVisualization();
            }
        }
    }

    togglePanel() {
        if (!this.panel || !this.isEnabled) return;

        const isHidden = this.panel.classList.contains('hidden');
        if (isHidden) {
            this.panel.classList.remove('hidden');
            this.calculateAndRender();
            this.visualize();
        } else {
            this.close();
        }
    }

    close() {
        if (this.panel) this.panel.classList.add('hidden');
        this.clearVisualization();
        if (this.onCloseCallback) {
            this.onCloseCallback();
        }
    }

    // Template popup methods
    async openTemplatePopup() {
        if (!this.templatePopup) return;

        // Load template list
        await this.loadTemplateList();

        // Show popup
        this.templatePopup.classList.remove('hidden');
    }

    closeTemplatePopup() {
        if (this.templatePopup) {
            this.templatePopup.classList.add('hidden');
        }
    }

    async loadTemplateList() {
        if (!this.templateSelector) return;

        // Known templates in the templates folder
        // In a real server environment, you'd fetch this list from the server
        const templates = [
            { name: 'A4 Dikey', file: 'A4 Dikey.dxf' },
            { name: 'A4 Yatay', file: 'A4 Yatay.dxf' }
        ];

        // Clear existing options
        this.templateSelector.innerHTML = '';

        if (templates.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Antet bulunamadı';
            this.templateSelector.appendChild(option);
            return;
        }

        templates.forEach(template => {
            const option = document.createElement('option');
            option.value = `templates/${template.file}`;
            option.textContent = template.name;
            this.templateSelector.appendChild(option);
        });
    }

    onTemplateSelected() {
        const selectedFile = this.templateSelector?.value;
        if (!selectedFile) {
            this.closeTemplatePopup();
            return;
        }

        console.log(`[WeightManager] Template selected: ${selectedFile}`);
        this.selectedTemplatePath = selectedFile;
        this.closeTemplatePopup();

        // Enter template placement mode
        this.enterTemplatePlacementMode();
    }

    // ========================================
    // TEMPLATE PLACEMENT MODE
    // ========================================

    async enterTemplatePlacementMode() {
        if (!this.selectedTemplatePath) {
            console.error('[WeightManager] Cannot enter template mode: no template selected');
            return;
        }

        console.log('[WeightManager] Entering template placement mode (NEW WORKFLOW)');
        console.log('[WeightManager] Selected objects count:', this.selectedObjects?.length);

        this.templateMode = true;
        this.scrollSteps = 0;
        this.templateScale = 1.0;
        this._hasLoggedPosition = false; // Reset debug flag

        // Step 1: Clone selected entities into floatingGroup
        this.floatingGroup = new THREE.Group();
        this.floatingGroup.name = 'FloatingGeometries';

        // Clone selected objects (previewMesh area)
        if (this.selectedObjects && this.selectedObjects.length > 0) {
            for (const obj of this.selectedObjects) {
                const clone = obj.clone();
                clone.userData.isFloatingClone = true;

                // Sanitize Material:
                // If original was highlighted, it has a cloned material with Cyan color.
                // We want to restore the original color and make it a "permanent" material.
                if (obj.userData.originalColor) {
                    // Clone material to detach from original
                    clone.material = clone.material.clone();

                    // Restore original color
                    clone.material.color.copy(obj.userData.originalColor);

                    // Sync userData.originalColor to match the restored material color exactly
                    // This fixes issues where JSON serialization in clone() might convert Color to plain object,
                    // or if originalColor was stale. We want the UNHOVER color to be what we see now.
                    clone.userData.originalColor = clone.material.color.clone();

                    // Remove "isClonedMaterial" flag so SceneViewer treats it as a normal object
                    // (This ensures auto-contrast logic works: Black/White swapping)
                    clone.userData.isClonedMaterial = false;
                    delete clone.userData.isClonedMaterial;

                    // Also ensure we don't carry over temporary highlight flags if any
                    // But keep crucial data like entity type
                }

                this.floatingGroup.add(clone);
            }
        } else {
            console.warn('[WeightManager] No selected objects to clone for placement!');
        }

        // Calculate floating group center
        if (this.floatingGroup.children.length > 0) {
            const floatBox = new THREE.Box3().setFromObject(this.floatingGroup);
            this.floatingCenter = floatBox.getCenter(new THREE.Vector3());
            console.log(`[WeightManager] Cloned ${this.floatingGroup.children.length} entities, center:`, this.floatingCenter);
        } else {
            console.warn('[WeightManager] Floating group is empty!');
            this.floatingCenter = new THREE.Vector3(0, 0, 0);
        }

        // Step 2: Clear dxfGroup (remove all existing entities)
        this.clearDxfGroup();

        // Step 3: Load template DXF into dxfGroup (fixed position)
        await this.loadTemplateDXF(this.selectedTemplatePath);

        // Step 4: Add floating group to scene (will follow mouse)
        this.viewer.scene.add(this.floatingGroup);
        console.log('[WeightManager] Floating group added to scene');

        // Show scale panel, hide weight panel
        if (this.panel) this.panel.classList.add('hidden');
        if (this.scalePanel) this.scalePanel.classList.remove('hidden');

        // Start mouse following (floating geometries follow mouse)
        this.startMouseFollowing();

        // Update scale display
        this.updateScaleDisplay();

        // Fit all to view
        this.viewer.zoomExtents();

        console.log('[WeightManager] Template placement mode active - geometries follow mouse');
    }

    clearDxfGroup() {
        if (!this.viewer.dxfGroup) return;

        // Store references but don't dispose (we might need them later)
        const children = [...this.viewer.dxfGroup.children];
        for (const child of children) {
            this.viewer.dxfGroup.remove(child);
        }
        console.log(`[WeightManager] Cleared ${children.length} entities from dxfGroup`);
    }

    storeOriginalSceneState() {
        this.originalSceneState = {
            backgroundColor: this.viewer.renderer.getClearColor(new THREE.Color()).getHex(),
            objectStates: []
        };

        // Store visibility state of all DXF objects
        if (this.viewer.dxfGroup) {
            this.viewer.dxfGroup.traverse((obj) => {
                if (obj.isMesh || obj.isLine || obj.isSprite) {
                    this.originalSceneState.objectStates.push({
                        object: obj,
                        visible: obj.visible,
                        color: obj.material?.color?.getHex()
                    });
                }
            });
        }
    }

    updateFloatingPosition(event) {
        if (!this.templateMode || !this.floatingGroup) return;

        // Get world position from mouse using THREE.js unprojection
        const rect = this.viewer.renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Create a vector at mouse position and unproject to world
        const vec = new THREE.Vector3(x, y, 0);
        vec.unproject(this.viewer.camera);

        // Position floating group so its center is at cursor
        // Account for scaling and original center offset
        const scaledCenterX = this.floatingCenter.x * this.templateScale;
        const scaledCenterY = this.floatingCenter.y * this.templateScale;

        // Log one-time debug for position
        if (!this._hasLoggedPosition) {
            console.log('[WeightManager] Updating floating position:', {
                mouseNDC: { x, y },
                mouseWorld: vec,
                floatingCenter: this.floatingCenter,
                scale: this.templateScale,
                finalPos: {
                    x: vec.x - scaledCenterX,
                    y: vec.y - scaledCenterY
                }
            });
            this._hasLoggedPosition = true;
        }

        // Set Z to 0.1 to ensure it sits above the template (Z=0)
        this.floatingGroup.position.set(
            vec.x - scaledCenterX,
            vec.y - scaledCenterY,
            0.1
        );
    }
    hideNonSelectedObjects() {
        // Hide all DXF objects
        if (this.viewer.dxfGroup) {
            this.viewer.dxfGroup.traverse((obj) => {
                if (obj.isMesh || obj.isLine || obj.isSprite) {
                    obj.visible = false;
                }
            });
        }

        // Keep preview mesh and debug circle visible (geometry stays at 1:1)
        if (this.previewMesh) this.previewMesh.visible = true;
        if (this.debugCircle) this.debugCircle.visible = true;
    }

    async loadTemplateDXF(path) {
        try {
            console.log(`[WeightManager] Loading template: ${path}`);

            // Fetch template file with cache busting
            const url = `${path}?t=${Date.now()}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch template: ${response.status}`);

            const dxfText = await response.text();

            // Parse using DxfParser
            const { DxfParser } = await import('dxf-parser');
            const parser = new DxfParser();
            const dxf = parser.parseSync(dxfText);

            // Create loader for generating entities
            const { DxfLoader } = await import('./dxf-loader.js');
            const loader = new DxfLoader();
            const templateEntities = loader.generateThreeEntities(dxf);

            // Add template entities directly to dxfGroup for OSNAP
            const children = [...templateEntities.children];
            for (const child of children) {
                child.userData.isTemplateEntity = true;
                this.viewer.dxfGroup.add(child);
            }

            // Store reference to template center for later use
            const box = new THREE.Box3().setFromObject(this.viewer.dxfGroup);
            this.templateCenter = box.getCenter(new THREE.Vector3());

            console.log(`[WeightManager] Template loaded with ${children.length} entities into dxfGroup`);

        } catch (err) {
            console.error('[WeightManager] Error loading template:', err);
        }
    }

    startMouseFollowing() {
        this._mouseMoveHandler = (e) => this.updateFloatingPosition(e);
        this._mouseClickHandler = (e) => this.placeFloatingGeometries(e);
        this._mouseWheelHandler = (e) => this.handleFloatingScroll(e);

        const canvas = this.viewer.renderer.domElement;
        canvas.addEventListener('mousemove', this._mouseMoveHandler);
        canvas.addEventListener('click', this._mouseClickHandler);
        // Use capture phase to intercept wheel event BEFORE viewport's zoom handler
        canvas.addEventListener('wheel', this._mouseWheelHandler, { passive: false, capture: true });
    }

    stopMouseFollowing() {
        const canvas = this.viewer.renderer.domElement;
        if (this._mouseMoveHandler) canvas.removeEventListener('mousemove', this._mouseMoveHandler);
        if (this._mouseClickHandler) canvas.removeEventListener('click', this._mouseClickHandler);
        // Must use same capture option when removing
        if (this._mouseWheelHandler) canvas.removeEventListener('wheel', this._mouseWheelHandler, { capture: true });
    }

    handleFloatingScroll(event) {
        if (!this.templateMode) return;

        event.preventDefault();
        event.stopPropagation();

        // Each scroll step = ±5% of original scale
        const delta = event.deltaY > 0 ? -1 : 1;
        this.scrollSteps += delta;
        this.templateScale = 1.0 + (0.05 * this.scrollSteps);
        this.templateScale = Math.max(0.1, Math.min(10, this.templateScale)); // Clamp 0.1 to 10

        this.applyFloatingScale();
        this.updateScaleDisplay();
    }

    applyFloatingScale() {
        if (this.floatingGroup) {
            this.floatingGroup.scale.set(this.templateScale, this.templateScale, 1);
        }
    }

    updateScaleDisplay() {
        const scaleEl = document.getElementById('val-scale');
        if (scaleEl) {
            // Format as 1:X or X:1
            if (this.templateScale >= 1) {
                scaleEl.textContent = `${this.templateScale.toFixed(1)}:1`;
            } else {
                scaleEl.textContent = `1:${(1 / this.templateScale).toFixed(1)}`;
            }
        }
    }

    placeFloatingGeometries(event) {
        if (!this.templateMode || !this.floatingGroup) return;

        console.log('[WeightManager] Placing floating geometries');

        // Stop mouse following
        this.stopMouseFollowing();

        // Get final floating group position and scale
        const position = this.floatingGroup.position.clone();
        const scale = this.templateScale;

        console.log('[WeightManager] Placing geometries:', {
            position: { x: position.x, y: position.y },
            scale: scale
        });

        // Merge floating entities into dxfGroup with scaling applied
        this.mergeFloatingIntoDxfGroup(position, scale);

        // Update template placeholders (text in template)
        this.updateTemplatePlaceholders();

        // Store scale value for printing
        this.calculatedValues['val-scale'] = scale >= 1 ?
            `${scale.toFixed(1)}:1` :
            `1:${(1 / scale).toFixed(1)}`;

        // Exit placement mode
        this.templateMode = false;

        // Show weight panel again, hide scale panel
        if (this.panel) this.panel.classList.remove('hidden');
        if (this.scalePanel) this.scalePanel.classList.add('hidden');

        // Fit to view
        this.viewer.zoomExtents();

        console.log('[WeightManager] Placement complete - OSNAP works on all entities');
    }

    mergeFloatingIntoDxfGroup(position, scale) {
        if (!this.floatingGroup || !this.viewer.dxfGroup) {
            console.warn('[WeightManager] Cannot merge floating: missing floatingGroup or dxfGroup');
            return;
        }

        // Collect all children to transfer
        const children = [...this.floatingGroup.children];

        for (const child of children) {
            // Apply scale to geometry (group scale was visual, now bake it)
            child.scale.multiplyScalar(scale);

            // Apply position offset (child position is relative to group)
            child.position.x = (child.position.x * scale) + position.x;
            child.position.y = (child.position.y * scale) + position.y;
            child.position.z = (child.position.z * scale) + position.z;

            // Update matrices
            child.updateMatrix();
            child.updateMatrixWorld(true);

            // Mark as placed geometry
            child.userData.isPlacedGeometry = true;
            child.userData.placementScale = scale;

            // Add to dxfGroup
            this.viewer.dxfGroup.add(child);
        }

        // Remove floating group from scene
        this.viewer.scene.remove(this.floatingGroup);
        this.floatingGroup = null;

        console.log(`[WeightManager] Merged ${children.length} floating entities into dxfGroup`);
    }

    mergeTemplateIntoDxfGroup(position, scale) {
        if (!this.templateGroup || !this.viewer.dxfGroup) {
            console.warn('[WeightManager] Cannot merge: missing templateGroup or dxfGroup');
            return;
        }

        // Collect all children to move (can't modify while iterating)
        const children = [...this.templateGroup.children];

        for (const child of children) {
            // Apply scale to geometry
            child.scale.multiplyScalar(scale);

            // Apply position offset
            child.position.x = child.position.x * scale + position.x;
            child.position.y = child.position.y * scale + position.y;
            child.position.z = child.position.z * scale + position.z;

            // Update world matrix
            child.updateMatrix();
            child.updateMatrixWorld(true);

            // Mark as template entity for identification
            child.userData.isTemplateEntity = true;
            child.userData.templateScale = scale;

            // Add to dxfGroup
            this.viewer.dxfGroup.add(child);
        }

        // Remove empty templateGroup from scene
        this.viewer.scene.remove(this.templateGroup);
        this.templateGroup = null;

        console.log(`[WeightManager] Merged ${children.length} entities into dxfGroup`);
    }

    updateTemplatePlaceholders() {
        if (!this.viewer.dxfGroup) return;

        console.log('[WeightManager] === TEMPLATE PLACEHOLDER DEBUG ===');

        // Collect calculated values
        const values = {
            'val-mandrel': document.getElementById('val-mandrel')?.textContent || '0',
            'val-area': document.getElementById('val-area')?.textContent || '0.00',
            'val-weight': document.getElementById('val-weight')?.textContent || '0.000',
            'val-diameter': document.getElementById('val-diameter')?.textContent || '0.00',
            'val-perimeter': document.getElementById('val-perimeter')?.textContent || '0.00',
            'val-totalperimeter': document.getElementById('val-totalperimeter')?.textContent || '0.00',
            'val-shapefactor': document.getElementById('val-shapefactor')?.textContent || '0.00',
            'val-scale': this.templateScale >= 1 ?
                `${this.templateScale.toFixed(1)}:1` :
                `1:${(1 / this.templateScale).toFixed(1)}`
        };

        console.log('[WeightManager] Placeholder values:', values);
        this.calculatedValues = values;

        // Debug: List all objects in template
        let textCount = 0;
        let meshCount = 0;
        let totalChildren = 0;

        // Iterate over dxfGroup instead of templateGroup
        this.viewer.dxfGroup.traverse((obj) => {
            totalChildren++;

            // Only process template entities
            if (!obj.userData.isTemplateEntity) return;

            // Log any mesh (text is created as Mesh in DxfLoader)
            if (obj.isMesh) {
                meshCount++;
            }

            // Log any object with TEXT/MTEXT in userData
            if (obj.userData.type === 'TEXT' || obj.userData.type === 'MTEXT') {
                textCount++;
                console.log(`[WeightManager] Found TEXT entity:`, {
                    isMesh: obj.isMesh,
                    isSprite: obj.isSprite,
                    type: obj.type,
                    visible: obj.visible,
                    text: obj.userData.entity?.text
                });
            }
        });

        console.log(`[WeightManager] Template children: ${totalChildren}, Meshes: ${meshCount}, TextEntities: ${textCount}`);

        // If no TEXT entities found, log all object types for debugging
        if (textCount === 0) {
            console.log('[WeightManager] No TEXT entities found. Object types in template:');
            this.viewer.dxfGroup.traverse((obj) => {
                if (obj.userData.isTemplateEntity && obj.userData.type) {
                    console.log(`  - ${obj.userData.type} (visible: ${obj.visible})`);
                }
            });
        }

        // Find TEXT/MTEXT objects in template and replace placeholders
        // DxfLoader creates Mesh for TEXT, not Sprite
        this.viewer.dxfGroup.traverse((obj) => {
            // Only process template entities
            if (!obj.userData.isTemplateEntity) return;

            if (obj.isMesh && (obj.userData.type === 'TEXT' || obj.userData.type === 'MTEXT')) {
                // Get original text
                let text = obj.userData.originalText || obj.userData.entity?.text || '';

                // Replace %placeholder% patterns
                let replaced = false;
                for (const [key, value] of Object.entries(values)) {
                    const pattern = new RegExp(`%${key}%`, 'gi');
                    if (pattern.test(text)) {
                        text = text.replace(pattern, value);
                        replaced = true;
                    }
                }

                if (replaced) {
                    console.log(`[WeightManager] Updating placeholder text to: "${text}"`);
                    obj.userData.updatedText = text;

                    // Regenerate texture with new text
                    this.regenerateTextTexture(obj, text);
                }
            }
        });

        console.log('[WeightManager] === END PLACEHOLDER DEBUG ===');
    }

    regenerateTextTexture(mesh, newText) {
        // Get mesh properties
        const height = mesh.userData.entity?.height || 2.5;

        // Create canvas texture with new text
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontSizePx = 80;

        ctx.font = `Bold ${fontSizePx}px Arial`;
        const metrics = ctx.measureText(newText);
        const textWidth = metrics.width;
        const textHeight = fontSizePx * 1.4;

        canvas.width = textWidth + 20;
        canvas.height = textHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `Bold ${fontSizePx}px Arial`;

        // Use white color for visibility
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(newText, 10, canvas.height / 2);

        // Update texture
        const newTexture = new THREE.CanvasTexture(canvas);
        newTexture.minFilter = THREE.LinearFilter;
        newTexture.magFilter = THREE.LinearFilter;

        // Dispose old texture
        if (mesh.material.map) {
            mesh.material.map.dispose();
        }
        mesh.material.map = newTexture;
        mesh.material.needsUpdate = true;

        // Update geometry size
        const aspect = canvas.width / canvas.height;
        const w = height * aspect;
        const h = height;

        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(w, h);
        mesh.geometry.translate(w / 2, 0, 0);
    }

    restoreObjectVisibility() {
        if (!this.originalSceneState) return;

        // Restore visibility (but not colors - those change in print mode)
        for (const state of this.originalSceneState.objectStates) {
            state.object.visible = state.visible;
        }
    }

    exitTemplatePlacementMode(cancelled = false) {
        console.log(`[WeightManager] Exiting template placement mode, cancelled: ${cancelled}`);

        this.templateMode = false;
        this.stopMouseFollowing();

        if (cancelled) {
            // Remove template
            if (this.templateGroup) {
                this.viewer.scene.remove(this.templateGroup);
                this.templateGroup = null;
            }

            // Restore original visibility
            this.restoreObjectVisibility();
        }

        // Show weight panel, hide scale panel
        if (this.panel) this.panel.classList.remove('hidden');
        if (this.scalePanel) this.scalePanel.classList.add('hidden');

        console.log('[WeightManager] Template placement mode exited');
    }

    // ========================================
    // PRINT MODE - Rectangle Selection
    // ========================================

    enterPrintMode() {
        console.log('[WeightManager] Entering print selection mode');
        this.printMode = true;
        this.printSelectionStart = null;
        this.printSelectionEnd = null;

        // Create selection box element if not exists
        if (!this.printSelectionBox) {
            this.printSelectionBox = document.createElement('div');
            this.printSelectionBox.className = 'print-selection-box';
            this.printSelectionBox.style.cssText = `
                position: fixed;
                border: 2px dashed #ff6600;
                background: rgba(255, 102, 0, 0.1);
                pointer-events: none;
                display: none;
                z-index: 1000;
            `;
            document.body.appendChild(this.printSelectionBox);
        }

        // Show instruction to user
        this.showPrintInstruction();

        // Bind mouse events for selection - using click for OSNAP support
        this.printClick = (e) => this.onPrintSelectionStart(e);
        this.printMouseMove = (e) => this.onPrintSelectionMove(e);
        this.printKeyDown = (e) => {
            if (e.key === 'Escape') this.cancelPrintSelection();
        };

        const canvas = this.viewer.renderer.domElement;
        canvas.addEventListener('click', this.printClick);
        canvas.addEventListener('mousemove', this.printMouseMove);
        document.addEventListener('keydown', this.printKeyDown);

        // Change cursor
        canvas.style.cursor = 'crosshair';
    }

    showPrintInstruction() {
        // Show a floating instruction message
        if (!this.printInstructionEl) {
            this.printInstructionEl = document.createElement('div');
            this.printInstructionEl.style.cssText = `
                position: fixed;
                top: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 1001;
            `;
            document.body.appendChild(this.printInstructionEl);
        }
        this.printInstructionEl.textContent = 'Yazdırma alanını seçmek için dikdörtgen çizin. ESC ile iptal.';
        this.printInstructionEl.style.display = 'block';
    }

    hidePrintInstruction() {
        if (this.printInstructionEl) {
            this.printInstructionEl.style.display = 'none';
        }
    }

    getSnapOrScreenPoint(e) {
        const rect = this.viewer.renderer.domElement.getBoundingClientRect();

        // Default: Mouse position relative to canvas
        let screenX = e.clientX - rect.left;
        let screenY = e.clientY - rect.top;

        // Check for active snap
        if (this.snappingManager && this.snappingManager.activeSnap) {
            const snapPoint = this.snappingManager.activeSnap.point;

            // Project 3D snap point to 2D screen coordinates
            const vector = snapPoint.clone();
            vector.project(this.viewer.camera);

            screenX = (vector.x * .5 + .5) * rect.width;
            screenY = (-(vector.y * .5) + .5) * rect.height;
        }

        return { x: screenX, y: screenY };
    }

    onPrintSelectionStart(e) {
        if (!this.printMode) return;

        // Get coordinates (snapped if available)
        const point = this.getSnapOrScreenPoint(e);
        const screenX = point.x;
        const screenY = point.y;

        const rect = this.viewer.renderer.domElement.getBoundingClientRect();



        // First click - set start point
        if (!this.printSelectionStart) {
            this.printSelectionStart = { screenX, screenY };
            this.printSelectionBox.style.display = 'block';
            // Use client coordinates for fixed position
            // We need to convert back from canvas-relative to client-relative for fixed positioning
            this.printSelectionBox.style.left = `${rect.left + screenX}px`;
            this.printSelectionBox.style.top = `${rect.top + screenY}px`;
            this.printSelectionBox.style.width = '0px';
            this.printSelectionBox.style.height = '0px';

            // Update instruction
            if (this.printInstructionEl) {
                this.printInstructionEl.textContent = 'İkinci köşeyi tıklayın. ESC ile iptal.';
            }
            return;
        }

        // Second click - set end point and capture
        const x1 = Math.min(this.printSelectionStart.screenX, screenX);
        const y1 = Math.min(this.printSelectionStart.screenY, screenY);
        const x2 = Math.max(this.printSelectionStart.screenX, screenX);
        const y2 = Math.max(this.printSelectionStart.screenY, screenY);

        const width = x2 - x1;
        const height = y2 - y1;

        // Minimum selection size
        if (width < 10 || height < 10) { // Reduced min size for precision
            console.log('[WeightManager] Selection too small, resetting');
            this.printSelectionStart = null;
            this.printSelectionBox.style.display = 'none';
            if (this.printInstructionEl) {
                this.printInstructionEl.textContent = 'Yazdırma alanını seçmek için iki köşeye tıklayın. ESC ile iptal.';
            }
            return;
        }

        console.log('[WeightManager] Print selection:', { x1, y1, x2, y2, width, height });

        // Capture and print the selected area
        this.captureAndPrint(x1, y1, width, height);
    }

    onPrintSelectionMove(e) {
        if (!this.printMode || !this.printSelectionStart) return;

        // Get coordinates (snapped if available)
        const point = this.getSnapOrScreenPoint(e);
        const currentX = point.x;
        const currentY = point.y;

        const rect = this.viewer.renderer.domElement.getBoundingClientRect();

        const left = Math.min(this.printSelectionStart.screenX, currentX);
        const top = Math.min(this.printSelectionStart.screenY, currentY);
        const width = Math.abs(currentX - this.printSelectionStart.screenX);
        const height = Math.abs(currentY - this.printSelectionStart.screenY);

        // Fixed position uses viewport coordinates
        this.printSelectionBox.style.left = `${rect.left + left}px`;
        this.printSelectionBox.style.top = `${rect.top + top}px`;
        this.printSelectionBox.style.width = `${width}px`;
        this.printSelectionBox.style.height = `${height}px`;
    }

    onPrintSelectionEnd(e) {
        // Not used in 2-click mode
    }

    cancelPrintSelection() {
        console.log('[WeightManager] Print selection cancelled');
        this.exitPrintMode();
    }

    captureAndPrint(x, y, width, height) {
        console.log('[WeightManager] Capturing area for HIGH-RES print');

        // Target: 300 DPI for A4 printing (Standard High Quality)
        // User requested lower resolution ~3000x4000
        const TARGET_DPI = 300;
        const SCREEN_DPI = 96;
        const SCALE_FACTOR = TARGET_DPI / SCREEN_DPI; // ~6.25x

        const targetWidth = Math.round(width * SCALE_FACTOR);
        const targetHeight = Math.round(height * SCALE_FACTOR);

        console.log(`[WeightManager] Scale factor: ${SCALE_FACTOR}, Target: ${targetWidth}x${targetHeight}`);

        // Store original renderer size
        const renderer = this.viewer.renderer;
        const canvas = renderer.domElement;
        const originalWidth = canvas.width;
        const originalHeight = canvas.height;
        const originalStyleWidth = canvas.style.width;
        const originalStyleHeight = canvas.style.height;

        // Calculate the world coordinates of the selection area
        const rect = canvas.getBoundingClientRect();

        // Convert screen coords to normalized device coords (-1 to 1)
        const ndcX1 = ((x) / rect.width) * 2 - 1;
        const ndcY1 = -((y) / rect.height) * 2 + 1;
        const ndcX2 = ((x + width) / rect.width) * 2 - 1;
        const ndcY2 = -((y + height) / rect.height) * 2 + 1;

        // Unproject to get world coordinates
        const topLeft = new THREE.Vector3(ndcX1, ndcY1, 0).unproject(this.viewer.camera);
        const bottomRight = new THREE.Vector3(ndcX2, ndcY2, 0).unproject(this.viewer.camera);

        // Store original camera state
        const origCamLeft = this.viewer.camera.left;
        const origCamRight = this.viewer.camera.right;
        const origCamTop = this.viewer.camera.top;
        const origCamBottom = this.viewer.camera.bottom;
        const origCamZoom = this.viewer.camera.zoom;
        const origCamPos = this.viewer.camera.position.clone();

        // Hide preview elements
        const previewWasVisible = this.previewMesh ? this.previewMesh.visible : false;
        if (this.previewMesh) this.previewMesh.visible = false;

        // Store original background and colors
        const originalBg = this.viewer.scene.background ? this.viewer.scene.background.clone() : null;
        const colorBackup = [];

        this.viewer.scene.traverse((obj) => {
            if (obj.material && obj.material.color) {
                colorBackup.push({ obj, color: obj.material.color.getHex() });
                obj.material.color.setHex(0x000000);
            }
        });

        // Set white background
        this.viewer.scene.background = new THREE.Color(0xffffff);

        // Resize renderer to target high-resolution
        renderer.setSize(targetWidth, targetHeight, false);
        canvas.style.width = targetWidth + 'px';
        canvas.style.height = targetHeight + 'px';

        // Adjust camera frustum to show only the selected area
        const worldWidth = Math.abs(bottomRight.x - topLeft.x);
        const worldHeight = Math.abs(topLeft.y - bottomRight.y);
        const centerX = (topLeft.x + bottomRight.x) / 2;
        const centerY = (topLeft.y + bottomRight.y) / 2;

        this.viewer.camera.left = -worldWidth / 2;
        this.viewer.camera.right = worldWidth / 2;
        this.viewer.camera.top = worldHeight / 2;
        this.viewer.camera.bottom = -worldHeight / 2;
        this.viewer.camera.zoom = 1;
        this.viewer.camera.position.set(centerX, centerY, origCamPos.z);
        this.viewer.camera.updateProjectionMatrix();

        // Render at high resolution
        renderer.render(this.viewer.scene, this.viewer.camera);

        // Capture high-res image
        const imageData = canvas.toDataURL('image/png');

        // Restore camera
        this.viewer.camera.left = origCamLeft;
        this.viewer.camera.right = origCamRight;
        this.viewer.camera.top = origCamTop;
        this.viewer.camera.bottom = origCamBottom;
        this.viewer.camera.zoom = origCamZoom;
        this.viewer.camera.position.copy(origCamPos);
        this.viewer.camera.updateProjectionMatrix();

        // Restore renderer size
        renderer.setSize(originalWidth, originalHeight, false);
        canvas.style.width = originalStyleWidth;
        canvas.style.height = originalStyleHeight;

        // Restore background and colors
        this.viewer.scene.background = originalBg;
        for (const { obj, color } of colorBackup) {
            obj.material.color.setHex(color);
        }

        // Restore preview mesh
        if (this.previewMesh) this.previewMesh.visible = previewWasVisible;

        // Render restored state
        renderer.render(this.viewer.scene, this.viewer.camera);

        // Open print window with high-res image
        this.openPrintWindow(imageData, targetWidth, targetHeight);

        // Exit print mode
        this.exitPrintMode();
    }

    openPrintWindow(imageData, width, height) {
        // Open new window with image for printing
        const printWindow = window.open('', '_blank', `width=${width},height=${height}`);
        if (!printWindow) {
            alert('Popup engelleyici aktif. Lütfen izin verin.');
            return;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Debug - ${width}x${height}</title>

                <style>
                    /* ===================== */
                    /* PRINT STYLES (A4 REAL) */
                    /* ===================== */
                    @media print {
                        @page {
                            size: ${width > height ? '297mm 210mm' : '210mm 297mm'};
                            margin: 0;
                        }

                        html, body {
                            width: 100%;
                            height: 100%;
                            margin: 0;
                            padding: 0;
                        }

                        body {
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            background: white;
                        }

                        img {
                            width: 100%;
                            height: 100%;
                            object-fit: cover; /* BOŞLUK İSTEMİYORSAN ŞART */
                        }

                        .no-print {
                            display: none !important;
                        }
                    }

                    /* ===================== */
                    /* SCREEN PREVIEW STYLES */
                    /* ===================== */
                    @media screen {
                        body {
                            margin: 0;
                            background: #eee;
                            height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }

                        img {
                            max-width: 90%;
                            max-height: 90vh;
                            background: white;
                            box-shadow: 0 0 10px rgba(0,0,0,0.5);
                        }

                        .controls {
                            position: fixed;
                            top: 20px;
                            right: 20px;
                            background: white;
                            padding: 10px;
                            border-radius: 4px;
                            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                            z-index: 100;
                            font-family: Arial, sans-serif;
                        }

                        button {
                            padding: 8px 14px;
                            font-size: 13px;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            color: white;
                        }

                        .print-btn { background: #4CAF50; }
                        .close-btn { background: #f44336; margin-left: 8px; }
                    }
                </style>
            </head>

            <body>
                <div class="controls no-print">
                    <div style="font-size:12px; color:#666; margin-bottom:6px;">
                        ${width} × ${height}px<br>
                        ${Math.round(width / 96)} × ${Math.round(height / 96)} inç @ 96DPI
                    </div>
                    <button class="print-btn" onclick="window.print()">🖨️ Yazdır / PDF</button>
                    <button class="close-btn" onclick="window.close()">Kapat</button>
                </div>

                <img src="${imageData}" alt="Print Image">

            </body>
            </html>
            `);
        printWindow.document.close();

    }

    exitPrintMode() {
        console.log('[WeightManager] Exiting print mode');
        this.printMode = false;

        // Remove event listeners
        const canvas = this.viewer.renderer.domElement;
        if (this.printClick) canvas.removeEventListener('click', this.printClick);
        if (this.printMouseMove) canvas.removeEventListener('mousemove', this.printMouseMove);
        if (this.printKeyDown) document.removeEventListener('keydown', this.printKeyDown);

        // Reset cursor
        canvas.style.cursor = 'default';

        // Hide selection box
        if (this.printSelectionBox) {
            this.printSelectionBox.style.display = 'none';
        }

        // Hide instruction
        this.hidePrintInstruction();

        // Reset selection state
        this.printSelectionStart = null;
        this.printSelectionEnd = null;
    }


    filterClosedGeometries(objects) {
        const results = [];

        // 1. Check for single closed entities
        const singleClosed = [];
        const potentialChainObjects = [];

        for (const obj of objects) {
            const type = obj.userData.type;
            const entity = obj.userData.entity;

            if (type === 'CIRCLE') {
                results.push({ type: 'single', objects: [obj] });
                continue;
            }

            if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && (entity.closed || (entity.flag & 1) === 1)) {
                results.push({ type: 'single', objects: [obj] });
                continue;
            }

            if (obj.isGroup && (obj.userData.type === 'LWPOLYLINE' || obj.userData.type === 'POLYLINE')) {
                if (entity && (entity.closed || (entity.flag & 1) === 1)) {
                    results.push({ type: 'single', objects: [obj] });
                    continue;
                }
            }

            // If not a closed single entity, it might be part of a chain
            if (type === 'LINE' || type === 'ARC') {
                potentialChainObjects.push(obj);
            }
        }

        // 2. Try to find multiple chains from remaining objects
        if (potentialChainObjects.length > 1) {
            const chains = this.findAllChains(potentialChainObjects);
            console.log(`[filterClosedGeometries] Found ${chains.length} chains from ${potentialChainObjects.length} objects`);
            results.push(...chains);
        }

        return results;
    }

    calculateAndRender() {
        const closedGeoms = this.filterClosedGeometries(this.selectedObjects);
        console.log(`[WeightManager] Found ${closedGeoms.length} closed geometries:`, closedGeoms);
        if (closedGeoms.length === 0) return;

        const items = closedGeoms.map(geomEntry => {
            const area = this.calculateArea(geomEntry);
            const perimeter = this.calculatePerimeter(geomEntry);
            console.log(`  - Type: ${geomEntry.type}, Area: ${area.toFixed(2)}, Perimeter: ${perimeter.toFixed(2)}`);
            return {
                geomEntry: geomEntry,
                area: area,
                perimeter: perimeter
            };
        });

        items.sort((a, b) => b.area - a.area);

        const outer = items[0];
        const inner = items.slice(1);

        console.log(`[WeightManager] Outer area: ${outer.area.toFixed(2)}, Outer perimeter: ${outer.perimeter.toFixed(2)}, Inner count: ${inner.length}`);

        const outerArea = outer.area;
        const innerAreaSum = inner.reduce((sum, item) => sum + item.area, 0);
        const netArea = outerArea - innerAreaSum;

        // Outer perimeter (dış çevre) - the perimeter of the largest geometry
        const outerPerimeter = outer.perimeter;

        // Total perimeter (toplam çevre) - sum of all perimeters (inner + outer)
        const totalPerimeter = items.reduce((sum, item) => sum + item.perimeter, 0);

        console.log(`[WeightManager] Net area: ${netArea.toFixed(2)} (${outerArea.toFixed(2)} - ${innerAreaSum.toFixed(2)})`);
        console.log(`[WeightManager] Outer perimeter: ${outerPerimeter.toFixed(2)}, Total perimeter: ${totalPerimeter.toFixed(2)}`);

        const mandrelCount = Math.max(0, closedGeoms.length - 1);
        const material = MATERIALS.find(m => m.id === this.currentMaterialId) || MATERIALS[0];
        const weight = (netArea * material.density) / 1000;

        // Shape factor: Total Perimeter (cm) / Weight (kg/m)
        // totalPerimeter is in mm, convert to cm by dividing by 10
        const perimeterCm = totalPerimeter / 10;
        const shapeFactor = weight > 0 ? perimeterCm / weight : 0;

        this.updateDOM('val-mandrel', mandrelCount);
        this.updateDOM('val-area', netArea.toFixed(2));
        this.updateDOM('val-weight', weight.toFixed(3));
        this.updateDOM('val-perimeter', outerPerimeter.toFixed(2));
        this.updateDOM('val-totalperimeter', totalPerimeter.toFixed(2));
        this.updateDOM('val-shapefactor', shapeFactor.toFixed(2));

        this.calculationResult = { outer: outer.geomEntry, inner: inner.map(i => i.geomEntry) };
        this.visualize();

        // Calculate bounding circle AFTER visualization (when mesh is created)
        if (this.previewMesh && this.previewMesh.geometry) {
            const circleData = this.calculateBoundingCircleFromMesh(this.previewMesh.geometry);
            this.boundingCircle = circleData;
            this.updateDOM('val-diameter', circleData.diameter.toFixed(2));

            // Re-visualize to add debug circle
            this.visualizeDebugCircle();
        }
    }

    calculateBoundingCircleFromMesh(geometry) {
        const positions = geometry.attributes.position;
        if (!positions) return { diameter: 0, center: { x: 0, y: 0 }, radius: 0 };

        // Extract all vertices from tessellated geometry
        const points = [];
        for (let i = 0; i < positions.count; i++) {
            points.push({
                x: positions.getX(i),
                y: positions.getY(i)
            });
        }

        console.log(`[calculateBoundingCircleFromMesh] Using ${points.length} tessellated vertices`);

        // Use Welzl's algorithm for minimum enclosing circle
        const result = this.minimumEnclosingCircle(points);

        return {
            diameter: result.diameter,
            center: { x: result.center.x, y: result.center.y },
            radius: result.radius
        };
    }

    // Welzl's algorithm for minimum enclosing circle
    minimumEnclosingCircle(points) {
        // Fisher–Yates shuffle (required for Welzl)
        const pts = points.slice();
        for (let i = pts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pts[i], pts[j]] = [pts[j], pts[i]];
        }

        let c = null;

        for (let i = 0; i < pts.length; i++) {
            if (c && this.circleContains(c, pts[i])) continue;

            c = { center: pts[i], radius: 0 };

            for (let j = 0; j < i; j++) {
                if (this.circleContains(c, pts[j])) continue;

                c = this.circleFrom2Points(pts[i], pts[j]);

                for (let k = 0; k < j; k++) {
                    if (this.circleContains(c, pts[k])) continue;
                    c = this.circleFrom3Points(pts[i], pts[j], pts[k]);
                }
            }
        }

        return {
            center: { x: c.center.x, y: c.center.y },
            radius: c.radius,
            diameter: c.radius * 2
        };
    }

    circleContains(c, p) {
        return Math.hypot(p.x - c.center.x, p.y - c.center.y) <= c.radius + 1e-6;
    }

    circleFrom2Points(a, b) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        return {
            center: { x: cx, y: cy },
            radius: Math.hypot(a.x - cx, a.y - cy)
        };
    }

    circleFrom3Points(a, b, c) {
        const d = 2 * (
            a.x * (b.y - c.y) +
            b.x * (c.y - a.y) +
            c.x * (a.y - b.y)
        );

        if (Math.abs(d) < 1e-12) {
            // Points are collinear, use circle from 2 points
            return this.circleFrom2Points(a, b);
        }

        const ux = (
            (a.x * a.x + a.y * a.y) * (b.y - c.y) +
            (b.x * b.x + b.y * b.y) * (c.y - a.y) +
            (c.x * c.x + c.y * c.y) * (a.y - b.y)
        ) / d;

        const uy = (
            (a.x * a.x + a.y * a.y) * (c.x - b.x) +
            (b.x * b.x + b.y * b.y) * (a.x - c.x) +
            (c.x * c.x + c.y * c.y) * (b.x - a.x)
        ) / d;

        return {
            center: { x: ux, y: uy },
            radius: Math.hypot(a.x - ux, a.y - uy)
        };
    }

    calculateBoundingCircleDiameter(geomEntry) {
        // Extract all vertices from the geometry
        let vertices = [];

        if (geomEntry.type === 'single') {
            const entity = geomEntry.objects[0].userData.entity;
            if (entity && entity.vertices) {
                vertices = entity.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 }));
            }
        } else if (geomEntry.type === 'chain' && geomEntry.vertices) {
            vertices = geomEntry.vertices.map(v => ({ x: v.x, y: v.y, bulge: v.bulge || 0 }));
        }

        if (vertices.length === 0) return 0;

        // Sample points along arcs (only POSITIVE bulge - outward arcs)
        const points = [];
        const n = vertices.length;

        for (let i = 0; i < n; i++) {
            const v1 = vertices[i];
            const v2 = vertices[(i + 1) % n];

            // Always add vertex
            points.push({ x: v1.x, y: v1.y });

            // Sample ALL arcs (both positive and negative bulge can expand boundary)
            if (v1.bulge && Math.abs(v1.bulge) > 0.001) {
                const bulge = v1.bulge;
                const theta = 4 * Math.atan(Math.abs(bulge));
                const chord = Math.hypot(v2.x - v1.x, v2.y - v1.y);

                if (chord > 0.001) {
                    const radius = chord / (2 * Math.sin(theta / 2));

                    // Calculate arc center
                    const midX = (v1.x + v2.x) / 2;
                    const midY = (v1.y + v2.y) / 2;
                    const chordAngle = Math.atan2(v2.y - v1.y, v2.x - v1.x);
                    const sagitta = radius * (1 - Math.cos(theta / 2));

                    // Offset direction depends on bulge sign
                    const offsetAngle = chordAngle + (bulge > 0 ? Math.PI / 2 : -Math.PI / 2);
                    const cx = midX + sagitta * Math.cos(offsetAngle);
                    const cy = midY + sagitta * Math.sin(offsetAngle);

                    // Sample arc points
                    const samples = 8;
                    const startAngle = Math.atan2(v1.y - cy, v1.x - cx);
                    for (let j = 1; j < samples; j++) {
                        const t = j / samples;
                        const angle = startAngle + (bulge > 0 ? t * theta : -t * theta);
                        points.push({
                            x: cx + radius * Math.cos(angle),
                            y: cy + radius * Math.sin(angle)
                        });
                    }
                }
            }
        }

        // Use bounding box for minimum enclosing circle approximation
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const p of points) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }

        console.log(`[calculateBoundingCircle] Sampled ${points.length} points, bbox: (${minX.toFixed(1)},${minY.toFixed(1)}) to (${maxX.toFixed(1)},${maxY.toFixed(1)})`);

        // Circle center is bounding box center
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        // Radius is the maximum distance from center to any sampled point
        let radius = 0;
        for (const p of points) {
            const dist = Math.hypot(p.x - centerX, p.y - centerY);
            radius = Math.max(radius, dist);
        }

        return {
            diameter: radius * 2,
            center: { x: centerX, y: centerY },
            radius: radius
        };
    }

    updateDOM(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    calculateArea(geomEntry) {
        if (geomEntry.type === 'single') {
            return this.calculateSingleArea(geomEntry.objects[0]);
        }

        if (geomEntry.type === 'chain') {
            return this.calculateChainArea(geomEntry.vertices);
        }

        return 0;
    }

    calculatePerimeter(geomEntry) {
        if (geomEntry.type === 'single') {
            return this.calculateSinglePerimeter(geomEntry.objects[0]);
        }

        if (geomEntry.type === 'chain') {
            return this.calculateChainPerimeter(geomEntry.vertices);
        }

        return 0;
    }

    calculateSinglePerimeter(obj) {
        const type = obj.userData.type;
        const entity = obj.userData.entity;

        if (type === 'CIRCLE') {
            return 2 * Math.PI * entity.radius;
        }

        if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
            if (entity && entity.vertices && entity.vertices.length > 0) {
                const v = entity.vertices;
                const n = v.length;
                let perimeter = 0;

                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    const p1 = v[i], p2 = v[j];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const chord = Math.hypot(dx, dy);

                    const bulge = v[i].bulge || 0;
                    if (bulge !== 0 && chord > 0) {
                        // Arc length calculation
                        const theta = 4 * Math.atan(Math.abs(bulge));
                        const radius = chord / (2 * Math.sin(theta / 2));
                        const arcLength = radius * theta;
                        perimeter += arcLength;
                    } else {
                        perimeter += chord;
                    }
                }

                return perimeter;
            }
        }
        return 0;
    }

    calculateChainPerimeter(vertices) {
        const n = vertices.length;
        if (n < 2) return 0;

        let perimeter = 0;

        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const p1 = vertices[i], p2 = vertices[j];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const chord = Math.hypot(dx, dy);

            const bulge = vertices[i].bulge || 0;
            if (bulge !== 0 && chord > 0) {
                // Arc length calculation
                const theta = 4 * Math.atan(Math.abs(bulge));
                const radius = chord / (2 * Math.sin(theta / 2));
                const arcLength = radius * theta;
                perimeter += arcLength;
            } else {
                perimeter += chord;
            }
        }

        return perimeter;
    }

    calculateSingleArea(obj) {
        const type = obj.userData.type;
        const entity = obj.userData.entity;

        if (type === 'CIRCLE') {
            return Math.PI * entity.radius * entity.radius;
        }

        if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
            if (entity && entity.vertices && entity.vertices.length > 0) {
                const v = entity.vertices;
                const n = v.length;

                // 1) Shoelace (signed chord area *2)
                let chord2 = 0;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    chord2 += v[i].x * v[j].y - v[j].x * v[i].y;
                }

                // Polyline yönü: + => CCW, - => CW
                const winding = (chord2 === 0) ? 1 : Math.sign(chord2);

                // 2) Bulge düzeltmesi (signed *2 değil, doğrudan alana eklenecek)
                let corr = 0;
                for (let i = 0; i < n; i++) {
                    const j = (i + 1) % n;
                    const b = v[i].bulge || 0;
                    if (b === 0) continue;

                    const p1 = v[i], p2 = v[j];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const c = Math.hypot(dx, dy);
                    if (c === 0) continue;

                    // Arc segment area correction
                    const absBulge = Math.abs(b);
                    const theta = 4 * Math.atan(absBulge);
                    const radius = c / (2 * Math.sin(theta / 2));
                    const segmentArea = (radius * radius / 2) * (theta - Math.sin(theta));

                    // CRITICAL FIX: Arc contribution depends ONLY on bulge sign, not winding!
                    // Winding affects chord area, but arc segment area sign is determined by arc direction
                    const contribution = Math.sign(b) * segmentArea;
                    corr += contribution;
                }

                const totalSigned = (chord2 / 2) + corr;
                return Math.abs(totalSigned);
            }
        }
        return 0;
    }

    calculateChainArea(vertices) {
        const n = vertices.length;
        if (n < 3) return 0;

        // 1) Shoelace for chord area
        let chord2 = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            chord2 += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
        }

        const winding = Math.sign(chord2 || 1);

        // 2) Bulge corrections
        let corr = 0;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const b = vertices[i].bulge || 0;
            if (b === 0) continue;

            const dx = vertices[j].x - vertices[i].x;
            const dy = vertices[j].y - vertices[i].y;
            const c = Math.hypot(dx, dy);
            if (c === 0) continue;

            // Arc segment area correction
            const absBulge = Math.abs(b);
            const theta = 4 * Math.atan(absBulge);
            const radius = c / (2 * Math.sin(theta / 2));
            const segmentArea = (radius * radius / 2) * (theta - Math.sin(theta));

            // Arc contribution depends ONLY on bulge sign, not winding
            corr += Math.sign(b) * segmentArea;
        }

        return Math.abs((chord2 / 2) + corr);
    }


    visualize() {
        this.clearVisualization();
        if (!this.calculationResult) return;

        const outerGeom = this.calculationResult.outer;
        const outerShape = this.createShapeFromObject(outerGeom);
        if (!outerShape) {
            console.warn('[WeightManager] Failed to create outer shape');
            return;
        }

        console.log(`[WeightManager] Visualizing: outer created, ${this.calculationResult.inner.length} inner geometries`);

        this.calculationResult.inner.forEach((innerGeom, idx) => {
            const innerPath = this.createShapeFromObject(innerGeom);
            if (innerPath) {
                outerShape.holes.push(innerPath);
                console.log(`  - Added hole ${idx + 1}`);
            } else {
                console.warn(`  - Failed to create hole ${idx + 1}`);
            }
        });

        console.log(`[WeightManager] Total holes: ${outerShape.holes.length}`);

        const geometry = new THREE.ShapeGeometry(outerShape);
        this.previewMesh = new THREE.Mesh(geometry, this.previewMaterial);
        this.previewMesh.position.z = 0.1;
        this.previewMesh.renderOrder = 999;
        if (this.viewer && this.viewer.scene) {
            this.viewer.scene.add(this.previewMesh);
        }

        this.visualizeDebugCircle();
    }

    visualizeDebugCircle() {
        // Clean up old debug circle
        if (this.debugCircle) {
            if (this.viewer && this.viewer.scene) {
                this.viewer.scene.remove(this.debugCircle);
            }
            if (this.debugCircle.geometry) this.debugCircle.geometry.dispose();
            this.debugCircle = null;
        }

        // DEBUG: Visualize bounding circle
        if (this.boundingCircle && this.viewer && this.viewer.scene) {
            const circleGeometry = new THREE.BufferGeometry();
            const segments = 64;
            const vertices = [];

            for (let i = 0; i <= segments; i++) {
                const theta = (i / segments) * Math.PI * 2;
                const x = this.boundingCircle.center.x + this.boundingCircle.radius * Math.cos(theta);
                const y = this.boundingCircle.center.y + this.boundingCircle.radius * Math.sin(theta);
                vertices.push(x, y, 0);
            }

            circleGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

            const circleMaterial = new THREE.LineBasicMaterial({
                color: 0xff00ff, // Magenta for visibility
                linewidth: 2,
                depthTest: false
            });

            this.debugCircle = new THREE.Line(circleGeometry, circleMaterial);
            this.debugCircle.renderOrder = 1000;
            this.viewer.scene.add(this.debugCircle);

            console.log(`[DEBUG] Bounding circle: center=(${this.boundingCircle.center.x.toFixed(2)},${this.boundingCircle.center.y.toFixed(2)}), radius=${this.boundingCircle.radius.toFixed(2)}, diameter=${this.boundingCircle.diameter.toFixed(2)}`);
        }
    }

    createShapeFromObject(geomEntry) {
        if (geomEntry.type === 'single') {
            return this.createShapeFromSingle(geomEntry.objects[0]);
        }

        if (geomEntry.type === 'chain') {
            return this.createShapeFromChain(geomEntry.vertices);
        }

        return null;
    }

    createShapeFromSingle(obj) {
        const type = obj.userData.type;
        const entity = obj.userData.entity;
        const isClosed = !!(entity.closed || ((entity.flag & 1) === 1));

        if (type === 'CIRCLE') {
            const shape = new THREE.Shape();
            shape.absarc(entity.center.x, entity.center.y, entity.radius, 0, Math.PI * 2, false);
            return shape;
        } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
            if (entity && entity.vertices && entity.vertices.length > 0) {
                const shape = new THREE.Shape();
                const v = entity.vertices;
                const n = v.length;
                shape.moveTo(v[0].x, v[0].y);

                // Draw n-1 segments explicitly (0->1, 1->2, ..., (n-2)->(n-1))
                // The last segment (n-1)->0 will be handled by THREE.Shape's auto-close
                for (let i = 0; i < n - 1; i++) {
                    const p1 = v[i];
                    const p2 = v[i + 1];
                    const bulge = v[i].bulge || 0;

                    if (bulge !== 0) {
                        const pts = this.getBulgePoints(p1, p2, bulge);
                        // Skip first point (pts[0]) as it's same as p1 where we already are
                        for (let k = 1; k < pts.length; k++) {
                            shape.lineTo(pts[k].x, pts[k].y);
                        }
                    } else {
                        shape.lineTo(p2.x, p2.y);
                    }
                }

                // For the last segment (v[n-1] -> v[0]), if it has a bulge, we need to draw it
                if (isClosed && n > 0) {
                    const p1 = v[n - 1];
                    const p2 = v[0];
                    const bulge = v[n - 1].bulge || 0;

                    console.log(`Closing segment: v[${n - 1}]=(${p1.x},${p1.y}) -> v[0]=(${p2.x},${p2.y}) bulge=${bulge}`);

                    if (bulge !== 0) {
                        const pts = this.getBulgePoints(p1, p2, bulge);
                        console.log(`  Arc points: ${pts.length}, last pt=(${pts[pts.length - 1].x},${pts[pts.length - 1].y})`);
                        // Draw all arc points for the closing segment
                        for (let k = 1; k < pts.length; k++) {
                            shape.lineTo(pts[k].x, pts[k].y);
                        }
                        // Explicitly close to the first point to ensure perfect closure
                        shape.lineTo(v[0].x, v[0].y);
                        console.log(`  Explicitly closed to v[0]`);
                    }
                    // If no bulge, THREE.Shape auto-closes with a straight line
                }

                return shape;
            }
        }
        return null;
    }

    createShapeFromChain(vertices) {
        const shape = new THREE.Shape();
        const n = vertices.length;
        if (n < 3) return null;

        shape.moveTo(vertices[0].x, vertices[0].y);

        // Draw n-1 segments
        for (let i = 0; i < n - 1; i++) {
            const p1 = vertices[i];
            const p2 = vertices[i + 1];
            const bulge = p1.bulge || 0;

            if (bulge !== 0) {
                const pts = this.getBulgePoints(p1, p2, bulge);
                for (let k = 1; k < pts.length; k++) {
                    shape.lineTo(pts[k].x, pts[k].y);
                }
            } else {
                shape.lineTo(p2.x, p2.y);
            }
        }

        // Closing segment (last vertex back to first)
        const bulge = vertices[n - 1].bulge || 0;
        if (bulge !== 0) {
            const pts = this.getBulgePoints(vertices[n - 1], vertices[0], bulge);
            for (let k = 1; k < pts.length; k++) {
                shape.lineTo(pts[k].x, pts[k].y);
            }
        }
        shape.lineTo(vertices[0].x, vertices[0].y);

        return shape;
    }

    getBulgePoints(v1, v2, bulge) {
        const p1x = v1.x, p1y = v1.y;
        const p2x = v2.x, p2y = v2.y;

        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return [new THREE.Vector2(p1x, p1y)];

        // signed merkez açı
        const theta = 4 * Math.atan(bulge);

        // chord orta noktası
        const mx = (p1x + p2x) * 0.5;
        const my = (p1y + p2y) * 0.5;

        // (unit) sol normal
        const nx = -dy / dist;
        const ny = dx / dist;

        // mid->center offset (signed)
        const off = dist * (1 - bulge * bulge) / (4 * bulge);

        const cx = mx + nx * off;
        const cy = my + ny * off;

        // yarıçap
        const r = dist * (1 + bulge * bulge) / (4 * Math.abs(bulge));

        const startAng = Math.atan2(p1y - cy, p1x - cx);

        // adım sayısı
        const steps = Math.max(16, Math.ceil((Math.abs(theta) * r) / 6));
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const ang = startAng + theta * t;
            pts.push(new THREE.Vector2(
                cx + r * Math.cos(ang),
                cy + r * Math.sin(ang)
            ));
        }
        return pts;
    }

    // Find all disconnected closed chains from a set of objects
    findAllChains(objects) {
        const tolerance = 2.0;  // Increased for small arc matching
        const results = [];

        // Extract all segments
        const allSegments = [];
        for (const obj of objects) {
            const seg = this.extractSegment(obj);
            if (seg) {
                seg.used = false;
                allSegments.push(seg);
            }
        }

        // Keep building chains until all segments are used or no more chains can be found
        while (allSegments.some(s => !s.used)) {
            // Find first unused segment
            const startIdx = allSegments.findIndex(s => !s.used);
            if (startIdx === -1) break;

            const chain = this.buildChainFromSegment(allSegments, startIdx, tolerance);

            if (chain && chain.closed) {
                console.log(`  - Found closed chain with ${chain.orderedSegments.length} segments`);

                // Extract vertices
                const vertices = chain.orderedSegments.map(seg => ({
                    x: seg.p1.x,
                    y: seg.p1.y,
                    bulge: seg.bulge || 0
                }));

                results.push({
                    type: 'chain',
                    objects: chain.orderedSegments.map(s => s.object),
                    vertices: vertices
                });
            } else {
                console.log(`  - Found incomplete/open chain with ${chain ? chain.orderedSegments.length : 0} segments`);
                // Mark segments as used even if chain is not closed to avoid infinite loop
                if (chain) {
                    chain.orderedSegments.forEach(seg => {
                        const idx = allSegments.findIndex(s => s.object === seg.object);
                        if (idx !== -1) allSegments[idx].used = true;
                    });
                }
            }
        }

        return results;
    }

    buildChainFromSegment(allSegments, startIdx, tolerance) {
        const ordered = [];
        const segment = allSegments[startIdx];

        ordered.push(segment);
        allSegments[startIdx].used = true;

        let currentEnd = segment.p2;
        let found = true;

        // Try to build a chain
        while (found && ordered.length < allSegments.length) {
            found = false;
            let bestIdx = -1;
            let bestDist = tolerance;
            let bestFlip = false;

            // Find the CLOSEST matching segment, not just the first one
            for (let i = 0; i < allSegments.length; i++) {
                if (allSegments[i].used) continue;

                const seg = allSegments[i];
                const dist1 = currentEnd.distanceTo(seg.p1);
                const dist2 = currentEnd.distanceTo(seg.p2);

                if (dist1 < bestDist) {
                    bestDist = dist1;
                    bestIdx = i;
                    bestFlip = false;
                }
                if (dist2 < bestDist) {
                    bestDist = dist2;
                    bestIdx = i;
                    bestFlip = true;
                }
            }

            // Add the best matching segment if found
            if (bestIdx !== -1) {
                const seg = allSegments[bestIdx];
                found = true;

                if (!bestFlip) {
                    ordered.push(seg);
                    allSegments[bestIdx].used = true;
                    currentEnd = seg.p2;
                } else {
                    const flipped = {
                        object: seg.object,
                        p1: seg.p2,
                        p2: seg.p1,
                        bulge: seg.bulge ? -seg.bulge : 0,
                        used: true
                    };
                    ordered.push(flipped);
                    allSegments[bestIdx].used = true;
                    currentEnd = flipped.p2;
                }
            }
        }

        // Check if chain is closed
        if (ordered.length < 3) return { closed: false, orderedSegments: ordered };

        const start = ordered[0].p1;
        const end = ordered[ordered.length - 1].p2;
        const closed = start.distanceTo(end) < tolerance;

        return {
            closed: closed,
            orderedSegments: ordered
        };
    }

    // Chain Selection Support
    analyzeChain(objects) {
        const tolerance = 2.0;  // Increased for small arc matching
        // Extract all segments with endpoints
        const segments = [];
        for (const obj of objects) {
            const seg = this.extractSegment(obj);
            if (seg) segments.push(seg);
        }

        if (segments.length < 2) return { closed: false };

        // Try to order segments into a chain
        const ordered = [];
        const used = new Set();

        // Start with first segment
        ordered.push(segments[0]);
        used.add(0);

        let currentEnd = segments[0].p2;

        // Try to build a chain
        while (used.size < segments.length) {
            let found = false;

            for (let i = 0; i < segments.length; i++) {
                if (used.has(i)) continue;

                const seg = segments[i];

                // Check if this segment connects to current end
                if (currentEnd.distanceTo(seg.p1) < tolerance) {
                    ordered.push(seg);
                    used.add(i);
                    currentEnd = seg.p2;
                    found = true;
                    break;
                } else if (currentEnd.distanceTo(seg.p2) < tolerance) {
                    // Segment is reversed, flip it
                    ordered.push({
                        object: seg.object,
                        p1: seg.p2,
                        p2: seg.p1,
                        bulge: seg.bulge ? -seg.bulge : 0 // Flip bulge sign
                    });
                    used.add(i);
                    currentEnd = seg.p1;
                    found = true;
                    break;
                }
            }

            if (!found) break; // Can't continue chain
        }

        // Check if chain is closed
        if (ordered.length < 3) return { closed: false };

        const start = ordered[0].p1;
        const end = ordered[ordered.length - 1].p2;
        const closed = start.distanceTo(end) < tolerance;

        if (!closed) return { closed: false };

        // Extract vertices for area calculation
        const vertices = ordered.map(seg => ({
            x: seg.p1.x,
            y: seg.p1.y,
            bulge: seg.bulge || 0
        }));

        return {
            closed: true,
            orderedObjects: ordered.map(s => s.object),
            vertices: vertices
        };
    }

    extractSegment(obj) {
        const type = obj.userData.type;

        if (type === 'LINE') {
            const entity = obj.userData.entity;
            if (!entity || !entity.startPoint || !entity.endPoint) {
                console.warn('[extractSegment] LINE missing entity data');
                return null;
            }

            return {
                object: obj,
                p1: new THREE.Vector2(entity.startPoint.x, entity.startPoint.y),
                p2: new THREE.Vector2(entity.endPoint.x, entity.endPoint.y),
                bulge: 0
            };
        }

        if (type === 'ARC') {
            const entity = obj.userData.entity;

            if (!entity || !entity.center || entity.radius === undefined) {
                console.warn('[extractSegment] ARC missing entity data');
                return null;
            }

            // Calculate endpoints mathematically for accuracy (not from tessellated geometry)
            const cx = entity.center.x;
            const cy = entity.center.y;
            const r = entity.radius;
            const startRad = (entity.startAngle || 0) * Math.PI / 180;
            const endRad = (entity.endAngle || 0) * Math.PI / 180;

            const p1 = new THREE.Vector2(
                cx + r * Math.cos(startRad),
                cy + r * Math.sin(startRad)
            );
            const p2 = new THREE.Vector2(
                cx + r * Math.cos(endRad),
                cy + r * Math.sin(endRad)
            );

            const bulge = this.estimateBulge(entity);

            return {
                object: obj,
                p1: p1,
                p2: p2,
                bulge: bulge
            };
        }

        return null;
    }

    estimateBulge(arcEntity) {
        // Check for undefined/null, not falsy (0 is a valid angle!)
        if (arcEntity.startAngle === undefined || arcEntity.startAngle === null ||
            arcEntity.endAngle === undefined || arcEntity.endAngle === null) {
            return 0;
        }

        const startAng = arcEntity.startAngle * Math.PI / 180;
        const endAng = arcEntity.endAngle * Math.PI / 180;

        let theta = endAng - startAng;
        if (theta < 0) theta += 2 * Math.PI;

        // bulge = tan(θ/4)
        return Math.tan(theta / 4);
    }


    clearVisualization() {
        if (this.previewMesh) {
            if (this.viewer && this.viewer.scene) {
                this.viewer.scene.remove(this.previewMesh);
            }
            if (this.previewMesh.geometry) this.previewMesh.geometry.dispose();
            this.previewMesh = null;
        }

        // Clean up debug circle
        if (this.debugCircle) {
            if (this.viewer && this.viewer.scene) {
                this.viewer.scene.remove(this.debugCircle);
            }
            if (this.debugCircle.geometry) this.debugCircle.geometry.dispose();
            this.debugCircle = null;
        }
    }

    t(key) {
        return this.languageManager ? this.languageManager.translate(key) : key;
    }
}
