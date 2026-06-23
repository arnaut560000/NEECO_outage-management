const mobileRecordList = document.getElementById("mobileRecordList");
const mobileFilterForm = document.getElementById("mobileFilterForm");
const mobileRefreshBtn = document.getElementById("mobileRefreshBtn");
const mobilePolSearchForm = document.getElementById("mobilePolSearchForm");
const mobilePolSearchInput = document.getElementById("mobilePolSearchInput");
const mobileWorkspacePoleSelect = document.getElementById("mobileWorkspacePoleSelect");
const mobilePolSearchResult = document.getElementById("mobilePolSearchResult");
const mobileOpenCreateBtn = document.getElementById("mobileOpenCreateBtn");
const mobileCreateModal = document.getElementById("mobileCreateModal");
const mobileCloseCreateBtn = document.getElementById("mobileCloseCreateBtn");
const mobileCancelCreateBtn = document.getElementById("mobileCancelCreateBtn");
const mobileCreateForm = document.getElementById("mobileCreateForm");
const mobileCreatePolId = document.getElementById("mobileCreatePolId");
const mobileCreateHint = document.getElementById("mobileCreateHint");
const mobileUpdatedAt = document.getElementById("mobileUpdatedAt");
const mobileTotalCustomers = document.getElementById("mobileTotalCustomers");
const mobileKwhrLoss = document.getElementById("mobileKwhrLoss");
const mobileRevenueLoss = document.getElementById("mobileRevenueLoss");
const mobileToast = document.getElementById("mobileToast");
let mobileData = window.mobileInitialData || { counters: {}, analytics: {}, records: [] };
let mobileWorkspacePolOptions = [];

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

function getSelectedWorkspaceOption(polId) {
    const selectedPolId = String(polId || "").trim();
    if (!selectedPolId) return null;
    return mobileWorkspacePolOptions.find((option) => (
        String(option.value || "").toLowerCase() === selectedPolId.toLowerCase()
    )) || null;
}

function applyPolToCreateForm(polId, options = {}) {
    const selectedPolId = String(polId || "").trim();
    if (!selectedPolId) return;
    if (mobileCreatePolId) {
        mobileCreatePolId.value = selectedPolId;
    }
    if (mobilePolSearchInput) {
        mobilePolSearchInput.value = selectedPolId;
    }
    const selectedOption = getSelectedWorkspaceOption(selectedPolId);
    const areaInput = mobileCreateForm?.querySelector("[name='affected_area']");
    if (areaInput && selectedOption?.area && (options.replaceArea || !areaInput.value)) {
        areaInput.value = selectedOption.area;
    }
}

function openMobileCreateModal(polId = "") {
    if (polId) {
        applyPolToCreateForm(polId);
    }
    if (!mobileCreateModal) return;
    mobileCreateModal.classList.remove("hidden");
    document.body.classList.add("mobile-modal-open");
    window.setTimeout(() => {
        const focusTarget = mobileCreatePolId && !mobileCreatePolId.value
            ? mobileCreatePolId
            : mobileCreateForm?.querySelector("[name='affected_area']") || mobileCreateForm?.querySelector("select, input, textarea, button");
        focusTarget?.focus();
    }, 30);
}

