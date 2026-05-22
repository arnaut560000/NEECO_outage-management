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
const monitoringCauseOfInterruption = document.getElementById("monitoringCauseOfInterruption");
const monitoringRemarks = document.getElementById("monitoringRemarks");
const monitoringSaveBtn = document.getElementById("monitoringSaveBtn");
const statusDonut = document.getElementById("statusDonut");
const statusLegend = document.getElementById("statusLegend");
const restorationRate = document.getElementById("dashboardRestorationRate");
const customerImpactChart = document.getElementById("customerImpactChart");
const impactSummary = document.getElementById("impactSummary");
const feederChart = document.getElementById("feederChart");
const substationChart = document.getElementById("substationChart");
const dashboardFilterForm = document.getElementById("dashboardFilterForm");
const dashboardClearFiltersBtn = document.getElementById("dashboardClearFiltersBtn");
const dashboardRefreshBtn = document.getElementById("dashboardRefreshBtn");
const dashboardRefreshMeta = document.getElementById("dashboardRefreshMeta");
const dashboardToast = document.getElementById("dashboardToast");
const openDeleteAllInterruptionsBtn = document.getElementById("openDeleteAllInterruptionsBtn");
const deleteAllInterruptionsModal = document.getElementById("deleteAllInterruptionsModal");
const deleteAllInterruptionsForm = document.getElementById("deleteAllInterruptionsForm");
const deleteAllInterruptionsConfirm = document.getElementById("deleteAllInterruptionsConfirm");
const deleteAllInterruptionsSubmit = document.getElementById("deleteAllInterruptionsSubmit");
const csrfToken = window.csrfToken || "";
let dashboardData = window.dashboardData || { counters: {}, rows: [] };
let activeInterruption = null;
let dashboardRefreshTimer = null;
const statusConfig = {
    active: { label: "Active", color: "#d6453d", soft: "#fff0ee" },
    scheduled: { label: "Scheduled", color: "#d6a516", soft: "#fff8df" },
    restored: { label: "Restored", color: "#26834b", soft: "#eaf8ef" },
};

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function updateCounters(counters = {}) {
    document.querySelectorAll(".dashboard-metric").forEach((metric) => {
        const key = metric.getAttribute("data-counter-key");
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

function formatCause(value) {
    return String(value || "unknown")
        .split(/\s+/)
        .filter(Boolean)
        .map(capitalize)
        .join(" ");
}

function renderDashboardRows(rows = []) {
    if (!dashboardTableBody) return;
    if (!rows.length) {
        dashboardTableBody.innerHTML = `
            <tr>
                <td colspan="15" class="dashboard-empty-cell">No saved interruptions yet. Open the tracing map to upload a feeder GPX and save an interruption.</td>
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
            <td>${escapeHtml(row.selectedPolId || "-")}</td>
            <td><a class="dashboard-link-btn" href="/operations?interruption_id=${encodeURIComponent(row.id)}&open_viewer=1">${escapeHtml(row.affectedArea)}</a></td>
            <td>${escapeHtml(row.startTime)}</td>
            <td>${escapeHtml(row.restoredDate || "-")}</td>
            <td>${escapeHtml(row.restoredTime || "-")}</td>
            <td>${statusPill(row)}</td>
            <td>${row.durationMinutes !== "" ? escapeHtml(row.durationMinutes) : "-"}</td>
            <td>${escapeHtml(row.customersAffected)}</td>
            <td>${escapeHtml(formatCause(row.causeOfInterruption))}</td>
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
    renderDashboardAnalytics(dashboardData);
    if (dashboardRefreshMeta && dashboardData.updatedAt) {
        dashboardRefreshMeta.textContent = `Updated ${dashboardData.updatedAt}`;
    }
}

function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatCompactNumber(value, places = 0) {
    const number = parseNumber(value);
    return new Intl.NumberFormat("en", {
        maximumFractionDigits: places,
        minimumFractionDigits: 0,
    }).format(number);
}

function formatPeso(value) {
    return `PHP ${new Intl.NumberFormat("en", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
    }).format(parseNumber(value))}`;
}

function summarizeRows(rows = []) {
    return rows.reduce((summary, row) => {
        const status = statusConfig[row.status] ? row.status : "active";
        const customers = parseNumber(row.customersAffected);
        const revenue = parseNumber(row.estimatedRevenueLoss);
        const kwhr = parseNumber(row.estimatedKwhrLoss);
        const duration = parseNumber(row.durationMinutes);
        summary.statusCounts[status] = (summary.statusCounts[status] || 0) + 1;
        summary.customersByStatus[status] = (summary.customersByStatus[status] || 0) + customers;
        summary.totalCustomers += customers;
        summary.totalRevenue += revenue;
        summary.totalKwhr += kwhr;
        if (duration > 0) {
            summary.totalDuration += duration;
            summary.durationCount += 1;
        }
        addGroupedMetric(summary.feeders, row.feeder || "-", customers, revenue, row.status);
        addGroupedMetric(summary.substations, row.substation || "-", customers, revenue, row.status);
        return summary;
    }, {
        statusCounts: { active: 0, scheduled: 0, restored: 0 },
        customersByStatus: { active: 0, scheduled: 0, restored: 0 },
        totalCustomers: 0,
        totalRevenue: 0,
        totalKwhr: 0,
        totalDuration: 0,
        durationCount: 0,
        feeders: {},
        substations: {},
    });
}

function addGroupedMetric(groups, key, customers, revenue, status) {
    const label = key || "-";
    if (!groups[label]) {
        groups[label] = { label, count: 0, customers: 0, revenue: 0, active: 0 };
    }
    groups[label].count += 1;
    groups[label].customers += customers;
    groups[label].revenue += revenue;
    if (status === "active") {
        groups[label].active += 1;
    }
}

function renderDashboardAnalytics(data = {}) {
    const rows = data.rows || [];
    const counters = data.counters || {};
    const summary = summarizeRows(rows);
    renderStatusDonut(counters);
    renderCustomerImpact(summary.customersByStatus);
    renderImpactSummary(summary);
    renderRankChart(feederChart, Object.values(summary.feeders), "customers");
    renderRankChart(substationChart, Object.values(summary.substations), "count");
}

function renderStatusDonut(counters = {}) {
    if (!statusDonut || !statusLegend) return;
    const total = Math.max(0, parseNumber(counters.total));
    const restored = parseNumber(counters.restored);
    const rate = total ? Math.round((restored / total) * 100) : 0;
    restorationRate.textContent = `${rate}% restored`;

    if (!total) {
        statusDonut.innerHTML = `<div class="dashboard-empty-chart">No records</div>`;
        statusLegend.innerHTML = "";
        return;
    }

    let offset = 25;
    const segments = ["active", "scheduled", "restored"].map((key) => {
        const value = parseNumber(counters[key]);
        const length = total ? (value / total) * 100 : 0;
        const segment = `<circle r="15.9155" cx="18" cy="18" fill="transparent" stroke="${statusConfig[key].color}" stroke-width="5" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${offset}" />`;
        offset -= length;
        return segment;
    }).join("");

    statusDonut.innerHTML = `
        <svg viewBox="0 0 36 36" role="img" aria-label="Status mix">
            <circle r="15.9155" cx="18" cy="18" fill="transparent" stroke="#e6ece8" stroke-width="5"></circle>
            ${segments}
        </svg>
        <div class="dashboard-donut-center">
            <strong>${total}</strong>
            <span>records</span>
        </div>
    `;
    statusLegend.innerHTML = ["active", "scheduled", "restored"].map((key) => `
        <p>
            <i style="background:${statusConfig[key].color}"></i>
            <span>${statusConfig[key].label}</span>
            <strong>${formatCompactNumber(counters[key] || 0)}</strong>
        </p>
    `).join("");
}

function renderCustomerImpact(customersByStatus = {}) {
    if (!customerImpactChart) return;
    const entries = ["active", "scheduled", "restored"].map((key) => ({
        key,
        value: parseNumber(customersByStatus[key]),
        ...statusConfig[key],
    }));
    const maxValue = Math.max(1, ...entries.map((entry) => entry.value));
    customerImpactChart.innerHTML = entries.map((entry) => `
        <div class="dashboard-bar-row">
            <span>${entry.label}</span>
            <div class="dashboard-bar-track">
                <i style="width:${Math.max(4, (entry.value / maxValue) * 100)}%; background:${entry.color}"></i>
            </div>
            <strong>${formatCompactNumber(entry.value)}</strong>
        </div>
    `).join("");
}

function renderImpactSummary(summary) {
    if (!impactSummary) return;
    const serverAnalytics = dashboardData.analytics || {};
    const totalCustomers = serverAnalytics.totalCustomers ?? summary.totalCustomers;
    const totalKwhr = serverAnalytics.totalKwhrLoss ?? summary.totalKwhr;
    const totalRevenue = serverAnalytics.totalRevenueLoss ?? summary.totalRevenue;
    const averageDuration = serverAnalytics.averageRestoredDurationMinutes ?? (
        summary.durationCount ? Math.round(summary.totalDuration / summary.durationCount) : 0
    );
    impactSummary.innerHTML = `
        <p><span>Customers Affected</span><strong>${formatCompactNumber(totalCustomers)}</strong></p>
        <p><span>Estimated KWHR Loss</span><strong>${formatCompactNumber(totalKwhr, 2)}</strong></p>
        <p><span>Estimated Revenue Loss</span><strong>${formatPeso(totalRevenue)}</strong></p>
        <p><span>Avg. Restored Duration</span><strong>${averageDuration ? `${averageDuration} min` : "-"}</strong></p>
    `;
}

function renderRankChart(container, groups = [], mode = "customers") {
    if (!container) return;
    const ranked = groups
        .sort((a, b) => (b[mode] || 0) - (a[mode] || 0) || a.label.localeCompare(b.label))
        .slice(0, 5);
    if (!ranked.length) {
        container.innerHTML = `<div class="dashboard-empty-chart">No records yet</div>`;
        return;
    }
    const maxValue = Math.max(1, ...ranked.map((item) => parseNumber(item[mode])));
    container.innerHTML = ranked.map((item) => {
        const value = parseNumber(item[mode]);
        const detail = mode === "count"
            ? `${formatCompactNumber(item.count)} records / ${formatCompactNumber(item.customers)} customers`
            : `${formatCompactNumber(item.customers)} customers / ${formatPeso(item.revenue)}`;
        return `
            <div class="dashboard-rank-row">
                <div>
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(detail)}</span>
                </div>
                <div class="dashboard-rank-track">
                    <i style="width:${Math.max(5, (value / maxValue) * 100)}%"></i>
                </div>
            </div>
        `;
    }).join("");
}

function setModalOpen(isOpen) {
    affectedAreaModal?.classList.toggle("hidden", !isOpen);
}

function setDeleteAllModalOpen(isOpen) {
    deleteAllInterruptionsModal?.classList.toggle("hidden", !isOpen);
    if (isOpen) {
        deleteAllInterruptionsConfirm.value = "";
        deleteAllInterruptionsConfirm?.focus();
    }
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
        detailItem("Selected Pol ID", row.selectedPolId),
        detailItem("Affected Area", row.affectedArea || interruption.targetName),
        detailItem("Customers Affected", row.customersAffected ?? interruption.totalAffectedAccounts),
        detailItem("Cause of Interruption", formatCause(row.causeOfInterruption || interruption.causeOfInterruption)),
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
    monitoringCauseOfInterruption.value = interruption.causeOfInterruption || row.causeOfInterruption || "unknown";
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

function showDashboardToast(message, tone = "success") {
    if (!dashboardToast) return;
    dashboardToast.textContent = message;
    dashboardToast.className = `dashboard-toast ${tone}`;
    window.clearTimeout(showDashboardToast.timer);
    showDashboardToast.timer = window.setTimeout(() => {
        dashboardToast.classList.add("hidden");
    }, 3200);
}

function dashboardFilterParams() {
    const params = new URLSearchParams();
    if (!dashboardFilterForm) return params;
    new FormData(dashboardFilterForm).forEach((value, key) => {
        const text = String(value || "").trim();
        if (text) {
            params.set(key, text);
        }
    });
    return params;
}

async function refreshDashboard(options = {}) {
    if (dashboardRefreshBtn) {
        dashboardRefreshBtn.disabled = true;
        dashboardRefreshBtn.textContent = "Refreshing...";
    }
    try {
        const params = dashboardFilterParams();
        const url = params.toString() ? `/dashboard/data?${params.toString()}` : "/dashboard/data";
        const data = await fetchJson(url);
        renderDashboard(data.dashboard);
        if (options.toast) {
            showDashboardToast(options.toast);
        }
    } catch (error) {
        showDashboardToast(error.message || "Dashboard refresh failed.", "error");
    } finally {
        if (dashboardRefreshBtn) {
            dashboardRefreshBtn.disabled = false;
            dashboardRefreshBtn.textContent = "Refresh";
        }
    }
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
        field.classList.toggle("dashboard-hidden-field", !shouldShow);
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
            showDashboardToast(error.message || "Could not open management details.", "error");
        });
    }
    if (event.target.closest("[data-dashboard-close]")) {
        setModalOpen(false);
    }
    if (event.target.closest("[data-delete-all-close]")) {
        setDeleteAllModalOpen(false);
    }
});

