const map = L.map("map", {
    zoomControl: true,
    minZoom: 1,
    maxZoom: 30,
    zoomSnap: 0.1,
    zoomDelta: 0.5,
    preferCanvas: true
}).setView([15.598, 120.922], 13);
map.zoomControl.setPosition("bottomleft");
map.createPane("transformerPane");
map.getPane("transformerPane").style.zIndex = 650;
let viewerMap = null;
let viewerBaseLines = [];
let viewerHighlightLines = [];
let viewerMarkers = [];
let kmlOverlayLayers = [];
let kmlOverlayLayerMap = new Map();
let viewerKmlOverlayLayers = [];
let viewerKmlOverlayLayerMap = new Map();
let kmlTransformerMarkers = [];
let viewerKmlTransformerMarkers = [];
let kmlEndpointMapCache = null;
let showGpxLines = true;
let showKmlLines = true;
let showInferredConnections = true;
const canvasRenderer = L.canvas({ padding: 0.5 });
const LARGE_DATASET_THRESHOLD = {
    lines: 1200,
    towers: 2000,
    kml: 900,
    accounts: 4000,
};
const DEEP_ZOOM_PERFORMANCE_THRESHOLD = 18;
let performanceMode = {
    enabled: false,
    reason: "",
};
let kmlFeatureIndex = new Map();
let towerNameIndex = new Map();
let lastZoomVisualBucket = null;
let lastKnownDataBounds = null;

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 30,
    maxNativeZoom: 19,
    noWrap: true,
    referrerPolicy: "strict-origin-when-cross-origin",
    attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("fileInput");
const selectedFileName = document.getElementById("selectedFileName");
const statusBox = document.getElementById("statusBox");
const xlsxUploadForm = document.getElementById("xlsxUploadForm");
const xlsxFileInput = document.getElementById("xlsxFileInput");
const selectedXlsxFileName = document.getElementById("selectedXlsxFileName");
const xlsxStatusBox = document.getElementById("xlsxStatusBox");
const kmlUploadForm = document.getElementById("kmlUploadForm");
const kmlFileInput = document.getElementById("kmlFileInput");
const selectedKmlFileName = document.getElementById("selectedKmlFileName");
const kmlStatusBox = document.getElementById("kmlStatusBox");
const workspaceRecoveryNotice = document.getElementById("workspaceRecoveryNotice");
const refreshViewBtn = document.getElementById("refreshViewBtn");
const validationReportBtn = document.getElementById("validationReportBtn");
const clearWorkspaceBtn = document.getElementById("clearWorkspaceBtn");
const addInterruptionBtn = document.getElementById("addInterruptionBtn");
const mapSearchInput = document.getElementById("mapSearchInput");
const mapSearchBtn = document.getElementById("mapSearchBtn");
const toggleGpxBtn = document.getElementById("toggleGpxBtn");
const toggleKmlBtn = document.getElementById("toggleKmlBtn");
const toggleInferredBtn = document.getElementById("toggleInferredBtn");
const uploadedFeederSelect = document.getElementById("uploadedFeederSelect");
const restoreUploadedFeederBtn = document.getElementById("restoreUploadedFeederBtn");
const deleteUploadedFeederBtn = document.getElementById("deleteUploadedFeederBtn");
const deleteUploadedFeederModal = document.getElementById("deleteUploadedFeederModal");
const deleteUploadedFeederList = document.getElementById("deleteUploadedFeederList");
const zoomFeederBtn = document.getElementById("zoomFeederBtn");
const zoomSelectedBtn = document.getElementById("zoomSelectedBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const towerCountValue = document.getElementById("towerCountValue");
const accountCountValue = document.getElementById("accountCountValue");
const mapLoadingIndicator = document.getElementById("mapLoadingIndicator");
const mapLoadingText = document.getElementById("mapLoadingText");
const detailsBox = document.getElementById("detailsBox");
const sidePanel = document.getElementById("sidePanel");
const mainLayout = document.getElementById("mainLayout");
const sidePanelSearchInput = document.getElementById("sidePanelSearchInput");
const interruptionList = document.getElementById("interruptionList");
const interruptionCount = document.getElementById("interruptionCount");
const interruptionTabs = document.getElementById("interruptionTabs");
const openViewerBtn = document.getElementById("openViewerBtn");
const interruptionModal = document.getElementById("interruptionModal");
const interruptionForm = document.getElementById("interruptionForm");
const interruptionNameInput = document.getElementById("interruptionNameInput");
const interruptionStatusInput = document.getElementById("interruptionStatusInput");
const interruptionStartDateInput = document.getElementById("interruptionStartDateInput");
const interruptionStartTimeInput = document.getElementById("interruptionStartTimeInput");
const interruptionEndDateInput = document.getElementById("interruptionEndDateInput");
const interruptionEndTimeInput = document.getElementById("interruptionEndTimeInput");
const interruptionActionTakenInput = document.getElementById("interruptionActionTakenInput");
const interruptionRemarksInput = document.getElementById("interruptionRemarksInput");
const interruptionFormInfo = document.getElementById("interruptionFormInfo");
const viewerModal = document.getElementById("viewerModal");
const viewerTitle = document.getElementById("viewerTitle");
const viewerMeta = document.getElementById("viewerMeta");
const viewerDetails = document.getElementById("viewerDetails");
const viewerInterruptionTabs = document.getElementById("viewerInterruptionTabs");
const viewerValidationBtn = document.getElementById("viewerValidationBtn");
const generateExportBtn = document.getElementById("generateExportBtn");
const validationModal = document.getElementById("validationModal");
const validationMeta = document.getElementById("validationMeta");
const validationReportContent = document.getElementById("validationReportContent");
const traceBadgeBox = document.getElementById("traceBadgeBox");
const traceConfidenceBadge = document.getElementById("traceConfidenceBadge");
const traceWarningBox = document.getElementById("traceWarningBox");
const feederUploadButton = uploadForm.querySelector("button[type='submit']");
const xlsxUploadButton = xlsxUploadForm.querySelector("button[type='submit']");
const kmlUploadButton = kmlUploadForm.querySelector("button[type='submit']");
const currentUser = window.currentUser || null;
const currentPermissions = window.currentPermissions || {};
const csrfToken = window.csrfToken || "";

let networkData = null;
let accountData = null;
let accountLookupIndex = null;
let accountSearchRowsIndex = null;
let kmlOverlayData = null;
let currentPanelData = null;
let currentContextType = "tower";
let activeKmlFeatureId = null;
let towerMarkers = [];
let linePolylines = [];
let interruptions = [];
let activeInterruptionId = null;
let interruptionCounter = 1;
let interruptionsLoaded = false;
let feederFileName = "";
let initialInterruptionRequestHandled = false;
let validationReports = {
    feeder: null,
    xlsx: null,
    kml: null,
    audit: null,
};
let sidePanelSearchTerm = "";
let mapHoverPreviewCache = {
    towers: new Map(),
    lines: new Map(),
    kml: new Map(),
    transformers: new Map(),
};
let activeNetworkLineIndexes = new Set();
let activeTowerMarkerIndexes = new Set();
let activeKmlHighlightIds = new Set();
let activeSelectedNetworkLineIndex = null;
let lastAppliedGpxVisibilitySignature = "";
let lastAppliedKmlVisibilitySignature = "";
let workspaceRestoreToken = 0;
let accountMatchRequestCache = new Map();
let accountSearchRequestCache = new Map();
let uploadedFeeders = [];
const ACCOUNT_MATCH_REQUEST_CACHE_LIMIT = 18;
const ACCOUNT_SEARCH_REQUEST_CACHE_LIMIT = 24;

const normalLineColor = "#16a34a";
const normalKmlLineColor = "#2563eb";
const affectedLineColor = "#ff0000";
const selectedLineColor = "#f59e0b";
const manualOverrideColor = "#7c3aed";
const viewerLineColor = "#b7e4c7";
const talaveraSubstationCenter = [15.59822, 120.92152];

function getMapLineWeight(zoom = map.getZoom()) {
    return Math.max(1.2, Math.min(3, zoom / 8));
}

function getNetworkLineVisualSignature(line, isActive = false, isSelected = false, zoomBucket = getVisualZoomBucket()) {
    return [
        line?.edge_type || "base",
        isActive ? 1 : 0,
        isSelected ? 1 : 0,
        zoomBucket,
    ].join("|");
}

function getTowerMarkerRadius(zoom = map.getZoom(), isHighlighted = false) {
    const baseRadius = Math.max(4, Math.min(10, 3 + (zoom / 6)));
    return isHighlighted ? baseRadius + 2 : baseRadius;
}

function getTowerMarkerVisualSignature(isHighlighted = false, zoomBucket = getVisualZoomBucket()) {
    return `${isHighlighted ? 1 : 0}|${zoomBucket}`;
}

function getTowerMarkerStyle(isHighlighted = false) {
    return {
        radius: getTowerMarkerRadius(map.getZoom(), isHighlighted),
        color: isHighlighted ? selectedLineColor : "#111",
        fillColor: isHighlighted ? "#fff7ed" : "#111",
        fillOpacity: 1,
        weight: isHighlighted ? 3 : 1,
    };
}

function getKmlFeatureVisualSignature(feature, isActive = false, zoomBucket = getVisualZoomBucket()) {
    return [
        feature?.geometry || "line",
        feature?.style?.weight ?? "",
        feature?.style?.opacity ?? "",
        isActive ? 1 : 0,
        zoomBucket,
    ].join("|");
}

function applyStyleIfChanged(layer, style, signature) {
    if (!layer || typeof layer.setStyle !== "function") {
        return;
    }
    if (layer._visualStyleSignature === signature) {
        return;
    }
    layer.setStyle(style);
    layer._visualStyleSignature = signature;
}

function updateTransformerMarkerIcon(marker, zoomBucket = getVisualZoomBucket()) {
    if (!marker || typeof marker.setIcon !== "function") {
        return;
    }
    if (marker._visualIconBucket === zoomBucket) {
        return;
    }
    marker.setIcon(createTransformerIcon(marker.transformerLabel || "DT", zoomBucket));
    marker._visualIconBucket = zoomBucket;
}

function getAllMapLines() {
    return [
        ...linePolylines.filter(Boolean),
        ...kmlOverlayLayers.filter(Boolean),
    ];
}

function getAllMapMarkers() {
    return [
        ...towerMarkers.filter(Boolean),
        ...kmlTransformerMarkers.filter(Boolean),
    ];
}

function buildVisibilitySignature() {
    return [
        showGpxLines ? "g1" : "g0",
        showKmlLines ? "k1" : "k0",
        showInferredConnections ? "i1" : "i0",
        linePolylines.length,
        kmlOverlayLayerMap.size,
    ].join("|");
}

function getChangedIndexes(previousSet, nextSet, additionalIndexes = []) {
    const changed = new Set(additionalIndexes.filter((value) => Number.isInteger(value)));
    previousSet.forEach((value) => changed.add(value));
    nextSet.forEach((value) => changed.add(value));
    return changed;
}

function setsEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right || left.size !== right.size) {
        return false;
    }
    for (const value of left) {
        if (!right.has(value)) {
            return false;
        }
    }
    return true;
}

function clearAccountRequestCaches() {
    accountMatchRequestCache = new Map();
    accountSearchRequestCache = new Map();
}

function setLimitedRowCacheEntry(cache, key, rows, limit) {
    cache.delete(key);
    cache.set(key, rows.map(cloneMatchedRow));
    while (cache.size > limit) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) break;
        cache.delete(oldestKey);
    }
}

function getTotalRenderedFeatureCount() {
    return linePolylines.length + towerMarkers.length + kmlOverlayLayers.length + kmlTransformerMarkers.length;
}

function shouldEnableMapHover() {
    if (performanceMode.enabled) {
        return false;
    }
    if (getTotalRenderedFeatureCount() > 1800) {
        return false;
    }
    return map.getZoom() < DEEP_ZOOM_PERFORMANCE_THRESHOLD;
}

function shouldUseLightweightZoomRefresh() {
    return performanceMode.enabled || getTotalRenderedFeatureCount() > 2200;
}

function zoomToLoadedGeometry() {
    const allLines = getAllMapLines().filter((layer) => layer && typeof layer.getBounds === "function");
    const allMarkers = getAllMapMarkers();
    if (allLines.length || allMarkers.length) {
        const group = L.featureGroup([...allLines, ...allMarkers]);
        const bounds = group.getBounds();
        if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }
    }
}

function updateMapGeometryLineWeights() {
    if (shouldUseLightweightZoomRefresh()) {
        return;
    }
    const zoomBucket = getVisualZoomBucket();
    const activeLineIndexes = activeNetworkLineIndexes;
    const selectedLineIndex = activeSelectedNetworkLineIndex;
    linePolylines.forEach((polyline, index) => {
        if (!polyline || typeof polyline.setStyle !== "function") {
            return;
        }
        const line = networkData?.lines?.[index];
        const isAffected = activeLineIndexes.has(index);
        const isSelected = isAffected && Number.isInteger(selectedLineIndex) && selectedLineIndex === index;
        applyStyleIfChanged(
            polyline,
            isAffected ? getHighlightedNetworkLineStyle(line, isSelected) : getNetworkLineBaseStyle(line),
            getNetworkLineVisualSignature(line, isAffected, isSelected, zoomBucket)
        );
    });

    const activeIds = activeKmlHighlightIds;
    kmlOverlayLayerMap.forEach((layer, featureId) => {
        if (!layer || typeof layer.setStyle !== "function") {
            return;
        }
        const feature = getKmlFeatureById(featureId);
        if (!feature) {
            return;
        }
        const isActive = activeIds.has(featureId);
        applyStyleIfChanged(
            layer,
            getKmlFeatureStyle(feature, isActive),
            getKmlFeatureVisualSignature(feature, isActive, zoomBucket)
        );
    });
}

function updateMapMarkerVisuals() {
    const zoomBucket = getVisualZoomBucket();
    if (shouldUseLightweightZoomRefresh()) {
        kmlTransformerMarkers.forEach((marker) => {
            updateTransformerMarkerIcon(marker, zoomBucket);
        });
        return;
    }

    towerMarkers.forEach((marker) => {
        if (marker && typeof marker.setStyle === "function") {
            const isHighlighted = Boolean(marker.isHighlighted);
            applyStyleIfChanged(
                marker,
                getTowerMarkerStyle(isHighlighted),
                getTowerMarkerVisualSignature(isHighlighted, zoomBucket)
            );
        }
    });

    kmlTransformerMarkers.forEach((marker) => {
        updateTransformerMarkerIcon(marker, zoomBucket);
    });
}

function updateTilePaneOpacity() {
    const zoom = map.getZoom();
    const tilePane = map.getPane("tilePane");
    if (!tilePane) {
        return;
    }
    tilePane.style.opacity = zoom > 19 ? "0.3" : "1";
}

function debounce(callback, delayMs = 120) {
    let timeoutId = null;
    return function (...args) {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => callback.apply(this, args), delayMs);
    };
}

function rebuildDataIndexes() {
    towerNameIndex = new Map();
    (networkData?.towers || []).forEach((tower, index) => {
        const normalized = normalizeId(tower?.name);
        if (normalized) {
            towerNameIndex.set(normalized, index);
        }
        if (tower && !Number.isInteger(tower.index)) {
            tower.index = index;
        }
    });

    kmlFeatureIndex = new Map();
    (kmlOverlayData?.features || []).forEach((feature) => {
        if (feature?.id) {
            kmlFeatureIndex.set(feature.id, feature);
        }
    });
}

function getKmlFeatureById(featureId) {
    if (!featureId) return null;
    return kmlFeatureIndex.get(featureId) || null;
}

function setPerformanceMode() {
    const totalLines = (networkData?.lines || []).length;
    const totalTowers = (networkData?.towers || []).length;
    const totalKml = (kmlOverlayData?.features || []).length;
    const totalAccounts = Number(
        accountData?.row_count
        || accountData?.rowCount
        || (accountData?.records || []).length
        || 0
    );
    const enabled = totalLines >= LARGE_DATASET_THRESHOLD.lines
        || totalTowers >= LARGE_DATASET_THRESHOLD.towers
        || totalKml >= LARGE_DATASET_THRESHOLD.kml
        || totalAccounts >= LARGE_DATASET_THRESHOLD.accounts;

    performanceMode.enabled = enabled;
    performanceMode.reason = enabled
        ? `Large dataset mode active: ${totalLines} lines, ${totalTowers} towers, ${totalKml} KML features, ${totalAccounts} account rows.`
        : "";
}

function getPerformanceModeHintHtml() {
    if (!performanceMode.enabled || !performanceMode.reason) {
        return "";
    }
    return `<div class="upload-warning"><strong>Performance mode:</strong> ${escapeHtml(performanceMode.reason)}</div>`;
}

async function rebuildInterruptionsForAccountData() {
    if (isServerBackedAccountData()) {
        return;
    }
    if (!interruptions.length) {
        return;
    }

    const rebuilt = [];
    const chunkSize = performanceMode.enabled ? 12 : 40;
    await processInChunks(interruptions, chunkSize, "Refreshing saved interruptions", (item) => {
        const nextContext = rebuildContextData({
            targetName: item.targetName,
            clickedTower: item.clickedTower ? cloneTower(item.clickedTower) : null,
            clickedLineIndex: Number.isInteger(item.clickedLineIndex) ? item.clickedLineIndex : null,
            affectedTowers: (item.affectedTowers || []).map(cloneTower),
            matchedRows: (item.matchedRows || []).map(cloneMatchedRow),
            lineIndexes: [...(item.lineIndexes || [])],
            towerIndexes: [...(item.towerIndexes || [])],
            kmlFeatureIds: [...(item.kmlFeatureIds || [])],
            feature: item.kmlFeature ? cloneKmlFeature(item.kmlFeature) : null,
        }, item.contextType || "tower");
        rebuilt.push({
            ...item,
            targetName: nextContext?.targetName || item.targetName,
            clickedTower: nextContext?.clickedTower || null,
            clickedLineIndex: Number.isInteger(nextContext?.clickedLineIndex) ? nextContext.clickedLineIndex : null,
            affectedTowers: nextContext?.affectedTowers || [],
            matchedRows: nextContext?.matchedRows || [],
            lineIndexes: nextContext?.lineIndexes || [],
            towerIndexes: nextContext?.towerIndexes || [],
            kmlFeatureIds: nextContext?.kmlFeatureIds || [...(item.kmlFeatureIds || [])],
            audit: nextContext ? buildTraceAudit(nextContext) : (item.audit || null),
        });
    });
    interruptions = rebuilt;
}

function updateMapLoadingProgress(message) {
    if (!message) {
        hideMapLoading();
        return;
    }
    showMapLoading(message);
}

function getVisualZoomBucket() {
    return Math.round(map.getZoom() * 2) / 2;
}

function extendBounds(bounds, lat, lng) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return bounds;
    }
    const point = L.latLng(Number(lat), Number(lng));
    if (!bounds) {
        return L.latLngBounds(point, point);
    }
    bounds.extend(point);
    return bounds;
}

function zoomToKnownDataBounds() {
    if (lastKnownDataBounds && typeof lastKnownDataBounds.isValid === "function" && lastKnownDataBounds.isValid()) {
        map.fitBounds(lastKnownDataBounds, { padding: [20, 20] });
    }
}

async function processInChunks(items, chunkSize, progressLabel, processor) {
    if (!Array.isArray(items) || !items.length) {
        return;
    }

    for (let index = 0; index < items.length; index += chunkSize) {
        const chunk = items.slice(index, index + chunkSize);
        chunk.forEach(processor);
        if (progressLabel) {
            updateMapLoadingProgress(`${progressLabel} ${Math.min(index + chunk.length, items.length)} / ${items.length}...`);
        }
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
}

const debouncedResizeInvalidate = debounce(function () {
    if (map) {
        map.invalidateSize();
    }
    if (viewerMap) {
        viewerMap.invalidateSize();
    }
}, 120);

const debouncedZoomVisualRefresh = debounce(function () {
    const nextBucket = getVisualZoomBucket();
    if (nextBucket === lastZoomVisualBucket) {
        updateTilePaneOpacity();
        return;
    }
    lastZoomVisualBucket = nextBucket;
    updateMapGeometryLineWeights();
    updateMapMarkerVisuals();
    updateTilePaneOpacity();
}, 50);

map.on("zoomend", debouncedZoomVisualRefresh);

function canPerform(permissionName) {
    return Boolean(currentPermissions?.[permissionName]);
}

function getCurrentUsername() {
    return String(currentUser?.username || "").trim() || "Unknown User";
}

function setControlsDisabled(elements, disabled, titleText = "") {
    elements.filter(Boolean).forEach((element) => {
        element.disabled = disabled;
        if (titleText) {
            element.title = titleText;
        }
    });
}

function applyRolePermissions() {
    const uploadRestricted = !canPerform("can_upload");
    const exportRestricted = !canPerform("can_export");
    const interruptionRestricted = !canPerform("can_edit_interruption");

    setControlsDisabled([fileInput, feederUploadButton, xlsxFileInput, xlsxUploadButton, kmlFileInput, kmlUploadButton], uploadRestricted, "Your role cannot upload files.");
    setControlsDisabled([generateExportBtn], exportRestricted, "Your role cannot export workbooks.");
    setControlsDisabled([addInterruptionBtn], interruptionRestricted, "Your role is read-only.");

    [uploadForm, xlsxUploadForm, kmlUploadForm].forEach((form) => {
        if (!form) return;
        form.classList.toggle("form-disabled", uploadRestricted);
    });
}

hideSidePanel();
setDefaultInterruptionDateTime();
syncLineVisibilityButtons();
renderInterruptionCollections();
updateOperationalCounters();
applyRolePermissions();
initializePageState();
lastZoomVisualBucket = getVisualZoomBucket();
window.addEventListener("resize", debouncedResizeInvalidate);

uploadForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!canPerform("can_upload")) {
        alert("Your role does not have permission to upload feeder files.");
        return;
    }

    const file = fileInput.files[0];
    if (!file) {
        alert("Please select a feeder file first.");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setUploadButtonState(feederUploadButton, "loading");
    showMapLoading("Uploading feeder data...");

    try {
        const response = await fetchWithTimeout("/upload", { method: "POST", body: formData });
        const data = await readApiJson(response, "Feeder parser failed.");

        if (!data.success) {
            statusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(data.message || "Feeder parser failed.")}`;
            validationReports.feeder = normalizeValidation(data.validation || {
                status: "error",
                errors: [data.message || "Feeder parser failed."],
            });
            setUploadButtonState(feederUploadButton, "error");
            hideSidePanel();
            return;
        }

        workspaceRestoreToken += 1;
        networkData = data.network;
        networkData.validation = data.validation || networkData.validation || {};
        networkData.is_inferred = Boolean(data.is_inferred ?? networkData.is_inferred);
        validationReports.feeder = normalizeValidation(data.validation);
        rebuildDataIndexes();
        setPerformanceMode();
        feederFileName = file.name || "";
        await drawNetwork(networkData);
        enrichKmlFeaturesWithNetwork();
        await loadInterruptionsFromServer({ preserveActive: true });
        const warnings = networkData.validation?.warnings || [];
        const warningHtml = warnings.length
            ? `<div class="upload-warning"><strong>Warning:</strong> ${escapeHtml(warnings.join(" | "))}</div>`
            : "";
        statusBox.innerHTML = `<strong>Success:</strong> ${escapeHtml(data.message)}${warningHtml}${getPerformanceModeHintHtml()}`;
        await loadUploadedFeeders({ selectFeederId: data.uploadedFeeder?.id });
        setUploadButtonState(feederUploadButton, "success");
        hideSidePanel();
    } catch (err) {
        statusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message || "Feeder parser failed.")}`;
        validationReports.feeder = normalizeValidation({
            status: "error",
            errors: [err.message || "Feeder parser failed."],
        });
        setUploadButtonState(feederUploadButton, "error");
        hideSidePanel();
    } finally {
        hideMapLoading();
    }
});

xlsxUploadForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!canPerform("can_upload")) {
        alert("Your role does not have permission to upload XLSX files.");
        return;
    }

    const file = xlsxFileInput.files[0];
    if (!file) {
        alert("Please select an XLSX file first.");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("tower_names", JSON.stringify((networkData?.towers || []).map((tower) => tower.name)));

    setUploadButtonState(xlsxUploadButton, "loading");
    showMapLoading("Uploading account mapping...");

    try {
        const response = await fetchWithTimeout("/upload_xlsx", { method: "POST", body: formData });
        const data = await readApiJson(response, "XLSX parser failed.");

        if (!data.success) {
            xlsxStatusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(data.message || "XLSX parser failed.")}`;
            validationReports.xlsx = normalizeValidation(data.validation || {
                status: "error",
                errors: [data.message || "XLSX parser failed."],
            });
            setUploadButtonState(xlsxUploadButton, "error");
            return;
        }

        workspaceRestoreToken += 1;
        accountData = rebuildRestoredAccountData(data.account_data);
        accountLookupIndex = (accountData && !accountData.serverBacked) ? buildAccountLookupIndex(accountData) : null;
        accountSearchRowsIndex = (accountData && !accountData.serverBacked) ? buildAccountSearchRowsIndex(accountData) : null;
        clearAccountRequestCaches();
        validationReports.xlsx = normalizeValidation(data.validation || accountData.validation);
        setPerformanceMode();
        clearMapHoverPreviewCache();
        setUploadButtonState(xlsxUploadButton, "success");
        xlsxStatusBox.innerHTML = `<strong>Success:</strong> ${escapeHtml(data.message)}${accountData?.serverBacked ? '<div class="upload-warning"><strong>Workspace mode:</strong> Account rows will load only when needed to keep the page stable.</div>' : ''}${getPerformanceModeHintHtml()}`;

        try {
            enrichKmlFeaturesWithNetwork();

            if (currentPanelData) {
                if (accountData?.serverBacked) {
                    currentPanelData = {
                        ...currentPanelData,
                        matchedRows: [],
                    };
                    renderCurrentContext();
                    void hydrateCurrentPanelMatches();
                } else {
                    currentPanelData = rebuildContextData(currentPanelData, currentContextType);
                    renderCurrentContext();
                }
            }

            await rebuildInterruptionsForAccountData();
            renderInterruptionCollections();
            refreshViewerIfOpen();
        } catch (postUploadError) {
            console.error("Post-upload XLSX refresh failed:", postUploadError);
            xlsxStatusBox.innerHTML += `<div class="upload-warning"><strong>Note:</strong> The XLSX upload succeeded, but some live refresh steps were skipped to keep the page responsive.</div>`;
        }
    } catch (err) {
        xlsxStatusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message || "XLSX parser failed.")}`;
        validationReports.xlsx = normalizeValidation({
            status: "error",
            errors: [err.message || "XLSX parser failed."],
        });
        setUploadButtonState(xlsxUploadButton, "error");
    } finally {
        hideMapLoading();
    }
});


kmlUploadForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!canPerform("can_upload")) {
        alert("Your role does not have permission to upload KML files.");
        return;
    }

    const file = kmlFileInput.files[0];
    if (!file) {
        alert("Please select a KML file first.");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("tower_names", JSON.stringify((networkData?.towers || []).map((tower) => tower.name)));

    setUploadButtonState(kmlUploadButton, "loading");
    showMapLoading("Uploading KML overlay...");

    try {
        const response = await fetchWithTimeout("/upload_kml", { method: "POST", body: formData });
        const data = await readApiJson(response, "KML parser failed.");

        if (!data.success) {
            kmlStatusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(data.message || "KML parser failed.")}`;
            validationReports.kml = normalizeValidation(data.validation || {
                status: "error",
                errors: [data.message || "KML parser failed."],
            });
            setUploadButtonState(kmlUploadButton, "error");
            return;
        }

        workspaceRestoreToken += 1;
        kmlOverlayData = data.overlay;
        validationReports.kml = normalizeValidation(data.validation || data.overlay.validation);
        rebuildDataIndexes();
        setPerformanceMode();
        enrichKmlFeaturesWithNetwork();
        await drawKmlOverlay(kmlOverlayData);
        kmlStatusBox.innerHTML = `<strong>Success:</strong> ${escapeHtml(data.message)}${getPerformanceModeHintHtml()}`;
        setUploadButtonState(kmlUploadButton, "success");
        refreshViewerIfOpen();
    } catch (err) {
        kmlStatusBox.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message || "KML parser failed.")}`;
        validationReports.kml = normalizeValidation({
            status: "error",
            errors: [err.message || "KML parser failed."],
        });
        setUploadButtonState(kmlUploadButton, "error");
    } finally {
        hideMapLoading();
    }
});

fileInput.addEventListener("change", function () {
    selectedFileName.textContent = fileInput.files[0] ? `Selected feeder file: ${fileInput.files[0].name}` : "No feeder file selected";
    setUploadButtonState(feederUploadButton, "idle");
});

xlsxFileInput.addEventListener("change", function () {
    selectedXlsxFileName.textContent = xlsxFileInput.files[0] ? `Selected XLSX file: ${xlsxFileInput.files[0].name}` : "No XLSX file selected";
    setUploadButtonState(xlsxUploadButton, "idle");
});

kmlFileInput.addEventListener("change", function () {
    selectedKmlFileName.textContent = kmlFileInput.files[0] ? `Selected KML file: ${kmlFileInput.files[0].name}` : "No KML file selected";
    setUploadButtonState(kmlUploadButton, "idle");
});

sidePanelSearchInput.addEventListener("input", function () {
    sidePanelSearchTerm = String(sidePanelSearchInput.value || "").trim().toLowerCase();
    if (currentPanelData) {
        renderCurrentContext();
    }
});

mapSearchBtn.addEventListener("click", async function () {
    await runMapSearch();
});

mapSearchInput.addEventListener("keydown", async function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        await runMapSearch();
    }
});

toggleGpxBtn.addEventListener("click", function () {
    showGpxLines = !showGpxLines;
    applyGpxLineVisibility();
    syncLineVisibilityButtons();
});

toggleKmlBtn.addEventListener("click", function () {
    showKmlLines = !showKmlLines;
    applyKmlLineVisibility();
    syncLineVisibilityButtons();
});

toggleInferredBtn.addEventListener("click", function () {
    showInferredConnections = !showInferredConnections;
    applyGpxLineVisibility();
    syncLineVisibilityButtons();
});

zoomFeederBtn.addEventListener("click", function () {
    zoomToFeeder();
});

zoomSelectedBtn.addEventListener("click", function () {
    zoomToSelectedTower();
});

clearAllBtn.addEventListener("click", async function () {
    await handleWorkspaceClearRequest();
});

clearWorkspaceBtn.addEventListener("click", async function () {
    await handleWorkspaceClearRequest();
});

restoreUploadedFeederBtn?.addEventListener("click", async function () {
    await restoreSelectedUploadedFeeder();
});

deleteUploadedFeederBtn?.addEventListener("click", async function () {
    openModal(deleteUploadedFeederModal);
    await loadAdminUploadedFeedersForDelete();
});

deleteUploadedFeederList?.addEventListener("click", async function (event) {
    const button = event.target.closest("[data-delete-uploaded-feeder]");
    if (!button) return;
    await deleteUploadedFeederById(button.getAttribute("data-delete-uploaded-feeder"));
});

async function handleWorkspaceClearRequest() {
    const confirmed = confirm("This will clear the current map view only. Uploaded GPX, XLSX, KML files and saved interruptions will remain available.");
    if (!confirmed) return;

    clearWorkspaceBtn.disabled = true;
    clearAllBtn.disabled = true;
    try {
        clearAllData();
    } catch (err) {
        alert(err.message || "Could not clear the current map view. Your uploaded files and saved interruptions remain unchanged.");
    } finally {
        clearWorkspaceBtn.disabled = false;
        clearAllBtn.disabled = false;
    }
}

validationReportBtn.addEventListener("click", function () {
    renderValidationReport();
    openModal(validationModal);
});

viewerValidationBtn.addEventListener("click", function () {
    renderValidationReport();
    openModal(validationModal);
});

refreshViewBtn.addEventListener("click", function () {
    clearActiveSelectionState();
});

function updateInterruptionStatusFields() {
    const isRestored = interruptionStatusInput?.value === "restored";
    document.querySelectorAll(".restored-only-field").forEach((field) => {
        field.classList.toggle("hidden-msg", !isRestored);
    });
    if (interruptionEndDateInput) {
        interruptionEndDateInput.required = isRestored;
    }
    if (interruptionEndTimeInput) {
        interruptionEndTimeInput.required = isRestored;
    }
    if (interruptionActionTakenInput) {
        interruptionActionTakenInput.required = isRestored;
    }
    if (isRestored && (!interruptionEndDateInput.value || !interruptionEndTimeInput.value)) {
        const now = new Date();
        interruptionEndDateInput.value = interruptionEndDateInput.value || [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
        ].join("-");
        interruptionEndTimeInput.value = interruptionEndTimeInput.value || [
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
        ].join(":");
    }
}

interruptionStatusInput?.addEventListener("change", updateInterruptionStatusFields);

addInterruptionBtn.addEventListener("click", function () {
    if (!canPerform("can_edit_interruption")) {
        alert("Your role is read-only and cannot save interruptions.");
        return;
    }

    interruptionNameInput.value = `Interruption ${interruptionCounter}`;
    setDefaultInterruptionDateTime();
    updateInterruptionStatusFields();
    interruptionFormInfo.textContent = currentPanelData
        ? `Saving current selection for ${currentPanelData.targetName}.`
        : "Click a tower first so we know which interruption to save.";
    openModal(interruptionModal);
});

interruptionForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    if (!canPerform("can_edit_interruption")) {
        interruptionFormInfo.textContent = "Your role is read-only and cannot save interruptions.";
        return;
    }

    if (!currentPanelData) {
        interruptionFormInfo.textContent = "Click a tower first so we know which interruption to save.";
        return;
    }

    if (interruptionStatusInput.value === "restored" && (!interruptionEndDateInput.value || !interruptionEndTimeInput.value || !interruptionActionTakenInput.value.trim())) {
        interruptionFormInfo.textContent = "Restored interruptions need restored date, restored time, and action taken.";
        return;
    }

    interruptionFormInfo.textContent = "Saving interruption...";

    try {
        const interruption = await saveInterruptionToServer();
        interruptionCounter += 1;
        upsertInterruption(interruption);
        activeInterruptionId = interruption.id;
        renderInterruptionCollections();
        await applyInterruption(interruption.id, { skipFetch: true });
        closeModal(interruptionModal);
        interruptionFormInfo.textContent = "Interruption saved successfully.";
    } catch (err) {
        interruptionFormInfo.textContent = err.message || "Interruption save failed.";
    }
});

openViewerBtn.addEventListener("click", function () {
    openModal(viewerModal);
    renderViewer();
});

generateExportBtn.addEventListener("click", async function () {
    if (!canPerform("can_export")) {
        alert("Your role does not have permission to export interruption workbooks.");
        return;
    }

    const interruption = getActiveInterruption();
    if (!interruption) {
        alert("Save an interruption first.");
        return;
    }

    const exportValidation = getCurrentCombinedValidation();
    if (exportValidation.status === "error") {
        renderValidationReport();
        openModal(validationModal);
        alert("Export blocked because the validation report contains errors.");
        return;
    }
    if (exportValidation.status === "warning") {
        const proceed = confirm("Validation warnings were found. Export may still be usable, but please review the validation report. Do you want to continue?");
        if (!proceed) {
            renderValidationReport();
            openModal(validationModal);
            return;
        }
    }

    generateExportBtn.disabled = true;
    generateExportBtn.textContent = "Generating...";

    try {
        const response = await fetchWithTimeout("/export_interruption", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: interruption.name,
                start_date: interruption.startDate,
                start_time: interruption.startTime,
                end_date: interruption.endDate,
                end_time: interruption.endTime,
                target_name: interruption.targetName,
                context_type: interruption.contextType || "tower",
                affected_towers: getCanonicalAffectedPolIdEntries(interruption.affectedTowers || []),
                matched_rows: interruption.matchedRows,
                line_indexes: interruption.lineIndexes,
                kml_feature: interruption.kmlFeature,
                source_tower_clicked: getInterruptionSourceName(interruption),
                total_affected_towers: getCanonicalAffectedPolIdEntries(interruption.affectedTowers || []).length,
                total_affected_accounts: getUniqueAffectedAccountCount(interruption.matchedRows || []),
                user: getCurrentUsername(),
                feeder_name: interruption.feederName || feederFileName || "Unknown Feeder",
                trace_confidence: interruption.audit?.trace_confidence || currentPanelData?.audit?.trace_confidence || "confirmed",
                inferred_nodes_count: interruption.audit?.inferred_nodes_count || 0,
                inferred_accounts_count: interruption.audit?.inferred_accounts_count || 0,
                validation_warnings: getCurrentCombinedValidation().warnings || [],
                disconnected_fragments: networkData?.disconnected_fragments || [],
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({ message: "Export failed." }));
            throw new Error(data.message || "Export failed.");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${interruption.name.replace(/\s+/g, "_")}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert(err.message);
    } finally {
        generateExportBtn.disabled = false;
        generateExportBtn.textContent = "Generate XLSX";
    }
});

document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", function () {
        const target = document.getElementById(button.getAttribute("data-close"));
        closeModal(target);
    });
});

function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    const normalizedOptions = { ...(options || {}) };
    const method = String(normalizedOptions.method || "GET").toUpperCase();
    const headers = new Headers(normalizedOptions.headers || {});
    if (csrfToken && method !== "GET" && !headers.has("X-CSRF-Token")) {
        headers.set("X-CSRF-Token", csrfToken);
    }
    normalizedOptions.headers = headers;

    return fetch(url, { ...normalizedOptions, signal: controller.signal })
        .then(async (response) => {
            if (response.status === 401) {
                window.location.href = "/login";
                throw new Error("Your session expired. Please log in again.");
            }
            if (response.status === 403) {
                const errorData = await response.clone().json().catch(() => ({ message: "You do not have permission to perform this action." }));
                throw new Error(errorData.message || "You do not have permission to perform this action.");
            }
            return response;
        })
        .finally(() => clearTimeout(timeoutId));
}

async function readApiJson(response, fallbackMessage) {
    const responseText = await response.text();
    if (!responseText) {
        return { success: response.ok, message: fallbackMessage };
    }
    try {
        return JSON.parse(responseText);
    } catch (_error) {
        return {
            success: response.ok,
            message: responseText.trim() || fallbackMessage,
        };
    }
}

function normalizeInterruptionRecord(interruption) {
    if (!interruption) return null;
    return {
        id: String(interruption.id || ""),
        name: String(interruption.name || "").trim() || `Interruption ${interruptionCounter}`,
        startDate: String(interruption.startDate || interruption.start_date || "").trim(),
        startTime: String(interruption.startTime || interruption.start_time || "").trim(),
        endDate: String(interruption.endDate || interruption.end_date || "").trim(),
        endTime: String(interruption.endTime || interruption.end_time || "").trim(),
        contextType: String(interruption.contextType || interruption.context_type || "tower").trim() || "tower",
        targetName: String(interruption.targetName || interruption.target_name || "").trim(),
        sourceTowerClicked: String(interruption.sourceTowerClicked || interruption.source_tower_clicked || "").trim(),
        clickedTower: interruption.clickedTower ? cloneTower(interruption.clickedTower) : null,
        clickedLineIndex: Number.isInteger(interruption.clickedLineIndex)
            ? interruption.clickedLineIndex
            : (Number.isInteger(interruption.clicked_line_index) ? interruption.clicked_line_index : null),
        affectedTowers: (interruption.affectedTowers || interruption.affected_towers || []).map(cloneTower),
        matchedRows: (interruption.matchedRows || interruption.matched_rows || []).map(cloneMatchedRow),
        lineIndexes: [...(interruption.lineIndexes || interruption.line_indexes || [])],
        towerIndexes: [...(interruption.towerIndexes || interruption.tower_indexes || [])],
        kmlFeatureIds: [...(interruption.kmlFeatureIds || interruption.kml_feature_ids || [])],
        kmlFeature: interruption.kmlFeature
            ? cloneKmlFeature(interruption.kmlFeature)
            : (interruption.kml_feature ? cloneKmlFeature(interruption.kml_feature) : null),
        audit: interruption.audit ? { ...interruption.audit } : null,
        totalPolId: Number(interruption.totalPolId ?? interruption.total_pol_id ?? 0) || 0,
        totalAffectedAccounts: Number(interruption.totalAffectedAccounts ?? interruption.total_affected_accounts ?? 0) || 0,
        matchedRowsCount: Number(interruption.matchedRowsCount ?? interruption.matched_rows_count ?? 0) || 0,
        status: String(interruption.status || interruption.monitoring_status || "active").trim() || "active",
        actionTaken: String(interruption.actionTaken || interruption.action_taken || "").trim(),
        restoredDate: String(interruption.restoredDate || interruption.restored_date || "").trim(),
        restoredTime: String(interruption.restoredTime || interruption.restored_time || "").trim(),
        remarks: String(interruption.remarks || "").trim(),
        feederName: String(interruption.feederName || interruption.feeder_name || "").trim(),
        createdBy: String(interruption.createdBy || interruption.created_by || "").trim(),
        createdAt: String(interruption.createdAt || interruption.created_at || "").trim(),
    };
}

function syncInterruptionCounter() {
    interruptionCounter = Math.max(1, interruptions.length + 1);
}

function upsertInterruption(interruption) {
    const normalized = normalizeInterruptionRecord(interruption);
    if (!normalized) return null;

    const existingIndex = interruptions.findIndex((item) => String(item.id) === String(normalized.id));
    if (existingIndex >= 0) {
        interruptions.splice(existingIndex, 1, normalized);
    } else {
        interruptions.unshift(normalized);
    }
    syncInterruptionCounter();
    return normalized;
}

function renderUploadedFeeders() {
    if (!uploadedFeederSelect) return;
    if (!uploadedFeeders.length) {
        uploadedFeederSelect.innerHTML = `<option value="">No feeder mappings</option>`;
        if (restoreUploadedFeederBtn) restoreUploadedFeederBtn.disabled = true;
        return;
    }
    uploadedFeederSelect.innerHTML = `
        <option value="">Choose feeder mapping</option>
        ${uploadedFeeders.map((feeder) => `
            <option value="${escapeHtml(feeder.id)}">${escapeHtml(feeder.displayName || feeder.feederCode)} - ${escapeHtml(feeder.filename || "")}</option>
        `).join("")}
    `;
    if (restoreUploadedFeederBtn) restoreUploadedFeederBtn.disabled = false;
}

function renderDeleteUploadedFeederList(feeders = uploadedFeeders) {
    if (!deleteUploadedFeederList) return;
    if (!feeders.length) {
        deleteUploadedFeederList.className = "uploaded-feeder-delete-list empty-state";
        deleteUploadedFeederList.textContent = "No uploaded feeders to delete.";
        return;
    }
    deleteUploadedFeederList.className = "uploaded-feeder-delete-list";
    deleteUploadedFeederList.innerHTML = feeders.map((feeder) => `
        <article class="uploaded-feeder-delete-item">
            <div>
                <strong>${escapeHtml(feeder.displayName || feeder.feederCode || "Uploaded feeder")}</strong>
                <span>${escapeHtml(feeder.filename || "")} / ${escapeHtml(feeder.username || getCurrentUsername())}</span>
                <small>${escapeHtml(feeder.towerCount || 0)} Pol IDs / ${escapeHtml(feeder.lineCount || 0)} lines</small>
            </div>
            <button type="button" class="danger-btn" data-delete-uploaded-feeder="${escapeHtml(feeder.id)}">Delete</button>
        </article>
    `).join("");
}

async function loadUploadedFeeders(options = {}) {
    try {
        const response = await fetchWithTimeout("/uploaded-feeders", { method: "GET" });
        const data = await readApiJson(response, "Failed to load uploaded feeders.");
        if (!data.success) {
            throw new Error(data.message || "Failed to load uploaded feeders.");
        }
        uploadedFeeders = data.feeders || [];
        renderUploadedFeeders();
        if (options.selectFeederId && uploadedFeederSelect) {
            uploadedFeederSelect.value = String(options.selectFeederId);
        }
    } catch (error) {
        uploadedFeeders = [];
        if (uploadedFeederSelect) {
            uploadedFeederSelect.innerHTML = `<option value="">Feeders unavailable</option>`;
        }
        if (restoreUploadedFeederBtn) restoreUploadedFeederBtn.disabled = true;
    }
}

async function restoreSelectedUploadedFeeder(feederIdValue = "", options = {}) {
    const feederId = String(feederIdValue || uploadedFeederSelect?.value || "").trim();
    if (!feederId) {
        alert("Choose a feeder mapping first.");
        return;
    }
    if (restoreUploadedFeederBtn) {
        restoreUploadedFeederBtn.disabled = true;
        restoreUploadedFeederBtn.textContent = "Restoring...";
    }
    const restoreToken = ++workspaceRestoreToken;
    showMapLoading("Restoring feeder mapping...");
    try {
        const response = await fetchWithTimeout(`/uploaded-feeders/${encodeURIComponent(feederId)}/restore`, {
            method: "POST",
            headers: { "X-CSRF-Token": csrfToken },
        });
        const data = await readApiJson(response, "Failed to restore feeder mapping.");
        if (!data.success || !data.workspace) {
            throw new Error(data.message || "Failed to restore feeder mapping.");
        }
        await applyWorkspacePayload(data.workspace, { restoreToken, keepRecoveryNotice: Boolean(options.keepRecoveryNotice) });
        statusBox.innerHTML = `<strong>Workspace:</strong> Restored feeder mapping.${getPerformanceModeHintHtml()}`;
    } catch (error) {
        alert(error.message || "Could not restore feeder mapping.");
    } finally {
        hideMapLoading();
        if (restoreUploadedFeederBtn) {
            restoreUploadedFeederBtn.disabled = false;
            restoreUploadedFeederBtn.textContent = "Restore Feeder Mapping";
        }
    }
}

async function showRecoveryFeederPicker() {
    const existingPicker = workspaceRecoveryNotice?.querySelector("[data-recovery-feeder-picker]");
    if (existingPicker) {
        existingPicker.remove();
        return;
    }
    await loadUploadedFeeders();
    const picker = document.createElement("div");
    picker.className = "workspace-recovery-picker";
    picker.setAttribute("data-recovery-feeder-picker", "1");
    if (!uploadedFeeders.length) {
        picker.innerHTML = `<span>No uploaded feeder mappings found.</span>`;
        workspaceRecoveryNotice?.appendChild(picker);
        return;
    }
    picker.innerHTML = `
        <select aria-label="Choose feeder mapping">
            <option value="">Choose feeder mapping</option>
            ${uploadedFeeders.map((feeder) => `
                <option value="${escapeHtml(feeder.id)}">${escapeHtml(feeder.displayName || feeder.feederCode)} - ${escapeHtml(feeder.filename || "")}</option>
            `).join("")}
        </select>
        <button type="button" class="secondary-action compact-btn">Restore Selected</button>
    `;
    const select = picker.querySelector("select");
    const button = picker.querySelector("button");
    button?.addEventListener("click", async () => {
        const feederId = String(select?.value || "").trim();
        if (!feederId) {
            alert("Choose a feeder mapping first.");
            return;
        }
        await restoreSelectedUploadedFeeder(feederId, { keepRecoveryNotice: true });
    });
    workspaceRecoveryNotice?.appendChild(picker);
}

async function restoreWorkspaceComponent(component, label) {
    const restoreToken = ++workspaceRestoreToken;
    showMapLoading(`Restoring ${label}...`);
    try {
        const response = await fetchWithTimeout(`/workspace/current?component=${encodeURIComponent(component)}`, { method: "GET" });
        const data = await readApiJson(response, `Failed to restore ${label}.`);
        if (restoreToken !== workspaceRestoreToken) {
            return;
        }
        if (!data.success || !data.workspace) {
            throw new Error(data.message || `Failed to restore ${label}.`);
        }
        await applyWorkspacePayload(data.workspace, { restoreToken, merge: true, keepRecoveryNotice: true });
        if (component === "network") {
            statusBox.innerHTML = `<strong>Workspace:</strong> Restored feeder mapping.${getPerformanceModeHintHtml()}`;
        } else if (component === "account") {
            xlsxStatusBox.innerHTML = `<strong>Workspace:</strong> Restored XLSX account mapping.${getPerformanceModeHintHtml()}`;
        }
    } catch (error) {
        if (restoreToken === workspaceRestoreToken) {
            alert(error.message || `Could not restore ${label}.`);
        }
    } finally {
        hideMapLoading();
    }
}

async function loadAdminUploadedFeedersForDelete() {
    if (!deleteUploadedFeederList) return;
    deleteUploadedFeederList.className = "uploaded-feeder-delete-list empty-state";
    deleteUploadedFeederList.textContent = "Loading uploaded feeders...";
    try {
        const response = await fetchWithTimeout("/uploaded-feeders?all=1", { method: "GET" });
        const data = await readApiJson(response, "Failed to load uploaded feeders.");
        if (!data.success) {
            throw new Error(data.message || "Failed to load uploaded feeders.");
        }
        renderDeleteUploadedFeederList(data.feeders || []);
    } catch (error) {
        deleteUploadedFeederList.textContent = error.message || "Failed to load uploaded feeders.";
    }
}

async function deleteUploadedFeederById(feederId) {
    if (!feederId) return;
    const confirmed = confirm("Delete this uploaded feeder mapping? This will not delete saved interruption records.");
    if (!confirmed) return;
    try {
        const response = await fetchWithTimeout(`/uploaded-feeders/${encodeURIComponent(feederId)}`, {
            method: "DELETE",
            headers: { "X-CSRF-Token": csrfToken },
        });
        const data = await readApiJson(response, "Failed to delete uploaded feeder.");
        if (!data.success) {
            throw new Error(data.message || "Failed to delete uploaded feeder.");
        }
        await loadUploadedFeeders();
        renderDeleteUploadedFeederList(data.feeders || []);
    } catch (error) {
        alert(error.message || "Could not delete uploaded feeder.");
    }
}

