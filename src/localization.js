export const availableLanguages = {
    tr: { name: "Türkçe", flag: "TR" },
    en: { name: "English", flag: "GB" }
};

export const translations = {
    tr: {
        // Header / File
        "appTitle": "DXF Görüntüleyici",
        "openFile": "Dosya Aç",
        "noFileSelected": "Dosya seçilmedi",
        "loadingDXF": "DXF dosyası yükleniyor...",
        "errorLoading": "DXF yüklenirken hata: ",
        "loadedInfo": "{count} varlık, {layers} katman yüklendi",

        // Tools
        "measureDistance": "Mesafe Ölç",
        "measureAngle": "Açı Ölç",
        "measureRadius": "Yarıçap Ölç",
        "measureCoordinate": "Koordinat",
        "layers": "Katmanlar",
        "settings": "Ayarlar",
        "fitView": "Sığdır",

        // Tool Instructions
        "instrDistance": "Mesafe ölçmek için iki nokta tıklayın",
        "instrAngle": "Açı ölçmek için iki çizgiye tıklayın",
        "instrRadius": "Yarıçap ölçmek için çember veya yaya tıklayın",
        "instrCoordinate": "Koordinat almak için bir nokta tıklayın",
        "selectTool": "Ölçüm yapmak için bir araç seçin",

        // Panels
        "objectInfo": "Nesne Bilgisi",
        "entityTree": "Varlık Ağacı",
        "clickObjectInfo": "Bilgi için nesneye tıklayın",
        "noEntities": "Varlık yüklenmedi",
        "noLayers": "Katman yok",
        "multiSelect": "Çoklu Seçim",
        "selectionCount": "Seçim ({count} öğe)",
        "chainSelection": "Zincir Seçimi ({count})",

        // Entity Details
        "startPoint": "Başlangıç Noktası",
        "endPoint": "Bitiş Noktası",
        "centerPoint": "Merkez Noktası",
        "length": "Uzunluk",
        "angle": "Açı",
        "radius": "Yarıçap",
        "diameter": "Çap",
        "startAngle": "Başlangıç Açısı",
        "endAngle": "Bitiş Açısı",
        "pattern": "Desen",
        "solidFill": "Katı Dolgu",
        "loops": "Döngüler",
        "blockName": "Blok Adı",
        "position": "Konum",
        "scale": "Ölçek",
        "rotation": "Döndürme",
        "yes": "Evet",
        "no": "Hayır",
        "horizontal": "Yatay",
        "vertical": "Dikey",
        "area": "Alan",
        "circumference": "Çevre",
        "totalLength": "Toplam Uzunluk",
        "dimensionValue": "Ölçü Değeri",
        "profileArea": "Seçim Alanı ({count} boşaltma)",
        "weight": "Gramaj",

        // Settings
        "background": "Arkaplan",
        "linetypeScale": "Çizgi Tipi Ölçeği",
        "snapTolerance": "Yakalama Toleransı",
        "measurementColor": "Ölçüm Rengi",

        // Footer / OSNAP
        "ready": "Hazır",
        "osnap": "OSNAP",
        "zoom": "Yakınlaştırma",
        "cursorCoords": "X: {x} | Y: {y}",

        // Actions
        "selectionCancelled": "Seçim iptal edildi",
        "selectionCleared": "Seçim temizlendi",
        "entitySelected": "Varlık Seçildi",
        "measurementSelected": "Ölçüm Seçildi",
        "measurementDeleted": "Ölçüm silindi",
        "entitiesDeleted": "varlık silindi",
        "selectionDeleted": "Seçim silindi",

        // Help Overlay
        "helpPan": "🖱️ Kaydır: Tıkla ve sürükle",
        "helpZoom": "🔍 Yakınlaştır: Fare tekerleği",
        "helpLoad": "📁 Yükle: Yukarıdaki 'Dosya Aç' butonu",

        // OSNAP Types
        "endpoint": "Uç Nokta",
        "midpoint": "Orta Nokta",
        "center": "Merkez",
        "quadrant": "Çeyrek",
        "intersection": "Kesişim",
        "perpendicular": "Dik",
        "nearest": "En Yakın",
        "node": "Nokta",

        // Measurements
        "distLabel": "Mesafe",
        "horizLabel": "Yatay",
        "vertLabel": "Dikey",
        "angleLabel": "Açı",
        "angleBetween": "Çizgiler arası açı",

        // Sidebar
        "closeSidebar": "Kenar Çubuğunu Kapat",
        "showSidebar": "Kenar Çubuğunu Göster",

        // Zoom
        "zoomMenu": "Yakınlaştırma Araçları",
        "zoomExtents": "Sığdır",
        "zoomWindow": "Pencere",
        "instrZoomWindow": "Yakınlaştırmak için pencere çizin",

        // Weight Calculation
        "weightTitle": "Metre Gramaj Hesabı",
        "weightBtn": "Gramaj Hesapla",
        "material": "Malzeme",
        "mandrel": "Zıvana",
        "area": "Net Alan",
        "weight": "Gramaj",
        "unitMm2": "mm²",
        "unitKgM": "kg/m",
        "outerPerimeter": "Dış Çevre",
        "shapeFactor": "Şekil Faktörü",
        "totalPerimeter": "Toplam Çevre",
        "addTemplate": "Antet Ekle",
        "selectTemplate": "Antet Seç",
        "templateFile": "Antet Dosyası",
        "ok": "Tamam",
        "cancel": "İptal",
        "scale": "Ölçek",
        "templateScale": "Şablon Ölçeği",
        "scrollToScale": "Ölçeklemek için scroll kullanın",
        "clickToPlace": "Yerleştirmek için tıklayın",
        "print": "Yazdır",
        "selectPrintArea": "Yazdırma alanı seçin"
    },
    en: {
        // Header / File
        "appTitle": "DXF Viewer",
        "openFile": "Open DXF File",
        "noFileSelected": "No file selected",
        "loadingDXF": "Loading DXF file...",
        "errorLoading": "Error loading DXF: ",
        "loadedInfo": "Loaded {count} entities, {layers} layers",

        // Tools
        "measureDistance": "Measure Distance",
        "measureAngle": "Measure Angle",
        "measureRadius": "Measure Radius",
        "measureCoordinate": "Coordinate",
        "layers": "Layers",
        "settings": "Settings",
        "fitView": "Fit",

        // Tool Instructions
        "instrDistance": "Click two points to measure distance",
        "instrAngle": "Click two lines to measure angle between them",
        "instrRadius": "Click on a circle or arc to measure radius",
        "instrCoordinate": "Click a point to get coordinates",
        "selectTool": "Select a tool to measure",

        // Panels
        "objectInfo": "Object Info",
        "entityTree": "Entity Tree",
        "clickObjectInfo": "Click an object to view info",
        "noEntities": "No entities loaded",
        "noLayers": "No layers available",
        "multiSelect": "Multi-Select",
        "selectionCount": "Selection ({count} items)",
        "chainSelection": "Chain Selection ({count})",

        // Entity Details
        "startPoint": "Start Point",
        "endPoint": "End Point",
        "centerPoint": "Center Point",
        "length": "Length",
        "angle": "Angle",
        "radius": "Radius",
        "diameter": "Diameter",
        "startAngle": "Start Angle",
        "endAngle": "End Angle",
        "pattern": "Pattern",
        "solidFill": "Solid Fill",
        "loops": "Loops",
        "blockName": "Block Name",
        "position": "Position",
        "scale": "Scale",
        "rotation": "Rotation",
        "yes": "Yes",
        "no": "No",
        "horizontal": "Horizontal",
        "vertical": "Vertical",
        "area": "Area",
        "circumference": "Circumference",
        "totalLength": "Total Length",
        "dimensionValue": "Dimension Value",
        "profileArea": "Section Area ({count} cav.)",
        "weight": "Weight",

        // Settings
        "background": "Background",
        "linetypeScale": "Linetype Scale",
        "snapTolerance": "Snap Tolerance",
        "measurementColor": "Measurement Color",

        // Footer / OSNAP
        "ready": "Ready",
        "osnap": "OSNAP",
        "zoom": "Zoom",
        "cursorCoords": "X: {x} | Y: {y}",

        // Actions
        "selectionCancelled": "Selection cancelled",
        "selectionCleared": "Selection cleared",
        "entitySelected": "Entity Selected",
        "measurementSelected": "Measurement Selected",
        "measurementDeleted": "Measurement deleted",
        "entitiesDeleted": "entities deleted",
        "selectionDeleted": "Selection deleted",

        // Help Overlay
        "helpPan": "🖱️ Pan: Click and drag",
        "helpZoom": "🔍 Zoom: Mouse wheel",
        "helpLoad": "📁 Load: Click 'Open DXF File' above",

        // OSNAP Types
        "endpoint": "Endpoint",
        "midpoint": "Midpoint",
        "center": "Center",
        "quadrant": "Quadrant",
        "intersection": "Intersection",
        "perpendicular": "Perpendicular",
        "nearest": "Nearest",
        "node": "Node",

        // Measurements
        "distLabel": "Distance",
        "horizLabel": "Horiz",
        "vertLabel": "Vert",
        "angleLabel": "Angle",
        "angleBetween": "Angle between lines",

        // Sidebar
        "closeSidebar": "Close Sidebar",
        "showSidebar": "Show Sidebar",

        // Zoom
        "zoomMenu": "Zoom Tools",
        "zoomExtents": "Zoom Extents",
        "zoomWindow": "Zoom Window",
        "instrZoomWindow": "Draw a window to zoom",

        // Weight Calculation
        "weightTitle": "Weight Calculation",
        "weightBtn": "Calculate Weight",
        "material": "Material",
        "mandrel": "Mandrel",
        "area": "Net Area",
        "weight": "Weight",
        "unitMm2": "mm²",
        "unitKgM": "kg/m",
        "outerPerimeter": "Outer Perimeter",
        "shapeFactor": "Shape Factor",
        "totalPerimeter": "Total Perimeter",
        "addTemplate": "Add Template",
        "selectTemplate": "Select Template",
        "templateFile": "Template File",
        "ok": "OK",
        "cancel": "Cancel",
        "scale": "Scale",
        "templateScale": "Template Scale",
        "scrollToScale": "Use scroll to scale",
        "clickToPlace": "Click to place",
        "print": "Print",
        "selectPrintArea": "Select print area"
    }
};

