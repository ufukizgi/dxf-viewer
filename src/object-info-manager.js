
import * as THREE from 'three';
import { STANDARTS, calculateTolerance, calculateOpenEndTolerance } from './tolerances.js';

export class ObjectInfoManager {
    constructor(viewer, measurementManager, app) {
        this.viewer = viewer;
        this.measurementManager = measurementManager;
        this.app = app;
        this.container = document.getElementById('measurement-result');
    }

    update(objects, context = null) {
        if (!this.container) return;

        if (!objects || objects.length === 0) {
            this.renderEmpty();
        } else if (objects.length === 1) {
            this.renderSingleObject(objects[0], context);
        } else {
            this.renderMultiObject(objects);
        }
    }

    renderEmpty() {
        this.container.innerHTML = '<p class="empty-state">Click an object to view info</p>';
    }

    clear() {
        this.renderEmpty();

        // Reset Section State
        this.isSectionActive = false;
        this.activeSection = null;
        this.activeSectionObject = null;
        this.sectionCapSize = null; // Reset cached size

        // Ensure visual helper is removed
        if (this.viewer && this.viewer.sectionHelper) {
            this.viewer.scene.remove(this.viewer.sectionHelper);
            if (this.viewer.sectionHelper.geometry) this.viewer.sectionHelper.geometry.dispose();
            if (this.viewer.sectionHelper.material) this.viewer.sectionHelper.material.dispose();
            this.viewer.sectionHelper = null;
        }

        // Reset renderer clipping - CRITICAL for restoring visibility
        if (this.viewer && this.viewer.renderer) {
            this.viewer.renderer.clippingPlanes = [];
            this.viewer.renderer.localClippingEnabled = false;
            console.log('[ObjectInfo] Cleared renderer clipping planes');

            // CRITICAL: Clear clipping from ALL materials in the scene
            // Three.js may cache clipping planes on materials
            if (this.viewer.scene) {
                this.viewer.scene.traverse((child) => {
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                mat.clippingPlanes = [];
                            });
                        } else {
                            child.material.clippingPlanes = [];
                        }
                    }
                });
                console.log('[ObjectInfo] Cleared all material clipping planes');
            }

            // Force immediate re-render to show changes
            if (this.viewer.scene && this.viewer.camera) {
                this.viewer.renderer.render(this.viewer.scene, this.viewer.camera);
                console.log('[ObjectInfo] Forced render - part should be fully visible now');
            }
        }
    }

    t(key) {
        return this.viewer.languageManager ? this.viewer.languageManager.translate(key) : key;
    }

    renderSingleObject(object, context = null) {
        let content = '';
        const entity = object.userData.entity;

        // Handle Dimensions (Measurement Visuals)
        if (object.userData.type === 'DIMENSION' || (object.parent && object.parent.userData.type === 'DIMENSION')) {
            // If child is clicked, check parent
            const dimObj = object.userData.type === 'DIMENSION' ? object : object.parent;
            const val = dimObj.userData.value;
            // Value might be string (dist) or number?
            // Assuming formatted string or number.
            content += this.row(this.t('dimensionValue'), val);
            // Maybe Type?
            content += this.row(this.t('Type'), 'Dimension');

            if (dimObj.userData.isUserDefined) {
                content += this.getToleranceHTML(dimObj.userData.tolerance);
            }

            this.container.innerHTML = content;

            if (dimObj.userData.isUserDefined) {
                this.bindToleranceEvents(dimObj);
            }
            return;
        }

        // Basic Info
        let type = object.userData.type || 'Unknown';
        if (object.isGroup) type = 'Polyline/Group'; // Refined Polyline Group

        // 3D Mesh Handling
        if (object.isMesh && !object.userData.entity) {
            const geo = object.geometry;
            content += '<div class="info-header"><strong>3D Mesh (Face)</strong></div>';
            content += this.row('ThreeJS ID', object.id);
            // content += this.row('UUID', object.uuid.substring(0, 8));
            if (object.userData.faceId !== undefined) {
                content += this.row('Face ID', object.userData.faceId);
            }
            if (geo.attributes.position) {
                content += this.row('Vertices', geo.attributes.position.count);
                const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
                content += this.row('Triangles', Math.floor(triCount));
            }

            // Area Calculation
            const area = this.calculateMeshArea(object);
            content += this.row('Surface Area', area.toFixed(2) + ' mm²');

            // content += `<button id="btn-extract-face" ...>Copy Face to 2D</button>`; // Removed as per request (Ctrl+C works)

            content += `<div class="mt-3 pt-2 border-t border-white/10">`;
            content += `<div class="flex items-center gap-2 mb-2">`;
            content += `<span class="text-xs text-gray-400">Offset:</span>`;
            content += `<input type="number" id="section-offset" value="0.0" step="1.0" class="flex-1 min-w-[50px] bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-white text-right font-mono focus:outline-none focus:border-purple-500">`;

            // Flip Button using ⇌ symbol
            // Inline style for checked state coloring to match theme
            content += `<style>#section-flip:checked + label { background-color: #9333ea !important; border-color: #9333ea !important; color: white !important; }</style>`;
            content += `<input type="checkbox" id="section-flip" class="hidden" checked>`;
            content += `<label for="section-flip" class="cursor-pointer h-7 w-8 flex items-center justify-center bg-black/20 border border-white/10 rounded hover:bg-white/5 transition-colors text-white select-none text-base font-bold" title="Flip Direction" data-i18n-title="flipSection">`;
            content += `⇌`;
            content += `</label>`;
            content += `</div>`;

            content += `<button id="btn-section-face" class="w-full bg-purple-600 hover:bg-purple-500 text-white text-xs py-1.5 rounded transition-colors" data-id="${object.id}" data-i18n="createSection">Create Section</button>`;
            content += `</div>`;

            // Extract Section (Intersection) Button
            content += `<button id="btn-extract-section" class="w-full mt-2 bg-green-600 hover:bg-green-500 text-white text-xs py-1.5 rounded transition-colors" data-id="${object.id}" data-i18n="copySectionProfile">Copy Section Profile</button>`;

            this.container.innerHTML = content;

            // CRITICAL: Trigger translation update for the newly added dynamic content
            if (this.app && this.app.languageManager) {
                this.app.languageManager.updateUI();
            }

            setTimeout(() => {
                const btnSection = document.getElementById('btn-section-face');
                const inputOffset = document.getElementById('section-offset');
                const inputFlip = document.getElementById('section-flip');

                if (btnSection && inputOffset) {
                    const update = () => {
                        const val = parseFloat(inputOffset.value) || 0;
                        const flip = inputFlip ? inputFlip.checked : false;

                        if (!this.isSectionActive || this.activeSectionObject !== object) {
                            // Pass context when activating - context has the clicked face/point
                            this.activateSection(object, context);
                        } else {
                            this.updateSectionOffset(val, null, flip);
                        }
                    };

                    btnSection.onclick = update;
                    inputOffset.addEventListener('input', update);
                    // Generate Cap Mesh on Drag End (Change)
                    inputOffset.addEventListener('change', () => {
                        this.updateSectionOffset(parseFloat(inputOffset.value), null, inputFlip ? inputFlip.checked : false, true);
                    });

                    if (inputFlip) {
                        inputFlip.addEventListener('change', () => {
                            update();
                            this.updateSectionOffset(parseFloat(inputOffset.value), null, inputFlip.checked, true);
                        });
                    }
                }

                // Extract Button
                const btnExtractParams = document.getElementById('btn-extract-section');
                if (btnExtractParams) {
                    btnExtractParams.addEventListener('click', () => {
                        // Ensure section is active to get correct plane
                        if (!this.isSectionActive || this.activeSectionObject !== object) {
                            this.activateSection(object);
                        }
                        // Small delay to ensure activeSection is updated if just activated
                        setTimeout(() => this.extractSectionProfile(true), 10);
                    });
                }
            }, 0);
            return;
        }

        // Basic Info
        content += '<div class="info-header"><strong>' + this.t('Type') + ':</strong> ' + type + '</div>';
        content += '<div class="info-header"><strong>ID:</strong> ' + object.id + '</div>';
        if (object.userData.layer) {
            content += '<div class="info-header"><strong>' + this.t('layers') + ':</strong> ' + object.userData.layer + '</div>';
        }
        content += '<hr class="my-2 border-white/10">';

        // Geometry Specifics
        if (type === 'LINE') {
            const len = this.calculateLength(object);
            if (len !== null) content += this.row(this.t('length'), len.toFixed(4));

            if (entity) {
                if (entity.startPoint) content += this.pointRow(this.t('startPoint'), entity.startPoint);
                if (entity.endPoint) content += this.pointRow(this.t('endPoint'), entity.endPoint);
            } else {
                // Fallback to geometry
                // Can extract from BufferGeometry if needed
            }
        }
        else if (type === 'CIRCLE') {
            if (entity) {
                content += this.row(this.t('radius'), entity.radius.toFixed(4));
                content += this.row(this.t('diameter'), (entity.radius * 2).toFixed(4));
                content += this.row(this.t('circumference'), (2 * Math.PI * entity.radius).toFixed(4));
                content += this.row(this.t('area'), (Math.PI * entity.radius * entity.radius).toFixed(4));
                content += this.pointRow(this.t('center'), entity.center);
            }
        }
        else if (type === 'ARC') {
            if (entity && typeof entity.radius === 'number') {
                content += this.row(this.t('radius'), entity.radius.toFixed(4));
                // Length of Arc
                const start = entity.startAngle * Math.PI / 180;
                const end = entity.endAngle * Math.PI / 180;
                let angle = end - start;
                if (angle < 0) angle += Math.PI * 2;
                const len = angle * entity.radius;
                content += this.row(this.t('length'), len.toFixed(4));
                content += this.row(this.t('startAngle'), entity.startAngle.toFixed(2) + '°');
                content += this.row(this.t('endAngle'), entity.endAngle.toFixed(2) + '°');
                content += this.pointRow(this.t('center'), entity.center);
            }
        }
        else if (type === 'LWPOLYLINE' || type === 'POLYLINE' || object.isGroup) {
            // For Groups (Exploded Polyline), calculate total length of children
            // Or use entity data if valid
            let totalLen = 0;
            let count = 0;

            // If it's a Group (our Refactored Polyline)
            if (object.isGroup) {
                object.children.forEach(child => {
                    const l = this.calculateLength(child);
                    if (l) totalLen += l;
                    count++;
                });
            } else if (entity && entity.vertices) {
                // Fallback to entity math if not a Group (legacy?)
                // ... math logic ...
            }

            content += this.row(this.t('totalLength'), totalLen.toFixed(4));
            content += this.row('Segments', count);

            const isClosed = (entity && ((entity.flag & 1) === 1 || entity.closed));
            content += this.row('Closed', isClosed ? this.t('yes') : this.t('no'));
        }

        this.container.innerHTML = content;
    }

    renderMultiObject(objects) {
        let totalLen = 0;
        let lineCount = 0;
        let otherCount = 0;

        objects.forEach(obj => {
            const len = this.calculateLength(obj);
            if (len !== null) {
                totalLen += len;
                lineCount++;
            } else {
                otherCount++;
            }
        });

        let content = '';
        content += '<div class="info-header"><strong>' + this.t('selectionCount').replace('{count}', objects.length) + '</strong></div>';
        content += '<hr class="my-2 border-white/10">';

        if (lineCount > 0) {
            content += this.row(this.t('totalLength'), totalLen.toFixed(4));
            content += '<div class="text-xs text-gray-400 mt-1">(' + lineCount + ' linear entities)</div>';
        }

        if (otherCount > 0) {
            content += '<div class="text-xs text-gray-400">(' + otherCount + ' non-linear entities)</div>';
        }

        this.container.innerHTML = content;
    }

    calculateLength(object) {
        if (!object) return 0;

        // If Group (Polyline), recurse?
        if (object.isGroup) {
            let sum = 0;
            object.children.forEach(c => sum += this.calculateLength(c));
            return sum;
        }

        const type = object.userData.type;
        const entity = object.userData.entity;

        if (type === 'LINE') {
            if (object.geometry) {
                object.geometry.computeBoundingBox(); // Ensure?
                // Or use positions
                const pos = object.geometry.attributes.position;
                if (pos && pos.count >= 2) {
                    const p1 = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
                    const p2 = new THREE.Vector3(pos.getX(1), pos.getY(1), pos.getZ(1));
                    return p1.distanceTo(p2);
                }
            }
            if (entity && entity.startPoint && entity.endPoint) {
                const p1 = new THREE.Vector3(entity.startPoint.x, entity.startPoint.y, entity.startPoint.z || 0);
                const p2 = new THREE.Vector3(entity.endPoint.x, entity.endPoint.y, entity.endPoint.z || 0);
                return p1.distanceTo(p2);
            }
        }

        if (type === 'ARC' || (type === 'LWPOLYLINE' && object.userData.parentType === 'LWPOLYLINE' && !object.isGroup)) {
            // It's a segment? ARC segment.
            // If refactored Polyline segment is ARC
            if (type === 'ARC' && entity && entity.radius) {
                // Full Arc Entity
                const start = entity.startAngle * Math.PI / 180;
                const end = entity.endAngle * Math.PI / 180;
                let angle = end - start;
                if (angle < 0) angle += Math.PI * 2;
                return angle * entity.radius;
            }
            // How do we handle "Segment" entities that are primitive lines but part of Polyline?
            // They have 'LINE' type usually.
            // If Segment is Arc (bulge), geometry should tell us length?
            // Helper: Compute line length from geometry for generic case.
            if (object.geometry && object.geometry.attributes.position) {
                // Sum segments
                let len = 0;
                const pos = object.geometry.attributes.position;
                for (let i = 0; i < pos.count - 1; i++) {
                    const x1 = pos.getX(i), y1 = pos.getY(i), z1 = pos.getZ(i);
                    const x2 = pos.getX(i + 1), y2 = pos.getY(i + 1), z2 = pos.getZ(i + 1);
                    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
                    len += Math.sqrt(dx * dx + dy * dy + dz * dz);
                }
                return len;
            }
        }

        if (type === 'CIRCLE' && entity) {
            return 2 * Math.PI * entity.radius;
        }

        return null;
    }

    calculateMeshArea(mesh) {
        if (!mesh || !mesh.geometry) return 0;
        const geometry = mesh.geometry;
        const pos = geometry.attributes.position;
        const index = geometry.index;
        let area = 0;

        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        const cb = new THREE.Vector3();
        const ab = new THREE.Vector3();

        if (index) {
            for (let i = 0; i < index.count; i += 3) {
                const a = index.getX(i);
                const b = index.getX(i + 1);
                const c = index.getX(i + 2);

                vA.fromBufferAttribute(pos, a);
                vB.fromBufferAttribute(pos, b);
                vC.fromBufferAttribute(pos, c);

                cb.subVectors(vC, vB);
                ab.subVectors(vA, vB);
                cb.cross(ab);
                area += 0.5 * cb.length();
            }
        } else {
            for (let i = 0; i < pos.count; i += 3) {
                vA.fromBufferAttribute(pos, i);
                vB.fromBufferAttribute(pos, i + 1);
                vC.fromBufferAttribute(pos, i + 2);

                cb.subVectors(vC, vB);
                ab.subVectors(vA, vB);
                cb.cross(ab);
                area += 0.5 * cb.length();
            }
        }
        return area;
    }

    row(label, value) {
        return '<div class="flex justify-between text-sm mb-1"><span class="text-gray-400">' + label + ':</span> <span class="text-white font-mono">' + value + '</span></div>';
    }

    pointRow(label, pt) {
        if (!pt) return '';
        const x = pt.x !== undefined ? pt.x : pt[0]; // Handle array vs object?
        // Assuming object {x,y,z}
        return '<div class="mb-1">' +
            '<span class="text-xs text-gray-400 block">' + label + '</span>' +
            '<div class="flex gap-2 font-mono text-xs text-white pl-2">' +
            '<span>X: ' + pt.x.toFixed(3) + '</span>' +
            '<span>Y: ' + pt.y.toFixed(3) + '</span>' +
            '</div>' +
            '</div>';
    }

    // Updated HTML generation for Tolerance Section
    getToleranceHTML(tolerance) {
        // active state
        const active = tolerance ? tolerance.active : false;
        const plus = (tolerance && active) ? (tolerance.plus !== undefined ? tolerance.plus : 0) : 0;
        const minus = (tolerance && active) ? (tolerance.minus !== undefined ? tolerance.minus : 0) : 0;

        // standard (e.g. '755-9') or 'custom'
        const currentStandard = (tolerance && tolerance.standard) ? tolerance.standard : 'custom';
        const isCustom = currentStandard === 'custom';

        const disabled = active ? '' : 'disabled';
        const opacity = active ? 'opacity-100' : 'opacity-50 pointer-events-none';

        // If standard is selected, hide inputs? Or just disable them?
        // Plan says: "If a standard tolerance ... is selected, the manual input should be hidden"
        const inputDisplay = isCustom ? 'block' : 'none';
        const calcDisplay = isCustom ? 'none' : 'block';

        // Build Select Options
        let options = `<option value="custom" ${currentStandard === 'custom' ? 'selected' : ''}>Özel Tolerans</option>`;
        STANDARTS.forEach(std => {
            options += `<option value="${std.id}" ${currentStandard === std.id ? 'selected' : ''}>${std.name}</option>`;
        });

        return `
        <div class="tolerance-section mt-3 pt-2 border-t border-white/10">
            <div class="flex items-center justify-between mb-2">
                 <span class="text-gray-200 font-medium text-sm">Tolerans</span>
                 <input type="checkbox" id="tol-active" ${active ? 'checked' : ''} class="form-checkbox h-4 w-4 text-cyan-400 rounded bg-black/20 border-white/10 cursor-pointer accent-cyan-500">
            </div>
            
            <div id="tol-container" class="transition-opacity duration-200 ${opacity}">
                <!-- Standard Selection -->
                <div class="mb-2">
                    <select id="tol-standard" class="w-full bg-black/20 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500" ${disabled}>
                        ${options}
                    </select>
                </div>

                <!-- Manual Inputs (Custom) -->
                <div id="tol-inputs" class="grid grid-cols-2 gap-2" style="display: ${inputDisplay};">
                    <div class="relative">
                         <span class="absolute left-2 top-1.5 text-xs text-gray-500 font-bold">+</span>
                         <input type="number" id="tol-plus" value="${plus}" step="0.01" class="w-full bg-black/20 border border-white/10 rounded pl-5 pr-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono" placeholder="0.00" ${disabled}>
                    </div>
                    <div class="relative">
                         <span class="absolute left-2 top-1.5 text-xs text-gray-500 font-bold">-</span>
                         <input type="number" id="tol-minus" value="${minus}" step="0.01" class="w-full bg-black/20 border border-white/10 rounded pl-5 pr-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono" placeholder="0.00" ${disabled}>
                    </div>
                </div>

                <!-- Calculated Value Display (Standard) -->
                <div id="tol-calculated" class="text-center p-2 bg-white/5 rounded border border-white/10" style="display: ${calcDisplay};">
                    <div class="text-xs text-gray-400 mb-1">Hesaplanan Değer</div>
                    <div class="font-mono text-cyan-400 font-bold">
                        +${active ? plus.toFixed(2) : '0.00'} / -${active ? minus.toFixed(2) : '0.00'}
                    </div>
                    <button id="tol-recalc" class="mt-2 w-full text-xs bg-cyan-600 hover:bg-cyan-500 text-white py-1 rounded">Tekrar Seç</button>
                </div>
            </div>
        </div>`;
    }

    bindToleranceEvents(object) {
        const cb = document.getElementById('tol-active');
        const selStandard = document.getElementById('tol-standard');
        const iPlus = document.getElementById('tol-plus');
        const iMinus = document.getElementById('tol-minus');
        const divContainer = document.getElementById('tol-container');
        const divInputs = document.getElementById('tol-inputs');
        const divCalculated = document.getElementById('tol-calculated');
        const btnRecalc = document.getElementById('tol-recalc');

        if (!cb || !selStandard) return;

        // Helper to update tolerance object
        const updateObj = () => {
            const tol = {
                active: cb.checked,
                standard: selStandard.value, // 'custom' or standard ID
                plus: parseFloat(iPlus ? iPlus.value : 0) || 0,
                minus: parseFloat(iMinus ? iMinus.value : 0) || 0
            };
            if (this.measurementManager) {
                this.measurementManager.updateTolerance(object, tol);
            }
        };

        // Checkbox Handler
        cb.addEventListener('change', () => {
            const isActive = cb.checked;
            if (isActive) {
                divContainer.classList.remove('opacity-50', 'pointer-events-none');
                divContainer.classList.add('opacity-100');
                if (selStandard) selStandard.disabled = false;
                if (iPlus) iPlus.disabled = false;
                if (iMinus) iMinus.disabled = false;
            } else {
                divContainer.classList.add('opacity-50', 'pointer-events-none');
                divContainer.classList.remove('opacity-100');
                if (selStandard) selStandard.disabled = true;
                if (iPlus) iPlus.disabled = true;
                if (iMinus) iMinus.disabled = true;
                // Reset values only if custom?
                if (iPlus) iPlus.value = 0;
                if (iMinus) iMinus.value = 0;
            }
            updateObj();
        });

        // Select Change Handler
        selStandard.addEventListener('change', () => {
            const val = selStandard.value;
            if (val === 'custom') {
                if (divInputs) divInputs.style.display = 'grid'; // grid defined in HTML
                if (divCalculated) divCalculated.style.display = 'none';
                // Re-enable manual editing
                if (iPlus) iPlus.disabled = false;
                if (iMinus) iMinus.disabled = false;
            } else {
                // Standard Mode
                if (divInputs) divInputs.style.display = 'none';
                if (divCalculated) divCalculated.style.display = 'block';
                // Disable manual editing (inputs hidden anyway)
                if (iPlus) iPlus.disabled = true;
                if (iMinus) iMinus.disabled = true;

                // Show Modal for Selection
                this.showToleranceModal(val, object, (plus, minus) => {
                    // Callback when calc done
                    if (iPlus) iPlus.value = plus;
                    if (iMinus) iMinus.value = minus;
                    updateObj();
                    // Update display
                    if (divCalculated) {
                        const txt = divCalculated.querySelector('.font-mono');
                        if (txt) txt.textContent = `+${plus.toFixed(2)} / -${minus.toFixed(2)}`;
                    }
                });
            }
            updateObj();
        });

        // Manual Input Handlers
        if (iPlus) {
            iPlus.addEventListener('input', () => {
                // Sync Minus if Custom? Only initially requested behavior.
                if (iMinus) iMinus.value = iPlus.value;
                updateObj();
            });
        }
        if (iMinus) {
            iMinus.addEventListener('input', () => {
                updateObj();
            });
        }

        // Recalc Button Handler
        if (btnRecalc) {
            btnRecalc.addEventListener('click', () => {
                const val = selStandard.value;
                if (val !== 'custom') {
                    this.showToleranceModal(val, object, (plus, minus) => {
                        if (iPlus) iPlus.value = plus;
                        if (iMinus) iMinus.value = minus;
                        updateObj();
                        if (divCalculated) {
                            const txt = divCalculated.querySelector('.font-mono');
                            if (txt) txt.textContent = `+${plus.toFixed(2)} / -${minus.toFixed(2)}`;
                        }
                    });
                }
            });
        }
    }

    createToleranceModal() {
        if (document.getElementById('tolerance-modal')) return;

        // Create overlay
        const modal = document.createElement('div');
        modal.id = 'tolerance-modal';
        // Tailwind classes for centered fixed overlay
        modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-[2000] hidden backdrop-blur-sm'; // Very high z-index

        // Modal Content
        modal.innerHTML = `
            <div class="bg-gray-900 border border-white/20 p-6 rounded-xl shadow-2xl max-w-4xl w-full relative flex flex-col max-h-[90vh]">
                <button id="tol-modal-close" class="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors text-xl">✕</button>
                
                <h3 class="text-xl text-white font-bold mb-6 flex items-center gap-2">
                    <span class="w-1 h-6 bg-cyan-500 rounded-full inline-block"></span>
                    Tolerans Seçimi (EN 755-9)
                </h3>
                
                <div class="flex flex-col md:flex-row gap-6 overflow-hidden">
                    <!-- Image Area -->
                    <div class="flex-1 flex items-center justify-center bg-black/40 rounded-lg p-4 border border-white/5">
                        <img src="src/755-9.JPG" alt="Profile Logic" class="max-h-[50vh] object-contain shadow-lg rounded">
                    </div>
                    
                    <!-- Controls Area -->
                    <div class="w-full md:w-64 flex flex-col gap-3 justify-center shrink-0">
                        <div class="text-sm text-gray-400 mb-2 font-mono border-b border-white/10 pb-2">
                            <div>Mat: <span id="tol-debug-mat" class="text-white">-</span></div>
                            <div>Prf: <span id="tol-debug-prf" class="text-white">-</span></div>
                            <div>Dim: <span id="tol-debug-dim" class="text-white">-</span></div>
                        </div>

                        <div class="space-y-2">
                            <button class="tol-btn w-full bg-cyan-600 hover:bg-cyan-500 text-white py-3 rounded font-bold transition-all shadow hover:shadow-cyan-500/20" data-class="A">A</button>
                            <button class="tol-btn w-full bg-cyan-600 hover:bg-cyan-500 text-white py-3 rounded font-bold transition-all shadow hover:shadow-cyan-500/20" data-class="B">B</button>
                            <button class="tol-btn w-full bg-cyan-600 hover:bg-cyan-500 text-white py-3 rounded font-bold transition-all shadow hover:shadow-cyan-500/20" data-class="C">C</button>
                            <div class="h-px bg-white/10 my-2"></div>
                            <button class="tol-btn w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded font-bold transition-all shadow hover:shadow-purple-500/20" data-class="H">H</button>
                            <button class="tol-btn w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded font-bold transition-all shadow hover:shadow-purple-500/20" data-class="H_OPEN">H (Açık Uç)</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Bind Close Event
        document.getElementById('tol-modal-close').addEventListener('click', () => {
            this.hideToleranceModal();
        });

        // Bind Button Events (Delegation or direct)
        // We will bind click handlers dynamically in showToleranceModal or strictly here.
        // It is cleaner to bind logic here if we store the 'currentCallback' somewhere.
        const btns = modal.querySelectorAll('.tol-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                const cls = btn.dataset.class;
                this.handleToleranceSelection(cls);
            });
        });
    }

    hideToleranceModal() {
        const modal = document.getElementById('tolerance-modal');
        if (modal) modal.classList.add('hidden');
        // If we cancelled, do we revert `selStandard`? The logic needs to know if a value was selected.
        if (this._tolCallback) {
            // Cancelled?
            // this._tolCallback(0, 0); // Or keep last?
            this._tolCallback = null;
        }
    }

    showToleranceModal(standardId, object, callback) {
        this.createToleranceModal();
        const modal = document.getElementById('tolerance-modal');
        if (!modal) return;

        // Context Data
        this._tolCallback = callback;
        this._tolCurrentObject = object;
        this._tolStandardId = standardId;

        // Get Measurement Value & Type
        let dimension = 0;
        let dimensionType = 'linear';

        // Logic to extract value from object
        if (object.userData.type === 'DIMENSION' || (object.parent && object.parent.userData.type === 'DIMENSION')) {
            const dimObj = object.userData.type === 'DIMENSION' ? object : object.parent;

            // Extract Subtype
            if (dimObj.userData.subtype) {
                dimensionType = dimObj.userData.subtype;
            }

            // Extract Numeric Value
            const textVal = String(dimObj.userData.value);
            // Remove non-numeric prefixes/suffixes (like 'R', 'Ø', '°') but keep decimal point
            const match = textVal.match(/-?\d+(\.\d+)?/);
            if (match) {
                dimension = parseFloat(match[0]);
            }
        } else if (object.userData.type === 'LINE') {
            dimension = this.calculateLength(object);
            dimensionType = 'linear';
        }
        this._tolDimension = dimension;
        this._tolDimensionType = dimensionType;

        // Get Material and Profile Type from WeightManager
        let materialName = 'Unknown';
        let materialId = '6063'; // Default fallback
        let profileType = 'solid'; // Default
        let cdValue = 100; // Default fallback

        if (this.app && this.app.weightManager) {
            const wm = this.app.weightManager;
            materialId = wm.currentMaterialId;

            // Profile Type logic
            if (wm.lastCalculatedStats) {
                const mandrel = wm.lastCalculatedStats.mandrelCount;
                profileType = (mandrel > 0) ? 'hollow' : 'solid';
            }

            // Calculate CD (DU) directly for this object
            // Create a temporary geometric entry structure that WeightManager expects
            let geomEntry = null;
            if (object.userData.type === 'LWPOLYLINE' || object.userData.type === 'POLYLINE') {
                geomEntry = { type: 'single', objects: [object] };
            } else if (object.userData.type === 'CIRCLE') {
                // For circle, CD is just Diameter
                // But let's use common logic if possible
                geomEntry = { type: 'single', objects: [object] };
            } else if (object.userData.type === 'LINE') {
                // Lines don't have CD in the same way, but let's try
                geomEntry = { type: 'single', objects: [object] };
            }

            if (geomEntry) {
                try {
                    const circleData = wm.calculateBoundingCircleDiameter(geomEntry);
                    if (circleData && circleData.diameter) {
                        cdValue = circleData.diameter;
                        console.log(`[ObjectInfo] Calculated CD for selected object: ${cdValue}`);
                    }
                } catch (e) {
                    console.error("[ObjectInfo] Error calculating CD:", e);
                }
            } else {
                // Fallback to last calculated if exists
                if (wm.lastCalculatedStats && wm.lastCalculatedStats.diameter) {
                    cdValue = wm.lastCalculatedStats.diameter;
                }
            }
        }
        this._tolMaterialId = materialId;
        this._tolProfileType = profileType;
        this._tolCD = cdValue;

        // Determine Alloy Group for Debug
        let alloyGroup = '?';
        const std = STANDARTS.find(s => s.id === standardId);
        if (std) {
            for (const grp of std.groups) {
                if (grp.alloys.includes(materialId)) {
                    alloyGroup = grp.id;
                    break;
                }
            }
        }

        console.log(`[ObjectInfo] showToleranceModal - Material: ${materialId}, AlloyGroup: ${alloyGroup}, CD: ${cdValue}`);

        // Update Debug Info in Modal
        const elMat = document.getElementById('tol-debug-mat');
        const elPrf = document.getElementById('tol-debug-prf');
        const elDim = document.getElementById('tol-debug-dim');
        if (elMat) elMat.textContent = `${materialId} [${alloyGroup}] (CD: ${cdValue.toFixed(1)})`;
        if (elPrf) elPrf.textContent = profileType.toUpperCase();
        if (elDim) elDim.textContent = `${dimension.toFixed(2)} (${this._tolDimensionType})`;

        if (elDim) elDim.textContent = `${dimension.toFixed(2)} (${this._tolDimensionType})`;

        // Check if Angular -> Bypass Modal
        if (this._tolDimensionType === 'angle') {
            // Directly Prompt for L
            // Wait for modal to be ready? No, we just don't show it if we hijack.
            // But we need the context data set above.

            // Allow a brief timeout or direct call?
            // Let's hide the modal if it was somehow shown, or just not show it.
            // Re-use logic from handleToleranceSelection or similar.

            const input = prompt("Lütfen kısa kenar uzunluğunu (mm) giriniz:", "0");
            if (input === null) {
                // User Cancelled selection of standard
                // We should revert standard selection?
                this.hideToleranceModal();
                return;
            }

            const lShort = parseFloat(input);
            const result = calculateTolerance(this._tolStandardId, this._tolMaterialId, this._tolProfileType, this._tolDimension, null, this._tolCD, 'angle', lShort);

            if (result !== null) {
                if (this._tolCallback) {
                    this._tolCallback(result, result);
                }
            } else {
                alert("Açı toleransı hesaplanamadı.");
            }

            // Clean up
            this.hideToleranceModal(); // Keeps things clean
            return;
        }

        // Show (Only for Linear/Visuals that need selection)
        modal.classList.remove('hidden');
    }

    handleToleranceSelection(cls) {
        console.log(`[ObjectInfo] Selected Tolerance Class: ${cls}`);

        // Check callback
        if (!this._tolCallback) return;

        // 1. Calculate
        const std = this._tolStandardId;
        const alloy = this._tolMaterialId;
        const type = this._tolProfileType;
        const dim = this._tolDimension;
        const cd = this._tolCD;

        let result = 0;

        if (cls === 'H_OPEN') {
            // Special case: Prompt for E
            // For now simple prompt, can be improved to UI later
            const input = prompt("Lütfen 'E (Açık Uç Uzunluğu)' değerini girin:", "0");
            if (input === null) return; // Cancelled
            const eVal = parseFloat(input);

            // Base H
            const base = calculateTolerance(std, alloy, type, dim, 'H', cd, this._tolDimensionType);
            if (base !== null) {
                result = calculateOpenEndTolerance(base, eVal);
            } else {
                alert("H toleransı hesaplanamadı.");
                return;
            }
        } else if (this._tolDimensionType === 'angle') {
            // For Angle, we need Short Side Length (L)
            const input = prompt("Lütfen kısa kenar uzunluğunu (mm) giriniz:", "0");
            if (input === null) return;
            const lShort = parseFloat(input);

            // Calculate
            result = calculateTolerance(std, alloy, type, dim, cls, cd, 'angle', lShort);
            if (result === null) {
                alert("Açı toleransı hesaplanamadı.");
                return;
            }
        } else {
            result = calculateTolerance(std, alloy, type, dim, cls, cd, this._tolDimensionType);
        }

        if (result !== null) {
            // Apply symmetric? Table gives +/- absolute value usually?
            // "The tolerances ... are +/- values" -> Yes.
            const plus = result;
            const minus = result;

            this._tolCallback(plus, minus);
            this.hideToleranceModal();
        } else {
            alert("Tolerans aralığı bulunamadı veya veri eksik.");
        }
    }

    async handleExtractFace(object) {
        if (!this.app || !this.app.clipboardManager) return;

        // 1. Get Edges
        const geometry = object.geometry;
        const edges = new THREE.EdgesGeometry(geometry, 10); // threshold angle
        const positions = edges.attributes.position;

        // 2. Prepare Transform (Align Face Normal to Z-Up)
        geometry.computeVertexNormals();
        const normalAttribute = geometry.attributes.normal;
        const normal = new THREE.Vector3();
        if (normalAttribute && normalAttribute.count > 0) {
            normal.set(normalAttribute.getX(0), normalAttribute.getY(0), normalAttribute.getZ(0));
            normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(object.matrixWorld)).normalize();
        } else {
            normal.set(0, 0, 1);
        }

        // Quaternion to rotate Normal to (0,0,1)
        const targetNormal = new THREE.Vector3(0, 0, 1);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(normal, targetNormal);

        // 3. Create Entities
        const entities = [];

        for (let i = 0; i < positions.count; i += 2) {
            const v1 = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));
            const v2 = new THREE.Vector3(positions.getX(i + 1), positions.getY(i + 1), positions.getZ(i + 1));

            // Apply Object Matrix 
            v1.applyMatrix4(object.matrixWorld);
            v2.applyMatrix4(object.matrixWorld);

            // Apply Flattening Rotation
            v1.applyQuaternion(quaternion);
            v2.applyQuaternion(quaternion);

            // Create Fake Entity
            const entity = {
                type: 'LINE',
                startPoint: { x: v1.x, y: v1.y, z: 0 },
                endPoint: { x: v2.x, y: v2.y, z: 0 },
                layer: '0',
                color: 0xFFFFFF
            };

            // Create Real Line Object (for Clipboard Thumbnail)
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(v1.x, v1.y, 0),
                new THREE.Vector3(v2.x, v2.y, 0)
            ]);

            const lineMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF });
            const lineObj = new THREE.Line(lineGeo, lineMat);

            lineObj.userData = {
                type: 'LINE',
                entity: entity,
                layer: '0',
                originalColor: 0xFFFFFF
            };

            entities.push(lineObj);
        }

        // 4. Copy to Clipboard
        this.app.clipboardManager.copy(entities);
        // Notify
        if (this.app.languageManager) {
            this.app.updateStatus(this.app.languageManager.translate('copiedToClipboard') || 'Copied face to clipboard');
        }
    }

    activateSection(object, context = null) {
        if (!this.viewer || !this.viewer.renderer) return;

        console.log('[ObjectInfo] Activating Section for', object.id);
        console.log('[ObjectInfo] Context:', context);
        console.log('[ObjectInfo] Context.point:', context ? context.point : 'NO CONTEXT');
        this.isSectionActive = true;
        if (context) console.log('[ObjectInfo] Using Selection Context:', context);

        const geometry = object.geometry;
        const normal = new THREE.Vector3(0, 0, 1); // Default Z
        const anchorPoint = new THREE.Vector3();

        // Priority 1: Use Context (Raycast Hit)
        if (context && context.face) {
            // Face Normal
            normal.copy(context.face.normal);
            // Transform normal to World Space
            // context.face.normal is usually in Object Space for BufferGeometry?
            // "Raycaster returns face normal in world space usually? No, check docs."
            // THREE.Raycaster: ".face.normal" is in LOCAL space for BufferGeometry.
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
            normal.applyMatrix3(normalMatrix).normalize();

            // Anchor: Use the exact hit point (World Space)
            anchorPoint.copy(context.point);
        }
        // Priority 2: Fallback to Geometry Attribute (First Face)
        else {
            // Calculate Face Normal and Center
            geometry.computeVertexNormals();
            const normalAttribute = geometry.attributes.normal;

            if (normalAttribute && normalAttribute.count > 0) {
                normal.set(normalAttribute.getX(0), normalAttribute.getY(0), normalAttribute.getZ(0));
                // Apply Normal Matrix
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
                normal.applyMatrix3(normalMatrix).normalize();

                // Standard Normal usually points OUT.
                // If we want to clip the "Front" (Normal direction), we generally need the plane normal 
                // to point "In" or "Out" depending on renderer clipping logic.
                // Renderer clips "Negative" side usually? Or "Positive"?
                // THREE.js: "Objects on the negative side of the plane are not rendered." (dist < 0 clipped).
                // Normal points OUT. Inside points are "Behind" (Negative dot product relative to face).
                // So Inside points have dist < 0 -> Clipped.
                // So currently, using Face Normal -> Inside is clipped.
                // User wants Inside VISIBLE. So we need Inside to be Positive.
                // So Normal must point IN (Reserved).
                // normal.negate(); // Removed as per instruction, assuming normal points IN for desired clipping

                // Anchor to the first vertex of the face (in World Space)
                // Use Position Attribute, not BBox Center
                const posAttr = geometry.attributes.position;
                if (posAttr && posAttr.count > 0) {
                    anchorPoint.set(posAttr.getX(0), posAttr.getY(0), posAttr.getZ(0));
                    anchorPoint.applyMatrix4(object.matrixWorld);
                } else {
                    geometry.computeBoundingBox();
                    geometry.boundingBox.getCenter(anchorPoint);
                    anchorPoint.applyMatrix4(object.matrixWorld);
                }
            } else {
                console.warn('[ObjectInfo] No normal attribute found, defaulting to Z');
                geometry.computeBoundingBox();
                geometry.boundingBox.getCenter(anchorPoint);
                anchorPoint.applyMatrix4(object.matrixWorld);
            }
        }

        if (normal.lengthSq() < 0.1) {
            console.warn('[ObjectInfo] Normal became zero!', normal);
            normal.set(0, 0, 1);
        }


        console.log('[ObjectInfo] Active Section Normal:', normal);
        console.log('[ObjectInfo] Anchor Point:', anchorPoint);

        // Calculate geometry center for debugging
        geometry.computeBoundingBox();
        const geometryCenter = new THREE.Vector3();
        geometry.boundingBox.getCenter(geometryCenter);
        geometryCenter.applyMatrix4(object.matrixWorld);
        console.log('[ObjectInfo] Geometry center:', geometryCenter);

        // Size for Helper (Bounding Sphere Radius)
        geometry.computeBoundingSphere();
        const worldScale = new THREE.Vector3();
        object.getWorldScale(worldScale);
        const maxScale = Math.max(worldScale.x, worldScale.y, worldScale.z);
        const helperSize = (geometry.boundingSphere ? geometry.boundingSphere.radius : 50) * maxScale * 2.5;


        // Base Constant (Plane passing through anchor)
        // constant = - (normal . anchor)
        const baseConstant = -normal.dot(anchorPoint);

        // Calculate initial offset to align plane with selected face
        let initialOffset = 0;
        let faceCenter = null;

        // Try to get face center from context or geometry
        if (object.userData.faceId !== undefined && geometry.index) {
            // Calculate face center from faceId stored in userData (PRIMARY)
            const faceIdx = object.userData.faceId;
            const idx = geometry.index;
            const pos = geometry.attributes.position;

            console.log('[ObjectInfo] Using faceId from userData:', faceIdx);
            console.log('[ObjectInfo] Index count:', idx.count, 'Position count:', pos.count);

            // Check if faceId is within bounds of this mesh's index buffer
            const maxFaceIdx = Math.floor(idx.count / 3) - 1;
            console.log('[ObjectInfo] Max face index for this mesh:', maxFaceIdx);

            if (faceIdx <= maxFaceIdx) {
                // Get the 3 vertices of the triangle
                const i1 = idx.getX(faceIdx * 3);
                const i2 = idx.getX(faceIdx * 3 + 1);
                const i3 = idx.getX(faceIdx * 3 + 2);

                console.log('[ObjectInfo] Vertex indices:', i1, i2, i3);

                const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
                const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
                const v3 = new THREE.Vector3(pos.getX(i3), pos.getY(i3), pos.getZ(i3));

                console.log('[ObjectInfo] Local vertices:', v1, v2, v3);

                // Transform to world space
                v1.applyMatrix4(object.matrixWorld);
                v2.applyMatrix4(object.matrixWorld);
                v3.applyMatrix4(object.matrixWorld);

                console.log('[ObjectInfo] World vertices:', v1, v2, v3);

                // Calculate center
                faceCenter = new THREE.Vector3();
                faceCenter.add(v1).add(v2).add(v3).divideScalar(3);

                console.log('[ObjectInfo] Face center calculated:', faceCenter);
            } else {
                console.warn('[ObjectInfo] faceId', faceIdx, 'out of range for this mesh (max:', maxFaceIdx + ')');

                // This mesh shares position attribute with others but has unique index buffer
                // Calculate face center from actual indexed vertices
                if (geometry.index && geometry.index.count > 0) {
                    const posAttr = geometry.attributes.position;
                    const v1 = new THREE.Vector3();
                    const v2 = new THREE.Vector3();
                    const v3 = new THREE.Vector3();

                    // Get first triangle's vertices
                    const i0 = geometry.index.getX(0);
                    const i1 = geometry.index.getX(1);
                    const i2 = geometry.index.getX(2);

                    v1.fromBufferAttribute(posAttr, i0);
                    v2.fromBufferAttribute(posAttr, i1);
                    v3.fromBufferAttribute(posAttr, i2);

                    // Calculate triangle center in local space
                    const localCenter = new THREE.Vector3()
                        .add(v1).add(v2).add(v3)
                        .divideScalar(3);

                    // Transform to world space
                    localCenter.applyMatrix4(object.matrixWorld);
                    faceCenter = localCenter;
                    console.log('[ObjectInfo] Calculated from first triangle (world):', faceCenter);
                    console.log('[ObjectInfo] Local triangle center:', v1, v2, v3);
                } else {
                    // Ultimate fallback
                    faceCenter = anchorPoint.clone();
                    console.log('[ObjectInfo] Using anchorPoint as fallback');
                }
            }
        } else if (context && context.faceIndex !== undefined && geometry.index) {
            // Calculate face center from faceIndex
            const faceIdx = context.faceIndex;
            const idx = geometry.index;
            const pos = geometry.attributes.position;

            // Get the 3 vertices of the triangle
            const i1 = idx.getX(faceIdx * 3);
            const i2 = idx.getX(faceIdx * 3 + 1);
            const i3 = idx.getX(faceIdx * 3 + 2);

            const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
            const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
            const v3 = new THREE.Vector3(pos.getX(i3), pos.getY(i3), pos.getZ(i3));

            // Transform to world space
            v1.applyMatrix4(object.matrixWorld);
            v2.applyMatrix4(object.matrixWorld);
            v3.applyMatrix4(object.matrixWorld);

            // Calculate center
            faceCenter = new THREE.Vector3();
            faceCenter.add(v1).add(v2).add(v3).divideScalar(3);

            console.log('[ObjectInfo] Face center from context.faceIndex:', faceCenter);
        } else if (context && context.point) {
            // Use clicked point if available
            faceCenter = context.point.clone();
            console.log('[ObjectInfo] Using context.point:', faceCenter);
        }

        // CRITICAL FIX: Recalculate baseConstant from face center
        // This makes offset relative to the selected face, not to anchorPoint
        let adjustedBaseConstant = baseConstant;

        console.log('========== SECTION OFFSET DEBUG ==========');
        console.log('[ObjectInfo] Normal vector:', normal);
        console.log('[ObjectInfo] AnchorPoint (first vertex):', anchorPoint);
        console.log('[ObjectInfo] Original baseConstant from anchorPoint:', baseConstant);

        if (faceCenter) {
            console.log('[ObjectInfo] Face Center:', faceCenter);

            // CRITICAL FIX: Check if normal needs to be flipped
            // If face center is on opposite side of geometry center, flip normal
            const centerToFace = new THREE.Vector3().subVectors(faceCenter, geometryCenter);
            const dotProduct = normal.dot(centerToFace);

            console.log('[ObjectInfo] Geometry center to face direction:', centerToFace);
            console.log('[ObjectInfo] Normal dot (center->face):', dotProduct);

            // If dot product is negative, face and normal point in opposite directions
            if (dotProduct < 0) {
                console.warn('[ObjectInfo] Face opposes normal direction! Flipping normal.');
                normal.negate();
                console.log('[ObjectInfo] Flipped normal:', normal);
            }

            console.log('[ObjectInfo] Calculating: -normal.dot(faceCenter)');
            console.log('[ObjectInfo]   normal.dot(faceCenter) =', normal.dot(faceCenter));

            adjustedBaseConstant = -normal.dot(faceCenter);

            console.log('[ObjectInfo] Adjusted baseConstant from face center:', adjustedBaseConstant);
            console.log('[ObjectInfo] Difference (adjusted - original):', adjustedBaseConstant - baseConstant);

            // Initial offset is 0 because we want to start AT the selected face
            initialOffset = 0;
            console.log('[ObjectInfo] Initial offset set to 0 (at selected face)');
        } else {
            console.log('[ObjectInfo] No face center found, using anchorPoint-based constant');
            initialOffset = 0;
        }
        console.log('==========================================');

        // Store active state with adjusted baseConstant
        this.activeSection = {
            normal: normal.clone(),
            baseConstant: adjustedBaseConstant, // Use face-based constant
            object: object
        };
        this.isSectionActive = true;
        this.activeSectionObject = object;

        console.log('[ObjectInfo] Section Activated with offset=0 at selected face');

        // Set UI input to initial offset (0)
        const inputOffset = document.getElementById('section-offset');
        if (inputOffset) {
            inputOffset.value = initialOffset.toFixed(2);
        }

        // Initial render with offset=0 (at selected face) and FLIP=TRUE (default)
        // User requested default state to be Flipped
        this.updateSectionOffset(initialOffset, helperSize, true);

        // Notify App
        this.app.updateStatus('Section Active. Adjust offset to move plane. Press ESC to cancel.');
    }

    updateSectionOffset(offset, helperSize = null, flip = false, createCap = false) {
        if (!this.activeSection) return;

        let { normal, baseConstant } = this.activeSection;

        // Clone normal to avoid modifying the stored reference
        let effectiveNormal = normal.clone();
        let effectiveConstant = baseConstant;

        // Flip checkbox: Reverse clipping direction WITHOUT moving the plane
        // To keep plane at same geometric position when negating normal,
        // we must also negate the constant
        // Plane equation: n·P + d = 0
        // If n → -n, then d → -d to keep same geometric plane
        if (flip) {
            effectiveNormal.negate();
            effectiveConstant = -effectiveConstant;
            console.log('[Section] Flip enabled - reversed normal and constant for clipping');
        }

        // Apply offset
        // When flipped, offset direction is also reversed to maintain consistent behavior
        let effectiveOffset = flip ? -offset : offset;

        // New Constant: Shift constant by offset
        const constant = effectiveConstant + effectiveOffset;

        const plane = new THREE.Plane(effectiveNormal, constant);

        // Apply to Renderer
        this.viewer.renderer.clippingPlanes = [plane];
        this.viewer.renderer.localClippingEnabled = true;

        // Cap Logic: Calculate size from object bounding box
        if (!this.sectionCapSize) {
            const object = this.activeSection.object;
            const bbox = new THREE.Box3().setFromObject(object);
            const size = bbox.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            // Cap should match part dimensions, slightly smaller for better fit
            const capDimension = maxDim * 0.15;
            this.sectionCapSize = {
                width: capDimension,
                height: capDimension
            };
            console.log('[Cap] Calculated size from bbox:', capDimension, 'part size:', size);
        }

        // Use cached size
        const width = this.sectionCapSize.width;
        const height = this.sectionCapSize.height;

        // Hide/Remove existing helper
        if (this.viewer.sectionHelper) {
            this.viewer.scene.remove(this.viewer.sectionHelper);
            if (this.viewer.sectionHelper.geometry) this.viewer.sectionHelper.geometry.dispose();
            if (this.viewer.sectionHelper.material) this.viewer.sectionHelper.material.dispose();
            this.viewer.sectionHelper = null;
        }

        // Create consistent Cap with smooth rendering (same for both drag and static)
        const capGeo = new THREE.PlaneGeometry(width, height, 1, 1);

        // Smooth material
        const capMat = new THREE.MeshBasicMaterial({
            color: 0x00AEEF,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: true,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
            clippingPlanes: [] // CRITICAL: Exempt cap from clipping to prevent self-clipping
        });

        const capMesh = new THREE.Mesh(capGeo, capMat);

        // CRITICAL: Cap position calculation
        // Use ORIGINAL normal (not flipped) and baseConstant + offset
        // This keeps cap at correct position even when flip is toggled
        const capConstant = baseConstant + offset;
        const origin = normal.clone().multiplyScalar(-capConstant);

        console.log('[Cap] original normal:', normal);
        console.log('[Cap] effectiveNormal (for clipping):', effectiveNormal);
        console.log('[Cap] baseConstant (original):', baseConstant);
        console.log('[Cap] offset:', offset);
        console.log('[Cap] capConstant (base + offset):', capConstant);
        console.log('[Cap] constant (for clipping, after flip):', constant);
        console.log('[Cap] Cap position (normal * -capConstant):', origin);

        // Align cap orientation using ORIGINAL normal (not flipped)
        // Cap should always face the same direction as the selected face
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(normal.dot(up)) > 0.99) up.set(1, 0, 0);
        const xAxis = new THREE.Vector3().crossVectors(normal, up).normalize();
        const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();

        capMesh.position.copy(origin);

        // Align orientation using original normal
        const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
        matrix.setPosition(origin);
        capMesh.quaternion.setFromRotationMatrix(matrix);

        // Offset cap AWAY from clipping plane to prevent being clipped
        // Use effectiveNormal (which accounts for flip) not original normal
        capMesh.position.add(effectiveNormal.clone().multiplyScalar(0.01));

        console.log('[Cap] Final position after offset:', capMesh.position);

        this.viewer.scene.add(capMesh);
        this.viewer.sectionHelper = capMesh;
    }

    extractSectionProfile(isCopy = false) {
        if (!this.isSectionActive || !this.activeSection || !this.activeSection.object) return;

        console.log('[Section] Extracting profile...');
        const object = this.activeSection.object;
        const geometry = object.geometry;

        // Ensure rendering context
        if (!object.isMesh || !geometry) return;

        // Get clipping plane (World Space)
        // Reconstruct Current Plane from activeSection
        // Reconstruct Current Plane from activeSection
        const { normal, baseConstant } = this.activeSection;
        const inputOffset = document.getElementById('section-offset');
        const inputFlip = document.getElementById('section-flip');
        const offset = inputOffset ? (parseFloat(inputOffset.value) || 0) : 0;
        const flip = inputFlip ? inputFlip.checked : false;

        // Clone normal
        let effectiveNormal = normal.clone();
        let effectiveConstant = baseConstant;

        // Apply Flip
        if (flip) {
            effectiveNormal.negate();
            effectiveConstant = -effectiveConstant;
        }

        // Apply offset - when flipped, reverse offset direction
        let effectiveOffset = flip ? -offset : offset;
        const constant = effectiveConstant + effectiveOffset;
        const plane = new THREE.Plane(effectiveNormal, constant); // World Space Plane

        // Transform Logic:
        // We need to check intersection for ALL visible meshes in the scene
        // because "Visual Clipping" is Global.

        let targetMeshes = [];
        if (this.viewer && this.viewer.dxfGroup) {
            this.viewer.dxfGroup.traverse(child => {
                if (child.isMesh && child.visible) {
                    targetMeshes.push(child);
                }
            });
        }

        // If no global group, fallback to selected object
        if (targetMeshes.length === 0 && object.isMesh) {
            targetMeshes.push(object);
        }

        console.log(`[Section] checking ${targetMeshes.length} meshes for intersection...`);

        // Intersection Logic
        // Iterate all triangles. Check edge intersections.
        // const pos = geometry.attributes.position; // Moved into processTriangle
        // const index = geometry.index; // Moved into processTriangle
        // const worldMatrix = object.matrixWorld; // Moved into processTriangle

        console.log('[Section] Plane Constant:', plane.constant);
        console.log('[Section] Plane Normal:', plane.normal);

        // Debug Sample (Removed as it's now per-mesh)
        // if (pos.count > 0) {
        //     const testV = new THREE.Vector3().fromBufferAttribute(pos, 0).applyMatrix4(worldMatrix);
        //     console.log('[Section] Sample Vertex (World):', testV);
        //     console.log('[Section] Dist to Plane:', plane.distanceToPoint(testV));
        // }

        const lines = [];
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();
        this._debugCoplanarCount = 0;

        const processTriangle = (pos, index, matrixWorld) => {
            const count = index ? index.count : pos.count;
            if (count === 0) return;

            // Pre-allocate reused vectors? We use closure vars vA, vB, vC.

            const checkTri = (aIdx, bIdx, cIdx) => {
                vA.fromBufferAttribute(pos, aIdx).applyMatrix4(matrixWorld);
                vB.fromBufferAttribute(pos, bIdx).applyMatrix4(matrixWorld);
                vC.fromBufferAttribute(pos, cIdx).applyMatrix4(matrixWorld);

                const dA = plane.distanceToPoint(vA);
                const dB = plane.distanceToPoint(vB);
                const dC = plane.distanceToPoint(vC);

                // Robust check with Epsilon
                const eps = 0.001;

                // Trivial Reject
                if (dA > eps && dB > eps && dC > eps) return;
                if (dA < -eps && dB < -eps && dC < -eps) return;

                const sign = (val) => val > eps ? 1 : (val < -eps ? -1 : 0);
                const sA = sign(dA);
                const sB = sign(dB);
                const sC = sign(dC);

                if (sA === sB && sB === sC && sA !== 0) return;

                // Coplanar
                if (Math.abs(dA) <= eps && Math.abs(dB) <= eps && Math.abs(dC) <= eps) {
                    const area = vA.distanceTo(vB) + vB.distanceTo(vC) + vC.distanceTo(vA); // heuristic perimeter
                    if (area < eps) return;

                    if (this._debugCoplanarCount < 5) {
                        console.log('[Section] Found Coplanar Triangle!', dA, dB, dC);
                        this._debugCoplanarCount = (this._debugCoplanarCount || 0) + 1;
                    }

                    lines.push({ start: vA.clone(), end: vB.clone() });
                    lines.push({ start: vB.clone(), end: vC.clone() });
                    lines.push({ start: vC.clone(), end: vA.clone() });
                    return;
                }

                // Intersect
                const points = [];
                // AB
                if (sA !== sB) points.push(vA.clone().lerp(vB, dA / (dA - dB)));
                // BC
                if (sB !== sC) points.push(vB.clone().lerp(vC, dB / (dB - dC)));
                // CA
                if (sC !== sA) points.push(vC.clone().lerp(vA, dC / (dC - dA)));

                if (points.length >= 2) {
                    // Start/End
                    lines.push({ start: points[0], end: points[1] });
                }
            };

            if (index) {
                for (let i = 0; i < index.count; i += 3) {
                    checkTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
                }
            } else {
                for (let i = 0; i < pos.count; i += 3) {
                    checkTri(i, i + 1, i + 2);
                }
            }
        };

        // Iterate all target meshes
        targetMeshes.forEach(mesh => {
            const geo = mesh.geometry;
            if (!geo) return;
            const pos = geo.attributes.position;
            if (!pos) return;
            const index = geo.index;
            const mat = mesh.matrixWorld;

            processTriangle(pos, index, mat);
        });

        console.log(`[Section] Found ${lines.length} intersection segments.`);

        if (lines.length === 0) {
            if (isCopy) this.app.updateStatus('No intersection found at this offset.');
            return [];
        }

        if (!isCopy) return lines; // Return raw data for Cap generation

        // Convert to clipboard format
        const entities = lines.map(line => {
            // Create Fake Entity
            const entity = {
                type: 'LINE',
                startPoint: { x: line.start.x, y: line.start.y, z: line.start.z },
                endPoint: { x: line.end.x, y: line.end.y, z: line.end.z },
                layer: 'SECTION_CUT',
                color: 0xFFFFFF // White for section cut
            };
            // ... (rest of entity creation) ...
            return entity; // Changed map logic slightly to simplify just for clipboard?
            // Wait, previous code returned lineObj.
        });

        // Re-implement mapping fully to avoid errors
        const clipEntities = lines.map(line => {
            const entity = {
                type: 'LINE',
                startPoint: { x: line.start.x, y: line.start.y, z: line.start.z },
                endPoint: { x: line.end.x, y: line.end.y, z: line.end.z },
                layer: 'SECTION_CUT',
                color: 0xFFFFFF
            };
            const lineGeo = new THREE.BufferGeometry().setFromPoints([line.start, line.end]);
            const lineMat = new THREE.LineBasicMaterial({ color: 0xFFFFFF });
            const lineObj = new THREE.Line(lineGeo, lineMat);
            lineObj.userData = { type: 'LINE', entity: entity, layer: 'SECTION_CUT', originalColor: 0xFFFFFF };
            return lineObj;
        });

        // Copy
        this.app.clipboardManager.copy(clipEntities);
        this.app.updateStatus(`Copied ${lines.length} segments to clipboard.`);
        return lines;

        if (this.app.languageManager) {
            this.app.updateStatus(`Copied ${entities.length} section lines to clipboard.`);
        } else {
            this.app.updateStatus(`Copied ${entities.length} section lines.`);
        }
    }
}
