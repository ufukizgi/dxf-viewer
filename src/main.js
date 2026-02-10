import * as THREE from 'three';
import { SceneViewer } from './scene-viewer.js';
import { LoaderManager } from './loaders/LoaderManager.js';
import { LanguageManager } from './localization.js';
import { SnappingManager } from './snapping-manager.js';
import { MeasurementManager } from './measurement-manager.js';
import { ObjectInfoManager } from './object-info-manager.js';
import { WeightManager } from './weight-manager.js';
import { CommandHistory } from './command-history.js';
import { CmdAddMeasurement, CmdDelete } from './commands.js';
import { ClipboardManager } from './clipboard-manager.js';
import { ScaleManager } from './scale-manager.js';
import { SelectionHelper } from './selection-helper.js';


import { TabManager } from './tab-manager.js';
// ... imports

class DXFViewerApp {
    constructor() {
        this.canvas = document.getElementById('viewport');
        this.viewer = new SceneViewer(this.canvas);
        this.loader = new LoaderManager();
        this.selectionHelper = new SelectionHelper();
        this.selectedObjects = [];
        this.selectionState = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0
        };
        // Initialize Tab Manager (will be fully init in this.init())
        this.tabManager = null;
        this.init();
    }

    init() {
        this.languageManager = new LanguageManager();
        this.languageManager.init();

        this.history = new CommandHistory((canUndo, canRedo) => this.updateUndoRedoUI(canUndo, canRedo));

        // this.viewer is already created in constructor
        this.viewer.languageManager = this.languageManager;
        this.viewer.app = this;

        this.loaderManager = new LoaderManager();

        // Tab Manager Initialization
        this.tabManager = new TabManager(this.viewer, this);
        // this.tabManager.init(); // Moved to end of init


        this.dxf = null;
        this.currentDxfFile = null;
        this.selectedObject = null;
        this.draggingCanvas = false;

        // Track layer visibility state persistently
        this.layerStates = new Map();

        this.snappingManager = new SnappingManager(this.viewer);

        this.measurementManager = new MeasurementManager(
            this.viewer,
            this.snappingManager,
            (msg) => this.updateStatus(msg),
            (data) => {
                this.history.execute(new CmdAddMeasurement(this.measurementManager, data));
            }
        );
        this.objectInfoManager = new ObjectInfoManager(this.viewer, this.measurementManager, this);
        this.weightManager = new WeightManager(
            this,
            this.languageManager,
            this.snappingManager,
            () => {
                this.clearSelection();
            },
            (objects) => {
                this.performChainSelection(objects);
            }
        );
        this.weightManager.init();

        this.clipboardManager = new ClipboardManager(this.viewer, this.weightManager, this.languageManager);
        this.scaleManager = new ScaleManager(this.viewer, this.snappingManager, (cmd) => {
            this.history.execute(cmd);
        });

        // Initialize Events first
        this.setupUIEvents();

        // Add viewport-canvas class for crosshair cursor
        this.canvas.classList.add('viewport-canvas');

        // Initialize Tab Manager last, as it may trigger clearing selection which relies on other managers
        try {
            this.tabManager.init(); // Creates initial empty tab
        } catch (error) {
            console.error("TabManager initialization failed:", error);
            this.updateStatus("Error initializing tabs");
        }

        this.updateStatus(this.languageManager.translate('ready'));

        const urlParams = new URLSearchParams(window.location.search);
        const fileUrl = urlParams.get('file');

        // Capture 'yudano' param for WeightManager
        const yudaNo = urlParams.get('yudano');
        if (yudaNo && this.weightManager) {
            this.weightManager.yudaNo = yudaNo;
        }

        if (fileUrl) {
            this.loadUrl(fileUrl);
        }
    }

    updateStatus(msg) {
        const statusBar = document.getElementById('status-text');
        if (statusBar) statusBar.textContent = msg;
    }

    onWindowResize() {
        if (this.viewer) {
            this.viewer.resize();
        }
    }

    // ...
    onWheel(e) {
        e.preventDefault();
    }

    setupUIEvents() {
        // Canvas Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Global Events
        window.addEventListener('resize', () => this.onWindowResize());
        document.addEventListener('keydown', (e) => this.onKeyDown(e));

        // Dropdown Logic for Open File
        const openFileBtn = document.getElementById('open-file-btn');
        const fileDropdown = document.getElementById('file-dropdown');
        if (openFileBtn && fileDropdown) {
            openFileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                fileDropdown.classList.toggle('hidden');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!openFileBtn.contains(e.target) && !fileDropdown.contains(e.target)) {
                    fileDropdown.classList.add('hidden');
                }
            });
        }

        // New File Action
        const menuNewFile = document.getElementById('menu-new-file');
        if (menuNewFile) {
            menuNewFile.addEventListener('click', () => {
                this.viewer.clear(); // Clear Scene and Clipping
                this.objectInfoManager.clear(); // Clear selection UI
                this.tabManager.createNewTab("New File");
                fileDropdown?.classList.add('hidden');
            });
        }

        // Templates Action (reusing weight manager logic slightly or directly loading)
        const menuTemplates = document.getElementById('menu-templates');
        if (menuTemplates) {
            menuTemplates.addEventListener('click', () => {
                this.weightManager.openTemplateSelectorForNewTab();
                fileDropdown?.classList.add('hidden');
            });
        }

        // Start Page Events
        const startNewFile = document.getElementById('start-new-file');
        if (startNewFile) {
            startNewFile.addEventListener('click', () => {
                this.viewer.clear();
                this.objectInfoManager.clear();
                this.tabManager.createNewTab("New File");
            });
        }

        const startTemplates = document.getElementById('start-templates');
        if (startTemplates) {
            startTemplates.addEventListener('click', () => {
                this.weightManager.openTemplateSelectorForNewTab();
            });
        }

        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    // Load into NEW TAB
                    this.loadDXFFile(e.target.files[0], true);
                    fileDropdown?.classList.add('hidden');
                }
                // Reset input so same file can be selected again
                e.target.value = '';
            });
        }

        // ... Drop Zone Logic
        const dropZone = document.body;
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
                // Drop always opens in new tab? Yes usually expected.
                this.loadDXFFile(e.dataTransfer.files[0], true);
            }
        });

        // ...


        const zoomExtentsBtn = document.getElementById('zoom-menu-btn');
        if (zoomExtentsBtn) {
            zoomExtentsBtn.addEventListener('click', () => this.viewer.zoomExtents());
        }

        // Undo/Redo Buttons
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        if (undoBtn) undoBtn.addEventListener('click', () => this.history.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.history.redo());

        // Download Button
        const downloadBtn = document.getElementById('download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadDxfFile());
        }

        const settingsToggleBtn = document.getElementById('settings-toggle');
        const settingsMenu = document.getElementById('settings-menu');

        if (settingsToggleBtn && settingsMenu) {
            settingsToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                settingsMenu.classList.toggle('hidden');
                settingsToggleBtn.classList.toggle('bg-white/20');
            });

            document.addEventListener('click', (e) => {
                if (!settingsMenu.contains(e.target) && !settingsToggleBtn.contains(e.target)) {
                    settingsMenu.classList.add('hidden');
                    settingsToggleBtn.classList.remove('bg-white/20');
                }
            });
        }



        const bgColorArgs = document.getElementById('bg-color');
        if (bgColorArgs) {
            bgColorArgs.addEventListener('change', (e) => {
                this.viewer.setBackgroundColor(e.target.value);
            });
        }
        // Measurement Tools - Top Bar (Unwrapped)
        const toolIds = [
            'tool-distance', 'tool-angle', 'tool-radius',
            'tool-diameter', 'tool-area'
        ];

        const toolBtns = {};
        toolIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                // Map by tool name for easy access
                toolBtns[btn.dataset.tool] = btn;

                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const tool = btn.dataset.tool;

                    // Toggle behavior: if already active, deactivate.
                    if (this.measurementManager.activeTool === tool) {
                        this.measurementManager.deactivateTool();
                    } else {
                        // Activate new tool (Manager handles clearing others)
                        this.measurementManager.activateTool(tool);

                        // If Weight mode is active, deactivate it?
                        if (this.weightManager && this.weightManager.isActive) {
                            this.weightManager.toggleActive(); // Turn off
                        }
                    }
                    updateMeasureUI();
                });
            }
        });

        // Scale Button
        const scaleBtn = document.getElementById('scale-btn');
        if (scaleBtn) {
            scaleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.scaleManager) {
                    this.scaleManager.activate(this.selectedObjects);
                }
            });
        }

        // Weight Button
        const weightBtn = document.getElementById('weight-btn');
        if (weightBtn) {
            weightBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.weightManager) {
                    // Toggle Weight Mode
                    this.weightManager.toggleActive();

                    // If activating Weight, deactivate any active measurement tool
                    if (this.weightManager.isActive) {
                        this.measurementManager.deactivateTool();
                    }
                    updateMeasureUI();
                }
            });
        }

        // Updated UI Sync Function
        const updateMeasureUI = (activeTool) => {
            // Determine current active tool (arg or from manager)
            const currentTool = activeTool || (this.measurementManager ? this.measurementManager.activeTool : null);
            const isWeightActive = this.weightManager && this.weightManager.isActive;

            // 1. Reset all measurement tool buttons
            Object.values(toolBtns).forEach(btn => {
                btn.classList.remove('bg-cyan-500/20', 'text-[#00d9ff]', 'active');
            });

            // 2. Highlight active tool if any
            if (currentTool && toolBtns[currentTool]) {
                toolBtns[currentTool].classList.add('bg-cyan-500/20', 'text-[#00d9ff]', 'active');
            }

            // 3. Handle Weight Button
            if (weightBtn) {
                if (isWeightActive) {
                    weightBtn.classList.add('bg-cyan-500/20', 'text-[#00d9ff]', 'active');
                } else {
                    weightBtn.classList.remove('bg-cyan-500/20', 'text-[#00d9ff]', 'active');
                }
            }
        };

        const updateWeightButtonState = (hasSelection) => {
            if (weightBtn) {
                if (hasSelection) {
                    weightBtn.removeAttribute('disabled');
                    weightBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                } else {
                    weightBtn.setAttribute('disabled', 'true');
                    weightBtn.classList.add('opacity-50', 'cursor-not-allowed');
                    // Also deactivate if active
                    if (this.weightManager && this.weightManager.isActive) {
                        this.weightManager.toggleActive();
                        updateMeasureUI();
                    }
                }
            }
        };
        this.updateWeightButtonState = updateWeightButtonState;

        this.updateMeasureUI = updateMeasureUI;

        // Ensure WeightManager knows how to update main UI on close? 
        // Or just let Main handle it via events.
        // For now, onKeyDown handles ESC for both.


        // Sidebar controls
        // Sidebar controls
        const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
        const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
        const sidebar = document.getElementById('sidebar');

        if (sidebarCloseBtn && sidebar && sidebarToggleBtn) {
            sidebarCloseBtn.addEventListener('click', () => {
                sidebar.classList.add('collapsed');
                sidebarToggleBtn.classList.remove('hidden');
            });

            sidebarToggleBtn.addEventListener('click', () => {
                sidebar.classList.remove('collapsed');
                sidebarToggleBtn.classList.add('hidden');
            });
        }

        // Download Confirmation Modal logic
        const downloadModal = document.getElementById('download-modal');
        if (downloadModal) {
            const confirmBtn = document.getElementById('download-confirm-btn');
            const cancelBtn = document.getElementById('download-cancel-btn');
            const closeBtn = document.getElementById('download-modal-close');

            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    downloadModal.classList.add('hidden');
                    this.executeDownload();
                });
            }

            const closeHandler = () => {
                downloadModal.classList.add('hidden');
            };

            if (cancelBtn) cancelBtn.addEventListener('click', closeHandler);
            if (closeBtn) closeBtn.addEventListener('click', closeHandler);
        }

        this.selectedObjects = [];
        this.objectInfoManager.update([]);

        this.selectionState.active = false;
        this.selectionState.isDragging = false;
        document.getElementById('selection-box')?.classList.add('hidden');

        const infoDiv = document.getElementById('measurement-result');
        if (infoDiv) infoDiv.innerHTML = '<p class="empty-state">Click an object to view info</p>';
        this.updateStatus('Ready');
    }

    onKeyDown(e) {
        // Undo/Redo Shortcuts (Ctrl+Z, Ctrl+Y)
        if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            this.history.undo();
            return;
        }
        if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
            e.preventDefault();
            this.history.redo();
            return;
        }

        // Copy (Ctrl+C)
        if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
            e.preventDefault(); // Prevent browser copy
            this.copySelection();
            return;
        }

        // Delete Key
        if (e.key === 'Delete') {
            this.deleteSelected();
            return;
        }

        if (e.key === 'Escape') {
            // 0. Close Measurement Dropdown
            const measureMenu = document.getElementById('measure-dropdown-menu');
            if (measureMenu && !measureMenu.classList.contains('hidden')) {
                measureMenu.classList.add('hidden');
            }

            // Priority 1: Cancel active measurement if in progress
            if (this.measurementManager && this.measurementManager.activeTool && this.measurementManager.measurementPoints && this.measurementManager.measurementPoints.length > 0) {
                this.measurementManager.cancel();
                if (this.snappingManager) this.snappingManager.clearSticky(); // Clear sticky
                this.updateStatus(this.languageManager.translate('ready'));
                return;
            }

            // Priority 2: Deactivate measurement mode if active but no measurement in progress
            if (this.measurementManager && this.measurementManager.activeTool) {
                this.measurementManager.deactivateTool();
                this.updateStatus(this.languageManager.translate('ready'));
                return;
            }

            // Priority 2.3: Cancel Section Tool if active
            if (this.objectInfoManager && this.objectInfoManager.isSectionActive) {
                console.log('[Main] ESC - Canceling section tool');
                this.objectInfoManager.clear();
                this.updateStatus('Section tool cancelled.');
                return;
            }

            // Priority 2.5: Deactivate Weight Calculation Mode
            if (this.weightManager && this.weightManager.isActive) {
                this.weightManager.close(); // Deactivates and clears selection via callback
                this.updateMeasureUI(); // Update Main Button Highlight
                return;
            }

            // Priority 3: Clear selection as fallback
            this.clearSelection();
        }
    }

    deleteSelected() {
        if (this.selectedObjects.length === 0) return;

        const cmd = new CmdDelete(
            this.viewer,
            this.measurementManager,
            this.selectedObjects,
            () => {
                // On Complete (Execute): Clear Global Selection
                // Note: The command itself handles hiding/removing
                // But we need to reset the main app's selection array
                this.selectedObjects = [];
                this.objectInfoManager.update([]);
                this.weightManager.update([]);
                document.getElementById('selection-box')?.classList.add('hidden');
                this.updateStatus('Deleted ' + cmd.selection.length + ' items');
            }
        );

        this.history.execute(cmd);
    }

    copySelection() {
        if (this.clipboardManager && this.selectedObjects.length > 0) {
            this.clipboardManager.copy(this.selectedObjects);
            this.updateStatus(this.languageManager.translate('copiedToClipboard') || 'Copied to clipboard');
        }
    }

    updateUndoRedoUI(canUndo, canRedo) {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (undoBtn) {
            undoBtn.disabled = !canUndo;
            // Optionally toggle opacity classes directly if disabled attribute isn't enough for styling
        }
        if (redoBtn) {
            redoBtn.disabled = !canRedo;
        }
    }

    clearSelection() {
        if (this.viewer && this.viewer.dxfGroup) {
            this.selectedObjects.forEach(obj => {
                this.viewer.highlightObject(obj, false);
                // Clean up Smart Selection Meshes from scene
                if (obj.userData.isSmartSelection) {
                    obj.parent.remove(obj);
                    // Dispose geometry/material?
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                }
            });
        }
        if (this.measurementManager && this.measurementManager.group) {
            this.measurementManager.group.children.forEach(c => this.viewer.highlightObject(c, false));
        }
        this.selectedObjects = [];
        this.objectInfoManager.update(this.selectedObjects);
        this.weightManager.update(this.selectedObjects);
        if (this.scaleManager) this.scaleManager.updateButtonState(this.selectedObjects);
        this.updateStatus(this.languageManager.translate('selectionCleared'));
    }

    onMouseDown(e) {
        if (e.button !== 0) return;
        if (this.measurementManager && this.measurementManager.activeTool) return;

        const rect = this.canvas.getBoundingClientRect();
        this.selectionState.active = true;
        this.selectionState.startX = e.clientX;
        this.selectionState.startY = e.clientY;
        this.selectionState.isDragging = false;
    }

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        if (this.selectionState.active) {
            const dx = e.clientX - this.selectionState.startX;
            const dy = e.clientY - this.selectionState.startY;

            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                this.selectionState.isDragging = true;
                this.updateSelectionBox(e.clientX, e.clientY);
            }
        }

        if (!this.selectionState.isDragging && !this.selectionState.active) {
            const pointer = new THREE.Vector2(x, y);
            const intersects = this.viewer.raycast(pointer);
            let hit = (intersects.length > 0) ? intersects[0].object : null;

            if (this.currentHover !== hit) {
                if (this.currentHover) this.viewer.setHover(this.currentHover, false);
                if (hit) this.viewer.setHover(hit, true);
                this.currentHover = hit;
            }
        }

        if (!this.selectionState.isDragging) {
            let currentPoint = null;
            if (this.snappingManager) {
                // OSNAP Active Conditions:
                // 1. Linear Measurement Mode
                // 2. Template Placement Mode (Paste)
                // 3. Print Area Selection Mode
                const isMeasureMode = this.measurementManager && this.measurementManager.activeTool === 'distance';
                const isTemplateMode = this.weightManager && this.weightManager.templateMode;
                const isPrintMode = this.weightManager && this.weightManager.printMode;

                if (isMeasureMode || isTemplateMode || isPrintMode) {
                    const snap = this.snappingManager.findSnapPoint({ x, y });
                    if (snap) {
                        this.updateStatus('Snapped: ' + snap.type);
                        currentPoint = snap.point;
                    }
                } else {
                    // Force clear if not in active mode
                    this.snappingManager.clearMarker();
                }

                if (!currentPoint) {
                    const camera = this.viewer.camera;
                    const vec = new THREE.Vector3(x, y, 0);
                    vec.unproject(camera);
                    vec.z = 0;
                    currentPoint = vec;
                }
            }

            if (this.measurementManager && this.measurementManager.activeTool) {
                this.measurementManager.updatePreview(currentPoint);
            }

            if (currentPoint) {
                this.updateCoordinatesDisplay(currentPoint.x, currentPoint.y);
            }
        }
    }

    onMouseUp(e) {
        if (e.button !== 0) return;

        if (this.measurementManager && this.measurementManager.activeTool) {
            this.onClick(e);
            return;
        }

        // Prevent selection update if Scale Picking is active
        if (this.scaleManager && this.scaleManager.isActive && this.scaleManager.isPickingCenter) {
            // Let ScaleManager handle the click (it has its own listener)
            // But we need to ensure we don't clear selection below
            return;
        }

        if (!this.selectionState.active) return;

        this.selectionState.active = false;
        const box = document.getElementById('selection-box');
        if (box) box.classList.add('hidden');

        if (this.selectionState.isDragging) {
            const rect = this.canvas.getBoundingClientRect();
            const startX_NDC = ((this.selectionState.startX - rect.left) / rect.width) * 2 - 1;
            const startY_NDC = -((this.selectionState.startY - rect.top) / rect.height) * 2 + 1;
            const endX_NDC = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const endY_NDC = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            const isCrossing = (e.clientX < this.selectionState.startX);
            const mode = isCrossing ? 'crossing' : 'window';

            const selected = this.viewer.boxSelect(
                new THREE.Vector2(startX_NDC, startY_NDC),
                new THREE.Vector2(endX_NDC, endY_NDC),
                mode
            );

            if (selected.length > 0) {
                this.updateStatus('Selected ' + selected.length + ' entities');
                selected.forEach(obj => {
                    if (this.selectedObjects.indexOf(obj) === -1) {
                        this.viewer.highlightObject(obj, true);
                        this.selectedObjects.push(obj);
                    }
                });
                this.objectInfoManager.update(this.selectedObjects);
                this.objectInfoManager.update(this.selectedObjects);
                this.weightManager.update(this.selectedObjects);
                if (this.scaleManager) this.scaleManager.updateButtonState(this.selectedObjects);
                this.updateWeightButtonState(this.selectedObjects.length > 0);
            } else {
                this.updateStatus('No items found in box');
            }

        } else {
            this.onClick(e);
        }

        this.selectionState.isDragging = false;
    }

    updateSelectionBox(curX, curY) {
        const box = document.getElementById('selection-box');
        if (!box) return;

        // CSS is fixed, so use client coordinates directly
        const startX = this.selectionState.startX;
        const startY = this.selectionState.startY;

        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.abs(curX - startX);
        const height = Math.abs(curY - startY);

        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
        box.classList.remove('hidden');

        if (curX < startX) {
            box.classList.add('crossing');
            box.classList.remove('window');
        } else {
            box.classList.add('window');
            box.classList.remove('crossing');
        }
    }

    onClick(e) {
        if (this.measurementManager && this.measurementManager.activeTool && this.measurementManager.activeTool !== 'area') {
            const rect = this.canvas.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            let point = null;
            let intersect = null;

            const pointer = new THREE.Vector2(x, y);
            const intersects = this.viewer.raycast(pointer);
            if (intersects.length > 0) {
                intersect = intersects[0];
            }

            const snap = this.snappingManager.activeSnap;
            if (snap) {
                point = snap.point;
            } else {
                const vec = new THREE.Vector3(x, y, 0);
                vec.unproject(this.viewer.camera);
                vec.z = 0;
                point = vec;
            }

            this.measurementManager.handleClick(point, intersect);
            if (this.snappingManager) this.snappingManager.clearSticky(); // Clear sticky after click
            return;
        }



        // Area Tool (Visible Surface)
        if (this.measurementManager && this.measurementManager.activeTool === 'area') {
            const rect = this.canvas.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            const pointer = new THREE.Vector2(x, y);
            const intersects = this.viewer.raycast(pointer);

            if (intersects.length > 0) {
                const hitObject = intersects[0].object;
                let target = hitObject;
                // Handle Dimension/Insert parents if needed (similar to selection logic)
                if (hitObject.parent && hitObject.parent.userData && (hitObject.parent.userData.type === 'DIMENSION' || hitObject.parent.userData.type === 'INSERT')) {
                    target = hitObject.parent;
                }

                // 1. Select the chain
                this.clearSelection();
                this.performChainSelection([target]);

                // 2. Calculate Total Perimeter
                let totalLength = 0;
                if (this.selectedObjects.length > 0) {
                    this.selectedObjects.forEach(obj => {
                        // Length Calculation Logic
                        if (obj.userData.entity) {
                            const ent = obj.userData.entity;
                            if (ent.type === 'LINE') {
                                // Simple distance
                                const p1 = new THREE.Vector3(ent.start.x, ent.start.y, 0);
                                const p2 = new THREE.Vector3(ent.end.x, ent.end.y, 0);
                                totalLength += p1.distanceTo(p2);
                            } else if (ent.type === 'ARC') {
                                const r = ent.radius;
                                let diff = ent.endAngle - ent.startAngle;
                                if (diff < 0) diff += Math.PI * 2;
                                totalLength += r * diff;
                            } else if (ent.type === 'CIRCLE') {
                                totalLength += 2 * Math.PI * ent.radius;
                            } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
                                // If dxf-parser passed vertices
                                if (ent.vertices && ent.vertices.length > 1) {
                                    for (let i = 0; i < ent.vertices.length; i++) {
                                        // If closed or not last segment
                                        if (!ent.closed && i === ent.vertices.length - 1) continue;
                                        const v1 = ent.vertices[i];
                                        const v2 = ent.vertices[(i + 1) % ent.vertices.length];

                                        // Add Bulge (Arc segment) or Line
                                        if (v1.bulge && Math.abs(v1.bulge) > 1e-9) {
                                            const b = v1.bulge;
                                            const chord = Math.hypot(v2.x - v1.x, v2.y - v1.y);
                                            const theta = 4 * Math.atan(Math.abs(b));
                                            const arcLen = (chord / 2) * (theta / Math.sin(theta / 2)); // s = r*theta, r = chord/(2*sin(theta/2))
                                            totalLength += arcLen;
                                        } else {
                                            totalLength += Math.hypot(v2.x - v1.x, v2.y - v1.y);
                                        }
                                    }
                                }
                            }
                        } else if (obj.isLine) {
                            // Fallback for THREE.Line without entity data
                            obj.computeLineDistances(); // ensure check
                            // Just sum distance between points
                            // Assuming simple line segment
                            const pos = obj.geometry.attributes.position;
                            if (pos && pos.count >= 2) {
                                const p1 = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
                                const p2 = new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1));
                                totalLength += p1.distanceTo(p2);
                            }
                        }
                    });

                    // 3. Display Result
                    // Snap point or click point
                    let p = new THREE.Vector3(x, y, 0);
                    p.unproject(this.viewer.camera);
                    p.z = 0;
                    if (this.snappingManager && this.snappingManager.activeSnap) {
                        p = this.snappingManager.activeSnap.point;
                    }

                    this.measurementManager.showAreaMeasurement(p, totalLength);
                    console.log(`Visible Surface (Perimeter): ${totalLength}`);
                }
            }
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const pointer = new THREE.Vector2(x, y);

        // 1. Raycast Entities
        let intersects = this.viewer.raycast(pointer);

        // 2. Raycast Measurements
        let measureIntersects = [];
        if (this.measurementManager && this.measurementManager.group) {
            measureIntersects = this.viewer.raycaster.intersectObjects(this.measurementManager.group.children, true);
        }

        // 3. Priority Decision
        // If measurement hit, prefer it? Or picking logic closest?
        // Usually measurements are on top.

        let hit = null;
        let isMeasurement = false;

        // Sort both by distance logic (already sorted by three.js)
        // Check closest of both
        if (measureIntersects.length > 0) {
            const mDist = measureIntersects[0].distance;
            const eDist = (intersects.length > 0) ? intersects[0].distance : Infinity;

            if (mDist <= eDist) {
                // Measurement hit
                // Find top-level visual group
                let target = measureIntersects[0].object;
                while (target.parent && target.parent !== this.measurementManager.group) {
                    target = target.parent;
                }
                hit = target;
                isMeasurement = true;
            }
        }

        if (!hit && intersects.length > 0) {
            hit = intersects[0].object;
        }

        if (hit) {
            let target = hit;

            // Handle DXF Entity Hierarchy (Dimensions, Inserts)
            if (!isMeasurement && hit.parent && hit.parent.userData) {
                const pType = hit.parent.userData.type;
                if (pType === 'DIMENSION' || pType === 'INSERT') {
                    target = hit.parent;
                }
            }
            if (!isMeasurement && hit.userData.type === 'DIMENSION') target = hit;

            // Toggle Selection Logic (Single vs Multi)
            if (!e.ctrlKey && !e.shiftKey) {
                // Single Select: Clear others, Select Target
                this.clearSelection();
                this.viewer.highlightObject(target, true);
                this.selectedObjects.push(target);
            } else {
                // Multi Select (Ctrl/Shift): Toggle Target
                const idx = this.selectedObjects.indexOf(target);
                if (idx > -1) {
                    this.viewer.highlightObject(target, false);
                    this.selectedObjects.splice(idx, 1);
                } else {
                    this.viewer.highlightObject(target, true);
                    this.selectedObjects.push(target);
                }
            }

            // Pass the original hit intersection to ObjectInfoManager if single selection
            // Use intersects[0] from the Raycast result (variable 'intersects' in scope)
            const context = (this.selectedObjects.length === 1 && intersects.length > 0) ? intersects[0] : null;

            this.objectInfoManager.update(this.selectedObjects, context);
            this.weightManager.update(this.selectedObjects);
            this.updateStatus(this.selectedObjects.length > 0 ? 'Selected: ' + this.selectedObjects.length + ' items' : 'Ready');

        } else {
            // Click on empty space -> Clear
            this.clearSelection();
        }
    }

    performChainSelection(objects) {
        if (!this.viewer.dxfGroup) return;
        const allObjects = this.viewer.dxfGroup.children;

        // 1. Initialize ToDo list with currently selected objects
        // We use a Set for efficient removal
        const todo = new Set(objects);
        const processedIds = new Set();
        let changed = false;

        // 2. Process queue
        while (todo.size > 0) {
            // Pop an item
            const [obj] = todo;
            todo.delete(obj);

            if (processedIds.has(obj.id)) continue;

            // Find all connected entities (Chain)
            const connected = this.findConnectedEntities(obj, allObjects);

            // 3. Process the chain
            for (const c of connected) {
                // If this item was in our ToDo list, remove it (optimization)
                if (todo.has(c)) {
                    todo.delete(c);
                }

                // Mark as processed
                processedIds.add(c.id);

                // Add to selection if not already there
                if (this.selectedObjects.indexOf(c) === -1) {
                    this.selectedObjects.push(c);
                    this.viewer.highlightObject(c, true);
                    changed = true;
                }
            }
        }

        // 4. Final Updates
        this.objectInfoManager.update(this.selectedObjects);

        // Always force update WeightManager to check for closed loops using the final selection
        this.weightManager.update(this.selectedObjects);

        if (changed) {
            this.updateStatus('Chain Selected: ' + this.selectedObjects.length + ' items');
        } else {
            this.updateStatus('Selection verified: ' + this.selectedObjects.length + ' items');
        }
    }

    findConnectedEntities(startObj, allObjects) {
        const visited = new Set();
        const queue = [startObj];
        visited.add(startObj.id);

        const tolerance = 0.01;

        const getEndpoints = (obj) => {
            if (obj.geometry) {
                const attr = obj.geometry.attributes.position;
                if (!attr) return [];
                const pts = [];
                pts.push(new THREE.Vector3(attr.getX(0), attr.getY(0), attr.getZ(0)));
                const last = attr.count - 1;
                pts.push(new THREE.Vector3(attr.getX(last), attr.getY(last), attr.getZ(last)));
                return pts;
            }
            return [];
        };

        const results = [];

        while (queue.length > 0) {
            const current = queue.shift();
            const curPts = getEndpoints(current);
            if (curPts.length === 0) continue;

            for (const candidate of allObjects) {
                if (visited.has(candidate.id)) continue;
                if (!candidate.visible) continue;

                const candPts = getEndpoints(candidate);
                if (candPts.length === 0) continue;

                let connected = false;
                for (const pA of curPts) {
                    for (const pB of candPts) {
                        if (pA.distanceTo(pB) < tolerance) {
                            connected = true;
                            break;
                        }
                    }
                    if (connected) break;
                }

                if (connected) {
                    visited.add(candidate.id);
                    queue.push(candidate);
                    results.push(candidate);
                }
            }
        }

        return results;
    }

    updateCoordinatesDisplay(x, y) {
        const coordsDiv = document.getElementById('cursor-coords');
        if (coordsDiv) {
            coordsDiv.textContent = 'X: ' + x.toFixed(3) + ' | Y: ' + y.toFixed(3);
        }

        const zoomDiv = document.getElementById('zoom-level');
        if (zoomDiv && this.viewer) {
            const zoom = Math.round(this.viewer.camera.zoom * 100);
            zoomDiv.innerHTML = '<span data-i18n="zoom">Zoom</span>: ' + zoom + '%';
        }
    }

    updateInfoPanel(object, customTitle) {
        const infoDiv = document.getElementById('measurement-result');
        if (!infoDiv) return;

        let type = 'Unknown';
        if (object.geometry && object.geometry.type === 'BufferGeometry') type = 'Line/Polyline';
        if (object.isGroup) type = 'Group/Polyline';
        if (object.userData && object.userData.type) type = object.userData.type;

        let info = '<strong>Type:</strong> ' + (customTitle || type) + '<br>';
        if (!customTitle) info += '<strong>ID:</strong> ' + object.id + '<br>';

        infoDiv.innerHTML = info;
        this.updateStatus('Selected: ' + type);
    }

    async loadUrl(url) {
        try {
            this.updateStatus('Loading ' + url + '...');
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');
            const blob = await response.blob();
            const file = new File([blob], url.split('/').pop(), { type: 'application/dxf' });

            // Checks if we should open in new tab (e.g. if current is not empty)
            // For URL loading (e.g. at startup), we use current active tab if empty.
            // If startup param, init() calls loadUrl.

            await this.loadDXFFile(file, false); // Let loadDXFFile decide
        } catch (error) {
            console.error(error);
            this.updateStatus('Error loading file');
        }
    }

    async loadDXFFile(file, forceNewTab = false) {
        if (!file) return;

        const extension = file.name.split('.').pop().toLowerCase();

        // Handle Tab Logic BEFORE processing
        // If forceNewTab is true, create new tab immediately
        // If not forced, check if current tab is "New File" (empty).

        const currentTab = this.tabManager.getActiveTab();

        // If no active tab (Start Page), force new tab
        if (!currentTab) {
            forceNewTab = true;
        }

        const isEmpty = currentTab && currentTab.dxfGroup.children.length === 0 && currentTab.name === "New File";

        if (forceNewTab || !isEmpty) {
            // Create new tab and switch to it
            this.tabManager.createNewTab(file.name);
        } else {
            // Reuse current tab
            this.tabManager.updateTabName(currentTab.id, file.name);
            // Clear existing if any (though we checked isEmpty)
            this.tabManager.disposeGroup(currentTab.dxfGroup); // Dispose old content
            this.viewer.dxfGroup.clear(); // Clear children
        }

        // Pass file to the active tab state for "Download" reference
        const activeTab = this.tabManager.getActiveTab();
        activeTab.file = file;

        if (extension === 'dwg') {
            await this.handleDwgConversion(file);
        } else if (extension === 'pdf') {
            await this.handlePdfConversion(file);
        } else {
            await this.processDxfFile(file);
        }
    }

    async handleDwgConversion(file) {
        // ... existing code ...
        // 1. Check file size (max 20MB)
        const maxSize = 20 * 1024 * 1024; // 20 MB
        if (file.size > maxSize) {
            alert(this.languageManager.translate('fileTooLarge') || 'File is too large. Max 20MB allowed.');
            return;
        }

        // 2. Show Loader
        const loader = document.getElementById('conversion-loader');
        if (loader) loader.classList.remove('hidden');

        this.updateStatus(this.languageManager.translate('converting') || 'Converting DWG...');

        try {
            // 3. Prepare FormData
            const formData = new FormData();
            formData.append('file', file);

            // 4. Send POST request
            const response = await fetch('https://api.izgi.me/convert', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Conversion API failed: ${response.status}`);
            }

            // 5. Get Blob
            const blob = await response.blob();

            // 6. Convert to File object
            const convertedFile = new File([blob], file.name.replace(/\.dwg$/i, '.dxf'), {
                type: 'application/dxf'
            });

            // Update tab file reference to the converted one
            const activeTab = this.tabManager.getActiveTab();
            console.log('[Main] PDF Conversion Success. Setting isPdfSource=true for tab:', activeTab.id);
            activeTab.file = convertedFile;
            activeTab.isPdfSource = true;

            // 7. Load converted DXF
            await this.processDxfFile(convertedFile);

        } catch (error) {
            console.error('DWG Conversion Error:', error);
            alert(this.languageManager.translate('conversionFailed') || 'Dönüştürme başarısız oldu');
            this.updateStatus('Conversion Failed');
        } finally {
            // 8. Hide Loader
            if (loader) loader.classList.add('hidden');
        }
    }

    async handlePdfConversion(file) {
        // 1. Show Loader
        const loader = document.getElementById('conversion-loader');
        if (loader) loader.classList.remove('hidden');

        this.updateStatus(this.languageManager.translate('converting') || 'Converting PDF...');

        try {
            // 2. Prepare FormData
            const formData = new FormData();
            formData.append('file', file);

            // 3. Send POST request
            const response = await fetch('https://api.izgi.me/convert-pdf', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                if (response.status === 400) {
                    alert("Bu PDF taranmış bir resim gibi görünüyor, içinde çizim verisi bulunamadı.");
                    throw new Error('PDF conversion failed: No vector data found (400)');
                }
                throw new Error(`Conversion API failed: ${response.status}`);
            }

            // 4. Get Blob
            const blob = await response.blob();

            // 5. Convert to File object
            const convertedFile = new File([blob], file.name.replace(/\.pdf$/i, '.dxf'), {
                type: 'application/dxf'
            });

            // Update tab file reference to the converted one
            const activeTab = this.tabManager.getActiveTab();
            activeTab.file = convertedFile;

            // 6. Load converted DXF
            await this.processDxfFile(convertedFile);

        } catch (error) {
            console.error('PDF Conversion Error:', error);
            if (!error.message.includes('No vector data found')) {
                alert(this.languageManager.translate('conversionFailed') || 'Dönüştürme başarısız oldu');
            }
            this.updateStatus('Conversion Failed');
        } finally {
            // 7. Hide Loader
            if (loader) loader.classList.add('hidden');
        }
    }

    async processDxfFile(file) {
        this.updateStatus('Loading ' + file.name + '...');
        try {
            this.updateDownloadButtonState();

            const result = await this.loaderManager.load(file);
            console.log('Loaded Data:', result);

            this.dxf = result.type === 'dxf' ? result.data : null;

            this.updateStatus('Generating Scene...');

            const group = result.group;
            if (group) {
                console.log('Generated ' + group.children.length + ' entities');
                this.viewer.setEntities(group, result.type);
                if (result.type === 'model') {
                    // Report Face Count if available
                    if (group.children.length > 0) {
                        this.updateStatus(`Model loaded. Components/Faces: ${group.children.length}`);
                    } else {
                        this.updateStatus('Loaded 3D Model (Single Mesh).');
                    }
                } else {
                    this.updateStatus('Loaded ' + file.name);
                }
                this.updateEntityTree(group.children);

                // Layer panel update needs to be safe for non-dxf
                if (result.type === 'dxf') {
                    this.updateLayersPanel(this.viewer.dxfGroup);
                } else {
                    // For models, maybe create a default layer?
                    // The viewer.dxfGroup acts as the root for content.
                    // We can populate a fake layer for the model.
                    this.updateLayersPanel(this.viewer.dxfGroup);
                }
            }

            // Enable Tools
            // For 3D models, some 2D tools might not make sense (e.g., 2D area) but we can leave them enabled for now
            const ids = ['tool-distance', 'tool-angle', 'tool-radius', 'tool-diameter', 'tool-area', 'download-btn', 'print-btn'];
            ids.forEach(id => {
                const btn = document.getElementById(id);
                if (btn) {
                    btn.removeAttribute('disabled');
                    btn.classList.remove('opacity-50', 'cursor-not-allowed', 'disabled:opacity-30', 'disabled:opacity-50');
                }
            });

            this.viewer.zoomExtents();

            const overlay = document.getElementById('viewport-overlay');
            if (overlay) overlay.style.display = 'none';

        } catch (err) {
            console.error(err);
            this.updateStatus('Error loading file');
            alert('Error loading file: ' + err.message);
        }
    }

    updateLayersPanel(group) {
        const layersPanel = document.getElementById('layers-panel');
        if (!layersPanel) return;

        if (!group || !group.children || group.children.length === 0) {
            layersPanel.innerHTML = '<p class="empty-state">No layers available</p>';
            return;
        }

        // Extract unique layers
        const layerMap = new Map();
        for (const child of group.children) {
            const layerName = child.userData?.layer || '0';
            if (!layerMap.has(layerName)) {
                // Get or initialize layer state
                if (!this.layerStates.has(layerName)) {
                    this.layerStates.set(layerName, { visible: true });
                }

                // Get color from material if available
                let color = new THREE.Color(0xffffff);
                if (child.material?.color) {
                    color = child.material.color;
                } else if (child.children?.length > 0 && child.children[0].material?.color) {
                    color = child.children[0].material.color;
                }

                layerMap.set(layerName, {
                    name: layerName,
                    visible: this.layerStates.get(layerName).visible, // Changed to use persistent state
                    color: color
                });
            }
        }

        // Clear panel
        layersPanel.innerHTML = '';

        // Populate panel with layer items
        for (const [name, info] of layerMap) {
            const layerItem = document.createElement('div');
            layerItem.className = 'flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 transition-colors';

            const leftSide = document.createElement('div');
            leftSide.className = 'flex items-center gap-2 flex-1';

            // Color indicator
            const colorBox = document.createElement('div');
            colorBox.className = 'w-3 h-3 rounded border border-white/20';
            colorBox.style.backgroundColor = '#' + info.color.getHexString();

            // Layer name
            const nameSpan = document.createElement('span');
            nameSpan.className = 'text-sm text-white truncate';
            nameSpan.textContent = name;

            leftSide.appendChild(colorBox);
            leftSide.appendChild(nameSpan);

            // Eye toggle button
            const eyeBtn = document.createElement('button');
            eyeBtn.className = 'p-1 rounded hover:bg-white/10 transition-colors';

            // Set initial icon based on visibility state
            const updateEyeIcon = (visible) => {
                if (visible) {
                    eyeBtn.innerHTML = `
                        <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                    `;
                } else {
                    eyeBtn.innerHTML = `
                        <svg class="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                    `;
                }
            };

            updateEyeIcon(info.visible);
            eyeBtn.title = 'Toggle layer visibility';

            eyeBtn.onclick = (e) => {
                e.stopPropagation();
                info.visible = !info.visible;
                this.layerStates.get(name).visible = info.visible;
                this.toggleLayerVisibility(name, info.visible);

                // Update icon
                updateEyeIcon(info.visible);
            };

            layerItem.appendChild(leftSide);
            layerItem.appendChild(eyeBtn);
            layersPanel.appendChild(layerItem);
        }

        // Update the header to reflect the "Active" (First?) layer or just the first in list
        this.updateLayerHeader(layerMap);
    }

    updateLayerHeader(layerMap) {
        if (layerMap.size === 0) return;

        // Default to first layer for the header display
        const firstLayer = layerMap.values().next().value;
        if (!firstLayer) return;

        const headerColor = document.getElementById('layer-header-color');
        const headerName = document.getElementById('layer-header-name');
        const headerVisible = document.getElementById('layer-header-visible');

        if (headerColor) headerColor.style.backgroundColor = '#' + firstLayer.color.getHexString();
        if (headerName) headerName.textContent = firstLayer.name;

        // Update Eye Icon based on visibility
        if (headerVisible) {
            const isVisible = firstLayer.visible;
            headerVisible.innerHTML = isVisible
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M1 1l22 22" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /></svg>`;

            // Remove old listeners to prevent duplicates (simple way: clone node)
            // Or better: ensure we only attach once? But this runs on every update.
            // Let's use a simpler approach: Assign onclick directly.
            headerVisible.onclick = (e) => {
                e.stopPropagation();
                this.toggleLayer(firstLayer.name);
            };
        }
    }

    toggleLayerVisibility(layerName, visible) {
        if (!this.viewer.dxfGroup) return;

        for (const child of this.viewer.dxfGroup.children) {
            if (child.userData?.layer === layerName) {
                child.visible = visible;

                // Handle groups recursively
                if (child.isGroup && child.children) {
                    child.children.forEach(c => c.visible = visible);
                }
            }
        }
    }

    updateEntityTree(threeObjects) {
        const treeContainer = document.getElementById('entity-tree-content');
        if (!treeContainer) return;

        treeContainer.innerHTML = '';
        if (!threeObjects || threeObjects.length === 0) {
            treeContainer.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm" data-i18n="noEntities">No entities loaded</div>';
            return;
        }

        const counts = {};
        const groups = {};

        threeObjects.forEach(obj => {
            const type = (obj.userData && obj.userData.type) || 'UNKNOWN';
            if (!counts[type]) {
                counts[type] = 0;
                groups[type] = [];
            }
            counts[type]++;
            groups[type].push(obj);
        });

        Object.keys(groups).forEach(type => {
            const count = counts[type];
            const groupDiv = document.createElement('div');
            groupDiv.className = 'mb-2';

            const header = document.createElement('button');
            header.className = 'flex items-center w-full px-2 py-1 text-sm font-semibold text-gray-300 hover:bg-white/5 rounded transition-colors text-left';
            header.innerHTML = '<span class="mr-2 opacity-50">▶</span>' +
                '<span>' + type + '</span>' +
                '<span class="ml-auto text-xs opacity-50 bg-white/10 px-1.5 rounded">' + count + '</span>';

            const list = document.createElement('div');
            list.className = 'hidden pl-4 mt-1 border-l border-white/10 ml-2 space-y-0.5';

            header.onclick = () => {
                const isHidden = list.classList.contains('hidden');
                if (isHidden) {
                    list.classList.remove('hidden');
                    header.querySelector('span').textContent = '▼';
                } else {
                    list.classList.add('hidden');
                    header.querySelector('span').textContent = '▶';
                }
            };

            const maxItems = 50;
            const itemsToShow = groups[type].slice(0, maxItems);

            itemsToShow.forEach(obj => {
                const item = document.createElement('div');
                item.className = 'text-xs text-gray-400 hover:text-white hover:bg-white/5 px-2 py-1 rounded cursor-pointer truncate';
                item.textContent = type + ' #' + obj.id;
                item.title = 'ID: ' + obj.id;
                item.onclick = (e) => {
                    e.stopPropagation();
                    if (this.selectedObject) this.viewer.highlightObject(this.selectedObject, false);
                    this.selectedObject = obj;
                    this.viewer.highlightObject(obj, true);
                    this.updateInfoPanel(obj);
                    this.updateStatus('Selected: ' + type);
                };
                list.appendChild(item);
            });

            if (groups[type].length > maxItems) {
                const more = document.createElement('div');
                more.className = 'text-xs text-gray-500 italic px-2 py-1';
                more.textContent = '+ ' + (groups[type].length - maxItems) + ' more...';
                list.appendChild(more);
            }

            groupDiv.appendChild(header);
            groupDiv.appendChild(list);
            treeContainer.appendChild(groupDiv);
        });
    }

    updateDownloadButtonState() {
        const btn = document.getElementById('download-btn');
        if (btn) {
            const activeTab = this.tabManager ? this.tabManager.getActiveTab() : null;
            if (activeTab && activeTab.file) {
                btn.disabled = false;
            } else {
                btn.disabled = true;
            }
        }
    }

    downloadDxfFile() {
        // Use active tab's file
        const activeTab = this.tabManager ? this.tabManager.getActiveTab() : null;
        if (!activeTab || !activeTab.file) return;

        // Pass file to executor
        this.currentDxfFile = activeTab.file; // legacy sync or just pass arg

        const modal = document.getElementById('download-modal');
        if (modal) {
            modal.classList.remove('hidden');
        } else {
            this.executeDownload();
        }
    }

    executeDownload() {
        if (!this.currentDxfFile) return;
        const url = URL.createObjectURL(this.currentDxfFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.currentDxfFile.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    handleObjectSelection(intersect, isMultiSelect) {
        if (!intersect) return;
        const hit = intersect.object;
        let target = hit;

        // Check for CAD Face (OCCT - Explicit)
        if (hit.userData && hit.userData.faceId !== undefined) {
            target = hit;
        }
        // fallback: Smart Selection for single mesh
        else if (hit.isMesh && hit.geometry && hit.geometry.index) {
            if (hit.userData.isSmartSelection) {
                target = hit;
            } else {
                // Create Smart Selection
                const indices = this.selectionHelper.selectConnectedFaces(hit, intersect.faceIndex);
                if (indices.length > 0) {
                    target = this.createSmartSelectionMesh(hit, indices);
                }
            }
        }
        else {
            // Handle DXF Entity Hierarchy (Dimensions, Inserts)
            if (hit.parent && hit.parent.userData) {
                const pType = hit.parent.userData.type;
                if (pType === 'DIMENSION' || pType === 'INSERT') {
                    target = hit.parent;
                }
            }
            if (hit.userData.type === 'DIMENSION') target = hit;
        }

        const idx = this.selectedObjects.indexOf(target);

        if (isMultiSelect) {
            // Toggle
            if (idx > -1) {
                // Remove
                this.viewer.highlightObject(target, false);
                this.selectedObjects.splice(idx, 1);
                // If it was a smart selection, maybe remove it from scene?
                if (target.userData.isSmartSelection) {
                    target.parent.remove(target);
                    // geometry dispose?
                }
            } else {
                // Add
                this.viewer.highlightObject(target, true);
                this.selectedObjects.push(target);
            }
        } else {
            // Single Select
            this.clearSelection();
            this.viewer.highlightObject(target, true);
            this.selectedObjects = [target];
        }

        // Update UI
        this.objectInfoManager.update(this.selectedObjects);
        this.weightManager.update(this.selectedObjects);
        if (this.scaleManager) this.scaleManager.updateButtonState(this.selectedObjects);
        this.updateWeightButtonState(this.selectedObjects.length > 0);
        this.updateStatus('Selected ' + this.selectedObjects.length + ' item(s)');
    }

    createSmartSelectionMesh(originalMesh, faceIndices) {
        // faceIndices are Triangle indices.
        // We need to construct a new BufferGeometry from these triangles.
        const originGeo = originalMesh.geometry;
        const posAttr = originGeo.attributes.position;
        const normAttr = originGeo.attributes.normal;
        const indexAttr = originGeo.index;

        // Count vertices needed? No, usually we just assume disjoint selection 
        // or just copy indices to a new index buffer for the subset?
        // But the subset might range across the whole vertex buffer.
        // Easiest (but maybe memory heavy): detailed clone.
        // Better: Share attributes, separate index.

        // Construct new Index Array
        const newIndices = new Uint32Array(faceIndices.length * 3);
        for (let i = 0; i < faceIndices.length; i++) {
            const fIdx = faceIndices[i];
            newIndices[i * 3] = indexAttr.getX(fIdx * 3);
            newIndices[i * 3 + 1] = indexAttr.getX(fIdx * 3 + 1);
            newIndices[i * 3 + 2] = indexAttr.getX(fIdx * 3 + 2);
        }

        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', posAttr); // Share reference
        if (normAttr) newGeo.setAttribute('normal', normAttr); // Share reference
        newGeo.setIndex(new THREE.BufferAttribute(newIndices, 1));

        // Material
        // const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, depthTest: false }); // Debug
        // Use standard material but maybe offset or just rely on highlightHelper?
        // Actually, we want to return a Mesh that LOOKS like the selection.
        // But the viewer.highlightObject handles the Visual Highlight (red overlay).
        // So this mesh can be invisible? Or just a transparent overlay?
        // Actually, for it to be "Selected", it enters selectedObjects.
        // Viewer.highlightObject adds a SelectionHelper BOX or Edge? 
        // Viewer.highlightObject usually changes material emissive OR adds a box.
        // Let's make it a clone of original material.

        const material = originalMesh.material.clone();
        // material.color.setHex(0xff0000); // Test

        const mesh = new THREE.Mesh(newGeo, material);
        mesh.applyMatrix4(originalMesh.matrixWorld); // Apply transform? 
        // Wait, if we add it to Scene, we need world pos.
        // If we add it to originalMesh parent, we use local.

        // Usually originalMesh is in a group.
        // If we add to scene root, we use World Matrix (or manual Copy).
        // Better to add to same parent? 
        // But originalMesh might be rotated.
        // Let's add to viewer.dxfGroup or Scene.
        // If we share geometry attributes (which are local space), we must match the transform of original mesh.

        mesh.position.copy(originalMesh.position);
        mesh.rotation.copy(originalMesh.rotation);
        mesh.scale.copy(originalMesh.scale);
        mesh.updateMatrixWorld();

        mesh.userData = {
            type: 'FACE',
            faceId: 'Smart-' + faceIndices[0], // ID
            isSmartSelection: true,
            originalColor: originalMesh.userData.originalColor || material.color
        };

        // Add to scene to be rendered and raycasted?
        // Actually, if we add it, it overlaps exactly (z-fight).
        // Ideally, we just use it for "Selection Logic".
        // But we want the user to SEE it selected.
        // Viewer.highlightObject usually does:
        // if (val) material.emissive.setHex(0x...);

        // To avoid Z-fight, polygonOffset?
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;

        this.viewer.dxfGroup.add(mesh);
        return mesh;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new DXFViewerApp();
});
