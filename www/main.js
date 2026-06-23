const serverForm = document.getElementById("serverForm");
const serverUrlInput = document.getElementById("serverUrl");
const clearServerBtn = document.getElementById("clearServerBtn");
const statusText = document.getElementById("statusText");
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
