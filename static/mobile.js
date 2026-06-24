const mobileRecordList = document.getElementById("mobileRecordList");
const mobileFilterForm = document.getElementById("mobileFilterForm");
const mobileRefreshBtn = document.getElementById("mobileRefreshBtn");
const mobilePolSearchForm = document.getElementById("mobilePolSearchForm");
const mobilePolSearchInput = document.getElementById("mobilePolSearchInput");
const mobileUploadedFeederSelect = document.getElementById("mobileUploadedFeederSelect");
const mobilePolSearchResult = document.getElementById("mobilePolSearchResult");
const mobileOpenCreateBtn = document.getElementById("mobileOpenCreateBtn");
const mobileCreateModal = document.getElementById("mobileCreateModal");
const mobileCloseCreateBtn = document.getElementById("mobileCloseCreateBtn");
const mobileCancelCreateBtn = document.getElementById("mobileCancelCreateBtn");
const mobileCreateForm = document.getElementById("mobileCreateForm");
const mobileCreateFeederId = document.getElementById("mobileCreateFeederId");
const mobileEditInterruptionId = document.getElementById("mobileEditInterruptionId");
const mobileCreatePolId = document.getElementById("mobileCreatePolId");
const mobileModalEyebrow = document.getElementById("mobileModalEyebrow");
const mobileCreateTitle = document.getElementById("mobileCreateTitle");
const mobileSubmitInterruptionBtn = document.getElementById("mobileSubmitInterruptionBtn");
const mobileCreateHint = document.getElementById("mobileCreateHint");
const mobileUpdatedAt = document.getElementById("mobileUpdatedAt");
const mobileTotalCustomers = document.getElementById("mobileTotalCustomers");
const mobileKwhrLoss = document.getElementById("mobileKwhrLoss");
const mobileRevenueLoss = document.getElementById("mobileRevenueLoss");
const mobileToast = document.getElementById("mobileToast");
let mobileData = window.mobileInitialData || { counters: {}, analytics: {}, records: [] };
let mobileUploadedFeeders = [];
let mobileModalMode = "create";

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

function applyPolToCreateForm(polId, options = {}) {
    const selectedPolId = String(polId || "").trim();
    if (!selectedPolId) return;
    if (mobileCreatePolId) {
        mobileCreatePolId.value = selectedPolId;
    }
    if (mobilePolSearchInput) {
        mobilePolSearchInput.value = selectedPolId;
    }
    if (mobileCreateFeederId && mobileUploadedFeederSelect?.value) {
        mobileCreateFeederId.value = mobileUploadedFeederSelect.value;
    }
}

function setMobileModalMode(mode, record = null) {
    mobileModalMode = mode === "edit" ? "edit" : "create";
    if (mobileCreateForm) {
        mobileCreateForm.dataset.mode = mobileModalMode;
    }
    document.querySelectorAll(".mobile-create-only-field").forEach((field) => {
        field.classList.toggle("hidden", mobileModalMode === "edit");
    });
    if (mobileModalEyebrow) {
        mobileModalEyebrow.textContent = mobileModalMode === "edit" ? "Edit interruption" : "Add interruption";
    }
    if (mobileCreateTitle) {
        mobileCreateTitle.textContent = mobileModalMode === "edit" ? "Update monitoring details" : "Field interruption details";
    }
    if (mobileSubmitInterruptionBtn) {
        mobileSubmitInterruptionBtn.textContent = mobileModalMode === "edit" ? "Save Changes" : "Save Interruption";
    }
    if (mobileCreateHint) {
        mobileCreateHint.textContent = mobileModalMode === "edit"
            ? "Changes update the selected monitoring record."
            : "Saved reports appear in monitoring immediately.";
    }
    if (mobileEditInterruptionId) {
        mobileEditInterruptionId.value = record?.id || "";
    }
    if (mobileCreatePolId) {
        mobileCreatePolId.readOnly = mobileModalMode === "edit";
    }
}

