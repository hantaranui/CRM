const TABLES = {
  organisations: "CRM_Organisations",
  contacts: "CRM_Contacts",
  interactions: "CRM_Interactions",
  tasks: "CRM_Taches",
  stages: "CRM_Etapes",
  priorities: "CRM_Priorites",
  referents: "CRM_Referents",
  referentRoles: "CRM_Roles_Referents",
  notifications: "CRM_Notifications",
  config: "CRM_Config"
};

const BUILD_VERSION = "crm-widget-no-demo-20260624-e";

const DEFAULT_STAGES = [
  { Nom: "Premier contact", Ordre: 1, Couleur: "#6366f1", Declenche_relance: false, Actif: true },
  { Nom: "Negociation", Ordre: 2, Couleur: "#3b82f6", Declenche_relance: false, Actif: true },
  { Nom: "Signature", Ordre: 3, Couleur: "#8b5cf6", Declenche_relance: false, Actif: true },
  { Nom: "A relancer", Ordre: 4, Couleur: "#f59e0b", Declenche_relance: true, Actif: true },
  { Nom: "Contrat signe", Ordre: 5, Couleur: "#10b981", Declenche_relance: false, Actif: true }
];

const DEFAULT_PRIORITIES = [
  { Nom: "Basse", Ordre: 1, Couleur: "#64748b" },
  { Nom: "Moyenne", Ordre: 2, Couleur: "#6366f1" },
  { Nom: "Haute", Ordre: 3, Couleur: "#ef4444" }
];

const DEFAULT_REFERENT_ROLES = [
  { Nom: "Responsable", Ordre: 1, Actif: true },
  { Nom: "Referent", Ordre: 2, Actif: true },
  { Nom: "Commercial", Ordre: 3, Actif: true },
  { Nom: "Support", Ordre: 4, Actif: true }
];

function stageChoices() {
  return pipelineStages.length ? stageNames() : DEFAULT_STAGES.map((stage) => stage.Nom);
}

function priorityChoices() {
  return DEFAULT_PRIORITIES.map((priority) => priority.Nom);
}

function roleChoices() {
  const roles = referentRoles.filter((role) => role.active !== false).map((role) => role.name).filter(Boolean);
  return roles.length ? roles : DEFAULT_REFERENT_ROLES.map((role) => role.Nom);
}

let isGrist = false;
let activeClientId = null;
let activeFilter = "Tous";
let clients = [];
let contacts = [];
let tasks = [];
let interactions = [];
let pipelineStages = [];
let teamMembers = [];
let referentRoles = [];
let liveReloadTimer = null;

const clientList = document.querySelector("#clientList");
const clientCount = document.querySelector("#clientCount");
const searchInput = document.querySelector("#searchInput");
const filters = document.querySelectorAll(".filter");
const viewTabs = document.querySelectorAll(".view-tab");
const stageForm = document.querySelector("#stageForm");
const memberForm = document.querySelector("#memberForm");
const roleForm = document.querySelector("#roleForm");
const environmentNotice = document.querySelector("#environmentNotice");
const createClientPanel = document.querySelector("#createClientPanel");
const createClientForm = document.querySelector("#createClientForm");

