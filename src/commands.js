import * as THREE from 'three';

export class CmdAddMeasurement {
    constructor(manager, data) {
        this.manager = manager;
        this.data = data;
    }
    execute() {
        this.manager.restoreMeasurement(this.data);
    }
    undo() {
        this.manager.removeMeasurement(this.data.visual);
    }
}

export class CmdDelete {
    constructor(viewer, measurementManager, selection, onComplete) {
        this.viewer = viewer;
        this.mgr = measurementManager;
        this.selection = [...selection]; // Copy selection array
        this.hiddenEntities = [];
        this.removedMeasurements = [];
        this.onComplete = onComplete; // Callback to clear Global Selection
    }

    execute() {
        this.hiddenEntities = [];
        this.removedMeasurements = [];

        this.selection.forEach(obj => {
            // Un-highlight first to ensure clean state on Undo
            if (this.viewer) this.viewer.highlightObject(obj, false);

            // Check if Measurement
            const removed = this.mgr.removeMeasurement(obj);
            if (removed) {
                this.removedMeasurements.push(removed);
            } else {
                // Assume DXF Entity
                obj.visible = false;
                this.hiddenEntities.push(obj);
            }
        });

        if (this.onComplete) this.onComplete();
    }

    undo() {
        // Restore Entities
        this.hiddenEntities.forEach(obj => {
            obj.visible = true;
        });

        // Restore Measurements
        this.removedMeasurements.forEach(data => {
            this.mgr.restoreMeasurement(data);
        });
    }
}

export class CmdScale {
    constructor(viewer, objects, center, factor) {
        this.viewer = viewer;
        this.objects = objects;
        this.center = center.clone();
        this.factor = factor;

        // Store original state for Undo
        this.previousStates = objects.map(obj => {
            return {
                obj: obj,
                position: obj.position.clone(),
                quaternion: obj.quaternion.clone(),
                scale: obj.scale.clone(),
                matrixWorld: obj.matrixWorld.clone(), // Helper
                appliedTransform: null // Will be set on execute
            };
        });
    }

    execute() {
        const S = new THREE.Matrix4();
        // Translate to Origin -> Scale -> Translate Back
        S.makeTranslation(this.center.x, this.center.y, this.center.z);
        S.scale(new THREE.Vector3(this.factor, this.factor, 1));
        S.multiply(new THREE.Matrix4().makeTranslation(-this.center.x, -this.center.y, -this.center.z));

        this.objects.forEach((obj, index) => {
            obj.updateMatrixWorld(true);
            const O = obj.matrixWorld.clone();

            // Total Transform T = S * O
            // We want vertices v_new = S * (O * v_old)
            // So we apply T to geometry vertices
            const T = S.clone().multiply(O);

            obj.geometry.applyMatrix4(T);

            // Reset Object Transform to Identity so visual matches geometry
            obj.position.set(0, 0, 0);
            obj.quaternion.set(0, 0, 0, 1);
            obj.scale.set(1, 1, 1);

            obj.updateMatrix();
            obj.updateMatrixWorld(true);

            // Recompute line distances for dashed lines
            if (obj.geometry.attributes.lineDistance) {
                obj.computeLineDistances();
            }

            // UPDATE METADATA (Bake Scale)
            if (obj.userData && obj.userData.entity) {
                obj.userData.originalEntity = JSON.parse(JSON.stringify(obj.userData.entity)); // Deep copy backup
                const ent = obj.userData.entity;

                // Helper to transform point
                const transformPoint = (p) => {
                    const vec = new THREE.Vector3(p.x, p.y, p.z || 0);
                    vec.applyMatrix4(S);
                    p.x = vec.x;
                    p.y = vec.y;
                    if (p.z !== undefined) p.z = vec.z;
                };

                // Type specific updates
                switch (ent.type) {
                    case 'LINE':
                        if (ent.startPoint) transformPoint(ent.startPoint);
                        if (ent.endPoint) transformPoint(ent.endPoint);
                        // Also update vertices array if present (some parsers)
                        if (ent.vertices) ent.vertices.forEach(v => transformPoint(v));
                        break;
                    case 'CIRCLE':
                    case 'ARC':
                        if (ent.center) transformPoint(ent.center);
                        if (ent.radius) ent.radius *= this.factor;
                        // angles don't change on uniform scale
                        break;
                    case 'LWPOLYLINE':
                    case 'POLYLINE':
                        if (ent.vertices) {
                            ent.vertices.forEach(v => {
                                transformPoint(v);
                                // Bulge remains same for uniform scale
                            });
                        }
                        break;
                    case 'ELLIPSE':
                        if (ent.center) transformPoint(ent.center);
                        if (ent.majorAxisEndPoint) {
                            // majorAxisEndPoint is a vector relative to center.
                            // Apply scale factor only (direction remains same if uniform scale + no rotation)
                            // Since we bake rotation/scale into geometry, and reset obj.scale/rotation, 
                            // we must update this vector to match the visual geometry.
                            // The visual geometry is scaled by factor. 
                            // So the vector length should scale by factor.
                            ent.majorAxisEndPoint.x *= this.factor;
                            ent.majorAxisEndPoint.y *= this.factor;
                            ent.majorAxisEndPoint.z *= this.factor;
                        }
                        break;
                    case 'INSERT':
                        if (ent.position) transformPoint(ent.position);
                        if (ent.scale) {
                            ent.scale.x *= this.factor;
                            ent.scale.y *= this.factor;
                            ent.scale.z *= this.factor;
                        }
                        break;
                }
            }

            // Store T for Undo
            this.previousStates[index].appliedTransform = T;
        });
    }

    undo() {
        this.previousStates.forEach(state => {
            // Restore geometry: v_old = T_inv * v_new
            if (state.appliedTransform) {
                const T_inv = state.appliedTransform.clone().invert();
                state.obj.geometry.applyMatrix4(T_inv);
            }

            // Restore Object Transform
            state.obj.position.copy(state.position);
            state.obj.quaternion.copy(state.quaternion);
            state.obj.scale.copy(state.scale);

            state.obj.updateMatrix();
            state.obj.updateMatrixWorld(true);

            if (state.obj.geometry.attributes.lineDistance) {
                state.obj.computeLineDistances();
            }

            // Restore Metadata
            if (state.obj.userData && state.obj.userData.originalEntity) {
                state.obj.userData.entity = state.obj.userData.originalEntity;
                delete state.obj.userData.originalEntity;
            }
        });
    }
}
