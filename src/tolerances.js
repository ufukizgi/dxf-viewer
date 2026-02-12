export const STANDARTS = [
    { id: '755-9', name: "755-9 PROFİL", groups: [{ id: 'G1', name: 'GRUP 1', alloys: ['6060', '6063', '6005', '6463', '1050', '1070', '1080'] }, { id: 'G2', name: 'GRUP 2', alloys: ['6082', '6061', '6013'] }] }
    //{ id: '755-8', name: "755-8 BORU", groups: [{ id: 'G1', name: 'GRUP 1', alloys: ['6060', '6063', '6005', '6082', '6061', '6013', '6463', '1050', '1070', '1080'] }] },
    //{ id: '755-6', name: "755-6 ALTIKÖŞE DOLU", groups: [{ id: 'G1', name: 'GRUP 1', alloys: ['6060', '6063', '6005', '6082', '6061', '6013', '6463', '1050', '1070', '1080'] }] },
    //{ id: '755-5', name: "755-5 DİKDÖRTGEN DOLU", groups: [{ id: 'G1', name: 'GRUP 1', alloys: ['6060', '6063', '6005', '6082', '6061', '6013', '6463', '1050', '1070', '1080'] }] },
    //{ id: '755-4', name: "755-4 KARE DOLU", groups: [{ id: 'G1', name: 'GRUP 1', alloys: ['6060', '6063', '6005', '6082', '6061', '6013', '6463', '1050', '1070', '1080'] }] },
    //{ id: '755-3', name: "755-3 YUVARLAK DOLU", groups: [{ id: 'G1', name: 'GRUP 1', alloys: ['6060', '6063', '6005', '6082', '6061', '6013', '6463', '1050', '1070', '1080'] }] }
];