function insideGrist() {
  try {
    return window !== window.parent;
  } catch (error) {
    return true;
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function toRows(tableData) {
  if (!tableData) return [];
  if (Array.isArray(tableData)) return tableData;
  if (Array.isArray(tableData.records)) {
    return tableData.records.map((record) => ({ id: record.id, ...(record.fields || {}) }));
  }
  if (!tableData.id) return [];
  return tableData.id.map((id, index) => {
    const row = { id };
    Object.keys(tableData).forEach((key) => {
      if (key !== "id") row[key] = tableData[key][index];
    });
    return row;
  });
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function safeFetchTable(tableName) {
  try {
    return toRows(await grist.docApi.fetchTable(tableName));
  } catch (error) {
    console.warn("Lecture table impossible", tableName, error.message);
    setNotice(`Lecture impossible de ${tableName} (${BUILD_VERSION}) : ${error.message}`, "error");
    return [];
  }
}

async function ensureTable(tableName, columns) {
  const existingTables = await grist.docApi.listTables();
  if (existingTables.includes(tableName)) return;
  await grist.docApi.applyUserActions([["AddTable", tableName, columns]]);
}

async function ensureColumn(tableName, columnId, spec) {
  try {
    const data = await grist.docApi.fetchTable(tableName);
    if (Object.keys(data).includes(columnId)) return;
    await grist.docApi.applyUserActions([["AddColumn", tableName, columnId, spec]]);
  } catch (error) {
    console.warn("Migration ignoree", tableName, columnId, error.message);
  }
}

async function modifyColumn(tableName, columnId, spec) {
  try {
    await grist.docApi.applyUserActions([["ModifyColumn", tableName, columnId, spec]]);
  } catch (error) {
    console.warn("Modification colonne ignoree", tableName, columnId, error.message);
  }
}

async function seedIfEmpty(tableName, rows) {
  const existing = await safeFetchTable(tableName);
  if (existing.length || !rows.length) return;
  await grist.docApi.applyUserActions([
    ["BulkAddRecord", tableName, rows.map(() => null), rows]
  ]);
}

async function ensureCrmTables() {
  setNotice("Creation/verif des tables CRM_Etapes, CRM_Organisations, CRM_Referents...");
  await ensureTable(TABLES.stages, [
    { id: "Nom", type: "Text" },
    { id: "Ordre", type: "Int" },
    { id: "Couleur", type: "Text" },
    { id: "Declenche_relance", type: "Bool" },
    { id: "Actif", type: "Bool" }
  ]);

  await ensureTable(TABLES.priorities, [
    { id: "Nom", type: "Text" },
    { id: "Ordre", type: "Int" },
    { id: "Couleur", type: "Text" }
  ]);

  await ensureTable(TABLES.referents, [
    { id: "Nom", type: "Text" },
    { id: "Email", type: "Text" },
    { id: "Role", type: "Choice", widgetOptions: JSON.stringify({ choices: DEFAULT_REFERENT_ROLES.map((role) => role.Nom) }) },
    { id: "Actif", type: "Bool" }
  ]);

  await ensureTable(TABLES.referentRoles, [
    { id: "Nom", type: "Text" },
    { id: "Ordre", type: "Int" },
    { id: "Actif", type: "Bool" }
  ]);

  await ensureTable(TABLES.organisations, [
    { id: "Nom", type: "Text" },
    { id: "Typologie", type: "Choice", widgetOptions: JSON.stringify({ choices: ["Prospect", "Client", "Ancien client", "Partenaire"] }) },
    { id: "Statut", type: "Choice", widgetOptions: JSON.stringify({ choices: DEFAULT_STAGES.map((stage) => stage.Nom) }) },
    { id: "Priorite", type: "Choice", widgetOptions: JSON.stringify({ choices: priorityChoices() }) },
    { id: "Referent", type: "Text" },
    { id: "Email_principal", type: "Text" },
    { id: "Telephone", type: "Text" },
    { id: "Site_web", type: "Text" },
    { id: "Montant", type: "Numeric" },
    { id: "Prochaine_action", type: "Date" },
    { id: "Notes_generales", type: "Text" }
  ]);

  await ensureTable(TABLES.contacts, [
    { id: "Organisation", type: "Ref:CRM_Organisations" },
    { id: "Nom_complet", type: "Text" },
    { id: "Role", type: "Text" },
    { id: "Email", type: "Text" },
    { id: "Telephone", type: "Text" },
    { id: "Contact_principal", type: "Bool" },
    { id: "Actif", type: "Bool" }
  ]);

  await ensureTable(TABLES.tasks, [
    { id: "Organisation", type: "Ref:CRM_Organisations" },
    { id: "Action", type: "Text" },
    { id: "Canal", type: "Choice", widgetOptions: JSON.stringify({ choices: ["Email", "Telephone", "Message", "Reunion", "Interne"] }) },
    { id: "Echeance", type: "Date" },
    { id: "Statut", type: "Choice", widgetOptions: JSON.stringify({ choices: ["A faire", "En cours", "Fait", "Annule"] }) },
    { id: "Priorite", type: "Text" },
    { id: "Assigne_a", type: "Text" }
  ]);

  await ensureTable(TABLES.interactions, [
    { id: "Organisation", type: "Ref:CRM_Organisations" },
    { id: "Date", type: "DateTime" },
    { id: "Canal", type: "Choice", widgetOptions: JSON.stringify({ choices: ["Email", "Telephone", "Reunion", "Note", "Statut"] }) },
    { id: "Sujet", type: "Text" },
    { id: "Compte_rendu", type: "Text" },
    { id: "Auteur", type: "Text" }
  ]);

  await ensureTable(TABLES.notifications, [
    { id: "Organisation", type: "Ref:CRM_Organisations" },
    { id: "Recipient_Email", type: "Text" },
    { id: "Subject", type: "Text" },
    { id: "Message", type: "Text" },
    { id: "Type", type: "Text" },
    { id: "Is_Read", type: "Bool" },
    { id: "Email_Status", type: "Text" },
    { id: "Created_At", type: "DateTime" }
  ]);

  await ensureTable(TABLES.config, [
    { id: "Config_Key", type: "Text" },
    { id: "Table_Name", type: "Text" },
    { id: "Column_Name", type: "Text" },
    { id: "Display_Label", type: "Text" },
    { id: "Required", type: "Bool" },
    { id: "Default_Value", type: "Text" }
  ]);

  await ensureColumn(TABLES.organisations, "Montant", { type: "Numeric" });
  await ensureColumn(TABLES.organisations, "Statut", { type: "Choice", widgetOptions: JSON.stringify({ choices: DEFAULT_STAGES.map((stage) => stage.Nom) }) });
  await ensureColumn(TABLES.organisations, "Priorite", { type: "Choice", widgetOptions: JSON.stringify({ choices: priorityChoices() }) });
  await ensureColumn(TABLES.referents, "Role", { type: "Choice", widgetOptions: JSON.stringify({ choices: DEFAULT_REFERENT_ROLES.map((role) => role.Nom) }) });
  await modifyColumn(TABLES.organisations, "Statut", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: DEFAULT_STAGES.map((stage) => stage.Nom) })
  });
  await modifyColumn(TABLES.organisations, "Priorite", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: priorityChoices() })
  });
  await modifyColumn(TABLES.referents, "Role", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: DEFAULT_REFERENT_ROLES.map((role) => role.Nom) })
  });
  await seedIfEmpty(TABLES.stages, DEFAULT_STAGES);
  await seedIfEmpty(TABLES.priorities, DEFAULT_PRIORITIES);
  await seedIfEmpty(TABLES.referentRoles, DEFAULT_REFERENT_ROLES);
  await seedIfEmpty(TABLES.referents, [
    { Nom: "Referent principal", Email: "", Role: "Responsable", Actif: true }
  ]);
}