function openMobileCreateModal(polId = "", options = {}) {
    setMobileModalMode(options.mode || "create", options.record || null);
    if (polId) {
        applyPolToCreateForm(polId);
    }
    if (!mobileCreateModal) return;
    mobileCreateModal.classList.remove("hidden");
    document.body.classList.add("mobile-modal-open");
    window.setTimeout(() => {
        const focusTarget = mobileCreatePolId && !mobileCreatePolId.value
            ? mobileCreatePolId
            : (mobileModalMode === "edit"
                ? mobileCreateForm?.querySelector("[name='remarks']")
                : mobileCreateForm?.querySelector("[name='affected_area']")) || mobileCreateForm?.querySelector("select, input, textarea, button");
        focusTarget?.focus();
    }, 30);
}

function closeMobileCreateModal() {
    if (!mobileCreateModal) return;
    mobileCreateModal.classList.add("hidden");
    document.body.classList.remove("mobile-modal-open");
}

function openMobileEditModal(record) {
    if (!record || !mobileCreateForm) return;
    mobileCreateForm.reset();
    setMobileModalMode("edit", record);
    if (mobileCreatePolId) mobileCreatePolId.value = record.selectedPolId || "";
    const statusInput = mobileCreateForm.querySelector("[name='status']");
    if (statusInput) statusInput.value = record.status || "active";
    const causeInput = mobileCreateForm.querySelector("[name='cause_of_interruption']");
    if (causeInput) causeInput.value = record.causeOfInterruption || "unknown";
    const remarksInput = mobileCreateForm.querySelector("[name='remarks']");
    if (remarksInput) remarksInput.value = record.remarks || "";
    openMobileCreateModal(record.selectedPolId || "", { mode: "edit", record });
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
            <strong>Choose a feeder, then search the Pol ID.</strong>
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

function renderMobileUploadedFeeders(workspace = {}) {
    if (!mobileUploadedFeederSelect) return;
    mobileUploadedFeeders = Array.isArray(workspace.feeders) ? workspace.feeders : [];

    if (!mobileUploadedFeeders.length) {
        mobileUploadedFeederSelect.innerHTML = `
            <option value="">No uploaded feeders found</option>
        `;
        updatePolSearchResult(mobilePolSearchInput?.value || "", mobileData.records || []);
        return;
    }

    mobileUploadedFeederSelect.innerHTML = `
        <option value="">Choose uploaded feeder</option>
        ${mobileUploadedFeeders.map((feeder) => `
            <option value="${escapeHtml(feeder.id)}">${escapeHtml(feeder.displayName || feeder.feederCode)} - ${escapeHtml(feeder.filename || "")}</option>
        `).join("")}
    `;
}

async function loadMobileUploadedFeeders() {
    if (!mobileUploadedFeederSelect) return;
    try {
        const response = await fetch("/api/mobile/workspace-pol-ids");
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not load uploaded feeders.");
        }
        renderMobileUploadedFeeders(data.workspace || {});
    } catch (error) {
        mobileUploadedFeederSelect.innerHTML = `
            <option value="">Uploaded feeders unavailable</option>
        `;
        showMobileToast(error.message || "Could not load uploaded feeders.", "error");
    }
}

