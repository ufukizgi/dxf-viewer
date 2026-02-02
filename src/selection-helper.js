import * as THREE from 'three';

export class SelectionHelper {
    constructor() {
        this.cache = new Map(); // Cache adjacency info per geometry UUID
    }

    /**
     * Selects a connected region of faces based on normal similarity.
     * @param {THREE.Mesh} mesh - The mesh object.
     * @param {number} faceIndex - The starting face index (triangle index).
     * @param {number} thresholdAngle - Degrees of deviation allowed (default 5).
     * @returns {number[]} Array of face indices (triangle indices).
     */
    selectConnectedFaces(mesh, faceIndex, thresholdAngle = 5.0) {
        if (!mesh || !mesh.geometry || faceIndex === undefined) return [];

        const geometry = mesh.geometry;
        if (!geometry.index) return [faceIndex]; // Non-indexed geometry not supported easily yet

        // Lazy computation of adjacency
        const adjacency = this.getAdjacency(geometry);
        const normals = this.getFaceNormals(geometry);

        const visited = new Set();
        const queue = [faceIndex];
        const selected = [];
        const threshold = Math.cos(thresholdAngle * Math.PI / 180);

        visited.add(faceIndex);
        selected.push(faceIndex);

        const startNormal = normals[faceIndex];

        // Optimization: Use separate queue for processing to avoid recursion limits
        while (queue.length > 0) {
            const current = queue.pop();
            const currentNormal = normals[current];

            const neighbors = adjacency[current];
            if (!neighbors) continue;

            for (const neighbor of neighbors) {
                if (visited.has(neighbor)) continue;

                // Check angle
                const neighborNormal = normals[neighbor];
                const dot = currentNormal.dot(neighborNormal);

                if (dot >= threshold) {
                    visited.add(neighbor);
                    selected.push(neighbor);
                    queue.push(neighbor); // Propagate
                }
            }
        }

        return selected;
    }

    getAdjacency(geometry) {
        if (this.cache.has(geometry.uuid)) {
            return this.cache.get(geometry.uuid).adjacency;
        }

        const index = geometry.index.array;
        const vertexToFaces = {}; // Map vertex ID -> List of Face IDs
        const adjacency = {}; // Map Face ID -> List of Neighbor Face IDs

        // 1. Map Vertices to Faces
        const faceCount = index.length / 3;
        for (let f = 0; f < faceCount; f++) {
            const a = index[f * 3];
            const b = index[f * 3 + 1];
            const c = index[f * 3 + 2];

            if (!vertexToFaces[a]) vertexToFaces[a] = [];
            if (!vertexToFaces[b]) vertexToFaces[b] = [];
            if (!vertexToFaces[c]) vertexToFaces[c] = [];

            vertexToFaces[a].push(f);
            vertexToFaces[b].push(f);
            vertexToFaces[c].push(f);
        }

        // 2. Build Adjacency (Faces sharing 2 vertices)
        for (let f = 0; f < faceCount; f++) {
            adjacency[f] = [];
            const a = index[f * 3];
            const b = index[f * 3 + 1];
            const c = index[f * 3 + 2];

            const candidates = new Set([
                ...vertexToFaces[a],
                ...vertexToFaces[b],
                ...vertexToFaces[c]
            ]);

            for (const other of candidates) {
                if (other === f) continue;

                // Check for shared edge (2 shared vertices)
                const oa = index[other * 3];
                const ob = index[other * 3 + 1];
                const oc = index[other * 3 + 2];

                let shared = 0;
                if (oa === a || oa === b || oa === c) shared++;
                if (ob === a || ob === b || ob === c) shared++;
                if (oc === a || oc === b || oc === c) shared++;

                if (shared >= 2) {
                    adjacency[f].push(other);
                }
            }
        }

        // Cache it. Also cache Normals?
        const info = { adjacency, timestamp: Date.now() };
        this.cache.set(geometry.uuid, info);
        return adjacency;
    }

    getFaceNormals(geometry) {
        if (this.cache.has(geometry.uuid) && this.cache.get(geometry.uuid).normals) {
            return this.cache.get(geometry.uuid).normals;
        }

        const index = geometry.index.array;
        const pos = geometry.attributes.position;
        const faceCount = index.length / 3;
        const normals = new Array(faceCount);

        const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
        const cb = new THREE.Vector3(), ab = new THREE.Vector3();

        for (let f = 0; f < faceCount; f++) {
            const a = index[f * 3];
            const b = index[f * 3 + 1];
            const c = index[f * 3 + 2];

            pA.fromBufferAttribute(pos, a);
            pB.fromBufferAttribute(pos, b);
            pC.fromBufferAttribute(pos, c);

            // Cross product
            cb.subVectors(pC, pB);
            ab.subVectors(pA, pB);
            cb.cross(ab);
            cb.normalize();

            normals[f] = cb.clone();
        }

        if (this.cache.has(geometry.uuid)) {
            this.cache.get(geometry.uuid).normals = normals;
        } else {
            this.cache.set(geometry.uuid, { normals });
        }

        return normals;
    }
}