function setNotice(message, type = "info") {
  environmentNotice.hidden = false;
  environmentNotice.textContent = message;
  environmentNotice.dataset.type = type;
}

function loadLocalEmptyState() {
  pipelineStages = DEFAULT_STAGES.map((stage, index) => ({
    id: index + 1,
    name: stage.Nom,
    color: stage.Couleur,
    followup: stage.Declenche_relance,
    active: stage.Actif
  }));
  teamMembers = [];
  referentRoles = [];
  clients = [];
  contacts = [];
  tasks = [];
  interactions = [];
}

async function loadGristData() {
  const stageRows = await safeFetchTable(TABLES.stages);
  pipelineStages = stageRows
    .filter((stage) => stage.Actif !== false)
    .sort((a, b) => (a.Ordre || 0) - (b.Ordre || 0))
    .map((stage) => ({
      id: stage.id,
      name: stage.Nom || "",
      color: stage.Couleur || "#6366f1",
      followup: !!stage.Declenche_relance,
      active: stage.Actif !== false
    }));

  referentRoles = (await safeFetchTable(TABLES.referentRoles))
    .sort((a, b) => (a.Ordre || 0) - (b.Ordre || 0))
    .map((role) => ({
      id: role.id,
      name: role.Nom || "",
      order: role.Ordre || 0,
      active: role.Actif !== false
    }));

  teamMembers = (await safeFetchTable(TABLES.referents)).map((member) => ({
    id: member.id,
    name: member.Nom || "",
    email: member.Email || "",
    role: member.Role || "",
    active: member.Actif !== false
  }));

  clients = (await safeFetchTable(TABLES.organisations)).map((client) => ({
    id: client.id,
    name: client.Nom || "",
    type: client.Typologie || "Prospect",
    status: client.Statut || "Premier contact",
    priority: client.Priorite || "Moyenne",
    owner: client.Referent || "",
    amount: client.Montant || 0,
    email: client.Email_principal || "",
    phone: client.Telephone || "",
    website: client.Site_web || "",
    nextAction: client.Prochaine_action ? new Date(client.Prochaine_action * 1000).toLocaleDateString("fr-FR") : "-"
  }));

  contacts = (await safeFetchTable(TABLES.contacts)).map((contact) => ({
    id: contact.id,
    organisationId: contact.Organisation,
    name: contact.Nom_complet || "",
    role: contact.Role || "",
    email: contact.Email || ""
  }));

  tasks = (await safeFetchTable(TABLES.tasks)).map((task) => ({
    id: task.id,
    organisationId: task.Organisation,
    due: task.Echeance ? new Date(task.Echeance * 1000).toLocaleDateString("fr-FR") : "-",
    label: task.Action || "",
    status: task.Statut || "A faire"
  }));

  interactions = (await safeFetchTable(TABLES.interactions)).map((event) => ({
    id: event.id,
    organisationId: event.Organisation,
    date: event.Date ? new Date(event.Date * 1000).toLocaleDateString("fr-FR") : "-",
    channel: event.Canal || "Note",
    subject: event.Sujet || "",
    notes: event.Compte_rendu || ""
  }));

}

