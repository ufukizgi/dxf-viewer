import * as THREE from 'three';
import { DxfLoader } from '../dxf-loader.js';
import { OCCTLoader } from './OCCTLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class LoaderManager {
    constructor() {
        this.dxfLoader = new DxfLoader();
        this.occtLoader = new OCCTLoader();
        this.stlLoader = new STLLoader();
        this.objLoader = new OBJLoader();
        this.gltfLoader = new GLTFLoader();
    }

    async load(file) {
        const extension = file.name.split('.').pop().toLowerCase();

        switch (extension) {
            case 'dxf':
                return this.loadDXF(file);
            case 'dwg':
                throw new Error("Client-side DWG not supported yet (requires API)");
            case 'pdf':
                // PDF handling logic is currently in main.js, probably keep it there or move here later
                throw new Error("PDF should be handled before LoaderManager");
            case 'stp':
            case 'step':
            case 'iges':
            case 'igs':
                return this.loadCAD(file, extension);
            case 'stl':
                return this.loadSTL(file);
            case 'obj':
                return this.loadOBJ(file);
            case 'gltf':
            case 'glb':
                return this.loadGLTF(file);
            default:
                throw new Error(`Unsupported file extension: .${extension}`);
        }
    }

    async loadDXF(file) {
        // Return structured object
        const userData = await this.dxfLoader.load(file);
        const group = this.dxfLoader.generateThreeEntities(userData);
        return {
            type: 'dxf',
            group: group,
            data: userData // Original DXF data
        };
    }

    async loadCAD(file, extension) {
        // OCCT Loader logic needs to know if it is doing STEP or IGES inside
        // We'll update OCCTLoader to handle file extension if needed, or pass it here
        // Current OCCTLoader implementation writes file by name, so extension is preserved.
        const group = await this.occtLoader.load(file);

        // Rotate -90 on X usually for CAD to ThreeJS logic? 
        // Three.js Y is up, CAD Z is up often.
        group.rotation.x = -Math.PI / 2;
        group.updateMatrixWorld();

        return {
            type: 'model',
            group: group,
            format: extension
        };
    }

    async loadSTL(file) {
        const buffer = await file.arrayBuffer();
        const geometry = this.stlLoader.parse(buffer);
        const material = new THREE.MeshStandardMaterial({ color: 0xcccccc });
        const mesh = new THREE.Mesh(geometry, material);

        // Rotation might be needed
        mesh.rotation.x = -Math.PI / 2;

        const group = new THREE.Group();
        group.add(mesh);

        return {
            type: 'model',
            group: group,
            format: 'stl'
        };
    }

    async loadOBJ(file) {
        const text = await file.text();
        const group = this.objLoader.parse(text);
        // group.rotation.x = -Math.PI / 2; // OBJ orientation varies
        return {
            type: 'model',
            group: group,
            format: 'obj'
        };
    }

    async loadGLTF(file) {
        const buffer = await file.arrayBuffer();
        return new Promise((resolve, reject) => {
            this.gltfLoader.parse(buffer, '', (gltf) => {
                resolve({
                    type: 'model',
                    group: gltf.scene,
                    format: 'gltf'
                });
            }, reject);
        });
    }
}
