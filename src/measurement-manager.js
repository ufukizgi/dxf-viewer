
import * as THREE from 'three';

export class MeasurementManager {
    constructor(viewer, snappingManager, onStatusUpdate) {
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.snappingManager = snappingManager;
        this.onStatusUpdate = onStatusUpdate || (() => { });

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

    handleMouseMove(pointerNDC, rayOrigin, rayDir) {
        // Handled by updatePreview called explicitly from main
    }

    handleClick(point, hitObject) {
        if (!this.activeTool) return;

        // Radius & Diameter Tools (New 3-Step)
        if (this.activeTool === 'radius' || this.activeTool === 'diameter') {
            if (this.points.length === 0) {
                if (hitObject && hitObject.userData) {
                    const type = hitObject.userData.type;
                    if (type === 'CIRCLE' || type === 'ARC') {
                        const entity = hitObject.userData.entity || hitObject.userData;
                        const center = new THREE.Vector3(entity.center.x, entity.center.y, 0);
                        this.currentRadiusEntity = {
                            center: center,
                            radius: entity.radius,
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
                this.group.add(visual);

                const scale = this.activeScale || 1;
                const val = (this.activeTool === 'radius') ? radius : radius * 2;
                const valScaled = val / scale;
                this.measurements.push({
                    type: this.activeTool,
                    value: valScaled.toFixed(3),
                    visual: visual
                });

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
            if (this.points.length === 0) {
                this.points.push(point);
                this.activeScale = 1.0;
                let targetObj = hitObject;
                if (!targetObj && this.snappingManager && this.snappingManager.activeSnap) {
                    targetObj = this.snappingManager.activeSnap.object;
                }
                if (targetObj) {
                    if (targetObj.userData.placementScale) this.activeScale = targetObj.userData.placementScale;
                    else if (targetObj.userData.templateScale) this.activeScale = targetObj.userData.templateScale;
                    else if (targetObj.parent && targetObj.parent.userData.placementScale) this.activeScale = targetObj.parent.userData.placementScale;
                }
            } else if (this.points.length === 1) {
                if (this.points[0].distanceTo(point) < 0.001) return;
                this.points.push(point);
            } else if (this.points.length === 2) {
                const p1 = this.points[0];
                const p2 = this.points[1];
                const placement = point;
                const state = this.getDimensionState(p1, p2, placement, this.activeScale);
                const visual = this.createDimensionVisual(state, false);
                this.group.add(visual);
                this.measurements.push({ type: 'distance', p1, p2, placement, value: state.value, visual, stateType: state.type, scale: this.activeScale });
                this.points = [];
                this.clearTemp();
                this.activeScale = 1.0;
                // Cleanup sticky snap
                if (this.snappingManager && this.snappingManager.clearSticky) this.snappingManager.clearSticky();
            }
        }

        if (this.activeTool === 'angle') {
            const p = point.clone();
            const validTypes = ['LINE', 'LWPOLYLINE', 'POLYLINE'];
            if (!this.lineSelection && this.points.length === 0 && hitObject && hitObject.userData && validTypes.includes(hitObject.userData.type)) {
                this.lineSelection = [hitObject];
                return;
            }
            if (this.lineSelection && this.lineSelection.length === 1 && hitObject && hitObject.userData && validTypes.includes(hitObject.userData.type)) {
                this.lineSelection.push(hitObject);
                const l1 = this.lineSelection[0], l2 = this.lineSelection[1];
                const getLinePts = (line) => {
                    const pos = line.geometry.attributes.position;
                    // Fix: Handle BufferGeometry safely
                    const getVec = (idx) => new THREE.Vector3(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
                    return [getVec(0), getVec(1)];
                };
                const [l1s, l1e] = getLinePts(l1);
                const [l2s, l2e] = getLinePts(l2);
                const x1 = l1s.x, y1 = l1s.y, x2 = l1e.x, y2 = l1e.y;
                const x3 = l2s.x, y3 = l2s.y, x4 = l2e.x, y4 = l2e.y;
                const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
                if (Math.abs(denom) > 1e-9) {
                    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
                    const intersection = new THREE.Vector3(x1 + ua * (x2 - x1), y1 + ua * (y2 - y1), 0);
                    this.points.push(intersection);
                    this.points.push(l1e);
                    this.points.push(l2e);
                }
                this.lineSelection = null;
                return;
            }
            if (this.points.length === 0) this.points.push(p);
            else if (this.points.length === 1) this.points.push(p);
            else if (this.points.length === 2) this.points.push(p);
            else if (this.points.length === 3) {
                const center = this.points[0], start = this.points[1], end = this.points[2], placement = p;
                const visual = this.createAngleVisual(center, start, end, placement, false);
                this.group.add(visual);
                const v1 = new THREE.Vector3().subVectors(start, center);
                const v2 = new THREE.Vector3().subVectors(end, center);
                let diff = Math.atan2(v2.y, v2.x) - Math.atan2(v1.y, v1.x);
                if (diff < 0) diff += Math.PI * 2;
                this.measurements.push({ type: 'angle', center, start, end, placement, value: (diff * 180 / Math.PI).toFixed(1), visual });
                this.points = [];
                this.clearTemp();
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
                // Step 3: Placing
                const p1 = this.points[0];
                const p2 = this.points[1];
                const placement = point;

                // Smart Dimension Logic with Scale
                const state = this.getDimensionState(p1, p2, placement, this.activeScale);

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

        const textMesh = this.createTextMesh(deg, textRot, color);
        textMesh.position.copy(textPos);
        group.add(textMesh);

        group.userData.value = deg; // Update Value
        return group;
    }

    handleClick_deprecated(point, hitObject) {
        if (!this.activeTool) return;

        if (this.activeTool === 'distance') {
            if (this.points.length === 0) {
                this.points.push(point); // P1

                // Detect Scale from hitObject or Snapped Object
                this.activeScale = 1.0; // Default

                // Check if we hit an object or snapped to one
                let targetObj = hitObject;
                if (!targetObj && this.snappingManager && this.snappingManager.activeSnap) {
                    targetObj = this.snappingManager.activeSnap.object;
                }

                if (targetObj) {
                    // Check for placement scale (from WeightManager placement)
                    if (targetObj.userData.placementScale) {
                        this.activeScale = targetObj.userData.placementScale;
                        console.log(`[MeasurementManager] Detected Placement Scale: ${this.activeScale}`);
                    }
                    // Check for template scale
                    else if (targetObj.userData.templateScale) {
                        this.activeScale = targetObj.userData.templateScale;
                        console.log(`[MeasurementManager] Detected Template Scale: ${this.activeScale}`);
                    }
                    // Check parent if needed (though usually we put userData on the mesh)
                    else if (targetObj.parent && targetObj.parent.userData.placementScale) {
                        this.activeScale = targetObj.parent.userData.placementScale;
                        console.log(`[MeasurementManager] Detected Parent Scale: ${this.activeScale}`);
                    }
                }

                if (this.activeScale !== 1.0) {
                    console.log(`[MeasurementManager] Using measurement scale: 1:${(1 / this.activeScale).toFixed(2)} (${this.activeScale})`);
                }

            } else if (this.points.length === 1) {
                if (this.points[0].distanceTo(point) < 0.001) return;
                this.points.push(point); // P2
            } else if (this.points.length === 2) {
                // Finalize P3
                const p1 = this.points[0];
                const p2 = this.points[1];
                const placement = point;

                const state = this.getDimensionState(p1, p2, placement, this.activeScale);
                const visual = this.createDimensionVisual(state, false);
                this.group.add(visual);

                this.measurements.push({
                    type: 'distance',
                    p1, p2, placement,
                    value: state.value,
                    visual,
                    // Store state metadata if needed for re-render
                    stateType: state.type,
                    scale: this.activeScale
                });
                console.log(`Distance Measured (${state.type}): ${state.value} (Scale: ${this.activeScale})`);

                // Reset
                this.points = [];
                this.clearTemp();
                this.activeScale = 1.0;
            }
        }

        // Angle Tool
        if (this.activeTool === 'angle') {
            const p = point.clone();

            // Mode A: 2-Line Selection (Priority if Object Clicked)
            const validTypes = ['LINE', 'LWPOLYLINE', 'POLYLINE'];

            if (!this.lineSelection && this.points.length === 0 && hitObject && hitObject.userData && validTypes.includes(hitObject.userData.type)) {
                // Start Line Selection Mode
                this.lineSelection = [hitObject];
                console.log("Angle: Line 1 Selected");
                return;
            }

            if (this.lineSelection && this.lineSelection.length === 1 && hitObject && hitObject.userData && validTypes.includes(hitObject.userData.type)) {
                // Line 2 Selected
                this.lineSelection.push(hitObject);
                console.log("Angle: Line 2 Selected");

                // Compute Intersection
                const l1 = this.lineSelection[0];
                const l2 = this.lineSelection[1];

                // Helper to get line points (works for THREE.Line segments)
                const getLinePts = (line) => {
                    const pos = line.geometry.attributes.position;
                    // Check if indexed? Assuming non-indexed from dxf-loader for simple lines
                    // DxfLoader uses BufferGeometry.
                    return [
                        new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)),
                        new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1))
                    ];
                };

                // We need to handle potential index access if geometry is indexed, but simple lines usually aren't.
                // Re-implementing simplified logic from original file:
                const [l1s, l1e] = getLinePts(l1);
                const [l2s, l2e] = getLinePts(l2);

                // Line Intersection 2D (Z=0 plane)
                const x1 = l1s.x, y1 = l1s.y, x2 = l1e.x, y2 = l1e.y;
                const x3 = l2s.x, y3 = l2s.y, x4 = l2e.x, y4 = l2e.y;

                const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);

                if (Math.abs(denom) > 1e-9) {
                    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
                    const ix = x1 + ua * (x2 - x1);
                    const iy = y1 + ua * (y2 - y1);
                    const intersection = new THREE.Vector3(ix, iy, 0);

                    // Setup Points: [Center, Start, End]
                    this.points.push(intersection); // Center
                    this.points.push(l1e); // Start (Use line endpoints as reference)
                    this.points.push(l2e); // End

                    // Transitioned to 3-point state. Next click is Placement.
                } else {
                    console.log("Parallel Lines - Angle 0/180");
                }

                this.lineSelection = null;
                return;
            }

            // 4-Step: Center -> Start -> End -> Placement

            if (this.points.length === 0) {
                this.points.push(p); // Center
            } else if (this.points.length === 1) {
                this.points.push(p); // Start Arm
            } else if (this.points.length === 2) {
                this.points.push(p); // End Arm
            } else if (this.points.length === 3) {
                // Finalize
                const center = this.points[0];
                const start = this.points[1];
                const end = this.points[2];
                const placement = p;

                const visual = this.createAngleVisual(center, start, end, placement, false);
                this.group.add(visual);

                // Value Calculation
                const v1 = new THREE.Vector3().subVectors(start, center);
                const v2 = new THREE.Vector3().subVectors(end, center);
                let diff = Math.atan2(v2.y, v2.x) - Math.atan2(v1.y, v1.x);
                if (diff < 0) diff += Math.PI * 2;
                const degrees = (diff * 180 / Math.PI).toFixed(1);

                this.measurements.push({
                    type: 'angle',
                    center, start, end, placement,
                    value: degrees,
                    visual
                });
                console.log(`Angle Measured: ${degrees}°`);
                this.points = [];
                this.clearTemp();
            }
        }

        // Radius & Diameter Tools
        if (this.activeTool === 'radius' || this.activeTool === 'diameter') {
            if (hitObject && hitObject.userData) {
                const type = hitObject.userData.type;
                if (type === 'CIRCLE' || type === 'ARC') {
                    const entity = hitObject.userData.entity || hitObject.userData; // Robust check
                    const center = new THREE.Vector3(entity.center.x, entity.center.y, 0);
                    const radius = entity.radius;

                    if (this.activeTool === 'radius') {
                        const visual = this.createRadiusVisual(center, radius, point, this.activeScale);
                        this.group.add(visual);
                        this.measurements.push({
                            type: 'radius',
                            value: (radius / this.activeScale).toFixed(3),
                            visual
                        });
                        console.log(`Radius Measured: ${radius}`);
                    } else {
                        const visual = this.createDiameterVisual(center, radius, point, this.activeScale);
                        this.group.add(visual);
                        this.measurements.push({
                            type: 'diameter',
                            value: (radius * 2 / this.activeScale).toFixed(3),
                            visual
                        });
                    }
                    // Reset
                    this.points = [];
                    this.clearTemp();
                } else {
                    console.log("Not a Circle/Arc");
                }
            }
        }
    }

    createRadiusVisual(center, radius, clickPoint, scale) {
        const group = new THREE.Group();
        const rVal = radius / scale;
        const text = "R" + rVal.toFixed(2);
        group.userData = { type: 'DIMENSION', value: text, isPreview: false };

        // Line from Center to Click Point (projected onto max radius if needed, but click on arc implies distance is r)
        // Actually clickPoint might be slightly off due to picking.
        // Vector Center -> Click
        const v = new THREE.Vector3().subVectors(clickPoint, center).normalize();
        const pEdge = center.clone().add(v.clone().multiplyScalar(radius));

        // Draw line Center -> Edge
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([center, pEdge]), this.lineMaterial));

        // Arrow at Edge (pointing out)
        // Standard Radius: Arrow touches arc from inside.
        // center ---->| Arc
        group.add(this.createArrow(pEdge, v, 3.0, this.lineMaterial.color));

        // Text at mid
        const mid = new THREE.Vector3().addVectors(center, pEdge).multiplyScalar(0.5);
        const textMesh = this.createTextMesh(text, 0, this.lineMaterial.color);
        textMesh.position.copy(mid);
        group.add(textMesh);

        return group;
    }

    createDiameterVisual(center, radius, clickPoint, scale) {
        const group = new THREE.Group();
        const dVal = radius * 2 / scale;
        const text = "Ø" + dVal.toFixed(2);
        group.userData = { type: 'DIMENSION', value: text, isPreview: false };

        // Vector Center -> Click
        const v = new THREE.Vector3().subVectors(clickPoint, center).normalize();

        // Full Diameter Line: Center +/- Radius*V
        const p1 = center.clone().add(v.clone().multiplyScalar(radius));
        const p2 = center.clone().sub(v.clone().multiplyScalar(radius));

        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), this.lineMaterial));

        // Arrows at both ends pointing OUT
        group.add(this.createArrow(p1, v, 3.0, this.lineMaterial.color));
        group.add(this.createArrow(p2, v.clone().negate(), 3.0, this.lineMaterial.color)); // Pointing Opposite

        // Text at Center
        const textMesh = this.createTextMesh(text, 0, this.lineMaterial.color);
        textMesh.position.copy(center);
        // Offset text slightly to not overlap line?
        textMesh.position.y += 2.0;
        group.add(textMesh);

        return group;
    }

    showAreaMeasurement(point, value) {
        const group = new THREE.Group();
        const text = "S: " + value.toFixed(2);
        group.userData = { type: 'DIMENSION', value: text, isPreview: false };

        const textMesh = this.createTextMesh(text, 0, this.lineMaterial.color);
        textMesh.position.copy(point);
        group.add(textMesh);
        this.group.add(group);

        this.measurements.push({
            type: 'area',
            value: value.toFixed(2),
            visual: group
        });
    }

    getDimensionState(p1, p2, mouse, scale = 1.0) {
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

        // Vector Mouse -> Mid
        const drag = new THREE.Vector3().subVectors(mouse, mid);

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

                // WAIT! Standard CAD:
                // Pull Up/Down -> Horizontal Dim (Dimension Line is Horizontal)
                // Pull Left/Right -> Vertical Dim (Dimension Line is Vertical)

                if (Math.abs(drag.x) > Math.abs(drag.y)) {
                    type = 'vertical';
                } else {
                    type = 'horizontal';
                }
                isAligned = false;
            }
        }

        // Calculate Geometry based on Type
        if (type === 'horizontal') {
            // Measure dx
            val = Math.abs(p2.x - p1.x) / scale;
            angle = 0;
            // Dim Line is at mouse.y
            dimP1 = new THREE.Vector3(p1.x, mouse.y, 0);
            dimP2 = new THREE.Vector3(p2.x, mouse.y, 0);

        } else if (type === 'vertical') {
            // Measure dy
            val = Math.abs(p2.y - p1.y) / scale;
            angle = Math.PI / 2;
            // Dim Line is at mouse.x
            dimP1 = new THREE.Vector3(mouse.x, p1.y, 0);
            dimP2 = new THREE.Vector3(mouse.x, p2.y, 0);

        } else {
            // Aligned
            type = 'aligned';
            val = len / scale;

            // Line through Mouse parallel to Dir
            // P_proj = P + (Mouse - P).dot(normal) * normal
            // Actually simpler:
            // Offset vector = (Mouse - P1).dot(normal) * normal
            const vM = new THREE.Vector3().subVectors(mouse, p1);
            const distPerp = vM.dot(normal);
            const offset = normal.clone().multiplyScalar(distPerp);

            dimP1 = p1.clone().add(offset);
            dimP2 = p2.clone().add(offset);

            // Angle adjustment: Text should be readable (not upside down)
            if (angle > Math.PI / 2) angle -= Math.PI;
            if (angle < -Math.PI / 2) angle += Math.PI;
        }

        // Precision Clamp
        if (val < 1e-6) val = 0;

        return {
            type,
            value: val,
            text: val.toFixed(2),
            p1, p2,
            dimP1, dimP2,
            angle
        };
    }

    createDimensionVisual(state, isPreview) {
        const group = new THREE.Group();
        group.userData = { type: 'DIMENSION', value: state.text, isPreview: isPreview };
        const material = isPreview ? this.previewMaterial : this.lineMaterial;

        const { p1, p2, dimP1, dimP2, angle, text } = state;

        // Visual Parameters (User defined)
        const arrowLen = 3.0;
        const worldScale = 5.0; // Text Scale
        // Estimate Text Width (Text aspect usually ~0.6-0.8 per char depending on font, but we have canvas logic)
        // Canvas width was measured. Here we can approximate.
        // Or better, create text mesh first and measure? 
        // We need to create text mesh anyway.

        const color = material.color;
        const textMesh = this.createTextMesh(text, angle, color);

        // Measure Text in World Space
        textMesh.geometry.computeBoundingBox();
        const textWidth = textMesh.geometry.boundingBox.max.x - textMesh.geometry.boundingBox.min.x;

        const dimLength = dimP1.distanceTo(dimP2);
        const requiredSpace = (arrowLen * 2.2) + textWidth; // 1.1x arrowLen margin per side
        //console.log(dimLength, requiredSpace);

        const isTight = dimLength < requiredSpace;

        // 1. Dimension Line
        // If tight, we might want lines extending OUTWARDS for arrows.
        // Standard: Draw line between witness lines anyway? Yes.
        const dimGeom = new THREE.BufferGeometry().setFromPoints([dimP1, dimP2]);
        const dimLine = new THREE.Line(dimGeom, material);
        if (isPreview) dimLine.computeLineDistances();
        group.add(dimLine);

        // 2. Extension Lines (Witness Lines)
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, dimP1]), material));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p2, dimP2]), material));

        // 3. Arrows
        const dir = new THREE.Vector3().subVectors(dimP2, dimP1).normalize();

        if (!isTight) {
            // --- Standard (Inside) ---
            // Arrows at endpoints, pointing OUT (standard) or IN?

            // Standard CAD Arrow: Tip at endpoint. Body inwards.
            // <---|--->  (Arrows pointing away from center)

            // Arrow 1 at DimP1: Points Left (Away from P2).
            // My createArrow(origin, dir...): 
            // Shape tip at 0,0. Rotated by Dir.
            // If Dir is "Left", Tip is at Origin, Body is Right. -> >
            // So if we want < (Tip Left, Body Right), we need Dir to be Right?
            // Wait. Shape: Tip 0,0. Body -X.
            // If rotation 0 (Right): Tip 0,0. Body Left (<). Visual: <
            // So default is Pointing Right?
            // createArrow code: angle = atan2(dir.y, dir.x).
            // If dir=(1,0) [Right]. Angle=0. Mesh rot=0. Shape body (-X) is Left of Origin. 
            // Visual:   <|  (Tip at Origin).
            // This is an arrow pointing RIGHT.

            // We want arrow at DimP1 (Left end) to point LEFT (<).
            // So we need visual <|.
            // That matches Dir=(1,0) (Right)? No.
            // If visual is <|, it "points" Right (Tip is Right).
            // We want Tip at P1, pointing Left. <----
            // So body should be to the Right of P1.
            // My shape body is -X (Left).
            // So if I rotate 180 (Dir Left -1,0):
            // Body becomes +X (Right). Tip at Origin.
            // Visual: |> (Points Left).
            // So to point Left, I need Dir Left (-1,0).

            // At DimP1 (Left): We want point Left (<). Dir = P1-P2 (Left)? No P1-P2 is usually Left if P1 is Left?
            // Let's assume P1 is Left, P2 is Right.
            // Dir (P1->P2) is Right.
            // At P1: We want < (Point Left). Need Dir Left (-Dir).
            // At P2: We want > (Point Right). Need Dir Right (+Dir).

            // Previous code: 
            // Arrow 1 (P1): negate(). -> Left. Correct.
            // Arrow 2 (P2): dir. -> Right. Correct.

            // BUT user said "flip arrows".

            // Arrows INSIDE (Standard):
            // |<-- Text -->|
            // At P1: Arrow points Right (>).
            // At P2: Arrow points Left (<).
            // This means Tip at P1, pointing P2.
            // To point Right: Dir Right (+Dir).
            // To point Left: Dir Left (-Dir).

            // My Previous Code Logic Check:
            // Arrow 1 (P1): createArrow(dimP1, dir.clone().negate() ... ) -> Points Left.
            // This creates |<--- --- >|. Arrows pointing OUT.
            // This is "Arrows Outside"? No this is "Arrows Inside pointing Out".
            // CAD usually is |<-- -->|. Tips at line ends.
            // So P1 arrow points Right. P2 arrow points Left.

            // So for Inside (Standard):
            // Arrow 1 (P1): Use +Dir (Right).
            // Arrow 2 (P2): Use -Dir (Left).

            group.add(this.createArrow(dimP1, dir.clone().negate(), arrowLen, color)); // P1: Left (<)
            group.add(this.createArrow(dimP2, dir, arrowLen, color));

        } else {

            // --- Tight (Outside) ---
            // Arrows outside the witness lines, pointing IN.
            // ->|   |<-

            // At P1: Arrow is to the Left of P1. Points Right.
            // We need to move Origin?
            // Yes, arrow is placed OUTSIDE.
            // Tip must be at P1.
            // User Preference: Arrows pointing OUTWARDS (<- ->)

            // P1 (Left): Arrow points Left (<). Use -Dir.
            // P2 (Right): Arrow points Right (>). Use +Dir.

            // P2: Right (>)
            group.add(this.createArrow(dimP1, dir, arrowLen, color));
            group.add(this.createArrow(dimP2, dir.clone().negate(), arrowLen, color));
            // Extra lines holding the arrows outside
            const extLen = arrowLen * 1.5;
            const out1 = dimP1.clone().sub(dir.clone().multiplyScalar(extLen));
            const out2 = dimP2.clone().add(dir.clone().multiplyScalar(extLen));

            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([out1, dimP1]), material));
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([dimP2, out2]), material));
        }

        // 4. Text Label
        // Position at Midpoint
        const mid = new THREE.Vector3().addVectors(dimP1, dimP2).multiplyScalar(0.5);

        // Offset
        const offsetDist = 1.5; // Gap
        const textOffset = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar(offsetDist);

        // If tight, maybe move text UP?
        // User didn't specify text move, just arrow flip.

        textMesh.position.copy(mid).add(textOffset);
        textMesh.position.z = 0.05;

        group.add(textMesh);

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
    createTextMesh(text, angle, colorVal) {
        const fontsize = 48; // Increased resolution
        const fontface = "Arial";
        const scale = 1; // high-res canvas

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Measure
        ctx.font = `Bold ${fontsize * scale}px ${fontface}`;
        const metrics = ctx.measureText(text);
        const w = metrics.width;
        const h = fontsize * scale * 1.4;

        canvas.width = w + 4; // padding
        canvas.height = h;

        // Draw (Transparent BG)
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = `Bold ${fontsize * scale}px ${fontface}`;
        ctx.fillStyle = (typeof colorVal === 'number') ? '#' + colorVal.toString(16) : colorVal;
        if (typeof colorVal === 'object') ctx.fillStyle = '#' + colorVal.getHexString();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);

        const tex = new THREE.CanvasTexture(canvas);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;

        const aspect = canvas.width / canvas.height;
        // World Scale for text height
        const worldScale = 5.0; // Increased from 0.6
        const geom = new THREE.PlaneGeometry(aspect * worldScale, worldScale);
        const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            side: THREE.DoubleSide,
            depthTest: false
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.z = angle;
        return mesh;
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

        group.userData = { type: 'DIMENSION', value: textStr, isPreview: isPreview };
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
        const textMesh = this.createTextMesh(textStr, 0, color);
        textMesh.position.copy(textPoint);
        textMesh.position.z = 0.05;
        group.add(textMesh);

        return group;
    }
}

