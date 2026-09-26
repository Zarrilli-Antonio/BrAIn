const $ = (id) => document.getElementById(id);
const steps = ["welcome", "folder", "projects", "profile", "done"];

function showStep(name) {
  for (const s of steps) $(`step-${s}`).classList.toggle("active", s === name);
}

let chosenFolder = null;
let chosenProfile = "dev";
let chosenAiClient = "claude-code";
const AI_LABELS = { "claude-code": "Claude Code", cursor: "Cursor", gemini: "Gemini", local: "Local model" };
// Where the profile-choice step should go once "Set Up BrAIn" finishes: the standalone
// first-run wizard (-> step-done, with a Quit button) or the "Add Folder" button inside the
// projects panel (-> back to the (now refreshed) project list, no Quit).
let profileFlowOrigin = "new";

$("btn-start").onclick = () => {
  profileFlowOrigin = "new";
  showStep("folder");
};
$("btn-folder-back").onclick = () => showStep("welcome");
$("btn-profile-back").onclick = () => showStep(profileFlowOrigin === "existing" ? "projects" : "folder");

$("btn-choose-folder").onclick = async () => {
  const folder = await window.brainInstaller.chooseFolder();
  if (!folder) return;
  chosenFolder = folder;
  $("folder-path").textContent = folder;
  $("btn-folder-next").disabled = false;
};

$("btn-folder-next").onclick = () => showStep("profile");

document.querySelectorAll(".profile-card").forEach((card) => {
  card.onclick = () => {
    document.querySelectorAll(".profile-card").forEach((c) => c.classList.remove("selected"));
    card.classList.add("selected");
    chosenProfile = card.dataset.profile;
  };
});

document.querySelectorAll(".ai-pill").forEach((pill) => {
  pill.onclick = () => {
    document.querySelectorAll(".ai-pill").forEach((c) => c.classList.remove("selected"));
    pill.classList.add("selected");
    chosenAiClient = pill.dataset.ai;
  };
});

async function runSetup() {
  showStep("done");
  $("done-title").textContent = "Setting up…";
  $("error").textContent = "";
  $("log").textContent = `Folder: ${chosenFolder}\nProfile: ${chosenProfile}\nAI: ${AI_LABELS[chosenAiClient]}\n\nWriting configuration and starting BrAIn...`;
  $("btn-done-back-to-projects").style.display = "";
  $("btn-quit").style.display = "";
  try {
    const { port, mcpError } = await window.brainInstaller.setupProject(chosenFolder, chosenProfile, chosenAiClient);
    $("done-title").textContent = "BrAIn is running";
    $("log").textContent =
      `Folder: ${chosenFolder}\nProfile: ${chosenProfile}\nAI: ${AI_LABELS[chosenAiClient]}\n\n` +
      `Profile saved, drag-and-drop launcher written, ${AI_LABELS[chosenAiClient]} MCP registered.\n` +
      `Opened in its own window (also reachable at http://localhost:${port}).\n\n` +
      `Next time, reopen it from "Open Existing Projects" — or just run start-brain.sh inside that folder.`;
    if (mcpError) $("error").textContent = `MCP setup had a problem (BrAIn itself is still running fine): ${mcpError}`;
  } catch (e) {
    $("done-title").textContent = "Something went wrong";
    $("log").textContent = "";
    $("error").textContent = e.message || String(e);
  }
}

$("btn-setup").onclick = runSetup;
$("btn-quit").onclick = () => window.close();
$("btn-done-back-to-projects").onclick = () => { showStep("projects"); loadProjects(); };

// --- Projects panel ---

$("btn-open-existing").onclick = () => { showStep("projects"); loadProjects(); };
$("btn-projects-back").onclick = () => showStep("welcome");

function renderProjectRow(p) {
  const row = document.createElement("div");
  row.className = p.profile === "notes" ? "project-row notes" : "project-row";
  row.innerHTML = `
    <div class="project-info">
      <div class="project-name"></div>
      <div class="project-path"></div>
    </div>
    <span class="badge"></span>
    <select class="ai-select profile-select" title="Dev/Notes — changes tabs and look; a running server picks it up next time it (re)starts">
      <option value="dev">Dev</option>
      <option value="notes">Notes</option>
    </select>
    <select class="ai-select" title="AI assistant — switching creates that assistant's config file without deleting the old one">
      <option value="claude-code">Claude Code</option>
      <option value="cursor">Cursor</option>
      <option value="gemini">Gemini</option>
      <option value="local">Local model</option>
    </select>
    <button class="btn-open-row">${p.running ? "Focus" : "Open"}</button>
    <button class="btn-remove-row" title="Remove from this list">×</button>
  `;
  row.querySelector(".project-name").textContent = p.name;
  row.querySelector(".project-path").textContent = p.path;
  row.querySelector(".project-path").title = p.path;
  const badge = row.querySelector(".badge");
  badge.textContent = p.running ? `${p.profile} · running` : p.profile;
  badge.classList.toggle("running", p.running);
  const profileSelect = row.querySelector(".profile-select");
  profileSelect.value = p.profile;
  profileSelect.onchange = async () => {
    await window.brainInstaller.changeProfile(p.path, profileSelect.value);
    loadProjects();
  };
  const aiSelect = row.querySelector(".ai-select:not(.profile-select)");
  aiSelect.value = p.aiClient;
  aiSelect.onchange = async () => {
    await window.brainInstaller.changeAiClient(p.path, aiSelect.value);
    loadProjects();
  };
  row.querySelector(".btn-open-row").onclick = async () => {
    await window.brainInstaller.openProject(p.path);
    loadProjects();
  };
  row.querySelector(".btn-remove-row").onclick = async () => {
    await window.brainInstaller.removeProject(p.path);
    loadProjects();
  };
  return row;
}

async function loadProjects() {
  const list = $("project-list");
  const projects = await window.brainInstaller.listProjects();
  list.innerHTML = "";
  if (projects.length === 0) {
    list.innerHTML = '<p class="empty-hint">No projects yet — add one below.</p>';
    return;
  }
  for (const p of projects) list.appendChild(renderProjectRow(p));
}

// Panel's "running" badges go stale once a project starts/stops elsewhere — poll while visible.
setInterval(() => {
  if ($("step-projects").classList.contains("active")) loadProjects();
}, 3000);

$("btn-add-folder").onclick = async () => {
  const folder = await window.brainInstaller.chooseFolder();
  if (!folder) return;
  const alreadySetUp = await window.brainInstaller.hasProfile(folder);
  if (alreadySetUp) {
    await window.brainInstaller.openProject(folder);
    loadProjects();
    return;
  }
  chosenFolder = folder;
  chosenProfile = "dev";
  chosenAiClient = "claude-code";
  document.querySelectorAll(".profile-card").forEach((c) => c.classList.toggle("selected", c.dataset.profile === "dev"));
  document.querySelectorAll(".ai-pill").forEach((c) => c.classList.toggle("selected", c.dataset.ai === "claude-code"));
  profileFlowOrigin = "existing";
  showStep("profile");
};