export class LanguageManager {
    constructor() {
        this.currentLang = 'tr'; // Default Turkish
        this.listeners = [];
    }

    subscribe(callback) {
        this.listeners.push(callback);
    }

    init() {
        this.renderSelector();
        this.updateUI();
    }

    setLanguage(lang) {
        if (availableLanguages[lang]) {
            this.currentLang = lang;
            this.updateUI();
            this.updateSelectorState();
            this.notifyListeners();
        }
    }

    notifyListeners() {
        this.listeners.forEach(cb => cb(this.currentLang));
    }

    translate(key) {
        const dict = translations[this.currentLang] || translations['en'];
        return dict[key] || key;
    }

    renderSelector() {
        const container = document.getElementById('language-selector-container');
        if (!container) return;

        // Clear container
        container.innerHTML = '';
        // Set container styling for dropdown positioning
        container.className = 'relative ml-2';

        // Create Main Toggle Button
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'btn btn-secondary flex items-center gap-2 min-w-[44px] justify-center px-2';
        toggleBtn.title = 'Select Language';

        const currentFlag = availableLanguages[this.currentLang].flag;
        toggleBtn.innerHTML = `<span class="text-xl leading-none">${currentFlag}</span>`;

        // Create Dropdown Menu
        // Hidden by default
        const dropdown = document.createElement('div');
        dropdown.className = 'hidden absolute top-full right-0 mt-2 p-1.5 rounded-xl bg-gray-900/95 backdrop-blur-xl border border-white/10 shadow-2xl min-w-[120px] z-[1001] flex flex-col gap-1';

        Object.keys(availableLanguages).forEach(lang => {
            const langData = availableLanguages[lang];
            const option = document.createElement('button');

            // Highlight selected
            const isActive = this.currentLang === lang;
            const activeClass = isActive ? 'bg-white/10 border-white/10' : 'border-transparent hover:bg-white/5';

            option.className = `w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${activeClass}`;
            option.innerHTML = `
                <span class="text-xl leading-none">${langData.flag}</span>
                <span class="text-sm font-medium text-white">${langData.name}</span>
            `;

            option.onclick = (e) => {
                e.stopPropagation();
                this.setLanguage(lang);
                dropdown.classList.add('hidden');
            };

            dropdown.appendChild(option);
        });

        // Toggle Event
        toggleBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        };