async function loadInterruptionsFromServer(options = {}) {
    const preserveActive = options.preserveActive !== false;
    const previousActiveId = preserveActive ? activeInterruptionId : null;

    try {
        const response = await fetchWithTimeout("/interruptions", { method: "GET" });
        const data = await response.json();
        interruptions = (data.interruptions || []).map(normalizeInterruptionRecord).filter(Boolean);
        interruptionsLoaded = true;
        syncInterruptionCounter();

        if (previousActiveId && interruptions.some((item) => item.id === previousActiveId)) {
            activeInterruptionId = previousActiveId;
        } else if (!interruptions.some((item) => item.id === activeInterruptionId)) {
            activeInterruptionId = null;
        }

        renderInterruptionCollections();
        if (activeInterruptionId && currentPanelData) {
            refreshViewerIfOpen();
        }
        await handleInitialInterruptionRequest();
    } catch (err) {
        interruptionsLoaded = false;
        interruptionCount.textContent = "Load failed";
        interruptionList.className = "interruption-list empty-state";
        interruptionList.textContent = err.message || "Failed to load saved interruptions.";
        interruptionTabs.className = "interruption-tabs empty-state";
        interruptionTabs.textContent = "Saved interruptions could not be loaded.";
        viewerInterruptionTabs.className = "interruption-tabs empty-state";
        viewerInterruptionTabs.textContent = "Saved interruptions could not be loaded.";
    }
}

async function initializePageState() {
    await loadUploadedFeeders();
    await restoreWorkspaceFromServer();
    await loadInterruptionsFromServer();
}

function applyDefaultWorkspaceLabels(options = {}) {
    selectedFileName.textContent = "No feeder file selected";
    selectedXlsxFileName.textContent = "No XLSX file selected";
    selectedKmlFileName.textContent = "No KML file selected";
    statusBox.innerHTML = "Waiting for feeder file upload...";
    xlsxStatusBox.innerHTML = "Waiting for XLSX upload...";
    kmlStatusBox.innerHTML = "Waiting for KML upload...";
    if (!options.preserveRecoveryNotice) {
        hideWorkspaceRecoveryNotice();
    }
}

function applyWorkspaceStatusBoxes() {
    if (feederFileName) {
        selectedFileName.textContent = `Current feeder workspace: ${feederFileName}`;
        statusBox.innerHTML = `<strong>Workspace:</strong> Restored feeder data from your saved session.${getPerformanceModeHintHtml()}`;
        setUploadButtonState(feederUploadButton, "success");
    } else {
        selectedFileName.textContent = "No feeder file selected";
        statusBox.innerHTML = "Waiting for feeder file upload...";
        setUploadButtonState(feederUploadButton, "idle");
    }

    if (accountData) {
        selectedXlsxFileName.textContent = "Current XLSX workspace restored";
        xlsxStatusBox.innerHTML = `<strong>Workspace:</strong> Restored XLSX account mapping from your saved session.${getPerformanceModeHintHtml()}`;
        setUploadButtonState(xlsxUploadButton, "success");
    } else {
        selectedXlsxFileName.textContent = "No XLSX file selected";
        xlsxStatusBox.innerHTML = "Waiting for XLSX upload...";
        setUploadButtonState(xlsxUploadButton, "idle");
    }

    if (kmlOverlayData) {
        selectedKmlFileName.textContent = "Current KML workspace restored";
        kmlStatusBox.innerHTML = `<strong>Workspace:</strong> Restored KML overlay from your saved session.${getPerformanceModeHintHtml()}`;
        setUploadButtonState(kmlUploadButton, "success");
    } else {
        selectedKmlFileName.textContent = "No KML file selected";
        kmlStatusBox.innerHTML = "Waiting for KML upload...";
        setUploadButtonState(kmlUploadButton, "idle");
    }
}

function showWorkspaceRecoveryNotice(message, options = {}) {
    if (!workspaceRecoveryNotice) return;
    const actions = Array.isArray(options.actions)
        ? options.actions
        : (options.buttonLabel ? [{ label: options.buttonLabel, onClick: options.onClick }] : []);
    const actionHtml = actions.length
        ? `<div class="workspace-recovery-actions">${actions.map((action, index) => `
            <button type="button" class="secondary-action compact-btn ${action.danger ? "danger-btn" : ""}" data-workspace-recovery-action="${index}">${escapeHtml(action.label)}</button>
        `).join("")}</div>`
        : "";
    workspaceRecoveryNotice.innerHTML = `
        <span>${escapeHtml(message)}</span>
        ${actionHtml}
    `;
    workspaceRecoveryNotice.classList.remove("hidden-msg");
    actions.forEach((action, index) => {
        const button = workspaceRecoveryNotice.querySelector(`[data-workspace-recovery-action="${index}"]`);
        if (button && typeof action.onClick === "function") {
            button.addEventListener("click", action.onClick);
        }
    });
}

function hideWorkspaceRecoveryNotice() {
    if (!workspaceRecoveryNotice) return;
    workspaceRecoveryNotice.innerHTML = "";
    workspaceRecoveryNotice.classList.add("hidden-msg");
}

function resetWorkspaceClientState(options = {}) {
    const {
        resetMapView = false,
        resetLabels = false,
        preserveRecoveryNotice = false,
        bumpRestoreToken = true,
    } = options;

    if (bumpRestoreToken) {
        workspaceRestoreToken += 1;
    }

    resetLineColors();
    clearMapObjects();
    clearKmlOverlay();
    networkData = null;
    accountData = null;
    accountLookupIndex = null;
    accountSearchRowsIndex = null;
    clearAccountRequestCaches();
    kmlOverlayData = null;
    feederFileName = "";
    currentPanelData = null;
    currentContextType = "tower";
    activeInterruptionId = null;
    activeKmlFeatureId = null;
    validationReports.feeder = null;
    validationReports.xlsx = null;
    validationReports.kml = null;
    validationReports.audit = null;
    sidePanelSearchTerm = "";
    if (sidePanelSearchInput) {
        sidePanelSearchInput.value = "";
    }
    if (mapSearchInput) {
        mapSearchInput.value = "";
    }
    lastKnownDataBounds = null;
    rebuildDataIndexes();
    setPerformanceMode();
    clearMapHoverPreviewCache();
    hideSidePanel();
    updateOperationalCounters();

    if (resetLabels) {
        applyDefaultWorkspaceLabels({ preserveRecoveryNotice });
        setUploadButtonState(feederUploadButton, "idle");
        setUploadButtonState(xlsxUploadButton, "idle");
        setUploadButtonState(kmlUploadButton, "idle");
    }
    if (!preserveRecoveryNotice) {
        hideWorkspaceRecoveryNotice();
    }
    if (resetMapView) {
        map.setView([15.598, 120.922], 13);
    }
}

async function applyWorkspacePayload(workspace, options = {}) {
    const restoreToken = options.restoreToken ?? workspaceRestoreToken;
    const mergeWorkspace = Boolean(options.merge);
    if (!mergeWorkspace) {
        resetWorkspaceClientState({ preserveRecoveryNotice: true, bumpRestoreToken: false });
    }
    if (restoreToken !== workspaceRestoreToken) {
        return false;
    }
    if (!mergeWorkspace || workspace?.feederFileName) {
        feederFileName = String(workspace?.feederFileName || feederFileName || "").trim();
    }
    if (!mergeWorkspace || workspace?.network) {
        networkData = workspace?.network || null;
    }
    if (!mergeWorkspace || workspace?.accountData) {
        accountData = rebuildRestoredAccountData(workspace?.accountData || null);
    }
    if (!mergeWorkspace || workspace?.kmlOverlay) {
        kmlOverlayData = workspace?.kmlOverlay || null;
    }
    accountLookupIndex = (accountData && !accountData.serverBacked) ? buildAccountLookupIndex(accountData) : null;
    accountSearchRowsIndex = (accountData && !accountData.serverBacked) ? buildAccountSearchRowsIndex(accountData) : null;
    clearAccountRequestCaches();
    if (!mergeWorkspace || workspace?.validationReports?.feeder) {
        validationReports.feeder = workspace?.validationReports?.feeder ? normalizeValidation(workspace.validationReports.feeder) : null;
    }
    if (!mergeWorkspace || workspace?.validationReports?.xlsx) {
        validationReports.xlsx = workspace?.validationReports?.xlsx ? normalizeValidation(workspace.validationReports.xlsx) : null;
    }
    if (!mergeWorkspace || workspace?.validationReports?.kml) {
        validationReports.kml = workspace?.validationReports?.kml ? normalizeValidation(workspace.validationReports.kml) : null;
    }
    validationReports.audit = null;
    rebuildDataIndexes();
    setPerformanceMode();

    if (networkData) {
        networkData.validation = workspace?.validationReports?.feeder || networkData.validation || {};
        networkData.is_inferred = Boolean(networkData?.is_inferred ?? networkData?.validation?.summary?.inferred_edges);
        await drawNetwork(networkData);
        if (restoreToken !== workspaceRestoreToken) {
            return false;
        }
    }

    if (networkData || accountData) {
        enrichKmlFeaturesWithNetwork();
    }

    if (kmlOverlayData) {
        await drawKmlOverlay(kmlOverlayData);
        if (restoreToken !== workspaceRestoreToken) {
            return false;
        }
    }

    if (options.keepRecoveryNotice) {
        // Keep the large-workspace action strip visible after partial restores.
    } else if (Array.isArray(workspace?.recoveryWarnings) && workspace.recoveryWarnings.length) {
        showWorkspaceRecoveryNotice(workspace.recoveryWarnings.join(" "));
    } else {
        hideWorkspaceRecoveryNotice();
    }

    hideSidePanel();
    updateOperationalCounters();
    applyWorkspaceStatusBoxes();
    return true;
}

async function restoreWorkspaceFromServer() {
    const restoreToken = ++workspaceRestoreToken;
    try {
        const response = await fetchWithTimeout("/workspace/current", { method: "GET" });
        const data = await readApiJson(response, "Failed to load workspace.");
        if (restoreToken !== workspaceRestoreToken) {
            return;
        }
        if (!data.success || !data.workspace) {
            resetWorkspaceClientState({ resetMapView: true, resetLabels: true });
            showWorkspaceRecoveryNotice("Saved workspace could not be restored. You can continue working and upload files again if needed.");
            return;
        }

        const metadata = data.metadata || {};
        if (Array.isArray(metadata.recoveryWarnings) && metadata.recoveryWarnings.length && !metadata.requiresManualRestore) {
            resetWorkspaceClientState({ resetMapView: true, resetLabels: true, preserveRecoveryNotice: true });
            showWorkspaceRecoveryNotice(`Saved workspace needs attention: ${metadata.recoveryWarnings.join(" ")}`);
        }
        if (metadata.requiresManualRestore) {
            resetWorkspaceClientState({ resetMapView: true, resetLabels: true, preserveRecoveryNotice: true });
            const prefix = Array.isArray(metadata.recoveryWarnings) && metadata.recoveryWarnings.length
                ? `${metadata.recoveryWarnings.join(" ")} `
                : "";
            showWorkspaceRecoveryNotice(
                `${prefix}Saved workspace is large (${formatSummaryNumber((metadata.totalBytes || 0) / (1024 * 1024), 2)} MB). Load it only when needed to avoid browser lag.`,
                {
                    actions: [
                        {
                            label: "Restore Mapping",
                            onClick: async function () {
                                await showRecoveryFeederPicker();
                            },
                        },
                        {
                            label: "Restore XLSX",
                            onClick: async function () {
                                await restoreWorkspaceComponent("account", "XLSX account mapping");
                            },
                        },
                        {
                            label: "Delete Uploaded Feeder",
                            danger: true,
                            onClick: async function () {
                                if (deleteUploadedFeederModal) {
                                    openModal(deleteUploadedFeederModal);
                                    await loadAdminUploadedFeedersForDelete();
                                } else {
                                    alert("Only administrators can delete uploaded feeders.");
                                }
                            },
                        },
                    ],
                }
            );
            return;
        }

        const workspace = data.workspace;
        const hasWorkspace = Boolean(
            workspace.feederFileName
            || workspace.network
            || workspace.accountData
            || workspace.kmlOverlay
        );

        if (!hasWorkspace) {
            resetWorkspaceClientState({ resetMapView: true, resetLabels: true, preserveRecoveryNotice: true });
            if (Array.isArray(workspace?.recoveryWarnings) && workspace.recoveryWarnings.length) {
                showWorkspaceRecoveryNotice(`No restorable workspace data was loaded. ${workspace.recoveryWarnings.join(" ")}`);
            }
            return;
        }

        hideWorkspaceRecoveryNotice();
        await applyWorkspacePayload(workspace, { restoreToken });
    } catch (error) {
        console.error("Failed to restore workspace:", error);
        if (restoreToken !== workspaceRestoreToken) {
            return;
        }
        resetWorkspaceClientState({ resetMapView: true, resetLabels: true });
        showWorkspaceRecoveryNotice("Saved workspace could not be restored automatically. You can continue and rebuild from uploads or from a saved interruption.");
    }
}

function getInitialInterruptionRequest() {
    const params = new URLSearchParams(window.location.search || "");
    const interruptionId = String(params.get("interruption_id") || "").trim();
    return {
        interruptionId,
        openViewer: params.get("open_viewer") === "1",
        focusPolId: String(params.get("focus_pol_id") || "").trim(),
    };
}

async function handleInitialInterruptionRequest() {
    if (initialInterruptionRequestHandled) return;
    const requestState = getInitialInterruptionRequest();
    if (!requestState.interruptionId) {
        initialInterruptionRequestHandled = true;
        return;
    }

    initialInterruptionRequestHandled = true;
    try {
        await applyInterruption(requestState.interruptionId);
        if (requestState.focusPolId) {
            focusSelectedPolIdOnMap(requestState.focusPolId);
        }
        if (requestState.openViewer) {
            openModal(viewerModal);
            renderViewer();
        }
    } catch (error) {
        console.error("Failed to open interruption from query string:", error);
    } finally {
        const cleanUrl = `${window.location.pathname}${window.location.hash || ""}`;
        window.history.replaceState({}, document.title, cleanUrl);
    }
}

async function fetchInterruptionFromServer(interruptionId) {
    const response = await fetchWithTimeout(`/interruptions/${encodeURIComponent(interruptionId)}`, { method: "GET" });
    const data = await response.json();
    if (!data.success || !data.interruption) {
        throw new Error(data.message || "Failed to load interruption.");
    }
    return normalizeInterruptionRecord(data.interruption);
}

function buildInterruptionRequestPayload() {
    const audit = buildTraceAudit(currentPanelData);
    const status = interruptionStatusInput.value || "active";
    const restoredDate = status === "restored" ? interruptionEndDateInput.value : "";
    const restoredTime = status === "restored" ? interruptionEndTimeInput.value : "";
    return {
        name: interruptionNameInput.value.trim() || `Interruption ${interruptionCounter}`,
        start_date: interruptionStartDateInput.value,
        start_time: interruptionStartTimeInput.value,
        end_date: restoredDate,
        end_time: restoredTime,
        status,
        action_taken: status === "restored" ? interruptionActionTakenInput.value.trim() : "",
        restored_date: restoredDate,
        restored_time: restoredTime,
        remarks: interruptionRemarksInput.value.trim(),
        context_type: currentContextType,
        target_name: currentPanelData?.targetName || "",
        source_tower_clicked: currentPanelData?.clickedTower?.name || currentPanelData?.feature?.name || currentPanelData?.targetName || "",
        clicked_tower: currentPanelData?.clickedTower ? cloneTower(currentPanelData.clickedTower) : null,
        clicked_line_index: Number.isInteger(currentPanelData?.clickedLineIndex) ? currentPanelData.clickedLineIndex : null,
        affected_towers: (currentPanelData?.affectedTowers || []).map(cloneTower),
        matched_rows: (currentPanelData?.matchedRows || []).map(cloneMatchedRow),
        line_indexes: [...(currentPanelData?.lineIndexes || [])],
        tower_indexes: [...(currentPanelData?.towerIndexes || [])],
        kml_feature_ids: [...(currentPanelData?.kmlFeatureIds || [])],
        kml_feature: currentPanelData?.feature ? cloneKmlFeature(currentPanelData.feature) : null,
        audit,
        feeder_name: feederFileName || "",
    };
}

async function saveInterruptionToServer() {
    const response = await fetchWithTimeout("/interruptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildInterruptionRequestPayload()),
    });
    const data = await response.json().catch(() => ({ success: false, message: "Failed to save interruption." }));
    if (!response.ok || !data.success || !data.interruption) {
        throw new Error(data.message || "Failed to save interruption.");
    }
    return normalizeInterruptionRecord(data.interruption);
}

function createEmptyValidation() {
    return {
        status: "ok",
        errors: [],
        warnings: [],
        info: [],
        summary: {
            total_nodes: 0,
            total_edges: 0,
            total_accounts: 0,
            duplicate_towers: 0,
            duplicate_accounts: 0,
            missing_coordinates: 0,
            disconnected_nodes: 0,
            unmatched_accounts: 0,
            invalid_kml_features: 0,
            inferred_edges: 0,
            manual_overrides_applied: 0,
            missing_kwhr_rows: 0,
            invalid_kwhr_rows: 0,
            duplicate_frombus_ids: 0,
            duplicate_tobus_ids: 0,
        }
    };
}

function normalizeValidation(validation) {
    const base = createEmptyValidation();
    if (!validation) return base;
    return {
        status: validation.status || "ok",
        errors: [...(validation.errors || [])],
        warnings: [...(validation.warnings || [])],
        info: [...(validation.info || [])],
        summary: {
            ...base.summary,
            ...(validation.summary || {}),
        }
    };
}

function getValidationPriority(status) {
    if (status === "error") return 2;
    if (status === "warning") return 1;
    return 0;
}

function combineValidationReports(...reports) {
    const combined = createEmptyValidation();
    reports.filter(Boolean).forEach((report) => {
        const normalized = normalizeValidation(report);
        if (getValidationPriority(normalized.status) > getValidationPriority(combined.status)) {
            combined.status = normalized.status;
        }
        combined.errors.push(...normalized.errors);
        combined.warnings.push(...normalized.warnings);
        combined.info.push(...normalized.info);
        Object.keys(combined.summary).forEach((key) => {
            combined.summary[key] += Number(normalized.summary[key] || 0);
        });
    });
    return combined;
}

function getCurrentCombinedValidation() {
    const activeInterruption = getActiveInterruption();
    const auditValidation = activeInterruption?.audit?.validation || currentPanelData?.audit?.validation || validationReports.audit;
    return combineValidationReports(
        validationReports.feeder,
        validationReports.xlsx,
        validationReports.kml,
        auditValidation
    );
}

function getDisconnectedFragmentRows(fragment) {
    const rows = [];
    const seenPairs = new Set();
    const seenStandalone = new Set();

    (fragment?.relationships || []).forEach((relationship) => {
        const fromPol = String(relationship?.from || "").trim();
        const toPol = String(relationship?.to || "").trim();
        if (!fromPol && !toPol) return;
        const pairKey = `${fromPol}__${toPol}`;
        if (seenPairs.has(pairKey)) return;
        seenPairs.add(pairKey);
        rows.push({
            fromPol,
            toPol,
            disconnectedPole: "",
            source: relationship?.source || "",
        });
    });

    (fragment?.standalone_poles || []).forEach((poleName) => {
        const cleaned = String(poleName || "").trim();
        if (!cleaned || seenStandalone.has(cleaned)) return;
        seenStandalone.add(cleaned);
        rows.push({
            fromPol: "",
            toPol: "",
            disconnectedPole: cleaned,
            source: "standalone",
        });
    });

    if (rows.length) {
        return rows;
    }

    const fallbackNames = (fragment?.node_names || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean);

    if (fallbackNames.length === 1) {
        return [{ fromPol: "", toPol: "", disconnectedPole: fallbackNames[0], source: "fallback" }];
    }

    if (fallbackNames.length > 1) {
        return fallbackNames.slice(0, -1).map((name, index) => ({
            fromPol: name,
            toPol: fallbackNames[index + 1],
            disconnectedPole: "",
            source: "fallback",
        }));
    }

    return [];
}

function renderDisconnectedFragmentsSection(fragments = []) {
    if (!fragments.length) {
        return "";
    }

    return `
        <section class="validation-section">
            <div class="validation-section-head">
                <div>
                    <h4>Disconnected Fragments</h4>
                    <p class="viewer-meta">These feeder fragments were not auto-connected to the confirmed source path.</p>
                </div>
                <button id="exportDisconnectedFragmentsBtn" type="button" class="secondary-action compact-btn">Export Disconnected Fragments XLSX</button>
            </div>
            <div class="validation-fragment-list">
                ${fragments.map((fragment) => {
                    const rows = getDisconnectedFragmentRows(fragment);
                    const tableRows = rows.map((row) => `
                        <tr>
                            <td>${row.fromPol ? escapeHtml(row.fromPol) : "-"}</td>
                            <td>${row.toPol ? escapeHtml(row.toPol) : "-"}</td>
                            <td>${row.disconnectedPole ? escapeHtml(row.disconnectedPole) : "-"}</td>
                        </tr>
                    `).join("");
                    return `
                        <div class="validation-fragment-card">
                            <div class="validation-fragment-head">
                                <div>
                                    <strong>Fragment ${escapeHtml(String(fragment.fragment_id || "-"))}</strong>
                                    <p class="viewer-meta">
                                        ${fragment.anchor_name ? `Closest confirmed tower: ${escapeHtml(fragment.anchor_name)}.` : "No confirmed anchor found."}
                                        ${fragment.structure_source === "distance_fallback" ? " Relationship view is distance-based fallback." : " Relationship view comes from fragment connectivity."}
                                    </p>
                                </div>
                            </div>
                            <div class="table-wrap">
                                <table class="affected-table validation-fragment-table">
                                    <thead>
                                        <tr>
                                            <th>From Pol</th>
                                            <th>To Pol</th>
                                            <th>Disconnected Pole</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableRows || '<tr><td colspan="3">No disconnected relationships were found for this fragment.</td></tr>'}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

function renderValidationReport() {
    if (!validationMeta || !validationReportContent) return;

    const reportEntries = [
        ["Feeder Upload", validationReports.feeder],
        ["XLSX Upload", validationReports.xlsx],
        ["KML Upload", validationReports.kml],
        ["Active Trace Audit", getActiveInterruption()?.audit?.validation || currentPanelData?.audit?.validation || validationReports.audit],
    ].filter(([, report]) => report);

    const combined = getCurrentCombinedValidation();
    const activeAudit = getActiveInterruption()?.audit || currentPanelData?.audit || null;
    const traceConfidence = activeAudit?.trace_confidence || "confirmed";
    const disconnectedCount = (networkData?.disconnected_fragments || []).length;
    const unresolvedKmlFeatures = combined.summary.invalid_kml_features || 0;
    const unmatchedAccounts = combined.summary.unmatched_accounts || 0;
    validationMeta.textContent = "Review upload quality and tracing reliability before trusting the result.";

    if (!reportEntries.length) {
        validationReportContent.innerHTML = `
            <section class="validation-overview">
                <div class="validation-status-row">
                    <div>
                        <h4>No validation report yet</h4>
                        <p class="viewer-meta">Upload data or trace an interruption to generate a report.</p>
                    </div>
                    <span class="validation-badge ok">OK</span>
                </div>
            </section>
        `;
        return;
    }

    const summaryCards = [
        ["Total Nodes", combined.summary.total_nodes],
        ["Total Edges", combined.summary.total_edges],
        ["Total Accounts", combined.summary.total_accounts],
        ["Duplicate Towers", combined.summary.duplicate_towers],
        ["Duplicate Accounts", combined.summary.duplicate_accounts],
        ["Duplicate FromBusID", combined.summary.duplicate_frombus_ids],
        ["Duplicate ToBusID", combined.summary.duplicate_tobus_ids],
        ["Missing Coordinates", combined.summary.missing_coordinates],
        ["Missing KWHR", combined.summary.missing_kwhr_rows],
        ["Invalid KWHR", combined.summary.invalid_kwhr_rows],
        ["Disconnected Nodes", combined.summary.disconnected_nodes],
        ["Unmatched Accounts", combined.summary.unmatched_accounts],
        ["Invalid KML Features", combined.summary.invalid_kml_features],
        ["Inferred Edges", combined.summary.inferred_edges],
        ["Manual Overrides", combined.summary.manual_overrides_applied],
    ].map(([label, value]) => `
        <div class="validation-summary-card">
            <span class="validation-summary-label">${escapeHtml(label)}</span>
            <strong class="validation-summary-value">${escapeHtml(String(value || 0))}</strong>
        </div>
    `).join("");

    const operatorSummaryCards = [
        ["Trace Status", traceConfidence === "confirmed" ? "Confirmed Only" : (traceConfidence === "mixed" ? "Mixed Path" : "Guessed Path")],
        ["Disconnected Fragments Found", disconnectedCount],
        ["Unresolved KML Features", unresolvedKmlFeatures],
        ["Unmatched Account Rows", unmatchedAccounts],
        ["Inferred Nodes", activeAudit?.inferred_nodes_count || 0],
        ["Inferred Accounts", activeAudit?.inferred_accounts_count || 0],
    ].map(([label, value]) => `
        <div class="validation-summary-card operator-summary-card">
            <span class="validation-summary-label">${escapeHtml(label)}</span>
            <strong class="validation-summary-value">${escapeHtml(String(value))}</strong>
        </div>
    `).join("");

    const fragmentSection = renderDisconnectedFragmentsSection(networkData?.disconnected_fragments || []);

    const sectionsHtml = reportEntries.map(([title, report]) => renderValidationSection(title, report)).join("");
    validationReportContent.innerHTML = `
        <section class="validation-overview">
            <div class="validation-status-row">
                <div>
                    <h4>Overall Validation Status</h4>
                    <p class="viewer-meta">Warnings mean you can continue carefully. Errors mean the output should not be trusted yet.</p>
                </div>
                <span class="validation-badge ${escapeHtml(combined.status)}">${escapeHtml(combined.status)}</span>
            </div>
            <div class="validation-quick-title">Operator Summary</div>
            <div class="validation-summary-grid">${operatorSummaryCards}</div>
            <div class="validation-quick-title">Detailed Validation Counts</div>
            <div class="validation-summary-grid">${summaryCards}</div>
        </section>
        ${fragmentSection}
        ${sectionsHtml}
    `;

    const exportDisconnectedFragmentsBtn = document.getElementById("exportDisconnectedFragmentsBtn");
    if (exportDisconnectedFragmentsBtn) {
        exportDisconnectedFragmentsBtn.addEventListener("click", function () {
            exportDisconnectedFragments(exportDisconnectedFragmentsBtn);
        });
    }
}

