import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneViewer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a); // Dark background

        // Camera (Orthographic for CAD)
        const aspect = canvas.clientWidth / canvas.clientHeight;
        const frustumSize = 1000;
        this.camera = new THREE.OrthographicCamera(
            frustumSize * aspect / -2,
            frustumSize * aspect / 2,
            frustumSize / 2,
            frustumSize / -2,
            0.1,
            200000 // Large Far plane for CAD
        );
        this.camera.position.set(0, 0, 1000);
        this.camera.up.set(0, 1, 0); // Y-up

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            preserveDrawingBuffer: true // For screenshots
        });
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Controls
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableRotate = false; // Default to 2D view (Pan/Zoom only)
        this.controls.enableZoom = false; // Using custom wheel handler
        this.controls.enablePan = true;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE, // Disable Pan on Left. Rotate or None? Set to Rotate or generic to free it up? Actually if I want custom drag, I might need to prevent OrbitControls from consuming it.
            // Setting LEFT to null or undefined might not work well with OrbitControls types.
            // Let's set it to valid, but we will intercept events first?
            // Actually, best to set LEFT to THREE.MOUSE.ROTATE (Right click usually) or keep PAN on Middle.
            // Let's set LEFT: null if possible, or handling manually.
            // Common trick: Set LEFT to Rotate (which is disabled via enableRotate=false).
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN // Backup Pan?
        };
        // Ensure Rotate is disabled so Left Drag does nothing in OrbitControls
        this.controls.enableRotate = false;
        // this.controls.zoomSpeed = 1.2;

        // Custom Wheel Zoom
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

        // Resize Observer
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas.parentElement);

        // Group to hold DXF entities
        this.dxfGroup = new THREE.Group();
        this.scene.add(this.dxfGroup);

        // Selection / Helpers
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.animate();
    }

    resize() {
        if (!this.canvas || !this.canvas.parentElement) return;

        const width = this.canvas.parentElement.clientWidth;
        const height = this.canvas.parentElement.clientHeight;

        const aspect = width / height;
        const frustumSize = this.camera.top - this.camera.bottom; // Maintain current zoom level

        // Orthographic camera update
        this.camera.left = -frustumSize * aspect / 2;
        this.camera.right = frustumSize * aspect / 2;
        this.camera.top = frustumSize / 2;
        this.camera.bottom = -frustumSize / 2;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    getWorldPerPixel() {
        const h = this.renderer.domElement.clientHeight || this.renderer.domElement.height;
        // Ortho: ekranda görünen world yüksekliği = (top-bottom) / zoom
        return ((this.camera.top - this.camera.bottom) / this.camera.zoom) / h;
    }

    add(entity) {
        this.dxfGroup.add(entity);
    }

    setEntities(group) {
        // Clear existing
        this.clear();

        // Move children from input group to dxfGroup
        // Note: iterating backwards or while(length) because add() removes from parent
        while (group.children.length > 0) {
            const child = group.children[0];
            this.dxfGroup.add(child);
        }

        // Center view
        this.zoomExtents();
    }

    clear() {
        // Remove all children from DXF groups efficiently
        while (this.dxfGroup.children.length > 0) {
            const object = this.dxfGroup.children[0];
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach(m => m.dispose());
                } else {
                    object.material.dispose();
                }
            }
            this.dxfGroup.remove(object);
        }
    }

    addEntity(object) {
        if (object) {
            this.dxfGroup.add(object);
        }
    }

    zoomExtents(boundingBox) {
        if (!boundingBox) {
            // Calculate from group
            boundingBox = new THREE.Box3().setFromObject(this.dxfGroup);
        }

        if (boundingBox.isEmpty()) return;

        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);

        const maxSize = Math.max(size.x, size.y);
        const fitHeight = maxSize * 1.2; // 20% margin
        const aspect = this.renderer.domElement.clientWidth / this.renderer.domElement.clientHeight;

        this.camera.zoom = 1; // Reset zoom to calc frustum

        this.camera.left = -fitHeight * aspect / 2;
        this.camera.right = fitHeight * aspect / 2;
        this.camera.top = fitHeight / 2;
        this.camera.bottom = -fitHeight / 2;

        this.camera.position.set(center.x, center.y, 1000);
        this.controls.target.copy(center);

        this.camera.updateProjectionMatrix();
        this.controls.update();
    }

    setBackgroundColor(hex) {
        this.scene.background = new THREE.Color(hex);

        // Determine if background is dark or light
        const bgColor = new THREE.Color(hex);
        const luminance = 0.299 * bgColor.r + 0.587 * bgColor.g + 0.114 * bgColor.b;
        const isDarkBackground = luminance < 0.5;

        // Invert black/white colors for visibility
        this.dxfGroup.traverse((obj) => {
            if (!obj.material) return;

            // Skip if it's a cloned material for selection/hover
            if (obj.userData.isClonedMaterial) return;

            const currentColor = obj.material.color.getHex();

            // Check if color is black or white
            const isBlack = currentColor === 0x000000;
            const isWhite = currentColor === 0xffffff;

            if (isDarkBackground) {
                // Dark background: black → white
                if (isBlack) {
                    obj.material.color.setHex(0xffffff);
                    // Update originalColor so hover works correctly
                    obj.userData.originalColor = new THREE.Color(0xffffff);
                }
            } else {
                // Light background: white → black
                if (isWhite) {
                    obj.material.color.setHex(0x000000);
                    // Update originalColor so hover works correctly
                    obj.userData.originalColor = new THREE.Color(0x000000);
                }
            }
        });
    }

    /**
     * Raycast from camera to scene
     * @param {THREE.Vector2} pointer - Normalized coordinates (-1 to +1)
     * @returns {Array} Intersects
     */
    raycast(pointer) {
        this.raycaster.setFromCamera(pointer, this.camera);
        // Raycast against lines. Precision threshold in world units
        // Screen space threshold approx 10px
        const worldThreshold = 10 * this.getWorldPerPixel();
        this.raycaster.params.Line.threshold = worldThreshold;

        // Recursive = true to hit children of Groups (like Blocks or the main Loader group)
        return this.raycaster.intersectObjects(this.dxfGroup.children, true);
    }

    /**
     * Box Selection
     * @param {THREE.Vector2} startPoint - Screen space (-1 to 1)
     * @param {THREE.Vector2} endPoint - Screen space (-1 to 1)
     * @param {string} mode - 'window' (fully inside) or 'crossing' (intersects)
     */
    boxSelect(startPoint, endPoint, mode) {
        // Convert screen rect to frustum/world
        // For Ortho camera, we can convert points to World and perform Box-Box checks.

        const s = new THREE.Vector3(startPoint.x, startPoint.y, 0).unproject(this.camera);
        const e = new THREE.Vector3(endPoint.x, endPoint.y, 0).unproject(this.camera);

        const min = new THREE.Vector3(Math.min(s.x, e.x), Math.min(s.y, e.y), -Infinity);
        const max = new THREE.Vector3(Math.max(s.x, e.x), Math.max(s.y, e.y), Infinity);
        const selectionBox = new THREE.Box3(min, max);

        const selected = [];

        this.dxfGroup.traverse((obj) => {
            // Only select leaf objects with geometry (Meshes, Lines)
            if (obj.isMesh || obj.isLine || obj.isPoints) {
                // Compute object bounding box in world space
                // Note: geometry.boundingBox is local. Apply matrixWorld if needed.
                // Assuming static scene for simple check, but obj.updateMatrixWorld() might be needed if moved.

                if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
                const box = obj.geometry.boundingBox.clone();
                box.applyMatrix4(obj.matrixWorld);

                if (mode === 'window') {
                    // Fully Inside
                    if (selectionBox.containsBox(box)) {
                        selected.push(obj);
                    }
                } else {
                    // Crossing (Intersects)
                    if (selectionBox.intersectsBox(box)) {
                        selected.push(obj);
                    }
                }
            }
        });

        return selected;
    }

    /**
     * Highlight an object
     * @param {THREE.Object3D} object 
     * @param {boolean} highlight 
     */
    highlightObject(object, highlight) {

        if (!object) return;

        // Recursive Helper for Groups
        const applyHighlight = (obj, isHighlight) => {
            if (obj.isGroup) {
                obj.children.forEach(child => applyHighlight(child, isHighlight));
                return;
            }

            // Fix: Check if material exists before accessing it
            if (!obj.material) return;

            if (!obj.userData.originalColor) {
                obj.userData.originalColor = obj.material.color.clone();
            }

            if (isHighlight) {
                if (!obj.userData.isClonedMaterial) {
                    obj.material = obj.material.clone();
                    obj.userData.isClonedMaterial = true;
                }
                obj.material.color.setHex(0x00d9ff);
            } else {
                if (obj.userData.originalColor) {
                    obj.material.color.copy(obj.userData.originalColor);
                }
            }
        };

        applyHighlight(object, highlight);
    }

    setHover(object, state) {
        if (!object) return;

        const applyHover = (obj, isHover) => {
            if (obj.isGroup) {
                obj.children.forEach(child => applyHover(child, isHover));
                return;
            }
            if (!obj.material) return;

            // Don't override Selection (Cyan)
            if (obj.material.color.getHex() === 0x00d9ff) return;

            if (!obj.userData.originalColor) {
                obj.userData.originalColor = obj.material.color.clone();
            }

            if (isHover) {
                if (!obj.userData.isClonedMaterial) {
                    obj.material = obj.material.clone();
                    obj.userData.isClonedMaterial = true;
                }
                // Update: Hover color to Green (0x32a852)
                obj.material.color.setHex(0x32a852);

                // Update: Thicken line by 1.25x
                if (obj.isLine) {
                    if (obj.userData.originalLineWidth === undefined) {
                        obj.userData.originalLineWidth = obj.material.linewidth || 1;
                    }
                    obj.material.linewidth = obj.userData.originalLineWidth * 1.25;
                }

            } else {
                if (obj.userData.originalColor) {
                    obj.material.color.copy(obj.userData.originalColor);
                }
                // Restore linewidth
                if (obj.userData.originalLineWidth !== undefined) {
                    obj.material.linewidth = obj.userData.originalLineWidth;
                }
            }
        };

        applyHover(object, state);
    }

    /**
     * Custom Wheel Handler for Zoom-to-Cursor
     */
    handleWheel(event) {
        event.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // 1. Get world point under cursor BEFORE zoom
        const pointer = new THREE.Vector3(x, y, 0);
        pointer.unproject(this.camera);
        // Ortho camera unproject gives a point on the near plane?
        // Actually for Ortho, unprojection direction depends on Z. 
        // We want the point on the Z=0 plane (or simply the world X/Y matching the cursor).
        // Since camera is looking at Z=0 (usually), we can just take x,y from unprojectResult.
        // BUT, unproject relies on camera position/zoom.
        const worldBefore = pointer.clone();
        worldBefore.z = 0; // Assume 2D plane for pivot

        // 2. Apply Zoom
        const zoomScale = 0.96; // 2% Zoom factor (doubled speed)
        if (event.deltaY < 0) {
            this.camera.zoom /= zoomScale; // Zoom In
        } else {
            this.camera.zoom *= zoomScale; // Zoom Out
        }
        this.camera.updateProjectionMatrix();

        // 3. Get world point under same cursor AFTER zoom
        const pointerAfter = new THREE.Vector3(x, y, 0);
        pointerAfter.unproject(this.camera);
        const worldAfter = pointerAfter.clone();
        worldAfter.z = 0;

        // 4. Pan camera to align After to Before
        // shift = worldBefore - worldAfter
        const shift = new THREE.Vector3().subVectors(worldBefore, worldAfter);

        this.camera.position.add(shift);
        this.controls.target.add(shift);
        this.controls.update();

        // Trigger render
        // (Handled by animate loop)
    }
}
