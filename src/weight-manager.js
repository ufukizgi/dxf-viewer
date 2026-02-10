import * as THREE from 'three';
import { MATERIALS, TEMPERS, DEFAULT_MATERIAL_ID, PRES } from './materials.js';

export class WeightManager {
    constructor(app, languageManager, snappingManager, onCloseCallback, onChainSelectCallback) {
        this.app = app;
        this.viewer = app.viewer || app.sceneViewer; // Handle both prop names if unsure, main.js uses sceneViewer but passed 'this'
        if (!this.viewer) console.error('[WeightManager] Viewer not found in App instance!');

        this.languageManager = languageManager;
        this.snappingManager = snappingManager;
        this.onCloseCallback = onCloseCallback;
        this.onChainSelectCallback = onChainSelectCallback;

        this.currentMaterialId = DEFAULT_MATERIAL_ID;
        // Default temper
        this.currentTemperId = TEMPERS.length > 0 ? TEMPERS[0].id : '';

        // Default Pres & Figur
        this.currentPresId = PRES.length > 0 ? PRES[0].id : '';
        this.currentFigur = 1;

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

        // Active state for trigger (Manual mode)
        this.isActive = false;

        this.templateRotation = 0;

        // Info Table Template
        this.infoTableTemplate =
            `| ÖLÇEK        | %val-scale%        |
+--------------+-----------+----------------+----------+------------------+----------+
| YUDA-NO      | %val-yudano%       | MALZEME        | %val-metarial%   | TEMPER          | %val-temper%         |
+--------------+-----------+----------------+----------+------------------+----------+
| DU (mm)      | %val-diameter%     | ALAN (mm²)     | %val-area%       | GRAMAJ (kg/m)   | %val-veigth%         |
+--------------+-----------+----------------+----------+------------------+----------+
| ŞEK. FAKTÖRÜ | %val-shapefactor%  | DIŞ ÇEVRE (mm) | %val-perimeter%  | TOP. ÇEVRE (mm) | %val-totalperimeter% |
+--------------+-----------+----------------+----------+------------------+----------+
| EKST. OR.    | %val-extratio%     | PRES           | %val-pres%       | FIGUR           | %val-figur%          |
+--------------+-----------+----------------+----------+------------------+----------+`;
    }

    init() {
        this.createUI();
        this.bindEvents();
    }