function currentClient() {
  return clients.find((client) => client.id === activeClientId) || clients[0];
}

function stageNames() {
  return pipelineStages.map((stage) => stage.name);
}

function filteredClients() {
  const term = searchInput.value.trim().toLowerCase();
  return clients.filter((client) => {
    const matchesFilter = activeFilter === "Tous" || client.status === activeFilter;
    const haystack = `${client.name} ${client.type} ${client.status} ${client.email}`.toLowerCase();
    return matchesFilter && haystack.includes(term);
  });
}

function renderClientList() {
  const visibleClients = filteredClients();
  clientCount.textContent = visibleClients.length;
  clientList.innerHTML = "";
  if (!visibleClients.length) {
    clientList.innerHTML = '<div class="empty-state"><strong>Aucune fiche CRM</strong><span>Ajoutez des lignes dans CRM_Organisations ou importez vos clients dans Grist.</span></div>';
    return;
  }
  visibleClients.forEach((client) => {
    const button = document.createElement("button");
    button.className = `client-button${client.id === activeClientId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <strong>${client.name || "Sans nom"}</strong>
      <span class="client-meta">
        <span>${client.type}</span>
        <span class="tag">${client.status}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      activeClientId = client.id;
      render();
    });
    clientList.append(button);
  });
}

function renderDetails() {
  const client = currentClient();
  if (!client) {
    renderEmptyDetails();
    return;
  }
  const clientContacts = contacts.filter((contact) => contact.organisationId === client.id);
  const clientTasks = tasks.filter((task) => task.organisationId === client.id && task.status !== "Fait");
  const clientEvents = interactions.filter((event) => event.organisationId === client.id);

  document.querySelector("#clientType").textContent = client.type;
  document.querySelector("#clientName").textContent = client.name || "Sans nom";
  document.querySelector("#clientStatus").textContent = client.status;
  document.querySelector("#clientStatus").dataset.status = client.status;
  document.querySelector("#clientPriority").textContent = client.priority;
  document.querySelector("#clientOwner").textContent = client.owner || "-";
  document.querySelector("#lastContact").textContent = clientEvents[0]?.date || "-";
  document.querySelector("#nextAction").textContent = client.nextAction || "-";
  document.querySelector("#clientAmount").textContent = formatCurrency(client.amount);
  document.querySelector("#clientEmail").textContent = client.email || "-";
  document.querySelector("#clientPhone").textContent = client.phone || "-";
  document.querySelector("#clientWebsite").textContent = client.website || "-";

  document.querySelector("#taskList").innerHTML = clientTasks.map((task) => (
    `<li><strong>${task.label}</strong><span>${task.due}</span></li>`
  )).join("") || "<li><strong>Aucune tache ouverte</strong><span>-</span></li>";

  document.querySelector("#contactList").innerHTML = clientContacts.map((contact) => (
    `<li><strong>${contact.name}</strong><span>${contact.role}<br>${contact.email}</span></li>`
  )).join("") || "<li><strong>Aucun interlocuteur</strong><span>-</span></li>";

  document.querySelector("#timeline").innerHTML = clientEvents.map((event) => `
    <article class="event">
      <div class="event-date">${event.date}<br>${event.channel}</div>
      <div>
        <h4>${event.subject}</h4>
        <p>${event.notes}</p>
      </div>
    </article>
  `).join("") || '<article class="event"><div class="event-date">-</div><div><h4>Aucun historique</h4><p></p></div></article>';
}

function renderEmptyDetails() {
  document.querySelector("#clientType").textContent = "Aucune fiche";
  document.querySelector("#clientName").textContent = "CRM vide";
  document.querySelector("#clientStatus").textContent = "En attente";
  document.querySelector("#clientStatus").dataset.status = "";
  document.querySelector("#clientPriority").textContent = "-";
  document.querySelector("#clientOwner").textContent = "-";
  document.querySelector("#lastContact").textContent = "-";
  document.querySelector("#nextAction").textContent = "-";
  document.querySelector("#clientAmount").textContent = formatCurrency(0);
  document.querySelector("#clientEmail").textContent = "-";
  document.querySelector("#clientPhone").textContent = "-";
  document.querySelector("#clientWebsite").textContent = "-";
  document.querySelector("#taskList").innerHTML = "<li><strong>Aucune tache</strong><span>-</span></li>";
  document.querySelector("#contactList").innerHTML = "<li><strong>Aucun interlocuteur</strong><span>-</span></li>";
  document.querySelector("#timeline").innerHTML = '<article class="event"><div class="event-date">-</div><div><h4>Aucune donnee CRM</h4><p>Les tables seront creees automatiquement dans Grist. Les fiches apparaissent quand CRM_Organisations contient des lignes.</p></div></article>';
}

function renderStats() {
  const metrics = getMetrics();
  document.querySelector("#statProspects").textContent = metrics.prospects;
  document.querySelector("#statFollowups").textContent = metrics.followups;
  document.querySelector("#statPipeline").textContent = formatCurrency(metrics.pipelineAmount);
  document.querySelector("#statRevenue").textContent = formatCurrency(metrics.revenue);
}

function getMetrics() {
  const prospects = clients.filter((client) => client.type === "Prospect").length;
  const signedClients = clients.filter((client) => client.type === "Client").length;
  const followups = clients.filter((client) => client.status === "A relancer").length;
  const pipelineAmount = clients
    .filter((client) => client.type === "Prospect")
    .reduce((sum, client) => sum + client.amount, 0);
  const revenue = clients
    .filter((client) => client.type === "Client")
    .reduce((sum, client) => sum + client.amount, 0);
  const openTasks = tasks.filter((task) => task.status !== "Fait" && task.status !== "Annule").length;
  const conversionBase = prospects + signedClients;
  const conversionRate = conversionBase ? Math.round((signedClients / conversionBase) * 100) : 0;

  return {
    total: clients.length,
    prospects,
    signedClients,
    followups,
    pipelineAmount,
    revenue,
    openTasks,
    contacts: contacts.length,
    team: teamMembers.filter((member) => member.active !== false).length,
    conversionRate
  };
}

function renderPipeline() {
  const pipeline = document.querySelector("#pipeline");
  pipeline.innerHTML = "";
  pipelineStages.forEach((stage) => {
    const column = document.createElement("section");
    column.className = "pipeline-column";
    column.style.borderTop = `4px solid ${stage.color}`;
    const stageClients = clients.filter((client) => client.status === stage.name);
    column.innerHTML = `<h4>${stage.name} (${stageClients.length})</h4>`;
    stageClients.forEach((client) => {
      const card = document.createElement("button");
      card.className = `pipeline-card${client.id === activeClientId ? " active" : ""}`;
      card.type = "button";
      card.innerHTML = `<strong>${client.name || "Sans nom"}</strong><span>${client.nextAction || "-"}</span>`;
      card.addEventListener("click", () => {
        activeClientId = client.id;
        render();
      });
      column.append(card);
    });
    pipeline.append(column);
  });
}

function renderSettings() {
  document.querySelector("#stageSettingsList").innerHTML = pipelineStages.map((stage, index) => `
    <li>
      <strong><span class="stage-dot" style="background:${stage.color}"></span>${stage.name}</strong>
      <span>Ordre ${index + 1}${stage.followup ? " - declenche une relance" : ""}</span>
    </li>
  `).join("");

  document.querySelector("#memberSettingsList").innerHTML = teamMembers.map((member) => `
    <li><strong>${member.name}</strong><span>${member.role || "Referent"}<br>${member.email || "-"}</span></li>
  `).join("") || '<li><strong>Aucun referent</strong><span>Dans Grist, ajoutez un membre depuis ce formulaire pour remplir CRM_Referents.</span></li>';

  document.querySelector("#roleSettingsList").innerHTML = roleChoices().map((role) => `
    <li><strong>${role}</strong><span>Choix disponible dans CRM_Referents.Role</span></li>
  `).join("");
}

function renderCreateOptions() {
  const statusSelect = document.querySelector("#newClientStatus");
  const ownerSelect = document.querySelector("#newClientOwner");
  const memberRoleSelect = document.querySelector("#memberRole");
  statusSelect.innerHTML = pipelineStages.map((stage) => (
    `<option value="${stage.name}">${stage.name}</option>`
  )).join("");
  ownerSelect.innerHTML = '<option value="">Non assigne</option>' + teamMembers.map((member) => (
    `<option value="${member.name}">${member.name}</option>`
  )).join("");
  memberRoleSelect.innerHTML = roleChoices().map((role) => (
    `<option value="${role}">${role}</option>`
  )).join("");
}

function renderDashboard() {
  const metrics = getMetrics();
  document.querySelector("#dashTotal").textContent = metrics.total;
  document.querySelector("#dashProspects").textContent = metrics.prospects;
  document.querySelector("#dashClients").textContent = metrics.signedClients;
  document.querySelector("#dashFollowups").textContent = metrics.followups;
  document.querySelector("#dashPipeline").textContent = formatCurrency(metrics.pipelineAmount);
  document.querySelector("#dashRevenue").textContent = formatCurrency(metrics.revenue);
  document.querySelector("#dashOpenTasks").textContent = metrics.openTasks;
  document.querySelector("#dashContacts").textContent = metrics.contacts;

  const maxStageCount = Math.max(...pipelineStages.map((stage) => clients.filter((client) => client.status === stage.name).length), 1);
  document.querySelector("#dashboardStageBars").innerHTML = pipelineStages.map((stage) => {
    const count = clients.filter((client) => client.status === stage.name).length;
    const width = Math.max((count / maxStageCount) * 100, count ? 8 : 0);
    return `
      <div class="stage-bar-row">
        <div class="stage-bar-meta">
          <span>${stage.name}</span>
          <strong>${count}</strong>
        </div>
        <div class="stage-bar-track">
          <div class="stage-bar-fill" style="width:${width}%;background:${stage.color}"></div>
        </div>
      </div>
    `;
  }).join("");

  document.querySelector("#dashboardTeam").innerHTML = teamMembers.slice(0, 5).map((member) => `
    <div class="dashboard-list-item">
      <strong>${member.name}</strong>
      <span>${member.role || "Referent"}${member.email ? " - " + member.email : ""}</span>
    </div>
  `).join("") || '<div class="dashboard-list-item"><strong>Aucun referent</strong><span>Ajoutez l equipe dans Parametres</span></div>';

  const alerts = [];
  if (metrics.followups) alerts.push(`${metrics.followups} fiche(s) a relancer`);
  if (metrics.openTasks) alerts.push(`${metrics.openTasks} tache(s) ouverte(s)`);
  if (!metrics.team) alerts.push("Aucun referent actif");
  if (!alerts.length) alerts.push("Aucune alerte prioritaire");

  document.querySelector("#dashboardAlerts").innerHTML = alerts.map((alert) => `
    <div class="dashboard-list-item">
      <strong>${alert}</strong>
      <span>Mis a jour depuis les tables CRM</span>
    </div>
  `).join("");
}

function renderFilters() {
  filters.forEach((button) => {
    const filter = button.dataset.filter;
    if (filter !== "Tous" && !stageNames().includes(filter)) {
      button.disabled = true;
    }
  });
}

function render() {
  if (!clients.some((client) => client.id === activeClientId)) {
    activeClientId = clients[0]?.id || null;
  }
  renderFilters();
  renderClientList();
  renderDetails();
  renderStats();
  renderPipeline();
  renderSettings();
  renderDashboard();
  renderCreateOptions();
}

async function reloadAndRender() {
  if (isGrist) await loadGristData();
  if (isGrist) await syncChoiceColumns();
  render();
}

function attachGristLiveReload() {
  if (!isGrist || typeof grist.onRecords !== "function") return;
  grist.onRecords(() => {
    if (liveReloadTimer) clearTimeout(liveReloadTimer);
    liveReloadTimer = setTimeout(async () => {
      const activeForm = document.activeElement?.closest?.("form");
      if (activeForm) return;
      await reloadAndRender();
    }, 500);
  });
}

async function syncChoiceColumns() {
  await modifyColumn(TABLES.organisations, "Statut", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: stageChoices() })
  });
  await modifyColumn(TABLES.organisations, "Priorite", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: priorityChoices() })
  });
  await modifyColumn(TABLES.referents, "Role", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: roleChoices() })
  });
}

async function addInteraction(channel, subject, notes) {
  const client = currentClient();
  if (!client) return;
  if (isGrist) {
    await grist.docApi.applyUserActions([[
      "AddRecord",
      TABLES.interactions,
      null,
      { Organisation: client.id, Date: nowSeconds(), Canal: channel, Sujet: subject, Compte_rendu: notes, Auteur: client.owner || "" }
    ]]);
    await reloadAndRender();
    return;
  }
  interactions.unshift({ id: Date.now(), organisationId: client.id, date: "Aujourd'hui", channel, subject, notes });
  render();
}

searchInput.addEventListener("input", renderClientList);

filters.forEach((button) => {
  button.addEventListener("click", () => {
    filters.forEach((filter) => filter.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderClientList();
  });
});

document.querySelector("#addDemoInteraction").addEventListener("click", () => {
  addInteraction("Note", "Nouvelle note", "Note ajoutee depuis le widget CRM.");
});

document.querySelector("#advanceStatus").addEventListener("click", async () => {
  const client = currentClient();
  if (!client) return;
  const flow = stageNames();
  const currentIndex = flow.indexOf(client.status);
  const nextIndex = currentIndex >= 0 ? Math.min(currentIndex + 1, flow.length - 1) : 0;
  const nextStatus = flow[nextIndex];
  if (isGrist) {
    await grist.docApi.applyUserActions([
      ["UpdateRecord", TABLES.organisations, client.id, { Statut: nextStatus }],
      ["AddRecord", TABLES.interactions, null, {
        Organisation: client.id,
        Date: nowSeconds(),
        Canal: "Statut",
        Sujet: `Statut passe a ${nextStatus}`,
        Compte_rendu: "Changement de statut effectue depuis le widget CRM.",
        Auteur: client.owner || ""
      }]
    ]);
    await reloadAndRender();
    return;
  }
  client.status = nextStatus;
  interactions.unshift({ id: Date.now(), organisationId: client.id, date: "Aujourd'hui", channel: "Statut", subject: `Statut passe a ${nextStatus}`, notes: "Changement de statut effectue depuis le widget CRM." });
  render();
});

document.querySelector("#createTask").addEventListener("click", async () => {
  const client = currentClient();
  if (!client) return;
  if (isGrist) {
    await grist.docApi.applyUserActions([[
      "AddRecord",
      TABLES.tasks,
      null,
      { Organisation: client.id, Action: "Nouvelle relance a planifier", Canal: "Email", Statut: "A faire", Priorite: client.priority, Assigne_a: client.owner }
    ]]);
    await reloadAndRender();
    return;
  }
  tasks.unshift({ id: Date.now(), organisationId: client.id, due: "-", label: "Nouvelle relance a planifier", status: "A faire" });
  render();
});

document.querySelector("#toggleCreateClient").addEventListener("click", () => {
  createClientPanel.hidden = !createClientPanel.hidden;
});

createClientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.querySelector("#newClientName").value.trim();
  if (!name) return;

  const record = {
    Nom: name,
    Typologie: document.querySelector("#newClientType").value,
    Statut: document.querySelector("#newClientStatus").value || pipelineStages[0]?.name || "Premier contact",
    Priorite: document.querySelector("#newClientPriority").value,
    Referent: document.querySelector("#newClientOwner").value,
    Email_principal: document.querySelector("#newClientEmail").value.trim(),
    Telephone: document.querySelector("#newClientPhone").value.trim(),
    Site_web: document.querySelector("#newClientWebsite").value.trim(),
    Montant: Number(document.querySelector("#newClientAmount").value || 0)
  };

  if (isGrist) {
    const result = await grist.docApi.applyUserActions([["AddRecord", TABLES.organisations, null, record]]);
    await loadGristData();
    const retValue = Array.isArray(result?.retValues) ? result.retValues[0] : null;
    const newId = Number.isInteger(retValue) ? retValue : clients.find((client) => client.name === record.Nom)?.id || clients[clients.length - 1]?.id || null;
    activeClientId = newId;
    activeFilter = "Tous";
    filters.forEach((filter) => filter.classList.toggle("active", filter.dataset.filter === "Tous"));
    setNotice(`Fiche creee dans CRM_Organisations (${BUILD_VERSION}) : ${record.Nom}.`);
  } else {
    setNotice(`Apercu hors Grist (${BUILD_VERSION}) : la fiche n'a pas ete creee. Ajoutez ce widget dans Grist pour ecrire dans CRM_Organisations.`, "warning");
  }

  createClientForm.reset();
  createClientPanel.hidden = true;
  render();
});