function renderValidationSection(title, report) {
    const normalized = normalizeValidation(report);
    return `
        <section class="validation-section">
            <div class="validation-section-head">
                <div>
                    <h4>${escapeHtml(title)}</h4>
                    <p class="viewer-meta">Status for this part of the workflow.</p>
                </div>
                <span class="validation-badge ${escapeHtml(normalized.status)}">${escapeHtml(normalized.status)}</span>
            </div>
            ${renderValidationMessages("Errors", normalized.errors)}
            ${renderValidationMessages("Warnings", normalized.warnings)}
            ${renderValidationMessages("Info", normalized.info)}
        </section>
    `;
}

function renderValidationMessages(title, messages = []) {
    if (!messages.length) return "";
    return `
        <div class="validation-message-group">
            <h4>${escapeHtml(title)}</h4>
            <ul class="validation-message-list">
                ${messages.map((message) => `<li>${escapeHtml(message)}</li>`).join("")}
            </ul>
        </div>
    `;
}

async function exportDisconnectedFragments(button) {
    if (!canPerform("can_export")) {
        alert("Your role does not have permission to export disconnected fragments.");
        return;
    }

    const fragments = networkData?.disconnected_fragments || [];
    if (!fragments.length) {
        alert("No disconnected fragments are available to export.");
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Exporting...";
    }

    try {
        const response = await fetchWithTimeout("/export_disconnected_fragments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                feeder_name: feederFileName || "feeder",
                disconnected_fragments: fragments,
                towers: networkData?.towers || [],
            }),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({ message: "Disconnected fragment export failed." }));
            throw new Error(data.message || "Disconnected fragment export failed.");
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${(feederFileName || "disconnected_fragments").replace(/\.[^.]+$/, "")}_disconnected_fragments.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert(error.message);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Export Disconnected Fragments XLSX";
        }
    }
}

function setUploadButtonState(button, state) {
    if (!button) return;
    button.classList.remove("upload-loading", "upload-success", "upload-error");

    if (state === "loading") {
        button.classList.add("upload-loading");
        button.textContent = "Uploading...";
        return;
    }
    if (state === "success") {
        button.classList.add("upload-success");
        button.textContent = "Uploaded";
        return;
    }
    if (state === "error") {
        button.classList.add("upload-error");
        button.textContent = "Retry Upload";
        return;
    }

    if (button === feederUploadButton) {
        button.textContent = "Upload .GPX file";
    } else if (button === xlsxUploadButton) {
        button.textContent = "Upload .XLSX file";
    } else {
        button.textContent = "Upload .KML file";
    }
}

function showMapLoading(message) {
    if (mapLoadingText) {
        mapLoadingText.textContent = message || "Uploading data...";
    }
    if (mapLoadingIndicator) {
        mapLoadingIndicator.classList.remove("hidden");
    }
}

function hideMapLoading() {
    if (mapLoadingIndicator) {
        mapLoadingIndicator.classList.add("hidden");
    }
}

async function drawNetwork(network) {
    clearMapObjects();
    clearMapHoverPreviewCache();
    lastKnownDataBounds = null;

    const lineChunkSize = performanceMode.enabled ? 160 : 500;
    const towerChunkSize = performanceMode.enabled ? 220 : 800;

    await processInChunks(network.lines || [], lineChunkSize, "Drawing feeder lines", (line, relativeIndex) => {
        const lineIndex = linePolylines.length;
        const polyline = L.polyline(line.coords, {
            ...getNetworkLineBaseStyle(line),
            interactive: true,
            renderer: canvasRenderer,
            smoothFactor: performanceMode.enabled ? 0 : 1,
        });
        polyline._visualStyleSignature = getNetworkLineVisualSignature(line, false, false);
        if (shouldDisplayNetworkLine(line)) {
            polyline.addTo(map);
        }
        if (!performanceMode.enabled) {
            attachLazyHoverTooltip(polyline, function () {
                return buildLineHoverPreview(line, lineIndex);
            }, "top");
        }
        polyline.on("click", function () {
            highlightDownstreamFromLine(lineIndex);
        });
        linePolylines.push(polyline);
        (line.coords || []).forEach((coord) => {
            lastKnownDataBounds = extendBounds(lastKnownDataBounds, coord?.[0], coord?.[1]);
        });
    });

    await processInChunks(network.towers || [], towerChunkSize, "Drawing feeder towers", (tower) => {
        const index = towerMarkers.length;
        const marker = L.circleMarker([tower.lat, tower.lon], {
            ...getTowerMarkerStyle(false),
            renderer: canvasRenderer,
        }).addTo(map);
        marker.isHighlighted = false;
        marker._visualStyleSignature = getTowerMarkerVisualSignature(false);
        if (!performanceMode.enabled || index < 1200) {
            attachLazyHoverTooltip(marker, function () {
                return buildTowerHoverPreview(tower);
            }, "top");
        }
        marker.on("click", function () {
            highlightDownstreamFromTower(index);
        });
        towerMarkers.push(marker);
        lastKnownDataBounds = extendBounds(lastKnownDataBounds, tower.lat, tower.lon);
    });

    zoomToKnownDataBounds();
    updateMapGeometryLineWeights();
    updateMapMarkerVisuals();
    updateOperationalCounters();
}

function clearMapObjects() {
    towerMarkers.forEach((marker) => map.removeLayer(marker));
    linePolylines.forEach((polyline) => map.removeLayer(polyline));
    towerMarkers = [];
    linePolylines = [];
    activeNetworkLineIndexes = new Set();
    activeTowerMarkerIndexes = new Set();
    activeSelectedNetworkLineIndex = null;
    lastAppliedGpxVisibilitySignature = "";
    clearMapHoverPreviewCache();
}

function clearKmlOverlay() {
    kmlOverlayLayers.forEach((layer) => map.removeLayer(layer));
    kmlTransformerMarkers.forEach((marker) => map.removeLayer(marker));
    kmlOverlayLayers = [];
    kmlTransformerMarkers = [];
    kmlOverlayLayerMap = new Map();
    kmlEndpointMapCache = null;
    activeKmlFeatureId = null;
    activeKmlHighlightIds = new Set();
    lastAppliedKmlVisibilitySignature = "";
    clearMapHoverPreviewCache();
    updateOperationalCounters();
}

function syncLineVisibilityButtons() {
    toggleGpxBtn.classList.toggle("is-active", showGpxLines);
    toggleKmlBtn.classList.toggle("is-active", showKmlLines);
    toggleInferredBtn.classList.toggle("is-active", showInferredConnections);
    toggleGpxBtn.textContent = showGpxLines ? "Hide .GPX Line" : "Show .GPX Line";
    toggleKmlBtn.textContent = showKmlLines ? "Hide .KML Line" : "Show .KML Line";
    toggleInferredBtn.textContent = showInferredConnections ? "Hide Inferred Connections" : "Show Inferred Connections";
}

function applyGpxLineVisibility() {
    const signature = buildVisibilitySignature();
    if (signature === lastAppliedGpxVisibilitySignature) {
        return;
    }
    linePolylines.forEach((polyline, index) => {
        const line = networkData?.lines?.[index];
        if (!polyline) return;
        if (showGpxLines && shouldDisplayNetworkLine(line)) {
            if (!map.hasLayer(polyline)) {
                polyline.addTo(map);
            }
        } else if (map.hasLayer(polyline)) {
            map.removeLayer(polyline);
        }
    });
    lastAppliedGpxVisibilitySignature = signature;
}

function shouldDisplayKmlFeature(feature) {
    if (isTransformerFeature(feature)) return true;
    return showKmlLines;
}

function applyKmlLineVisibility() {
    const signature = buildVisibilitySignature();
    if (signature === lastAppliedKmlVisibilitySignature) {
        return;
    }
    kmlOverlayLayerMap.forEach((layer, featureId) => {
        const feature = getKmlFeatureById(featureId);
        if (!feature || !layer) return;
        if (shouldDisplayKmlFeature(feature)) {
            if (!map.hasLayer(layer)) {
                layer.addTo(map);
            }
        } else if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    lastAppliedKmlVisibilitySignature = signature;
}

const transformerTools = window.TransformerTools || {};

function normalizeTransformerLabel(value) {
    if (typeof transformerTools.normalizeTransformerLabel === "function") {
        return transformerTools.normalizeTransformerLabel(value);
    }
    return String(value || "").trim().toUpperCase();
}

function isTransformerFeature(feature) {
    if (typeof transformerTools.isTransformerFeature === "function") {
        return transformerTools.isTransformerFeature(feature);
    }
    return false;
}

function getFeatureCenter(feature) {
    const coords = feature?.coords || [];
    if (!coords.length) return null;
    const sums = coords.reduce((acc, coord) => [acc[0] + Number(coord[0]), acc[1] + Number(coord[1])], [0, 0]);
    return [sums[0] / coords.length, sums[1] / coords.length];
}

function createTransformerIcon(label, zoomValue = map.getZoom()) {
    const zoom = Number.isFinite(Number(zoomValue)) ? Number(zoomValue) : map.getZoom();
    const scale = Math.max(1, Math.min(2.2, zoom / 12));
    const iconSize = Math.round(22 * scale);
    return L.divIcon({
        className: "transformer-icon-wrapper",
        html: `<div class="transformer-hitbox" aria-hidden="true" style="transform: scale(${scale}); transform-origin: center;"><div class="transformer-icon"></div></div>`,
        iconSize: [iconSize, iconSize],
        iconAnchor: [Math.round(iconSize / 2), Math.round(iconSize * 0.72)],
    });
}

function clearMapHoverPreviewCache() {
    mapHoverPreviewCache = {
        towers: new Map(),
        lines: new Map(),
        kml: new Map(),
        transformers: new Map(),
    };
}

function getMapHoverTooltipOptions(direction = "top") {
    return {
        direction,
        sticky: true,
        opacity: 0.96,
        className: "map-hover-tooltip",
        offset: direction === "top" ? [0, -8] : [0, 8],
    };
}

function attachLazyHoverTooltip(layer, contentFactory, direction = "top") {
    if (!layer || typeof contentFactory !== "function") {
        return;
    }
    if (!shouldEnableMapHover()) {
        return;
    }

    layer.bindTooltip("", getMapHoverTooltipOptions(direction));
    layer.on("tooltipopen", function () {
        if (typeof layer.setTooltipContent !== "function") {
            return;
        }
        layer.setTooltipContent(contentFactory());
    });
}

function formatHoverPreviewValue(value, fallback = "-") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
}

function buildHoverPreviewRows(rows = []) {
    return rows.map(({ label, value }) => `
        <div class="map-hover-row">
            <span class="map-hover-label">${escapeHtml(label)}</span>
            <strong class="map-hover-value">${escapeHtml(formatHoverPreviewValue(value))}</strong>
        </div>
    `).join("");
}

function buildHoverPreviewCard(title, rows = [], footer = "") {
    return `
        <div class="map-hover-card">
            <div class="map-hover-title">${escapeHtml(title || "Preview")}</div>
            ${buildHoverPreviewRows(rows)}
            ${footer ? `<div class="map-hover-footer">${escapeHtml(footer)}</div>` : ""}
        </div>
    `;
}

function getQuickTowerAccountCount(tower) {
    const normalizedTower = normalizeId(tower?.name);
    if (!normalizedTower || !accountData?.tower_mapping) {
        return 0;
    }
    return (accountData.tower_mapping[normalizedTower] || []).length;
}

function getQuickTowerKwhr(tower) {
    const normalizedTower = normalizeId(tower?.name);
    if (!normalizedTower || !accountData?.tower_mapping) {
        return 0;
    }
    return (accountData.tower_mapping[normalizedTower] || []).reduce((total, row) => {
        const value = Number(row?.kwhr);
        return total + (Number.isFinite(value) ? value : 0);
    }, 0);
}

function buildTowerHoverPreview(tower) {
    const cacheKey = Number.isInteger(tower?.index) ? tower.index : String(tower?.name || "");
    if (mapHoverPreviewCache.towers.has(cacheKey)) {
        return mapHoverPreviewCache.towers.get(cacheKey);
    }

    const preview = buildHoverPreviewCard(
        tower?.name || "Pole",
        [
            { label: "Type", value: "Pole" },
            { label: "Pol ID", value: extractPoleId(tower?.name) || tower?.name || "-" },
            { label: "Accounts", value: getQuickTowerAccountCount(tower) },
            { label: "KWHR", value: formatKwhr(getQuickTowerKwhr(tower)) },
        ],
        "Click to open the full affected area."
    );

    mapHoverPreviewCache.towers.set(cacheKey, preview);
    return preview;
}

function buildLineHoverPreview(line, lineIndex) {
    const cacheKey = Number.isInteger(lineIndex) ? lineIndex : `${line?.start_name || ""}-${line?.end_name || ""}`;
    if (mapHoverPreviewCache.lines.has(cacheKey)) {
        return mapHoverPreviewCache.lines.get(cacheKey);
    }

    const lineType = line?.edge_type === "manual_override"
        ? "Manual Override"
        : (line?.edge_type === "inferred" ? "Inferred" : "Confirmed");
    const preview = buildHoverPreviewCard(
        `${line?.start_name || "Line"} -> ${line?.end_name || "Line"}`,
        [
            { label: "Type", value: lineType },
            { label: "Confidence", value: line?.confidence || (line?.edge_type === "inferred" ? "mixed" : "confirmed") },
            { label: "Start Pole", value: line?.start_name || "-" },
            { label: "End Pole", value: line?.end_name || "-" },
        ],
        "Click to trace the downstream affected area."
    );

    mapHoverPreviewCache.lines.set(cacheKey, preview);
    return preview;
}

function getTransformerHoverMetrics(feature) {
    const cacheKey = String(feature?.id || feature?.name || "");
    if (mapHoverPreviewCache.transformers.has(cacheKey)) {
        return mapHoverPreviewCache.transformers.get(cacheKey);
    }

    const networkContext = shouldEnableMapHover() ? (buildKmlNetworkContext(feature) || null) : null;
    const affectedPoles = getCanonicalAffectedPolIdEntries(networkContext?.affectedTowers || []);
    const matchedRows = networkContext?.matchedRows || [];
    const metrics = {
        affectedPoleCount: affectedPoles.length,
        accountCount: getUniqueAffectedAccounts(matchedRows).length,
        kwhr: getTotalAffectedKwhr(matchedRows),
    };
    mapHoverPreviewCache.transformers.set(cacheKey, metrics);
    return metrics;
}

function buildTransformerHoverPreview(feature) {
    const cacheKey = String(feature?.id || feature?.name || "");
    if (mapHoverPreviewCache.kml.has(cacheKey)) {
        return mapHoverPreviewCache.kml.get(cacheKey);
    }

    const metrics = getTransformerHoverMetrics(feature);
    const preview = buildHoverPreviewCard(
        feature?.name || "Transformer",
        [
            { label: "Type", value: "Transformer" },
            { label: "Affected Pol ID", value: metrics.affectedPoleCount },
            { label: "Accounts", value: metrics.accountCount },
            { label: "KWHR", value: formatKwhr(metrics.kwhr) },
        ],
        "Click to open the transformer details."
    );

    mapHoverPreviewCache.kml.set(cacheKey, preview);
    return preview;
}

function buildKmlLineHoverPreview(feature) {
    const cacheKey = String(feature?.id || feature?.name || "");
    if (mapHoverPreviewCache.kml.has(cacheKey)) {
        return mapHoverPreviewCache.kml.get(cacheKey);
    }

    const featureTokens = getKmlFeatureTowerTokens(feature);
    const preview = buildHoverPreviewCard(
        feature?.name || "KML Feature",
        [
            { label: "Type", value: feature?.geometry || "Line" },
            { label: "Linked Poles", value: featureTokens.length || 0 },
            { label: "Description", value: String(feature?.description || "").slice(0, 60) || "-" },
        ],
        "Click to inspect this KML feature."
    );

    mapHoverPreviewCache.kml.set(cacheKey, preview);
    return preview;
}

function refreshMapHoverPreviews() {
    clearMapHoverPreviewCache();
}

function getKmlFeatureStyle(feature, isActive = false) {
    const style = feature && feature.style ? feature.style : {};
    const lineWeight = getMapLineWeight();
    return {
        color: isActive ? affectedLineColor : normalKmlLineColor,
        weight: isActive ? lineWeight + 1 : Math.max(1.2, Math.min(lineWeight, style.weight || lineWeight)),
        opacity: isActive ? 1 : (style.opacity ?? 0.9),
        dashArray: feature.geometry === "polygon" ? "6 4" : null,
    };
}

function shouldDisplayNetworkLine(line) {
    if (!showGpxLines) return false;
    if (!line) return true;
    if ((line.edge_type === "inferred" || line.edge_type === "manual_override") && !showInferredConnections) {
        return false;
    }
    return true;
}

function getNetworkLineBaseStyle(line) {
    const lineWeight = getMapLineWeight();
    if (line?.edge_type === "manual_override") {
        return { color: manualOverrideColor, weight: lineWeight, dashArray: "8 6", opacity: 0.95 };
    }
    if (line?.edge_type === "inferred") {
        return { color: selectedLineColor, weight: lineWeight, dashArray: "10 6", opacity: 0.95 };
    }
    return { color: normalLineColor, weight: lineWeight, opacity: 1 };
}

function getHighlightedNetworkLineStyle(line, isSelected = false) {
    const color = isSelected ? selectedLineColor : affectedLineColor;
    const lineWeight = getMapLineWeight() + (isSelected ? 1.1 : 0.7);
    if (line?.edge_type === "manual_override") {
        return { color, weight: lineWeight, dashArray: "8 6", opacity: 1 };
    }
    if (line?.edge_type === "inferred") {
        return { color, weight: lineWeight, dashArray: "10 6", opacity: 1 };
    }
    return { color, weight: lineWeight, opacity: 1 };
}

function applyNetworkLineHighlightState(nextIndexes = [], selectedIndex = null) {
    const nextSet = new Set(nextIndexes.filter((value) => Number.isInteger(value)));
    const normalizedSelectedIndex = Number.isInteger(selectedIndex) ? selectedIndex : null;
    if (setsEqual(activeNetworkLineIndexes, nextSet) && activeSelectedNetworkLineIndex === normalizedSelectedIndex) {
        return;
    }
    const changedIndexes = getChangedIndexes(activeNetworkLineIndexes, nextSet, [
        activeSelectedNetworkLineIndex,
        normalizedSelectedIndex,
    ]);
    const zoomBucket = getVisualZoomBucket();

    changedIndexes.forEach((lineIndex) => {
        if (!Number.isInteger(lineIndex)) {
            return;
        }
        const polyline = linePolylines[lineIndex];
        if (!polyline || typeof polyline.setStyle !== "function") {
            return;
        }
        const line = networkData?.lines?.[lineIndex];
        const isActive = nextSet.has(lineIndex);
        const isSelected = isActive && normalizedSelectedIndex === lineIndex;
        applyStyleIfChanged(
            polyline,
            isActive ? getHighlightedNetworkLineStyle(line, isSelected) : getNetworkLineBaseStyle(line),
            getNetworkLineVisualSignature(line, isActive, isSelected, zoomBucket)
        );
    });

    activeNetworkLineIndexes = nextSet;
    activeSelectedNetworkLineIndex = normalizedSelectedIndex;
}

function applyTowerHighlightState(indexes = []) {
    const nextSet = new Set(indexes.filter((value) => Number.isInteger(value)));
    if (setsEqual(activeTowerMarkerIndexes, nextSet)) {
        return;
    }
    const changedIndexes = getChangedIndexes(activeTowerMarkerIndexes, nextSet);
    const zoomBucket = getVisualZoomBucket();

    changedIndexes.forEach((towerIndex) => {
        const marker = towerMarkers[towerIndex];
        if (!marker || typeof marker.setStyle !== "function") {
            return;
        }
        const isHighlighted = nextSet.has(towerIndex);
        marker.isHighlighted = isHighlighted;
        applyStyleIfChanged(
            marker,
            getTowerMarkerStyle(isHighlighted),
            getTowerMarkerVisualSignature(isHighlighted, zoomBucket)
        );
        if (isHighlighted && typeof marker.bringToFront === "function") {
            marker.bringToFront();
        }
    });

    activeTowerMarkerIndexes = nextSet;
}

function applyKmlHighlightState(featureIds = [], selectedFeatureId = null) {
    const nextSet = new Set((featureIds || []).filter(Boolean));
    const normalizedSelectedFeatureId = selectedFeatureId || null;
    if (setsEqual(activeKmlHighlightIds, nextSet) && activeKmlFeatureId === normalizedSelectedFeatureId) {
        return;
    }
    const changedIds = new Set([
        ...activeKmlHighlightIds,
        ...nextSet,
        activeKmlFeatureId,
        normalizedSelectedFeatureId,
    ].filter(Boolean));
    const zoomBucket = getVisualZoomBucket();

    changedIds.forEach((featureId) => {
        const layer = kmlOverlayLayerMap.get(featureId);
        const feature = getKmlFeatureById(featureId);
        if (!layer || !feature || typeof layer.setStyle !== "function") {
            return;
        }
        const isActive = nextSet.has(featureId);
        applyStyleIfChanged(
            layer,
            getKmlFeatureStyle(feature, isActive),
            getKmlFeatureVisualSignature(feature, isActive, zoomBucket)
        );
    });

    activeKmlHighlightIds = nextSet;
    activeKmlFeatureId = normalizedSelectedFeatureId;
}

function clearKmlHighlight() {
    applyKmlHighlightState([], null);
}

function highlightKmlFeature(featureId) {
    if (!featureId) {
        clearKmlHighlight();
        return;
    }
    applyKmlHighlightState([featureId], featureId);
}

function getAffectedTowerTokenSet(affectedTowers = []) {
    const tokens = new Set();
    affectedTowers.forEach((tower) => {
        const normalized = normalizeId(tower?.name);
        if (normalized) {
            tokens.add(normalized);
        }
    });
    return tokens;
}

function getActiveKmlFeatureIdsForPanel(panelData = {}) {
    const selectedFeatureId = panelData?.feature?.id || null;
    const affectedTokens = getAffectedTowerTokenSet(panelData?.affectedTowers || []);
    const connectedFeatureIds = new Set(panelData?.kmlFeatureIds || []);
    const activeIds = new Set();

    (kmlOverlayData?.features || []).forEach((feature) => {
        if (!feature) return;
        const featureTokens = getKmlFeatureTowerTokens(feature);
        const matchesAffectedTower = featureTokens.some((token) => affectedTokens.has(token));
        const isActive = feature.id === selectedFeatureId || connectedFeatureIds.has(feature.id) || matchesAffectedTower;
        if (isActive) {
            activeIds.add(feature.id);
        }
    });

    return [...activeIds];
}
function highlightAffectedKmlFeatures(panelData = {}) {
    const selectedFeatureId = panelData?.feature?.id || null;
    applyKmlHighlightState(getActiveKmlFeatureIdsForPanel(panelData), selectedFeatureId);
}

async function drawKmlOverlay(overlay) {
    clearKmlOverlay();
    syncLineVisibilityButtons();
    if (!overlay || !overlay.features) return;
    const featureChunkSize = performanceMode.enabled ? 140 : 420;

    await processInChunks(overlay.features || [], featureChunkSize, "Drawing KML overlay", (feature) => {
        if (!feature.coords || !feature.coords.length) return;

        if (feature.geometry !== "point" && feature.coords.length >= 2) {
            const layer = L.polyline(feature.coords, {
                ...getKmlFeatureStyle(feature, false),
                interactive: true,
                renderer: canvasRenderer,
                smoothFactor: performanceMode.enabled ? 0 : 1,
            });
            layer._visualStyleSignature = getKmlFeatureVisualSignature(feature, false);
            if (shouldDisplayKmlFeature(feature)) {
                layer.addTo(map);
            }
            if (!performanceMode.enabled) {
                attachLazyHoverTooltip(layer, function () {
                    return isTransformerFeature(feature)
                        ? buildTransformerHoverPreview(feature)
                        : buildKmlLineHoverPreview(feature);
                }, "top");
            }
            layer.on("click", function () {
                selectKmlLineFeature(feature);
            });
            kmlOverlayLayers.push(layer);
            kmlOverlayLayerMap.set(feature.id, layer);
            (feature.coords || []).forEach((coord) => {
                lastKnownDataBounds = extendBounds(lastKnownDataBounds, coord?.[0], coord?.[1]);
            });
        }

        if (isTransformerFeature(feature)) {
            const center = getFeatureCenter(feature);
            if (center) {
                const marker = L.marker(center, {
                    icon: createTransformerIcon(feature.name || "DT", map.getZoom()),
                    pane: "transformerPane",
                    zIndexOffset: 400,
                }).addTo(map);
                marker.featureId = feature.id;
                marker.transformerLabel = feature.name || "DT";
                marker._visualIconBucket = getVisualZoomBucket();
                attachLazyHoverTooltip(marker, function () {
                    return buildTransformerHoverPreview(feature);
                }, "top");
                marker.on("click", function () {
                    selectTransformerFeature(feature);
                });
                kmlTransformerMarkers.push(marker);
                lastKnownDataBounds = extendBounds(lastKnownDataBounds, center?.[0], center?.[1]);
            }
        }
    });

    towerMarkers.forEach((marker) => {
        if (marker && typeof marker.bringToFront === "function") {
            marker.bringToFront();
        }
    });
    zoomToKnownDataBounds();
    updateMapGeometryLineWeights();
    updateMapMarkerVisuals();
}

function resetLineColors() {
    applyNetworkLineHighlightState([], null);
    applyTowerHighlightState([]);
    clearKmlHighlight();
}

function resetTowerMarkerStyles() {
    applyTowerHighlightState([]);
}

function highlightTowerMarkerIndices(indexes = []) {
    applyTowerHighlightState(indexes);
}

function showSidePanel() {
    sidePanel.classList.remove("hidden");
    mainLayout.classList.add("panel-open");
}

function hideSidePanel() {
    sidePanel.classList.add("hidden");
    mainLayout.classList.remove("panel-open");
    sidePanelSearchTerm = "";
    if (sidePanelSearchInput) {
        sidePanelSearchInput.value = "";
    }
    detailsBox.innerHTML = `
        <div class="side-panel-empty">
            <h3>No selection yet</h3>
            <p>Click a tower, line, or transformer on the map to load affected poles, consumer data, and KWHR details.</p>
        </div>
    `;
    currentPanelData = null;
    currentContextType = "tower";
    renderTraceAudit(null);
    updateOperationalCounters();
}

function clearActiveSelectionState() {
    resetLineColors();
    activeInterruptionId = null;
    hideSidePanel();
    renderInterruptionCollections();
    refreshViewerIfOpen();
}

function clearAllData() {
    resetWorkspaceClientState({ resetMapView: true, resetLabels: true, preserveRecoveryNotice: true });
    fileInput.value = "";
    xlsxFileInput.value = "";
    kmlFileInput.value = "";
    renderInterruptionCollections();
    refreshViewerIfOpen();
    updateOperationalCounters();
}

function updateOperationalCounters(panelData = currentPanelData) {
    const towers = getSidePanelAffectedPoleEntries(panelData?.affectedTowers || []);
    const accounts = getUniqueAffectedAccountCount(panelData?.matchedRows || []);
    if (towerCountValue) {
        towerCountValue.textContent = `${towers.length}`;
    }
    if (accountCountValue) {
        accountCountValue.textContent = `${accounts}`;
    }
}

function buildTraceAudit(panelData = currentPanelData) {
    const safePanelData = panelData || {};
    const validation = createEmptyValidation();
    const lineIndexes = Array.isArray(safePanelData.lineIndexes) ? safePanelData.lineIndexes : [];
    const matchedRows = Array.isArray(safePanelData.matchedRows) ? safePanelData.matchedRows : [];
    const affectedTowers = Array.isArray(safePanelData.affectedTowers) ? safePanelData.affectedTowers : [];
    const inferredLineIndexes = lineIndexes.filter((lineIndex) => networkData?.lines?.[lineIndex]?.is_inferred);
    const inferredEdges = inferredLineIndexes.map((lineIndex) => networkData?.lines?.[lineIndex]).filter(Boolean);
    const exactMatches = matchedRows.filter((row) => ["Pol ID", "Account Number", "KML"].includes(row?.matched_via)).length;
    const indirectMatches = Math.max(0, matchedRows.length - exactMatches);
    const inferredNodeIndexes = [...new Set(
        inferredLineIndexes
            .map((lineIndex) => networkData?.lines?.[lineIndex]?.end_index)
            .filter((value) => Number.isInteger(value))
    )];
    const inferredNodes = inferredNodeIndexes
        .map((towerIndex) => normalizeId(networkData?.towers?.[towerIndex]?.name || "") || String(towerIndex))
        .filter(Boolean);
    const inferredTowerNames = new Set(inferredNodes.map((name) => normalizeId(name)).filter(Boolean));
    const inferredAccountCount = new Set(
        matchedRows
            .filter((row) => {
                const matchedTower = normalizeId(row?.matched_tower || row?.pol_id || row?.frombus_id || row?.tobus_id || "");
                return matchedTower && inferredTowerNames.has(matchedTower);
            })
            .map((row) => String(row?.account_number || "").trim())
            .filter(Boolean)
    ).size;
    let traceConfidence = "confirmed";
    if (!networkData?.lines?.length || lineIndexes.length === 0) {
        traceConfidence = networkData?.validation?.summary?.inferred_edges ? "guessed" : "confirmed";
    } else if (inferredLineIndexes.length === lineIndexes.length && inferredLineIndexes.length > 0) {
        traceConfidence = "guessed";
    } else if (inferredLineIndexes.length > 0) {
        traceConfidence = "mixed";
    }

    validation.summary.total_nodes = affectedTowers.length;
    validation.summary.total_edges = lineIndexes.length;
    validation.summary.total_accounts = getUniqueAffectedAccountCount(matchedRows);
    validation.summary.inferred_edges = inferredLineIndexes.length;

    if (inferredLineIndexes.length) {
        validation.warnings.push("Connectivity was partially inferred from distance and may be inaccurate.");
        validation.info.push(`${inferredNodes.length} downstream node(s) were reached through inferred connectivity.`);
    } else if (panelData) {
        validation.info.push("Tracing used only explicit connectivity.");
    }

    validation.info.push(`${exactMatches} affected account(s) were matched exactly.`);
    validation.info.push(`${indirectMatches} affected account(s) were matched indirectly.`);
    validation.info.push(`${inferredAccountCount} affected account(s) depend on inferred feeder paths.`);
    validation.info.push(
        inferredLineIndexes.length
            ? "Inferred or guessed connectivity affected this interruption trace."
            : "No inferred or guessed connectivity affected this interruption trace."
    );

    return {
        trace_confidence: traceConfidence,
        explicit_only: inferredLineIndexes.length === 0,
        inferred_connectivity_affected: inferredLineIndexes.length > 0,
        downstream_nodes_via_inferred: inferredNodes.length,
        inferred_edges_used: inferredLineIndexes,
        inferred_nodes: inferredNodes,
        inferred_nodes_count: inferredNodes.length,
        inferred_accounts_count: inferredAccountCount,
        inferred_edge_details: inferredEdges.map((edge) => ({
            id: edge?.id,
            name: edge?.name || "",
            edge_type: edge?.edge_type || "explicit",
            confidence: edge?.confidence || "high",
        })),
        exact_matches: exactMatches,
        indirect_matches: indirectMatches,
        validation: normalizeValidation(validation),
    };
}

function zoomToFeeder() {
    zoomToKnownDataBounds();
}

function renderTraceAudit(audit) {
    if (!traceBadgeBox || !traceConfidenceBadge || !traceWarningBox) return;
    if (!audit) {
        traceBadgeBox.classList.add("hidden");
        traceWarningBox.innerHTML = "";
        return;
    }

    const normalizedAudit = {
        trace_confidence: audit?.trace_confidence || "confirmed",
        inferred_nodes_count: Number(audit?.inferred_nodes_count || 0),
        inferred_accounts_count: Number(audit?.inferred_accounts_count || 0),
        validation: normalizeValidation(audit?.validation),
    };

    traceBadgeBox.classList.remove("hidden");
    const confidence = normalizedAudit.trace_confidence;
    traceBadgeBox.classList.remove("confirmed", "mixed", "guessed");
    traceBadgeBox.classList.add(confidence);
    traceConfidenceBadge.className = `trace-badge ${confidence}`;
    traceConfidenceBadge.textContent = confidence === "mixed"
        ? "Mixed Path"
        : (confidence === "guessed" ? "Guessed Path" : "Confirmed Path");

    const warnings = [];
    if (normalizedAudit.inferred_nodes_count) {
        warnings.push(`${normalizedAudit.inferred_nodes_count} nodes were reached through inferred connectivity.`);
    }
    if (normalizedAudit.inferred_accounts_count) {
        warnings.push(`${normalizedAudit.inferred_accounts_count} affected accounts depend on guessed feeder paths.`);
    }
    if (normalizedAudit.validation.warnings.length) {
        warnings.push(...normalizedAudit.validation.warnings);
    }

    const headline = confidence === "confirmed"
        ? "Confirmed-only trace."
        : (confidence === "mixed"
            ? "Mixed trace detected. Part of the feeder path was inferred."
            : "Guessed trace detected. This result depends on inferred connectivity.");

    traceWarningBox.innerHTML = `
        <div class="trace-warning-headline">${escapeHtml(headline)}</div>
        <div class="trace-warning-metrics">
            <span><strong>Inferred Nodes:</strong> ${normalizedAudit.inferred_nodes_count}</span>
            <span><strong>Inferred Accounts:</strong> ${normalizedAudit.inferred_accounts_count}</span>
        </div>
        <div class="trace-warning-list">
            ${(warnings.length
                ? warnings.map((message) => `<div>${escapeHtml(message)}</div>`).join("")
                : "<div>No guessed connectivity affected this result.</div>")}
        </div>
    `;
}

function zoomToSelectedTower() {
    const tower = currentPanelData?.clickedTower;
    if (tower && Number.isFinite(Number(tower.lat)) && Number.isFinite(Number(tower.lon))) {
        map.setView([tower.lat, tower.lon], 24);
        return;
    }

    const feature = currentPanelData?.feature;
    const center = feature ? getFeatureCenter(feature) : null;
    if (center) {
        map.setView(center, 24);
    }
}

function getTowerLookupValues(tower) {
    return [
        tower?.name,
        tower?.code,
        tower?.pol_id,
        tower?.pole_id,
        tower?.id,
    ].filter(Boolean);
}

function findTowerIndexForPolId(polId) {
    const normalizedTarget = normalizeId(polId);
    if (!normalizedTarget || !networkData?.towers?.length) return -1;
    return networkData.towers.findIndex((tower) => (
        getTowerLookupValues(tower).some((value) => normalizeId(value) === normalizedTarget)
    ));
}

function focusSelectedPolIdOnMap(polId) {
    const label = String(polId || "").trim();
    if (!label) return false;
    if (mapSearchInput) {
        mapSearchInput.value = label;
    }

    const towerIndex = findTowerIndexForPolId(label);
    if (towerIndex >= 0) {
        const tower = networkData.towers[towerIndex];
        const highlightedIndexes = new Set(currentPanelData?.towerIndexes || []);
        highlightedIndexes.add(towerIndex);
        applyTowerHighlightState([...highlightedIndexes]);
        if (Number.isFinite(Number(tower.lat)) && Number.isFinite(Number(tower.lon))) {
            map.setView([tower.lat, tower.lon], 24);
        }
        return true;
    }

    const clickedTower = currentPanelData?.clickedTower;
    if (
        clickedTower
        && Number.isFinite(Number(clickedTower.lat))
        && Number.isFinite(Number(clickedTower.lon))
        && getTowerLookupValues(clickedTower).some((value) => normalizeId(value) === normalizeId(label))
    ) {
        map.setView([clickedTower.lat, clickedTower.lon], 24);
        return true;
    }

    return false;
}

function buildChildrenMap(lines) {
    const children = new Map();
    lines.forEach((line, lineIndex) => {
        if (!children.has(line.start_index)) {
            children.set(line.start_index, []);
        }
        children.get(line.start_index).push({ childTowerIndex: line.end_index, lineIndex });
    });
    return children;
}

function buildRootedChildrenMap(lines, sourceIndex = 0) {
    const adjacency = new Map();
    lines.forEach((line, lineIndex) => {
        const startIndex = line.start_index;
        const endIndex = line.end_index;
        if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
            return;
        }
        if (!adjacency.has(startIndex)) adjacency.set(startIndex, []);
        if (!adjacency.has(endIndex)) adjacency.set(endIndex, []);
        adjacency.get(startIndex).push({ neighborIndex: endIndex, lineIndex });
        adjacency.get(endIndex).push({ neighborIndex: startIndex, lineIndex });
    });

    const children = new Map();
    const visited = new Set([sourceIndex]);
    const queue = [sourceIndex];
    while (queue.length > 0) {
        const current = queue.shift();
        (adjacency.get(current) || []).forEach(({ neighborIndex, lineIndex }) => {
            if (visited.has(neighborIndex)) {
                return;
            }
            visited.add(neighborIndex);
            queue.push(neighborIndex);
            if (!children.has(current)) {
                children.set(current, []);
            }
            children.get(current).push({ childTowerIndex: neighborIndex, lineIndex });
        });
    }
    return { children, visited };
}