export const TOLERANCES = {
    "Standard": "EN 755-9:2016",
    "Linear": {
        "Alloy_Groups": {
            "G1": {
                "Dimensions_H": {
                    "CD_Keys": ["le100", "100_200", "200_300", "300_500", "500_800"],
                    "Data": [
                        { "min": 0, "max": 10, "tolerances": { "le100": 0.40, "100_200": 0.50, "200_300": 0.55, "300_500": 0.60, "500_800": 0.70 } },
                        { "min": 10, "max": 25, "tolerances": { "le100": 0.50, "100_200": 0.70, "200_300": 0.80, "300_500": 0.90, "500_800": 1.10 } },
                        { "min": 25, "max": 50, "tolerances": { "le100": 0.80, "100_200": 0.90, "200_300": 1.00, "300_500": 1.20, "500_800": 1.30 } },
                        { "min": 50, "max": 100, "tolerances": { "le100": 1.00, "100_200": 1.20, "200_300": 1.30, "300_500": 1.60, "500_800": 1.80 } },
                        { "min": 100, "max": 150, "tolerances": { "le100": null, "100_200": 1.50, "200_300": 1.70, "300_500": 1.80, "500_800": 2.00 } },
                        { "min": 150, "max": 200, "tolerances": { "le100": null, "100_200": 1.90, "200_300": 2.20, "300_500": 2.40, "500_800": 2.70 } },
                        { "min": 200, "max": 300, "tolerances": { "le100": null, "100_200": null, "200_300": 2.50, "300_500": 2.80, "500_800": 3.10 } },
                        { "min": 300, "max": 450, "tolerances": { "le100": null, "100_200": null, "200_300": null, "300_500": 3.50, "500_800": 3.80 } },
                        { "min": 450, "max": 600, "tolerances": { "le100": null, "100_200": null, "200_300": null, "300_500": 4.50, "500_800": 5.00 } },
                        { "min": 600, "max": 800, "tolerances": { "le100": null, "100_200": null, "200_300": null, "300_500": null, "500_800": 6.00 } }
                    ]
                },
                "Wall_Thickness_A_B_C": {
                    "CD_Keys": ["le100", "100_300", "300_500", "500_800"],
                    "Data": [
                        { "min": 0, "max": 1.5, "A": { "le100": 0.20, "100_300": 0.25, "300_500": 0.35, "500_800": 0.35 }, "B": { "le100": 0.25, "100_300": 0.40, "300_500": 0.50 }, "C": { "le100": 0.35, "100_300": 0.50, "300_500": 0.60 } },
                        { "min": 1.5, "max": 3, "A": { "le100": 0.20, "100_300": 0.30, "300_500": 0.50, "500_800": 0.55 }, "B": { "le100": 0.35, "100_300": 0.60, "300_500": 1.10, "500_800": 0.90 }, "C": { "le100": 0.45, "100_300": 0.75, "300_500": 1.50, "500_800": 1.10 } },
                        { "min": 3, "max": 6, "A": { "le100": 0.30, "100_300": 0.40, "300_500": 0.75, "500_800": 0.60 }, "B": { "le100": 0.45, "100_300": 0.60, "300_500": 1.20, "500_800": 1.50 }, "C": { "le100": 0.75, "100_300": 1.10, "300_500": 1.50, "500_800": 1.80 } },
                        { "min": 6, "max": 10, "A": { "le100": 0.35, "100_300": 0.50, "300_500": 0.80, "500_800": 0.75 }, "B": { "le100": 0.60, "100_300": 0.80, "300_500": 1.50, "500_800": 1.20 }, "C": { "le100": 0.90, "100_300": 1.20, "300_500": 1.80, "500_800": 2.20 } },
                        { "min": 10, "max": 15, "A": { "le100": 0.45, "100_300": 0.60, "300_500": 0.90, "500_800": 0.90 }, "B": { "le100": 0.70, "100_300": 0.90, "300_500": 1.50, "500_800": 1.80 }, "C": { "le100": 1.20, "100_300": 1.50, "300_500": 2.20, "500_800": 2.70 } },
                        { "min": 15, "max": 20, "A": { "le100": 0.55, "100_300": 0.70, "300_500": 1.00, "500_800": 1.00 }, "B": { "le100": 0.75, "100_300": 1.00, "300_500": 1.80, "500_800": 2.20 }, "C": { "le100": 1.50, "100_300": 2.00, "300_500": 2.70, "500_800": 3.30 } },
                        { "min": 20, "max": 30, "A": { "le100": 0.65, "100_300": 0.80, "300_500": 1.10, "500_800": 1.20 }, "B": { "le100": 0.90, "100_300": 1.20, "300_500": 2.20, "500_800": 2.70 }, "C": { "le100": 1.80, "100_300": 2.20, "300_500": 3.30, "500_800": 4.00 } },
                        { "min": 30, "max": 40, "A": { "le100": 0.80, "100_300": 1.00, "300_500": 1.40, "500_800": 1.50 }, "B": { "le100": 1.00, "100_300": 1.30, "300_500": 2.70, "500_800": 3.30 }, "C": { "le100": null, "100_300": null, "300_500": 3.80, "500_800": 4.50 } },
                        { "min": 40, "max": 50, "A": { "le100": null, "100_300": 1.10, "300_500": 1.60, "500_800": 1.80 }, "B": { "le100": null, "100_300": 1.60, "300_500": 3.00, "500_800": 3.60 }, "C": { "le100": null, "100_300": null, "300_500": null, "500_800": null } }
                    ]
                }
            },
            "Open_Ends_Addition": {
                "Data": [
                    { "min": 0, "max": 20, "addition": 0.00 },
                    { "min": 20, "max": 30, "addition": 0.15 },
                    { "min": 30, "max": 40, "addition": 0.25 },
                    { "min": 40, "max": 60, "addition": 0.40 },
                    { "min": 60, "max": 80, "addition": 0.50 },
                    { "min": 80, "max": 100, "addition": 0.60 },
                    { "min": 100, "max": 125, "addition": 0.80 },
                    { "min": 125, "max": 150, "addition": 1.00 },
                    { "min": 150, "max": 180, "addition": 1.20 },
                    { "min": 180, "max": 210, "addition": 1.40 },
                    { "min": 210, "max": 250, "addition": 1.60 },
                    { "min": 250, "max": 999, "addition": 1.80 }
                ]
            }
        }
    },
    // Angular Tolerances (EN 755-9)
    "Angular": {
        "Right_Angle": [
            { "min": 0, "max": 30, "tol": 0.4 },
            { "min": 30, "max": 50, "tol": 0.7 },
            { "min": 50, "max": 80, "tol": 1.0 },
            { "min": 80, "max": 120, "tol": 1.4 },
            { "min": 120, "max": 180, "tol": 2.0 },
            { "min": 180, "max": 240, "tol": 2.6 },
            { "min": 240, "max": 300, "tol": 3.1 },
            { "min": 300, "max": 400, "tol": 3.5 }
        ]
    },
    // Radius, Diameter placeholders
    "Radius": {
        // To be filled
    },
    "Diameter": {
        // To be filled
    }
};

/**
 * Calculates tolerance based on inputs
 * @param {string} standardId - e.g., '755-9'
 * @param {string} alloyId - e.g., '6063'
 * @param {string} profileType - 'hollow' or 'solid'
 * @param {number} dimension - The measured dimension (Linear value or Angle in degrees)
 * @param {string} toleranceClass - 'A', 'B', 'C', 'H'
 * @param {number} cdValue - Circumscribing Circle Diameter
 * @param {string} dimensionType - 'linear', 'angle', 'radius', 'diameter'
 * @param {number} extraParam - For Angle: Short Side Length (L)
 * @returns {number|null} - Calculated tolerance value
 */
