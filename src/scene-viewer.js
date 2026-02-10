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
        this.renderer.localClippingEnabled = true;
        this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        // Controls
        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableRotate = true; // Use right click to rotate
        this.controls.enableZoom = false; // Using custom wheel handler
        this.controls.enablePan = true;
        this.controls.mouseButtons = {
            LEFT: THREE.MOUSE.PAN,      // Left Pan (standard 2D/CAD usually Pan) or Select?
            MIDDLE: THREE.MOUSE.DOLLY,  // Zoom
            RIGHT: THREE.MOUSE.ROTATE   // Right Rotate
        };
        // Override for standard CAD feel:
        // Left: Select (Raycast handled by event listener, Orbit doesn't block unless dragging)
        // Middle: Pan
        // Right: Rotate

        // Let's implement User Request: "Rotate mouse wheel + right click"
        // This is tricky. usually implies simultaneous.
        // Or maybe they mean "Mouse Wheel" (Middle) AND "Right Click" separately?
        // "Rotate mouse wheel + right click" -> maybe Middle OR Right?

        this.controls.mouseButtons = {
            LEFT: null, // Left click/drag handled by custom listeners (Selection)
            MIDDLE: THREE.MOUSE.PAN, // Middle Pan
            RIGHT: null // Right Click Disabled
        };

        // Dynamic Middle Mouse Button Mode (Shift+Middle = Rotate)
        // Using capture to ensure we update config before OrbitControls handles the event
        window.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // Middle Button
                if (e.shiftKey) {
                    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
                } else {
                    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
                }
            }
        }, true);

        // We initially disable rotate for 2D feel, but will enable it if 3D content loaded?
        // Or just leave it enabled. 
        // For DXF (2D), rotation is annoying. 
        this.controls.enableRotate = true;
        this.controls.listenToKeyEvents(window); // Enable standard keys if needed

        // Adjust defaults
        this.controls.screenSpacePanning = true;

        // this.controls.zoomSpeed = 1.2;

        // Custom Wheel Zoom
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });

        // Resize Observer
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas.parentElement);

        // Group to hold DXF entities
        this.dxfGroup = new THREE.Group();
        this.scene.add(this.dxfGroup);

        // Lighting
        // Use a "Headlamp" approach so the model is always lit from the front
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambientLight);

        const headLight = new THREE.DirectionalLight(0xffffff, 0.8);
        headLight.position.set(0, 0, 1); // Relative to camera
        this.camera.add(headLight); // Add light to camera
        this.scene.add(this.camera); // Add camera to scene (required for child lights)

        // Additional fixed light for depth
        const topLight = new THREE.DirectionalLight(0xffffff, 0.3);
        topLight.position.set(100, 500, 100);
        this.scene.add(topLight);

        // Prevent Context Menu on canvas for OrbitControls Right Click
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

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

    setEntities(group, type = 'dxf') {
        this._lastLoadedType = type;

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
        // Reset Clipping
        this.renderer.clippingPlanes = [];
        if (this.sectionHelper) {
            this.scene.remove(this.sectionHelper);
            this.sectionHelper = null;
        }

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

        // Camera Position and Orientation
        // User Request: 
        // 1. 2D should be Standard Top View (No Iso)
        // 2. 3D should be Isometric "Top Right" (Upper Right)

        let is3D = false;
        if (this._lastLoadedType === 'model') {
            is3D = true;
        }
        // Force 2D (Top View) for DXF files regardless of Z values
        // This prevents isometric view on "2.5D" drawings or drawings with noisy Z data
        else {
            is3D = false;
        }

        const dist = 1000;

        if (is3D) {
            // Isometric Top-Right: Look from positive X, Y, Z towards Center
            // Z is typically up in CAD, but usually file coords are arbitrary.
            // If we assume Y-up (Three.js default world), then Isometric is usually (1, 1, 1) or (1, -1, 1).
            // User said "Upper Right" (Top Right).
            // Let's try (1, 1, 1).

            const isoDir = new THREE.Vector3(1, 1, 1).normalize();
            this.camera.position.copy(center).add(isoDir.multiplyScalar(dist * 2)); // Zoom out (Double distance)
            this.camera.lookAt(center);
        } else {
            // 2D Standard Top View (Z-up typically means viewing from +Z?)
            // If viewer is Y-up, Top View is viewing from +Y?
            // Existing code was (0,0,1000) which is +Z.
            // Let's stick to standard +Z view for 2D.
            this.camera.position.set(center.x, center.y, dist);
            this.camera.lookAt(center.x, center.y, 0);
            this.camera.rotation.set(0, 0, 0);
        }

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
        // Screen space threshold approx 6px
        const worldThreshold = 6 * this.getWorldPerPixel();
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
