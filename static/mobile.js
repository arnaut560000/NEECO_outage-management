const mobileRecordList = document.getElementById("mobileRecordList");
const mobileFilterForm = document.getElementById("mobileFilterForm");
const mobileRefreshBtn = document.getElementById("mobileRefreshBtn");
const mobileUpdatedAt = document.getElementById("mobileUpdatedAt");
const mobileTotalCustomers = document.getElementById("mobileTotalCustomers");
const mobileKwhrLoss = document.getElementById("mobileKwhrLoss");
const mobileRevenueLoss = document.getElementById("mobileRevenueLoss");
const mobileToast = document.getElementById("mobileToast");
let mobileData = window.mobileInitialData || { counters: {}, analytics: {}, records: [] };

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
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

function formatPeso(value) {
    const number = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(number)) return `PHP ${escapeHtml(value || "0")}`;
    return `PHP ${new Intl.NumberFormat("en", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(number)}`;
}

function showMobileToast(message, tone = "success") {
    if (!mobileToast) return;
    mobileToast.textContent = message;
    mobileToast.className = `mobile-toast ${tone}`;
    window.clearTimeout(showMobileToast.timer);
    showMobileToast.timer = window.setTimeout(() => {
        mobileToast.classList.add("hidden");
    }, 2800);
}

function mobileFilterParams() {
    const params = new URLSearchParams();
    if (!mobileFilterForm) return params;
    new FormData(mobileFilterForm).forEach((value, key) => {
        const text = String(value || "").trim();
        if (text) {
            params.set(key, text);
        }
    });
    return params;
}

function updateMobileCounters(counters = {}) {
    document.querySelectorAll("[data-mobile-counter]").forEach((counter) => {
        const key = counter.getAttribute("data-mobile-counter");
        counter.textContent = counters[key] ?? 0;
    });
}

function renderMobileImpact(analytics = {}) {
    if (mobileTotalCustomers) mobileTotalCustomers.textContent = analytics.totalCustomers ?? 0;
    if (mobileKwhrLoss) mobileKwhrLoss.textContent = analytics.totalKwhrLoss ?? 0;
    if (mobileRevenueLoss) mobileRevenueLoss.textContent = formatPeso(analytics.totalRevenueLoss ?? 0);
}

function recordMeta(record) {
    const restored = [record.restoredDate, record.restoredTime].filter(Boolean).join(" ");
    return restored ? `Restored ${restored}` : `Started ${record.startTime || "-"}`;
}

function renderMobileRecords(records = []) {
    if (!mobileRecordList) return;
    if (!records.length) {
        mobileRecordList.innerHTML = `
            <article class="mobile-empty-card">
                <strong>No interruption records found</strong>
                <span>Try another status or search term.</span>
            </article>
        `;
        return;
    }

    mobileRecordList.innerHTML = records.map((record) => `
        <article class="mobile-record-card status-${escapeHtml(record.status)}">
            <div class="mobile-record-head">
                <div>
                    <span>${escapeHtml(record.substation)} / ${escapeHtml(record.feeder)}</span>
                    <h3>${escapeHtml(record.affectedArea || record.name || "Interruption")}</h3>
                </div>
                <strong class="mobile-status-pill ${escapeHtml(record.status)}">${escapeHtml(record.actionTaken || record.statusLabel || record.status)}</strong>
            </div>
            <dl>
                <div><dt>Selected Pol ID</dt><dd>${escapeHtml(record.selectedPolId || "-")}</dd></div>
                <div><dt>Customers</dt><dd>${escapeHtml(record.customersAffected ?? 0)}</dd></div>
                <div><dt>Cause</dt><dd>${escapeHtml(formatCause(record.causeOfInterruption))}</dd></div>
                <div><dt>Duration</dt><dd>${record.durationMinutes !== "" ? `${escapeHtml(record.durationMinutes)} min` : "-"}</dd></div>
                <div><dt>KWHR Loss</dt><dd>${escapeHtml(record.estimatedKwhrLoss || "0")}</dd></div>
                <div><dt>Revenue Loss</dt><dd>${formatPeso(record.estimatedRevenueLoss || 0)}</dd></div>
            </dl>
            <p>${escapeHtml(record.remarks || "-")}</p>
            <div class="mobile-record-foot">
                <span>${escapeHtml(recordMeta(record))}</span>
                <a href="${escapeHtml(record.operationsUrl || "/operations")}">Open Map</a>
            </div>
        </article>
    `).join("");
}

function renderMobileApp(nextData) {
    mobileData = nextData || mobileData;
    updateMobileCounters(mobileData.counters || {});
    renderMobileImpact(mobileData.analytics || {});
    renderMobileRecords(mobileData.records || []);
    if (mobileUpdatedAt && mobileData.updatedAt) {
        mobileUpdatedAt.textContent = `Updated ${mobileData.updatedAt}`;
    }
}

async function refreshMobileRecords(options = {}) {
    if (mobileRefreshBtn) {
        mobileRefreshBtn.disabled = true;
        mobileRefreshBtn.textContent = "Refreshing...";
    }
    try {
        const params = mobileFilterParams();
        const url = params.toString() ? `/api/mobile/interruptions?${params.toString()}` : "/api/mobile/interruptions";
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not refresh records.");
        }
        renderMobileApp(data.mobile);
        if (options.toast) {
            showMobileToast(options.toast);
        }
    } catch (error) {
        showMobileToast(error.message || "Refresh failed.", "error");
    } finally {
        if (mobileRefreshBtn) {
            mobileRefreshBtn.disabled = false;
            mobileRefreshBtn.textContent = "Refresh";
        }
    }
}

mobileFilterForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void refreshMobileRecords({ toast: "Records refreshed." });
});

mobileFilterForm?.addEventListener("change", () => {
    void refreshMobileRecords();
});

renderMobileApp(mobileData);
window.setInterval(() => {
    void refreshMobileRecords();
}, 60000);