function getDownstream(clickedTowerIndex) {
    if (!networkData) return { towerSet: new Set(), lineSet: new Set() };

    const rootedMap = buildRootedChildrenMap(networkData.lines, 0);
    const childrenMap = rootedMap.visited.has(clickedTowerIndex)
        ? rootedMap.children
        : buildChildrenMap(networkData.lines);
    const towerSet = new Set([clickedTowerIndex]);
    const lineSet = new Set();
    const queue = [clickedTowerIndex];

    while (queue.length > 0) {
        const current = queue.shift();
        const children = childrenMap.get(current) || [];
        children.forEach(({ childTowerIndex, lineIndex }) => {
            if (!towerSet.has(childTowerIndex)) {
                towerSet.add(childTowerIndex);
                queue.push(childTowerIndex);
            }
            lineSet.add(lineIndex);
        });
    }

    return { towerSet, lineSet };
}

function getTransformerFeatureTowerIndex(feature, towerLookup = buildTowerIndexLookup(), depthMap = buildTowerDepthMap()) {
    if (!feature || !networkData?.towers?.length) return null;

    const connectionPoint = feature?.coords?.[0] || feature?.start || getFeatureCenter(feature);
    let towerIndex = findBestTowerIndexForKmlFeature(feature, towerLookup, depthMap);
    if (!Number.isInteger(towerIndex) && connectionPoint) {
        towerIndex = findNearestTowerIndexByPoint(connectionPoint);
    }

    return Number.isInteger(towerIndex) ? towerIndex : null;
}

function getTransformerTowerIndexSet(excludedTowerIndex = null) {
    const transformerTowers = new Set();
    if (!networkData?.towers?.length || !kmlOverlayData?.features?.length) return transformerTowers;

    const towerLookup = buildTowerIndexLookup();
    const depthMap = buildTowerDepthMap();

    kmlOverlayData.features.forEach((feature) => {
        if (!isTransformerFeature(feature)) return;
        const towerIndex = getTransformerFeatureTowerIndex(feature, towerLookup, depthMap);
        if (Number.isInteger(towerIndex) && towerIndex !== excludedTowerIndex) {
            transformerTowers.add(towerIndex);
        }
    });

    return transformerTowers;
}

function getTransformerContextsForTowerSet(towerSet = new Set()) {
    if (!towerSet.size || !kmlOverlayData?.features?.length) return [];

    const towerLookup = buildTowerIndexLookup();
    const depthMap = buildTowerDepthMap();
    const contexts = [];
    const seenFeatures = new Set();

    kmlOverlayData.features.forEach((feature) => {
        if (!isTransformerFeature(feature)) return;
        const towerIndex = getTransformerFeatureTowerIndex(feature, towerLookup, depthMap);
        if (!Number.isInteger(towerIndex) || !towerSet.has(towerIndex) || seenFeatures.has(feature.id)) {
            return;
        }
        seenFeatures.add(feature.id);
        contexts.push(buildKmlNetworkContext(feature));
    });

    return contexts;
}

function getDownstreamUntilNextTransformer(clickedTowerIndex, blockedTransformerTowers = new Set()) {
    if (!networkData) return { towerSet: new Set(), lineSet: new Set() };

    const childrenMap = buildChildrenMap(networkData.lines);
    const towerSet = new Set([clickedTowerIndex]);
    const lineSet = new Set();
    const queue = [clickedTowerIndex];

    while (queue.length > 0) {
        const current = queue.shift();
        const children = childrenMap.get(current) || [];
        children.forEach(({ childTowerIndex, lineIndex }) => {
            if (blockedTransformerTowers.has(childTowerIndex)) {
                return;
            }
            if (!towerSet.has(childTowerIndex)) {
                towerSet.add(childTowerIndex);
                queue.push(childTowerIndex);
            }
            lineSet.add(lineIndex);
        });
    }

    return { towerSet, lineSet };
}

function buildLineCutContext(lineIndex, options = {}) {
    if (!networkData?.lines?.[lineIndex]) return null;

    const line = networkData.lines[lineIndex];
    const cutTowerIndex = Number.isInteger(line.end_index) ? line.end_index : null;
    if (!Number.isInteger(cutTowerIndex) || !networkData.towers?.[cutTowerIndex]) return null;

    const downstream = getDownstream(cutTowerIndex);
    const affectedTowers = networkData.towers.filter((_, idx) => downstream.towerSet.has(idx)).map(cloneTower);
    const transformerContexts = getTransformerContextsForTowerSet(downstream.towerSet);
    const transformerKmlFeatureIds = transformerContexts.flatMap((context) => context.kmlFeatureIds || []);
    const mergedAffectedTowers = mergeAffectedTowers(
        affectedTowers,
        ...transformerContexts.map((context) => context.affectedTowers || [])
    );
    const matchedRows = mergeMatchedRows(
        getMatchedAccountRows(affectedTowers),
        ...transformerContexts.map((context) => context.matchedRows || [])
    );
    const lineIndexes = new Set([lineIndex, ...downstream.lineSet]);
    const clickedTower = cloneTower(networkData.towers[cutTowerIndex]);

    return {
        targetName: options.targetName || `Line Cut: ${line.start_name} -> ${line.end_name}`,
        clickedTower,
        clickedLineIndex: lineIndex,
        affectedTowers: mergedAffectedTowers,
        matchedRows,
        lineIndexes: [...lineIndexes],
        towerIndexes: [...downstream.towerSet],
        kmlFeatureIds: [...new Set([...(options.kmlFeatureIds || []), ...transformerKmlFeatureIds])],
        feature: options.feature ? cloneKmlFeature(options.feature) : null,
    };
}

function applyLineCutContext(context) {
    if (!context) return;

    currentContextType = "line";
    resetLineColors();
    applyNetworkLineHighlightState(context.lineIndexes || [], context.clickedLineIndex);
    applyTowerHighlightState(context.towerIndexes || []);

    currentPanelData = context;
    highlightAffectedKmlFeatures(currentPanelData);
    showSidePanel();
    renderCurrentContext();
}

function highlightDownstreamFromLine(lineIndex) {
    const context = buildLineCutContext(lineIndex);
    applyLineCutContext(context);
    void hydrateCurrentPanelMatches();
}

function highlightDownstreamFromTower(towerIndex) {
    if (!networkData) return;

    currentContextType = "tower";
    resetLineColors();
    highlightTowerMarkerIndices([towerIndex]);

    const downstream = getDownstream(towerIndex);
    const affectedTowers = networkData.towers.filter((_, idx) => downstream.towerSet.has(idx)).map(cloneTower);
    const transformerContexts = getTransformerContextsForTowerSet(downstream.towerSet);
    const transformerKmlFeatureIds = transformerContexts.flatMap((context) => context.kmlFeatureIds || []);
    const mergedAffectedTowers = mergeAffectedTowers(
        affectedTowers,
        ...transformerContexts.map((context) => context.affectedTowers || [])
    );
    const matchedRows = mergeMatchedRows(
        getMatchedAccountRows(affectedTowers),
        ...transformerContexts.map((context) => context.matchedRows || [])
    );

    applyNetworkLineHighlightState([...downstream.lineSet], null);

    const clickedTower = networkData.towers[towerIndex];
    currentPanelData = {
        targetName: `Tower: ${clickedTower.name}`,
        clickedTower: cloneTower(clickedTower),
        clickedLineIndex: null,
        affectedTowers: mergedAffectedTowers,
        matchedRows,
        lineIndexes: [...downstream.lineSet],
        towerIndexes: [...downstream.towerSet],
        kmlFeatureIds: [...new Set(transformerKmlFeatureIds)],
        feature: null,
    };

    highlightAffectedKmlFeatures(currentPanelData);

    showSidePanel();
    renderCurrentContext();
    void hydrateCurrentPanelMatches();
}

function renderCurrentContext() {
    if (!currentPanelData) return;
    currentPanelData.audit = buildTraceAudit(currentPanelData);
    validationReports.audit = currentPanelData.audit.validation;
    renderTraceAudit(currentPanelData.audit);
    updateOperationalCounters(currentPanelData);
    renderPanel(currentPanelData);
}

async function runMapSearch() {
    const query = (mapSearchInput.value || "").trim().toUpperCase();
    if (!query) return;

    if (networkData && networkData.towers) {
        const towerIndex = networkData.towers.findIndex((tower) => String(tower.name || "").toUpperCase().includes(query));
        if (towerIndex >= 0) {
            const tower = networkData.towers[towerIndex];
            map.setView([tower.lat, tower.lon], 24);
            highlightDownstreamFromTower(towerIndex);
            return;
        }
    }

    const accountMatches = isServerBackedAccountData()
        ? await searchAccountRowsOnServer(query).catch(() => [])
        : getSearchAccountMatches(query);
    if (accountMatches.length) {
        applySearchResultContext(query, accountMatches);
        return;
    }

    if (kmlOverlayData && kmlOverlayData.features) {
        const feature = kmlOverlayData.features.find((item) => {
            const text = `${item.name || ""} ${item.description || ""}`.toUpperCase();
            return text.includes(query);
        });
        if (feature) {
            const center = getFeatureCenter(feature) || feature.start;
            if (center) {
                map.setView(center, 24);
            }
            if (isTransformerFeature(feature)) {
                selectTransformerFeature(feature);
            } else {
                selectKmlLineFeature(feature);
            }
            return;
        }
    }

    alert(`No tower, Pol ID, or account number found for: ${query}`);
}

function getSearchAccountMatches(query) {
    if (!accountData?.records?.length) return [];
    const normalizedQuery = normalizeId(query);
    const exactAccount = String(query || "").trim().toUpperCase();
    const seen = new Set();
    const results = [];

    function pushSearchMatch(recordIndex, matchedViaOverride = "") {
        const record = accountData.records?.[recordIndex];
        if (!record) return false;
        const uniqueKey = `${record.pol_id || ""}|||${record.account_number || ""}|||${record.frombus_id || ""}|||${record.tobus_id || ""}`;
        if (seen.has(uniqueKey)) return false;
        seen.add(uniqueKey);
        results.push({
            matched_tower: "",
            frombus_id: record.frombus_id || "",
            tobus_id: record.tobus_id || "",
            pol_id: record.pol_id || "",
            account_number: record.account_number || "",
            consumer_name: record.consumer_name || "",
            consumer_type: record.consumer_type || "",
            address: record.address || "",
            serial: record.serial || "",
            brand: record.brand || "",
            kwhr: record.kwhr || 0,
            matched_via: matchedViaOverride || determineSearchMatchedVia(record, query),
            extra_fields: { ...(record.extra_fields || record.all_fields || {}) },
        });
        return true;
    }

    if (accountLookupIndex && exactAccount) {
        (accountLookupIndex.get(exactAccount) || []).forEach((recordIndex) => {
            pushSearchMatch(recordIndex, "Account Number");
        });
    }
    if (accountLookupIndex && normalizedQuery && normalizedQuery !== exactAccount) {
        (accountLookupIndex.get(normalizedQuery) || []).forEach((recordIndex) => {
            pushSearchMatch(recordIndex, "Pol ID");
        });
    }

    (accountSearchRowsIndex || []).forEach(([recordIndex, accountNumber, polNorm, fromNorm, toNorm]) => {
        if ((exactAccount && accountNumber.includes(exactAccount)) || [polNorm, fromNorm, toNorm].some((value) => normalizedQuery && value && value.includes(normalizedQuery))) {
            pushSearchMatch(recordIndex);
        }
    });

    return results;
}

function determineSearchMatchedVia(record, query) {
    const exactAccount = String(query || "").trim().toUpperCase();
    if (String(record.account_number || "").trim().toUpperCase().includes(exactAccount)) {
        return "Account Number";
    }
    const normalizedQuery = normalizeId(query);
    if (normalizeId(record.pol_id || "").includes(normalizedQuery)) {
        return "Pol ID";
    }
    return "Tower";
}

function getTowerIndexesForSearchRows(rows = []) {
    if (!networkData?.towers?.length) return [];
    const normalizedTowerMap = new Map(
        networkData.towers.map((tower, index) => [normalizeId(tower.name), index])
    );
    const indexes = new Set();

    rows.forEach((row) => {
        [row.pol_id, row.frombus_id, row.tobus_id, row.matched_tower].forEach((value) => {
            const normalized = normalizeId(value || "");
            if (normalizedTowerMap.has(normalized)) {
                indexes.add(normalizedTowerMap.get(normalized));
            }
        });
    });

    return [...indexes];
}

