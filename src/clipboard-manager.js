import * as THREE from 'three';

export class ClipboardManager {
    constructor(viewer, weightManager, languageManager) {
        this.viewer = viewer;
        this.weightManager = weightManager;
        this.languageManager = languageManager;
        this.items = [];
        this.storageKey = 'dxf_clipboard_items';
        this.sidebar = document.getElementById('clipboard-sidebar');
        this.container = document.getElementById('clipboard-list');
        this.maxItems = 20;

        this.init();
    }

    init() {
        this.loadFromStorage();
        this.renderSidebar();

        // Add toggle button listener if it exists
        this.toggleBtn = document.getElementById('clipboard-toggle-btn');
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => {
                this.sidebar.classList.remove('collapsed');
                this.toggleBtn.classList.add('hidden');
            });
        }

        const closeBtn = document.getElementById('clipboard-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.sidebar.classList.add('collapsed');
                if (this.toggleBtn) this.toggleBtn.classList.remove('hidden');
            });
        }

        const clearBtn = document.getElementById('clipboard-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clear();
            });
        }
    }

    copy(selectedObjects) {
        if (!selectedObjects || selectedObjects.length === 0) return;

        // 1. Serialize Objects
        const serializedData = this.serializeObjects(selectedObjects);

        // 2. Generate Thumbnail (Async? No, sync for now)
        const thumbnail = this.generateThumbnail(selectedObjects);

        // 3. Capture Metadata
        let metadata = null;
        if (this.weightManager && this.weightManager.isActive && this.weightManager.lastCalculatedStats) {
            metadata = { ...this.weightManager.lastCalculatedStats };

            // Capture current scale if available (from template mode state or calculated stats)
            // WeightManager.lastCalculatedStats doesn't strictly track 'current placement scale' unless we put it there.
            // But if we just Placed something, `templateScale` is on the manager.
            // The user request: "Captured Metadata içine scale de eklemen lazım".
            // If I Copy *Reference* Objects (selected), what is their scale?? 
            // 1:1 usually. 
            // UNLESS I am copying *Placed* objects that have metadata.
            // But here we are copying Selected Objects.
            // The user implies that if I calculate weight (which might involve a scale factor e.g. for printing), 
            // I should save that scale.

            // Let's save `this.weightManager.templateScale` if it exists.
            if (this.weightManager.templateScale !== undefined) {
                metadata.numericScale = this.weightManager.templateScale;
            } else {
                metadata.numericScale = 1.0;
            }
        }

        const item = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            count: selectedObjects.length,
            thumbnail: thumbnail,
            data: serializedData,
            metadata: metadata
        };

        // Add to front
        this.items.unshift(item);

        // Limit size
        if (this.items.length > this.maxItems) {
            this.items = this.items.slice(0, this.maxItems);
        }

        this.saveToStorage();
        this.renderSidebar();

        // Open sidebar to show result
        if (this.sidebar) {
            this.sidebar.classList.remove('collapsed');
            if (this.toggleBtn) this.toggleBtn.classList.add('hidden');
        }

        return item;
    }

    serializeObjects(objects) {
        const serialized = [];
        objects.forEach(obj => {
            const userData = obj.userData;

            // Handle Smart Selection (Mesh Face)
            if (obj.isMesh && !userData.entity) { // Assuming generated meshes don't have 'entity' yet?
                // Or check userData.isSmartSelection?
                // If it's a Mesh, we try to extract edges.
                const extracted = this.extract2DEntitiesFromFace(obj);
                serialized.push(...extracted);
                return;
            }

            // Determine correct color (Original if selected/highlighted, else current)
            let color = obj.material.color.getHex();
            if (userData.originalColor) {
                // originalColor might be a Color object or hex value
                if (userData.originalColor.isColor) {
                    color = userData.originalColor.getHex();
                } else if (typeof userData.originalColor === 'number') {
                    color = userData.originalColor;
                }
            }

            serialized.push({
                type: userData.type,
                layer: userData.layer,
                entity: userData.entity,
                color: color
            });
        });
        return serialized;
    }

    generateThumbnail(objects) {
        if (!objects.length) return null;

        const width = 200;
        const height = 150;

        // 1. Create a temporary scene
        const scene = new THREE.Scene();
        // Use a dark gradient or solid color background that matches the app theme
        scene.background = new THREE.Color(0x2d2d2d);

        // 2. Add lights
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(1, 1, 1);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0xffffff, 0.8));

        // 3. Clone objects
        const group = new THREE.Group();
        objects.forEach(obj => {
            // We need to clone geometry and material to ensure we don't mess up the original
            // But strict clone might be enough if we just change position
            const clone = obj.clone();

            // Fix: ensure material is visible and has correct color
            if (clone.material) {
                // clone.material = clone.material.clone(); // If we needed to change it
                // For now, assume original material is fine (usually Basic or LineBasic)
            }

            // Reset transforms that might come from parent? 
            // The obj.clone() copies local transform. 
            // If the original object was effectively at (1000,1000) world space, 
            // its clone will also be there if added to scene root.
            // We need to re-center them relative to each other.

            // To do this, we add them to a group, then center the group.
            // BUT: if we just add cloned objects, their positions are preserved.
            // If they were children of a parent with a transform, we lose that parent transform.
            // This is complex. For simple DXF entities (lines being children of a root),
            // their position is usually 0,0,0 and geometry has coordinates.

            group.add(clone);
        });

        // 4. Center and Fit
        // We must ensure the bounding box is calculated correctly based on world positions of geometry
        // Since we put them in a fresh group at 0,0,0, we compute box of that group.
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Shift group to center
        group.position.sub(center);
        scene.add(group);

        // 5. Setup Camera
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const fov = 45;
        const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, maxDim * 100);

        // Calculate distance to fit
        const distance = maxDim / (2 * Math.tan((Math.PI * fov) / 360));
        camera.position.set(0, 0, distance * 1.5);
        camera.lookAt(0, 0, 0);

        // 6. Render
        if (!this.thumbRenderer) {
            this.thumbRenderer = new THREE.WebGLRenderer({
                alpha: false,
                preserveDrawingBuffer: true,
                antialias: true
            });
            this.thumbRenderer.setSize(width, height);
            this.thumbRenderer.setPixelRatio(1);
        }

        this.thumbRenderer.render(scene, camera);
        const dataURL = this.thumbRenderer.domElement.toDataURL('image/png');

        // Clean up scene to free memory? 
        // Three.js doesn't auto-dispose geometries just by dropping ref, 
        // but we cloned them. The clones share geometry with original? 
        // obj.clone() shares geometry. So we don't dispose geometry.
        // We only dispose the group structure.
        scene.clear();

        return dataURL;
    }

    saveToStorage() {
        try {
            // LocalStorage Limit Safety
            // Thumbnails can be large. If we exceed, we might need to remove old items faster.
            // Or store only last 5 items.
            while (true) {
                try {
                    localStorage.setItem(this.storageKey, JSON.stringify(this.items));
                    break;
                } catch (e) {
                    if (this.items.length > 1) {
                        this.items.pop(); // Remove oldest
                    } else {
                        // Even 1 item is too big?
                        console.warn('Clipboard item too large to save', e);
                        break;
                    }
                }
            }
        } catch (e) {
            console.warn('Clipboard storage error', e);
        }
    }

    loadFromStorage() {
        const data = localStorage.getItem(this.storageKey);
        if (data) {
            try {
                this.items = JSON.parse(data);
            } catch (e) {
                console.error('Failed to load clipboard', e);
                this.items = [];
            }
        }
    }

    renderSidebar() {
        if (!this.container) return;

        this.container.innerHTML = '';

        if (this.items.length === 0) {
            const emptyText = this.languageManager ? this.languageManager.translate('clipboardEmpty') : 'Clipboard empty';
            this.container.innerHTML = `<div class="text-gray-500 text-center text-sm p-4">${emptyText}</div>`;
            return;
        }

        this.items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'clipboard-item bg-white/5 border border-white/10 rounded-lg p-2 mb-2 hover:bg-white/10 transition-colors cursor-pointer group relative';

            // Use thumbnail if available
            const thumbContent = item.thumbnail
                ? `<img src="${item.thumbnail}" class="w-full h-24 object-contain bg-black/50 rounded">`
                : `<div class="w-full h-24 bg-black/50 rounded flex items-center justify-center">${this.getPlaceholderIcon(item.count)}</div>`;

            const selectionText = this.languageManager ? this.languageManager.translate('selectionItem') : 'Selection';
            const itemsText = this.languageManager ? this.languageManager.translate('itemsCount').replace('{count}', item.count) : `${item.count} items`;

            el.innerHTML = `
                <div class="flex flex-col gap-2">
                    ${thumbContent}
                    <div class="flex justify-between items-center px-1">
                        <div class="flex-1 min-w-0">
                             <div class="text-xs text-gray-400 font-mono">${itemsText}</div>
                        </div>
                        <div class="text-xs text-gray-600">${new Date(item.timestamp).toLocaleTimeString()}</div>
                    </div>
                </div>
                <button class="delete-btn opacity-0 group-hover:opacity-100 p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-full transition-all absolute top-2 right-2 shadow-sm transform scale-90 hover:scale-100">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            `;

            const deleteBtn = el.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeItem(item.id);
            });

            // Item Click Action - Log Data -> Paste
            el.addEventListener('click', () => {
                this.paste(item);
            });

            this.container.appendChild(el);
        });
    }

    removeItem(id) {
        this.items = this.items.filter(i => i.id !== id);
        this.saveToStorage();
        this.renderSidebar();
    }

    paste(item) {
        console.log('[Clipboard] Pasting item:', item.id);

        if (!item.data || !item.data.length) return;

        this.reconstructEntities(item.data).then(objects => {
            console.log('[Clipboard] Reconstructed', objects.length, 'entities');

            if (objects.length > 0) {
                // 2. Start Placement using WeightManager
                if (this.weightManager) {
                    this.weightManager.startPlacement(objects, item.metadata);

                    // 3. Apply Scale if captured
                    if (item.metadata && item.metadata.numericScale) {
                        this.weightManager.templateScale = item.metadata.numericScale;
                        // Approximate scroll steps restoration or just set scale
                        this.weightManager.scrollSteps = 0; // Reset steps, just rely on hard set scale

                        this.weightManager.applyFloatingTransform();
                        this.weightManager.updateScaleDisplay();
                    }
                }
            }
        });
    }

    async reconstructEntities(serializedList) {
        const { DxfLoader } = await import('./dxf-loader.js');
        const loader = new DxfLoader();
        const objects = [];

        for (const data of serializedList) {
            // data matches struct: { type, layer, entity, color }
            // loader.convertEntity expects (entity, dxf)
            // We don't have full dxf object, but convertEntity mostly needs 'entity' struct.
            // Some methods might need dxf.blocks/header.
            // If entities are simple (LINE, CIRCLE, LWPOLYLINE), it should work.
            // INSERT (Blocks) will fail if we don't have block definitions.
            // For Phase 1/2, we assume simple primitives or decomposed blocks.

            const dummyDxf = { blocks: {}, header: {} }; // Mock
            try {
                const object = loader.convertEntity(data.entity, dummyDxf);
                if (object) {
                    // Restore color
                    if (data.color !== undefined) {
                        if (object.material) {
                            object.material.color.setHex(data.color);
                            // Ensure basic material
                            object.material.needsUpdate = true;
                        }
                    }
                    object.userData.layer = data.layer;
                    objects.push(object);
                }
            } catch (e) {
                console.warn('Failed to reconstruct clipboard entity', e);
            }
        }
        return objects;
    }

    getPlaceholderIcon(count) {
        return `<svg class="text-gray-600 w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
    }

    extract2DEntitiesFromFace(object) {
        // Similar to ObjectInfoManager.handleExtractFace but returns data structure for serialization
        const geometry = object.geometry;
        if (!geometry) return [];

        const edges = new THREE.EdgesGeometry(geometry, 10);
        const positions = edges.attributes.position;

        // Compute Face Normal for Flattening
        geometry.computeVertexNormals();
        const normalAttribute = geometry.attributes.normal;
        const normal = new THREE.Vector3(0, 0, 1);
        if (normalAttribute && normalAttribute.count > 0) {
            normal.set(normalAttribute.getX(0), normalAttribute.getY(0), normalAttribute.getZ(0));
            normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(object.matrixWorld)).normalize();
        }

        // Quaternion to rotate Normal to Z-axis (Flatten)
        const targetNormal = new THREE.Vector3(0, 0, 1);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(normal, targetNormal);

        const entities = [];
        for (let i = 0; i < positions.count; i += 2) {
            const v1 = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
            const v2 = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));

            // Apply Object Matrix (World Space)
            v1.applyMatrix4(object.matrixWorld);
            v2.applyMatrix4(object.matrixWorld);

            // Apply Flattening Rotation
            v1.applyQuaternion(quaternion);
            v2.applyQuaternion(quaternion);

            // Determine correct color
            let color = 0xFFFFFF;
            if (object.userData.originalColor) {
                if (object.userData.originalColor.isColor) {
                    color = object.userData.originalColor.getHex();
                } else if (typeof object.userData.originalColor === 'number') {
                    color = object.userData.originalColor;
                }
            } else if (object.material && object.material.color) {
                // Fallback to current color if no original, but check if it's the selection color (Cyan 0x00d9ff)
                const hex = object.material.color.getHex();
                if (hex !== 0x00d9ff) {
                    color = hex;
                }
            }

            // Create Entity Data
            entities.push({
                type: 'LINE',
                layer: '0',
                entity: {
                    type: 'LINE',
                    startPoint: { x: v1.x, y: v1.y, z: 0 }, // Flattened to Z=0
                    endPoint: { x: v2.x, y: v2.y, z: 0 }
                },
                color: color
            });
        }
        return entities;
    }

    clear() {
        this.items = [];
        this.saveToStorage();
        this.renderSidebar();
    }
}