        // Close on outside click
        // Store the handler so we don't duplicate listeners if re-rendered
        if (!this._closeHandler) {
            this._closeHandler = (e) => {
                const dropdownEl = container.querySelector('div.absolute'); // Find current dropdown
                if (dropdownEl && !dropdownEl.classList.contains('hidden') && !container.contains(e.target)) {
                    dropdownEl.classList.add('hidden');
                }
            };
            document.addEventListener('click', this._closeHandler);
        }

        container.appendChild(toggleBtn);
        container.appendChild(dropdown);
    }

    updateSelectorState() {
        // Re-render to update selected state and main button icon
        this.renderSelector();
    }

    updateUI() {
        // Update elements with data-i18n attribute
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.dataset.i18n;
            const text = this.translate(key);

            // Handle different element types
            if (el.tagName === 'INPUT' && el.type === 'placeholder') {
                el.placeholder = text;
            } else if (el.title && el.textContent.trim() === '') {
                // It might be an icon button with title only
                el.title = text;
            } else {
                // If element has icon/svg, we want to keep it and only update text node?
                // Or user will wrap text in span?
                // Simplest: Check if it has children.
                if (el.children.length > 0) {
                    // Look for a text node or specific span?
                    // For buttons like "Fit", it has SVG + Text.
                    // The text is a text node.

                    // Simply replacing textContent wipes SVG.
                    // Let's rely on valid HTML structure: <span data-i18n> or similar for mixed content.
                    // But for this request, I will modify index.html to wrap text in spans for safety.
                    // For simple elements (headers, labels), textContent is fine.

                    // Only specific known mixed buttons need care.
                    // Helper: Find text node and replace?

                    // Safer approach for this specific app:
                    // Most elements are clean.
                    // "Fit" button -> I will wrap "Fit" in a span in index.html.

                    el.textContent = text;
                } else {
                    el.textContent = text;
                }

                // Also update title if it exists and matches? 
                // Currently strictly updating content.
            }

            // Should also update 'title' attribute if it exists?
            // Many buttons use 'title' as tooltip.
            // I'll add `data-i18n-title` support for that.
        });

        const titleElements = document.querySelectorAll('[data-i18n-title]');
        titleElements.forEach(el => {
            el.title = this.translate(el.dataset.i18nTitle);
        });
    }
}
