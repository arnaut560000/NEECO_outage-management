const dashboardTableBody = document.getElementById("dashboardTableBody");
const affectedAreaModal = document.getElementById("affectedAreaModal");
const affectedAreaTitle = document.getElementById("affectedAreaTitle");
const affectedAreaMeta = document.getElementById("affectedAreaMeta");
const affectedAreaDetails = document.getElementById("affectedAreaDetails");
const monitoringForm = document.getElementById("monitoringForm");
const monitoringInterruptionId = document.getElementById("monitoringInterruptionId");
const monitoringStatus = document.getElementById("monitoringStatus");
const monitoringActionTaken = document.getElementById("monitoringActionTaken");
const monitoringRestoredDate = document.getElementById("monitoringRestoredDate");
const monitoringRestoredTime = document.getElementById("monitoringRestoredTime");
const monitoringRemarks = document.getElementById("monitoringRemarks");
const monitoringSaveBtn = document.getElementById("monitoringSaveBtn");
const csrfToken = window.csrfToken || "";
let dashboardData = window.dashboardData || { counters: {}, rows: [] };
let activeInterruption = null;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function updateCounters(counters = {}) {
    const metricMap = {
        total: "Total Interruption",
        active: "Active Interruption",
        scheduled: "Scheduled Interruption",
        restored: "Restored Interruption",
    };
    document.querySelectorAll(".dashboard-metric").forEach((metric) => {
        const label = metric.querySelector("span")?.textContent || "";
        const key = Object.entries(metricMap).find(([, text]) => text === label)?.[0];
        if (key) {
            metric.querySelector("strong").textContent = counters[key] ?? 0;
        }
    });
}

function statusPill(row) {
    if (row.actionTaken) {
        return `<span class="status-pill restored">${escapeHtml(row.actionTaken)}</span>`;
    }
    return `<span class="status-pill ${escapeHtml(row.status)}">${escapeHtml(row.statusLabel || capitalize(row.status))}</span>`;
}

function capitalize(value) {
    const text = String(value || "");
    return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function renderDashboardRows(rows = []) {
    if (!dashboardTableBody) return;
    if (!rows.length) {
        dashboardTableBody.innerHTML = `
            <tr>
                <td colspan="13" class="dashboard-empty-cell">No saved interruptions yet. Open the tracing map to upload a feeder GPX and save an interruption.</td>
            </tr>
        `;
        return;
    }

    dashboardTableBody.innerHTML = rows.map((row) => `
        <tr class="dashboard-row status-${escapeHtml(row.status)}">
            <td>${escapeHtml(row.substation)}</td>
            <td>
                <strong>${escapeHtml(row.feeder)}</strong>
                ${row.feederName && row.feederName !== row.feeder ? `<span>${escapeHtml(row.feederName)}</span>` : ""}
            </td>
            <td><a class="dashboard-link-btn" href="/operations?interruption_id=${encodeURIComponent(row.id)}&open_viewer=1">${escapeHtml(row.affectedArea)}</a></td>
            <td>${escapeHtml(row.startTime)}</td>
            <td>${escapeHtml(row.restoredDate || "-")}</td>
            <td>${escapeHtml(row.restoredTime || "-")}</td>
            <td>${statusPill(row)}</td>
            <td>${row.durationMinutes !== "" ? escapeHtml(row.durationMinutes) : "-"}</td>
            <td>${escapeHtml(row.customersAffected)}</td>
            <td>${escapeHtml(row.remarks)}</td>
            <td>${escapeHtml(row.estimatedKwhrLoss)}</td>
            <td>PHP ${escapeHtml(row.estimatedRevenueLoss)}</td>
            <td><button type="button" class="secondary-action compact-btn" data-open-manage="${escapeHtml(row.id)}">Manage</button></td>
        </tr>
    `).join("");
}

function renderDashboard(nextDashboard) {
    dashboardData = nextDashboard || dashboardData;
    updateCounters(dashboardData.counters || {});
    renderDashboardRows(dashboardData.rows || []);
}

function setModalOpen(isOpen) {
    affectedAreaModal?.classList.toggle("hidden", !isOpen);
}

function detailItem(label, value) {
    return `
        <p>
            <strong>${escapeHtml(label)}</strong>
            <span>${escapeHtml(value || "-")}</span>
        </p>
    `;
}

function formatAffectedTowers(interruption) {
    const towers = interruption?.affectedTowers || [];
    if (!towers.length) return "-";
    return towers
        .slice(0, 12)
        .map((tower) => tower?.name || tower?.code || "")
        .filter(Boolean)
        .join(", ") + (towers.length > 12 ? `, +${towers.length - 12} more` : "");
}

function renderAffectedAreaDetails(interruption) {
    const row = (dashboardData.rows || []).find((item) => String(item.id) === String(interruption.id)) || {};
    affectedAreaTitle.textContent = `Manage ${row.affectedArea || interruption.targetName || "Interruption"}`;
    affectedAreaMeta.textContent = `${row.substation || "-"} / ${row.feeder || interruption.feederName || "-"}`;
    affectedAreaDetails.innerHTML = [
        detailItem("Interruption", interruption.name),
        detailItem("Status", row.status || interruption.status),
        detailItem("Substation", row.substation),
        detailItem("Feeder", row.feederName || interruption.feederName),
        detailItem("Affected Area", row.affectedArea || interruption.targetName),
        detailItem("Customers Affected", row.customersAffected ?? interruption.totalAffectedAccounts),
        detailItem("Estimated KWHR Loss", row.estimatedKwhrLoss),
        detailItem("Estimated Revenue Loss", row.estimatedRevenueLoss ? `PHP ${row.estimatedRevenueLoss}` : ""),
        detailItem("Created By", row.createdBy || interruption.createdBy),
        detailItem("Created At", row.createdAt || interruption.createdAt),
    ].join("");

    monitoringInterruptionId.value = interruption.id || "";
    monitoringStatus.value = interruption.status || row.status || "active";
    monitoringActionTaken.value = interruption.actionTaken || row.actionTaken || "";
    monitoringRestoredDate.value = interruption.restoredDate || row.restoredDate || interruption.endDate || "";
    monitoringRestoredTime.value = interruption.restoredTime || row.restoredTime || interruption.endTime || "";
    monitoringRemarks.value = interruption.remarks || row.remarks || "";
    updateRestoredFieldVisibility();
}

async function fetchJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (method !== "GET" && csrfToken && !headers.has("X-CSRF-Token")) {
        headers.set("X-CSRF-Token", csrfToken);
    }
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({ success: false, message: "Request failed." }));
    if (!response.ok || !data.success) {
        throw new Error(data.message || "Request failed.");
    }
    return data;
}

