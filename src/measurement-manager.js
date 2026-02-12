
import * as THREE from 'three';
console.log('[MeasurementManager] File Loaded: Version TESTING');

export class MeasurementManager {
    constructor(viewer, snappingManager, onStatusUpdate, onMeasurementAdded) {
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.snappingManager = snappingManager;
        this.onStatusUpdate = onStatusUpdate || (() => { });
        this.onMeasurementAdded = onMeasurementAdded || null;

        this.activeTool = null; // 'distance', 'angle', 'area', etc.
        this.points = [];
        this.tempMeasurement = null;
        this.measurements = []; // Persistent measurements

        // Group for all measurement visuals
        this.group = new THREE.Group();
        this.scene.add(this.group);

        // Materials
        this.lineMaterial = new THREE.LineBasicMaterial({ color: 0x32a852, depthTest: false }); // Green
        this.previewMaterial = new THREE.LineDashedMaterial({ color: 0x32a852, dashSize: 5, gapSize: 3, depthTest: false });

        // Highlight Material for Selection
        this.highlightMaterial = new THREE.LineBasicMaterial({ color: 0xFFD700, depthTest: false }); // Gold
    }

    removeMeasurement(visual) {
        const index = this.measurements.findIndex(m => m.visual === visual);
        if (index > -1) {
            const m = this.measurements[index];
            this.measurements.splice(index, 1);
            this.group.remove(visual);
            return m; // Return data for Undo
        }
        return null;
    }

    restoreMeasurement(data) {
        if (!data) return;
        this.measurements.push(data);
        this.group.add(data.visual);
    }

    activateTool(tool) {
        this.activeTool = tool;
        this.points = [];
        this.clearTemp();
        this.activeScale = 1.0; // Reset scale
        if (this.snappingManager && this.snappingManager.clearSticky) this.snappingManager.clearSticky();
        console.log(`Measurement Tool Activated: ${tool}`);

        // Initial status message
        if (tool === 'radius' || tool === 'diameter') {
            this.onStatusUpdate(`Selected ${tool}. Step 1: Click on an Arc or Circle.`);
        } else if (tool === 'distance') {
            this.onStatusUpdate(`Selected Distance. Step 1: Click start point.`);
        } else if (tool === 'angle') {
            this.onStatusUpdate(`Selected Angle. Step 1: Click center point.`);
        }
    }

    highlightMeasurement(visual, highlight) {
        if (!visual) return;
        visual.children.forEach(c => {
            if (c.userData.originalColor === undefined) c.userData.originalColor = c.material.color.getHex();

            // Toggle material or color
            if (highlight) {
                c.material = this.highlightMaterial;
            } else {
                // Restore logic - simplified for now, assuming basic lines
                if (visual.userData.isPreview) {
                    c.material = this.previewMaterial;
                } else {
                    // We need to restore the correct material (Line or Dashed or Arrow)
                    // This is a bit hacky. Better to just change color?
                    // But materials are shared. Clone material?
                    // Let's use the method of swapping material to a highlight one.
                    // For restoration, we need original material.
                    if (c.userData.originalMaterial) {
                        c.material = c.userData.originalMaterial;
                    } else {
                        // First time, save it
                        // But we just overwrote it in line 48 if checking highlight first?
                        // Wait, loop runs line 46 first.
                    }
                }
            }
        });

        // Better approach: Cloning/Swapping
        visual.traverse((child) => {
            if (child.isLine || child.isMesh) { // Mesh for Arrows
                if (highlight) {
                    if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
                    child.material = this.highlightMaterial;
                } else {
                    if (child.userData.originalMaterial) {
                        child.material = child.userData.originalMaterial;
                    }
                }
            }
        });
    }

    deactivateTool() {
        this.activeTool = null;
        this.points = [];
        this.clearTemp();
        this.activeScale = 1.0; // Reset scale
        if (this.snappingManager && this.snappingManager.clearSticky) this.snappingManager.clearSticky();
        this.onStatusUpdate('Ready');

        // Reset UI via main app callback if available, or try to access it
        if (this.viewer && this.viewer.app && this.viewer.app.updateMeasureUI) {
            this.viewer.app.updateMeasureUI(null);
        } else {
            // Fallback if accessed differently (e.g. if viewer.app isn't set, might need to pass callback)
            // But usually accessible via window or passed context. 
            // In this codebase, MeasurementManager is instantiated by App or Main. 
            // Let's assume Main.js has a reference or we can dispatch an event.
            // Actually, I can just do what I did on line 40 but targeting the new button.
            const mainBtn = document.getElementById('measure-menu-btn');
            if (mainBtn) mainBtn.classList.remove('active', 'bg-blue-600');
        }
    }

    cancel() {
        // Cancel current measurement but keep tool active
        this.points = [];
        this.clearTemp();
        this.activeScale = 1.0;
        if (this.snappingManager && this.snappingManager.clearSticky) this.snappingManager.clearSticky();
        if (this.activeTool) {
            // Re-prompt for first step
            this.activateTool(this.activeTool);
        } else {
            this.onStatusUpdate('Ready');
        }
    }

    getMeasurementState() {
        // Export state for Tab Switching
        // We keep the visual objects in memory attached to the state array
        // We just need to detach them from the scene group
        // But since we clear the group on restore, we don't need to explicitly detach here if we are about to switch.
        // The caller will call restoreMeasurementState([]) on the active manager (clearing it) 
        // OR the manager is shared. 
        // In this app, MeasurementManager is SHARED. 
        // So we clear group.
        return [...this.measurements];
    }

    restoreMeasurementState(state) {
        // Clear current active measurements from scene
        while (this.group.children.length > 0) {
            this.group.remove(this.group.children[0]);
        }
        this.measurements = [];
        this.activeTool = null;
        this.points = [];
        this.clearTemp();

        // Load new state
        if (state && Array.isArray(state)) {
            state.forEach(m => {
                this.measurements.push(m);
                if (m.visual) this.group.add(m.visual);
            });
        }
    }

    handleMouseMove(pointerNDC, rayOrigin, rayDir) {
        // Handled by updatePreview called explicitly from main
    }

