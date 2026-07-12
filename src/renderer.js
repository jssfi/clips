let state;
const $ = (id) => document.getElementById(id);
const values = () => ({
  recordingsFolder: $("folder").value,
  retentionDays: Number($("days").value),
  clipLengthSeconds: Number($("clip-length").value),
  clipHotkey: $("hotkey").value,
  stopDelaySeconds: Number($("delay").value),
  autoRecord: $("auto").checked,
  startWithWindows: $("startup").checked,
  obsPort: Number($("port").value),
  obsPassword: $("password").value,
  audioExecutables: $("audio-exes")
    .value.split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean),
  gameExecutables: state.settings.gameExecutables,
});
function render(s, fill = false) {
  state = s;
  const online = s.obs.connected;
  $("connection").textContent = online ? "OBS connected" : "OBS offline";
  $("connection-dot").classList.toggle("online", online);
  $("record-indicator").classList.toggle("live", s.obs.recording);
  $("record").textContent = s.obs.recording
    ? "Stop recording"
    : "Start recording";
  $("status").textContent = s.obs.recording
    ? "Recording"
    : s.activeGames.length
      ? "Game detected"
      : "Waiting for a game";
  $("detail").textContent = s.activeGames.length
    ? s.activeGames.join(", ")
    : "Monitoring configured games";
  $("error").textContent = s.lastError
    ? s.lastError.includes("Replay Buffer")
      ? `${s.lastError} Restart OBS once to apply the recording profile change.`
      : `${s.lastError} Check OBS connection settings.`
    : "";
  $("error").classList.toggle("hidden", !s.lastError);
  $("game-list").innerHTML = s.settings.gameExecutables.length
    ? s.settings.gameExecutables
        .map(
          (x, i) =>
            `<div class="chip"><span>${escapeHtml(x)}</span><button data-remove="${i}" aria-label="Remove ${escapeHtml(x)}">×</button></div>`,
        )
        .join("")
    : '<div class="muted">No games added. Add a running game to begin.</div>';
  const recordings = s.recordings || [];
  const replays = recordings.filter((item) => item.kind === "replay");
  const fullRecordings = recordings.filter((item) => item.kind !== "replay");
  $("library-summary").textContent = recordings.length
    ? `${replays.length} replay${replays.length === 1 ? "" : "s"} and ${fullRecordings.length} full recording${fullRecordings.length === 1 ? "" : "s"} today.`
    : "Recordings from this session.";
  const renderFiles = (items, emptyTitle, emptyDetail) => items.length
    ? items.map((recording) => {
        const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(recording.modified));
        const size = recording.bytes >= 1073741824
          ? new Intl.NumberFormat(undefined, { style: "unit", unit: "gigabyte", maximumFractionDigits: 1 }).format(recording.bytes / 1073741824)
          : new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(recording.bytes / 1048576);
        return `<button class="recording-card" data-recording-path="${escapeHtml(recording.path)}" aria-label="Open ${escapeHtml(recording.name)}"><div class="recording-thumb" aria-hidden="true">&#9654;</div><div class="recording-meta"><strong title="${escapeHtml(recording.name)}">${escapeHtml(recording.name)}</strong><span>${time} &middot; ${size}</span></div></button>`;
      }).join("")
    : `<div class="empty compact"><div><strong>${emptyTitle}</strong><span>${emptyDetail}</span></div></div>`;
  $("replay-count").textContent = replays.length;
  $("recording-count").textContent = fullRecordings.length;
  $("replay-list").innerHTML = renderFiles(replays, "No replays yet", "Use the clip shortcut to save one.");
  $("recording-list").innerHTML = renderFiles(fullRecordings, "No full recordings", "A session appears here when recording starts.");
  $("footer-status").textContent = s.lastClip
    ? `Clip saved ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(s.lastClip))}`
    : "Monitoring in background";
  $("clip-key").textContent = s.settings.clipHotkey
    .replace("CommandOrControl", "Ctrl")
    .replaceAll("+", " ");
  if (fill) {
    $("folder").value = s.settings.recordingsFolder;
    $("days").value = s.settings.retentionDays;
    $("clip-length").value = s.settings.clipLengthSeconds;
    $("hotkey").value = s.settings.clipHotkey;
    $("delay").value = s.settings.stopDelaySeconds;
    $("auto").checked = s.settings.autoRecord;
    $("startup").checked = s.settings.startWithWindows;
    $("port").value = s.settings.obsPort;
    $("password").value = s.settings.obsPassword;
    $("audio-exes").value = s.settings.audioExecutables.join("\n");
  }
}
const escapeHtml = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
document.querySelectorAll(".tab").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".tab,.panel")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $(b.dataset.tab).classList.add("active");
    }),
);
$("game-list").onclick = async (e) => {
  if (e.target.dataset.remove != null) {
    state.settings.gameExecutables.splice(Number(e.target.dataset.remove), 1);
    render(await window.clippy.saveSettings(values()), true);
  }
};
$("scan").onclick = async () => {
  const list = await window.clippy.listProcesses();
  $("process-picker").innerHTML = list
    .map(
      (p) =>
        `<button data-exe="${escapeHtml(p.name)}">${escapeHtml(p.title)} <span class="muted">${escapeHtml(p.path || `${p.name} · protected process`)}</span></button>`,
    )
    .join("");
  $("process-picker").classList.remove("hidden");
};
$("process-picker").onclick = async (e) => {
  const b = e.target.closest("[data-exe]");
  if (
    b &&
    !state.settings.gameExecutables.some(
      (x) => x.toLowerCase() === b.dataset.exe.toLowerCase(),
    )
  ) {
    state.settings.gameExecutables.push(b.dataset.exe);
    $("process-picker").classList.add("hidden");
    render(await window.clippy.saveSettings(values()), true);
  }
};
$("browse").onclick = async () => {
  const f = await window.clippy.chooseFolder();
  if (f) $("folder").value = f;
};
$("save").onclick = async () =>
  render(await window.clippy.saveSettings(values()), true);
$("connect").onclick = async () => {
  await window.clippy.saveSettings(values());
  render(await window.clippy.connect());
};
$("record").onclick = async () => render(await window.clippy.toggleRecording());
$("clip").onclick = async () => render(await window.clippy.saveClip());
$("open-obs").onclick = () => window.clippy.openObs();
$("open-folder").onclick = () => window.clippy.openFolder();
$("library-folder").onclick = () => window.clippy.openFolder();
const openRecording = async (event) => {
  const card = event.target.closest("[data-recording-path]");
  if (card) await window.clippy.openRecording(card.dataset.recordingPath);
};
$("recording-list").onclick = openRecording;
$("replay-list").onclick = openRecording;
window.clippy.onState((s) => render(s));
window.clippy.getState().then((s) => render(s, true));
setInterval(() => window.clippy.getState().then((s) => render(s)), 2000);
