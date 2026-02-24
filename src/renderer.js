/**
 * Rendering Engine Module
 * Canvas 2D-based renderer with viewport transformation
 * Handles all entity types, linetypes, and color visibility logic
 */

import { aciToRgb, DXFParser } from './dxf-parser.js';
import { HatchBoundaryResolver } from './hatch-boundary-resolver.js';

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.viewport = {
            x: 0,
            y: 0,
            scale: 1,
            width: canvas.width,
            height: canvas.height
        };
        this.backgroundColor = '#1a1a1a';
        this.linetypeScale = 1;
        this.textScale = 4; // Fixed text size in pixels
        this.measurementColor = '#32a852'; // Default User Measurement Color
        this.entities = [];
        this.layers = new Map();
        this.linetypes = new Map();
        this.snapPoint = null;
        this.measurements = [];
        this.entityTree = []; // Hierarchical structure
        this.highlightedEntities = new Set(); // Multi-selection support
    }

    /**
     * Set measurement color
     */
    setMeasurementColor(color) {
        this.measurementColor = color;
    }

    /**
     * Set background color and update canvas
     */
    setBackgroundColor(color) {
        this.backgroundColor = color;
    }

    /**
     * Check if background is dark
     */
    isDarkBackground() {
        const rgb = this.hexToRgb(this.backgroundColor);
        if (!rgb) return true;
        const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
        return brightness < 128;
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    /**
     * Adjust color for visibility based on background
     */
    adjustColorForVisibility(rgb) {
        if (!rgb) return this.isDarkBackground() ? [255, 255, 255] : [0, 0, 0];

        const [r, g, b] = rgb;

        // Strict black/white checks (with small tolerance)
        const isBlack = r < 30 && g < 30 && b < 30;
        const isWhite = r > 225 && g > 225 && b > 225;

        if (this.isDarkBackground()) {
            // Dark background: make black lines white
            if (isBlack) {
                return [255, 255, 255];
            }
        } else {
            // Light background: make white lines black
            if (isWhite) {
                return [0, 0, 0];
            }
        }

        // All other colors remain unchanged
        return rgb;
    }

    /**
     * Get entity color as CSS string
     */
    getEntityColor(entity, layer) {
        let rgb;

        if (entity.color === 256 || entity.color === 0) {
            // BYLAYER or BYBLOCK
            if (layer && layer.color !== 256) {
                rgb = aciToRgb(layer.color);
            } else {
                rgb = this.isDarkBackground() ? [255, 255, 255] : [0, 0, 0];
            }
        } else {
            rgb = aciToRgb(entity.color);
        }

        rgb = this.adjustColorForVisibility(rgb);
        return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }

    /**
     * Transform world coordinates to screen coordinates
     */
    worldToScreen(x, y) {
        return {
            x: (x - this.viewport.x) * this.viewport.scale + this.viewport.width / 2,
            y: this.viewport.height / 2 - (y - this.viewport.y) * this.viewport.scale
        };
    }

    /**
     * Transform screen coordinates to world coordinates
     */
    screenToWorld(x, y) {
        return {
            x: (x - this.viewport.width / 2) / this.viewport.scale + this.viewport.x,
            y: (this.viewport.height / 2 - y) / this.viewport.scale + this.viewport.y
        };
    }

    /**
     * Clear canvas
     */
    clear() {
        this.ctx.fillStyle = this.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Set highlighted entities (accepts single entity, array, or null)
     */
    setHighlight(entities) {
        this.highlightedEntities.clear();
        if (entities) {
            if (Array.isArray(entities)) {
                entities.forEach(e => this.highlightedEntities.add(e));
            } else {
                this.highlightedEntities.add(entities); // Single entity
            }
        }
    }

    render(entities, layers, linetypes, blocks) {
        this.entities = entities;
        this.layers = new Map(layers.map(l => [l.name, l]));
        this.linetypes = new Map(linetypes.map(lt => [lt.name, lt]));
        this.blocks = blocks || new Map();
        // this.selectionRect state is managed externally by App

        this.clear();

        this.ctx.save();

        for (const entity of entities) {
            const layer = this.layers.get(entity.layer);

            // Skip if layer is hidden OR entity is explicitly hidden
            if ((layer && !layer.visible) || entity.visible === false) continue;

            this.renderEntity(entity, layer);
        }

        // Render Highlighted Entities (Multi-select)
        if (this.highlightedEntities.size > 0) {
            this.ctx.save();
            this.ctx.shadowColor = '#00d9ff';
            this.ctx.shadowBlur = 15;
            this.ctx.lineWidth = 3;

            for (const entity of this.highlightedEntities) {
                const layer = this.layers.get(entity.layer);
                if ((layer && !layer.visible) || entity.visible === false) continue;

                this.renderEntity(entity, null, '#00d9ff', 3);
            }
            this.ctx.restore();
        }

        // Render Highlighted Entity
        if (this.highlightedEntity) {
            this.ctx.save();
            this.ctx.shadowColor = '#00d9ff';
            this.ctx.shadowBlur = 15;
            this.ctx.lineWidth = 3;
            this.renderEntity(this.highlightedEntity, null, '#00d9ff', 3);
            this.ctx.restore();
        }

        // Render snap point if active
        if (this.snapPoint) {
            this.renderSnapPoint(this.snapPoint);
        }

        // Render measurements
        for (const measurement of this.measurements) {
            this.renderMeasurement(measurement);
        }

        // Render Selection Rectangle
        if (this.selectionRect) {
            let p1, p2;
            if (this.selectionRect.p1 && this.selectionRect.p2) {
                p1 = this.selectionRect.p1;
                p2 = this.selectionRect.p2;
            } else if (typeof this.selectionRect.x === 'number') {
                // Convert {x,y,w,h} to p1,p2
                p1 = { x: this.selectionRect.x, y: this.selectionRect.y };
                p2 = { x: this.selectionRect.x + this.selectionRect.width, y: this.selectionRect.y + this.selectionRect.height };
            }

            if (p1 && p2) {
                this.renderSelectionRect(p1, p2, this.measurementColor);
            }
        }
        this.ctx.restore();
    }



    /**
     * Render a single entity
     */
    renderEntity(entity, layer, overrideColor = null, overrideWidth = null) {
        const color = overrideColor || this.getEntityColor(entity, layer);

        switch (entity.type) {
            case 'LINE':
                this.renderLine(entity, color, layer, overrideWidth);
                break;
            case 'CIRCLE':
                this.renderCircle(entity, color, layer, overrideWidth);
                break;
            case 'ARC':
                this.renderArc(entity, color, layer, overrideWidth);
                break;
            case 'LWPOLYLINE':
            case 'POLYLINE':
                this.renderPolyline(entity, color, layer, overrideWidth);
                break;
            case 'TEXT':
                this.renderText(entity, color);
                break;
            case 'MTEXT':
                this.renderText(entity, color);
                break;
            case 'DIMENSION':
                this.renderDimension(entity, color, layer);
                break;
            case 'HATCH':
                this.renderHatch(entity, color);
                break;
            case 'INSERT':
                this.renderInsert(entity, color, layer, overrideWidth);
                break;
            case 'POINT':
                this.renderPoint(entity, color);
                break;
        }
    }

    /**
     * Set linetype pattern
     */
    setLinetype(entity, layer) {
        let linetypeName = entity.lineType;
        if (linetypeName === 'BYLAYER' && layer) {
            linetypeName = layer.lineType;
        }

        const linetype = this.linetypes.get(linetypeName);

        if (!linetype || linetypeName === 'CONTINUOUS' || !linetype.pattern || linetype.pattern.length === 0) {
            this.ctx.setLineDash([]);
            return;
        }

        // Convert pattern to screen space
        const pattern = linetype.pattern.map(p => Math.abs(p) * this.viewport.scale * this.linetypeScale);
        this.ctx.setLineDash(pattern);
    }

    renderLine(entity, color, layer, width = 1) {
        const p1 = this.worldToScreen(entity.x1, entity.y1);
        const p2 = this.worldToScreen(entity.x2, entity.y2);

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width || 1;
        this.setLinetype(entity, layer);

        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();

        this.ctx.setLineDash([]);
    }

    renderCircle(entity, color, layer, width = 1) {
        const center = this.worldToScreen(entity.cx, entity.cy);
        const radius = entity.radius * this.viewport.scale;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width || 1;
        this.setLinetype(entity, layer);

        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.setLineDash([]);
    }



    renderArc(entity, color, layer, width = 1) {
        const center = this.worldToScreen(entity.cx, entity.cy);
        const radius = entity.radius * this.viewport.scale;

        // World (DXF) angle -> Screen angle (Canvas) : negate
        const start = -entity.startAngle * Math.PI / 180;
        const end = -entity.endAngle * Math.PI / 180;

        // IMPORTANT:
        // After negating angles, DO NOT invert ccw again.
        // Use the parser's counterClockwise as-is.
        const ccw = (typeof entity.counterClockwise === 'boolean') ? entity.counterClockwise : true;

        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = width || 1;
        this.setLinetype(entity, layer);

        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, radius, start, end, ccw);
        this.ctx.stroke();

        this.ctx.setLineDash([]);
    }







    // Yardımcı: açıyı 0–2π aralığına al
    normalize(a) {
        while (a < 0) a += Math.PI * 2;
        while (a >= Math.PI * 2) a -= Math.PI * 2;
        return a;
    }

    renderPolyline(entity, color, layer, width = 1) {
        console.log('DEBUG_POLYLINE:', JSON.stringify(entity));
        if (!entity.vertices || entity.vertices.length < 2) return;

        const primitives = this.decomposePolyline(entity);


        for (const primitive of primitives) {
            if (primitive.type === 'LINE') {
                this.renderLine(primitive, color, layer, width);
            } else if (primitive.type === 'ARC') {
                this.renderArc(primitive, color, layer, width);
            }
        }
    }

    /**
     * Decompose a polyline into basic primitives (Lines and Arcs)
     */
    decomposePolyline(entity) {
        const primitives = [];
        const vertices = entity.vertices;
        const closed = entity.closed || (entity.flags & 1) === 1;

        for (let i = 0; i < vertices.length; i++) {
            // Get current and next vertex
            const p1 = vertices[i];
            let p2 = vertices[i + 1];

            // Handle closed loop
            if (!p2) {
                if (closed) {
                    p2 = vertices[0];
                } else {
                    break; // End of open polyline
                }
            }

            // Check for bulge (arc segment)
            // Bulge is stored on the START vertex of the segment
            const bulge = p1.bulge || 0;

            if (Math.abs(bulge) > 1e-10) {
                // It's an ARC
                const arcParams = DXFParser.bulgeToArc(p1, p2, bulge);
                if (arcParams) {
                    primitives.push({
                        type: 'ARC',
                        cx: arcParams.cx,
                        cy: arcParams.cy,
                        radius: arcParams.radius,
                        startAngle: arcParams.startAngle, // Degrees
                        endAngle: arcParams.endAngle,     // Degrees
                        layer: entity.layer,
                        lineType: entity.lineType,
                        color: entity.color,
                        counterClockwise: arcParams.counterClockwise // boolean
                    });


                }

                else {
                    // Fallback to line if arc calc fails
                    primitives.push({
                        type: 'LINE',
                        x1: p1.x, y1: p1.y,
                        x2: p2.x, y2: p2.y,
                        layer: entity.layer,
                        lineType: entity.lineType,
                        color: entity.color
                    });
                }
            } else {
                // It's a LINE
                primitives.push({
                    type: 'LINE',
                    x1: p1.x, y1: p1.y,
                    x2: p2.x, y2: p2.y,
                    layer: entity.layer,
                    lineType: entity.lineType,
                    color: entity.color
                });
            }
        }

        return primitives;
    }


    renderText(entity, color) {
        if (entity.text == null) return;
        const text = entity.text;
        const pos = this.worldToScreen(entity.x, entity.y);
        const height = entity.height * this.viewport.scale; // Fixed size
        this.ctx.fillStyle = color;
        this.ctx.font = `${height}px Arial`;
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'bottom';

        this.ctx.save();
        this.ctx.translate(pos.x, pos.y);
        if (entity.rotation) {
            this.ctx.rotate(-entity.rotation * Math.PI / 180);
        }
        this.ctx.fillText(entity.text, 0, 0);
        this.ctx.restore();
    }

    renderDimension(entity, color, layer) {
        // ... (rest of dimension code) ...
        // Keeping this as is, simplified for brevity in replace helper but in reality we shouldn't delete it.
        // IMPORTANT: The Tool only replaces if exact match. 
        // I will target renderHatch specifically if I can, but I need to insert logDebug helpers.
        // Let's replace the whole file content to be safe and consistent with the user's manual overwrite or just target renderHatch.
        // Actually, replacing the whole file is expensive. I will Target renderHatch specifically.
    }

    // ... skipping other methods for now to focus on renderHatch ...

    renderHatch(entity, color) {
        if (!entity.loops || entity.loops.length === 0) return;

        this.ctx.save();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;

        const shouldFill = entity.solidFill;
        if (shouldFill) {
            this.ctx.fillStyle = color;
            this.ctx.globalAlpha = 0.6;
        } else {
            this.ctx.globalAlpha = 1.0;
        }

        // Draw Loops
        for (let i = 0; i < entity.loops.length; i++) {
            const loop = entity.loops[i];

            // 1. Resolve logical path (Edges -> Ordered Points)
            const result = HatchBoundaryResolver.resolveLoop(loop);

            if (!result || !result.ok || !result.path || result.path.length === 0) continue;
            const path = result.path;

            this.ctx.beginPath();

            // 3. Render Resolved Path
            const p0 = this.worldToScreen(path[0].x1, path[0].y1);
            this.ctx.moveTo(p0.x, p0.y);

            for (let k = 0; k < path.length; k++) {
                const seg = path[k];

                if (seg.type === 'LINE') {
                    const pEnd = this.worldToScreen(seg.x2, seg.y2);
                    this.ctx.lineTo(pEnd.x, pEnd.y);
                } else if (seg.type === 'ARC') {
                    const center = this.worldToScreen(seg.cx, seg.cy);
                    const radius = seg.radius * this.viewport.scale;

                    // Direct rendering as requested - no flips
                    this.ctx.arc(center.x, center.y, radius, seg.startAngle, seg.endAngle, seg.isCounterClockwise);
                }
            }

            this.ctx.closePath();

            // Fill
            if (shouldFill) {
                this.ctx.fill();
            } else {
                if (!this._hatchPattern) {
                    this._hatchPattern = this.createHatchPattern(color);
                }
                const pattern = this.createHatchPattern(color);
                if (pattern) {
                    this.ctx.fillStyle = pattern;
                    this.ctx.globalAlpha = 1.0;
                    this.ctx.fill();
                }
            }
            this.ctx.stroke();
        }

        this.ctx.restore();
    }







    // Helper to create a simple diagonal hatch pattern
    createHatchPattern(color) {
        const size = 10;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.lineCap = 'square';

        // Draw diagonal line (Top-Right to Bottom-Left for ANSI31 style / or TL-BR)
        // ANSI31 is 45 degrees. 
        ctx.beginPath();
        // Line 1
        ctx.moveTo(0, size);
        ctx.lineTo(size, 0);
        ctx.stroke();

        return this.ctx.createPattern(canvas, 'repeat');
    }



    renderInsert(entity, color, layer, overrideWidth) {
        if (!this.blocks) {
            console.warn('Renderer: No blocks map available');
            return;
        }
        const block = this.blocks.get(entity.block);
        if (!block) {
            console.warn(`Renderer: Block "${entity.block}" not found in map`, Array.from(this.blocks.keys()));
            return;
        }
        // console.log(`Renderer: Rendering block "${entity.block}" with ${block.entities.length} entities`);

        // Insert parameters
        const insX = entity.x || 0;
        const insY = entity.y || 0;
        const scaleX = entity.scaleX || 1;
        const scaleY = entity.scaleY || 1;
        const rotation = (entity.rotation || 0) * Math.PI / 180; // Degrees to Radians

        // Precompute Trignometry
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        // Helper for point transformation
        const transformPoint = (x, y) => {
            // Scale
            const sx = x * scaleX;
            const sy = y * scaleY;
            // Rotate
            const rx = sx * cos - sy * sin;
            const ry = sx * sin + sy * cos;
            // Translate
            return {
                x: rx + insX,
                y: ry + insY
            };
        };

        for (const subEntity of block.entities) {
            // Clone to avoid mutating block definition
            // Simple clone - recursive structures might be an issue but basic entities are flat
            const clone = JSON.parse(JSON.stringify(subEntity));

            // DXF Rules: Entities on layer '0' inside block take on INSERT's properties.
            if (clone.layer === '0') {
                clone.layer = entity.layer;
                // Color handling is complex (BYBLOCK vs BYLAYER). 
                // Simplifying: if BYBLOCK (0), inherit.
                if (clone.color === 0) clone.color = entity.color;
            }

            let effectiveLayer = layer;
            if (clone.layer !== entity.layer) {
                effectiveLayer = this.layers.get(clone.layer);
            }

            // Transform Geometry
            if (clone.type === 'LINE') {
                const p1 = transformPoint(clone.x1, clone.y1);
                const p2 = transformPoint(clone.x2, clone.y2);
                clone.x1 = p1.x; clone.y1 = p1.y;
                clone.x2 = p2.x; clone.y2 = p2.y;
            } else if (clone.type === 'LWPOLYLINE' || clone.type === 'POLYLINE') {
                if (clone.vertices) {
                    clone.vertices.forEach(v => {
                        const p = transformPoint(v.x, v.y);
                        v.x = p.x;
                        v.y = p.y;
                    });
                }
            } else if (clone.type === 'CIRCLE') {
                const c = transformPoint(clone.cx, clone.cy);
                clone.cx = c.x;
                clone.cy = c.y;
                clone.radius *= Math.abs(scaleX);
            } else if (clone.type === 'ARC') {
                const c = transformPoint(clone.cx, clone.cy);
                clone.cx = c.x;
                clone.cy = c.y;
                clone.radius *= Math.abs(scaleX);
                clone.startAngle += entity.rotation || 0;
                clone.endAngle += entity.rotation || 0;
            } else if (clone.type === 'HATCH') {
                if (clone.loops) {
                    clone.loops.forEach(loop => {
                        if (loop.isPolyline) {
                            loop.vertices.forEach(v => {
                                const p = transformPoint(v.x, v.y);
                                v.x = p.x;
                                v.y = p.y;
                            });
                        } else if (loop.edges) {
                            loop.edges.forEach(edge => {
                                if (edge.type === 1) { // Line
                                    const p1 = transformPoint(edge.x1, edge.y1);
                                    const p2 = transformPoint(edge.x2, edge.y2);
                                    edge.x1 = p1.x; edge.y1 = p1.y;
                                    edge.x2 = p2.x; edge.y2 = p2.y;
                                } else if (edge.type === 2) { // Arc
                                    const c = transformPoint(edge.cx, edge.cy);
                                    edge.cx = c.x;
                                    edge.cy = c.y;
                                    edge.radius *= Math.abs(scaleX);
                                    edge.startAngle += entity.rotation || 0;
                                    edge.endAngle += entity.rotation || 0;
                                }
                            });
                        }
                    });
                }
            }

            // Recursive render
            this.renderEntity(clone, effectiveLayer, null, overrideWidth);
        }
    }

    renderPoint(entity, color) {
        const pos = this.worldToScreen(entity.x, entity.y);

        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
        this.ctx.fill();
    }

    renderSnapPoint(snap) {
        const pos = this.worldToScreen(snap.point.x, snap.point.y);

        this.ctx.strokeStyle = '#00ff00';
        this.ctx.lineWidth = 2;
        this.ctx.fillStyle = '#00ff00';

        // Different shapes for different snap types
        switch (snap.type) {
            case 'endpoint':
                this.ctx.strokeRect(pos.x - 6, pos.y - 6, 12, 12);
                break;
            case 'midpoint':
                this.ctx.beginPath();
                this.ctx.moveTo(pos.x - 6, pos.y);
                this.ctx.lineTo(pos.x, pos.y - 6);
                this.ctx.lineTo(pos.x + 6, pos.y);
                this.ctx.lineTo(pos.x, pos.y + 6);
                this.ctx.closePath();
                this.ctx.stroke();
                break;
            case 'center':
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
                this.ctx.stroke();
                break;
            case 'quadrant':
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
                this.ctx.moveTo(pos.x - 8, pos.y);
                this.ctx.lineTo(pos.x + 8, pos.y);
                this.ctx.moveTo(pos.x, pos.y - 8);
                this.ctx.lineTo(pos.x, pos.y + 8);
                this.ctx.stroke();
                break;
            case 'intersection':
                this.ctx.beginPath();
                this.ctx.moveTo(pos.x - 6, pos.y - 6);
                this.ctx.lineTo(pos.x + 6, pos.y + 6);
                this.ctx.moveTo(pos.x + 6, pos.y - 6);
                this.ctx.lineTo(pos.x - 6, pos.y + 6);
                this.ctx.stroke();
                break;
            case 'perpendicular':
                this.ctx.beginPath();
                // Draw ⊥ symbol
                this.ctx.moveTo(pos.x, pos.y - 6);
                this.ctx.lineTo(pos.x, pos.y + 2);
                this.ctx.moveTo(pos.x - 5, pos.y + 2);
                this.ctx.lineTo(pos.x + 5, pos.y + 2);
                this.ctx.stroke();

                // Draw virtual extension line if it's a projection outside the segment
                if (snap.isProjection && snap.entity) {
                    this.ctx.save();
                    this.ctx.setLineDash([2, 4]);
                    this.ctx.strokeStyle = '#aaaaaa';
                    this.ctx.lineWidth = 1;
                    this.ctx.beginPath();
                    // Draw line from snap point to nearest endpoint of entity
                    // Calculate entity endpoints in screen space
                    if (snap.entity.type === 'LINE') {
                        const p1 = this.worldToScreen(snap.entity.x1, snap.entity.y1);
                        const p2 = this.worldToScreen(snap.entity.x2, snap.entity.y2);
                        const d1 = Math.hypot(pos.x - p1.x, pos.y - p1.y);
                        const d2 = Math.hypot(pos.x - p2.x, pos.y - p2.y);

                        this.ctx.moveTo(pos.x, pos.y);
                        this.ctx.lineTo(d1 < d2 ? p1.x : p2.x, d1 < d2 ? p1.y : p2.y);
                        this.ctx.stroke();
                    }
                    this.ctx.restore();
                }
                break;
            default:
                this.ctx.fillRect(pos.x - 3, pos.y - 3, 6, 6);
        }
    }

    /**
     * Helper to calculate dimension geometry (Lines, Text Pos)
     * Used by both Renderer and Hit-Testing
     */
    calculateDimensionGeometry(entity) {
        if (entity.pt1X === undefined || entity.pt2X === undefined || entity.defX === undefined) return null;

        // World coordinates
        const p1 = { x: entity.pt1X, y: entity.pt1Y };
        const p2 = { x: entity.pt2X, y: entity.pt2Y };
        const def = { x: entity.defX, y: entity.defY };

        // Screen coordinates
        const sP1 = this.worldToScreen(p1.x, p1.y);
        const sP2 = this.worldToScreen(p2.x, p2.y);
        const sDef = this.worldToScreen(def.x, def.y);

        let angle;
        // Check if Linear (Rotated)
        const dimType = entity.dimType & 7;
        const isRotated = (dimType === 0) && (typeof entity.rotation === 'number');

        if (isRotated) {
            angle = -entity.rotation * Math.PI / 180;
        } else {
            angle = Math.atan2(sP2.y - sP1.y, sP2.x - sP1.x);
        }

        const nx = -Math.sin(angle);
        const ny = Math.cos(angle);

        // Projection of sP1 onto Line(sDef, angle)
        const dist1 = (sP1.x - sDef.x) * nx + (sP1.y - sDef.y) * ny;
        const d1 = { x: sP1.x - dist1 * nx, y: sP1.y - dist1 * ny };

        const dist2 = (sP2.x - sDef.x) * nx + (sP2.y - sDef.y) * ny;
        const d2 = { x: sP2.x - dist2 * nx, y: sP2.y - dist2 * ny };

        // Midpoint for text
        const midX = (d1.x + d2.x) / 2;
        const midY = (d1.y + d2.y) / 2;

        return { sP1, sP2, d1, d2, angle, midX, midY };
    }

    renderDimension(entity, color, layer) {
        if (entity.pt1X === undefined || entity.pt2X === undefined || entity.defX === undefined) return;

        // World coordinates
        const p1 = { x: entity.pt1X, y: entity.pt1Y };
        const p2 = { x: entity.pt2X, y: entity.pt2Y };
        const def = { x: entity.defX, y: entity.defY };

        // Screen coordinates
        const sP1 = this.worldToScreen(p1.x, p1.y);
        const sP2 = this.worldToScreen(p2.x, p2.y);
        const sDef = this.worldToScreen(def.x, def.y);

        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([]); // Solid lines for dims

        // Calculate geometry in World Space then project? 
        // Or Screen Space? Screen space is easier for offset pixels, but World is better for accuracy.
        // Let's use Screen Space logic similar to renderMeasurement, but derived from Def point.

        let angle;
        // Check if Linear (Rotated)
        // dimType & 7 === 0 is Linear/Rotated. 
        // If entity.rotation is defined (code 50), it defines the angle of the dimension line.
        const dimType = entity.dimType & 7;
        const isRotated = (dimType === 0) && (typeof entity.rotation === 'number');

        if (isRotated) {
            // Rotation is in degrees CCW from X axis.
            // We need screen angle. 
            // World angle: entity.rotation
            // Screen angle: depends on Y-flip.
            // If World Y increases Up, Screen Y increases Down.
            // So +World Angle -> -Screen Angle.
            angle = -entity.rotation * Math.PI / 180;
        } else {
            // Aligned: Angle of P1-P2
            angle = Math.atan2(sP2.y - sP1.y, sP2.x - sP1.x);
        }

        // Calculate Dimension Line
        // It passes through sDef and has 'angle'.
        // Project sP1 and sP2 onto this line to find intersection points (Ext1 start, Ext2 start on DimLine)

        // Normal vector to dim line
        const nx = -Math.sin(angle);
        const ny = Math.cos(angle);

        // Line equation: (P - sDef) dot N = 0
        // Distance from Point Q to line: (Q - sDef) dot N
        // We want to project P1 along PERPENDICULAR to dim line? 
        // No, extension lines are perpendicular to the Dim Line.
        // So the intersection points D1, D2 are the projections of P1, P2 onto the line passing through Def with 'angle'.

        // Projection of P onto Line(Def, angle):
        // D = P - (current distance to line) * Normal
        // Dist = (P - Def) dot Normal

        const dist1 = (sP1.x - sDef.x) * nx + (sP1.y - sDef.y) * ny;
        const d1 = { x: sP1.x - dist1 * nx, y: sP1.y - dist1 * ny };

        const dist2 = (sP2.x - sDef.x) * nx + (sP2.y - sDef.y) * ny;
        const d2 = { x: sP2.x - dist2 * nx, y: sP2.y - dist2 * ny };

        // Draw Extension Lines
        // From P1 to D1 + overshoot
        // From P2 to D2 + overshoot
        // Draw Extension Lines
        // Calculate scaled sizes based on viewport
        const scaleFactor = this.textScale * this.viewport.scale;
        const overshoot = scaleFactor * 0.6; // Proportional overshoot

        function drawExt(p, d) {
            const dx = d.x - p.x;
            const dy = d.y - p.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.1) return;
            const ox = (dx / len) * overshoot;
            const oy = (dy / len) * overshoot;
            this.ctx.beginPath();
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(d.x + ox, d.y + oy);
            this.ctx.stroke();
        }

        drawExt.call(this, sP1, d1);
        drawExt.call(this, sP2, d2);

        // Draw Dimension Line (between D1 and D2)
        this.ctx.beginPath();
        this.ctx.moveTo(d1.x, d1.y);
        this.ctx.lineTo(d2.x, d2.y);
        this.ctx.stroke();

        // Calculate actual angle of the dimension line segment for arrows
        // This ensures arrows always point outward regardless of P1/P2 order relative to rotation
        const arrowAngle = Math.atan2(d2.y - d1.y, d2.x - d1.x);

        // Draw Arrows at D1, D2
        const arrowSize = scaleFactor; // Match text size
        this.drawArrow(d1, arrowAngle + Math.PI, arrowSize);
        this.drawArrow(d2, arrowAngle, arrowSize);

        // Text
        console.log("DIMENSION ENTITY:", entity);
        let textVal = entity.text;
        let isOverridden = false;
        if (!textVal || textVal === '<>') {
            // Calc distance
            // If rotated, distance is projected distance? 
            // Standard is distance between extension origins projected on dim line
            // Screen distance / scale
            const worldDist = Math.sqrt(Math.pow((d2.x - d1.x) / this.viewport.scale, 2) + Math.pow((d2.y - d1.y) / this.viewport.scale, 2));
            textVal = worldDist.toFixed(2);
        } else if (textVal.includes('<>')) {
            const dist = Math.sqrt(Math.pow(entity.pt2X - entity.pt1X, 2) + Math.pow(entity.pt2Y - entity.pt1Y, 2));
            textVal = textVal.replace('<>', dist.toFixed(2));
            // Remove formatting codes like \P, \A1; etc roughly
            textVal = textVal.replace(/\\[A-Za-z0-9]+;/g, '');
        } else {
            isOverridden = true;
            // Remove formatting codes like \P, \A1; etc roughly
            textVal = textVal.replace(/\\[A-Za-z0-9]+;/g, '');
        }

        if (textVal) {
            textVal = textVal.replace(/%%d/gi, '°');
            textVal = textVal.replace(/%%p/gi, '±');
            textVal = textVal.replace(/%%c/gi, 'Ø');
        }

        // Text pos: middle of D1-D2, or entity.midX/midY if present
        // Use calculated mid for now for consistency
        const midX = (d1.x + d2.x) / 2;
        const midY = (d1.y + d2.y) / 2;

        this.ctx.save();
        this.ctx.translate(midX, midY);
        let textAngle = angle;
        if (textAngle > Math.PI / 2 || textAngle <= -Math.PI / 2) {
            textAngle += Math.PI;
        }
        this.ctx.rotate(textAngle);
        this.ctx.font = `${this.textScale * this.viewport.scale}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        if (isOverridden) {
            this.ctx.fillStyle = 'red';
        }
        this.ctx.fillText(textVal, 0, -3);
        this.ctx.restore();
    }

    renderMeasurement(measurement) {
        if (measurement.type === 'distance' && measurement.points.length === 2) {
            const p1 = this.worldToScreen(measurement.points[0].x, measurement.points[0].y);
            const p2 = this.worldToScreen(measurement.points[1].x, measurement.points[1].y);

            // Smart Guides removed by user request (cleaner UI)            

            const isSelected = this.selectedMeasurement === measurement || this.highlightedEntities.has(measurement);
            const color = isSelected ? '#00d9ff' : this.measurementColor;

            this.ctx.strokeStyle = color;
            this.ctx.fillStyle = color;
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([]); // Solid line

            // Calculate metrics (World P1->P2)
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const pointsAngle = Math.atan2(dy, dx);
            const len = Math.sqrt(dx * dx + dy * dy);

            if (len === 0) return;

            // Calculate Geometry based on Mode
            let d1, d2; // Points on the dimension line
            let textAngle = 0;
            let arrowAngle = pointsAngle;

            // Track bounds for screen hit test
            let minX = Math.min(p1.x, p2.x);
            let maxX = Math.max(p1.x, p2.x);
            let minY = Math.min(p1.y, p2.y);
            let maxY = Math.max(p1.y, p2.y);

            if (measurement.smartMode === 'horizontal') {
                // Linear Horizontal Dimension (Measure X)
                const placementY = measurement.placementPoint
                    ? this.worldToScreen(measurement.placementPoint.x, measurement.placementPoint.y).y
                    : p1.y - 40;

                d1 = { x: p1.x, y: placementY };
                d2 = { x: p2.x, y: placementY };
                textAngle = 0;
                arrowAngle = 0;

            } else if (measurement.smartMode === 'vertical') {
                // Linear Vertical Dimension (Measure Y)
                const placementX = measurement.placementPoint
                    ? this.worldToScreen(measurement.placementPoint.x, measurement.placementPoint.y).x
                    : p1.x - 40;

                d1 = { x: placementX, y: p1.y };
                d2 = { x: placementX, y: p2.y };
                textAngle = -Math.PI / 2;
                arrowAngle = -Math.PI / 2;

            } else {
                // Aligned Dimension (Default)
                const nx = -dy / len;
                const ny = dx / len;
                let offsetDist = 40;

                if (measurement.placementPoint) {
                    const placement = this.worldToScreen(measurement.placementPoint.x, measurement.placementPoint.y);
                    const vpx = placement.x - p1.x;
                    const vpy = placement.y - p1.y;
                    offsetDist = vpx * nx + vpy * ny;
                }

                d1 = { x: p1.x + nx * offsetDist, y: p1.y + ny * offsetDist };
                d2 = { x: p2.x + nx * offsetDist, y: p2.y + ny * offsetDist };

                textAngle = pointsAngle;
                arrowAngle = pointsAngle;

                // Keep text upright
                if (textAngle > Math.PI / 2 || textAngle <= -Math.PI / 2) {
                    textAngle += Math.PI;
                }
            }

            // Update bounds with dim line points
            minX = Math.min(minX, d1.x, d2.x);
            maxX = Math.max(maxX, d1.x, d2.x);
            minY = Math.min(minY, d1.y, d2.y);
            maxY = Math.max(maxY, d1.y, d2.y);

            // Save for hit testing (with padding)
            measurement._screenBounds = {
                minX: minX - 15,
                maxX: maxX + 15,
                minY: minY - 15,
                maxY: maxY + 15
            };

            // Draw Extension Lines (Generic: Object Point -> Dimension Point + Overshoot)
            const overshoot = 10;
            this.ctx.beginPath();

            // Ext 1
            const v1x = d1.x - p1.x;
            const v1y = d1.y - p1.y;
            const dist1 = Math.sqrt(v1x * v1x + v1y * v1y);
            if (dist1 > 0) {
                this.ctx.moveTo(p1.x, p1.y);
                this.ctx.lineTo(d1.x + (v1x / dist1) * overshoot, d1.y + (v1y / dist1) * overshoot);
            } else {
                // Even if on top, might want overshoot? 
                // If dist is 0, vector is undefined. Use specific direction based on mode?
                // For now, skip if coincident.
            }

            // Ext 2
            const v2x = d2.x - p2.x;
            const v2y = d2.y - p2.y;
            const dist2 = Math.sqrt(v2x * v2x + v2y * v2y);
            if (dist2 > 0) {
                this.ctx.moveTo(p2.x, p2.y);
                this.ctx.lineTo(d2.x + (v2x / dist2) * overshoot, d2.y + (v2y / dist2) * overshoot);
            }
            this.ctx.stroke();

            // Draw Dimension Line
            this.ctx.beginPath();
            this.ctx.moveTo(d1.x, d1.y);
            this.ctx.lineTo(d2.x, d2.y);
            this.ctx.stroke();

            // Draw Arrows
            const scaledSize = this.textScale * this.viewport.scale;
            const arrowSize = scaledSize; // Scaled Arrow
            // Angle vector d1->d2
            const dimAngle = Math.atan2(d2.y - d1.y, d2.x - d1.x);

            this.drawArrow(d1, dimAngle + Math.PI, arrowSize); // Pointing to d1
            this.drawArrow(d2, dimAngle, arrowSize);           // Pointing to d2

            // Draw Text
            this.ctx.save();
            // Midpoint
            const midX = (d1.x + d2.x) / 2;
            const midY = (d1.y + d2.y) / 2;
            this.ctx.translate(midX, midY);

            this.ctx.rotate(textAngle);

            this.ctx.font = `bold ${scaledSize}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'bottom';
            // Offset text slightly above line (proportional)
            this.ctx.fillText(measurement.value.toFixed(2), 0, -(scaledSize * 0.4));
            this.ctx.restore();
        } else if (measurement.type === 'angle') {
            this.renderAngleMeasurement(measurement);
        }
    }

    renderAngleMeasurement(measurement) {
        // measurement = { type: 'angle', lines: [line1, line2], value: val, label: "...",
        //                 center: {x,y}, startAngle: rad, endAngle: rad, radius: r, isPreview: bool }

        // If simple click (no 3rd step yet), we might not have center/radius/angles calculated for display
        // The MeasurementTools should provide these in the preview object.
        if (!measurement.center) return;

        const center = this.worldToScreen(measurement.center.x, measurement.center.y);
        const radius = measurement.radius * this.viewport.scale;
        // Angles are in World Radians. World Y up.
        // Screen Y down. So Screen Angle = -World Angle.
        // Canvas Arc takes screen angles.
        // Also check AntiClockwise.
        // Typically World Angle increases CCW. Screen Angle increases CW (visual).
        // So startScreen = -startWorld. endScreen = -endWorld.
        // And draw "anticlockwise" = true to match World CCW?
        // Let's rely on standard logic: start -> end.
        // If we want the inner angle, we draw from start to end.

        let start = -measurement.startAngle;
        let end = -measurement.endAngle;

        const anticlockwise = true; // World CCW

        this.ctx.save();
        this.ctx.strokeStyle = this.measurementColor;
        this.ctx.fillStyle = this.measurementColor;
        this.ctx.lineWidth = 1.5;

        // Draw Arc
        this.ctx.beginPath();
        // ctx.arc(x, y, radius, startAngle, endAngle, counterclockwise)
        // Note: browser arc angles are clockwise if false, counter-clockwise if true.
        this.ctx.arc(center.x, center.y, radius, start, end, anticlockwise);
        this.ctx.stroke();

        // Draw Arrows
        // Start Arrow (at startAngle)
        // Tangent direction at start: perpendicular to radius.
        // Arrow should point OUT from arc line? Or along the arc?
        // Dimensions usually have arrows at ends pointing OUTWARDS or INWARDS.
        // Let's point them 'outwards' effectively meaning 'towards the end of the arc segment at that point'
        // Tangent at Start:
        // Angle + 90deg?
        // For visual simplicity, just point along the tangent.
        // Tangent at theta is theta + PI/2.
        // At start (moving ccw from start), direction is start + PI/2. But arrow points TO start.
        // So arrow angle = start - PI/2?
        // Try simple approach: Align arrow with tangent.
        // Tip is at (radius, start).
        const startTip = {
            x: center.x + radius * Math.cos(start),
            y: center.y + radius * Math.sin(start)
        };
        const endTip = {
            x: center.x + radius * Math.cos(end),
            y: center.y + radius * Math.sin(end)
        };

        const scaledSize = this.textScale * this.viewport.scale;
        const arrowSize = scaledSize; // Scaled Arrow
        // Arrow rotation:
        // Screen Space Tangent.
        // For CCW arc: at start, tangent points "backwards"?
        // Standard Dim: <--->
        // At Start, arrow points towards End (CW?).
        // At End, arrow points towards Start (CCW?).
        // Tangent of circle at theta is theta +/- 90.
        // Start Arrow: Points CW. End Arrow: Points CCW.
        // Screen Angles:
        // Tangent = Angle + PI/2.
        // Start Arrow Angle = start + PI/2.
        // End Arrow Angle = end - PI/2.

        this.drawArrow(startTip, start + Math.PI / 2 + Math.PI, arrowSize); // Pointing CW
        this.drawArrow(endTip, end - Math.PI / 2 + Math.PI, arrowSize);     // Pointing CCW

        // Text
        this.ctx.font = `bold ${scaledSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        // Calculate correct mid-angle for text placement
        // Since we draw with anticlockwise = true (decreasing angle from start to end in screen coords),
        // we must ensure diff is negative (or zero).
        let diff = end - start;
        while (diff > 0) diff -= 2 * Math.PI;
        while (diff < -2 * Math.PI) diff += 2 * Math.PI;

        const effectiveStart = start;
        let midAngle = effectiveStart + diff / 2;

        // Removed redundant midAngle += Math.PI lines

        const textRadius = radius + (scaledSize * 1.5);
        const textPos = {
            x: center.x + textRadius * Math.cos(midAngle),
            y: center.y + textRadius * Math.sin(midAngle)
        };

        this.ctx.fillText(`${measurement.value.toFixed(1)}°`, textPos.x, textPos.y);
        this.ctx.restore();
    }

    renderSelectionRect(rect) {
        if (!rect) return;
        // rect: { x, y, width, height } (Screen Coordinates)

        this.ctx.save();

        const isCrossing = rect.width < 0; // Standard CAD convention: Left->Right (Window, Blue), Right->Left (Crossing, Green)

        if (isCrossing) {
            // Crossing (Green)
            this.ctx.strokeStyle = '#00ff00'; // Green
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
            this.ctx.setLineDash([5, 5]); // Dashed
        } else {
            // Window (Blue)
            this.ctx.strokeStyle = '#00aaff'; // Blue
            this.ctx.fillStyle = 'rgba(0, 170, 255, 0.1)';
            this.ctx.setLineDash([]); // Solid
        }

        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.rect(rect.x, rect.y, rect.width, rect.height);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }

    /**
     * Draw an arrow tip
     */
    drawArrow(tip, angle, size) {
        this.ctx.beginPath();
        // Sharper arrow (20 degrees)
        this.ctx.moveTo(tip.x, tip.y);
        this.ctx.lineTo(
            tip.x - size * Math.cos(angle - Math.PI / 9),
            tip.y - size * Math.sin(angle - Math.PI / 9)
        );
        this.ctx.lineTo(
            tip.x - size * Math.cos(angle + Math.PI / 9),
            tip.y - size * Math.sin(angle + Math.PI / 9)
        );
        this.ctx.closePath();
        this.ctx.fill();
    }

    /**
     * Calculate bounding box of all entities
     */
    getBounds() {
        if (this.entities.length === 0) {
            return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
        }

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const entity of this.entities) {
            const bounds = this.getEntityBounds(entity);
            if (bounds) {
                minX = Math.min(minX, bounds.minX);
                maxX = Math.max(maxX, bounds.maxX);
                minY = Math.min(minY, bounds.minY);
                maxY = Math.max(maxY, bounds.maxY);
            }
        }

        return { minX, maxX, minY, maxY };
    }

    getEntityBounds(entity) {
        switch (entity.type) {
            case 'LINE':
                return {
                    minX: Math.min(entity.x1, entity.x2),
                    maxX: Math.max(entity.x1, entity.x2),
                    minY: Math.min(entity.y1, entity.y2),
                    maxY: Math.max(entity.y1, entity.y2)
                };
            case 'CIRCLE':
                return {
                    minX: entity.cx - entity.radius,
                    maxX: entity.cx + entity.radius,
                    minY: entity.cy - entity.radius,
                    maxY: entity.cy + entity.radius
                };
            case 'ARC':
                return {
                    minX: entity.cx - entity.radius,
                    maxX: entity.cx + entity.radius,
                    minY: entity.cy - entity.radius,
                    maxY: entity.cy + entity.radius
                };
            case 'LWPOLYLINE':
            case 'POLYLINE':
                if (!entity.vertices || entity.vertices.length === 0) return null;
                const xs = entity.vertices.map(v => v.x);
                const ys = entity.vertices.map(v => v.y);
                return {
                    minX: Math.min(...xs),
                    maxX: Math.max(...xs),
                    minY: Math.min(...ys),
                    maxY: Math.max(...ys)
                };
            case 'TEXT':
            case 'MTEXT':
                return {
                    minX: entity.x,
                    maxX: entity.x + 10,
                    minY: entity.y,
                    maxY: entity.y + 10
                };
            case 'POINT':
                return {
                    minX: entity.x,
                    maxX: entity.x,
                    minY: entity.y,
                    maxY: entity.y
                };
            case 'HATCH':
                if (!entity.loops || entity.loops.length === 0) return null;
                let hMinX = Infinity, hMinY = Infinity, hMaxX = -Infinity, hMaxY = -Infinity;
                let hasValid = false;

                entity.loops.forEach(loop => {
                    const res = HatchBoundaryResolver.resolveLoop(loop);
                    if (res && res.ok && res.path) {
                        res.path.forEach(seg => {
                            hasValid = true;
                            if (seg.type === 'LINE') {
                                hMinX = Math.min(hMinX, seg.x1, seg.x2);
                                hMaxX = Math.max(hMaxX, seg.x1, seg.x2);
                                hMinY = Math.min(hMinY, seg.y1, seg.y2);
                                hMaxY = Math.max(hMaxY, seg.y1, seg.y2);
                            } else if (seg.type === 'ARC') {
                                hMinX = Math.min(hMinX, seg.cx - seg.radius);
                                hMaxX = Math.max(hMaxX, seg.cx + seg.radius);
                                hMinY = Math.min(hMinY, seg.cy - seg.radius);
                                hMaxY = Math.max(hMaxY, seg.cy + seg.radius);
                            }
                        });
                    }
                });

                if (!hasValid) return null;
                return {
                    minX: hMinX,
                    maxX: hMaxX,
                    minY: hMinY,
                    maxY: hMaxY
                };
            case 'DIMENSION':
                // Bounds based on definition points (handling various parser formats)
                let dMinX = Infinity, dMinY = Infinity, dMaxX = -Infinity, dMaxY = -Infinity;
                const points = [];

                // Format 1: pt1X/Y, pt2X/Y, defX/Y (used in renderDimension)
                if (entity.pt1X !== undefined) points.push({ x: entity.pt1X, y: entity.pt1Y });
                if (entity.pt2X !== undefined) points.push({ x: entity.pt2X, y: entity.pt2Y });
                if (entity.defX !== undefined) points.push({ x: entity.defX, y: entity.defY });

                // Format 2: defPoint object (Standard DXF Parser)
                if (entity.defPoint) points.push(entity.defPoint);
                if (entity.textMidpoint) points.push(entity.textMidpoint);
                if (entity.insertionPoint) points.push(entity.insertionPoint);

                // If parser provides extents, use them
                if (entity.minX !== undefined) return { minX: entity.minX, maxX: entity.maxX, minY: entity.minY, maxY: entity.maxY };

                if (points.length === 0) return null;

                points.forEach(p => {
                    dMinX = Math.min(dMinX, p.x);
                    dMaxX = Math.max(dMaxX, p.x);
                    dMinY = Math.min(dMinY, p.y);
                    dMaxY = Math.max(dMaxY, p.y);
                });

                // Add margins for text/arrows
                return {
                    minX: dMinX,
                    maxX: dMaxX,
                    minY: dMinY,
                    maxY: dMaxY
                };
        }
        return null;
    }
    /**
     * Renders the selection rectangle.
     * @param {Object} p1 Screen coordinates of start point {x, y}
     * @param {Object} p2 Screen coordinates of current point {x, y}
     * @param {String} baseColor Hex or RGB string for the line color
     */
    renderSelectionRect(p1, p2, baseColor) {
        if (!p1 || !p2) return;

        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p1.x - p2.x);
        const h = Math.abs(p1.y - p2.y);

        // Determine Mode
        // Window (Blue): p1.x < p2.x
        // Crossing (Green): p1.x > p2.x
        const isCrossing = p1.x > p2.x;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(x, y, w, h);

        this.ctx.strokeStyle = baseColor;
        this.ctx.lineWidth = 1;

        if (isCrossing) {
            // CROSSING: Dashed Line, Green Fill
            this.ctx.setLineDash([5, 5]);
            this.ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
        } else {
            // WINDOW: Solid Line, Blue Fill
            this.ctx.setLineDash([]);
            this.ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
        }

        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
    }
}
