import * as THREE from 'three';
import { DxfParser } from 'dxf-parser'; // importmap'te 'dxf-json' -> 'dxf-parser'

export class DxfLoader {
    constructor() {
        this.parser = new DxfParser();
        this.font = null;
    }

    async load(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const arrayBuffer = e.target.result;

                    // Try Windows-1254 (Turkish) encoding first
                    let dxfString;
                    try {
                        const decoder = new TextDecoder('windows-1254');
                        dxfString = decoder.decode(arrayBuffer);
                    } catch (err) {
                        // Fallback to UTF-8 if Windows-1254 not supported
                        console.warn('Windows-1254 not supported, using UTF-8:', err);
                        const decoder = new TextDecoder('utf-8');
                        dxfString = decoder.decode(arrayBuffer);
                    }

                    const dxf = this.parser.parseSync(dxfString);
                    resolve(dxf);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (err) => reject(err);
            reader.readAsArrayBuffer(file);
        });
    }

    // ------------------------------------------------------------
    // SAHNE ÜRETİMİ
    // ------------------------------------------------------------
    generateThreeEntities(dxf) {
        const group = new THREE.Group();
        if (!dxf || !dxf.entities) return group;

        // DEBUG: Log all entity types from parser
        const entityTypes = {};
        for (const entity of dxf.entities) {
            entityTypes[entity.type] = (entityTypes[entity.type] || 0) + 1;
            // Log MTEXT specifically
            if (entity.type === 'MTEXT' || entity.type === 'TEXT') {
                console.log(`🔤 DXF Parser found ${entity.type}:`, entity.text, entity);
            }
        }
        console.log('📊 DXF Entity types from parser:', entityTypes);

        // Store blocks for INSERT references
        this.blocks = dxf.blocks || {};
        // console.log('📦 Blocks available:', Object.keys(this.blocks));

        for (const entity of dxf.entities) {
            try {
                const object = this.convertEntity(entity, dxf);
                if (object) group.add(object);
            } catch (err) {
                console.warn('Failed to convert entity:', entity, err);
            }
        }
        return group;
    }

    convertEntity(entity, dxf) {
        // Debug TEXT/MTEXT
        if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
            // console.log('🔤 Found text entity:', entity.type, entity);
        }

        const color = this.getColor(entity, dxf);
        const material = this.createMaterial(entity, dxf, color);

        let object = null;

        switch (entity.type) {
            case 'HATCH':
                object = this.createHatch(entity, material); break;
            case 'LINE':
                object = this.createLine(entity, material); break;
            case 'LWPOLYLINE':
            case 'POLYLINE':
                object = this.createPolyline(entity, material); break;
            case 'CIRCLE':
            case 'ARC':
                object = this.createArc(entity, material); break;
            case 'SPLINE':
                object = this.createSpline(entity, material); break;
            case 'ELLIPSE':
                object = this.createEllipse(entity, material); break;
            case 'SOLID':
            case '3DFACE':
                object = this.createSolid(entity, color); break;
            case 'HATCH':
                object = this.createHatch(entity, material); break;
            case 'MTEXT':
                console.log('[convertEntity] Processing MTEXT:', entity.text);
                object = this.createMText(entity, color);
                console.log('[convertEntity] MTEXT result:', object);
                break;
            case 'TEXT':
                object = this.createText(entity, color); break;
            case 'INSERT':
                object = this.createInsert(entity, dxf); break;
            case 'DIMENSION':
                object = this.createDimension(entity, color, dxf); break;
            default:
                return null;
        }

        if (object) {
            const applyDashed = (obj, label) => {
                if (!obj) return;
                if (obj.material?.type !== 'LineDashedMaterial') return;

                // ✅ Doğrusu: computeLineDistances Line/LineSegments üzerinde
                if (typeof obj.computeLineDistances === 'function') {
                    obj.computeLineDistances();
                    // console.log(`📐 computeLineDistances() called for ${label}`);
                } else {
                    console.warn(`⚠️ Cannot compute line distances for ${label} (type=${obj.type})`);
                }
            };

            // Tek obje ise
            applyDashed(object, entity.type);

            // Grup ise içindeki line'lara da uygula
            if (object.type === 'Group') {
                object.traverse((child) => applyDashed(child, `${entity.type}/${child.userData?.type || child.type}`));
            }

            object.userData = {
                type: entity.type,
                layer: entity.layer,
                handle: entity.handle,
                entity
            };
        }

        return object;
    }
    // ---- Scanline (hatch line) clipping: vertex-safe ----
    clipScanlineToPolygon(origin, dir, nrm, outer, holes, eps) {
        // 1) outer aralıkları
        const outerIntervals = this.scanlineIntervalsForPoly(origin, dir, nrm, outer, eps);
        if (outerIntervals.length === 0) return [];

        // 2) hole aralıkları
        let holeIntervals = [];
        for (const h of holes) {
            const hi = this.scanlineIntervalsForPoly(origin, dir, nrm, h, eps);
            if (hi.length) holeIntervals.push(...hi);
        }
        if (holeIntervals.length) {
            holeIntervals.sort((a, b) => a[0] - b[0]);
            holeIntervals = this.mergeIntervals(holeIntervals, eps);
        }

        // 3) outer - holes
        const finalIntervals = holeIntervals.length
            ? this.subtractIntervals(outerIntervals, holeIntervals, eps)
            : outerIntervals;

        // 4) interval -> segment
        const segs = [];
        for (const [s0, s1] of finalIntervals) {
            if (s1 - s0 <= eps) continue;
            const a = origin.clone().add(dir.clone().multiplyScalar(s0));
            const b = origin.clone().add(dir.clone().multiplyScalar(s1));
            segs.push({ a, b });
        }
        return segs;
    }

    // origin + dir*s hattının poly ile kesişimlerinden interval üretir (even-odd)
    // vertex-safe kural: d aralığı (min, max] şeklinde alınır (double count engeller)
    scanlineIntervalsForPoly(origin, dir, nrm, poly, eps) {
        const d = origin.dot(nrm); // scanline sabiti: p·nrm = d
        const sHits = [];

        for (let i = 0; i < poly.length; i++) {
            const p = poly[i];
            const q = poly[(i + 1) % poly.length];

            const d1 = p.dot(nrm);
            const d2 = q.dot(nrm);

            // edge scanline'a paralel → skip
            if (Math.abs(d1 - d2) < eps) continue;

            // Half-open kuralı: (d1 < d && d2 >= d) || (d2 < d && d1 >= d)
            // Bu, köşeyi iki kere saymayı engeller.
            const cond = (d1 < d && d2 >= d) || (d2 < d && d1 >= d);
            if (!cond) continue;

            const t = (d - d1) / (d2 - d1); // 0..1 arası
            if (t < -1e-6 || t > 1 + 1e-6) continue;

            const hit = new THREE.Vector2(
                p.x + (q.x - p.x) * t,
                p.y + (q.y - p.y) * t
            );

            // s param: hit = origin + dir*s  (dir unit)
            const s = hit.clone().sub(origin).dot(dir);
            sHits.push(s);
        }

        if (sHits.length < 2) return [];

        sHits.sort((a, b) => a - b);

        const merged = this.mergeSortedScalars(sHits, eps);
        if (merged.length < 2) return [];

        // even-odd pairing: [0-1], [2-3], ...
        const intervals = [];
        for (let i = 0; i + 1 < merged.length; i += 2) {
            const a = merged[i], b = merged[i + 1];
            if (b - a > eps) intervals.push([a, b]);
        }
        return intervals;
    }

    mergeSortedScalars(vals, eps) {
        const out = [];
        for (const v of vals) {
            if (out.length === 0 || Math.abs(v - out[out.length - 1]) > eps) out.push(v);
        }
        return out;
    }

    mergeIntervals(intervals, eps) {
        if (!intervals.length) return [];
        const out = [intervals[0].slice()];
        for (let i = 1; i < intervals.length; i++) {
            const [a, b] = intervals[i];
            const last = out[out.length - 1];
            if (a <= last[1] + eps) last[1] = Math.max(last[1], b);
            else out.push([a, b]);
        }
        return out;
    }

    subtractIntervals(outers, holes, eps) {
        const out = [];
        let j = 0;

        for (const [A, B] of outers) {
            let curA = A;

            while (j < holes.length && holes[j][1] <= curA + eps) j++;

            let k = j;
            while (k < holes.length && holes[k][0] < B - eps) {
                const [hA, hB] = holes[k];

                if (hA > curA + eps) out.push([curA, Math.min(hA, B)]);
                curA = Math.max(curA, hB);

                if (curA >= B - eps) break;
                k++;
            }

            if (curA < B - eps) out.push([curA, B]);
        }

        return out;
    }

    // ------------------------------------------------------------
    // PRİMİTİFLER
    // ------------------------------------------------------------
    createLine(entity, material) {
        if (!entity.startPoint || !entity.endPoint) return null;

        const points = [
            new THREE.Vector3(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z || 0),
            new THREE.Vector3(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z || 0)
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, material);
    }

    createPolyline(entity, material) {
        if (!entity.vertices || entity.vertices.length < 2) return null;

        const group = new THREE.Group();
        // Preserve entity metadata on the Group (Parent)
        group.userData = { entity: entity, type: entity.type };

        const verts = entity.vertices;
        const isClosed = (entity.flag & 1) === 1 || entity.closed === true;

        const n = verts.length;
        const segCount = isClosed ? n : (n - 1);

        for (let i = 0; i < segCount; i++) {
            const v1 = verts[i];
            const v2 = verts[(i + 1) % n];
            let segment = null;

            if (v1.bulge) {
                const arcPts = this.getBulgePoints(v1, v2, v1.bulge);
                const points = arcPts.map(p => new THREE.Vector3(p.x, p.y, v1.z || 0));
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                segment = new THREE.Line(geometry, material);
                // Mark as ARC? Or keep as LWPOLYLINE?
                // Angle tool expects 'LINE', 'LWPOLYLINE', 'POLYLINE'.
                // If we set 'ARC', Angle tool ignores it (intended for now as it handles lines).
                segment.userData = { type: 'ARC', entity: entity, parentType: entity.type };
            } else {
                const p1 = new THREE.Vector3(v1.x, v1.y, v1.z || 0);
                const p2 = new THREE.Vector3(v2.x, v2.y, v2.z || 0); // v2 z might be same or different? usually flat.
                const geometry = new THREE.BufferGeometry().setFromPoints([p1, p2]);
                segment = new THREE.Line(geometry, material);
                // Mark as LINE to allow Angle Tool selection
                segment.userData = { type: 'LINE', entity: entity, parentType: entity.type };
            }

            if (segment) group.add(segment);
        }

        return group;
    }

    createArc(entity, material) {
        let startAngle = 0;
        let endAngle = Math.PI * 2;

        if (entity.type === 'ARC') {
            startAngle = (entity.startAngle * Math.PI) / 180;
            endAngle = (entity.endAngle * Math.PI) / 180;
        }

        const curve = new THREE.EllipseCurve(
            entity.center.x, entity.center.y,
            entity.radius, entity.radius,
            startAngle, endAngle,
            false,
            0
        );

        const points = curve.getPoints(64);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, material);
    }

    createSpline(entity, material) {
        if (!entity.controlPoints) return null;
        const points = entity.controlPoints.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));
        const curve = new THREE.CatmullRomCurve3(points);
        const renderPoints = curve.getPoints(points.length * 8);
        const geometry = new THREE.BufferGeometry().setFromPoints(renderPoints);
        return new THREE.Line(geometry, material);
    }

    createEllipse(entity, material) {
        const ax = entity.majorAxisEndPoint.x;
        const ay = entity.majorAxisEndPoint.y;
        const majorRadius = Math.sqrt(ax * ax + ay * ay);
        const minorRadius = majorRadius * entity.axisRatio;
        const rotation = Math.atan2(ay, ax);

        const curve = new THREE.EllipseCurve(
            entity.center.x, entity.center.y,
            majorRadius, minorRadius,
            entity.startParam || 0, entity.endParam || Math.PI * 2,
            false,
            rotation
        );

        const points = curve.getPoints(96);
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        return new THREE.Line(geometry, material);
    }

    createSolid(entity, color) {
        let p = entity.points;
        if (!p && entity.vtx0) p = [entity.vtx0, entity.vtx1, entity.vtx2, entity.vtx3];
        if (!p) return null;

        const points = p.map(v => new THREE.Vector3(v.x, v.y, v.z || 0));

        if (points.length === 4) {
            const tmp = points[2];
            points[2] = points[3];
            points[3] = tmp;
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        let indices = [0, 1, 2];
        if (points.length === 4) indices = [0, 1, 2, 0, 2, 3];
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
        return new THREE.Mesh(geometry, mat);
    }

    // ------------------------------------------------------------
    // TEXT / MTEXT
    // ------------------------------------------------------------
    createText(entity, color) {
        if (!entity.text) return null;

        // Basic TEXT properties
        const textVal = entity.text;
        const height = entity.height || 10;
        const rotation = (entity.rotation || 0) * Math.PI / 180;

        // Alignment handling (basic)
        // DXF has horizontalJustification / verticalJustification or 72/73 codes
        // We settle for centered or default left logic for now, or just pass to texture generator

        return this.generateTextLabel(textVal, height, rotation, entity.startPoint, color);
    }

    createMText(entity, color) {
        if (!entity.text) return null;

        let raw = entity.text;

        // Decode DXF Unicode escape sequences like \U+00C7 -> Ç
        raw = raw.replace(/\\U\+([0-9A-Fa-f]{4})/g, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });

        // Strip MTEXT formatting codes
        let clean = raw.replace(/\\P/g, ' ').replace(/\\L/g, '').replace(/\\O/g, '');
        clean = clean.replace(/^{|}$/g, '');
        clean = clean.replace(/\\[A-Za-z][^;]*;/g, '');

        const height = entity.height || 10;
        let rotation = 0;
        if (entity.rotation) {
            rotation = entity.rotation * Math.PI / 180;
        } else if (entity.directionVector) {
            rotation = Math.atan2(entity.directionVector.y, entity.directionVector.x);
        } else if (entity.xAxisX !== undefined) {
            rotation = Math.atan2(entity.xAxisY, entity.xAxisX);
        }

        const position = entity.insertionPoint || entity.insertPoint || entity.position;
        if (!position) return null;

        const mesh = this.generateTextLabel(clean, height, rotation, position, color);

        // Store original text for placeholder replacement
        if (mesh) {
            mesh.userData.originalText = clean;
        }

        return mesh;
    }

    generateTextLabel(text, height, rotation, position, colorVal) {
        // Create canvas texture
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Resolution multiplier for sharp text
        const resMult = 4;
        const fontSizePx = 80;

        ctx.font = `Bold ${fontSizePx}px Arial`;
        const metrics = ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = fontSizePx * 1.4; // rough estimate

        canvas.width = textWidth + 20; // Padding
        canvas.height = textHeight;

        // Transparent BG
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.font = `Bold ${fontSizePx}px Arial`;

        // Color
        if (typeof colorVal === 'number') {
            ctx.fillStyle = '#' + new THREE.Color(colorVal).getHexString();
        } else if (colorVal && colorVal.isColor) {
            ctx.fillStyle = '#' + colorVal.getHexString();
        } else {
            ctx.fillStyle = '#FFFFFF';
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 10, canvas.height / 2); // 10px padding left

        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;

        // Aspect Ratio
        const aspect = canvas.width / canvas.height;

        // World Size
        // Height is world-space. Width = Height * aspect.
        const w = height * aspect;
        const h = height;

        const geom = new THREE.PlaneGeometry(w, h);
        const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(geom, mat);

        // Position
        // DXF InsertPoint is usually Bottom-Left (for Text) or Top-Left/Center (for MText depending on justification).
        // Our Plane origin is Center.
        // We need to offset?
        // Let's assume InsertPoint corresponds to Center-Left vertical middle?
        // For simple viewer, centering on InsertPoint or slightly offset is acceptable.
        // To align Left-Middle:
        // Mesh Center is at (0,0). Left edge is at -w/2.
        // We want Left Edge at 0. So shift X by +w/2.

        // Apply offset in geometry to make rotation easier?
        geom.translate(w / 2, 0, 0); // Origin is now Left-Middle

        if (position) {
            mesh.position.set(position.x, position.y, position.z || 0.1);
        }

        mesh.rotation.z = rotation;

        return mesh;
    }

    // ------------------------------------------------------------
    // HATCH
    // ------------------------------------------------------------
    createHatch(entity, material) {
        if (!entity.boundaryPaths) return null;

        // eps: DXF pixelSize varsa ona göre
        const eps = Math.max(1e-3, (entity.pixelSize ?? 0.5) * 0.25);

        // 1) Loopları topla
        const loops = [];
        for (const loop of entity.boundaryPaths) {
            const pts = this.hatchLoopToPoints(loop, eps);
            if (pts && pts.length >= 3) {
                const area = this.signedArea(pts);
                loops.push({ pts, area, abs: Math.abs(area) });
            }
        }
        if (loops.length === 0) return null;

        // 2) Büyükten küçüğe sırala ve nesting depth ata
        loops.sort((a, b) => b.abs - a.abs);
        this.assignNestingDepth(loops);

        const hatchStyle = entity.hatchStyle ?? 1; // 0=normal, 1=outermost, 2=ignore
        const isSolid = entity.solidFill === 1 || entity.patternName === 'SOLID';

        // 3) Outer = depth 0 olan en büyük loop
        const outerLoop = loops.find(l => l.depth === 0) || loops[0];
        let outerPts = outerLoop.pts;

        // Outer CCW olsun (Three.Shape için)
        if (THREE.ShapeUtils.isClockWise(outerPts)) outerPts = [...outerPts].reverse();
        outerPts = this.cleanupLoopPoints(outerPts, eps);
        if (!outerPts || outerPts.length < 3) return null;

        const shape = new THREE.Shape(outerPts);

        // 4) Holes seçimi (kritik!)
        let holeLoops = [];
        if (hatchStyle === 2) {
            holeLoops = []; // ignore
        } else if (hatchStyle === 1) {
            // outermost: sadece depth==1 hole
            holeLoops = loops.filter(l => l.depth === 1);
        } else {
            // normal: odd depth hole kabul
            holeLoops = loops.filter(l => (l.depth % 2) === 1);
        }

        for (const h of holeLoops) {
            let holePts = h.pts;

            // hole CW olsun
            if (!THREE.ShapeUtils.isClockWise(holePts)) holePts = [...holePts].reverse();
            holePts = this.cleanupLoopPoints(holePts, eps);
            if (!holePts || holePts.length < 3) continue;
            if (!THREE.ShapeUtils.isClockWise(holePts)) holePts = [...holePts].reverse();

            shape.holes.push(new THREE.Path(holePts));
        }

        // SOLID wedge debug
        // console.log('Hatch holes:', shape.holes.length, 'style:', hatchStyle, 'solid:', isSolid);

        // 5) ShapeGeometry
        const geometry = new THREE.ShapeGeometry(shape, 64);

        const baseParams = {
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
        };

        // 6) Pattern hatch (definitionLines varsa)
        if (!isSolid && entity.definitionLines?.length) {
            // İstersen çok hafif bir doldurma açabilirsin (şimdilik kapalı)
            // const fillMat = new THREE.MeshBasicMaterial({ ...baseParams, color: material.color, opacity: 0.08 });
            // const fillMesh = new THREE.Mesh(geometry.clone(), fillMat);
            // fillMesh.renderOrder = 0;

            const hatchLines = this.createHatchPatternLines(entity, outerPts, shape.holes, material.color);
            hatchLines.renderOrder = -10;
            hatchLines.position.z = -0.05;

            // hatch çizgileri “z” ve depth ile saçmalamasın
            if (hatchLines.material) {
                hatchLines.material.depthTest = false;
            }

            const g = new THREE.Group();
            // g.add(fillMesh);
            g.add(hatchLines);
            return g;
        }

        // 7) SOLID veya pattern datası yoksa: sade dolgu
        const meshMaterial = new THREE.MeshBasicMaterial({
            ...baseParams,
            color: material.color,
            opacity: 0.55,
        });

        const mesh = new THREE.Mesh(geometry, meshMaterial);
        mesh.renderOrder = -10;
        return mesh;
    }

    // Pattern hatch çizgileri: definitionLines + dashLengths
    createHatchPatternLines(entity, outerPoly, holePaths, color) {
        const holes = holePaths.map(h => h.getPoints());
        const bb = this.computeBBox(outerPoly);

        const diag = Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
        const L = diag * 2;

        const positions = [];
        const scale = entity.patternScale ?? 1;

        const eps = Math.max(1e-6, (entity.pixelSize ?? 0.5) * 0.05);

        const corners = [
            new THREE.Vector2(bb.min.x, bb.min.y),
            new THREE.Vector2(bb.max.x, bb.min.y),
            new THREE.Vector2(bb.max.x, bb.max.y),
            new THREE.Vector2(bb.min.x, bb.max.y),
        ];

        for (const def of entity.definitionLines) {
            const ang = ((def.angle ?? 0) + (entity.patternAngle ?? 0)) * Math.PI / 180;

            const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang)); // unit
            const nrm = new THREE.Vector2(-dir.y, dir.x);

            const base = new THREE.Vector2(def.base?.x ?? 0, def.base?.y ?? 0);
            const off = new THREE.Vector2((def.offset?.x ?? 0) * scale, (def.offset?.y ?? 0) * scale);

            const step = off.dot(nrm);
            if (Math.abs(step) < 1e-9) continue;

            const ds = corners.map(c => c.dot(nrm));
            const minD = Math.min(...ds), maxD = Math.max(...ds);
            const baseD = base.dot(nrm);

            let k0 = Math.floor((minD - baseD) / step) - 3;
            let k1 = Math.ceil((maxD - baseD) / step) + 3;
            if (k0 > k1) { const t = k0; k0 = k1; k1 = t; }

            for (let k = k0; k <= k1; k++) {
                const origin = base.clone().add(off.clone().multiplyScalar(k));

                // ✅ vertex-safe scanline clip
                const segs = this.clipScanlineToPolygon(origin, dir, nrm, outerPoly, holes, eps);

                // dash (ANSI33)
                const dashed = this.applyDash(segs, def, scale);

                for (const s of dashed) {
                    positions.push(s.a.x, s.a.y, 0, s.b.x, s.b.y, 0);
                }
            }
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
        return new THREE.LineSegments(geom, mat);
    }


    // ------------------------------------------------------------
    // GEOMETRİ / CLIP
    // ------------------------------------------------------------
    computeBBox(pts) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
    }

    signedArea(pts) {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % pts.length];
            a += (p.x * q.y - q.x * p.y);
        }
        return a / 2;
    }

    polygonCentroid(pts) {
        let a = 0, cx = 0, cy = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            const cross = p.x * q.y - q.x * p.y;
            a += cross;
            cx += (p.x + q.x) * cross;
            cy += (p.y + q.y) * cross;
        }
        a *= 0.5;
        if (Math.abs(a) < 1e-12) {
            let sx = 0, sy = 0;
            for (const p of pts) { sx += p.x; sy += p.y; }
            return new THREE.Vector2(sx / pts.length, sy / pts.length);
        }
        return new THREE.Vector2(cx / (6 * a), cy / (6 * a));
    }

    // loops: [{pts, abs}] büyükten küçüğe sıralı
    assignNestingDepth(loops) {
        for (let i = 0; i < loops.length; i++) {
            loops[i].centroid = this.polygonCentroid(loops[i].pts);
            loops[i].parent = -1;
            loops[i].depth = 0;
        }

        for (let i = 0; i < loops.length; i++) {
            let best = -1;
            for (let j = 0; j < loops.length; j++) {
                if (j === i) continue;
                if (loops[j].abs <= loops[i].abs) continue;
                if (this.pointInPolygon(loops[i].centroid, loops[j].pts)) {
                    if (best === -1 || loops[j].abs < loops[best].abs) best = j;
                }
            }
            loops[i].parent = best;
        }

        for (let i = 0; i < loops.length; i++) {
            let d = 0;
            let p = loops[i].parent;
            while (p !== -1) { d++; p = loops[p].parent; }
            loops[i].depth = d;
        }
    }

    // çizgi segmentlerini polygon (outer - holes) içine kırp
    clipLineToPolygon(a, b, outer, holes) {
        const ints = [];
        ints.push(...this.collectIntersections(a, b, outer));
        for (const h of holes) ints.push(...this.collectIntersections(a, b, h));
        if (ints.length < 2) return [];

        const dir = b.clone().sub(a);
        const len2 = dir.lengthSq() || 1;
        const tOf = (p) => (p.clone().sub(a).dot(dir)) / len2;

        ints.sort((p, q) => tOf(p) - tOf(q));

        const outSegs = [];
        const eps = 1e-6;

        for (let i = 0; i + 1 < ints.length; i++) {
            const p = ints[i];
            const q = ints[i + 1];

            // IMPORTANT: burada "eşit" noktaları tamamen atmak bazen pariteyi bozuyor.
            // ama sıfır uzunluk gerçek segment üretmeyeceği için atlıyoruz.
            if (p.distanceTo(q) < eps) continue;

            const mid = p.clone().add(q).multiplyScalar(0.5);

            if (!this.pointInPolygonOrOnEdge(mid, outer, eps)) continue;

            let inHole = false;
            for (const h of holes) {
                if (this.pointInPolygonOrOnEdge(mid, h, eps)) { inHole = true; break; }
            }
            if (inHole) continue;

            outSegs.push({ a: p, b: q });
        }

        return outSegs;
    }

    collectIntersections(a, b, poly) {
        const pts = [];
        for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i];
            const p2 = poly[(i + 1) % poly.length];
            const hit = this.segmentIntersect(a, b, p1, p2);
            if (hit) pts.push(hit);
        }
        return pts; // dedupe YOK
    }

    // segment-segment intersection (toleranslı)
    segmentIntersect(a, b, c, d) {
        const eps = 1e-9;
        const r = b.clone().sub(a);
        const s = d.clone().sub(c);
        const denom = r.x * s.y - r.y * s.x;

        // paralel / kolinear: şimdilik yok say
        if (Math.abs(denom) < eps) return null;

        const tNumer = (c.x - a.x) * s.y - (c.y - a.y) * s.x;
        const uNumer = (c.x - a.x) * r.y - (c.y - a.y) * r.x;

        const t = tNumer / denom;
        const u = uNumer / denom;

        if (t >= -eps && t <= 1 + eps && u >= -eps && u <= 1 + eps) {
            return new THREE.Vector2(a.x + t * r.x, a.y + t * r.y);
        }
        return null;
    }

    // dashLengths uygula (negatif = boşluk)
    applyDash(segs, def, scale) {
        const dash = def.dashLengths;
        if (!dash || dash.length === 0) return segs;

        const pattern = dash.map(v => Math.abs(v) * scale);
        const patLen = pattern.reduce((s, v) => s + v, 0);
        if (patLen < 1e-9) return segs;

        const out = [];

        for (const seg of segs) {
            const v = seg.b.clone().sub(seg.a);
            const L = v.length();
            if (L < 1e-9) continue;

            const dir = v.clone().multiplyScalar(1 / L);

            let dist = 0;
            let idx = 0;
            let draw = true;

            while (dist < L) {
                const step = pattern[idx % pattern.length];
                const dist2 = Math.min(L, dist + step);

                if (draw && dist2 > dist) {
                    const p = seg.a.clone().add(dir.clone().multiplyScalar(dist));
                    const q = seg.a.clone().add(dir.clone().multiplyScalar(dist2));
                    out.push({ a: p, b: q });
                }

                dist = dist2;
                idx++;
                draw = !draw;
            }
        }

        return out;
    }

    // ------------------------------------------------------------
    // POLYGON TEST (KENAR DAHİL)
    // ------------------------------------------------------------
    pointOnSegment(p, a, b, eps = 1e-6) {
        const ab = b.clone().sub(a);
        const ap = p.clone().sub(a);
        const cross = ab.x * ap.y - ab.y * ap.x;
        if (Math.abs(cross) > eps) return false;

        const dot = ap.dot(ab);
        if (dot < -eps) return false;

        const abLen2 = ab.lengthSq();
        if (dot > abLen2 + eps) return false;

        return true;
    }

    pointInPolygonOrOnEdge(p, poly, eps = 1e-6) {
        // kenar üstü -> içerde kabul
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            if (this.pointOnSegment(p, a, b, eps)) return true;
        }
        return this.pointInPolygon(p, poly);
    }

    pointInPolygon(p, poly) {
        // ray casting
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;

            const intersect = ((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-12) + xi);

            if (intersect) inside = !inside;
        }
        return inside;
    }

    // ------------------------------------------------------------
    // HATCH LOOP OKUMA (bulge destekli)
    // ------------------------------------------------------------
    cleanupLoopPoints(pts, eps, colEps = 1e-10) {
        if (!pts || pts.length < 3) return null;

        // 1) ardışık çok yakın noktaları at
        const out = [];
        for (const p of pts) {
            if (out.length === 0 || out[out.length - 1].distanceTo(p) > eps) out.push(p);
        }
        if (out.length > 1 && out[0].distanceTo(out[out.length - 1]) < eps) out.pop();

        // 2) kolinear noktaları at
        let i = 0;
        while (out.length >= 3 && i < out.length) {
            const a = out[(i - 1 + out.length) % out.length];
            const b = out[i];
            const c = out[(i + 1) % out.length];

            const abx = b.x - a.x, aby = b.y - a.y;
            const bcx = c.x - b.x, bcy = c.y - b.y;
            const cross = abx * bcy - aby * bcx;

            if (Math.abs(cross) < colEps) {
                out.splice(i, 1);
                continue;
            }
            i++;
        }

        return out.length >= 3 ? out : null;
    }

    hatchLoopToPoints(loop, eps = 1e-3) {
        const pts = [];
        const isPolyline = (loop.boundaryPathTypeFlag & 2) !== 0;

        // POLYLINE LOOP
        if (isPolyline && loop.vertices?.length) {
            const v = loop.vertices;

            // 2 vertex + bulge=±1 → tam daire (wedge sorununu azaltır)
            if (v.length === 2 && Math.abs(v[0].bulge) === 1 && Math.abs(v[1].bulge) === 1) {
                const p1 = new THREE.Vector2(v[0].x, v[0].y);
                const p2 = new THREE.Vector2(v[1].x, v[1].y);
                const center = new THREE.Vector2((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
                const r = p1.distanceTo(p2) / 2;

                const circle = [];
                const seg = 192;
                for (let i = 0; i < seg; i++) {
                    const a = (i / seg) * Math.PI * 2;
                    circle.push(new THREE.Vector2(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r));
                }
                return this.cleanupLoopPoints(circle, eps);
            }

            for (let i = 0; i < v.length; i++) {
                const v1 = v[i];
                const v2 = v[(i + 1) % v.length];

                const p1 = new THREE.Vector2(v1.x, v1.y);
                if (pts.length === 0 || pts[pts.length - 1].distanceTo(p1) > eps) pts.push(p1);

                if (v1.bulge) {
                    const arc = this.getBulgePoints(v1, v2, v1.bulge);
                    for (let k = 1; k < arc.length; k++) {
                        const p = arc[k];
                        if (pts[pts.length - 1].distanceTo(p) > eps) pts.push(p);
                    }
                }
            }

            return this.cleanupLoopPoints(pts, eps);
        }

        // EDGE LOOP
        if (loop.edges?.length) {
            for (const e of loop.edges) {
                if (e.type === 1) {
                    const s = new THREE.Vector2(e.start.x, e.start.y);
                    const t = new THREE.Vector2(e.end.x, e.end.y);
                    if (pts.length === 0 || pts[pts.length - 1].distanceTo(s) > eps) pts.push(s);
                    if (pts[pts.length - 1].distanceTo(t) > eps) pts.push(t);
                } else if (e.type === 2) {
                    const start = (e.startAngle * Math.PI) / 180;
                    const end = (e.endAngle * Math.PI) / 180;

                    const curve = new THREE.EllipseCurve(
                        e.center.x, e.center.y,
                        e.radius, e.radius,
                        start, end,
                        e.isCounterClockwise === false,
                        0
                    );

                    const arcPts = curve.getPoints(64).map(p => new THREE.Vector2(p.x, p.y));
                    for (const p of arcPts) {
                        if (pts.length === 0 || pts[pts.length - 1].distanceTo(p) > eps) pts.push(p);
                    }
                }
            }
            return this.cleanupLoopPoints(pts, eps);
        }

        return null;
    }

    // bulge -> arc örnekleme
    getBulgePoints(v1, v2, bulge) {
        const p1 = new THREE.Vector2(v1.x, v1.y);
        const p2 = new THREE.Vector2(v2.x, v2.y);
        const dist = p1.distanceTo(p2);
        if (dist === 0) return [p1];

        const theta = 4 * Math.atan(bulge);
        const radius = dist / (2 * Math.sin(theta / 2));

        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;

        const nx = -dy;
        const ny = dx;

        const f = (1 - bulge * bulge) / (4 * bulge);
        const cx = mx + nx * f;
        const cy = my + ny * f;

        const startAng = Math.atan2(p1.y - cy, p1.x - cx);
        const endAng = startAng + theta;

        const curve = new THREE.EllipseCurve(
            cx, cy,
            Math.abs(radius), Math.abs(radius),
            startAng, endAng,
            theta < 0,
            0
        );

        const steps = Math.max(16, Math.floor(dist / 4));
        return curve.getPoints(steps);
    }

    // ------------------------------------------------------------
    // RENK
    // ------------------------------------------------------------
    getColor(entity, dxf) {
        const trueColor = this.resolveTrueColor(entity);
        if (trueColor != null) return trueColor;

        const idx = entity?.colorIndex;

        // ByBlock
        if (idx === 0) return 0xffffff;

        // ByLayer
        if (idx == null || idx === 256) {
            // DXF parser stores layers in dxf.tables.LAYER.entries as an array
            let layer = null;
            if (dxf?.tables?.LAYER?.entries) {
                layer = dxf.tables.LAYER.entries.find(l => l.name === entity.layer);
            }

            if (layer) {
                const layerTrue = this.resolveTrueColor(layer);
                if (layerTrue != null) return layerTrue;
                const layerIdx = layer?.colorIndex ?? layer?.color;
                //console.log(`🎨 Layer "${entity.layer}": colorIndex=${layerIdx}, layer=`, layer);
                if (layerIdx != null) return this.aciToHex(layerIdx);
            } else {
                console.warn(`⚠️ Layer "${entity.layer}" not found in tables`);
            }

            return this.aciToHex(7); // default white
        }

        return this.aciToHex(idx);
    }

    resolveTrueColor(obj) {
        if (!obj) return null;
        const c = obj.trueColor ?? obj.color;
        if (typeof c === "number" && c > 0xff) return c & 0xffffff;
        if (typeof c === "string") {
            const s = c.trim();
            if (s.startsWith("#")) return parseInt(s.slice(1), 16);
            if (s.startsWith("0x")) return parseInt(s.slice(2), 16);
        }
        return null;
    }
    getLinetypePatternFromTable(name, dxf) {
        const entries = dxf?.tables?.LTYPE?.entries;
        if (!entries) return null;

        const lt = entries.find(e => (e.name || e.linetypeName || '').toUpperCase() === name.toUpperCase());
        if (!lt) return null;

        // dxf-parser farklı alan isimleri kullanabilir
        const arr =
            lt.pattern ||
            lt.dashLengths ||
            lt.elements ||
            lt.segmentLengths;

        if (!Array.isArray(arr) || arr.length === 0) return null;

        // DXF’te genelde: [+dash, -gap, +dash, -gap ...] (0 => nokta olabilir)
        // Basit yaklaşım: ilk + değeri dash, ilk - değeri gap kabul et
        let dash = null, gap = null;

        for (const v of arr) {
            if (!Number.isFinite(v)) continue;
            if (v > 0 && dash === null) dash = v;
            if (v < 0 && gap === null) gap = Math.abs(v);
            if (dash !== null && gap !== null) break;
        }

        // Nokta tipi: dash yok ama gap var vs.
        if (dash === null && gap !== null) dash = Math.max(0.2, gap * 0.25);
        if (dash === null || gap === null) return null;

        return { dash, gap };
    }

    // Helper to create material with linetype support
    createMaterial(entity, dxf, color) {
        const linetype = this.getLineType(entity, dxf);
        if (!linetype || linetype.toUpperCase() === 'CONTINUOUS') {
            return new THREE.LineBasicMaterial({ color });
        }

        // DXF header ölçekleri (varsa)
        const ltScale = (dxf?.header?.$LTSCALE ?? 1) * (entity.linetypeScale ?? 1);

        // 1) Önce DXF LTYPE tablosundan pattern yakala
        const pat = this.getLinetypePatternFromTable(linetype, dxf);

        // 2) Bulamazsan fallback map (AutoCAD standard linetypes)
        const fallback = {
            // Basic patterns
            'DASHED': { dash: 5, gap: 3 },
            'HIDDEN': { dash: 2.5, gap: 1.25 },
            'HIDDEN2': { dash: 3.175, gap: 1.588 },
            'HIDDENX2': { dash: 5, gap: 2.5 },
            'CENTER': { dash: 12.7, gap: 3.175 },
            'CENTER2': { dash: 6.35, gap: 1.588 },
            'CENTERX2': { dash: 25.4, gap: 6.35 },
            'PHANTOM': { dash: 12.7, gap: 2.54 },
            'PHANTOM2': { dash: 6.35, gap: 1.27 },
            'PHANTOMX2': { dash: 25.4, gap: 5.08 },
            // Dot patterns
            'DOT': { dash: 0, gap: 1.588 },
            'DOT2': { dash: 0, gap: 0.794 },
            'DOTX2': { dash: 0, gap: 3.175 },
            // Dash-dot patterns
            'DASHDOT': { dash: 6.35, gap: 1.588 },
            'DASHDOT2': { dash: 3.175, gap: 0.794 },
            'DASHDOTX2': { dash: 12.7, gap: 3.175 },
            // Border patterns
            'BORDER': { dash: 12.7, gap: 3.175 },
            'BORDER2': { dash: 6.35, gap: 1.588 },
            'BORDERX2': { dash: 25.4, gap: 6.35 },
            // Divide patterns  
            'DIVIDE': { dash: 12.7, gap: 2.54 },
            'DIVIDE2': { dash: 6.35, gap: 1.27 },
            'DIVIDEX2': { dash: 25.4, gap: 5.08 }
        };

        const p = pat ?? fallback[linetype.toUpperCase()] ?? fallback['DASHED'];

        return new THREE.LineDashedMaterial({
            color,
            dashSize: p.dash,
            gapSize: p.gap,
            scale: ltScale   // dünya biriminde ölçek
        });
    }


    getLineType(entity, dxf) {
        // Direct linetype on entity
        if (entity.lineType && entity.lineType !== 'BYLAYER') {
            console.log(`🔧 Direct linetype: "${entity.lineType}" for layer ${entity.layer}`);
            return entity.lineType;
        }

        // ByLayer - get from layer definition
        if (dxf?.tables?.LAYER?.entries) {
            const layer = dxf.tables.LAYER.entries.find(l => l.name === entity.layer);
            if (layer?.lineType) {
                console.log(`🔧 ByLayer linetype: "${layer.lineType}" for layer ${entity.layer}`);
                return layer.lineType;
            } else {
                console.warn(`⚠️ Layer "${entity.layer}" found but no lineType`);
            }
        }

        console.log(`⚠️ No linetype for layer ${entity.layer}, using CONTINUOUS`);
        return 'CONTINUOUS';
    }

    aciToHex(aci) {
        // AutoCAD ACI (AutoCAD Color Index) full color table
        // ACI 1-255 have predefined RGB values
        const aciColors = [
            0x000000, 0xFF0000, 0xFFFF00, 0x00FF00, 0x00FFFF, 0x0000FF, 0xFF00FF, 0xFFFFFF, // 0-7
            0x808080, 0xC0C0C0, 0xFF0000, 0xFF7F7F, 0xCC0000, 0xCC6666, 0x990000, 0x994C4C, // 8-15
            0x7F0000, 0x7F3F3F, 0x4C0000, 0x4C2626, 0xFF3F00, 0xFF9F7F, 0xCC3300, 0xCC7F66, // 16-23
            0x993300, 0x99664C, 0x7F2600, 0x7F4F3F, 0x4C1900, 0x4C2F26, 0xFF7F00, 0xFFBF7F, // 24-31
            0xCC6600, 0xCC9966, 0x994C00, 0x99794C, 0x7F3F00, 0x7F5F3F, 0x4C2600, 0x4C3926, // 32-39
            0xFFBF00, 0xFFDF7F, 0xCC9900, 0xCCB266, 0x997300, 0x99854C, 0x7F5F00, 0x7F6F3F, // 40-47
            0x4C3900, 0x4C4226, 0xFFFF00, 0xFFFF7F, 0xCCCC00, 0xCCCC66, 0x999900, 0x99994C, // 48-55
            0x7F7F00, 0x7F7F3F, 0x4C4C00, 0x4C4C26, 0xBFFF00, 0xDFFF7F, 0x99CC00, 0xB2CC66, // 56-63
            0x739900, 0x85994C, 0x5F7F00, 0x6F7F3F, 0x394C00, 0x424C26, 0x7FFF00, 0xBFFF7F, // 64-71
            0x66CC00, 0x99CC66, 0x4C9900, 0x79994C, 0x3F7F00, 0x5F7F3F, 0x264C00, 0x394C26, // 72-79
            0x3FFF00, 0x9FFF7F, 0x33CC00, 0x7FCC66, 0x269900, 0x66994C, 0x267F00, 0x4F7F3F, // 80-87
            0x194C00, 0x2F4C26, 0x00FF00, 0x7FFF7F, 0x00CC00, 0x66CC66, 0x009900, 0x4C994C, // 88-95
            0x007F00, 0x3F7F3F, 0x004C00, 0x264C26, 0x00FF3F, 0x7FFF9F, 0x00CC33, 0x66CC7F, // 96-103
            0x009926, 0x4C9966, 0x007F26, 0x3F7F4F, 0x004C19, 0x264C2F, 0x00FF7F, 0x7FFFBF, // 104-111
            0x00CC66, 0x66CC99, 0x00994C, 0x4C9979, 0x007F3F, 0x3F7F5F, 0x004C26, 0x264C39, // 112-119
            0x00FFBF, 0x7FFFDF, 0x00CC99, 0x66CCB2, 0x009973, 0x4C9985, 0x007F5F, 0x3F7F6F, // 120-127
            0x004C39, 0x264C42, 0x00FFFF, 0x7FFFFF, 0x00CCCC, 0x66CCCC, 0x009999, 0x4C9999, // 128-135
            0x007F7F, 0x3F7F7F, 0x004C4C, 0x264C4C, 0x00BFFF, 0x7FDFFF, 0x0099CC, 0x66B2CC, // 136-143
            0x007399, 0x4C8599, 0x005F7F, 0x3F6F7F, 0x00394C, 0x26424C, 0x007FFF, 0x7FBFFF, // 144-151
            0x0066CC, 0x6699CC, 0x004C99, 0x4C7999, 0x003F7F, 0x3F5F7F, 0x00264C, 0x26394C, // 152-159
            0x003FFF, 0x7F9FFF, 0x0033CC, 0x667FCC, 0x002699, 0x4C6699, 0x00267F, 0x3F4F7F, // 160-167
            0x00194C, 0x262F4C, 0x0000FF, 0x7F7FFF, 0x0000CC, 0x6666CC, 0x000099, 0x4C4C99, // 168-175
            0x00007F, 0x3F3F7F, 0x00004C, 0x26264C, 0x3F00FF, 0x9F7FFF, 0x3300CC, 0x7F66CC, // 176-183
            0x260099, 0x664C99, 0x26007F, 0x4F3F7F, 0x19004C, 0x2F264C, 0x7F00FF, 0xBF7FFF, // 184-191
            0x6600CC, 0x9966CC, 0x4C0099, 0x794C99, 0x3F007F, 0x5F3F7F, 0x26004C, 0x39264C, // 192-199
            0xBF00FF, 0xDF7FFF, 0x9900CC, 0xB266CC, 0x730099, 0x854C99, 0x5F007F, 0x6F3F7F, // 200-207
            0x39004C, 0x42264C, 0xFF00FF, 0xFF7FFF, 0xCC00CC, 0xCC66CC, 0x990099, 0x994C99, // 208-215
            0x7F007F, 0x7F3F7F, 0x4C004C, 0x4C264C, 0xFF00BF, 0xFF7FDF, 0xCC0099, 0xCC66B2, // 216-223
            0x990073, 0x994C85, 0x7F005F, 0x7F3F6F, 0x4C0039, 0x4C2642, 0xFF007F, 0xFF7FBF, // 224-231
            0xCC0066, 0xCC6699, 0x99004C, 0x994C79, 0x7F003F, 0x7F3F5F, 0x4C0026, 0x4C2639, // 232-239
            0xFF003F, 0xFF7F9F, 0xCC0033, 0xCC667F, 0x990026, 0x994C66, 0x7F0026, 0x7F3F4F, // 240-247
            0x4C0019, 0x4C262F, 0x333333, 0x505050, 0x696969, 0x828282, 0xBEBEBE, 0xFFFFFF  // 248-255
        ];

        if (aci >= 0 && aci < aciColors.length) {
            return aciColors[aci];
        }

        return 0xFFFFFF; // default white
    }

    getFontFamily(styleName) {
        if (!styleName) return 'Arial, sans-serif';

        const style = styleName.toUpperCase();

        // Map common AutoCAD fonts to web fonts
        const fontMap = {
            'ROMANC': '"Times New Roman", serif',
            'ROMANS': '"Times New Roman", serif',
            'ROMANT': '"Times New Roman", serif',
            'TIMES': '"Times New Roman", serif',
            'ARIAL': 'Arial, sans-serif',
            'STANDARD': 'Arial, sans-serif',
            'SIMPLEX': 'Arial, sans-serif',
            'COMPLEX': '"Times New Roman", serif',
            'ITALIC': '"Times New Roman", italic, serif',
            'COURIER': '"Courier New", monospace'
        };

        // Check for partial matches
        for (const [key, value] of Object.entries(fontMap)) {
            if (style.includes(key)) {
                return value;
            }
        }

        // Default fallback
        return 'Arial, sans-serif';
    }

    createText(entity, color) {
        if (!entity.text || !entity.startPoint) {
            return null;
        }

        const text = entity.text;
        const height = entity.textHeight || 10;
        const position = entity.startPoint;
        const rotation = entity.rotation || 0;

        // Create canvas-based sprite with font style
        const sprite = this.createTextSprite(text, height, color, entity.styleName);

        // THREE.Sprite is centered by default, but AutoCAD TEXT uses bottom-left anchor
        // Offset position to match AutoCAD behavior
        const offsetX = sprite.scale.x / 2;  // Half width to right
        const offsetY = sprite.scale.y / 2;  // Half height up

        // Position with offset
        sprite.position.set(
            position.x + offsetX,
            position.y + offsetY,
            position.z || 0
        );

        // Rotation (DXF rotation is in degrees)
        if (rotation !== 0) {
            sprite.rotation.z = rotation * Math.PI / 180;
        }

        sprite.userData = { text, height };
        return sprite;
    }

    createInsert(entity, dxf) {
        // console.log('📦 INSERT entity:', entity);

        if (!entity.name || !entity.insertionPoint) {
            console.warn('❌ INSERT missing name or insertionPoint:', entity);
            return null;
        }

        const blockName = entity.name;
        const block = this.blocks[blockName];

        if (!block || !block.entities) {
            console.warn(`❌ Block "${blockName}" not found or has no entities`);
            return null;
        }

        // console.log(`📦 Rendering block "${blockName}" with ${block.entities.length} entities`);
        // console.log('📦 Block data:', block);

        // Create group for this insert
        const group = new THREE.Group();

        // Get block base point (block entities are relative to this)
        const baseX = block.position?.x || block.basePoint?.x || 0;
        const baseY = block.position?.y || block.basePoint?.y || 0;
        const baseZ = block.position?.z || block.basePoint?.z || 0;
        // console.log(`📦 Base point: (${baseX}, ${baseY}, ${baseZ})`);

        // Render each entity in the block
        for (const blockEntity of block.entities) {
            try {
                const obj = this.convertEntity(blockEntity, dxf);
                if (obj) {
                    // Do NOT offset - entities already have absolute positions
                    group.add(obj);
                }
            } catch (err) {
                console.warn('Failed to convert block entity:', blockEntity, err);
            }
        }

        // Apply INSERT transforms
        const pos = entity.insertionPoint || entity.position;
        group.position.set(pos.x, pos.y, pos.z || 0);

        // Rotation (DXF rotation in degrees)
        if (entity.rotation) {
            group.rotation.z = entity.rotation * Math.PI / 180;
        }

        // Scale
        const scaleX = entity.scaleX || entity.xScale || 1;
        const scaleY = entity.scaleY || entity.yScale || 1;
        const scaleZ = entity.scaleZ || entity.zScale || 1;
        group.scale.set(scaleX, scaleY, scaleZ);

        // console.log(`✅ INSERT rendered at (${pos.x}, ${pos.y}), rotation: ${entity.rotation || 0}°`);

        return group;
    }

    createDimension(entity, color, dxf) {
        const group = new THREE.Group();

        // ---------- helpers ----------
        const toRad = (deg) => deg * Math.PI / 180;
        const dot2 = (ax, ay, bx, by) => ax * bx + ay * by;
        const clampTol = (m) => Math.max(1e-3, m * 1e-4);

        const lineMaterial = new THREE.LineBasicMaterial({ color });
        const fillMaterial = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

        const addLine = (a, b) => {
            const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
            group.add(new THREE.Line(geom, lineMaterial));
        };

        const addPolyline = (pts) => {
            const geom = new THREE.BufferGeometry().setFromPoints(pts);
            group.add(new THREE.Line(geom, lineMaterial));
        };

        const addFilledTriangle = (p1, p2, p3) => {
            const geom = new THREE.BufferGeometry();
            const vertices = new Float32Array([
                p1.x, p1.y, 0,
                p2.x, p2.y, 0,
                p3.x, p3.y, 0
            ]);
            geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geom.computeVertexNormals();
            const mesh = new THREE.Mesh(geom, fillMaterial);
            group.add(mesh);
        };

        const addDot = (center, radius) => {
            const geom = new THREE.CircleGeometry(radius, 16);
            const mesh = new THREE.Mesh(geom, fillMaterial);
            mesh.position.set(center.x, center.y, 0);
            group.add(mesh);
        };

        // Try to read DIMSTYLE from DXF tables (adjust if your parser differs)
        const getDimStyleFromDxf = (dxfObj, styleName) => {
            if (!dxfObj || !styleName) return null;

            // Common patterns in parsers:
            // dxf.tables.dimstyle / dxf.tables.dimstyles / dxf.tables.DIMSTYLE
            const t = dxfObj.tables || dxfObj.table || null;
            if (!t) return null;

            const candidates = [
                t.dimstyles,
                t.dimstyle,
                t.DIMSTYLE,
                t.DimStyle
            ].filter(Boolean);

            for (const c of candidates) {
                // could be array of styles or map keyed by name
                if (Array.isArray(c)) {
                    const hit = c.find(s => (s.name || s.styleName) === styleName);
                    if (hit) return hit;
                } else if (typeof c === 'object') {
                    if (c[styleName]) return c[styleName];
                    // maybe values are objects with .name
                    for (const k of Object.keys(c)) {
                        const s = c[k];
                        if (s && (s.name || s.styleName) === styleName) return s;
                    }
                }
            }
            return null;
        };

        // Extract dim vars from style + entity xdata fallback
        const getDimVars = (dxfObj, ent) => {
            const style = getDimStyleFromDxf(dxfObj, ent.styleName);

            // Defaults (reasonable)
            let DIMTXT = ent.textHeight || ent.height || 2.5;
            let DIMGAP = null;   // if null -> compute from DIMTXT
            let DIMASZ = 1.5;    // arrow size
            let DIMTSZ = 0;      // tick size; if >0 -> ticks instead of arrows
            let DIMBLK = null;   // arrow block name default
            let DIMBLK1 = null;  // first arrow
            let DIMBLK2 = null;  // second arrow

            // Pull from style if present (field names vary by parser)
            const readNum = (obj, ...keys) => {
                for (const k of keys) {
                    const v = obj?.[k];
                    if (Number.isFinite(v)) return v;
                }
                return null;
            };
            const readStr = (obj, ...keys) => {
                for (const k of keys) {
                    const v = obj?.[k];
                    if (typeof v === 'string' && v.length) return v;
                }
                return null;
            };

            if (style) {
                const txt = readNum(style, 'DIMTXT', 'dimtxt', 'textHeight');
                if (txt) DIMTXT = txt;

                const gap = readNum(style, 'DIMGAP', 'dimgap');
                if (gap !== null) DIMGAP = gap;

                const asz = readNum(style, 'DIMASZ', 'dimasz', 'arrowSize');
                if (asz) DIMASZ = asz;

                const tsz = readNum(style, 'DIMTSZ', 'dimtsz', 'tickSize');
                if (tsz !== null) DIMTSZ = tsz;

                DIMBLK = readStr(style, 'DIMBLK', 'dimblk');
                DIMBLK1 = readStr(style, 'DIMBLK1', 'dimblk1');
                DIMBLK2 = readStr(style, 'DIMBLK2', 'dimblk2');
            }

            // xdata fallback for DIMTXT only (senin mevcut yaklaşım)
            if (ent.xdata) {
                for (const xd of ent.xdata) {
                    if (xd.appName === 'ACAD' && xd.value && Array.isArray(xd.value[1])) {
                        const values = xd.value[1];
                        const idx140 = values.indexOf(140); // DIMTXT
                        if (idx140 !== -1 && idx140 + 1 < values.length) {
                            const v = values[idx140 + 1];
                            if (Number.isFinite(v) && v > 0) DIMTXT = v;
                        }
                    }
                }
            }

            // If DIMGAP missing, set a stable gap relative to text height (AutoCAD vibe)
            if (DIMGAP === null) DIMGAP = DIMTXT * 0.6;

            return { DIMTXT, DIMGAP, DIMASZ, DIMTSZ, DIMBLK, DIMBLK1, DIMBLK2 };
        };

        // Map DIMBLK name to a simple arrow type
        const arrowTypeFromName = (name) => {
            if (!name) return 'CLOSED';
            const n = name.toUpperCase();

            // AutoCAD built-ins often look like: _CLOSED, _OPEN30, _DOT, _ARCHTICK, _NONE
            if (n.includes('NONE')) return 'NONE';
            if (n.includes('ARCHTICK') || n.includes('TICK')) return 'ARCHTICK';
            if (n.includes('DOT')) return 'DOT';
            if (n.includes('OPEN')) return 'OPEN';
            if (n.includes('CLOSED')) return 'CLOSED';

            // Unknown: default to CLOSED
            return 'CLOSED';
        };

        const drawArrowEnd = (tip, dirTowardInsideAngle, vars) => {
            // If tick mode: DIMTSZ > 0
            if (vars.DIMTSZ && vars.DIMTSZ > 0) {
                // 45° tick like AutoCAD "Architectural tick"
                const size = vars.DIMTSZ;
                const a = dirTowardInsideAngle + Math.PI / 4;
                const vx = Math.cos(a) * size;
                const vy = Math.sin(a) * size;
                addLine(
                    new THREE.Vector3(tip.x - vx, tip.y - vy, 0),
                    new THREE.Vector3(tip.x + vx, tip.y + vy, 0)
                );
                return;
            }

            const arrowName = vars.DIMBLK1 || vars.DIMBLK || ''; // caller can override per-end
            const type = arrowTypeFromName(arrowName);
            if (type === 'NONE') return;

            const size = vars.DIMASZ || 1.5;

            const ux = Math.cos(dirTowardInsideAngle);
            const uy = Math.sin(dirTowardInsideAngle);
            const px = -uy;
            const py = ux;

            if (type === 'DOT') {
                addDot(new THREE.Vector3(tip.x, tip.y, 0), size * 0.25);
                return;
            }

            if (type === 'ARCHTICK') {
                const a = dirTowardInsideAngle + Math.PI / 4;
                const vx = Math.cos(a) * (size * 0.9);
                const vy = Math.sin(a) * (size * 0.9);
                addLine(
                    new THREE.Vector3(tip.x - vx, tip.y - vy, 0),
                    new THREE.Vector3(tip.x + vx, tip.y + vy, 0)
                );
                return;
            }

            if (type === 'OPEN') {
                // V shape
                const wing = Math.PI / 6;
                const back = dirTowardInsideAngle + Math.PI;

                const pA = new THREE.Vector3(
                    tip.x + size * Math.cos(back + wing),
                    tip.y + size * Math.sin(back + wing),
                    0
                );
                const pB = new THREE.Vector3(
                    tip.x + size * Math.cos(back - wing),
                    tip.y + size * Math.sin(back - wing),
                    0
                );
                addPolyline([pA, new THREE.Vector3(tip.x, tip.y, 0), pB]);
                return;
            }

            // CLOSED: filled triangle (AutoCAD vibe: ◄ ►)
            const baseCenter = new THREE.Vector3(
                tip.x - ux * size,
                tip.y - uy * size,
                0
            );
            const halfW = size * 0.35;

            const left = new THREE.Vector3(
                baseCenter.x + px * halfW,
                baseCenter.y + py * halfW,
                0
            );
            const right = new THREE.Vector3(
                baseCenter.x - px * halfW,
                baseCenter.y - py * halfW,
                0
            );

            addFilledTriangle(new THREE.Vector3(tip.x, tip.y, 0), left, right);

            // Also outline it (optional but looks crisp)
            addPolyline([left, new THREE.Vector3(tip.x, tip.y, 0), right, left]);
        };

        // ---------- main ----------
        const p1 = entity.subDefinitionPoint1;
        const p2 = entity.subDefinitionPoint2;
        const textPt = entity.textPoint;
        if (!p1 || !p2 || !textPt) return null;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const angleFromP12 = Math.atan2(dy, dx);

        // baseType: low bits
        const baseType = ((entity.dimensionType ?? 0) & 0x0F);

        // rotation candidates
        const rotDeg =
            (Number.isFinite(entity.rotationAngle) ? entity.rotationAngle : null) ??
            (Number.isFinite(entity.angle) ? entity.angle : null) ??
            (Number.isFinite(entity.dimRotation) ? entity.dimRotation : null) ??
            (Number.isFinite(entity.linearRotation) ? entity.linearRotation : null);

        const hasRot = Number.isFinite(rotDeg);
        const m = (entity.measurement && entity.measurement > 0) ? entity.measurement : null;

        // angle selection
        let dimAngle;
        if (baseType === 1) {
            // aligned
            dimAngle = angleFromP12;
        } else {
            // rotated/linear
            if (hasRot) dimAngle = toRad(rotDeg);
            else if (m) {
                const tol = clampTol(m);
                const dxAbs = Math.abs(dx);
                const dyAbs = Math.abs(dy);
                const dxClose = Math.abs(dxAbs - m) <= tol;
                const dyClose = Math.abs(dyAbs - m) <= tol;

                if (dxClose && !dyClose) dimAngle = 0;
                else if (dyClose && !dxClose) dimAngle = Math.PI / 2;
                else dimAngle = angleFromP12;
            } else {
                dimAngle = angleFromP12;
            }
        }

        const u = { x: Math.cos(dimAngle), y: Math.sin(dimAngle) };
        const n = { x: -u.y, y: u.x };

        // reference point on dimension line (definitionPoint is best in your data)
        const def = entity.definitionPoint || textPt;

        // KEY FIX (separate projections for p1 and p2)
        const t1 = dot2(def.x - p1.x, def.y - p1.y, n.x, n.y);
        const t2 = dot2(def.x - p2.x, def.y - p2.y, n.x, n.y);

        const dimPt1 = new THREE.Vector3(p1.x + n.x * t1, p1.y + n.y * t1, 0);
        const dimPt2 = new THREE.Vector3(p2.x + n.x * t2, p2.y + n.y * t2, 0);

        // extension lines
        addLine(new THREE.Vector3(p1.x, p1.y, 0), dimPt1);
        addLine(new THREE.Vector3(p2.x, p2.y, 0), dimPt2);

        // dimension line
        addLine(dimPt1, dimPt2);

        // DIMSTYLE vars
        const vars = getDimVars(dxf, entity);

        // arrows: pick per-end blocks if available
        // For end1: DIMBLK1, end2: DIMBLK2 (fallback DIMBLK)
        const vars1 = { ...vars, DIMBLK1: vars.DIMBLK1 || vars.DIMBLK };
        const vars2 = { ...vars, DIMBLK1: vars.DIMBLK2 || vars.DIMBLK };

        // Calculate direction from dimPt1 to dimPt2
        const dimVecX = dimPt2.x - dimPt1.x;
        const dimVecY = dimPt2.y - dimPt1.y;
        const angleP1toP2 = Math.atan2(dimVecY, dimVecX);

        // console.log(`📐 Arrows: p1=(${dimPt1.x.toFixed(1)}, ${dimPt1.y.toFixed(1)}), p2=(${dimPt2.x.toFixed(1)}, ${dimPt2.y.toFixed(1)}), angle=${(angleP1toP2 * 180 / Math.PI).toFixed(1)}°`);

        // Arrows always point toward each other
        // NOTE: drawArrowEnd draws arrow pointing OPPOSITE to dirTowardInsideAngle
        drawArrowEnd(dimPt1, angleP1toP2 + Math.PI, vars1);  // arrow at p1 points toward p2
        drawArrowEnd(dimPt2, angleP1toP2, vars2);  // arrow at p2 points toward p1

        // measurement text
        const measurementValue = m ?? (() => {
            // projection along u between dimPts
            const ddx = dimPt2.x - dimPt1.x;
            const ddy = dimPt2.y - dimPt1.y;
            return Math.abs(ddx * u.x + ddy * u.y);
        })();

        const text = measurementValue.toFixed(2);

        // ---- TEXT POSITION: constant gap from dimension line ----
        // Project textPt onto dimension line (through dimPt1, direction u)
        const tx = textPt.x - dimPt1.x;
        const ty = textPt.y - dimPt1.y;
        const tOnLine = dot2(tx, ty, u.x, u.y);

        const proj = new THREE.Vector3(
            dimPt1.x + u.x * tOnLine,
            dimPt1.y + u.y * tOnLine,
            0
        );

        // decide which side (use sign from actual textPt)
        const side = Math.sign(dot2(textPt.x - proj.x, textPt.y - proj.y, n.x, n.y)) || 1;

        // Use half of text height as gap for consistent spacing
        const gap = vars.DIMTXT / 2;

        const textPos = new THREE.Vector3(
            proj.x + n.x * gap * side,
            proj.y + n.y * gap * side,
            0
        );

        // Check if text is outside arrow bounds (needs leader line)
        const dimLineLength = Math.sqrt(
            Math.pow(dimPt2.x - dimPt1.x, 2) +
            Math.pow(dimPt2.y - dimPt1.y, 2)
        );

        if (tOnLine < 0) {
            // Text is before dimPt1 - draw leader from dimPt1 to projection point
            addLine(dimPt1, proj);
        } else if (tOnLine > dimLineLength) {
            // Text is after dimPt2 - draw leader from dimPt2 to projection point
            addLine(dimPt2, proj);
        }

        // text sprite
        const textSprite = this.createTextSprite(text, vars.DIMTXT, color, entity.styleName);

        // place centered on computed pos (sprite is already centered)
        textSprite.position.set(textPos.x, textPos.y, 0);

        // rotation: keep aligned with dimension line
        if (textSprite.material && typeof textSprite.material.rotation === 'number') {
            textSprite.material.rotation = dimAngle;
        } else if (textSprite.rotation) {
            textSprite.rotation.z = dimAngle;
        }

        group.add(textSprite);

        return group;
    }


    createTextSprite(text, height, color, styleName = null) {
        // Create canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Map DXF font styles to web fonts
        const fontFamily = this.getFontFamily(styleName);

        // High resolution for quality
        const fontSize = height * 8; // Scale up for better quality
        const font = `${fontSize}px ${fontFamily}`;
        context.font = font;

        // Measure text
        const metrics = context.measureText(text);
        const textWidth = metrics.width;

        // Set canvas size with padding
        const padding = fontSize * 0.1; // Small padding
        canvas.width = textWidth + padding * 2;
        canvas.height = fontSize + padding * 2;

        // Re-set font after canvas resize
        context.font = font;
        context.textAlign = 'left';
        context.textBaseline = 'top';

        // Fill background (transparent)
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Draw text
        const hexColor = '#' + color.toString(16).padStart(6, '0');
        context.fillStyle = hexColor;
        context.fillText(text, padding, padding);

        // Create texture
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        // Create sprite material
        const spriteMaterial = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false  // Always render on top
        });

        const sprite = new THREE.Sprite(spriteMaterial);

        // Scale sprite to match text height in world units
        // fontSize (on canvas) should equal 'height' (in world)
        // Canvas is scaled 8x (fontSize = height * 8)
        // So sprite height should be: canvas.height * (height / fontSize)
        const aspect = canvas.width / canvas.height;
        const spriteHeight = canvas.height * (height / fontSize);
        sprite.scale.set(spriteHeight * aspect, spriteHeight, 1);

        // Ensure sprite renders on top
        sprite.renderOrder = 1000;

        return sprite;
    }
}