export function calculateTolerance(standardId, alloyId, profileType, dimension, toleranceClass, cdValue = 100, dimensionType = 'linear', extraParam = 0) {
    if (standardId !== '755-9') {
        console.warn('calculateTolerance: Only 755-9 is currently supported.');
        return null;
    }

    console.log(`[Tolerances] calculateTolerance - Type: ${dimensionType}, Dim: ${dimension}, Extra: ${extraParam}`);

    // --- ANGULAR TOLERANCE LOGIC ---
    if (dimensionType === 'angle') {
        // Tolerances in mm (linear deviation at end of short side)

        // Check if 90 degrees (Format usually like "90.0°", we parsed logic earlier to float)
        // Let's assume passed 'dimension' is a float (e.g. 90, 45)
        const isRightAngle = Math.abs(dimension - 90) < 0.1 || Math.abs(dimension - 270) < 0.1; // Allow small epsilon

        if (isRightAngle) {
            // Use Table based on Short Side Length (extraParam)
            const table = TOLERANCES.Angular.Right_Angle;
            const lShort = extraParam;

            const range = table.find(r => lShort > r.min && lShort <= r.max);

            if (range) {
                return range.tol;
            }
            // If > 400? Standard implies continued? Or max?
            if (lShort > 400) return 3.5; // Fallback to max or logic? Assuming max for now.
            return null;

        } else {
            // Non-90 Degrees: L * sin(1°)
            // sin(1 degree) approx 0.01745
            const sin1 = Math.sin(1 * Math.PI / 180);
            const tol = extraParam * sin1;
            return parseFloat(tol.toFixed(2));
        }
    }

    // --- LINEAR TOLERANCE LOGIC ---
    // 1. Determine Alloy Group (G1 or G2)
    const standard = STANDARTS.find(s => s.id === standardId);
    if (!standard) return null;

    let groupId = 'G1'; // Default
    for (const group of standard.groups) {
        if (group.alloys.includes(alloyId)) {
            groupId = group.id;
            break;
        }
    }
    console.log(`[Tolerances] calculateTolerance - Standard: ${standardId}, Alloy: ${alloyId} -> Group: ${groupId}, Type: ${dimensionType}`);

    // Select Tolerance Set based on Dimension Type
    let rootNode = null;
    if (!dimensionType || dimensionType === 'linear') {
        rootNode = TOLERANCES.Linear;
    } else if (dimensionType === 'radius') {
        rootNode = TOLERANCES.Radius;
    } else if (dimensionType === 'diameter') {
        rootNode = TOLERANCES.Diameter;
    }

    if (!rootNode) return null;

    // For Linear, we have Alloy_Groups. For others? 
    // Assuming Linear logic for now:
    if (dimensionType === 'linear' || !dimensionType) {
        const groupData = rootNode.Alloy_Groups[groupId];
        if (!groupData) return null;

        // 2. Select Table based on Tolerance Class
        let tableType;
        if (toleranceClass === 'H') {
            tableType = 'Dimensions_H';
        } else if (['A', 'B', 'C'].includes(toleranceClass)) {
            tableType = 'Wall_Thickness_A_B_C';
        } else {
            return null;
        }

        const table = groupData[tableType];
        if (!table) return null;

        // 3. Find Range for Dimension
        const range = table.Data.find(r => dimension > r.min && dimension <= r.max);

        // Special handling for 0 or exact min boundary?
        // Usually ranges are (min, max]. Standard often says "Over X up to and including Y".
        // 0 might need handling if min is 0.
        if (!range && dimension === 0) return 0;
        if (!range) {
            // Check if it matches the exact min of the first range (0)
            const first = table.Data[0];
            if (dimension >= first.min && dimension <= first.max) {
                // It matched inside logic above if > min. If == min (0), handled here?
                // Actually strict > min means 0 is excluded.
                // Let's assume > 0.
            }
            return null;
        }

        // 4. Get Column Key from CD
        const cdKey = getCDKey(cdValue, tableType);
        console.log(`[Tolerances] calculateTolerance - CD: ${cdValue} -> Key: ${cdKey}`);

        if (!cdKey) return null;

        // 5. Retrieve Value
        let result = null;
        if (tableType === 'Dimensions_H') {
            // tolerances is an object inside range
            if (range.tolerances) {
                result = range.tolerances[cdKey];
            }
        } else {
            // For Wall Thickness, structure is range[Class][Key]
            if (range[toleranceClass]) {
                result = range[toleranceClass][cdKey];
            } else if (range.A && toleranceClass === 'A') { // Fallback if direct access fails? No, structure is standardized above.
                result = range.A[cdKey];
            }
        }

        return result;
    }

    return null; // Not implemented for other types yet
}

/**
 * Calculates Open End tolerance addition
 * @param {number} baseTolerance - The H tolerance calculated previously
 * @param {number} lengthE - The length of the open end
 * @returns {number} - The new total tolerance
 */
export function calculateOpenEndTolerance(baseTolerance, lengthE) {
    // Open Ends is specifically part of Linear -> Alloy_Groups -> Open_Ends_Addition
    // We can access it directly
    const table = TOLERANCES.Linear.Alloy_Groups.Open_Ends_Addition;

    if (!baseTolerance) return null;

    const data = table.Data;
    const range = data.find(r => lengthE > r.min && lengthE <= r.max);

    let addition = 0;
    if (range) {
        addition = range.addition;
    } else if (lengthE === 0) {
        addition = 0;
    }

    return parseFloat((baseTolerance + addition).toFixed(2));
}