import * as THREE from 'three';
import { SceneViewer } from './scene-viewer.js';
import { DxfLoader } from './dxf-loader.js';
import { LanguageManager } from './localization.js';
import { SnappingManager } from './snapping-manager.js';
import { MeasurementManager } from './measurement-manager.js';
import { ObjectInfoManager } from './object-info-manager.js';
import { WeightManager } from './weight-manager.js';

class DXFViewerApp {
    constructor() {
        this.canvas = document.getElementById('viewport');
        this.selectedObjects = [];
        this.selectionState = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0
        };
        this.init();
    }

    init() {
        this.languageManager = new LanguageManager();
        this.languageManager.init();

        this.viewer = new SceneViewer(this.canvas);
        this.viewer.languageManager = this.languageManager;

        this.loader = new DxfLoader();
        this.dxf = null;
        this.selectedObject = null;
        this.draggingCanvas = false;

        // Track layer visibility state persistently
        this.layerStates = new Map();

        this.snappingManager = new SnappingManager(this.viewer);
        this.measurementManager = new MeasurementManager(this.viewer, this.snappingManager);
        this.objectInfoManager = new ObjectInfoManager(this.viewer);
        this.weightManager = new WeightManager(this.viewer, this.languageManager, this.snappingManager, () => {
            this.clearSelection();
        });
        this.weightManager.init();

        this.setupUIEvents();
        this.updateStatus(this.languageManager.translate('ready'));

        const urlParams = new URLSearchParams(window.location.search);
        const fileUrl = urlParams.get('file');

        if (fileUrl) {
            // Hide file upload button when file is loaded via URL parameter
            const fileUploadContainer = document.querySelector('.file-upload-container');
            if (fileUploadContainer) {
                fileUploadContainer.style.display = 'none';
            }
            this.loadUrl(fileUrl);
        }
    }

    updateStatus(msg) {
        const statusBar = document.getElementById('status-text');
        if (statusBar) statusBar.textContent = msg;
    }

    setupUIEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        document.addEventListener('keydown', (e) => this.onKeyDown(e));

        this.canvas.addEventListener('dblclick', (e) => {
            if (this.measurementManager && this.measurementManager.activeTool) return;

            const rect = this.canvas.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            const pointer = new THREE.Vector2(x, y);

            const intersects = this.viewer.raycast(pointer);
            if (intersects.length > 0) {
                const hit = intersects[0].object;

                if (hit.parent && hit.parent.userData && (hit.parent.userData.type === 'LWPOLYLINE' || hit.parent.userData.type === 'POLYLINE')) {
                    const group = hit.parent;

                    // Toggle selection (cumulative, like single click)
                    const idx = this.selectedObjects.indexOf(group);
                    if (idx > -1) {
                        this.viewer.highlightObject(group, false);
                        this.selectedObjects.splice(idx, 1);
                    } else {
                        this.viewer.highlightObject(group, true);
                        this.selectedObjects.push(group);
                    }

                    this.objectInfoManager.update(this.selectedObjects);
                    this.weightManager.update(this.selectedObjects);
                    this.updateStatus(this.selectedObjects.length > 0 ? 'Selected: ' + this.selectedObjects.length + ' items' : 'Ready');
                    return;
                }

                const connected = this.findConnectedEntities(hit, this.viewer.dxfGroup.children);
                connected.forEach(obj => {
                    this.viewer.highlightObject(obj, true);
                    if (this.selectedObjects.indexOf(obj) === -1) this.selectedObjects.push(obj);
                });

                this.viewer.highlightObject(hit, true);
                if (this.selectedObjects.indexOf(hit) === -1) this.selectedObjects.push(hit);

                this.objectInfoManager.update(this.selectedObjects);
                this.weightManager.update(this.selectedObjects);
                this.updateStatus('Chain Selected: ' + (connected.length + 1) + ' items');
            }
        });

        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.loadDXFFile(e.target.files[0]);
                }
            });
        }

        const dropZone = document.body;
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
                this.loadDXFFile(e.dataTransfer.files[0]);
            }
        });

        const zoomExtentsBtn = document.getElementById('zoom-menu-btn');
        if (zoomExtentsBtn) {
            zoomExtentsBtn.addEventListener('click', () => this.viewer.zoomExtents());
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

        // Layers toggle
        const layersToggleBtn = document.getElementById('layers-toggle');
        const layersMenu = document.getElementById('layers-menu');

        if (layersToggleBtn && layersMenu) {
            layersToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                layersMenu.classList.toggle('hidden');
                layersToggleBtn.classList.toggle('bg-white/20');
            });

            document.addEventListener('click', (e) => {
                if (!layersMenu.contains(e.target) && !layersToggleBtn.contains(e.target)) {
                    layersMenu.classList.add('hidden');
                    layersToggleBtn.classList.remove('bg-white/20');
                }
            });
        }

        const bgColorArgs = document.getElementById('bg-color');
        if (bgColorArgs) {
            bgColorArgs.addEventListener('change', (e) => {
                this.viewer.setBackgroundColor(e.target.value);
            });
        }

        const distBtn = document.querySelector('[data-tool="distance"]');
        const angleBtn = document.querySelector('[data-tool="angle"]');

        const setActiveTool = (tool) => {
            if (distBtn) distBtn.classList.remove('active', 'bg-blue-600');
            if (angleBtn) angleBtn.classList.remove('active', 'bg-blue-600');

            if (tool === 'distance' && distBtn) distBtn.classList.add('active', 'bg-blue-600');
            if (tool === 'angle' && angleBtn) angleBtn.classList.add('active', 'bg-blue-600');
        };

        if (distBtn) {
            distBtn.addEventListener('click', () => {
                this.measurementManager.activateTool('distance');
                setActiveTool('distance');
                this.updateStatus(this.languageManager.translate('measureDistance') || 'Measure Distance: Click first point');
            });
        }

        if (angleBtn) {
            angleBtn.addEventListener('click', () => {
                this.measurementManager.activateTool('angle');
                setActiveTool('angle');
                this.updateStatus(this.languageManager.translate('measureAngle') || 'Measure Angle: Click Center Point');
            });
        }

        window.addEventListener('keydown', (e) => this.onKeyDown(e));

        // Sidebar controls
        const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
        const sidebarFloatingToggle = document.getElementById('sidebar-floating-toggle');
        const sidebar = document.getElementById('sidebar');

        if (sidebarCloseBtn && sidebar && sidebarFloatingToggle) {
            sidebarCloseBtn.addEventListener('click', () => {
                sidebar.classList.add('hidden');
                sidebarFloatingToggle.classList.remove('hidden');
            });

            sidebarFloatingToggle.addEventListener('click', () => {
                sidebar.classList.remove('hidden');
                sidebarFloatingToggle.classList.add('hidden');
            });
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
        if (e.key === 'Escape') {
            // Priority 1: Cancel active measurement if in progress
            if (this.measurementManager && this.measurementManager.activeTool && this.measurementManager.measurementPoints && this.measurementManager.measurementPoints.length > 0) {
                this.measurementManager.cancel();
                this.updateStatus(this.languageManager.translate('ready'));
                return;
            }

            // Priority 2: Deactivate measurement mode if active but no measurement in progress
            if (this.measurementManager && this.measurementManager.activeTool) {
                this.measurementManager.deactivateTool();
                this.updateStatus(this.languageManager.translate('ready'));
                return;
            }

            // Priority 3: Clear selection as fallback
            this.clearSelection();
        }
    }

    clearSelection() {
        if (this.viewer && this.viewer.dxfGroup) {
            this.selectedObjects.forEach(obj => this.viewer.highlightObject(obj, false));
        }
        if (this.measurementManager && this.measurementManager.group) {
            this.measurementManager.group.children.forEach(c => this.viewer.highlightObject(c, false));
        }
        this.selectedObjects = [];
        this.objectInfoManager.update(this.selectedObjects);
        this.weightManager.update(this.selectedObjects);
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
                const snap = this.snappingManager.findSnapPoint({ x, y });
                if (snap) {
                    this.updateStatus('Snapped: ' + snap.type);
                    this.canvas.style.cursor = 'crosshair';
                    currentPoint = snap.point;
                } else {
                    this.canvas.style.cursor = 'default';
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
            } else {
                this.updateStatus('No items found in box');
            }

        } else {
            this.onClick(e);
        }
    }

    updateSelectionBox(curX, curY) {
        const box = document.getElementById('selection-box');
        if (!box) return;

        const rect = this.canvas.getBoundingClientRect();
        const startX = this.selectionState.startX - rect.left;
        const startY = this.selectionState.startY - rect.top;
        const currentX = curX - rect.left;
        const currentY = curY - rect.top;

        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.width = width + 'px';
        box.style.height = height + 'px';
        box.classList.remove('hidden');

        if (currentX < startX) {
            box.classList.add('crossing');
            box.classList.remove('window');
        } else {
            box.classList.add('window');
            box.classList.remove('crossing');
        }
    }

    onClick(e) {
        if (this.measurementManager && this.measurementManager.activeTool) {
            const rect = this.canvas.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            let point = null;
            let hitObject = null;

            const pointer = new THREE.Vector2(x, y);
            const intersects = this.viewer.raycast(pointer);
            if (intersects.length > 0) {
                hitObject = intersects[0].object;
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

            this.measurementManager.handleClick(point, hitObject);
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const pointer = new THREE.Vector2(x, y);

        const intersects = this.viewer.raycast(pointer);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            let target = hit;

            // Use parent only for Dimension and Insert (not for Polyline - we want individual segments)
            if (hit.parent && hit.parent.userData) {
                const pType = hit.parent.userData.type;
                if (pType === 'DIMENSION' || pType === 'INSERT') {
                    target = hit.parent;
                }
            }
            // Fallback: Check if hit itself is marked (e.g. Dimensions might have child/parent weirdness)
            if (hit.userData.type === 'DIMENSION') target = hit;

            const idx = this.selectedObjects.indexOf(target);

            if (idx > -1) {
                this.viewer.highlightObject(target, false);
                this.selectedObjects.splice(idx, 1);
            } else {
                this.viewer.highlightObject(target, true);
                this.selectedObjects.push(target);
            }

            this.objectInfoManager.update(this.selectedObjects);
            this.weightManager.update(this.selectedObjects);
            this.updateStatus(this.selectedObjects.length > 0 ? 'Selected: ' + this.selectedObjects.length + ' items' : 'Ready');

        } else {
            this.updateStatus('Ready');
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
            this.loadDXFFile(file);
        } catch (error) {
            console.error(error);
            this.updateStatus('Error loading file');
        }
    }

    async loadDXFFile(file) {
        if (!file) return;

        this.updateStatus('Parsing DXF...');
        try {
            const dxf = await this.loader.load(file);
            console.log('DXF Data:', dxf);
            this.dxf = dxf;

            this.updateStatus('Generating 3D Scene...');
            if (dxf) {
                const group = this.loader.generateThreeEntities(dxf);
                console.log('Generated ' + group.children.length + ' entities from DXF');
                this.viewer.setEntities(group);
                this.updateStatus('Loaded ' + file.name);
                this.updateEntityTree(group.children);
                this.updateLayersPanel(this.viewer.dxfGroup);
            }

            this.viewer.zoomExtents();

            const overlay = document.getElementById('viewport-overlay');
            if (overlay) overlay.style.display = 'none';

        } catch (err) {
            console.error(err);
            this.updateStatus('Error parsing DXF');
            alert('Error loading DXF file. See console for details.');
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
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new DXFViewerApp();
});