function closeMobileCreateModal() {
    if (!mobileCreateModal) return;
    mobileCreateModal.classList.add("hidden");
    document.body.classList.remove("mobile-modal-open");
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

function updatePolSearchResult(term, records = []) {
    if (!mobilePolSearchResult) return;
    const cleanTerm = String(term || "").trim();
    const selectedWorkspacePol = mobileWorkspacePolOptions.find((option) => (
        String(option.value || "").toLowerCase() === cleanTerm.toLowerCase()
    ));
    const match = records.find((record) => {
        const haystack = [
            record.selectedPolId,
            record.feeder,
            record.substation,
            record.affectedArea,
            record.name,
        ].join(" ").toLowerCase();
        return cleanTerm && haystack.includes(cleanTerm.toLowerCase());
    });

    if (!cleanTerm) {
        mobilePolSearchResult.innerHTML = `
            <span>Ready</span>
            <strong>Select from uploaded feeder or search manually.</strong>
        `;
        return;
    }

    if (selectedWorkspacePol) {
        mobilePolSearchResult.innerHTML = `
            <span>Uploaded feeder match</span>
            <strong>${escapeHtml(selectedWorkspacePol.value)}</strong>
            <small>${escapeHtml(selectedWorkspacePol.area || selectedWorkspacePol.source || "Ready for field report")}</small>
        `;
        return;
    }

    if (!match) {
        mobilePolSearchResult.innerHTML = `
            <span>No saved monitoring match</span>
            <strong>${escapeHtml(cleanTerm)}</strong>
            <small>You can still save a new field report for this Pol ID.</small>
        `;
        return;
    }

    mobilePolSearchResult.innerHTML = `
        <span>${escapeHtml(match.statusLabel || match.status || "Record")}</span>
        <strong>${escapeHtml(match.selectedPolId || match.affectedArea || cleanTerm)}</strong>
        <small>${escapeHtml(match.affectedArea || match.name || "-")}</small>
    `;
}

function renderWorkspacePolOptions(workspace = {}) {
    if (!mobileWorkspacePoleSelect) return;
    mobileWorkspacePolOptions = Array.isArray(workspace.options) ? workspace.options : [];
    const feederName = workspace.feederFileName || "Uploaded feeder";

    if (!mobileWorkspacePolOptions.length) {
        mobileWorkspacePoleSelect.innerHTML = `
            <option value="">No uploaded feeder Pol IDs found</option>
        `;
        updatePolSearchResult(mobilePolSearchInput?.value || "", mobileData.records || []);
        return;
    }

    const optionsHtml = mobileWorkspacePolOptions.map((option) => {
        const area = option.area ? ` - ${option.area}` : "";
        return `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label || option.value)}${escapeHtml(area)}</option>`;
    }).join("");

    mobileWorkspacePoleSelect.innerHTML = `
        <option value="">${escapeHtml(feederName)} (${mobileWorkspacePolOptions.length} Pol IDs)</option>
        ${optionsHtml}
    `;
}

async function loadWorkspacePolOptions() {
    if (!mobileWorkspacePoleSelect) return;
    try {
        const response = await fetch("/api/mobile/workspace-pol-ids");
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not load uploaded feeder.");
        }
        renderWorkspacePolOptions(data.workspace || {});
    } catch (error) {
        mobileWorkspacePoleSelect.innerHTML = `
            <option value="">Uploaded feeder unavailable</option>
        `;
        showMobileToast(error.message || "Could not load uploaded feeder.", "error");
    }
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
                <div>
                    <button type="button" data-copy-pol="${escapeHtml(record.selectedPolId || "")}">Add Interruption</button>
                    <a href="${escapeHtml(record.operationsUrl || "/operations")}">Open Map</a>
                </div>
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

async function createMobileInterruption() {
    if (!mobileCreateForm) return;
    const submitButton = mobileCreateForm.querySelector("button[type='submit']");
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Saving...";
    }
    if (mobileCreateHint) {
        mobileCreateHint.textContent = "Saving field report...";
    }

    try {
        const formData = new FormData(mobileCreateForm);
        const payload = Object.fromEntries(formData.entries());
        const response = await fetch("/api/mobile/interruptions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": window.mobileCsrfToken || payload.csrf_token || "",
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not save field report.");
        }
        mobileCreateForm.reset();
        closeMobileCreateModal();
        renderMobileApp(data.mobile);
        showMobileToast("Field report saved.");
        if (mobileCreateHint) {
            mobileCreateHint.textContent = "Saved reports appear in monitoring immediately.";
        }
    } catch (error) {
        showMobileToast(error.message || "Save failed.", "error");
        if (mobileCreateHint) {
            mobileCreateHint.textContent = error.message || "Save failed.";
        }
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "Save Interruption";
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

mobilePolSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = String(mobilePolSearchInput?.value || "").trim();
    if (mobileFilterForm) {
        const searchInput = mobileFilterForm.querySelector("input[name='search']");
        if (searchInput) searchInput.value = term;
    }
    if (mobileCreatePolId && term) {
        applyPolToCreateForm(term);
    }
    updatePolSearchResult(term, mobileData.records || []);
    void refreshMobileRecords({ toast: term ? "Search applied." : "Search cleared." });
});

mobileWorkspacePoleSelect?.addEventListener("change", () => {
    const selectedPolId = String(mobileWorkspacePoleSelect.value || "").trim();
    applyPolToCreateForm(selectedPolId, { replaceArea: true });
    updatePolSearchResult(selectedPolId, mobileData.records || []);
});

mobileRecordList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-pol]");
    if (!button || !mobileCreatePolId) return;
    const polId = String(button.getAttribute("data-copy-pol") || "").trim();
    if (!polId || polId === "-") return;
    applyPolToCreateForm(polId);
    openMobileCreateModal(polId);
});

mobileCreateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createMobileInterruption();
});

mobileOpenCreateBtn?.addEventListener("click", () => {
    const selectedPolId = String(mobileCreatePolId?.value || mobilePolSearchInput?.value || mobileWorkspacePoleSelect?.value || "").trim();
    openMobileCreateModal(selectedPolId);
});

mobileCloseCreateBtn?.addEventListener("click", closeMobileCreateModal);
mobileCancelCreateBtn?.addEventListener("click", closeMobileCreateModal);
mobileCreateModal?.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-mobile-modal]")) {
        closeMobileCreateModal();
    }
});

window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileCreateModal && !mobileCreateModal.classList.contains("hidden")) {
        closeMobileCreateModal();
    }
});

renderMobileApp(mobileData);
void loadWorkspacePolOptions();
window.setInterval(() => {
    void refreshMobileRecords();
}, 60000);