function applySearchResultContext(query, matchedRows) {
    resetLineColors();

    const towerIndexes = getTowerIndexesForSearchRows(matchedRows);
    const affectedTowers = towerIndexes.map((towerIndex) => cloneTower(networkData.towers[towerIndex]));
    matchedRows = matchedRows.map((row) => {
        if (row.matched_tower) return row;
        const matchedTower = [row.pol_id, row.frombus_id, row.tobus_id]
            .map((value) => normalizeId(value || ""))
            .find((value) => towerIndexes.some((towerIndex) => normalizeId(networkData.towers[towerIndex].name) === value));
        return {
            ...row,
            matched_tower: matchedTower || row.matched_tower || "-",
        };
    });

    highlightTowerMarkerIndices(towerIndexes);
    applyNetworkLineHighlightState([], null);
    clearKmlHighlight();

    const bounds = towerIndexes
        .map((towerIndex) => networkData.towers[towerIndex])
        .filter(Boolean)
        .map((tower) => [tower.lat, tower.lon]);
    if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [24, 24] });
    } else if (bounds.length === 1) {
        map.setView(bounds[0], 24);
    }

    currentContextType = "search";
    currentPanelData = {
        targetName: `Search Result: ${query}`,
        clickedTower: towerIndexes.length === 1 ? cloneTower(networkData.towers[towerIndexes[0]]) : null,
        clickedLineIndex: null,
        affectedTowers,
        matchedRows: matchedRows.map(cloneMatchedRow),
        lineIndexes: [],
        towerIndexes,
        kmlFeatureIds: [],
        feature: null,
    };

    showSidePanel();
    renderCurrentContext();
}

function getPointDistanceSq(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return Number.POSITIVE_INFINITY;
    const latDiff = Number(a[0]) - Number(b[0]);
    const lonDiff = Number(a[1]) - Number(b[1]);
    return latDiff * latDiff + lonDiff * lonDiff;
}

function pointToSegmentDistanceSq(point, start, end) {
    if (!point || !start || !end) return Number.POSITIVE_INFINITY;
    const px = Number(point[0]);
    const py = Number(point[1]);
    const x1 = Number(start[0]);
    const y1 = Number(start[1]);
    const x2 = Number(end[0]);
    const y2 = Number(end[1]);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;

    if (!lengthSq) {
        return getPointDistanceSq(point, start);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const diffX = px - projX;
    const diffY = py - projY;
    return diffX * diffX + diffY * diffY;
}

function getFeatureSampleCoords(feature) {
    const coords = feature?.coords || [];
    if (coords.length <= 12) return coords;

    const sample = [];
    const step = Math.max(1, Math.floor(coords.length / 12));
    for (let idx = 0; idx < coords.length; idx += step) {
        sample.push(coords[idx]);
    }
    const last = coords[coords.length - 1];
    if (sample[sample.length - 1] !== last) {
        sample.push(last);
    }
    return sample;
}

function extractTowerTokensFromText(text) {
    if (!text) return [];
    const matches = String(text).toUpperCase().match(/\b(?:TAL|ALG|MNZ|SDO)\d+(?:-\d+)?\b/g) || [];
    const tokens = [];
    const seen = new Set();
    matches.forEach((value) => {
        const normalized = normalizeId(value);
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        tokens.push(normalized);
    });
    return tokens;
}

function getKmlFeatureTowerTokens(feature) {
    return extractTowerTokensFromText(`${feature?.name || ""} ${feature?.description || ""}`);
}

function buildTowerIndexLookup() {
    const lookup = new Map();
    (networkData?.towers || []).forEach((tower, towerIndex) => {
        const normalized = normalizeId(tower.name);
        if (normalized && !lookup.has(normalized)) {
            lookup.set(normalized, towerIndex);
        }
    });
    return lookup;
}

function buildTowerDepthMap() {
    const depthMap = new Map();
    if (!networkData?.lines?.length) return depthMap;

    const childrenMap = buildChildrenMap(networkData.lines);
    const queue = [{ towerIndex: 0, depth: 0 }];

    while (queue.length) {
        const { towerIndex, depth } = queue.shift();
        if (depthMap.has(towerIndex)) continue;
        depthMap.set(towerIndex, depth);
        (childrenMap.get(towerIndex) || []).forEach(({ childTowerIndex }) => {
            queue.push({ towerIndex: childTowerIndex, depth: depth + 1 });
        });
    }

    return depthMap;
}

function findNearestTowerIndexByPoint(point) {
    if (!point || !networkData?.towers?.length) return null;

    let best = null;
    networkData.towers.forEach((tower, towerIndex) => {
        const score = getPointDistanceSq(point, [tower.lat, tower.lon]);
        if (!best || score < best.score) {
            best = { towerIndex, score };
        }
    });

    return best && best.score < 0.00002 ? best.towerIndex : null;
}

function findBestTowerIndexForKmlFeature(feature, towerLookup, depthMap) {
    const tokenMatches = getKmlFeatureTowerTokens(feature)
        .map((token) => towerLookup.get(token))
        .filter((value) => Number.isInteger(value));

    if (tokenMatches.length) {
        return tokenMatches.reduce((best, candidate) => {
            const bestDepth = depthMap.get(best) ?? -1;
            const candidateDepth = depthMap.get(candidate) ?? -1;
            return candidateDepth > bestDepth ? candidate : best;
        }, tokenMatches[0]);
    }

    const center = getFeatureCenter(feature);
    if (!center || !networkData?.towers?.length) return null;

    let best = null;
    networkData.towers.forEach((tower, towerIndex) => {
        const score = getPointDistanceSq(center, [tower.lat, tower.lon]);
        if (!best || score < best.score) {
            best = { towerIndex, score };
        }
    });

    return best && best.score < 0.00008 ? best.towerIndex : null;
}

function makeKmlEndpointKey(coord) {
    if (!coord || coord.length < 2) return "";
    return `${Number(coord[0]).toFixed(7)}|${Number(coord[1]).toFixed(7)}`;
}

function getVectorFromEndpoint(feature, endpointKey) {
    const start = feature.start || feature.coords?.[0];
    const end = feature.end || feature.coords?.[feature.coords.length - 1];
    const startKey = makeKmlEndpointKey(start);
    const endKey = makeKmlEndpointKey(end);
    if (!start || !end) return null;
    if (endpointKey === startKey) {
        return [Number(end[0]) - Number(start[0]), Number(end[1]) - Number(start[1])];
    }
    if (endpointKey === endKey) {
        return [Number(start[0]) - Number(end[0]), Number(start[1]) - Number(end[1])];
    }
    return null;
}

function vectorSimilarity(a, b) {
    if (!a || !b) return -1;
    const magA = Math.hypot(a[0], a[1]);
    const magB = Math.hypot(b[0], b[1]);
    if (!magA || !magB) return -1;
    return Math.abs(((a[0] * b[0]) + (a[1] * b[1])) / (magA * magB));
}

function getTransformerBaseName(featureName) {
    return normalizeTransformerLabel(featureName);
}

function getDistanceSqToSubstation(coord) {
    if (!coord || coord.length < 2) return Number.POSITIVE_INFINITY;
    return getPointDistanceSq(coord, talaveraSubstationCenter);
}

function getFeaturePhaseGroup(feature) {
    const text = String(feature?.style_url || feature?.resolved_style_url || "").toUpperCase();
    const match = text.match(/PHASE([A-Z]+)/);
    return match ? match[1] : "";
}

function isCompatiblePrimaryPhase(feature, phaseGroup) {
    if (!feature || isTransformerFeature(feature) || isSecondaryKmlFeature(feature)) return false;
    const featurePhase = getFeaturePhaseGroup(feature);
    if (!phaseGroup || !featurePhase) return false;
    return featurePhase === phaseGroup;
}

function collectConnectedPrimaryBranch(startFeature, sharedEndpointKey, phaseGroup, endpointMap) {
    const visitedFeatures = new Set();
    const visitedEndpoints = new Set([sharedEndpointKey].filter(Boolean));
    const farKeys = [
        makeKmlEndpointKey(startFeature.start || startFeature.coords?.[0]),
        makeKmlEndpointKey(startFeature.end || startFeature.coords?.[startFeature.coords.length - 1]),
    ].filter((key) => key && key !== sharedEndpointKey);
    const queue = [...farKeys];
    visitedFeatures.add(startFeature.id);

    while (queue.length) {
        const endpointKey = queue.shift();
        if (!endpointKey || visitedEndpoints.has(endpointKey)) continue;
        visitedEndpoints.add(endpointKey);

        const connectedEntries = endpointMap.get(endpointKey) || [];
        connectedEntries.forEach(({ feature: item }) => {
            if (visitedFeatures.has(item.id) || !isCompatiblePrimaryPhase(item, phaseGroup)) return;
            visitedFeatures.add(item.id);
            [
                makeKmlEndpointKey(item.start || item.coords?.[0]),
                makeKmlEndpointKey(item.end || item.coords?.[item.coords.length - 1]),
            ].filter(Boolean).forEach((key) => {
                if (!visitedEndpoints.has(key)) queue.push(key);
            });
        });
    }

    return [...visitedFeatures];
}

function getPrimaryPolePointFeaturesFromTransformer(feature) {
    if (!feature?.coords?.length || !kmlOverlayData?.features?.length) return [];

    const secondarySource = getRelatedSecondarySourceFeature(feature);
    if (!secondarySource?.coords?.length) return [];

    const transformerKeys = [
        makeKmlEndpointKey(feature.start || feature.coords[0]),
        makeKmlEndpointKey(feature.end || feature.coords[feature.coords.length - 1]),
    ].filter(Boolean);
    const secondaryKeys = [
        makeKmlEndpointKey(secondarySource.start || secondarySource.coords[0]),
        makeKmlEndpointKey(secondarySource.end || secondarySource.coords[secondarySource.coords.length - 1]),
    ].filter(Boolean);
    const sharedSecondaryKey = transformerKeys.find((key) => secondaryKeys.includes(key));
    const primarySharedKey = transformerKeys.find((key) => key !== sharedSecondaryKey);
    if (!primarySharedKey) return [];

    const phaseGroup = getFeaturePhaseGroup(feature);
    const endpointMap = getKmlEndpointMap();
    const sharedCoord = (feature.coords || []).find((coord) => makeKmlEndpointKey(coord) === primarySharedKey) || feature.coords?.[0] || null;
    const sharedDistance = getDistanceSqToSubstation(sharedCoord);
    let candidates = (endpointMap.get(primarySharedKey) || [])
        .map(({ feature: item }) => item)
        .filter((item) => item.id !== feature.id && isCompatiblePrimaryPhase(item, phaseGroup));

    if (!candidates.length) return [];

    const outwardCandidates = candidates.filter((candidate) => {
        const candidateKeys = [
            makeKmlEndpointKey(candidate.start || candidate.coords?.[0]),
            makeKmlEndpointKey(candidate.end || candidate.coords?.[candidate.coords.length - 1]),
        ].filter(Boolean);
        const farCoord = candidateKeys[0] === primarySharedKey
            ? (candidate.end || candidate.coords?.[candidate.coords.length - 1])
            : (candidate.start || candidate.coords?.[0]);
        return getDistanceSqToSubstation(farCoord) > sharedDistance;
    });
    if (outwardCandidates.length) {
        candidates = outwardCandidates;
    }

    let bestBranchIds = [];
    candidates.forEach((candidate) => {
        const branchIds = collectConnectedPrimaryBranch(candidate, primarySharedKey, phaseGroup, endpointMap);
        if (branchIds.length > bestBranchIds.length) {
            bestBranchIds = branchIds;
        }
    });

    if (!bestBranchIds.length) return [];
    const branchFeatures = (kmlOverlayData.features || []).filter((item) => bestBranchIds.includes(item.id));
    return getNearbyPolePointFeatures(branchFeatures);
}

function buildAccountLookupIndex(data) {
    if (!data?.records?.length) return null;

    const lookup = new Map();
    data.records.forEach((record, recordIndex) => {
        const values = new Set();
        [record.pol_id, record.account_number, record.frombus_id, record.tobus_id].forEach((value) => {
            const raw = String(value || "").trim().toUpperCase();
            if (raw) {
                values.add(raw);
                const normalized = normalizeId(raw);
                if (normalized) {
                    values.add(normalized);
                }
            }
        });

        Object.values(record.extra_fields || record.all_fields || {}).forEach((value) => {
            const raw = String(value || "").trim().toUpperCase();
            if (raw) {
                values.add(raw);
                const normalized = normalizeId(raw);
                if (normalized) {
                    values.add(normalized);
                }
            }
        });

        values.forEach((value) => {
            if (!lookup.has(value)) {
                lookup.set(value, []);
            }
            lookup.get(value).push(recordIndex);
        });
    });

    return lookup;
}

function buildAccountSearchRowsIndex(data) {
    if (!data?.records?.length) return null;
    return data.records.map((record, recordIndex) => ([
        recordIndex,
        String(record.account_number || "").trim().toUpperCase(),
        normalizeId(record.pol_id || ""),
        normalizeId(record.frombus_id || ""),
        normalizeId(record.tobus_id || ""),
    ]));
}

function buildTowerMappingFromRecords(records = []) {
    const towerMapping = {};

    records.forEach((record) => {
        const mappingEntry = {
            frombus_id: record.frombus_id || "",
            tobus_id: record.tobus_id || "",
            pol_id: record.pol_id || "",
            account_number: record.account_number || "",
            consumer_name: record.consumer_name || "",
            consumer_type: record.consumer_type || "",
            address: record.address || "",
            serial: record.serial || "",
            brand: record.brand || "",
            kwhr: record.kwhr || 0,
            frombus_norm: normalizeId(record.frombus_id || ""),
            tobus_norm: normalizeId(record.tobus_id || ""),
            pol_norm: normalizeId(record.pol_id || ""),
            extra_fields: { ...(record.extra_fields || record.all_fields || {}) },
        };

        [mappingEntry.pol_norm, mappingEntry.frombus_norm, mappingEntry.tobus_norm].forEach((mappingKey) => {
            if (!mappingKey) return;
            if (!towerMapping[mappingKey]) {
                towerMapping[mappingKey] = [];
            }
            towerMapping[mappingKey].push(mappingEntry);
        });
    });

    return towerMapping;
}

function rebuildRestoredAccountData(data) {
    if (!data || typeof data !== "object") return null;
    const serverBacked = Boolean(data.serverBacked);
    const normalizedRecords = Array.isArray(data.records) ? data.records.map((record) => ({
        ...record,
        extra_fields: { ...(record.extra_fields || record.all_fields || {}) },
    })) : [];

    return {
        ...data,
        records: normalizedRecords,
        serverBacked,
        tower_mapping: serverBacked ? null : (data.tower_mapping || buildTowerMappingFromRecords(normalizedRecords)),
    };
}

function isServerBackedAccountData() {
    return Boolean(accountData?.serverBacked);
}

async function fetchMatchedRowsForSelection(affectedTowers = [], kmlFeatureIds = []) {
    const requestKey = JSON.stringify({
        towers: [...new Set((affectedTowers || []).map((tower) => tower?.name).filter(Boolean))].sort(),
        kml: [...new Set((kmlFeatureIds || []).filter(Boolean))].sort(),
    });
    if (accountMatchRequestCache.has(requestKey)) {
        return accountMatchRequestCache.get(requestKey).map(cloneMatchedRow);
    }
    const response = await fetchWithTimeout("/account_mapping/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            tower_names: (affectedTowers || []).map((tower) => tower?.name).filter(Boolean),
            kml_feature_ids: [...new Set((kmlFeatureIds || []).filter(Boolean))],
        }),
    });
    const data = await readApiJson(response, "Failed to load matched account rows.");
    if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to load matched account rows.");
    }
    const matchedRows = (data.matched_rows || []).map(cloneMatchedRow);
    setLimitedRowCacheEntry(accountMatchRequestCache, requestKey, matchedRows, ACCOUNT_MATCH_REQUEST_CACHE_LIMIT);
    return matchedRows;
}

async function hydrateCurrentPanelMatches() {
    if (!currentPanelData || !isServerBackedAccountData()) {
        return;
    }
    const targetRef = currentPanelData;
    try {
        const matchedRows = await fetchMatchedRowsForSelection(targetRef.affectedTowers || [], targetRef.kmlFeatureIds || []);
        if (currentPanelData !== targetRef) {
            return;
        }
        currentPanelData.matchedRows = matchedRows;
        renderCurrentContext();
    } catch (error) {
        console.error("Failed to fetch account matches:", error);
    }
}

async function searchAccountRowsOnServer(query) {
    const requestKey = String(query || "").trim().toUpperCase();
    if (accountSearchRequestCache.has(requestKey)) {
        return accountSearchRequestCache.get(requestKey).map(cloneMatchedRow);
    }
    const response = await fetchWithTimeout("/account_mapping/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
    });
    const data = await readApiJson(response, "Failed to search account mapping.");
    if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to search account mapping.");
    }
    const matchedRows = (data.matched_rows || []).map(cloneMatchedRow);
    setLimitedRowCacheEntry(accountSearchRequestCache, requestKey, matchedRows, ACCOUNT_SEARCH_REQUEST_CACHE_LIMIT);
    return matchedRows;
}

function getKmlLookupTokens(feature) {
    const tokens = new Set();
    const rawName = String(feature?.name || "").trim();
    const upperName = rawName.toUpperCase();
    const variants = [
        upperName,
        upperName.replace(/^DX_/, ""),
        upperName.replace(/UBDATA$/i, ""),
        upperName.replace(/^DX_/, "").replace(/UBDATA$/i, ""),
        String(feature?.description || "").trim().toUpperCase()
    ].filter(Boolean);

    variants.forEach((value) => {
        const trimmed = String(value).trim().toUpperCase();
        if (trimmed) {
            tokens.add(trimmed);
        }
        const normalized = normalizeId(trimmed);
        if (normalized) {
            tokens.add(normalized);
        }
    });

    getKmlFeatureTowerTokens(feature).forEach((token) => tokens.add(token));
    return [...tokens];
}

function getMatchedAccountRowsForKmlFeatures(features = []) {
    if (!accountData?.records?.length || !accountLookupIndex) return [];

    const tokenToFeature = new Map();
    features.forEach((feature) => {
        getKmlLookupTokens(feature).forEach((token) => {
            if (token && !tokenToFeature.has(token)) {
                tokenToFeature.set(token, feature.name || token);
            }
        });
    });

    if (!tokenToFeature.size) return [];

    const recordMatches = new Map();
    tokenToFeature.forEach((featureName, token) => {
        const indexes = accountLookupIndex.get(token) || [];
        indexes.forEach((recordIndex) => {
            if (!recordMatches.has(recordIndex)) {
                recordMatches.set(recordIndex, featureName);
            }
        });
    });

    const matchedRows = [];
    const seen = new Set();
    recordMatches.forEach((featureName, recordIndex) => {
        const record = accountData.records[recordIndex];
        if (!record) return;
        const uniqueKey = `${record.pol_id}|||${record.account_number}|||${record.frombus_id}|||${record.tobus_id}`;
        if (seen.has(uniqueKey)) return;
        seen.add(uniqueKey);
        matchedRows.push({
            matched_tower: featureName,
            frombus_id: record.frombus_id || "",
            tobus_id: record.tobus_id || "",
            pol_id: record.pol_id || "",
            account_number: record.account_number || "",
            consumer_name: record.consumer_name || "",
            consumer_type: record.consumer_type || "",
            address: record.address || "",
            serial: record.serial || "",
            brand: record.brand || "",
            kwhr: record.kwhr || 0,
            matched_via: "KML",
            extra_fields: { ...(record.extra_fields || record.all_fields || {}) }
        });
    });

    return matchedRows;
}

function getMatchedAccountRowsForKmlAccounts(features = []) {
    if (!accountData?.records?.length || !accountLookupIndex) return [];

    const accountToFeature = new Map();
    features.forEach((feature) => {
        const text = `${feature?.name || ""} ${feature?.description || ""}`.toUpperCase();
        const matches = text.match(/\b\d{2}-\d{4}-\d{4}\b/g) || [];
        matches.forEach((accountNumber) => {
            if (!accountToFeature.has(accountNumber)) {
                accountToFeature.set(accountNumber, feature.name || accountNumber);
            }
        });
    });

    if (!accountToFeature.size) return [];

    const matchedRows = [];
    const seen = new Set();
    accountToFeature.forEach((featureName, accountNumber) => {
        const indexes = accountLookupIndex.get(accountNumber) || [];
        indexes.forEach((recordIndex) => {
            const record = accountData.records[recordIndex];
            if (!record) return;
            if (String(record.account_number || "").trim().toUpperCase() !== accountNumber) return;
            const uniqueKey = `${record.pol_id}|||${record.account_number}|||${record.frombus_id}|||${record.tobus_id}`;
            if (seen.has(uniqueKey)) return;
            seen.add(uniqueKey);
            matchedRows.push({
                matched_tower: featureName,
                frombus_id: record.frombus_id || "",
                tobus_id: record.tobus_id || "",
                pol_id: record.pol_id || "",
                account_number: record.account_number || "",
                consumer_name: record.consumer_name || "",
                consumer_type: record.consumer_type || "",
                address: record.address || "",
                serial: record.serial || "",
                brand: record.brand || "",
                kwhr: record.kwhr || 0,
                matched_via: "KML",
                extra_fields: { ...(record.extra_fields || record.all_fields || {}) }
            });
        });
    });

    return matchedRows;
}