    createUI() {
        this.panel = document.getElementById('weight-panel');
        this.btn = document.getElementById('weight-btn');

        // Gap Tolerance UI
        this.gapTolerancePanel = document.getElementById('gap-tolerance-panel');
        this.gapToleranceInput = document.getElementById('gap-tolerance-input');

        // Template popup elements
        this.templatePopup = document.getElementById('template-popup');
        this.templateSelector = document.getElementById('template-selector');
        this.addTemplateBtn = document.getElementById('add-template-btn');

        // Scale panel
        this.scalePanel = document.getElementById('scale-panel');

        // Print button
        this.printBtn = document.getElementById('print-btn');

        // Populate Material Selector
        const matSelector = document.getElementById('material-selector');
        if (matSelector) {
            matSelector.innerHTML = '';
            MATERIALS.forEach(mat => {
                const opt = document.createElement('option');
                opt.value = mat.id;
                opt.textContent = `${mat.name}`;
                matSelector.appendChild(opt);
            });
            // Set default
            matSelector.value = this.currentMaterialId;
        }

        // Populate Temper Selector
        const temperSelector = document.getElementById('temper-selector');
        if (temperSelector) {
            temperSelector.innerHTML = '';
            TEMPERS.forEach(temp => {
                const opt = document.createElement('option');
                opt.value = temp.id;
                opt.textContent = temp.name;
                temperSelector.appendChild(opt);
            });
            // Set default if exists
            this.currentTemperId = temperSelector.value;
        }

        // Populate Pres Selector
        const presSelector = document.getElementById('pres-selector');
        if (presSelector) {
            presSelector.innerHTML = '';
            PRES.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name; // e.g. "1100 ton 5 inc"
                if (p.id === this.currentPresId) opt.selected = true;
                presSelector.appendChild(opt);
            });
            // Update current if changed/default
            if (presSelector.value) this.currentPresId = presSelector.value;
        }

        // Figur is static in HTML, just set value
        const figurSelector = document.getElementById('figur-selector');
        if (figurSelector) {
            figurSelector.value = this.currentFigur;
        }

        // Populate Pres and Figur selectors (created dynamically or assumed present in HTML?)
        // The plan said "Insert ... into Weight Panel" in HTML.
        // Wait, I forgot to update HTML for Pres/Figur selectors! 
        // I should inject them into innerHTML of createUI or use replace_file_content on HTML.
        // But here I'll assume they exist and bind them.

        // NOTE: I will update HTML in next step.

    }

    bindEvents() {
        if (this.btn) {
            this.btn.addEventListener('click', (e) => {
                e.stopPropagation();

                if (this.onChainSelectCallback && this.selectedObjects.length > 0) {
                    this.onChainSelectCallback(this.selectedObjects);
                }
            });
        }

        // Gap Tolerance Input
        if (this.gapToleranceInput) {
            this.gapToleranceInput.addEventListener('change', () => {
                if (this.isActive && this.selectedObjects.length > 0) {
                    this.update(this.selectedObjects);
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

        const temperSelector = document.getElementById('temper-selector');
        if (temperSelector) {
            temperSelector.addEventListener('change', (e) => {
                this.currentTemperId = e.target.value;
                // Temper currently doesn't affect weight calc, but future proofing
                console.log(`Temper changed to: ${this.currentTemperId}`);
            });
        }

        // Bind Pres & Figur (New)
        const presSelector = document.getElementById('pres-selector');
        if (presSelector) {
            presSelector.addEventListener('change', (e) => {
                this.currentPresId = e.target.value;
                this.calculateAndRender();
            });
        }

        const figurSelector = document.getElementById('figur-selector');
        if (figurSelector) {
            figurSelector.addEventListener('change', (e) => {
                this.currentFigur = parseInt(e.target.value, 10);
                this.calculateAndRender();
            });
        }

        /* Removed Add Template Button Listener as button is removed */
        /*
        if (this.addTemplateBtn) {
            this.addTemplateBtn.addEventListener('click', () => this.openTemplatePopup());
        }
        */

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

        // Rotation Input Handler
        const rotationInput = document.getElementById('input-rotation');
        if (rotationInput) {
            rotationInput.addEventListener('input', (e) => {
                if (this.templateMode) {
                    const degrees = parseFloat(e.target.value) || 0;
                    // Convert to radians for internal state
                    this.templateRotation = (degrees * Math.PI) / 180;
                    this.applyFloatingTransform();
                }
            });
            // Stop propagation of keydown events so they don't trigger app shortcuts while typing
            rotationInput.addEventListener('keydown', (e) => {
                e.stopPropagation();
            });
        }

        // ESC key handler for template mode
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.templateMode) {
                this.exitTemplatePlacementMode(true);
            }
        });
    }

    toggleActive() {
        this.isActive = !this.isActive;
        console.log(`[WeightManager] Active State: ${this.isActive}`);

        // Update button visual state
        if (this.btn) {
            if (this.isActive) {
                this.btn.classList.add('bg-cyan-500/20', 'text-cyan-400');

                // Show Gap Tolerance Panel
                if (this.gapTolerancePanel) this.gapTolerancePanel.classList.remove('hidden');

                // Auto-set tolerance based on file type
                if (this.gapToleranceInput && this.app && this.app.tabManager) {
                    const activeTab = this.app.tabManager.getActiveTab();
                    const isPdf = activeTab && (activeTab.isPdfSource === true || (activeTab.name && activeTab.name.toLowerCase().endsWith('.pdf')));
                    this.gapToleranceInput.value = isPdf ? "0.05" : "0.01";
                }
            } else {
                this.btn.classList.remove('bg-cyan-500/20', 'text-cyan-400');

                // Hide Gap Tolerance Panel
                if (this.gapTolerancePanel) this.gapTolerancePanel.classList.add('hidden');
            }
        }

        // If turned ON, attempt to calculate with current selection
        if (this.isActive && this.selectedObjects.length > 0) {
            this.update(this.selectedObjects);
        } else if (!this.isActive) {
            // If turned OFF, hide panel
            this.panel.classList.add('hidden');
            this.clearVisualization();
        }
    }

    update(selectedObjects) {
        this.selectedObjects = selectedObjects || [];

        // Always update button enabled state based on selection presence
        // Enable button if there is ANY selection (to allow Chain Select or Manual Trigger)
        this.isEnabled = this.selectedObjects.length > 0;

        if (this.btn) {
            if (this.isEnabled) {
                this.btn.classList.remove('opacity-50', 'cursor-not-allowed', 'group-is-disabled');

                // Show panel if it was active
                if (this.isActive && this.gapTolerancePanel) {
                    this.gapTolerancePanel.classList.remove('hidden');
                }
                this.btn.classList.add('hover:bg-white/10');
            } else {
                this.btn.classList.add('opacity-50', 'cursor-not-allowed', 'group-is-disabled');

                // FORCE HIDE panel if disabled
                if (this.gapTolerancePanel) {
                    this.gapTolerancePanel.classList.add('hidden');
                }
                this.btn.classList.remove('hover:bg-white/10');
            }
        }

        // --- TRIGGER LOGIC ---
        // If NOT active, do not proceed to calculation/panel show.
        if (!this.isActive) {
            return;
        }

        const closedGeoms = this.filterClosedGeometries(this.selectedObjects);

        // Show/hide weight panel based on whether closed geometries are selected AND active
        if (this.panel) {
            if (closedGeoms.length > 0) {
                this.panel.classList.remove('hidden');
                this.calculateAndRender();
            } else {
                this.panel.classList.add('hidden');
                this.clearVisualization();
            }
        }
    }

    togglePanel() {
        // Deprecated or redirect to toggleActive? 
        // With new logic, togglePanel might just be toggleActive
        this.toggleActive();
    }

    close() {
        this.isActive = false; // Deactivate on close
        if (this.panel) this.panel.classList.add('hidden');
        if (this.btn) {
            this.btn.classList.remove('bg-cyan-500/20', 'text-cyan-400');
        }
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

    async openTemplateSelectorForNewTab() {
        this.openTemplatePopup();
        this.isOpeningNewTab = true;
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

        if (this.isOpeningNewTab) {
            this.isOpeningNewTab = false;
            // Trigger Main App Load
            if (this.viewer.app) {
                // Determine if selectedFile is a local or remote path
                // For 'templates/file.dxf', we treat it as URL relative to root
                this.viewer.app.loadUrl(selectedFile);
            }
        } else {
            // Enter template placement mode
            this.enterTemplatePlacementMode();
        }
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

        // Step 1: Clone selected entities (to be preserved as content)
        const contentObjects = [];
        if (this.selectedObjects && this.selectedObjects.length > 0) {
            for (const obj of this.selectedObjects) {
                const clone = obj.clone();
                clone.userData.isFloatingClone = true;

                if (obj.userData.originalColor) {
                    clone.material = clone.material.clone();
                    clone.material.color.copy(obj.userData.originalColor);
                    clone.userData.originalColor = clone.material.color.clone();
                    clone.userData.isClonedMaterial = false;
                    delete clone.userData.isClonedMaterial;
                }
                contentObjects.push(clone);
            }
        }

        // 2. Clear Scene & Load Template (Specific to Template Mode)
        this.clearDxfGroup();
        await this.loadTemplateDXF(this.selectedTemplatePath); // This puts template into dxfGroup

        // 3. Start Placement of Floating Group
        this.startPlacement(contentObjects);

        // Zoom extents for template mode
        this.viewer.zoomExtents();
    }

    // Generic Placement Logic (Used for Template Content AND Clipboard Paste)
    startPlacement(objectsToPlace, cachedStats = null) {
        this.templateMode = true; // Use same mode flag for events
        this.scrollSteps = 0;
        this.templateScale = 1.0;
        this.templateRotation = 0;
        this._hasLoggedPosition = false;

        // Store cached stats for table generation
        this.pendingPlacementStats = cachedStats;

        this.floatingGroup = new THREE.Group();
        this.floatingGroup.name = 'FloatingGeometries';

        if (objectsToPlace && objectsToPlace.length > 0) {
            objectsToPlace.forEach(obj => {
                // Ensure they are marked for floating
                obj.userData.isFloatingClone = true;
                this.floatingGroup.add(obj);
            });

            // Re-center logic
            const floatBox = new THREE.Box3().setFromObject(this.floatingGroup);
            this.floatingCenter = floatBox.getCenter(new THREE.Vector3());

            for (const child of this.floatingGroup.children) {
                child.position.sub(this.floatingCenter);
                child.updateMatrix();
            }
        }

        this.viewer.scene.add(this.floatingGroup);

        // UI
        if (this.panel) this.panel.classList.add('hidden');
        if (this.scalePanel) this.scalePanel.classList.remove('hidden');

        // Initial table generation
        this.updateDynamicTable();

        this.startMouseFollowing();
        this.updateScaleDisplay();

        // Only zoom extents if we are in template mode (cleared scene)? 
        // Or for paste too? For paste, maybe we shouldn't zoom extents as it might be annoying.
        // But for now, let's keep it consistent.
        // actually, if we paste, we might want to start "at mouse".
        // startMouseFollowing will move it to mouse immediately on first move.
        // But zoomExtents might be disorienting for Paste.
        // Let's Skip zoomExtents here, caller can do it if needed.
        // ORIGINAL code did zoomExtents.
        // I'll add it back for now to match behavior.
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
        vec.z = 0;

        // Use Snap Point if available (updated by Main loop)
        if (this.snappingManager && this.snappingManager.activeSnap) {
            vec.copy(this.snappingManager.activeSnap.point);
            vec.z = 0;
        }

        // Position floating group so its center (which is now 0,0 locally) is at cursor
        // No offset needed because we centered the geometry in the group!

        // Log one-time debug for position
        if (!this._hasLoggedPosition) {
            console.log('[WeightManager] Updating floating position:', {
                mouseNDC: { x, y },
                mouseWorld: vec,
                scale: this.templateScale
            });
            this._hasLoggedPosition = true;
        }

        // Set Z to 0.1 to ensure it sits above the template (Z=0)
        this.floatingGroup.position.set(vec.x, vec.y, 0.1);
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

        if (event.ctrlKey) {
            // Rotate: 1 degree per step (PI/180)
            // Scroll UP (negative deltaY) -> Rotate Counter-Clockwise (positive angle)
            // Scroll DOWN (positive deltaY) -> Rotate Clockwise (negative angle)
            const delta = event.deltaY > 0 ? -1 : 1;
            const rotationStep = Math.PI / 180; // 1 degree
            this.templateRotation += delta * rotationStep;

            // Normalize to 0..2PI if desired, but not strictly necessary for display
        } else {
            // Scale: Each scroll step = ±5% of original scale
            const delta = event.deltaY > 0 ? -1 : 1;
            this.scrollSteps += delta;
            this.templateScale = 1.0 + (0.05 * this.scrollSteps);
            this.templateScale = Math.max(0.1, Math.min(10, this.templateScale)); // Clamp 0.1 to 10
        }

        this.applyFloatingTransform();
        this.updateScaleDisplay();
    }

    applyFloatingTransform() {
        if (this.floatingGroup) {
            this.floatingGroup.scale.set(this.templateScale, this.templateScale, 1);
            this.floatingGroup.rotation.z = this.templateRotation;

            // Counter-rotate Info Table to keep it upright
            const table = this.floatingGroup.children.find(c => c.userData.isInfoTable);
            if (table) {
                table.rotation.z = -this.templateRotation;
            }
        }
    }

    updateScaleDisplay() {
        // Update Scale
        const scaleEl = document.getElementById('val-scale');
        if (scaleEl) {
            // Format as 1:X or X:1
            if (this.templateScale >= 1) {
                scaleEl.textContent = `${this.templateScale.toFixed(1)}:1`;
            } else {
                scaleEl.textContent = `1:${(1 / this.templateScale).toFixed(1)}`;
            }
        }

        // Update Rotation
        const rotationEl = document.getElementById('input-rotation');
        if (rotationEl) {
            // Convert radians to degrees
            let degrees = (this.templateRotation * 180) / Math.PI;

            // Normalize to 0-360 range for display
            degrees = degrees % 360;
            if (degrees < 0) degrees += 360;

            // Avoid overwriting input if user is currently typing and focused? 
            // Actually, scroll updates should override text to give feedback.
            // But if we call this from scroll handler, it's fine.
            // If called from input handler, we might want to avoid circular setting?
            // Since input handler calls applyFloatingTransform but NOT updateScaleDisplay (we should check),
            // let's ensure input handler calls updateScaleDisplay? No, input handler sets rotation directly.

            // Just update the value
            // Check if element is focused to avoid disrupting typing?
            // If resizing via scroll, we definitely want to update it.
            if (document.activeElement !== rotationEl) {
                rotationEl.value = degrees.toFixed(2);
            } else {
                // If focused, maybe don't update? But scroll changes value.
                // If user uses scroll WHILE focused on input, we should update.
                rotationEl.value = degrees.toFixed(2);
            }
        }

        // Update dynamic table with new scale
        this.updateDynamicTable();
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

        // Resolve Stats to use (Pending from Clipboard OR Last Calculated)
        let statsToUse = this.pendingPlacementStats || this.lastCalculatedStats;

        console.log('[WeightManager] Resolving stats for table:', {
            pending: this.pendingPlacementStats,
            last: this.lastCalculatedStats,
            resolved: statsToUse
        });

        console.log('[WeightManager] Resolving stats for table:', {
            pending: this.pendingPlacementStats,
            last: this.lastCalculatedStats,
            resolved: statsToUse
        });


        // 2. Merge floating entities into dxfGroup
        this.mergeFloatingIntoDxfGroup(position, scale);

        // Update Stats State
        if (statsToUse) {
            statsToUse.numericScale = scale;
            this.lastCalculatedStats = statsToUse;
        } else {
            if (!this.lastCalculatedStats) {
                this.lastCalculatedStats = { numericScale: scale };
            } else {
                this.lastCalculatedStats.numericScale = scale;
            }
        }

        // Clear pending
        this.pendingPlacementStats = null;

        // Exit placement mode
        this.templateMode = false;

        // Show weight panel if we have valid stats, or assume user wants to see it
        if (this.panel) this.panel.classList.remove('hidden');
        if (this.scalePanel) this.scalePanel.classList.add('hidden');

        // Auto-select pasted objects logic is handled inside merge -> update call?
        // mergeFloatingIntoDxfGroup calls this.update(addedObjects)
    }

    mergeFloatingIntoDxfGroup(position, scale) {
        if (!this.floatingGroup || !this.viewer.dxfGroup) {
            console.warn('[WeightManager] Cannot merge floating: missing floatingGroup or dxfGroup');
            return;
        }

        // Capture added objects for selection
        const addedObjects = [];

        // Collect all children to transfer
        // Note: we can't iterate over .children directly while modifying it (attach removes child)
        const children = [...this.floatingGroup.children];

        // Ensure matrices are up to date before attaching
        this.floatingGroup.updateMatrixWorld(true);
        this.viewer.dxfGroup.updateMatrixWorld(true);

        for (const child of children) {
            // Use attach to preserve world transform (pos, rot, scale) while reparenting
            this.viewer.dxfGroup.attach(child);

            // Ensure geometry has bounding box for Raycaster
            if (child.geometry) {
                child.geometry.computeBoundingBox();
            }

            // Mark as placed geometry
            child.userData.isPlacedGeometry = true;
            child.userData.placementScale = scale;
            child.userData.placementRotation = this.templateRotation; // Store rotation for record

            // Verify entity metadata exists for SnappingManager
            // AND Update Entity Coordinates to Match World Transform
            // The object geometry is already in correct place relative to parent.
            // But userData.entity still has original coordinates.
            // We must update userData.entity to match the new visual placement.

            // Note: child.matrix is local transform relative to NEW parent (dxfGroup).
            // Since we used attach, child.position/rotation/scale are set correctly relative to dxfGroup.
            // If we want userData.entity (which represents absolute world coords usually, or local to dxfGroup?)
            // to match, we need to apply child.matrix to the original entity points.

            // However, userData.entity from Clipboard is based on ORIGINAL coordinates.
            // child.matrix handles the shift from FloatingGroup (centered) to DxfGroup.
            // Wait: 
            // 1. Original Entity: (1000, 1000)
            // 2. Clipboard Object: created at (1000, 1000)
            // 3. Floating Group: added object.
            // 4. Floating Center calculated. Object shifted by -Center.
            // 5. Floating Group moved to mouse.
            // 6. Merge: Object attached to DxfGroup.
            //    Three.js updates child.matrix to preserve World Position.
            //    So child.position is now correct in DxfGroup space.

            // PROBLEM: userData.entity.startPoint is still (1000, 1000).
            // But visual line is at Mouse (e.g. 50, 50).
            // WeightManager calculations use userData.entity if available.
            // So we must update userData.entity points to match child.position (if Line) or transform them.

            if (child.userData.entity && (child.userData.entity.type === 'LINE' || child.userData.entity.type === 'LWPOLYLINE')) {
                // Deep clone entity to avoid reference issues
                const newEntity = JSON.parse(JSON.stringify(child.userData.entity));

                // We need to determine the transformation logic.
                // The geometry vertices are ALREADY correct because 'attach' modifies the object transform, NOT the geometry vertices?
                // Wait, 'attach' modifies object.position/rotation/scale. Geometry is unchanged.
                // So Geometry is still at (1000, 1000) relative to Object Origin.
                // Object Origin is at (X, Y) relative to Parent.

                // ACTUALLY:
                // When we 'attach', the Object Matrix is updated.
                // The VISUAL state is correct.
                // Bat WeightManager/InfoManager often look at `entity.startPoint`.
                // If we want `entity.startPoint` to match the VISUAL start point in World Space (or Parent Space?):
                // We should probably rely on Geometry Vertices + Object Matrix for robust calc.
                // BUT most existing code might rely on `entity` structure (e.g. for simple parsing).

                // If we want to "bake" the transform into the entity data:
                // We can't easily bake it into Geometry unless we applyMatrix to geometry.
                // If we applyMatrix to geometry, we reset Position/Rotation/Scale to identity.

                // Let's try applying the transform to the geometry and resetting the object transform.
                // This makes "userData.entity" updates easier too.

                child.updateMatrix();
                child.geometry.applyMatrix4(child.matrix);
                child.position.set(0, 0, 0);
                child.rotation.set(0, 0, 0);
                child.scale.set(1, 1, 1);
                child.updateMatrix();

                // Now update entity data from the new geometry
                if (newEntity.type === 'LINE') {
                    const pos = child.geometry.attributes.position;
                    newEntity.startPoint = { x: pos.getX(0), y: pos.getY(0), z: pos.getZ(0) };
                    newEntity.endPoint = { x: pos.getX(1), y: pos.getY(1), z: pos.getZ(1) };
                }
                // Polyline is harder (points array), but similar logic.

                child.userData.entity = newEntity;
            } else if (child.isLine && !child.userData.entity) {
                // Recover entity from geometry (which we just verified/baked?)
                // If we baked above, we should do it here too logic-wise.
                // Simple fallback:
                if (child.geometry && child.geometry.attributes.position) {
                    child.updateMatrix();
                    child.geometry.applyMatrix4(child.matrix);
                    child.position.set(0, 0, 0);
                    child.rotation.set(0, 0, 0);
                    child.scale.set(1, 1, 1);
                    child.updateMatrix();

                    const pos = child.geometry.attributes.position;
                    child.userData.entity = {
                        type: 'LINE',
                        startPoint: { x: pos.getX(0), y: pos.getY(0), z: pos.getZ(0) },
                        endPoint: { x: pos.getX(1), y: pos.getY(1), z: pos.getZ(1) }
                    };
                }
            }

            addedObjects.push(child);
        }

        // Remove floating group from scene
        this.viewer.scene.remove(this.floatingGroup);
        this.floatingGroup = null;

        console.log(`[WeightManager] Merged ${children.length} floating entities into dxfGroup using attach`);

        // Auto-select pasted objects
        // We need to notify main app or use callback.
        // `onChainSelectCallback` is for generic actions.
        // But `onCloseCallback` is for closing.
        // We can just call `this.update(addedObjects)` to trigger weight calc on them immediately?
        // But better to let Main App handle selection state.
        // For now, let's just trigger internal update so the panel shows stats for pasted items.
        this.update(addedObjects);
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

    updateDynamicTable() {
        if (!this.pendingPlacementStats || !this.floatingGroup) return;

        // Remove existing table
        const existing = this.floatingGroup.children.find(c => c.userData.isInfoTable);
        if (existing) {
            if (existing.material.map) existing.material.map.dispose();
            if (existing.material) existing.material.dispose();
            if (existing.geometry) existing.geometry.dispose();
            this.floatingGroup.remove(existing);
        }

        // Calculate Position (Bottom of floating geometries)
        const localBox = new THREE.Box3();
        let hasGeometry = false;

        this.floatingGroup.children.forEach(c => {
            if (c.geometry && !c.userData.isInfoTable) {
                if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                const geomBox = c.geometry.boundingBox.clone();
                c.updateMatrix();
                geomBox.applyMatrix4(c.matrix);
                localBox.union(geomBox);
                hasGeometry = true;
            }
        });

        if (!hasGeometry) return;

        const tablePosition = new THREE.Vector3(
            (localBox.min.x + localBox.max.x) / 2,
            localBox.min.y - 10,
            0
        );

        // Update stats scale
        this.pendingPlacementStats.numericScale = this.templateScale;

        // Generate Table (Scale 1.0 relative to group)
        const tableMesh = this.createTableMesh(this.pendingPlacementStats, tablePosition, 1.0);
        if (tableMesh) {
            tableMesh.userData.isInfoTable = true;
            // Apply counter-rotation immediately
            tableMesh.rotation.z = -this.templateRotation;
            this.floatingGroup.add(tableMesh);
        }
    }

    createTableMesh(stats, position, scale) {
        if (!stats) return null;

        // 1. Prepare Data
        const material = MATERIALS.find(m => m.id === this.currentMaterialId) || MATERIALS[0];
        const temper = TEMPERS.find(t => t.id === this.currentTemperId) || { name: '-' };
        const pres = PRES.find(p => p.id === this.currentPresId) || { name: (this.currentPresId || '-') };

        // Raw values map
        const values = {
            'val-yudano': this.yudaNo || ' - ',
            'val-metarial': material.name,
            'val-temper': temper.name,
            'val-diameter': (stats.diameter || 0).toFixed(2),
            'val-area': (stats.netArea || 0).toFixed(2),
            'val-veigth': (stats.weight || 0).toFixed(3),
            'val-shapefactor': (stats.shapeFactor || 0).toFixed(2),
            'val-perimeter': (stats.outerPerimeter || 0).toFixed(2),
            'val-totalperimeter': (stats.totalPerimeter || 0).toFixed(2),
            'val-scale': (stats.numericScale ? Number(stats.numericScale).toFixed(2) : (scale || 1).toString()),
            'val-extratio': (stats.extrusionRatio || 0).toFixed(2),
            'val-pres': pres.name,
            'val-figur': this.currentFigur || 1
        };

        // 2. Align Table Text
        const textContent = this.formatTable(this.infoTableTemplate, values);

        // 3. Generate Texture (Monospace)
        return this.generateTableTexture(textContent, position, scale);
    }

    formatTable(template, values) {
        const lines = template.split('\n');

        // 1. Detect Column Widths from the first separator line (starts with +)
        const separatorLine = lines.find(line => line.trim().startsWith('+'));
        if (!separatorLine) return template; // Fallback

        // Parse widths: +-----+-------+ -> lengths of segments between +
        const widths = separatorLine.split('+').slice(1, -1).map(s => s.length);

        // 2. Process Data Rows
        return lines.map(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('|')) { // Data row
                // Split by | but keep empty strings for start/end
                const cells = line.split('|').slice(1, -1);

                // Reconstruct row
                let newLine = '|';
                cells.forEach((cell, index) => {
                    const width = widths[index];
                    if (width === undefined) {
                        newLine += cell + '|'; // Should format even if mismatch, but for now append
                        return;
                    }

                    // Check for placeholder
                    let content = cell;
                    for (const [key, val] of Object.entries(values)) {
                        if (content.includes(`%${key}%`)) {
                            content = content.replace(`%${key}%`, val);
                        }
                    }

                    // Trim and Pad
                    // Check original alignment? Usually left-align for text, right for numbers?
                    // User's template has mixed. Let's assume Left Align for now or preserve leading space?
                    // Simple approach: Center or Left Pad.
                    // Given the user padded "val-10", maybe they want fixed alignment.
                    // Let's try to center the content in the cell width. Or Left align with 1 space margin.

                    // Better: Trim, then padEnd (Left align)
                    const cleanContent = content.trim();
                    // Ensure 1 space padding left if possible
                    const padded = (' ' + cleanContent).padEnd(width, ' ');

                    newLine += padded + '|';
                });
                return newLine;
            }
            return line; // Return separators as is
        }).join('\n');
    }

    generateTableTexture(text, position, scale) {
        console.log('[WeightManager] Generating Table Texture...');
        const lines = text.split('\n');

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // High resolution for sharpness
        const fontSizePx = 64;
        const lineHeightPx = fontSizePx * 1.2;
        ctx.font = `bold ${fontSizePx}px "Courier New", monospace`; // Monospace is critical

        // Measure widest line
        let maxWidth = 0;
        lines.forEach(line => {
            const w = ctx.measureText(line).width;
            if (w > maxWidth) maxWidth = w;
        });

        // Dimensions
        canvas.width = maxWidth + 40; // Padding
        canvas.height = (lines.length * lineHeightPx) + 40;

        console.log(`[WeightManager] Table Canvas Size: ${canvas.width}x${canvas.height}`);

        // Render Background (Transparent)
        ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Render Text (White)
        ctx.font = `bold ${fontSizePx}px "Courier New", monospace`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'top';

        lines.forEach((line, i) => {
            ctx.fillText(line, 20, 20 + (i * lineHeightPx));
        });

        // Texture
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        // texture.needsUpdate = true; // CanvasTexture auto-updates but good practice if reused? Not reused here.

        // Create Plane
        // World Line Height calibration
        const worldLineHeight = 4.0 * scale;
        const aspect = canvas.width / canvas.height;
        const totalHeight = worldLineHeight * lines.length;
        const totalWidth = totalHeight * aspect;

        const geom = new THREE.PlaneGeometry(totalWidth, totalHeight);
        const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false // Ensure it renders on top if there's Z-fighting
        });

        const mesh = new THREE.Mesh(geom, mat);

        // Position
        mesh.position.copy(position);
        mesh.position.y -= totalHeight / 2;
        mesh.position.z += 0.1; // Slight Z offset to avoid fighting with grid/zero plane

        // Render Order (to draw on top of other transparents)
        mesh.renderOrder = 999;

        // Store user data
        mesh.userData.isInfoTable = true;
        mesh.userData.isPlacedGeometry = true;
        console.log('[WeightManager] Table Mesh created at:', mesh.position);
        return mesh;
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

            // Remove floating group (Clipboard/Selection content)
            if (this.floatingGroup) {
                this.viewer.scene.remove(this.floatingGroup);
                this.floatingGroup = null;
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
        // Default to mouse coordinates relative to canvas
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        if (this.snappingManager && this.snappingManager.activeSnap) {
            // Project world snap point to screen space
            const worldSnap = this.snappingManager.activeSnap.point.clone();
            worldSnap.z = 0; // Ensure Z is 0

            // For Ortho camera, projection gives NDC (-1..1)
            const ndc = worldSnap.project(this.viewer.camera);

            const snapScreenX = (ndc.x + 1) * rect.width / 2;
            const snapScreenY = (-ndc.y + 1) * rect.height / 2;

            return { x: snapScreenX, y: snapScreenY };
        }

        return { x: screenX, y: screenY };
    }

    onPrintSelectionStart(e) {
        if (!this.printMode) return;

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

        // Hide OSNAP Markers
        const markersWasVisible = this.snappingManager && this.snappingManager.markerGroup ? this.snappingManager.markerGroup.visible : true;
        if (this.snappingManager && this.snappingManager.markerGroup) {
            this.snappingManager.markerGroup.visible = false;
        }

        // Store original background and colors
        const originalBg = this.viewer.scene.background ? this.viewer.scene.background.clone() : null;

        // Fix: Use Set to track unique materials preventing double-modification/restoration of shared materials
        const processedMaterials = new Set();
        const materialBackup = [];

        this.viewer.scene.traverse((obj) => {
            if (obj.material && obj.material.color) {
                // Handle Array of Materials (unlikely for Lines but possible for Meshes)
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

                mats.forEach(mat => {
                    if (!processedMaterials.has(mat)) {
                        processedMaterials.add(mat);
                        materialBackup.push({ material: mat, hex: mat.color.getHex() });
                        mat.color.setHex(0x000000);
                    }
                });
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

        // Restore materials
        materialBackup.forEach(item => {
            item.material.color.setHex(item.hex);
        });

        // Restore preview elements
        if (this.previewMesh) this.previewMesh.visible = previewWasVisible;
        if (this.snappingManager && this.snappingManager.markerGroup) {
            this.snappingManager.markerGroup.visible = markersWasVisible;
        }

        // Force Scene Resize Sync 
        if (this.viewer.resize) this.viewer.resize();

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

        // Store stats for external access (e.g. Clipboard)
        this.lastCalculatedStats = {
            netArea,
            outerPerimeter,
            totalPerimeter,
            weight,
            shapeFactor,
            mandrelCount,
            diameter: this.boundingCircle ? this.boundingCircle.diameter : 0 // will be updated below
        };

        this.updateDOM('val-mandrel', mandrelCount);
        this.updateDOM('val-area', netArea.toFixed(2));
        this.updateDOM('val-weight', weight.toFixed(3));
        this.updateDOM('val-perimeter', outerPerimeter.toFixed(2));
        this.updateDOM('val-totalperimeter', totalPerimeter.toFixed(2));
        this.updateDOM('val-shapefactor', shapeFactor.toFixed(2));

        // Calculate Extrusion Ratio
        const pres = PRES.find(p => p.id === this.currentPresId);
        let ratio = 0;
        if (pres && netArea > 0 && this.currentFigur > 0) {
            // Formula: Container Area / (FigurCount * NetArea)
            if (pres.containerArea) {
                ratio = pres.containerArea / (this.currentFigur * netArea);
            }
        }
        this.updateDOM('val-extrusion-ratio', ratio.toFixed(2));

        // Update stats
        this.lastCalculatedStats.extrusionRatio = ratio;
        this.lastCalculatedStats.presId = this.currentPresId;
        this.lastCalculatedStats.figur = this.currentFigur;

        this.calculationResult = { outer: outer.geomEntry, inner: inner.map(i => i.geomEntry) };
        this.visualize();

        // Calculate bounding circle AFTER visualization (when mesh is created)
        if (this.previewMesh && this.previewMesh.geometry) {
            const circleData = this.calculateBoundingCircleFromMesh(this.previewMesh.geometry);
            this.boundingCircle = circleData;

            // Update the stats with correct diameter
            if (this.lastCalculatedStats) {
                this.lastCalculatedStats.diameter = circleData.diameter;
            }

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
        // Use user-defined tolerance if available, else default to 0.01
        let tolerance = 0.01;

        if (this.gapToleranceInput) {
            const val = parseFloat(this.gapToleranceInput.value);
            if (!isNaN(val) && val > 0) {
                tolerance = val;
            }
        } else {
            // Fallback to auto-detection if UI missing
            if (this.app && this.app.tabManager) {
                const activeTab = this.app.tabManager.getActiveTab();
                const isPdf = (activeTab && activeTab.isPdfSource === true) ||
                    (activeTab && activeTab.name && activeTab.name.toLowerCase().endsWith('.pdf'));
                if (isPdf) tolerance = 0.05;
            }
        }

        console.log(`[WeightManager] findAllChains using tolerance: ${tolerance}`);


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
                // Extract vertices
                const vertices = [];
                chain.orderedSegments.forEach(seg => {
                    if (seg.tessellatedVertices && seg.tessellatedVertices.length > 1) {
                        // For tessellated segments, add all points except the last one (overlapping)
                        for (let k = 0; k < seg.tessellatedVertices.length - 1; k++) {
                            vertices.push(seg.tessellatedVertices[k]);
                        }
                    } else {
                        vertices.push({
                            x: seg.p1.x,
                            y: seg.p1.y,
                            bulge: seg.bulge || 0
                        });
                    }
                });

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

            // Find all candidates within tolerance
            const candidates = [];

            for (let i = 0; i < allSegments.length; i++) {
                if (allSegments[i].used) continue;

                const seg = allSegments[i];
                const dist1 = currentEnd.distanceTo(seg.p1);
                const dist2 = currentEnd.distanceTo(seg.p2);

                if (dist1 < tolerance) {
                    candidates.push({ idx: i, seg: seg, dist: dist1, flip: false });
                }
                if (dist2 < tolerance) {
                    candidates.push({ idx: i, seg: seg, dist: dist2, flip: true });
                }
            }

            if (candidates.length > 0) {
                // Score candidates to find the best match
                // Priority 1: Distance (closest)
                // Priority 2: Layer Match (same layer)
                // Priority 3: Angle/Direction (most continuous)

                const currentLayer = segment.object.userData.layer;
                const currentVector = segment.p2.clone().sub(segment.p1).normalize(); // Direction of current segment

                candidates.forEach(cand => {
                    let score = 0;

                    // 1. Distance penalty (heavy)
                    score -= cand.dist * 1000;

                    // 2. Layer bonus
                    const candLayer = cand.seg.object.userData.layer;
                    if (candLayer === currentLayer) {
                        score += 10;
                    }

                    // 3. Angle bonus (dot product)
                    // Check direction of candidate (account for flip)
                    let candVector;
                    if (cand.flip) {
                        // connecting to p2, so flow is p2 -> p1
                        candVector = cand.seg.p1.clone().sub(cand.seg.p2).normalize();
                    } else {
                        // connecting to p1, so flow is p1 -> p2
                        candVector = cand.seg.p2.clone().sub(cand.seg.p1).normalize();
                    }

                    const dot = currentVector.dot(candVector);
                    // Dot: 1 = straight, 0 = 90deg, -1 = u-turn
                    // We prefer straight (higher dot)
                    score += dot * 5;

                    cand.score = score;
                });

                // Sort by score descending
                candidates.sort((a, b) => b.score - a.score);

                // Pick best
                const best = candidates[0];
                const bestSeg = best.seg;

                found = true;

                if (!best.flip) {
                    ordered.push(bestSeg);
                    allSegments[best.idx].used = true;
                    currentEnd = bestSeg.p2;
                } else {
                    const flipped = {
                        object: bestSeg.object,
                        p1: bestSeg.p2, // Swapped
                        p2: bestSeg.p1, // Swapped
                        bulge: bestSeg.bulge ? -bestSeg.bulge : 0,
                        tessellatedVertices: bestSeg.tessellatedVertices ? bestSeg.tessellatedVertices.slice().reverse() : undefined,
                        used: true
                    };
                    ordered.push(flipped);
                    allSegments[best.idx].used = true;
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

        // Try to get detailed entity data first
        if (type === 'LINE') {
            const entity = obj.userData.entity;
            if (entity && entity.startPoint && entity.endPoint) {
                return {
                    object: obj,
                    p1: new THREE.Vector2(entity.startPoint.x, entity.startPoint.y),
                    p2: new THREE.Vector2(entity.endPoint.x, entity.endPoint.y),
                    bulge: 0
                };
            }
        }

        if (type === 'ARC') {
            const entity = obj.userData.entity;
            if (entity && entity.center && entity.radius !== undefined) {
                // Calculate endpoints mathematically
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

                // Calculate bulge
                let totalAngle = endRad - startRad;
                if (totalAngle < 0) totalAngle += Math.PI * 2;
                const bulge = Math.tan(totalAngle / 4);

                return {
                    object: obj,
                    p1: p1,
                    p2: p2,
                    bulge: bulge
                };
            }
        }

        // Fallback: Extract from geometry (e.g. Polyline segments)
        return this.extractFromGeometry(obj);
    }

    extractFromGeometry(obj) {
        if (!obj.geometry || !obj.geometry.attributes.position) return null;

        const pos = obj.geometry.attributes.position;
        if (pos.count < 2) return null;

        const p1 = new THREE.Vector2(pos.getX(0), pos.getY(0));
        const p2 = new THREE.Vector2(pos.getX(pos.count - 1), pos.getY(pos.count - 1));

        const segment = {
            object: obj,
            p1: p1,
            p2: p2,
            bulge: 0
        };

        // If it's a tessellated curve (more than 2 points), store intermediate vertices
        if (pos.count > 2) {
            segment.tessellatedVertices = [];
            for (let i = 0; i < pos.count; i++) {
                segment.tessellatedVertices.push({
                    x: pos.getX(i),
                    y: pos.getY(i),
                    bulge: 0
                });
            }
        }

        return segment;
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
