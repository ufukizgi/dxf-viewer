
import * as THREE from 'three';

export class SnappingManager {
    constructor(viewer) {
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.camera = viewer.camera;
        this.raycaster = new THREE.Raycaster();

        // Configuration
        this.snapDistance = 15; // in pixels
        this.activeSnap = null; // { type, point, object }
        this.enabledSnaps = {
            endpoint: true,
            midpoint: true,
            center: true,
            intersection: true,
            perpendicular: true,
            nearest: true,
            quadrant: true,
            node: true
        };

        // World plane and temp vectors for cursor positioning
        this.worldPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0
        this._cursorWorld = new THREE.Vector3();
        this._tmp = new THREE.Vector3();

        // Visuals
        this.markerGroup = new THREE.Group();
        this.scene.add(this.markerGroup);

        // Materials
        this.markerMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, depthTest: false }); // Green

        // Sticky Snap State (for Arc/Circle centers)
        this.stickySnaps = [];
    }

    findSnapPoint(pointer) {
        this.clearMarker();
        this.activeSnap = null;

        // 1. Calculate cursor world position via ray-plane intersection
        this.raycaster.setFromCamera(pointer, this.camera);

        // Get cursor world point: ray intersects z=0 plane
        const ok = this.raycaster.ray.intersectPlane(this.worldPlane, this._cursorWorld);
        if (!ok) return null;
        const cursorWorld = this._cursorWorld;

        // 2. Snap threshold: px -> world
        const worldPerPixel = this.viewer.getWorldPerPixel
            ? this.viewer.getWorldPerPixel()
            : (((this.camera.top - this.camera.bottom) / this.camera.zoom) / (this.viewer.renderer.domElement.clientHeight || 1));

        const worldThreshold = this.snapDistance * worldPerPixel;
        this.raycaster.params.Line.threshold = worldThreshold;

        // Get candidates
        const intersects = this.raycaster.intersectObjects(this.viewer.dxfGroup.children, true);

        // if (intersects.length === 0) return null; // Removed to allow sticky snap to persist in empty space

        // 3. Iterate candidates and find closest snap point
        let closestSnap = null;
        let minDistSq = Infinity;

        // Check each intersected object for snap points
        // Limit to first few intersections for performance
        const checkCount = Math.min(intersects.length, 5);

        for (let i = 0; i < checkCount; i++) {
            const hit = intersects[i];
            const object = hit.object;
            const points = this.calculateObjectSnapPoints(object, cursorWorld);

            for (const pt of points) {
                // Check if type enabled
                if (!this.enabledSnaps[pt.type]) continue;

                // Distance from cursor world pos to snap point
                const dSq = cursorWorld.distanceToSquared(pt.point);

                // Check if within screen-space threshold (converted to world)
                if (dSq < (worldThreshold * worldThreshold)) {
                    if (dSq < minDistSq) {
                        minDistSq = dSq;
                        closestSnap = {
                            type: pt.type,
                            point: pt.point,
                            object: object
                        };
                    }
                }
            }
        }

        // Fallback: If no snap found but mouse is on a circle/arc/polyline-arc, snap to center
        if (!closestSnap && intersects.length > 0 && this.enabledSnaps.center) {
            for (let i = 0; i < checkCount; i++) {
                const hit = intersects[i];
                const object = hit.object;
                const entity = object.userData.entity;

                // Helper to convert to world coords
                const toWorld = (x, y, z = 0) => {
                    this._tmp.set(x, y, z);
                    return this._tmp.clone().applyMatrix4(object.matrixWorld);
                };

                // Check if it's a circle or arc
                if (entity && (entity.type === 'CIRCLE' || entity.type === 'ARC') && entity.center) {
                    closestSnap = {
                        type: 'center',
                        point: toWorld(entity.center.x, entity.center.y, entity.center.z || 0),
                        object: object
                    };
                    break;
                }

                // Check if it's a polyline with bulge arcs
                if (entity && (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices) {
                    // Find the arc segment closest to the cursor
                    let closestArc = null;
                    let minDist = Infinity;

                    const cursorLocal = cursorWorld ? object.worldToLocal(cursorWorld.clone()) : null;

                    for (let j = 0; j < entity.vertices.length - 1; j++) {
                        const v1 = entity.vertices[j];
                        const v2 = entity.vertices[j + 1];

                        if (v1.bulge && cursorLocal) {
                            const arc = this.calculateBulgeArcData(v1, v2, v1.bulge);
                            if (arc) {
                                // Distance from cursor to arc center
                                const dx = cursorLocal.x - arc.center.x;
                                const dy = cursorLocal.y - arc.center.y;
                                const dist = Math.sqrt(dx * dx + dy * dy);

                                // Check if cursor is roughly at the arc's radius (on the arc)
                                const radiusDiff = Math.abs(dist - arc.radius);

                                if (radiusDiff < minDist) {
                                    minDist = radiusDiff;
                                    closestArc = arc;
                                }
                            }
                        }
                    }

                    if (closestArc) {
                        closestSnap = {
                            type: 'center',
                            point: toWorld(closestArc.center.x, closestArc.center.y, 0),
                            object: object
                        };
                        break;
                    }
                }
            }
        }

        if (closestSnap) {
            // Sticky Logic: If it's a center snap, add to sticky list
            if (closestSnap.type === 'center') {
                // Deduplicate based on Object ID
                const exists = this.stickySnaps.some(s => s.object.id === closestSnap.object.id);
                if (!exists) {
                    this.stickySnaps.push(closestSnap);
                }
            }
        }

        // Draw Markers for ALL Sticky Snaps
        this.stickySnaps.forEach(snap => {
            this.drawSnapMarker(snap);
        });

        // Determine functionality and draw primary snap
        if (closestSnap) {
            this.activeSnap = closestSnap;
            // Draw closest snap if it's NOT in the sticky list (to avoid double drawing / visual clash)
            // Or just draw it if it's different.
            // Simple check: same type and very close position
            let alreadyDrawn = false;
            for (const s of this.stickySnaps) {
                if (s.type === closestSnap.type && s.point.distanceTo(closestSnap.point) < 0.001) {
                    alreadyDrawn = true;
                    break;
                }
            }

            if (!alreadyDrawn) {
                this.drawSnapMarker(closestSnap);
            }
        } else if (this.stickySnaps.length > 0) {
            // No new snap found -> Fallback to closest sticky
            // Find closest sticky to cursor in screen space or world space? 
            // World space is cleaner.

            let bestSticky = null;
            let bestDistSq = Infinity;

            this.stickySnaps.forEach(snap => {
                const dSq = cursorWorld.distanceToSquared(snap.point);
                if (dSq < bestDistSq) {
                    bestDistSq = dSq;
                    bestSticky = snap;
                }
            });

            if (bestSticky && bestDistSq < (worldThreshold * worldThreshold)) {
                this.activeSnap = bestSticky;
            }
        }

        return this.activeSnap;
    }

    calculateObjectSnapPoints(object, cursorWorld = null) {
        const snaps = [];
        const entity = object.userData.entity;
        if (!entity) return snaps;

        // Helper to convert local coords to world coords (for blocks/inserts)
        const toWorld = (x, y, z = 0) => {
            this._tmp.set(x, y, z);
            return this._tmp.clone().applyMatrix4(object.matrixWorld);
        };

        // Convert cursor to local space for nearest point calculations
        const cursorLocal = cursorWorld ? object.worldToLocal(cursorWorld.clone()) : null;

        // Extract geometry based on type
        switch (entity.type) {
            case 'LINE':
                // Standardize: Look for startPoint/endPoint first (dxf-json)
                if (entity.startPoint && entity.endPoint) {
                    snaps.push({ type: 'endpoint', point: toWorld(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z ?? 0) });
                    snaps.push({ type: 'endpoint', point: toWorld(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z ?? 0) });
                    snaps.push({
                        type: 'midpoint',
                        point: toWorld(
                            (entity.startPoint.x + entity.endPoint.x) / 2,
                            (entity.startPoint.y + entity.endPoint.y) / 2,
                            ((entity.startPoint.z ?? 0) + (entity.endPoint.z ?? 0)) / 2
                        )
                    });
                } else if (entity.vertices) {
                    // Fallback for older parser or Polyline segments treated as Lines
                    snaps.push({ type: 'endpoint', point: toWorld(entity.vertices[0].x, entity.vertices[0].y, 0) });
                    snaps.push({ type: 'endpoint', point: toWorld(entity.vertices[1].x, entity.vertices[1].y, 0) });
                    snaps.push({
                        type: 'midpoint',
                        point: toWorld(
                            (entity.vertices[0].x + entity.vertices[1].x) / 2,
                            (entity.vertices[0].y + entity.vertices[1].y) / 2,
                            0
                        )
                    });
                }
                break;

            case 'LWPOLYLINE':
            case 'POLYLINE':
                if (entity.vertices) {
                    entity.vertices.forEach(v => {
                        snaps.push({ type: 'endpoint', point: toWorld(v.x, v.y, v.z || 0) });
                    });

                    const isClosed = entity.closed || (entity.flag & 1) === 1;
                    const len = entity.vertices.length;
                    const count = isClosed ? len : len - 1;

                    // Helper functions for arc angle checks
                    const TAU = Math.PI * 2;
                    const norm = (a) => (a % TAU + TAU) % TAU;

                    // CCW interval test (inclusive)
                    const isOnArcCCW = (a, s, e) => {
                        a = norm(a); s = norm(s); e = norm(e);
                        if (e < s) e += TAU;
                        if (a < s) a += TAU;
                        return a >= s - 1e-9 && a <= e + 1e-9;
                    };

                    // General: ccw -> [s->e], cw -> [e->s] CCW-wise
                    const isOnArc = (a, arc) => {
                        return arc.ccw ? isOnArcCCW(a, arc.startAngle, arc.endAngle)
                            : isOnArcCCW(a, arc.endAngle, arc.startAngle);
                    };

                    for (let i = 0; i < count; i++) {
                        const v1 = entity.vertices[i];
                        const v2 = entity.vertices[(i + 1) % len];

                        // Bulge arc handling
                        if (v1.bulge) {
                            const arc = this.calculateBulgeArcData(v1, v2, v1.bulge);
                            if (arc) {
                                // Center
                                snaps.push({ type: 'center', point: toWorld(arc.center.x, arc.center.y, 0) });

                                // Midpoint = arc midpoint (not chord midpoint)
                                const midAngle = arc.ccw
                                    ? arc.startAngle + arc.sweep / 2
                                    : arc.startAngle - arc.sweep / 2;

                                const mx = arc.center.x + arc.radius * Math.cos(midAngle);
                                const my = arc.center.y + arc.radius * Math.sin(midAngle);
                                snaps.push({ type: 'midpoint', point: toWorld(mx, my, 0) });

                                // Quadrants only if they lie on this arc span
                                const quads = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
                                for (const qa of quads) {
                                    if (!isOnArc(qa, arc)) continue;
                                    const qx = arc.center.x + arc.radius * Math.cos(qa);
                                    const qy = arc.center.y + arc.radius * Math.sin(qa);
                                    snaps.push({ type: 'quadrant', point: toWorld(qx, qy, 0) });
                                }
                            }
                        } else {
                            // No bulge - straight segment: chord midpoint
                            snaps.push({
                                type: 'midpoint',
                                point: toWorld((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, 0)
                            });
                        }
                    }
                }
                break;

            case 'CIRCLE':
            case 'ARC':
                if (entity.center) {
                    snaps.push({ type: 'center', point: toWorld(entity.center.x, entity.center.y, entity.center.z || 0) });
                }

                // Quadrants (0, 90, 180, 270)
                const center = entity.center;
                const radius = entity.radius;
                const quads = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

                quads.forEach(angle => {
                    let valid = true;
                    if (entity.type === 'ARC') {
                        // Normalize Start/End
                        let s = entity.startAngle * Math.PI / 180;
                        let e = entity.endAngle * Math.PI / 180;
                        while (s < 0) s += Math.PI * 2;
                        while (e <= s) e += Math.PI * 2;
                        let testA = angle;
                        while (testA < s) testA += Math.PI * 2;
                        // If testA is within [s, e], keep it. 
                        // Note: Quadrants might be outside arc span. 
                        // Allow tolerating wrap-around logic better or simplified:
                        // Simple check: Is point on arc?
                    }
                    // For now, enable all quadrants for Circle. Arc logic can be refined if needed.
                    if (entity.type === 'CIRCLE' || valid) {
                        snaps.push({
                            type: 'quadrant',
                            point: toWorld(
                                center.x + radius * Math.cos(angle),
                                center.y + radius * Math.sin(angle),
                                center.z || 0
                            )
                        });
                    }
                });

                // Endpoints for Arc
                if (entity.type === 'ARC') {
                    // Angles are likely in DEGREES in raw entity data from dxf-json.
                    const startRad = (entity.startAngle * Math.PI) / 180;
                    const endRad = (entity.endAngle * Math.PI) / 180;

                    const startX = entity.center.x + entity.radius * Math.cos(startRad);
                    const startY = entity.center.y + entity.radius * Math.sin(startRad);
                    snaps.push({ type: 'endpoint', point: toWorld(startX, startY, entity.center.z || 0) });

                    const endX = entity.center.x + entity.radius * Math.cos(endRad);
                    const endY = entity.center.y + entity.radius * Math.sin(endRad);
                    snaps.push({ type: 'endpoint', point: toWorld(endX, endY, entity.center.z || 0) });
                }
                break;
        }

        return snaps;
    }

    drawSnapMarker(snap) {
        // Size in pixels (constant screen size)
        const sizePx = 10;
        const worldPerPixel = this.viewer.getWorldPerPixel
            ? this.viewer.getWorldPerPixel()
            : (((this.camera.top - this.camera.bottom) / this.camera.zoom) / (this.viewer.renderer.domElement.clientHeight || 1));
        const size = sizePx * worldPerPixel;

        let geometry;

        if (snap.type === 'endpoint') {
            // Square
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0)); // Close
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'midpoint') {
            // Triangle
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(0, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'center') {
            // Circle (using low res polygon)
            const pts = [];
            for (let i = 0; i <= 16; i++) {
                const a = (i / 16) * Math.PI * 2;
                pts.push(new THREE.Vector3(Math.cos(a) * size / 2, Math.sin(a) * size / 2, 0));
            }
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (snap.type === 'quadrant') {
            // Diamond
            const pts = [];
            pts.push(new THREE.Vector3(0, size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, 0, 0));
            pts.push(new THREE.Vector3(0, -size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, 0, 0));
            pts.push(new THREE.Vector3(0, size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        } else {
            // Default: Intersection / Perpendicular / Nearest -> X Cross
            // To avoid NaN, we use LineSegments logic implies pairs.
            // But we are using THREE.Line (strip).
            // So we draw a Hourglass shape that looks like X? 
            // Or just a Box with X? 
            // Let's just use a Square with Cross (Envelope) or just a simple Square for now to be safe.
            // Or just the X using 5 points: TopLeft -> BottomRight -> ... cant do disjoint X with LineStrip.
            // I'll use a small Circle/Box for default to be safe.
            // Actually, "Intersection" is X usually. Use 'LineSegments' instead of 'Line' for the marker?
            // I'll make the default Geometry a "Plus" (+) which can be done as:
            // Left -> Right, then ... need jump.
            // I will return a Loop (Square) for safety.
            const pts = [];
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, -size / 2, 0));
            pts.push(new THREE.Vector3(size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, size / 2, 0));
            pts.push(new THREE.Vector3(-size / 2, -size / 2, 0));
            geometry = new THREE.BufferGeometry().setFromPoints(pts);
        }

        const marker = new THREE.Line(geometry, this.markerMaterial);
        marker.position.copy(snap.point);
        // Ensure marker is always on top?
        marker.renderOrder = 999;

        this.markerGroup.add(marker);
    }

    clearMarker() {
        while (this.markerGroup.children.length > 0) {
            const c = this.markerGroup.children[0];
            if (c.geometry) c.geometry.dispose();
            this.markerGroup.remove(c);
        }
    }

    clearSticky() {
        this.stickySnaps = [];
        this.activeSnap = null;
        this.clearMarker();
    }

    calculateBulgeCenter(p1, p2, bulge) {
        if (!bulge) return null;
        const chordX = p2.x - p1.x;
        const chordY = p2.y - p1.y;
        const chordLen = Math.sqrt(chordX * chordX + chordY * chordY);
        if (chordLen < 1e-9) return null;

        const theta = 4 * Math.atan(bulge);
        const radius = chordLen / (2 * Math.sin(theta / 2));

        // Vector from Midpoint to Center
        // Midpoint
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        // Normal vector (-dy, dx)
        const nx = -chordY;
        const ny = chordX;

        // Distance from chord to center (sagitta related)
        // radius^2 = (chord/2)^2 + d^2
        // d = sqrt(r^2 - (c/2)^2)
        // Sign depends on bulge sign?
        // Actually, algebraic formula from bulges:
        // offset = (1 - bulge^2) / (4 * bulge) * chordLen? No.
        // offset vector factor 'f' from midpoint:
        // f = (1 - b^2) / (4*b)

        const f = (1 - bulge * bulge) / (4 * bulge);

        const cx = mx + nx * f;
        const cy = my + ny * f;

        return { x: cx, y: cy };
    }

    calculateBulgeArcData(p1, p2, bulge) {
        if (!bulge) return null;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const chordLen = Math.sqrt(dx * dx + dy * dy);
        if (chordLen < 1e-9) return null;

        const theta = 4 * Math.atan(bulge);            // signed included angle
        const r = chordLen / (2 * Math.sin(theta / 2)); // signed radius

        // Midpoint
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        // Perp vector (NOT normalized is OK with f)
        const nx = -dy;
        const ny = dx;

        const f = (1 - bulge * bulge) / (4 * bulge);

        const cx = mx + nx * f;
        const cy = my + ny * f;

        // Start/End angles (local space)
        const startAngle = Math.atan2(p1.y - cy, p1.x - cx);
        const endAngle = Math.atan2(p2.y - cy, p2.x - cx);

        const TAU = Math.PI * 2;
        const norm = (a) => {
            a = a % TAU;
            return a < 0 ? a + TAU : a;
        };

        const s = norm(startAngle);
        const e = norm(endAngle);

        const ccw = bulge > 0;

        // Sweep in chosen direction
        let sweep;
        if (ccw) {
            sweep = e - s;
            if (sweep < 0) sweep += TAU;
        } else {
            sweep = s - e;
            if (sweep < 0) sweep += TAU;
        }

        return {
            center: { x: cx, y: cy },
            radius: Math.abs(r),
            startAngle: s,
            endAngle: e,
            ccw,
            sweep
        };
    }
}
