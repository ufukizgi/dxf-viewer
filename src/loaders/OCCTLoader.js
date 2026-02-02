import * as THREE from 'three';

export class OCCTLoader {
    constructor() {
        this.occt = null;
        this.initPromise = this.init();
    }

    async init() {
        if (this.occt) return this.occt;

        try {
            // Global defined by the script tag
            if (typeof occtimportjs === 'undefined') {
                throw new Error("occtimportjs global not found. Script not loaded?");
            }

            this.occt = await occtimportjs({
                locateFile: (name) => {
                    if (name.endsWith('.wasm')) {
                        return 'https://unpkg.com/occt-import-js@0.0.23/dist/occt-import-js.wasm';
                    }
                    return name;
                }
            });
            return this.occt;
        } catch (e) {
            console.error("Failed to initialize OCCT:", e);
            throw e;
        }
    }

    async load(file) {
        await this.initPromise;
        const buffer = await file.arrayBuffer();

        // Check for direct buffer reading (some versions support this)
        let result = null;
        if (this.occt.ReadStepFile) {
            // Try passing buffer directly if possible, or fallback to file system
            try {
                result = this.occt.ReadStepFile(new Uint8Array(buffer), null);
            } catch (e) {
                console.log("Direct ReadStepFile failed, trying FS approach", e);
            }
        }

        if (!result) {
            // Virtual File System Approach
            const fileName = file.name;

            // FS is usually under the module instance
            if (this.occt.FS) {
                this.occt.FS.createDataFile('/', fileName, new Uint8Array(buffer), true, true, true);

                if (this.occt.ReadStepFile) {
                    result = this.occt.ReadStepFile(fileName, null);
                } else if (this.occt.readStepFile) {
                    result = this.occt.readStepFile(fileName);
                }

                // Cleanup?
                // this.occt.FS.unlink(fileName); 
            } else {
                // Some builds expose a top-level writeFile/readFile?
                // But usually FS is correct.
                console.error("OCCT: No FS found on module instance", this.occt);
                throw new Error("OCCT File System not available");
            }
        }

        if (!result) {
            throw new Error("Failed to read STEP file (result is null)");
        }

        // Convert to Three.js
        const group = new THREE.Group();

        for (const mesh of result.meshes) {
            // Aluminum-like Material - Shared for all parts of this mesh
            let color = 0xcccccc;
            if (mesh.color) {
                color = new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]);
            } else {
                // Default Aluminum Color
                color = new THREE.Color(0xd6d6d6);
            }

            const material = new THREE.MeshStandardMaterial({
                color: color,
                side: THREE.DoubleSide,
                metalness: 0.6,
                roughness: 0.4,
                envMapIntensity: 1.0
            });

            // If brep_faces exists, we should create separate meshes for each face to allow selection
            if (mesh.brep_faces && mesh.brep_faces.length > 0) {
                console.log(`Mesh has ${mesh.brep_faces.length} BREP faces. Splitting...`);
                // ... same logic ...

                // Original Attributes
                const posAttr = mesh.attributes.position ? new Float32Array(mesh.attributes.position.array) : null;
                const normAttr = mesh.attributes.normal ? new Float32Array(mesh.attributes.normal.array) : null;
                // Index is required for splitting by triangle range
                const fullIndex = mesh.index ? new Uint32Array(mesh.index.array) : null;

                if (!fullIndex || !posAttr) {
                    console.warn("Cannot split mesh without index or position.");
                    // Fallback to single mesh
                    const geometry = new THREE.BufferGeometry();
                    if (posAttr) geometry.setAttribute('position', new THREE.BufferAttribute(posAttr, 3));
                    if (normAttr) geometry.setAttribute('normal', new THREE.BufferAttribute(normAttr, 3));
                    if (fullIndex) geometry.setIndex(new THREE.BufferAttribute(fullIndex, 1));

                    // ... create mesh ...
                    const threeMesh = new THREE.Mesh(geometry, material.clone());
                    threeMesh.userData = { type: 'FACE', originalColor: color, faceId: mesh.face_index };
                    group.add(threeMesh);
                    continue;
                }

                mesh.brep_faces.forEach((face, fIdx) => {
                    // face.first and face.last are TRIANGLE indices.
                    // We need to convert them to Index Buffer indices (* 3).
                    const start = face.first * 3;
                    const end = (face.last + 1) * 3;

                    // Extracted Geometry
                    const faceGeo = new THREE.BufferGeometry();
                    const subIndex = fullIndex.slice(start, end);

                    faceGeo.setAttribute('position', new THREE.BufferAttribute(posAttr, 3));
                    if (normAttr) faceGeo.setAttribute('normal', new THREE.BufferAttribute(normAttr, 3));
                    faceGeo.setIndex(new THREE.BufferAttribute(subIndex, 1));

                    const faceMesh = new THREE.Mesh(faceGeo, material.clone());
                    faceMesh.userData = {
                        type: 'FACE',
                        originalColor: color, // Clone color to allow individual highlight
                        faceId: fIdx // Local index in this mesh
                    };
                    group.add(faceMesh);
                });

            } else {
                console.warn(`Mesh ${mesh.face_index || 'unknown'} has NO brep_faces. Cannot split.`);
                // Standard Single Mesh
                const geometry = new THREE.BufferGeometry();
                // ... (Existing Logic)
                if (mesh.attributes.position) {
                    const pos = new Float32Array(mesh.attributes.position.array);
                    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
                }
                if (mesh.attributes.normal) {
                    const norm = new Float32Array(mesh.attributes.normal.array);
                    geometry.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
                }
                if (mesh.index) {
                    const idx = new Uint32Array(mesh.index.array);
                    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
                }

                const threeMesh = new THREE.Mesh(geometry, material);
                threeMesh.userData = {
                    type: 'FACE',
                    originalColor: color,
                    faceId: mesh.face_index
                };
                group.add(threeMesh);
            }
        }

        console.log(`OCCT: Loaded ${result.meshes.length} faces.`);
        // Note: We can't easily access app.updateStatus here without passing it down.
        // But main.js can read group.children.length


        return group;
    }
}