monitoringStatus?.addEventListener("change", updateRestoredFieldVisibility);
monitoringActionTaken?.addEventListener("input", updateRestoredFieldVisibility);

dashboardFilterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void refreshDashboard();
});

dashboardFilterForm?.addEventListener("change", () => {
    void refreshDashboard();
});

dashboardClearFiltersBtn?.addEventListener("click", () => {
    dashboardFilterForm?.reset();
    void refreshDashboard({ toast: "Dashboard filters cleared." });
});

openDeleteAllInterruptionsBtn?.addEventListener("click", () => {
    setDeleteAllModalOpen(true);
});

deleteAllInterruptionsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const confirmation = deleteAllInterruptionsConfirm?.value.trim() || "";
    if (confirmation !== "DELETE ALL") {
        showDashboardToast("Type DELETE ALL to confirm.", "error");
        return;
    }

    deleteAllInterruptionsSubmit.disabled = true;
    deleteAllInterruptionsSubmit.textContent = "Deleting...";
    try {
        const data = await fetchJson("/interruptions/delete-all", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmation }),
        });
        setDeleteAllModalOpen(false);
        renderDashboard(data.dashboard);
        showDashboardToast(data.message || "All interruption records deleted.");
    } catch (error) {
        showDashboardToast(error.message || "Could not delete interruption records.", "error");
    } finally {
        deleteAllInterruptionsSubmit.disabled = false;
        deleteAllInterruptionsSubmit.textContent = "Delete All Records";
    }
});

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
                restored_date: monitoringStatus.value === "restored" ? monitoringRestoredDate.value : "",
                restored_time: monitoringStatus.value === "restored" ? monitoringRestoredTime.value : "",
                cause_of_interruption: monitoringCauseOfInterruption.value,
                remarks: monitoringRemarks.value,
            }),
        });
        activeInterruption = data.interruption;
        await refreshDashboard({ toast: "Monitoring update saved." });
        renderAffectedAreaDetails(activeInterruption);
    } catch (error) {
        showDashboardToast(error.message || "Could not save monitoring update.", "error");
    } finally {
        monitoringSaveBtn.disabled = false;
        monitoringSaveBtn.textContent = "Save Monitoring Update";
    }
});

renderDashboard(dashboardData);
dashboardRefreshTimer = window.setInterval(() => {
    if (!affectedAreaModal || affectedAreaModal.classList.contains("hidden")) {
        void refreshDashboard();
    }
}, 60000);