function mergeMatchedRows(...groups) {
    const merged = [];
    const seen = new Set();
    groups.flat().forEach((row) => {
        if (!row) return;
        const key = `${row.pol_id || ""}|||${row.account_number || ""}|||${row.frombus_id || ""}|||${row.tobus_id || ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(cloneMatchedRow(row));
    });
    return merged;
}

function getGpxDataForTransformer(feature) {
    if (!networkData?.towers?.length) {
        return { affectedTowers: [], matchedRows: [], towerIndexes: [], lineIndexes: [] };
    }

    const towerLookup = buildTowerIndexLookup();
    const depthMap = buildTowerDepthMap();
    let towerIndex = findBestTowerIndexForKmlFeature(feature, towerLookup, depthMap);
    if (!Number.isInteger(towerIndex)) {
        const connectionPoint = feature?.start || feature?.coords?.[0] || getFeatureCenter(feature);
        if (connectionPoint) {
            towerIndex = findNearestTowerIndexByPoint(connectionPoint);
        }
    }
    if (!Number.isInteger(towerIndex) || !networkData.towers?.[towerIndex]) {
        return { affectedTowers: [], matchedRows: [], towerIndexes: [], lineIndexes: [] };
    }

    const downstream = getDownstream(towerIndex);
    const affectedTowers = networkData.towers.filter((_, idx) => downstream.towerSet.has(idx)).map(cloneTower);
    return {
        affectedTowers,
        matchedRows: getMatchedAccountRows(affectedTowers),
        towerIndexes: [...downstream.towerSet],
        lineIndexes: [...downstream.lineSet],
    };
}

function isPolePointFeature(feature) {
    if (!feature || feature.geometry !== "point") return false;
    const styleText = String(feature.style_url || feature.resolved_style_url || "").toUpperCase();
    const nameText = String(feature.name || "").toUpperCase();
    return styleText.includes("PRIPOLE") || /\b(?:SDO|TAL|ALG|MNZ|QZN|LPO|GBA)\d+(?:-UB|-OS)?\b/.test(nameText);
}

function getNearbyPolePointFeatures(lineFeatures = []) {
    if (!kmlOverlayData?.features?.length || !lineFeatures.length) return [];

    const endpointKeys = new Set();
    lineFeatures.forEach((feature) => {
        (feature.coords || []).forEach((coord) => {
            const key = makeKmlEndpointKey(coord);
            if (key) endpointKeys.add(key);
        });
    });

    const nearby = [];
    const seen = new Set();
    (kmlOverlayData.features || []).forEach((feature) => {
        if (!isPolePointFeature(feature)) return;
        const point = feature.coords?.[0];
        const key = makeKmlEndpointKey(point);
        if (!key || !endpointKeys.has(key) || seen.has(feature.id)) return;
        seen.add(feature.id);
        nearby.push(feature);
    });
    return nearby;
}

function buildAffectedTowersFromKmlFeatures(features = []) {
    const names = new Set();
    const towers = [];

    features.forEach((feature) => {
        getKmlLookupTokens(feature).forEach((token) => {
            const normalized = normalizeId(token);
            if (!normalized || names.has(normalized)) return;
            names.add(normalized);
            const tower = (networkData?.towers || []).find((item) => normalizeId(item.name) === normalized);
            if (tower) {
                towers.push(cloneTower(tower));
            } else {
                towers.push({ name: normalized, code: "", lat: null, lon: null, index: null });
            }
        });
    });

    return towers;
}

function mergeAffectedTowers(...groups) {
    const merged = [];
    const seen = new Set();
    groups.flat().forEach((tower) => {
        if (!tower) return;
        const key = normalizeId(tower.name) || String(tower.name || "").trim().toUpperCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(cloneTower(tower));
    });
    return merged;
}

function buildAffectedEntriesFromMatchedRows(matchedRows = []) {
    const seen = new Set();
    return matchedRows.reduce((items, row) => {
        const label = row.pol_id || row.frombus_id || row.tobus_id || row.account_number;
        if (!label || seen.has(label)) {
            return items;
        }
        seen.add(label);
        items.push({ name: label, code: "", lat: null, lon: null, index: null });
        return items;
    }, []);
}

function isSecondaryKmlFeature(feature) {
    const styleText = String(feature?.style_url || feature?.resolved_style_url || "").toUpperCase();
    const nameText = String(feature?.name || "").toUpperCase();
    return styleText.includes("SDLINE") || nameText.includes("UBDATA");
}

function isLineKmlFeature(feature) {
    return feature?.geometry === "linestring" && Array.isArray(feature?.coords) && feature.coords.length >= 2;
}

function getTransformerEndpointKeys(feature) {
    if (!feature?.coords?.length) return [];
    return [
        makeKmlEndpointKey(feature.start || feature.coords[0]),
        makeKmlEndpointKey(feature.end || feature.coords[feature.coords.length - 1])
    ].filter(Boolean);
}

function getRelatedSecondarySourceFeature(feature) {
    if (!feature?.coords?.length || !kmlOverlayData?.features?.length) return null;

    const transformerKeys = new Set(getTransformerEndpointKeys(feature));
    const baseName = getTransformerBaseName(feature.name || "");
    const compactBaseName = baseName.replace(/[^A-Z0-9]/g, "");

    const candidates = (kmlOverlayData.features || []).filter((item) => {
        if (!item || item.id === feature.id || !isLineKmlFeature(item) || !isSecondaryKmlFeature(item)) {
            return false;
        }

        const itemKeys = getTransformerEndpointKeys(item);
        if (!itemKeys.some((key) => transformerKeys.has(key))) {
            return false;
        }

        const itemName = String(item.name || "").trim().toUpperCase();
        const compactName = itemName.replace(/[^A-Z0-9]/g, "");
        return compactName.includes(compactBaseName) || itemName.includes("UBDATA");
    });

    if (candidates.length) {
        const exact = candidates.find((item) => String(item.name || "").toUpperCase().includes("UBDATA"));
        return exact || candidates[0];
    }

    const fallback = (kmlOverlayData.features || []).filter((item) => {
        if (!item || item.id === feature.id || !isLineKmlFeature(item) || !isSecondaryKmlFeature(item)) {
            return false;
        }
        return getTransformerEndpointKeys(item).some((key) => transformerKeys.has(key));
    });

    const fallbackUbd = fallback.find((item) => String(item.name || "").toUpperCase().includes("UBDATA"));
    return fallbackUbd || fallback[0] || null;
}

function getKmlEndpointMap() {
    if (kmlEndpointMapCache) {
        return kmlEndpointMapCache;
    }

    const endpointMap = new Map();
    (kmlOverlayData?.features || []).forEach((item, index) => {
        if (!isLineKmlFeature(item)) return;
        const keyedItem = { feature: item, index };
        const keys = [
            makeKmlEndpointKey(item.start || item.coords[0]),
            makeKmlEndpointKey(item.end || item.coords[item.coords.length - 1])
        ].filter(Boolean);
        keys.forEach((key) => {
            if (!endpointMap.has(key)) {
                endpointMap.set(key, []);
            }
            endpointMap.get(key).push(keyedItem);
        });
    });
    kmlEndpointMapCache = endpointMap;
    return endpointMap;
}

function getConnectedKmlFeatureIdsFromTransformer(feature) {
    if (!feature?.coords?.length || !kmlOverlayData?.features?.length) {
        return feature?.id ? [feature.id] : [];
    }

    const endpointMap = getKmlEndpointMap();
    const transformerEndpointKeys = new Set(getTransformerEndpointKeys(feature));
    const secondarySource = getRelatedSecondarySourceFeature(feature);
    const seedFeatures = [];

    if (secondarySource?.id) {
        seedFeatures.push(secondarySource);
    }

    transformerEndpointKeys.forEach((endpointKey) => {
        const connectedEntries = endpointMap.get(endpointKey) || [];
        connectedEntries.forEach(({ feature: item }) => {
            if (!item || item.id === feature.id || !isSecondaryKmlFeature(item)) {
                return;
            }
            if (!seedFeatures.some((seed) => seed.id === item.id)) {
                seedFeatures.push(item);
            }
        });
    });

    if (!seedFeatures.length) {
        return [feature.id];
    }

    const visitedFeatures = new Set([feature.id]);
    const visitedEndpoints = new Set();
    const queue = [];

    seedFeatures.forEach((item) => {
        visitedFeatures.add(item.id);
        getTransformerEndpointKeys(item).forEach((endpointKey) => {
            if (!transformerEndpointKeys.has(endpointKey)) {
                queue.push(endpointKey);
            }
        });
    });

    while (queue.length) {
        const endpointKey = queue.shift();
        if (!endpointKey || visitedEndpoints.has(endpointKey)) {
            continue;
        }
        visitedEndpoints.add(endpointKey);

        const connectedEntries = endpointMap.get(endpointKey) || [];
        connectedEntries.forEach(({ feature: item }) => {
            if (visitedFeatures.has(item.id)) {
                return;
            }
            if (isTransformerFeature(item) || !isSecondaryKmlFeature(item)) {
                return;
            }

            visitedFeatures.add(item.id);
            getTransformerEndpointKeys(item).forEach((key) => {
                if (!visitedEndpoints.has(key)) {
                    queue.push(key);
                }
            });
        });
    }

    return [...visitedFeatures];
}

function findMatchingNetworkLineForKmlFeature(feature, towerLookup = buildTowerIndexLookup()) {
    if (!networkData || !feature || !feature.coords || feature.coords.length < 2) return null;

    const tokenSet = new Set(getKmlFeatureTowerTokens(feature));
    const start = feature.coords[0];
    const end = feature.coords[feature.coords.length - 1];
    const samples = getFeatureSampleCoords(feature);
    let best = null;

    networkData.lines.forEach((line, lineIndex) => {
        const lineStart = line.coords[0];
        const lineEnd = line.coords[line.coords.length - 1];
        const direct = getPointDistanceSq(start, lineStart) + getPointDistanceSq(end, lineEnd);
        const reverse = getPointDistanceSq(start, lineEnd) + getPointDistanceSq(end, lineStart);
        const endpointScore = Math.min(direct, reverse);

        let shapeScore = Number.POSITIVE_INFINITY;
        samples.forEach((point) => {
            shapeScore = Math.min(shapeScore, pointToSegmentDistanceSq(point, lineStart, lineEnd));
        });

        const startToken = normalizeId(line.start_name);
        const endToken = normalizeId(line.end_name);
        const startMatched = tokenSet.has(startToken);
        const endMatched = tokenSet.has(endToken);

        let score = endpointScore + (shapeScore * 4);
        if (startMatched) score *= 0.35;
        if (endMatched) score *= 0.1;
        if (startMatched && endMatched) {
            score = Math.min(score, 0);
        }

        if (!best || score < best.score) {
            best = {
                lineIndex,
                score,
                reversed: reverse < direct,
                tokenMatched: startMatched || endMatched,
                matchedTowerIndex: endMatched
                    ? line.end_index
                    : (startMatched ? line.start_index : line.end_index),
            };
        }
    });

    if (!best) return null;
    if (best.tokenMatched) return best;
    return best.score < 0.00012 ? best : null;
}

function buildKmlNetworkContext(feature) {
    if (!feature) return null;

    const kmlFeatureIds = isTransformerFeature(feature)
        ? getConnectedKmlFeatureIdsFromTransformer(feature)
        : [feature.id];
    const connectedFeatures = (kmlOverlayData?.features || []).filter((item) => kmlFeatureIds.includes(item.id));
    const visibleAffectedTowers = buildAffectedTowersFromKmlFeatures(connectedFeatures);
    const connectedPoleFeatures = getNearbyPolePointFeatures(connectedFeatures);
    const poleAffectedTowers = buildAffectedTowersFromKmlFeatures(connectedPoleFeatures);
    const dataLookupTowers = poleAffectedTowers.length ? poleAffectedTowers : visibleAffectedTowers;
    const exactKmlRows = getMatchedAccountRowsForKmlAccounts(connectedFeatures);
    const matchedRows = exactKmlRows.length ? exactKmlRows : getMatchedAccountRows(dataLookupTowers);
    const affectedTowers = mergeAffectedTowers(visibleAffectedTowers, dataLookupTowers);
    const clickedTower = affectedTowers.find((tower) => tower && tower.lat !== null && tower.lon !== null) || null;

    return {
        matchedLineIndex: null,
        clickedTowerIndex: Number.isInteger(clickedTower?.index) ? clickedTower.index : null,
        clickedTower: clickedTower ? cloneTower(clickedTower) : null,
        affectedTowers,
        matchedRows,
        lineIndexes: [],
        towerIndexes: affectedTowers
            .map((tower) => tower.index)
            .filter((value) => Number.isInteger(value)),
        kmlFeatureIds,
    };
}

function enrichKmlFeaturesWithNetwork() {
    if (!kmlOverlayData?.features?.length) return;

    if ((currentContextType === "kml" || currentContextType === "transformer") && currentPanelData?.feature?.id) {
        const nextFeature = kmlOverlayData.features.find((item) => item.id === currentPanelData.feature.id);
        if (nextFeature) {
            currentPanelData = currentContextType === "transformer" ? buildKmlContext(nextFeature) : buildKmlInfoContext(nextFeature);
            renderCurrentContext();
        }
    }
}

function buildKmlInfoContext(feature) {
    return {
        feature,
        targetName: feature.name || "KML Feature",
        clickedTower: null,
        affectedTowers: [],
        matchedRows: [],
        lineIndexes: [],
        towerIndexes: [],
        kmlFeatureIds: [feature.id],
    };
}

function rebuildContextData(panelData, contextType) {
    if (!panelData) return null;
    if (contextType === "transformer" && panelData.feature) {
        return buildKmlContext(panelData.feature);
    }
    if (contextType === "line" && Number.isInteger(panelData.clickedLineIndex)) {
        return buildLineCutContext(panelData.clickedLineIndex, {
            targetName: panelData.targetName,
            kmlFeatureIds: [...(panelData.kmlFeatureIds || [])],
            feature: panelData.feature || null,
        });
    }
    if (contextType === "tower" && panelData.clickedTower) {
        const towerIndex = Number.isInteger(panelData.clickedTower.index)
            ? panelData.clickedTower.index
            : (networkData?.towers || []).findIndex((tower) => tower.name === panelData.clickedTower.name);
        if (towerIndex >= 0) {
            const downstream = getDownstream(towerIndex);
            const affectedTowers = networkData.towers.filter((_, idx) => downstream.towerSet.has(idx)).map(cloneTower);
            const transformerContexts = getTransformerContextsForTowerSet(downstream.towerSet);
            return {
                targetName: `Tower: ${networkData.towers[towerIndex].name}`,
                clickedTower: cloneTower(networkData.towers[towerIndex]),
                affectedTowers: mergeAffectedTowers(
                    affectedTowers,
                    ...transformerContexts.map((context) => context.affectedTowers || [])
                ),
                matchedRows: mergeMatchedRows(
                    getMatchedAccountRows(affectedTowers),
                    ...transformerContexts.map((context) => context.matchedRows || [])
                ),
                lineIndexes: [...downstream.lineSet],
                towerIndexes: [...downstream.towerSet],
                kmlFeatureIds: [...new Set(transformerContexts.flatMap((context) => context.kmlFeatureIds || []))],
            };
        }
    }
    return {
        ...panelData,
        affectedTowers: (panelData.affectedTowers || []).map(cloneTower),
        matchedRows: getMatchedAccountRows(panelData.affectedTowers || []),
        lineIndexes: [...(panelData.lineIndexes || [])],
        towerIndexes: [...(panelData.towerIndexes || [])],
        kmlFeatureIds: [...(panelData.kmlFeatureIds || [])],
        feature: panelData.feature ? cloneKmlFeature(panelData.feature) : null,
        clickedTower: panelData.clickedTower ? cloneTower(panelData.clickedTower) : null,
        clickedLineIndex: Number.isInteger(panelData.clickedLineIndex) ? panelData.clickedLineIndex : null,
    };
}

function buildKmlContext(feature) {
    const networkContext = isTransformerFeature(feature)
        ? buildKmlNetworkContext(feature)
        : null;
    let affectedTowers = [];
    let matchedRows = [];
    let lineIndexes = [];
    let towerIndexes = [];
    let clickedTower = null;
    let targetName = `Transformer: ${feature.name || "Feature"}`;

    if (networkContext) {
        lineIndexes = [...(networkContext.lineIndexes || [])];
        towerIndexes = [...(networkContext.towerIndexes || [])];
        affectedTowers = (networkContext.affectedTowers || []).map(cloneTower);
        matchedRows = (networkContext.matchedRows || []).map(cloneMatchedRow);
        clickedTower = networkContext.clickedTower ? cloneTower(networkContext.clickedTower) : null;

        lineIndexes.forEach((lineIndex) => {
            if (linePolylines[lineIndex]) {
                linePolylines[lineIndex].setStyle({ color: affectedLineColor, weight: 5 });
            }
        });
    }

    return {
        feature,
        targetName,
        clickedTower,
        affectedTowers,
        matchedRows,
        lineIndexes,
        towerIndexes,
        kmlFeatureIds: [...(networkContext?.kmlFeatureIds || [feature.id])],
    };
}

function selectKmlLineFeature(feature) {
    if (!feature) return;
    const matchedLine = findMatchingNetworkLineForKmlFeature(feature);
    if (matchedLine && Number.isInteger(matchedLine.lineIndex)) {
        const context = buildLineCutContext(matchedLine.lineIndex, {
            targetName: `Line Cut: ${feature.name || `${networkData?.lines?.[matchedLine.lineIndex]?.start_name || "Line"} -> ${networkData?.lines?.[matchedLine.lineIndex]?.end_name || ""}`}`,
            kmlFeatureIds: [feature.id],
            feature,
        });
        applyLineCutContext(context);
        return;
    }
    selectKmlInfoFeature(feature);
}
function selectKmlInfoFeature(feature) {
    currentContextType = "kml";
    resetLineColors();
    currentPanelData = buildKmlInfoContext(feature);
    highlightKmlFeature(feature.id);
    showSidePanel();
    renderCurrentContext();
    void hydrateCurrentPanelMatches();
}

function selectTransformerFeature(feature) {
    currentContextType = "transformer";
    resetLineColors();
    currentPanelData = buildKmlContext(feature);
    highlightAffectedKmlFeatures(currentPanelData);
    showSidePanel();
    renderCurrentContext();
    void hydrateCurrentPanelMatches();
}

function normalizeId(value) {
    if (!value) return "";
    let text = String(value).trim().toUpperCase();
    if (!text) return "";
    text = text.split(" ")[0];

    if (text.includes("-")) {
        const first = text.split("-", 1)[0];
        if (first.startsWith("TAL") || first.startsWith("ALG") || first.startsWith("MNZ")) {
            text = first;
        }
    }

    text = text.replace(/-\d+$/g, "");
    return text.trim();
}

function getMatchedAccountRows(affectedTowers) {
    if (!accountData || !accountData.tower_mapping) return [];

    const result = [];
    const seen = new Set();

    affectedTowers.forEach((tower) => {
        const normalizedTower = normalizeId(tower.name);
        const rows = accountData.tower_mapping[normalizedTower] || [];

        rows.forEach((row) => {
            const extraFields = row.extra_fields || row.all_fields || {};
            const key = `${normalizedTower}|||${row.pol_id || ""}|||${row.account_number || ""}|||${row.frombus_id || ""}|||${row.tobus_id || ""}`;
            if (seen.has(key)) return;
            seen.add(key);
            result.push({
                matched_tower: tower.name,
                frombus_id: row.frombus_id || "",
                tobus_id: row.tobus_id || "",
                pol_id: row.pol_id || "",
                account_number: row.account_number || "",
                consumer_name: row.consumer_name || "",
                consumer_type: row.consumer_type || "",
                address: row.address || "",
                serial: row.serial || "",
                brand: row.brand || "",
                kwhr: row.kwhr || 0,
                matched_via: normalizeId(row.pol_id || "") === normalizedTower ? "Pol ID" : "Tower",
                extra_fields: { ...extraFields }
            });
        });
    });

    return result;
}

function extractPoleId(value) {
    const match = String(value || "").toUpperCase().match(/\b(?:SDO|TAL|ALG|MNZ|QZN|LPO|GBA)\d+\b/);
    return match ? match[0] : "";
}

function getCanonicalAffectedPolIdEntries(towers = []) {
    const filtered = [];
    const seen = new Set();

    towers.forEach((tower) => {
        const poleId = extractPoleId(tower?.name);
        if (!poleId || seen.has(poleId)) return;
        seen.add(poleId);
        filtered.push({
            ...cloneTower(tower),
            name: poleId,
        });
    });

    return filtered;
}

function getSidePanelAffectedPoleEntries(towers = []) {
    return getCanonicalAffectedPolIdEntries(towers);
}

function formatPhpCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "PHP 0.00";
    return `PHP ${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSidePanelInterruptionWindow() {
    const active = getActiveInterruption();
    if (active) {
        return {
            start: `${active.startDate || "-"} ${active.startTime || "-"}`.trim(),
            end: `${active.endDate || "-"} ${active.endTime || "-"}`.trim(),
            startDate: active.startDate || "",
            startTime: active.startTime || "",
            endDate: active.endDate || "",
            endTime: active.endTime || "",
        };
    }

    const startDate = interruptionStartDateInput?.value || "-";
    const startTime = interruptionStartTimeInput?.value || "-";
    const isRestored = interruptionStatusInput?.value === "restored";
    const endDate = isRestored ? (interruptionEndDateInput?.value || "-") : "-";
    const endTime = isRestored ? (interruptionEndTimeInput?.value || "-") : "-";
    return {
        start: `${startDate} ${startTime}`.trim(),
        end: `${endDate} ${endTime}`.trim(),
        startDate: startDate === "-" ? "" : startDate,
        startTime: startTime === "-" ? "" : startTime,
        endDate: endDate === "-" ? "" : endDate,
        endTime: endTime === "-" ? "" : endTime,
    };
}

function getSelectedSummaryLabel(panelData) {
    if (currentContextType === "transformer" || isTransformerFeature(panelData?.feature)) {
        return { label: "Selected Transformer", value: panelData?.feature?.name || panelData?.targetName || "-" };
    }
    if (panelData?.clickedTower?.name) {
        return { label: "Selected Pole", value: panelData.clickedTower.name };
    }
    return { label: "Selected", value: panelData?.targetName || "-" };
}

function getSidePanelMetrics(panelData = currentPanelData) {
    const affectedTowers = getCanonicalAffectedPolIdEntries(panelData?.affectedTowers || []);
    const matchedRows = panelData?.matchedRows || [];
    const filteredRows = filterConsumerRows(matchedRows);
    const polIds = affectedTowers.map((tower) => tower.name);
    const accounts = getUniqueAffectedAccounts(matchedRows);
    const uniqueAccountRows = getUniqueAffectedAccountRows(matchedRows);
    const interruptionWindow = getSidePanelInterruptionWindow();
    const totalKwhr = getTotalAffectedKwhr(uniqueAccountRows);
    const startDateTime = interruptionWindow.startDate ? new Date(`${interruptionWindow.startDate}T${interruptionWindow.startTime || "00:00"}`) : null;
    const rateDate = startDateTime || new Date();
    const daysInMonth = new Date(rateDate.getFullYear(), rateDate.getMonth() + 1, 0).getDate();
    const dsmRate = 2.0148;
    const kwhrLoss = daysInMonth
        ? ((totalKwhr / daysInMonth) / 24)
        : 0;
    const kwhrLossPhp = kwhrLoss * dsmRate;

    return {
        affectedTowers,
        matchedRows,
        filteredRows,
        polIds,
        accounts,
        uniqueAccountRows,
        interruptionWindow,
        totalKwhr,
        kwhrLoss,
        kwhrLossPhp,
    };
}

function renderAffectedDashboard(panelData) {
    const metrics = getSidePanelMetrics(panelData);
    const rows = metrics.matchedRows;
    const filteredRows = metrics.filteredRows;
    const filteredLabel = sidePanelSearchTerm ? `${filteredRows.length} shown of ${rows.length}` : `${rows.length} shown`;
    const selection = getSelectedSummaryLabel(panelData);
    const consumerRowsHtml = filteredRows.map((row, idx) => `
        <tr>
            <td>${idx + 1}</td>
            <td class="truncate-cell" title="${escapeHtml(row.consumer_name || "-")}">${escapeHtml(row.consumer_name || "-")}</td>
            <td class="truncate-cell" title="${escapeHtml(row.address || "-")}">${escapeHtml(row.address || "-")}</td>
            <td>${escapeHtml(row.account_number || "-")}</td>
            <td>${escapeHtml(row.pol_id || "-")}</td>
            <td>${escapeHtml(formatKwhr(row.kwhr))}</td>
            <td>${escapeHtml(row.frombus_id || "-")}</td>
            <td>${escapeHtml(row.tobus_id || "-")}</td>
            <td>${escapeHtml(row.matched_tower || "-")}</td>
            <td>${escapeHtml(row.matched_via || "-")}</td>
        </tr>
    `).join("");

    detailsBox.innerHTML = `
        <section class="side-panel-section">
            <div class="side-panel-section-head">
                <div>
                    <h4 class="side-panel-section-title">${escapeHtml(selection.label)}</h4>
                    <p class="side-panel-section-subtitle">${escapeHtml(selection.value || "-")}</p>
                </div>
            </div>
        </section>

        <section class="side-panel-section">
            <div class="side-panel-section-head">
                <div>
                    <h4 class="side-panel-section-title">Totals</h4>
                    <p class="side-panel-section-subtitle">Unique affected pole IDs and accounts for the current result.</p>
                </div>
            </div>
            <div class="side-panel-summary-grid">
                <div class="side-panel-summary-card">
                    <span class="side-panel-summary-label">Total Pol ID</span>
                    <strong class="side-panel-summary-value">${metrics.polIds.length}</strong>
                </div>
                <div class="side-panel-summary-card">
                    <span class="side-panel-summary-label">Total Account</span>
                    <strong class="side-panel-summary-value">${metrics.accounts.length}</strong>
                </div>
            </div>
        </section>

        <section class="side-panel-section">
            <div class="side-panel-section-head">
                <div>
                    <h4 class="side-panel-section-title">Interruption Start - Interruption End</h4>
                    <p class="side-panel-section-subtitle">Shows the active saved interruption window, or the current draft values if not yet saved.</p>
                </div>
            </div>
            <div class="summary-box aligned-summary-box">
                <p><strong>Interruption Start</strong><span>${escapeHtml(metrics.interruptionWindow.start || "-")}</span></p>
                <p><strong>Interruption End</strong><span>${escapeHtml(metrics.interruptionWindow.end || "-")}</span></p>
            </div>
        </section>

        <section class="side-panel-section">
            <div class="side-panel-section-head">
                <div>
                    <h4 class="side-panel-section-title">KWHR Consumed</h4>
                    <p class="side-panel-section-subtitle">Computed one-hour KWHR loss from matched consumer accounts.</p>
                </div>
            </div>
            <div class="side-panel-summary-grid">
                <div class="side-panel-summary-card">
                    <span class="side-panel-summary-label">Total KWHR Loss</span>
                    <strong class="side-panel-summary-value">${formatSummaryNumber(metrics.kwhrLoss, 4)}</strong>
                </div>
                <div class="side-panel-summary-card">
                    <span class="side-panel-summary-label">KWHR Loss in PHP</span>
                    <strong class="side-panel-summary-value">${escapeHtml(formatPhpCurrency(metrics.kwhrLossPhp))}</strong>
                </div>
            </div>
        </section>

        <section class="side-panel-section">
            <div class="side-panel-section-head">
                <div>
                    <h4 class="side-panel-section-title">Consumers Info</h4>
                    <p class="side-panel-section-subtitle">Search by consumer name or account number. Missing values display as -.</p>
                </div>
                <span class="side-panel-count">${filteredRows.length}</span>
            </div>
            <div class="side-panel-consumer-meta">
                <span>${escapeHtml(filteredLabel)}</span>
                <span>${sidePanelSearchTerm ? `Search: "${escapeHtml(sidePanelSearchTerm)}"` : "Search all consumers"}</span>
            </div>
            ${filteredRows.length ? `
                <div class="table-wrap">
                    <table class="affected-table consumer-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Consumer Name</th>
                                <th>Address</th>
                                <th>Account Number</th>
                                <th>Pol ID</th>
                                <th>KWHR</th>
                                <th>FromBusID</th>
                                <th>ToBusID</th>
                                <th>Matched Tower</th>
                                <th>Matched Via</th>
                            </tr>
                        </thead>
                        <tbody>${consumerRowsHtml}</tbody>
                    </table>
                </div>
            ` : `<p class="consumer-no-results">${sidePanelSearchTerm ? "No matching consumer found." : "No consumer rows are available for this selection."}</p>`}
        </section>
    `;
}

function renderPanel(panelData) {
    return renderAffectedDashboard(panelData);
}

function renderInterruptionCollections() {
    interruptionCount.textContent = `${interruptions.length} saved`;

    if (!interruptions.length) {
        interruptionList.className = "interruption-list empty-state";
        interruptionList.textContent = interruptionsLoaded ? "No interruption saved yet." : "Loading saved interruptions...";
        interruptionTabs.className = "interruption-tabs empty-state";
        interruptionTabs.textContent = interruptionsLoaded ? "No interruptions saved." : "Loading interruptions...";
        viewerInterruptionTabs.className = "interruption-tabs empty-state";
        viewerInterruptionTabs.textContent = interruptionsLoaded ? "No interruptions saved." : "Loading interruptions...";
        viewerDetails.className = "viewer-details empty-state";
        viewerDetails.textContent = "Select an interruption to view all affected area information.";
        return;
    }

    interruptionList.className = "interruption-list";
    interruptionList.innerHTML = interruptions.map((item) => `
        <div class="interruption-card ${item.id === activeInterruptionId ? "active" : ""}" data-interruption-id="${item.id}">
            <div class="interruption-card-head">
                <span class="card-index">Saved Interruption</span>
                <button type="button" class="delete-interruption-btn" data-delete-interruption-id="${item.id}">Delete</button>
            </div>
            <button type="button" class="interruption-card-open" data-open-interruption-id="${item.id}">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(formatRangeLabel(item))}</span>
                <span>${getUniqueAffectedPolIdCount(item)} Pol ID</span>
                <span>${getInterruptionMatchedRowCount(item)} mapped rows</span>
            </button>
        </div>
    `).join("");

    const tabsHtml = interruptions.map((item) => `
        <button type="button" class="interrupt-chip ${item.id === activeInterruptionId ? "active" : ""}" data-interruption-id="${item.id}">${escapeHtml(item.name)}</button>
    `).join("");

    interruptionTabs.className = "interruption-tabs";
    interruptionTabs.innerHTML = tabsHtml;
    viewerInterruptionTabs.className = "interruption-tabs";
    viewerInterruptionTabs.innerHTML = tabsHtml;

    document.querySelectorAll("[data-open-interruption-id], [data-interruption-id]").forEach((button) => {
        button.addEventListener("click", function () {
            applyInterruption(button.getAttribute("data-open-interruption-id") || button.getAttribute("data-interruption-id"));
        });
    });

    document.querySelectorAll("[data-delete-interruption-id]").forEach((button) => {
        button.addEventListener("click", function (event) {
            event.stopPropagation();
            deleteInterruption(button.getAttribute("data-delete-interruption-id"));
        });
    });
}

async function applyInterruption(interruptionId, options = {}) {
    const normalizedId = String(interruptionId || "");
    if (!normalizedId) return;

    let interruption = interruptions.find((item) => item.id === normalizedId) || null;
    if (!options.skipFetch) {
        try {
            const fetched = await fetchInterruptionFromServer(normalizedId);
            interruption = upsertInterruption(fetched);
        } catch (err) {
            if (!interruption) {
                alert(err.message || "Failed to load interruption.");
                return;
            }
        }
    }
    if (!interruption) return;

    if (!networkData) {
        showWorkspaceRecoveryNotice(
            "The live feeder workspace is not loaded. This interruption is being rebuilt from saved interruption data only, so map highlights may be limited until you restore or re-upload the feeder workspace."
        );
    } else {
        hideWorkspaceRecoveryNotice();
    }

    activeInterruptionId = interruption.id;
    currentContextType = interruption.contextType || "tower";
    const lineIndexes = Array.isArray(interruption.lineIndexes) ? interruption.lineIndexes : [];
    const towerIndexes = Array.isArray(interruption.towerIndexes) ? interruption.towerIndexes : [];
    currentPanelData = {
        targetName: interruption.targetName,
        clickedTower: interruption.clickedTower ? cloneTower(interruption.clickedTower) : null,
        clickedLineIndex: Number.isInteger(interruption.clickedLineIndex) ? interruption.clickedLineIndex : null,
        affectedTowers: (interruption.affectedTowers || []).map(cloneTower),
        matchedRows: (interruption.matchedRows || []).map(cloneMatchedRow),
        lineIndexes: [...lineIndexes],
        towerIndexes: [...towerIndexes],
        kmlFeatureIds: [...(interruption.kmlFeatureIds || [])],
        feature: interruption.kmlFeature ? cloneKmlFeature(interruption.kmlFeature) : null,
        audit: interruption.audit || null,
    };

    resetLineColors();
    applyNetworkLineHighlightState(lineIndexes, currentPanelData.clickedLineIndex);
    applyTowerHighlightState(towerIndexes);
    highlightAffectedKmlFeatures(currentPanelData);

    showSidePanel();
    renderCurrentContext();
    renderInterruptionCollections();
    refreshViewerIfOpen();
}

function getActiveInterruption() {
    return interruptions.find((item) => item.id === activeInterruptionId) || null;
}

async function deleteInterruption(interruptionId) {
    const normalizedId = String(interruptionId || "");
    const interruptionIndex = interruptions.findIndex((item) => item.id === normalizedId);
    if (interruptionIndex === -1) return;

    try {
        const response = await fetchWithTimeout(`/interruptions/${encodeURIComponent(normalizedId)}`, {
            method: "DELETE",
        });
        const data = await response.json().catch(() => ({ success: false, message: "Failed to delete interruption." }));
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Failed to delete interruption.");
        }
    } catch (err) {
        alert(err.message || "Failed to delete interruption.");
        return;
    }

    interruptions.splice(interruptionIndex, 1);
    syncInterruptionCounter();

    if (activeInterruptionId === normalizedId) {
        activeInterruptionId = null;
        currentPanelData = null;
        currentContextType = "tower";
        resetLineColors();
        hideSidePanel();
        renderInterruptionCollections();
        refreshViewerIfOpen();
        return;
    }

    renderInterruptionCollections();
    refreshViewerIfOpen();
}

function renderViewer() {
    const active = getActiveInterruption();

    if (!active) {
        viewerTitle.textContent = "Interruption Viewer";
        viewerMeta.textContent = "Select or save an interruption first.";
        viewerDetails.className = "viewer-details empty-state";
        viewerDetails.textContent = "Select an interruption to view all affected area information.";
        destroyViewerMap();
        renderInterruptionCollections();
        return;
    }

    viewerTitle.textContent = active.name;
    viewerMeta.textContent = formatRangeLabel(active);
    viewerDetails.className = "viewer-details";
    viewerDetails.innerHTML = buildViewerDetailsHtml(active);
    ensureViewerMap();
    drawViewerMap(active);
    renderInterruptionCollections();
}

function getViewerAffectedPoleEntries(towers = []) {
    return getCanonicalAffectedPolIdEntries(towers);
}

function getUniqueAffectedAccountCount(rows = []) {
    return new Set(
        rows
            .map((row) => String(row?.account_number || "").trim())
            .filter(Boolean)
    ).size;
}

function getUniqueAffectedAccountRows(rows = []) {
    const seen = new Set();
    const uniqueRows = [];

    rows.forEach((row, index) => {
        const accountNumber = String(row?.account_number || "").trim().toUpperCase();
        const fallbackKey = [
            row?.pol_id,
            row?.frombus_id,
            row?.tobus_id,
            row?.consumer_name,
            index,
        ].map((value) => String(value || "").trim().toUpperCase()).join("|");
        const key = accountNumber || fallbackKey;
        if (!key || seen.has(key)) return;
        seen.add(key);
        uniqueRows.push(row);
    });

    return uniqueRows;
}

function getTotalAffectedKwhr(rows = []) {
    return rows.reduce((sum, row) => sum + Number(row?.kwhr || 0), 0);
}

function formatKwhr(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(4) : "0.0000";
}

function getUniqueAffectedPolIds(rows = []) {
    return [...new Set(
        rows
            .map((row) => normalizeId(row?.pol_id || ""))
            .filter(Boolean)
    )];
}

function getUniqueAffectedPolIdCount(interruption) {
    if (Number.isFinite(Number(interruption?.totalPolId)) && Number(interruption.totalPolId) > 0) {
        return Number(interruption.totalPolId);
    }
    return getCanonicalAffectedPolIdEntries(interruption?.affectedTowers || []).length;
}

function getInterruptionMatchedRowCount(interruption) {
    if (Number.isFinite(Number(interruption?.matchedRowsCount)) && Number(interruption.matchedRowsCount) >= 0) {
        return Number(interruption.matchedRowsCount);
    }
    return Array.isArray(interruption?.matchedRows) ? interruption.matchedRows.length : 0;
}

function getUniqueAffectedAccounts(rows = []) {
    return [...new Set(
        rows
            .map((row) => String(row?.account_number || "").trim())
            .filter(Boolean)
    )];
}

function filterConsumerRows(rows = [], searchTerm = sidePanelSearchTerm) {
    const query = String(searchTerm || "").trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => {
        const consumerName = String(row?.consumer_name || "").toLowerCase();
        const accountNumber = String(row?.account_number || "").toLowerCase();
        return consumerName.includes(query) || accountNumber.includes(query);
    });
}

function formatSummaryNumber(value, fractionDigits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return number.toLocaleString(undefined, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    });
}

function getInterruptionSourceName(interruption) {
    if (interruption?.clickedTower?.name) return interruption.clickedTower.name;
    if (interruption?.kmlFeature?.name) return interruption.kmlFeature.name;
    return interruption?.targetName || "-";
}

function getInterruptionTransformerCount(interruption) {
    const ids = new Set();
    const featureIds = new Set([
        ...(interruption?.kmlFeature ? [interruption.kmlFeature.id] : []),
        ...(interruption?.kmlFeatureIds || []),
    ]);

    (kmlOverlayData?.features || []).forEach((feature) => {
        if (featureIds.has(feature.id) && isTransformerFeature(feature)) {
            ids.add(feature.id);
        }
    });

    if (interruption?.kmlFeature && isTransformerFeature(interruption.kmlFeature)) {
        ids.add(interruption.kmlFeature.id);
    }

    return ids.size;
}

function buildViewerDetailsHtml(interruption) {
    const towers = getViewerAffectedPoleEntries(interruption.affectedTowers || []);
    const rows = interruption.matchedRows || [];
    const sourceName = getInterruptionSourceName(interruption);
    const totalAccounts = getUniqueAffectedAccountCount(rows);
    const totalAffectedKwhr = getTotalAffectedKwhr(rows);
    const totalTransformers = getInterruptionTransformerCount(interruption);
    const traceConfidence = interruption.audit?.trace_confidence || "confirmed";
    const inferredNodesCount = interruption.audit?.inferred_nodes_count || 0;
    const inferredAccountsCount = interruption.audit?.inferred_accounts_count || 0;
    const recoveryNote = !networkData ? `
        <div class="viewer-recovery-banner">
            Live feeder workspace is not loaded. This viewer is using saved interruption data only. Re-upload or restore the feeder workspace to recover full line highlighting.
        </div>
    ` : "";
    const towerRows = towers.map((tower, idx) => `
        <tr><td>${idx + 1}</td><td>${escapeHtml(tower.name || "-")}</td><td>${escapeHtml(tower.code || "-")}</td><td>${formatCoordinate(tower.lat)}</td><td>${formatCoordinate(tower.lon)}</td></tr>
    `).join("");

    const extraColumns = getExtraFieldColumns(rows);
    const extraHeaderHtml = extraColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
    const accountRows = rows.map((row, idx) => {
        const extraCells = extraColumns.map((column) => `<td>${escapeHtml((row.extra_fields || {})[column] || "-")}</td>`).join("");
        return `<tr><td>${idx + 1}</td><td>${escapeHtml(row.pol_id || "-")}</td><td>${escapeHtml(row.account_number || "-")}</td><td>${escapeHtml(row.frombus_id || "-")}</td><td>${escapeHtml(row.tobus_id || "-")}</td><td title="${escapeHtml(row.consumer_name || "-")}">${escapeHtml(row.consumer_name || "-")}</td><td>${escapeHtml(row.consumer_type || "-")}</td><td title="${escapeHtml(row.address || "-")}">${escapeHtml(row.address || "-")}</td><td>${escapeHtml(row.serial || "-")}</td><td>${escapeHtml(row.brand || "-")}</td><td>${escapeHtml(formatKwhr(row.kwhr))}</td><td>${escapeHtml(row.matched_tower || "-")}</td><td>${escapeHtml(row.matched_via || "-")}</td>${extraCells}</tr>`;
    }).join("");

    const kmlSection = interruption.kmlFeature ? `
        <section class="viewer-detail-section">
            <div class="viewer-section-head">
                <div>
                    <div class="viewer-section-title">KML Feature</div>
                    <p class="viewer-section-subtitle">Source feature details for this interruption.</p>
                </div>
            </div>
            <div class="summary-box aligned-summary-box">
                <p><strong>Name</strong><span>${escapeHtml(interruption.kmlFeature.name || "-")}</span></p>
                <p><strong>Description</strong><span>${escapeHtml(interruption.kmlFeature.description || "-")}</span></p>
                <p><strong>Geometry</strong><span>${escapeHtml(interruption.kmlFeature.geometry || "-")}</span></p>
                <p><strong>Points</strong><span>${interruption.kmlFeature.point_count || 0}</span></p>
            </div>
        </section>
    ` : "";

    return `
        ${recoveryNote}
        <section class="viewer-detail-section">
            <div class="viewer-section-head">
                <div>
                    <div class="viewer-section-title">Export Preview</div>
                    <p class="viewer-section-subtitle">Review the source and totals that will be written to the XLSX file.</p>
                </div>
                <span class="trace-badge ${escapeHtml(traceConfidence)}">${escapeHtml(traceConfidence === "mixed" ? "Mixed Path" : (traceConfidence === "guessed" ? "Guessed Path" : "Confirmed Path"))}</span>
            </div>
            <div class="summary-box aligned-summary-box viewer-summary-grid">
                <p><strong>Saved Name</strong><span>${escapeHtml(interruption.name)}</span></p>
                <p><strong>Start</strong><span>${escapeHtml(interruption.startDate)} ${escapeHtml(interruption.startTime)}</span></p>
                <p><strong>Finish</strong><span>${escapeHtml(interruption.endDate)} ${escapeHtml(interruption.endTime)}</span></p>
                <p><strong>Target</strong><span>${escapeHtml(interruption.targetName || "-")}</span></p>
            </div>
            <div class="summary-box aligned-summary-box viewer-summary-grid">
                <p><strong>Export Source</strong><span>${escapeHtml(sourceName)}</span></p>
                <p><strong>Feeder Name</strong><span>${escapeHtml(interruption.feederName || feederFileName || "Unknown Feeder")}</span></p>
                <p><strong>Total Pol ID</strong><span>${towers.length}</span></p>
                <p><strong>Total Affected Accounts</strong><span>${totalAccounts}</span></p>
                <p><strong>Total Affected KWHR</strong><span>${escapeHtml(formatKwhr(totalAffectedKwhr))}</span></p>
                <p><strong>Total Transformers</strong><span>${totalTransformers}</span></p>
                <p><strong>Trace Confidence</strong><span>${escapeHtml(traceConfidence)}</span></p>
                <p><strong>User</strong><span>${escapeHtml(interruption.createdBy || getCurrentUsername())}</span></p>
            </div>
            <div class="summary-box aligned-summary-box viewer-summary-grid">
                <p><strong>Inferred Nodes</strong><span>${inferredNodesCount}</span></p>
                <p><strong>Inferred Accounts</strong><span>${inferredAccountsCount}</span></p>
            </div>
            <div class="viewer-metric-grid">
                <div class="viewer-metric-card">
                    <span class="viewer-metric-label">Total Pol ID</span>
                    <strong class="viewer-metric-value">${towers.length}</strong>
                </div>
                <div class="viewer-metric-card">
                    <span class="viewer-metric-label">Mapped XLSX Rows</span>
                    <strong class="viewer-metric-value">${rows.length}</strong>
                </div>
                <div class="viewer-metric-card">
                    <span class="viewer-metric-label">Affected KWHR</span>
                    <strong class="viewer-metric-value">${escapeHtml(formatKwhr(totalAffectedKwhr))}</strong>
                </div>
            </div>
        </section>
        ${kmlSection}
        <section class="viewer-detail-section">
            <div class="viewer-section-head">
                <div>
                    <div class="viewer-section-title">Affected Area</div>
                    <p class="viewer-section-subtitle">Only the affected pole IDs for this interruption.</p>
                </div>
                <span class="viewer-section-count">${towers.length}</span>
            </div>
            <div class="table-wrap viewer-table-wrap">
                <table class="affected-table">
                    <thead><tr><th>#</th><th>Pol ID</th><th>Code</th><th>Lat</th><th>Lon</th></tr></thead>
                    <tbody>${towerRows || '<tr><td colspan="5">No affected pole IDs.</td></tr>'}</tbody>
                </table>
            </div>
        </section>
        <section class="viewer-detail-section">
            <div class="viewer-section-head">
                <div>
                    <div class="viewer-section-title">Mapped XLSX Data</div>
                    <p class="viewer-section-subtitle">Pol ID, account number, and matched feeder mapping.</p>
                </div>
                <span class="viewer-section-count">${rows.length}</span>
            </div>
            <div class="table-wrap viewer-table-wrap large-viewer-table">
                <table class="affected-table">
                    <thead><tr><th>#</th><th>Pol ID</th><th>Account Number</th><th>frombusID</th><th>tobusID</th><th>Consumer Name</th><th>Type</th><th>Address</th><th>Serial</th><th>Brand</th><th>KWHR</th><th>Matched Tower</th><th>Matched Via</th>${extraHeaderHtml}</tr></thead>
                    <tbody>${accountRows || `<tr><td colspan="${13 + extraColumns.length}">No mapped XLSX rows.</td></tr>`}</tbody>
                </table>
            </div>
        </section>
    `;
}

function ensureViewerMap() {
    if (viewerMap) {
        setTimeout(() => viewerMap.invalidateSize(), 0);
        return;
    }

    viewerMap = L.map("viewerMap", {
        zoomControl: true,
        minZoom: 1,
        maxZoom: 30,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        preferCanvas: true
    }).setView([15.598, 120.922], 13);
    viewerMap.createPane("transformerPane");
    viewerMap.getPane("transformerPane").style.zIndex = 650;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 30,
        maxNativeZoom: 19,
        noWrap: true,
        referrerPolicy: "strict-origin-when-cross-origin",
        attribution: "&copy; OpenStreetMap contributors"
    }).addTo(viewerMap);
    setTimeout(() => viewerMap.invalidateSize(), 0);
}