async function openAffectedArea(interruptionId) {
    const data = await fetchJson(`/interruptions/${encodeURIComponent(interruptionId)}`);
    activeInterruption = data.interruption;
    renderAffectedAreaDetails(activeInterruption);
    setModalOpen(true);
}

function updateRestoredFieldVisibility() {
    const shouldShow = monitoringStatus.value === "restored" || monitoringActionTaken.value.trim() !== "";
    document.querySelectorAll(".dashboard-system-restored-field").forEach((field) => {
        field.classList.add("dashboard-hidden-field");
    });
    if (shouldShow && monitoringStatus.value === "restored" && !monitoringActionTaken.value.trim()) {
        monitoringActionTaken.value = "Restored";
    }
    if (shouldShow && (!monitoringRestoredDate.value || !monitoringRestoredTime.value)) {
        const now = new Date();
        if (!monitoringRestoredDate.value) {
            monitoringRestoredDate.value = [
                now.getFullYear(),
                String(now.getMonth() + 1).padStart(2, "0"),
                String(now.getDate()).padStart(2, "0"),
            ].join("-");
        }
        if (!monitoringRestoredTime.value) {
            monitoringRestoredTime.value = [
                String(now.getHours()).padStart(2, "0"),
                String(now.getMinutes()).padStart(2, "0"),
            ].join(":");
        }
    }
}

document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-manage]");
    if (openButton) {
        void openAffectedArea(openButton.getAttribute("data-open-manage")).catch((error) => {
            alert(error.message || "Could not open management details.");
        });
    }
    if (event.target.closest("[data-dashboard-close]")) {
        setModalOpen(false);
    }
});

monitoringStatus?.addEventListener("change", updateRestoredFieldVisibility);
monitoringActionTaken?.addEventListener("input", updateRestoredFieldVisibility);

monitoringForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!monitoringInterruptionId.value) return;

    monitoringSaveBtn.disabled = true;
    monitoringSaveBtn.textContent = "Saving...";
    try {
        const data = await fetchJson(`/interruptions/${encodeURIComponent(monitoringInterruptionId.value)}/monitoring`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: monitoringStatus.value,
                action_taken: monitoringActionTaken.value,
                restored_date: activeInterruption?.status === "restored" ? monitoringRestoredDate.value : "",
                restored_time: activeInterruption?.status === "restored" ? monitoringRestoredTime.value : "",
                remarks: monitoringRemarks.value,
            }),
        });
        activeInterruption = data.interruption;
        renderDashboard(data.dashboard);
        renderAffectedAreaDetails(activeInterruption);
    } catch (error) {
        alert(error.message || "Could not save monitoring update.");
    } finally {
        monitoringSaveBtn.disabled = false;
        monitoringSaveBtn.textContent = "Save Monitoring Update";
    }
});

renderDashboard(dashboardData);