async function searchSelectedUploadedFeederPolId(term) {
    const feederId = String(mobileUploadedFeederSelect?.value || "").trim();
    const cleanTerm = String(term || "").trim();
    if (!feederId) {
        throw new Error("Choose an uploaded feeder first.");
    }
    if (!cleanTerm) {
        throw new Error("Enter a Pol ID to search.");
    }
    const params = new URLSearchParams({ q: cleanTerm });
    const response = await fetch(`/uploaded-feeders/${encodeURIComponent(feederId)}/search?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.message || "Could not search feeder.");
    }
    return data;
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
                    <button type="button" class="mobile-edit-record-btn" data-edit-interruption-id="${escapeHtml(record.id || "")}">Edit Interruption</button>
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

async function saveMobileInterruption() {
    if (!mobileCreateForm) return;
    const submitButton = mobileCreateForm.querySelector("button[type='submit']");
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = mobileModalMode === "edit" ? "Updating..." : "Saving...";
    }
    if (mobileCreateHint) {
        mobileCreateHint.textContent = mobileModalMode === "edit" ? "Updating monitoring record..." : "Saving field report...";
    }

    try {
        const formData = new FormData(mobileCreateForm);
        const payload = Object.fromEntries(formData.entries());
        const isEdit = mobileModalMode === "edit";
        const interruptionId = String(payload.interruption_id || "").trim();
        if (isEdit && !interruptionId) {
            throw new Error("No interruption record selected.");
        }
        const response = await fetch(isEdit ? `/interruptions/${encodeURIComponent(interruptionId)}/monitoring` : "/api/mobile/interruptions", {
            method: isEdit ? "PATCH" : "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRF-Token": window.mobileCsrfToken || payload.csrf_token || "",
            },
            body: JSON.stringify(isEdit ? {
                status: payload.status || "active",
                cause_of_interruption: payload.cause_of_interruption || "unknown",
                remarks: payload.remarks || "",
            } : payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || (isEdit ? "Could not update interruption." : "Could not save field report."));
        }
        mobileCreateForm.reset();
        closeMobileCreateModal();
        if (data.mobile) {
            renderMobileApp(data.mobile);
        } else {
            await refreshMobileRecords();
        }
        showMobileToast(isEdit ? "Interruption updated." : "Field report saved.");
        if (mobileCreateHint) {
            mobileCreateHint.textContent = "Saved reports appear in monitoring immediately.";
        }
    } catch (error) {
        showMobileToast(error.message || (mobileModalMode === "edit" ? "Update failed." : "Save failed."), "error");
        if (mobileCreateHint) {
            mobileCreateHint.textContent = error.message || (mobileModalMode === "edit" ? "Update failed." : "Save failed.");
        }
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = mobileModalMode === "edit" ? "Save Changes" : "Save Interruption";
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
    void (async () => {
        try {
            const data = await searchSelectedUploadedFeederPolId(term);
            const firstMatch = (data.results || [])[0];
            if (!firstMatch) {
                updatePolSearchResult(term, mobileData.records || []);
                showMobileToast("Pol ID was not found in the selected feeder.", "error");
                return;
            }
            applyPolToCreateForm(firstMatch.polId || term);
            if (mobileFilterForm) {
                const searchInput = mobileFilterForm.querySelector("input[name='search']");
                if (searchInput) searchInput.value = firstMatch.polId || term;
            }
            mobilePolSearchResult.innerHTML = `
                <span>${escapeHtml(data.feeder?.displayName || "Uploaded feeder")}</span>
                <strong>${escapeHtml(firstMatch.polId || term)}</strong>
                <small>Pol ID found. Tap Add Interruption when ready.</small>
            `;
            await refreshMobileRecords();
        } catch (error) {
            showMobileToast(error.message || "Search failed.", "error");
        }
    })();
});

mobileUploadedFeederSelect?.addEventListener("change", () => {
    if (mobileCreateFeederId) {
        mobileCreateFeederId.value = mobileUploadedFeederSelect.value || "";
    }
    updatePolSearchResult(mobilePolSearchInput?.value || "", mobileData.records || []);
});

mobileRecordList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-interruption-id]");
    if (!button) return;
    const interruptionId = String(button.getAttribute("data-edit-interruption-id") || "").trim();
    const record = (mobileData.records || []).find((item) => String(item.id) === interruptionId);
    if (!record) {
        showMobileToast("Could not find that interruption record.", "error");
        return;
    }
    openMobileEditModal(record);
});

mobileCreateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveMobileInterruption();
});

mobileOpenCreateBtn?.addEventListener("click", () => {
    setMobileModalMode("create");
    mobileCreateForm?.reset();
    if (mobileCreateFeederId && mobileUploadedFeederSelect?.value) {
        mobileCreateFeederId.value = mobileUploadedFeederSelect.value;
    }
    const selectedPolId = String(mobileCreatePolId?.value || mobilePolSearchInput?.value || "").trim();
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
void loadMobileUploadedFeeders();
window.setInterval(() => {
    void refreshMobileRecords();
}, 60000);