function destroyViewerMapLayers() {
    if (!viewerMap) return;
    viewerBaseLines.forEach((layer) => viewerMap.removeLayer(layer));
    viewerHighlightLines.forEach((layer) => viewerMap.removeLayer(layer));
    viewerMarkers.forEach((layer) => viewerMap.removeLayer(layer));
    viewerKmlOverlayLayers.forEach((layer) => viewerMap.removeLayer(layer));
    viewerBaseLines = [];
    viewerHighlightLines = [];
    viewerMarkers = [];
    viewerKmlOverlayLayers = [];
    viewerKmlOverlayLayerMap = new Map();
    viewerKmlTransformerMarkers.forEach((marker) => viewerMap.removeLayer(marker));
    viewerKmlTransformerMarkers = [];
}

function destroyViewerMap() {
    if (!viewerMap) return;
    viewerMap.remove();
    viewerMap = null;
    viewerBaseLines = [];
    viewerHighlightLines = [];
    viewerMarkers = [];
}

function drawViewerMap(interruption) {
    if (!viewerMap) return;

    destroyViewerMapLayers();
    const focusBounds = [];
    const activeViewerKmlIds = interruption.contextType === "transformer"
        ? new Set([
            ...(interruption.kmlFeature ? [interruption.kmlFeature.id] : []),
            ...(interruption.kmlFeatureIds || []),
        ])
        : new Set(getActiveKmlFeatureIdsForPanel({
            feature: interruption.kmlFeature || null,
            affectedTowers: interruption.affectedTowers || [],
            kmlFeatureIds: interruption.kmlFeatureIds || [],
        }));

    if (networkData) {
        (interruption.lineIndexes || []).forEach((lineIndex) => {
            const line = networkData.lines[lineIndex];
            if (!line) return;
            const highlight = L.polyline(line.coords, {
                ...getHighlightedNetworkLineStyle(line, Number.isInteger(interruption.clickedLineIndex) && interruption.clickedLineIndex === lineIndex),
                interactive: false,
            }).addTo(viewerMap);
            viewerHighlightLines.push(highlight);
            line.coords.forEach((coord) => focusBounds.push(coord));
        });
    }

    if (kmlOverlayData && kmlOverlayData.features) {
        kmlOverlayData.features.forEach((feature) => {
            if (feature.coords && feature.coords.length >= 2) {
                if (!activeViewerKmlIds.has(feature.id)) return;

                const layer = L.polyline(feature.coords, {
                    color: affectedLineColor,
                    weight: 6,
                    opacity: 1,
                    interactive: false,
                }).addTo(viewerMap);
                viewerKmlOverlayLayers.push(layer);
                viewerKmlOverlayLayerMap.set(feature.id, layer);
                feature.coords.forEach((coord) => focusBounds.push(coord));
            }

            if (isTransformerFeature(feature)) {
                const center = getFeatureCenter(feature);
                if (center && activeViewerKmlIds.has(feature.id)) {
                    const marker = L.marker(center, {
                        icon: createTransformerIcon(feature.name || "DT", viewerMap?.getZoom?.() ?? 13),
                        pane: "transformerPane",
                        zIndexOffset: 400,
                    }).addTo(viewerMap);
                    viewerKmlTransformerMarkers.push(marker);
                    focusBounds.push(center);
                }
            }
        });
    }

    getViewerAffectedPoleEntries(interruption.affectedTowers || []).forEach((tower) => {
        if (!Number.isFinite(Number(tower.lat)) || !Number.isFinite(Number(tower.lon))) return;
        const marker = L.circleMarker([tower.lat, tower.lon], {
            radius: 4,
            color: "#111",
            fillColor: affectedLineColor,
            fillOpacity: 0.95,
            weight: 1
        }).addTo(viewerMap);
        marker.bindTooltip(tower.name);
        viewerMarkers.push(marker);
        focusBounds.push([tower.lat, tower.lon]);
    });

    if (focusBounds.length > 0) {
        viewerMap.fitBounds(focusBounds, { padding: [24, 24] });
    }
    setTimeout(() => viewerMap.invalidateSize(), 0);
}

function refreshViewerIfOpen() {
    if (!viewerModal.classList.contains("hidden")) {
        renderViewer();
    }
}

function resetInterruptions() {
    activeInterruptionId = null;
    renderInterruptionCollections();
    closeModal(viewerModal);
}

function setDefaultInterruptionDateTime() {
    const now = new Date();
    interruptionStatusInput.value = "active";
    interruptionStartDateInput.value = now.toISOString().slice(0, 10);
    interruptionStartTimeInput.value = now.toTimeString().slice(0, 5);
    interruptionEndDateInput.value = "";
    interruptionEndTimeInput.value = "";
    interruptionActionTakenInput.value = "";
    interruptionRemarksInput.value = "";
}

function formatRangeLabel(interruption) {
    return `${interruption.startDate} ${interruption.startTime} -> ${interruption.endDate} ${interruption.endTime}`;
}

function normalizeHeaderLabel(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getExtraFieldColumns(rows) {
    const excluded = new Set([
        "frombusid", "tobusid", "polid", "poleid", "accountnumber", "accountno", "acctno",
        "consumername", "type", "consumertype", "address", "serial", "brand", "kwhr", "kwh"
    ]);
    const columns = [];
    const seen = new Set();

    rows.forEach((row) => {
        Object.keys(row.extra_fields || {}).forEach((key) => {
            const normalized = normalizeHeaderLabel(key);
            if (!normalized || excluded.has(normalized) || seen.has(normalized)) return;
            seen.add(normalized);
            columns.push(key);
        });
    });

    return columns;
}

function formatCoordinate(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toFixed(6) : "-";
}

function formatLatLon(coord) {
    if (!coord || coord.length < 2) return "-";
    return `${formatCoordinate(coord[0])}, ${formatCoordinate(coord[1])}`;
}

function openModal(modal) {
    modal.classList.remove("hidden");
    if (modal === viewerModal) {
        setTimeout(() => renderViewer(), 0);
    }
}

function closeModal(modal) {
    modal.classList.add("hidden");
    if (modal === viewerModal) destroyViewerMap();
}

function cloneTower(tower) {
    return { id: tower.id, name: tower.name, code: tower.code, lat: tower.lat, lon: tower.lon, index: tower.index };
}

function cloneMatchedRow(row) {
    return {
        matched_tower: row.matched_tower,
        frombus_id: row.frombus_id,
        tobus_id: row.tobus_id,
        pol_id: row.pol_id,
        account_number: row.account_number,
        consumer_name: row.consumer_name,
        consumer_type: row.consumer_type,
        address: row.address,
        serial: row.serial,
        brand: row.brand,
        kwhr: row.kwhr,
        matched_via: row.matched_via,
        extra_fields: { ...(row.extra_fields || {}) }
    };
}

function cloneKmlFeature(feature) {
    if (!feature) return null;
    return {
        id: feature.id,
        name: feature.name,
        description: feature.description,
        style_url: feature.style_url,
        resolved_style_url: feature.resolved_style_url,
        style: { ...(feature.style || {}) },
        geometry: feature.geometry,
        coords: (feature.coords || []).map((coord) => [...coord]),
        point_count: feature.point_count,
        start: feature.start ? [...feature.start] : [],
        end: feature.end ? [...feature.end] : [],
    };
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}



