    handleClick(point, intersectOrObject) {
        if (!this.activeTool) return;

        // Extract Object and Index (if available)
        let hitObject = intersectOrObject;
        let hitIndex = null;
        if (intersectOrObject && intersectOrObject.object) {
            hitObject = intersectOrObject.object;
            hitIndex = intersectOrObject.index;
        }

        // Radius & Diameter Tools (New 3-Step)
        if (this.activeTool === 'radius' || this.activeTool === 'diameter') {
            if (this.points.length === 0) {
                if (hitObject && hitObject.userData) {
                    const type = hitObject.userData.type;
                    if (type === 'CIRCLE' || type === 'ARC') {
                        const entity = hitObject.userData.entity || hitObject.userData;

                        // Detect Scale
                        let scale = 1.0;
                        if (hitObject.userData.placementScale) scale = hitObject.userData.placementScale;
                        else if (hitObject.userData.templateScale) scale = hitObject.userData.templateScale;
                        else if (hitObject.parent && hitObject.parent.userData.placementScale) scale = hitObject.parent.userData.placementScale;
                        else if (hitObject.scale && hitObject.scale.x !== 1) scale = hitObject.scale.x;

                        const center = new THREE.Vector3(entity.center.x, entity.center.y, 0);
                        // Apply World Matrix to correctly locate the center in World Coordinate Space
                        center.applyMatrix4(hitObject.matrixWorld);

                        this.currentRadiusEntity = {
                            center: center,
                            radius: entity.radius * scale,
                            type: type
                        };
                        this.points.push(center); // P0
                        console.log(`[Measurement] Selected ${type}. Click to place Arrow.`);
                        this.onStatusUpdate(`Step 2: Move mouse to position Arrow, then Click.`);
                    }
                }
            }
            else if (this.points.length === 1) {
                const center = this.currentRadiusEntity.center;
                const radius = this.currentRadiusEntity.radius;
                const v = new THREE.Vector3().subVectors(point, center).normalize();
                if (v.lengthSq() === 0) v.set(1, 0, 0);
                const arrowPoint = center.clone().add(v.multiplyScalar(radius));
                this.points.push(arrowPoint); // P1
                this.onStatusUpdate(`Step 3: Move mouse to position Text, then Click to finish.`);
            }
            else if (this.points.length === 2) {
                const textPoint = point; // P2
                this.points.push(textPoint);

                const center = this.currentRadiusEntity.center;
                const radius = this.currentRadiusEntity.radius;
                const arrowPoint = this.points[1];

                const visual = this.createSmartRadiusVisual(center, radius, arrowPoint, textPoint, this.activeTool, this.activeScale);
                const scale = this.activeScale || 1;
                const val = (this.activeTool === 'radius') ? radius : radius * 2;
                const valScaled = val / scale;

                const mData = {
                    type: this.activeTool,
                    value: valScaled.toFixed(3),
                    visual: visual
                };

                if (this.onMeasurementAdded) {
                    this.onMeasurementAdded(mData);
                } else {
                    this.measurements.push(mData);
                    this.group.add(visual);
                }

                this.points = [];
                this.currentRadiusEntity = null;
                this.clearTemp();
                console.log(`[Measurement] Finished ${this.activeTool}.`);
                this.onStatusUpdate(`Finished ${this.activeTool}. Ready for next.`);
                // Reset to step 1 automatically? Or stay active.
                // activateTool resets points.
                // We keep tool active.
                this.activeTool = this.activeTool; // no-op but consistent
                this.onStatusUpdate(`Selected ${this.activeTool}. Step 1: Click on an Arc or Circle.`);
            }
            return;
        }

        if (this.activeTool === 'distance') {
            const now = Date.now();

            if (this.lastClickTime && (now - this.lastClickTime < 300)) {
                return;
            }

            if (this.points.length === 0) {
                // Step 1: Start Point
                this.points.push(point);
                this.activeScale = 1.0;
                let targetObj = hitObject;
                if (!targetObj && this.snappingManager && this.snappingManager.activeSnap) {
                    targetObj = this.snappingManager.activeSnap.object;
                }

                if (targetObj && targetObj.userData) {
                    if (targetObj.userData.placementScale) this.activeScale = targetObj.userData.placementScale;
                    else if (targetObj.userData.templateScale) this.activeScale = targetObj.userData.templateScale;
                    else if (targetObj.parent && targetObj.parent.userData && targetObj.parent.userData.placementScale) {
                        this.activeScale = targetObj.parent.userData.placementScale;
                    }
                }

                this.onStatusUpdate(`Selected Distance. Step 2: Click end point.`);
                this.lastClickTime = now;

            } else if (this.points.length === 1) {
                // Step 2: End Point
                if (this.points[0].distanceTo(point) < 0.001) {
                    return;
                }
                this.points.push(point);
                this.onStatusUpdate(`Step 3: Move mouse to position Dimension Line, then Click.`);
                this.lastClickTime = now;

            } else if (this.points.length === 2) {
                // Step 3: Dimension Line Position
                this.points.push(point);
                this.onStatusUpdate(`Step 4: Move mouse to position Text along the line, then Click to finish.`);
                // Force a longer debounce here to ensure user sees the transition
                this.lastClickTime = now + 200;

            } else if (this.points.length === 3) {
                // Step 4: Text Position (Finish)
                const p1 = this.points[0];
                const p2 = this.points[1];
                const dimLinePos = this.points[2];
                const textPos = point;

                // Calculate State with final text position and SCALE
                const state = this.getDimensionState(p1, p2, dimLinePos, this.activeScale, textPos);

                const measurementData = {
                    type: 'distance',
                    points: [p1, p2, dimLinePos, textPos], // Store all 4 points
                    text: state.text,
                    value: parseFloat(state.text), // Parse value
                    visual: null, // assigned below
                    scale: this.activeScale // Store scale
                };

                // Create Visual
                const visual = this.createDimensionVisual(state, false);
                visual.userData.data = measurementData;
                measurementData.visual = visual;

                this.measurements.push(measurementData);
                this.group.add(visual);

                if (this.onMeasurementAdded) this.onMeasurementAdded(measurementData);
                this.onStatusUpdate('Measurement added.');

                // Reset
                this.points = [];
                // Clear temp
                this.clearTemp();
                // Keep tool active
                this.onStatusUpdate('Ready. Click start point for new measurement.');
            }
        }

        // Angle Tool
        if (this.activeTool === 'angle') {
            const p = point.clone();

            // Mode A: 2-Line Selection (Priority if Object Clicked)
            const validTypes = ['LINE', 'LWPOLYLINE', 'POLYLINE'];

            if (!this.lineSelection && this.points.length === 0 && hitObject && hitObject.userData && validTypes.includes(hitObject.userData.type)) {
                // Start Line Selection Mode
                // Store object, click point AND segment index
                this.lineSelection = [{ object: hitObject, point: p, index: hitIndex }];
                console.log("Angle: Line 1 Selected", hitIndex);
                this.onStatusUpdate('Angle: Line 1 selected. Select Line 2.');
                return;
            }

            if (this.lineSelection && this.lineSelection.length === 1 && hitObject && hitObject.userData && validTypes.includes(hitObject.userData.type)) {
                // Line 2 Selected
                this.lineSelection.push({ object: hitObject, point: p, index: hitIndex });
                console.log("Angle: Line 2 Selected", hitIndex);

                // Compute Intersection
                const sel1 = this.lineSelection[0];
                const sel2 = this.lineSelection[1];
                const l1 = sel1.object;
                const l2 = sel2.object;

                // Robust Helper to get EXACT line segment using Raycast Index
                const getSegment = (lineObj, clickPoint, segmentIndex) => {
                    const pos = lineObj.geometry.attributes.position;
                    // If segmentIndex is valid number, use it!
                    // Note: Check bounds just in case
                    if (typeof segmentIndex === 'number' && segmentIndex >= 0 && segmentIndex < pos.count) {
                        const p1Local = new THREE.Vector3(pos.getX(segmentIndex), pos.getY(segmentIndex), pos.getZ(segmentIndex));
                        // For LineSegments, i+1. For LineStrip, i+1. 
                        // Raycaster returns start index of segment.
                        const idx2 = segmentIndex + 1;
                        if (idx2 < pos.count) {
                            const p2Local = new THREE.Vector3(pos.getX(idx2), pos.getY(idx2), pos.getZ(idx2));
                            p1Local.applyMatrix4(lineObj.matrixWorld);
                            p2Local.applyMatrix4(lineObj.matrixWorld);
                            return [p1Local, p2Local];
                        }
                    }

                    // Fallback: Closest Segment Logic (if index missing or invalid)
                    // Copied from previous logic
                    const isLineSegments = lineObj.isLineSegments;
                    const cnt = pos.count;
                    let bestDist = Infinity;
                    let bestSeg = [new THREE.Vector3(), new THREE.Vector3()];
                    const stride = isLineSegments ? 2 : 1;
                    const limit = isLineSegments ? cnt : cnt - 1;
                    const p1Local = new THREE.Vector3();
                    const p2Local = new THREE.Vector3();
                    const p1World = new THREE.Vector3();
                    const p2World = new THREE.Vector3();

                    for (let i = 0; i < limit; i += stride) {
                        p1Local.set(pos.getX(i), pos.getY(i), pos.getZ(i));
                        p2Local.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));

                        p1World.copy(p1Local).applyMatrix4(lineObj.matrixWorld);
                        p2World.copy(p2Local).applyMatrix4(lineObj.matrixWorld);

                        const vW = new THREE.Vector3().subVectors(p2World, p1World);
                        const vP = new THREE.Vector3().subVectors(clickPoint, p1World);
                        const lenSq = vW.lengthSq();
                        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, vP.dot(vW) / lenSq));
                        const proj = p1World.clone().add(vW.multiplyScalar(t));
                        const dist = proj.distanceToSquared(clickPoint);

                        if (dist < bestDist) {
                            bestDist = dist;
                            bestSeg[0].copy(p1World);
                            bestSeg[1].copy(p2World);
                        }
                    }
                    return bestSeg;
                };

                const [p1, p2] = getSegment(l1, sel1.point, sel1.index); // Line 1
                const [p3, p4] = getSegment(l2, sel2.point, sel2.index); // Line 2

                // 2D Intersection (XY Plane)
                const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
                const x3 = p3.x, y3 = p3.y, x4 = p4.x, y4 = p4.y;

                const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);

                if (Math.abs(denom) > 1e-9) {
                    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;

                    // Intersection Point (2D)
                    const ix = x1 + ua * (x2 - x1);
                    const iy = y1 + ua * (y2 - y1);

                    // Interpolate Z
                    // Z = Z1 + ua * (Z2 - Z1)
                    const iz = p1.z + ua * (p2.z - p1.z);

                    const intersection = new THREE.Vector3(ix, iy, iz);

                    // Determine Ends based on Click Side
                    const vClick1 = new THREE.Vector3().subVectors(sel1.point, intersection);
                    const vEnd1 = new THREE.Vector3().subVectors(p1, intersection);
                    const vEnd2 = new THREE.Vector3().subVectors(p2, intersection);
                    // Use dot product to find which endpoint vector aligns with click vector
                    const arm1End = vClick1.dot(vEnd1) > vClick1.dot(vEnd2) ? p1 : p2;

                    // Vector from I to Click2
                    const vClick2 = new THREE.Vector3().subVectors(sel2.point, intersection);
                    const vEnd3 = new THREE.Vector3().subVectors(p3, intersection);
                    const vEnd4 = new THREE.Vector3().subVectors(p4, intersection);
                    const arm2End = vClick2.dot(vEnd3) > vClick2.dot(vEnd4) ? p3 : p4;

                    // Push Points: Center, Arm1End, Arm2End
                    this.points.push(intersection);
                    this.points.push(arm1End);
                    this.points.push(arm2End);

                } else {
                    console.log("Angle: Lines are parallel");
                    this.onStatusUpdate('Lines are parallel. Cannot measure angle.');
                    this.lineSelection = null;
                    return;
                }

                this.lineSelection = null;
                return; // Wait for next click (Placement) which will trigger length===3 block
            }

            if (this.points.length === 0) this.points.push(p);
            else if (this.points.length === 1) this.points.push(p);
            else if (this.points.length === 2) this.points.push(p);
            else if (this.points.length === 3) {
                const center = this.points[0], start = this.points[1], end = this.points[2], placement = p;
                const visual = this.createAngleVisual(center, start, end, placement, false);

                // Calculate Value
                // Re-calc vectors based on arms
                const v1 = new THREE.Vector3().subVectors(start, center);
                const v2 = new THREE.Vector3().subVectors(end, center);

                // Use the visual calculation logic for value if possible, but simplest:
                // abs(angle) is not enough, we need the visual sector angle.
                // createAngleVisual returns value in userData.
                const val = visual.userData.value || "0°";

                const mData = {
                    type: 'angle',
                    center, start, end, placement,
                    value: val.replace('°', ''),
                    visual
                };

                if (this.onMeasurementAdded) {
                    this.onMeasurementAdded(mData);
                } else {
                    this.group.add(visual);
                    this.measurements.push(mData);
                }
                this.points = [];
                this.clearTemp();
                this.onStatusUpdate(`Angle: ${val}`);
            }
        }
    }

    updatePreview(point) {
        if (!this.activeTool) return;
        this.clearTemp();

        // Radius/Diameter Preview
        if (this.activeTool === 'radius' || this.activeTool === 'diameter') {
            if (this.points.length === 1) {
                // Preview Arrow Phase
                // Have Center, Dragging Arrow on Circle
                const center = this.currentRadiusEntity.center;
                const radius = this.currentRadiusEntity.radius;

                // Calc Arrow Pos
                const v = new THREE.Vector3().subVectors(point, center).normalize();
                if (v.lengthSq() === 0) v.set(1, 0, 0);
                const arrowPoint = center.clone().add(v.multiplyScalar(radius));

                // Determine Direction (Inside/Outside)
                const dist = point.distanceTo(center);
                const isOutside = dist > radius;

                // If Outside: Arrow points to Center.
                // If Inside: Arrow points Outwards.

                // Visual just for Arrow Phase
                // Show Circle Ghost? Maybe.
                // Show Arrow.

                this.tempMeasurement = this.createSmartRadiusPreview_Arrow(center, arrowPoint, isOutside);
                this.group.add(this.tempMeasurement);

            } else if (this.points.length === 2) {
                // Preview Text Phase
                // Have Center, ArrowPoint. Dragging Text.
                const center = this.currentRadiusEntity.center;
                const radius = this.currentRadiusEntity.radius;
                const arrowPoint = this.points[1];
                const textPoint = point;

                const visual = this.createSmartRadiusVisual(center, radius, arrowPoint, textPoint, this.activeTool, this.activeScale, true);
                this.tempMeasurement = visual;
                this.group.add(this.tempMeasurement);
            }
            return;
        }

        // Distance Tool
        if (this.activeTool === 'distance') {
            if (this.points.length === 1) {
                // Step 2: Dragging P2
                const p1 = this.points[0];
                const p2 = point;
                const dist = p1.distanceTo(p2);

                // Apply active scale (Inverse: if scale is 0.5, actual dist is double screen dist)
                const realDist = dist / this.activeScale;

                // Simple line P1->P2
                this.tempMeasurement = this.createMeasurementVisual(p1, p2, realDist.toFixed(3), true);
                this.group.add(this.tempMeasurement);

            } else if (this.points.length === 2) {
                // Step 3: Placing Dimension Line
                const p1 = this.points[0];
                const p2 = this.points[1];
                const placement = point;

                // Smart Dimension Logic with Scale
                // textPos is null here, so it defaults to center
                const state = this.getDimensionState(p1, p2, placement, this.activeScale);

                this.tempMeasurement = this.createDimensionVisual(state, true);
                this.group.add(this.tempMeasurement);
            } else if (this.points.length === 3) {
                // Step 4: Placing Text
                const p1 = this.points[0];
                const p2 = this.points[1];
                const dimLinePos = this.points[2];
                const textPos = point;

                const state = this.getDimensionState(p1, p2, dimLinePos, this.activeScale, textPos);
                this.tempMeasurement = this.createDimensionVisual(state, true);
                this.group.add(this.tempMeasurement);
            }
        }
        // Angle Tool (No scaling needed for angles)
        else if (this.activeTool === 'angle') {
            if (this.points.length === 1) {
                // Have Center, dragging Start
                const center = this.points[0];
                const start = point;
                // Visual: Line from Center to Mouse
                this.tempMeasurement = this.createMeasurementVisual(center, start, "", true);
                this.group.add(this.tempMeasurement);
            } else if (this.points.length === 2) {
                // Have Center & Start. Mouse is End (Arm 2 Preview).
                const center = this.points[0];
                const start = this.points[1];
                const end = point;

                this.tempMeasurement = this.createAngleVisual(center, start, end, null, true);
                this.group.add(this.tempMeasurement);
            } else if (this.points.length === 3) {
                // Have Center, Start, End. Mouse is Placement (Radius Preview).
                const center = this.points[0];
                const start = this.points[1];
                const end = this.points[2];
                const placement = point;

                this.tempMeasurement = this.createAngleVisual(center, start, end, placement, true);
                this.group.add(this.tempMeasurement);
            }
        }
    }

    createAngleVisual(center, start, end, placement, isPreview) {
        const group = new THREE.Group();
        group.userData = { type: 'DIMENSION', value: "Angle", isPreview: isPreview }; // Temp value, update later
        const material = isPreview ? this.previewMaterial : this.lineMaterial;
        const color = material.color;

        // 1. Arms
        // Center->Start
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, start]), material));
        // Center->End
        // During preview with 2 points, End is Mouse. 
        // During preview with 3 points, End is Fixed, we just visual adjustment?

        let pStart = start;
        let pEnd = end;

        // Visual Lines
        // Arm 1
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, pStart]), material));
        // Arm 2
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, pEnd]), material));

        // 2. Arc & Radius
        // If final (placement provided), use placement for radius
        let r, a1, a2;

        // Vectors
        const v1 = new THREE.Vector3().subVectors(pStart, center);
        const v2 = new THREE.Vector3().subVectors(pEnd, center);

        a1 = Math.atan2(v1.y, v1.x);
        a2 = Math.atan2(v2.y, v2.x);

        // Calculate Angle Diff (CCW)
        // Calculate Angle Diff (CCW)
        // Revised Logic: Determined by Sector of Placement

        let diff;

        if (placement) {
            // Full Sector Logic: 2 Lines -> 4 Quadrants
            // 1. Get base angles of the two lines relative to center
            const ang1Base = Math.atan2(v1.y, v1.x);
            const ang2Base = Math.atan2(v2.y, v2.x);

            // 2. Determine 4 sector boundaries (Infinite lines)
            // Lines extend in both directions.
            // Angles: A, A+PI, B, B+PI
            let angles = [
                ang1Base,
                ang1Base + Math.PI,
                ang2Base,
                ang2Base + Math.PI
            ];

            // Normalize to [0, 2PI)
            angles = angles.map(a => {
                while (a < 0) a += Math.PI * 2;
                while (a >= Math.PI * 2) a -= Math.PI * 2;
                return a;
            });

            // Sort
            angles.sort((a, b) => a - b);

            // 3. Determine Placement Angle
            const vPlace = new THREE.Vector3().subVectors(placement, center);
            let angPlace = Math.atan2(vPlace.y, vPlace.x);
            while (angPlace < 0) angPlace += Math.PI * 2;
            while (angPlace >= Math.PI * 2) angPlace -= Math.PI * 2;

            // 4. Find interval
            let startAngle = angles[3];
            let endAngle = angles[0]; // Wraparound sector (end to start)

            for (let i = 0; i < 3; i++) {
                if (angPlace >= angles[i] && angPlace < angles[i + 1]) {
                    startAngle = angles[i];
                    endAngle = angles[i + 1];
                    break;
                }
            }
            // Check wraparound case
            if (angPlace >= angles[3] || angPlace < angles[0]) {
                startAngle = angles[3];
                endAngle = angles[0];
            }

            a1 = startAngle;
            a2 = endAngle;

            // Diff calculation (Standard CCW from a1 to a2)
            diff = a2 - a1;
            while (diff <= 0) diff += Math.PI * 2; // Should be positive

        } else {
            // Fallback (No mouse) -> Use defined points order
            diff = a2 - a1;
            while (diff < 0) diff += Math.PI * 2;
        }

        // "Angle value depend position of mouse"
        // If placement point is provided, are we "inside" the angle or "outside"?
        // If placement is provided:
        // Radius Calculation
        if (placement) {
            r = center.distanceTo(placement);
        } else {
            // Default Radius
            r = Math.min(center.distanceTo(pStart), center.distanceTo(pEnd)) * 0.8;
            if (r < 0.1) r = 5.0;
        }

        const curve = new THREE.EllipseCurve(
            center.x, center.y,
            r, r,
            a1, a2,
            false, // CCW
            0
        );

        const arcPts = curve.getPoints(32);
        const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPts);
        const arc = new THREE.Line(arcGeom, material);
        group.add(arc);

        // Extension Lines (Guidelines)
        // From Center to Arc Start (a1) and Arc End (a2)
        // Helps visualize which lines are being measured
        // P_start_guide = Center + (r * vector_a1)
        const pGuideStart = new THREE.Vector3(
            center.x + Math.cos(a1) * r,
            center.y + Math.sin(a1) * r,
            0
        );
        const pGuideEnd = new THREE.Vector3(
            center.x + Math.cos(a2) * r,
            center.y + Math.sin(a2) * r,
            0
        );

        // Draw guideline from Center to Arrow Tip
        // Use a dashed material? Or same material but lighter?
        // User requested "Green guide lines". We use the same material.
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, pGuideStart]), material));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, pGuideEnd]), material));

        // 4. Arrows
        const arrowLen = 3.0;
        const headLen = arrowLen;
        const headWidth = arrowLen * 0.4;

        // Start Arrow (at a1)
        // Tangent direction at Angle theta is (-sin(theta), cos(theta)) for CCW
        // We want Arrow 1 to point CW (backwards from arc start): Diff direction?
        // Tangent at a1 points CCW. We want CW -> Opposite.
        // wait, arrow points *away* from the gap? 
        // Standard: <-->
        // At Start Point: Arrow points towards Start Point (CW relative to arc flow).

        // P_start = (r*cos(a1), r*sin(a1))
        // Tangent_CCW = (-sin(a1), cos(a1))
        // ArrowDir = -Tangent_CCW = (sin(a1), -cos(a1))
        const arrowDirStart = new THREE.Vector3(Math.sin(a1), -Math.cos(a1), 0);
        const arrowPosStart = new THREE.Vector3(
            center.x + Math.cos(a1) * r,
            center.y + Math.sin(a1) * r,
            0
        );
        // ArrowHelper(dir, origin, length, color, headLength, headWidth)
        const arrowStart = new THREE.ArrowHelper(arrowDirStart, arrowPosStart, arrowLen, color, headLen, headWidth);
        // ArrowHelper places tail at origin. We want TIP at origin?
        // No, standard Dimension arrows: Tip touches the extension line.
        // So tip should be at arrowPosStart.
        // To put Tip at Pos, we need to move Origin backwards by Length?
        // Origin = Pos - Dir * Len
        const arrowOriginStart = new THREE.Vector3().copy(arrowPosStart).sub(arrowDirStart.clone().multiplyScalar(arrowLen));
        arrowStart.position.copy(arrowOriginStart);
        // But ArrowHelper draws a line + cone. The cone is at the END of the length.
        // So if we set Origin at (Pos - Len), the Tip will be at Pos. Correct.
        group.add(arrowStart);

        // End Arrow (at a2)
        // Points CCW (towards End Point / away from arc center)
        // Tangent_CCW = (-sin(a2), cos(a2))
        const arrowDirEnd = new THREE.Vector3(-Math.sin(a2), Math.cos(a2), 0);
        const arrowPosEnd = new THREE.Vector3(
            center.x + Math.cos(a2) * r,
            center.y + Math.sin(a2) * r,
            0
        );
        const arrowOriginEnd = new THREE.Vector3().copy(arrowPosEnd).sub(arrowDirEnd.clone().multiplyScalar(arrowLen));
        const arrowEnd = new THREE.ArrowHelper(arrowDirEnd, arrowOriginEnd, arrowLen, color, headLen, headWidth);
        group.add(arrowEnd);


        // 5. Text
        const deg = (diff * 180 / Math.PI).toFixed(1) + '°';

        // Position text at mid angle of the arc
        let midAngle = a1 + diff / 2;

        // Text Rotation (Tangent to Arc)
        // Tangent is perpendicular to Radius (midAngle)
        let textRot = midAngle - Math.PI / 2;
        // Note: Tangent direction depends on CW/CCW. 
        // Usually we want text baseline parallel to tangent.
        // midAngle points OUT from Center.
        // midAngle - PI/2 points "Right" relative to Radius.

        // Normalize to -PI..PI
        while (textRot > Math.PI) textRot -= Math.PI * 2;
        while (textRot < -Math.PI) textRot += Math.PI * 2;

        // Smart Flip: Keep text upright (-90 to 90 degrees relative to screen)
        if (textRot > Math.PI / 2 || textRot < -Math.PI / 2) {
            textRot += Math.PI;
        }

        // Text Position based on Radius
        const textOffset = r + (arrowLen) * 1.5;

        const textPos = new THREE.Vector3(
            center.x + Math.cos(midAngle) * textOffset,
            center.y + Math.sin(midAngle) * textOffset,
            0
        );

        const textMesh = this.createTextMesh(deg, textRot, color, group.userData.tolerance);
        textMesh.position.copy(textPos);
        group.add(textMesh);

        group.userData.value = deg; // Update Value
        group.userData.isUserDefined = true;
        return group;
    }



    showAreaMeasurement(point, value) {
        const group = new THREE.Group();
        const text = "S: " + value.toFixed(2);
        group.userData = { type: 'DIMENSION', value: text, isPreview: false, isUserDefined: true };

        const textMesh = this.createTextMesh(text, 0, this.lineMaterial.color, group.userData.tolerance);
        textMesh.position.copy(point);
        group.add(textMesh);
        this.group.add(group);

        this.measurements.push({
            type: 'area',
            value: value.toFixed(2),
            visual: group
        });
    }

    getDimensionState(p1, p2, placement, scale = 1.0, fixedTextPos = null) {
        const mid = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const len = dir.length();

        // Default (fallback)
        let type = 'aligned';
        // Scaled Value
        let val = len / scale;

        let dimP1 = p1.clone();
        let dimP2 = p2.clone();
        let angle = Math.atan2(dir.y, dir.x);

        const arrowLen = 3.0;

        if (len < 1e-6) return { type, value: 0, p1, p2, dimP1, dimP2, angle: 0, text: "0.000" };

        const unitDir = dir.clone().normalize();
        const normal = new THREE.Vector3(-unitDir.y, unitDir.x, 0);

        // Vector Mouse -> Mid to determine orientation
        // Use 'placement' (Dimension Line placement) for this. 
        const drag = new THREE.Vector3().subVectors(placement, mid);

        // Projections
        const dotH = Math.abs(drag.x); // Pulling horizontal
        const dotV = Math.abs(drag.y); // Pulling vertical
        // Project drag onto normal for aligned check
        const dotP = Math.abs(drag.dot(normal));

        // Thresholds
        // If we pull 'roughly' perpendicular to the line, keep aligned.
        // If we pull significantly away in X or Y, switch.

        // 1. Aligned Zone: If drag is mostly along the normal vector
        // Normalize drag to compare directions
        const dragLen = drag.length();
        let isAligned = true;

        if (dragLen > 0.1) { // Only switch if dragged enough
            const dragN = drag.clone().normalize();
            const alignScore = Math.abs(dragN.dot(normal)); // 1.0 = perfectly perp

            // If angle is diagonal, H/V might be preferred unless specifically pulling perp
            if (alignScore < 0.85) { // < ~30 degrees deviation from normal
                // Check H vs V dominance
                // dx > dy -> Pulling Side -> Vertical Dimension (measures Y)
                // dy > dx -> Pulling Up/Down -> Horizontal Dimension (measures X)

                if (Math.abs(drag.x) > Math.abs(drag.y)) {
                    type = 'vertical';
                } else {
                    type = 'horizontal';
                }
                isAligned = false;
            }
        }

        // Calculate Geometry based on Type
        // We establish DimP1 and DimP2 based on 'mouse' (Step 3).
        if (type === 'horizontal') {
            // Measure dx
            val = Math.abs(p2.x - p1.x) / scale;
            angle = 0;
            // Dim Line is at mouse.y
            dimP1 = new THREE.Vector3(p1.x, placement.y, 0);
            dimP2 = new THREE.Vector3(p2.x, placement.y, 0);

        } else if (type === 'vertical') {
            // Measure dy
            val = Math.abs(p2.y - p1.y) / scale;
            angle = Math.PI / 2;
            // Dim Line is at mouse.x
            dimP1 = new THREE.Vector3(placement.x, p1.y, 0);
            dimP2 = new THREE.Vector3(placement.x, p2.y, 0);

        } else {
            // Aligned
            type = 'aligned';
            val = len / scale;

            // Line through Mouse parallel to Dir
            // Offset vector = (Mouse - P1).dot(normal) * normal
            const vM = new THREE.Vector3().subVectors(placement, p1);
            const distPerp = vM.dot(normal);
            const offset = normal.clone().multiplyScalar(distPerp);

            dimP1 = p1.clone().add(offset);
            dimP2 = p2.clone().add(offset);

            // Angle adjustment
            if (angle > Math.PI / 2) angle -= Math.PI;
            if (angle <= -Math.PI / 2) angle += Math.PI;
        }

        // Precision Clamp
        if (val < 1e-6) val = 0;

        // --- Calculate Text Position ---
        let textPos = null;
        if (fixedTextPos) {
            // Step 4: fixedTextPos provided. Project onto Dimension Line.
            const dimDir = new THREE.Vector3().subVectors(dimP2, dimP1).normalize();
            if (dimDir.lengthSq() > 0) {
                const vT = new THREE.Vector3().subVectors(fixedTextPos, dimP1);
                // Project vT onto dimDir
                const proj = vT.dot(dimDir);
                // textPos = dimP1 + proj * dimDir
                // Clamp? User said "Metnin konumu, çizgiye paralel kaydırılabilir olmalıdır."
                // Doesn't say it must be strictly between arrows.
                textPos = dimP1.clone().add(dimDir.clone().multiplyScalar(proj));
            } else {
                textPos = dimP1.clone();
            }
        } else {
            // Default: Midpoint
            textPos = new THREE.Vector3().addVectors(dimP1, dimP2).multiplyScalar(0.5);
        }

        return {
            type,
            value: val,
            text: val.toFixed(2),
            p1, p2,
            dimP1, dimP2,
            angle,
            textPos // New
        };
    }

    createDimensionVisual(state, isPreview) {
        const group = new THREE.Group();
        group.userData = { type: 'DIMENSION', value: state.text, isPreview: isPreview, isUserDefined: !isPreview };
        const material = isPreview ? this.previewMaterial : this.lineMaterial;

        const { p1, p2, dimP1, dimP2, angle, text, textPos, scale = 1.0 } = state;

        // Visual Parameters (User defined)
        // Scale arrows and text by view scale
        const baseSize = 3.0;
        const arrowLen = baseSize * scale;

        // --- Calculate Text Geometry for Bounding Box ---
        const color = material.color;
        // Pass scale to createTextMesh
        const textMesh = this.createTextMesh(text, angle, color, group.userData.tolerance, scale);

        // Measure Text in World Space
        textMesh.geometry.computeBoundingBox();
        const localW = textMesh.geometry.boundingBox.max.x - textMesh.geometry.boundingBox.min.x;
        // The textMesh plane is scaled by 1, but mapped to world coordinates. 
        // createTextMesh returns a Mesh with PlaneGeometry(width, height).
        // The width matches world units approximately.
        const textWidth = localW;

        // Set Text Position
        // Note: textPos is on the dimension line. We might need to offset slightly if configured?
        // User requirements: "Metnin konumu, çizgiye paralel kaydırılabilir olmalıdır." (Text slides along line)
        // "Ölçü metninin altındaki ölçü çizgisi, metnin altını kapatmayacak şekilde otomatik olarak iki parçaya bölünmeli"
        // (Line should be cut under the text)

        // textMesh origin is center.
        textMesh.position.copy(textPos);
        textMesh.position.z = 0.05; // Slightly above line
        group.add(textMesh);


        // --- Dimension Line Cutting Logic ---
        // We have DimP1 <-----------------------> DimP2
        // Text is at TextPos.
        // We need to cut the line around TextPos.
        // Gap = TextWidth + Padding.
        const gap = textWidth * 0.6; // *0.5 for half, + padding

        // Direction P1->P2
        const dirFull = new THREE.Vector3().subVectors(dimP2, dimP1);
        const lenFull = dirFull.length();
        const dir = dirFull.clone().normalize();

        // Project TextPos onto Line to find where it is relative to P1
        const vT = new THREE.Vector3().subVectors(textPos, dimP1);
        const tProj = vT.dot(dir);

        // Define Cut Start/End
        const tStart = tProj - gap;
        const tEnd = tProj + gap;

        // Segments:
        // 1. DimP1 -> (DimP1 + tStart*dir)  [If tStart > 0]
        // 2. (DimP1 + tEnd*dir) -> DimP2    [If tEnd < lenFull]

        const points = [];

        // Segment 1 (Left of Text)
        if (tStart > 0) {
            const startPt = dimP1;
            const endPtVal = Math.min(tStart, lenFull);
            const endPt = dimP1.clone().add(dir.clone().multiplyScalar(endPtVal));
            if (endPtVal > 0) points.push([startPt, endPt]);
        }

        // Segment 2 (Right of Text)
        if (tEnd < lenFull) {
            const startPtVal = Math.max(tEnd, 0);
            const startPt = dimP1.clone().add(dir.clone().multiplyScalar(startPtVal));
            const endPt = dimP2;
            if (startPtVal < lenFull) points.push([startPt, endPt]);
        }

        // Draw Separate Lines
        const overlaps = (tStart < lenFull && tEnd > 0);

        if (overlaps) {
            points.forEach(pair => {
                const geom = new THREE.BufferGeometry().setFromPoints(pair);
                const line = new THREE.Line(geom, material);
                if (isPreview) line.computeLineDistances();
                group.add(line);
            });
        } else {
            // No overlap (Text is outside limit), draw full line
            const geom = new THREE.BufferGeometry().setFromPoints([dimP1, dimP2]);
            const line = new THREE.Line(geom, material);
            if (isPreview) line.computeLineDistances();
            group.add(line);
        }

        // 2. Extension Lines (Witness Lines)
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, dimP1]), material));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p2, dimP2]), material));

        // 3. Arrows
        // Re-use direction logic from before
        const isTight = lenFull < (arrowLen * 2.2 + textWidth); // Estimating tight

        // Flip arrows if space is too small
        if (!isTight) {
            // Inside
            group.add(this.createArrow(dimP1, dir.clone().negate(), arrowLen, color)); // P1: Left (<)
            group.add(this.createArrow(dimP2, dir, arrowLen, color));
        } else {
            // Outside
            group.add(this.createArrow(dimP1, dir, arrowLen, color));
            group.add(this.createArrow(dimP2, dir.clone().negate(), arrowLen, color));

            // Extra lines holding the arrows outside
            const extLen = arrowLen * 1.5;
            const out1 = dimP1.clone().sub(dir.clone().multiplyScalar(extLen));
            const out2 = dimP2.clone().add(dir.clone().multiplyScalar(extLen));

            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([out1, dimP1]), material));
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([dimP2, out2]), material));
        }

        return group;
    }

    // Helper for text offset calculation
    // ... we can just use fixed for now or the constant logic

    // createArrow helper needs to be accessible. It is.


    createArrow(origin, dir, length, color) {
        // Cone or Shape?
        // Shape allows flat arrow.
        // Let's use a simple Shape triangle.
        const shape = new THREE.Shape();
        const w = length * 0.3;
        shape.moveTo(0, 0);
        shape.lineTo(-length, w);
        shape.lineTo(-length, -w);
        shape.lineTo(0, 0);

        const geom = new THREE.ShapeGeometry(shape);
        const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geom, mat);

        // Rotate and Position
        // Shape points -X. Origin is 0,0.
        // Default direction is +X? No points are negative X. So it points to Origin from left type?
        // Wait, arrowhead tip is at 0,0.
        // We want tip at `origin`, pointing in `dir`.
        // `dir` is direction OF THE LINE. If we put arrow at Start, pointing End (dir),
        // we actually want arrow pointing AT Start?
        // Usually dimensions arrows point OUTWARD from center? Or INWARD?
        // Standard: Arrows are at the ENDS, pointing OUTWARD?
        // <------- L ------->
        // So at P1 (Left), arrow points Left (-Dir). At P2 (Right), arrow points Right (+Dir).
        // My Logic above:
        // Arrow 1: At DimP1 pointing P2? -> >-------
        // Arrow 2: At DimP2 pointing P1? -> -------<
        // This makes arrows point INWARD to the line center. This is correct for internal arrows.
        // For external arrows (small space) they flip.
        // Let's stick to "Arrows pointing away from center" (<--->) style?
        // Wait. <----> means tip is at endpoint, pointing OUT.
        // My code:
        // Arrow 1 at P1, dir = P2-P1.
        // My Shape: Tip 0,0. Body -X.
        // If I align +X of shape to `dir`: Tip is at P1, body extends towards -Dir (away from P2).
        // That means Arrow points TO P2? No.
        // Shape: Tip is at origin. Body is in -X.
        // If Local X aligns with Dir (P1->P2):
        // Tip at P1. Body is "left" of P1.
        // So it looks like:   Start <-------
        // This is an arrow pointing RIGHT (towards P2), located at P1.
        // Standard Dim:  |<-- Text -->|
        // So at P1, we want arrow pointing Left (Away from P2).
        // So Direction should be P1-P2 (Negate Dir).

        // Correct Logic:
        // At P1: Direction is P1-P2.
        // At P2: Direction is P2-P1.

        // My calling code:
        // Arrow 1 at DimP1, dir = P2-P1. (Points right). USE NEGATE.
        // Arrow 2 at DimP2, dir = P1-P2. (Points left). USE NEGATE.

        // Wait, let's fix the calling code instead.
        // If I want arrow <----| (At P1, pointing Left)
        // Origin P1. Shape Tip 0,0. Body -X.
        // I need +X to point Left.

        const angle = Math.atan2(dir.y, dir.x);
        mesh.rotation.z = angle;
        mesh.position.copy(origin);

        return mesh;
    }

    // Replace Sprite with Mesh for rotation
    createTextMesh(text, angle, colorVal, tolerance, scale = 1.0) {
        const fontsize = 48; // Increased resolution
        const fontface = "Arial";
        const resScale = 1; // high-res canvas

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Measure Main Text
        ctx.font = `Bold ${fontsize * resScale}px ${fontface}`;
        const metrics = ctx.measureText(text);
        const w = metrics.width;
        const h = fontsize * resScale * 1.4; // Base height

        // ... (Tolerance logic same) ...

        const aspect = canvas.width / canvas.height;
        // World Scale for text height
        const baseWorldScale = 5.0;
        const worldScale = baseWorldScale * scale;

        // Tolerance Calculation
        let tolW = 0;
        let isSymmetric = false;
        let tolStrPlus = "";
        let tolStrMinus = "";

        if (tolerance && tolerance.active) {
            const plus = parseFloat(tolerance.plus) || 0;
            const minus = parseFloat(tolerance.minus) || 0;

            if (plus === minus) {
                isSymmetric = true;
                tolStrPlus = "±" + plus;
            } else {
                tolStrPlus = "+" + plus;
                tolStrMinus = "-" + minus;
            }

            ctx.font = `Bold ${(fontsize * 0.6) * scale}px ${fontface}`;
            const mPlus = ctx.measureText(tolStrPlus);
            const mMinus = ctx.measureText(tolStrMinus);
            tolW = Math.max(mPlus.width, mMinus.width) + 10; // Add padding
        }

        canvas.width = w + tolW + 4; // padding
        canvas.height = h;

        // Draw (Transparent BG)
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = (typeof colorVal === 'number') ? '#' + colorVal.toString(16) : colorVal;
        if (typeof colorVal === 'object') ctx.fillStyle = '#' + colorVal.getHexString();

        // Draw Main Text
        ctx.font = `Bold ${fontsize * scale}px ${fontface}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Center the entire block? 
        // TextMesh origin is center.
        // We draw starting from left 2px.
        const startX = 2;
        ctx.fillText(text, startX, canvas.height / 2);

        // Draw Tolerance
        if (tolerance && tolerance.active) {
            ctx.font = `Bold ${(fontsize * 0.6) * scale}px ${fontface}`;
            const tolX = startX + w + 5;

            if (isSymmetric) {
                ctx.fillText(tolStrPlus, tolX, canvas.height / 2);
            } else {
                // Stacked
                // Plus (Top)
                ctx.fillText(tolStrPlus, tolX, (canvas.height / 2) - (fontsize * 0.25));
                // Minus (Bottom)
                ctx.fillText(tolStrMinus, tolX, (canvas.height / 2) + (fontsize * 0.35));
            }
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;

        const geom = new THREE.PlaneGeometry(aspect * worldScale, worldScale);
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.z = angle;
        // Since we drew from Left, but geometry is centered, we might need to shift if we want "Center" to mean "Center of Main Text" or "Center of Whole Block".
        // Current logic: TextMesh position is copied to visual center. 
        // If we add tolerance, the "Center" of the mesh (origin) creates the pivot.
        // If we want the main value to stay centered on the dimension line, we might need to offset the mesh.
        // But for simplicity, we center the whole block.
        return mesh;
    }

    updateTolerance(visual, toleranceData) {
        if (!visual) return;
        visual.userData.tolerance = toleranceData;

        // Re-create text mesh
        // Find existing text mesh and replace it
        // The text mesh is usually the last child or we can identify it by type (Mesh vs Line)
        // But arrows are also Meshes. TextMesh has PlaneGeometry.

        // Find the text object
        let textObj = null;
        visual.children.forEach(c => {
            if (c.isMesh && c.geometry.type === 'PlaneGeometry') {
                textObj = c;
            }
        });

        if (textObj) {
            const oldPos = textObj.position.clone();
            const oldRot = textObj.rotation.z;
            const color = visual.userData.originalColor || this.lineMaterial.color;
            const value = visual.userData.value;

            // Extract pure value if needed? value usually stores "R50.00"
            // We pass the full string to createTextMesh

            // Remove old
            visual.remove(textObj);
            textObj.geometry.dispose();
            textObj.material.dispose();
            textObj.material.map.dispose();

            // Create new
            const newText = this.createTextMesh(value, oldRot, color, toleranceData);
            newText.position.copy(oldPos);
            newText.userData.originalMaterial = newText.material; // For highlighting logic preservation
            visual.add(newText);
        }
    }

    createMeasurementVisual(p1, p2, labelText, isPreview) {
        const group = new THREE.Group();
        group.userData = { type: 'DIMENSION', value: labelText, isPreview: isPreview };
        const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
        const line = new THREE.Line(geometry, isPreview ? this.previewMaterial : this.lineMaterial);
        if (isPreview) line.computeLineDistances();
        group.add(line);
        return group;
    }

    clearTemp() {
        if (this.tempMeasurement) {
            this.clearGroup(this.tempMeasurement);
            this.group.remove(this.tempMeasurement);
            this.tempMeasurement = null;
        }
    }

    clearAll() {
        this.clearTemp();
        this.measurements.forEach(m => {
            this.clearGroup(m.visual);
            this.group.remove(m.visual);
        });
        this.measurements = [];
    }

    clearGroup(group) {
        if (!group) return;
        group.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
            if (obj.map) obj.map.dispose();
        });
    }
    createSmartRadiusPreview_Arrow(center, arrowPoint, isOutside) {
        const group = new THREE.Group();
        group.userData = { type: 'DIMENSION', value: "", isPreview: true };

        // Vector Center -> ArrowPoint
        const v = new THREE.Vector3().subVectors(arrowPoint, center).normalize();

        // Arrow Logic based on Outside/Inside
        // Outside: Points In (to Center) -> Dir = -v
        // Inside: Points Out (to Edge) -> Dir = v
        const dir = isOutside ? v.clone().negate() : v;
        const color = 0x32a852; // Green

        const arrowLen = 3.0; // Scalable? this.activeScale?
        // Let's rely on fixed size for preview or approximate
        const arrow = this.createArrow(arrowPoint, dir, arrowLen, color);
        group.add(arrow);

        // Optional: Guideline from Center to Arrow?
        // group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, arrowPoint]), this.previewMaterial));

        return group;
    }

    createSmartRadiusVisual(center, radius, arrowPoint, textPoint, type, scale, isPreview) {
        const group = new THREE.Group();
        scale = scale || 1.0;

        // Value
        const val = (type === 'radius') ? radius : radius * 2;
        const valScaled = val / scale;
        const prefix = (type === 'radius') ? 'R' : 'Ø';
        const textStr = prefix + valScaled.toFixed(2);

        group.userData = { type: 'DIMENSION', value: textStr, isPreview: isPreview, isUserDefined: !isPreview };
        const material = isPreview ? this.previewMaterial : this.lineMaterial;
        const color = material.color;

        // 1. Determine Direction (Inside/Outside) based on Text Position
        const distText = textPoint.distanceTo(center);
        const isOutside = distText > (radius * 0.95);

        const vRadius = new THREE.Vector3().subVectors(arrowPoint, center).normalize();

        // Arrow Direction: 
        // Outside Dimension: Arrow points IN to Center. (Dir = -vRadius)
        // Inside Dimension: Arrow points OUT from Center (Normal Radius). (Dir = vRadius)
        const arrowDir = isOutside ? vRadius.clone().negate() : vRadius;

        const arrowLen = 3.0; // Fixed size

        // 2. Add Arrow
        // Tip is at arrowPoint.
        group.add(this.createArrow(arrowPoint, arrowDir, arrowLen, color));

        // 3. Leader Line Calculation
        // Start from Arrow Tail.
        // As analyzed: createArrow uses a shape extending backwards (-X) from origin.
        // When rotated to align +X with arrowDir: Tip is at arrowPoint, Shape extends in -arrowDir.
        // So the "Back" of the arrow (Tail) is physically at: arrowPoint - arrowDir * arrowLen.
        const tailPos = arrowPoint.clone().sub(arrowDir.clone().multiplyScalar(arrowLen));

        // Landing Line (Shoulder)
        // Horizontal line under text.
        // Length: let's use a fixed reasonable size relative to text or just fixed 6.0
        const estimatedWidth = textStr.length * 1.8;
        const landingLen = Math.max(6.0, estimatedWidth + 2.0);
        // Check if text is to the Right or Left of Arrow Tail
        const isTextRight = textPoint.x > tailPos.x;

        // Landing Vertical Position: slightly below textPoint (baseline)
        const textHeight = 5.0; // approx world scale height
        const landingY = textPoint.y - textHeight * 0.3;

        // Landing Line Start/End
        const landL = new THREE.Vector3(textPoint.x - landingLen / 2, landingY, 0);
        const landR = new THREE.Vector3(textPoint.x + landingLen / 2, landingY, 0);

        // Draw Landing Line
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([landL, landR]), material));

        // Connect Leader to the closest end of the Landing Line
        // If Text is Right of Arrow -> Connect to Left end of Landing.
        // If Text is Left of Arrow -> Connect to Right end of Landing.
        // This prevents the leader crossing through the text.
        const connectionPoint = isTextRight ? landL : landR;

        // Draw Leader Line: Tail -> Connection
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([tailPos, connectionPoint]), material));

        // 4. Center Mark line (Optional but good for Radius)
        // Line from Center to ArrowPoint removed per user request.
        // group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, arrowPoint]), material));

        // 5. Text Label
        // Place at textPoint (centered).
        const textMesh = this.createTextMesh(textStr, 0, color, group.userData.tolerance);
        textMesh.position.copy(textPoint);
        textMesh.position.z = 0.05;
        group.add(textMesh);

        return group;
    }
}

