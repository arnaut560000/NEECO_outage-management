const serverForm = document.getElementById("serverForm");
const serverUrlInput = document.getElementById("serverUrl");
const clearServerBtn = document.getElementById("clearServerBtn");
const statusText = document.getElementById("statusText");
const connectionBadge = document.getElementById("connectionBadge");
const storageKey = "neecoMonitoringServerUrl";

function normalizeServerUrl(value) {
  let url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/g, "");
}

function setStatus(message, tone = "") {
  statusText.textContent = message;
  statusText.className = tone;
  if (connectionBadge) {
    connectionBadge.textContent = tone === "error" ? "Check address" : (message ? "Ready" : "Not connected");
    connectionBadge.className = tone === "error" ? "error" : "";
  }
}

function openMobileApp(serverUrl) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  if (!normalizedUrl) {
    setStatus("Enter the server address printed by run_lan.ps1.", "error");
    return;
  }

  localStorage.setItem(storageKey, normalizedUrl);
  setStatus(`Opening ${normalizedUrl}/mobile ...`);
  window.location.href = `${normalizedUrl}/mobile`;
}

const savedServerUrl = localStorage.getItem(storageKey) || "";
if (savedServerUrl) {
  serverUrlInput.value = savedServerUrl;
  setStatus("Saved server address ready.");
}

serverForm.addEventListener("submit", (event) => {
  event.preventDefault();
  openMobileApp(serverUrlInput.value);
});

clearServerBtn.addEventListener("click", () => {
  localStorage.removeItem(storageKey);
  serverUrlInput.value = "";
  setStatus("Saved address cleared.");
  serverUrlInput.focus();
});