viewTabs.forEach((button) => {
  button.addEventListener("click", () => {
    viewTabs.forEach((tab) => tab.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.remove("active"));
    document.querySelector(`#${button.dataset.view}View`).classList.add("active");
  });
});

stageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#stageName");
  const color = document.querySelector("#stageColor").value;
  const followup = document.querySelector("#stageFollowup").checked;
  const name = input.value.trim();
  if (!name || stageNames().includes(name)) return;
  const order = Math.max(pipelineStages.length + 1, 1);
  if (isGrist) {
    await grist.docApi.applyUserActions([[
      "AddRecord",
      TABLES.stages,
      null,
      { Nom: name, Ordre: order, Couleur: color, Declenche_relance: followup, Actif: true }
    ]]);
    await reloadAndRender();
  } else {
    pipelineStages.splice(Math.max(pipelineStages.length - 1, 0), 0, { id: Date.now(), name, color, followup, active: true });
    render();
  }
  input.value = "";
  document.querySelector("#stageFollowup").checked = false;
});

roleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#roleName");
  const name = input.value.trim();
  if (!name || roleChoices().includes(name)) return;
  const order = Math.max(referentRoles.length + 1, 1);
  if (isGrist) {
    await grist.docApi.applyUserActions([[
      "AddRecord",
      TABLES.referentRoles,
      null,
      { Nom: name, Ordre: order, Actif: true }
    ]]);
    await reloadAndRender();
  } else {
    setNotice(`Apercu hors Grist (${BUILD_VERSION}) : le role n'a pas ete cree. Ajoutez ce widget dans Grist pour ecrire dans CRM_Roles_Referents.`, "warning");
  }
  input.value = "";
});

memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nameInput = document.querySelector("#memberName");
  const emailInput = document.querySelector("#memberEmail");
  const roleInput = document.querySelector("#memberRole");
  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const role = roleInput.value.trim() || "Referent";
  if (!name || !email) return;
  if (isGrist) {
    await grist.docApi.applyUserActions([[
      "AddRecord",
      TABLES.referents,
      null,
      { Nom: name, Email: email, Role: role, Actif: true }
    ]]);
    await reloadAndRender();
  } else {
    setNotice(`Apercu hors Grist (${BUILD_VERSION}) : le referent n'a pas ete cree. Ajoutez ce widget dans Grist pour ecrire dans CRM_Referents.`, "warning");
  }
  memberForm.reset();
  renderCreateOptions();
});

async function init() {
  isGrist = insideGrist() && !!window.grist;
  if (isGrist) {
    setNotice(`Connexion a Grist (${BUILD_VERSION})...`);
    await grist.ready({ requiredAccess: "full" });
    if (!grist.docApi) {
      throw new Error("API document Grist indisponible apres grist.ready(). Verifiez le niveau d'acces du widget.");
    }
    setNotice(`Connecte a Grist (${BUILD_VERSION}) : aucune donnee client fictive n'est injectee.`);
    await ensureCrmTables();
    setNotice(`Tables CRM verifiees (${BUILD_VERSION}). Chargement des donnees...`);
    await loadGristData();
    await syncChoiceColumns();
    attachGristLiveReload();
    setNotice(`Connecte a Grist (${BUILD_VERSION}) : ${clients.length} fiche(s) dans CRM_Organisations.`);
  } else {
    setNotice(`Apercu hors Grist (${BUILD_VERSION}) : aucune table n'est creee ici. Ajoutez cette URL comme widget Custom dans Grist avec Full document access.`, "warning");
    loadLocalEmptyState();
  }
  render();
}

init().catch((error) => {
  console.error(error);
  setNotice(`Erreur d'initialisation Grist (${BUILD_VERSION}) : ${error.message}`, "error");
  loadLocalEmptyState();
  render();
});
