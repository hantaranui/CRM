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

const BUILD_VERSION = "crm-widget-no-demo-20260624-h";

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

function label(value) {
  const labels = {
    "A relancer": "À relancer",
    "A faire": "À faire",
    "Contrat signe": "Contrat signé",
    "Negociation": "Négociation",
    "Telephone": "Téléphone",
    "Reunion": "Réunion",
    "Referent": "Référent",
    "Referent principal": "Référent principal",
    "Annule": "Annulé"
  };
  return labels[value] || value || "-";
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
const notePanel = document.querySelector("#notePanel");
const noteForm = document.querySelector("#noteForm");
const taskPanel = document.querySelector("#taskPanel");
const taskForm = document.querySelector("#taskForm");
const listTypeFilter = document.querySelector("#listTypeFilter");
const listStatusFilter = document.querySelector("#listStatusFilter");
const listPriorityFilter = document.querySelector("#listPriorityFilter");
const listSort = document.querySelector("#listSort");

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

function dateInputToSeconds(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

function formatDateSeconds(value) {
  return value ? new Date(value * 1000).toLocaleDateString("fr-FR") : "-";
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
  await grist.docApi.applyUserActions(
    rows.map((row) => ["AddRecord", tableName, null, row])
  );
}

async function ensureCrmTables() {
  setNotice("Création/vérification des tables CRM_Étapes, CRM_Organisations, CRM_Référents...");
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
  await ensureColumn(TABLES.tasks, "Priorite", { type: "Choice", widgetOptions: JSON.stringify({ choices: priorityChoices() }) });
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
  await modifyColumn(TABLES.tasks, "Priorite", {
    type: "Choice",
    widgetOptions: JSON.stringify({ choices: priorityChoices() })
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
    nextActionRaw: client.Prochaine_action || null,
    nextAction: formatDateSeconds(client.Prochaine_action)
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
    dueRaw: task.Echeance || null,
    due: formatDateSeconds(task.Echeance),
    label: task.Action || "",
    status: task.Statut || "A faire",
    priority: task.Priorite || "Moyenne"
  }));

  interactions = (await safeFetchTable(TABLES.interactions))
    .map((event) => ({
      id: event.id,
      organisationId: event.Organisation,
      dateRaw: event.Date || null,
      date: formatDateSeconds(event.Date),
      channel: event.Canal || "Note",
      subject: event.Sujet || "",
      notes: event.Compte_rendu || ""
    }))
    .sort((a, b) => (b.dateRaw || 0) - (a.dateRaw || 0));

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

function listFilteredClients() {
  const type = listTypeFilter.value;
  const status = listStatusFilter.value;
  const priority = listPriorityFilter.value;
  const sort = listSort.value;
  const filtered = clients.filter((client) => {
    const matchesType = type === "Tous" || client.type === type;
    const matchesStatus = status === "Tous" || client.status === status;
    const matchesPriority = priority === "Tous" || client.priority === priority;
    return matchesType && matchesStatus && matchesPriority;
  });

  return filtered.sort((a, b) => {
    if (sort === "amount") return (b.amount || 0) - (a.amount || 0);
    if (sort === "status") return `${a.status}`.localeCompare(`${b.status}`, "fr");
    if (sort === "name") return `${a.name}`.localeCompare(`${b.name}`, "fr");
    if (sort === "lastContact") return getLastContactRaw(b.id) - getLastContactRaw(a.id);
    const aDate = a.nextActionRaw || Number.MAX_SAFE_INTEGER;
    const bDate = b.nextActionRaw || Number.MAX_SAFE_INTEGER;
    return aDate - bDate;
  });
}

function getLastContactRaw(clientId) {
  return interactions.find((event) => event.organisationId === clientId)?.dateRaw || 0;
}

function getLastContact(clientId) {
  const date = getLastContactRaw(clientId);
  return date ? formatDateSeconds(date) : "-";
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
        <span class="type-pill">${label(client.type)}</span>
        <span class="tag">${label(client.status)}</span>
        <span>${label(client.priority)}</span>
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

  document.querySelector("#clientType").textContent = label(client.type);
  document.querySelector("#clientName").textContent = client.name || "Sans nom";
  document.querySelector("#clientStatus").textContent = label(client.status);
  document.querySelector("#clientStatus").dataset.status = client.status;
  document.querySelector("#clientPriority").textContent = label(client.priority);
  document.querySelector("#clientOwner").textContent = client.owner || "-";
  document.querySelector("#lastContact").textContent = clientEvents[0]?.date || "-";
  document.querySelector("#nextAction").textContent = client.nextAction || "-";
  document.querySelector("#clientAmount").textContent = formatCurrency(client.amount);
  document.querySelector("#clientEmail").textContent = client.email || "-";
  document.querySelector("#clientPhone").textContent = client.phone || "-";
  document.querySelector("#clientWebsite").textContent = client.website || "-";

  document.querySelector("#taskList").innerHTML = clientTasks.map((task) => (
    `<li><strong>${task.label}</strong><span>${task.due} · ${label(task.priority)}</span></li>`
  )).join("") || "<li><strong>Aucune tâche ouverte</strong><span>-</span></li>";

  document.querySelector("#contactList").innerHTML = clientContacts.map((contact) => (
    `<li><strong>${contact.name}</strong><span>${label(contact.role)}<br>${contact.email}</span></li>`
  )).join("") || "<li><strong>Aucun interlocuteur</strong><span>-</span></li>";

  document.querySelector("#timeline").innerHTML = clientEvents.map((event) => `
    <article class="event">
      <div class="event-date">${event.date}<br>${label(event.channel)}</div>
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
  document.querySelector("#taskList").innerHTML = "<li><strong>Aucune tâche</strong><span>-</span></li>";
  document.querySelector("#contactList").innerHTML = "<li><strong>Aucun interlocuteur</strong><span>-</span></li>";
  document.querySelector("#timeline").innerHTML = '<article class="event"><div class="event-date">-</div><div><h4>Aucune donnée CRM</h4><p>Les tables seront créées automatiquement dans Grist. Les fiches apparaissent quand CRM_Organisations contient des lignes.</p></div></article>';
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
    column.innerHTML = `<h4>${label(stage.name)} (${stageClients.length})</h4>`;
    stageClients.forEach((client) => {
      const card = document.createElement("article");
      card.className = `pipeline-card${client.id === activeClientId ? " active" : ""}`;
      card.tabIndex = 0;
      card.innerHTML = `
        <strong>${client.name || "Sans nom"}</strong>
        <span>${label(client.type)} - ${label(client.priority)}</span>
        <span>${client.nextAction || "-"}</span>
        <select class="kanban-status" data-client-id="${client.id}" aria-label="Changer le statut">
          ${stageNames().map((status) => `<option value="${status}"${status === client.status ? " selected" : ""}>${label(status)}</option>`).join("")}
        </select>
      `;
      card.addEventListener("click", () => {
        activeClientId = client.id;
        switchView("crm");
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          activeClientId = client.id;
          switchView("crm");
        }
      });
      column.append(card);
    });
    pipeline.append(column);
  });
  document.querySelectorAll(".kanban-status").forEach((select) => {
    select.addEventListener("click", (event) => event.stopPropagation());
    select.addEventListener("change", async () => {
      await updateClientStatus(Number(select.dataset.clientId), select.value);
    });
  });
}

function renderSettings() {
  document.querySelector("#stageSettingsList").innerHTML = pipelineStages.map((stage, index) => `
    <li>
      <strong><span class="stage-dot" style="background:${stage.color}"></span>${stage.name}</strong>
      <span>Ordre ${index + 1}${stage.followup ? " - déclenche une relance" : ""}</span>
    </li>
  `).join("");

  document.querySelector("#memberSettingsList").innerHTML = teamMembers.map((member) => `
    <li><strong>${member.name}</strong><span>${label(member.role || "Referent")}<br>${member.email || "-"}</span></li>
  `).join("") || '<li><strong>Aucun référent</strong><span>Dans Grist, ajoutez un membre depuis ce formulaire pour remplir CRM_Referents.</span></li>';

  document.querySelector("#roleSettingsList").innerHTML = roleChoices().map((role) => `
    <li><strong>${label(role)}</strong><span>Choix disponible dans CRM_Referents.Role</span></li>
  `).join("");
}

function renderCreateOptions() {
  const statusSelect = document.querySelector("#newClientStatus");
  const ownerSelect = document.querySelector("#newClientOwner");
  const memberRoleSelect = document.querySelector("#memberRole");
  const selectedListStatus = listStatusFilter.value || "Tous";
  statusSelect.innerHTML = pipelineStages.map((stage) => (
    `<option value="${stage.name}">${label(stage.name)}</option>`
  )).join("");
  ownerSelect.innerHTML = '<option value="">Non assigne</option>' + teamMembers.map((member) => (
    `<option value="${member.name}">${label(member.name)}</option>`
  )).join("");
  memberRoleSelect.innerHTML = roleChoices().map((role) => (
    `<option value="${role}">${label(role)}</option>`
  )).join("");
  listStatusFilter.innerHTML = '<option value="Tous">Tous</option>' + pipelineStages.map((stage) => (
    `<option value="${stage.name}">${label(stage.name)}</option>`
  )).join("");
  listStatusFilter.value = stageNames().includes(selectedListStatus) ? selectedListStatus : "Tous";
}

function renderListView() {
  const rows = listFilteredClients();
  document.querySelector("#listCount").textContent = `${rows.length} fiche${rows.length > 1 ? "s" : ""}`;
  document.querySelector("#crmListBody").innerHTML = rows.map((client) => `
    <tr data-client-id="${client.id}">
      <td><button class="table-link" type="button" data-client-id="${client.id}">${client.name || "Sans nom"}</button></td>
      <td><span class="type-pill">${label(client.type)}</span></td>
      <td><span class="tag">${label(client.status)}</span></td>
      <td>${label(client.priority)}</td>
      <td>${client.owner || "-"}</td>
      <td>${getLastContact(client.id)}</td>
      <td>${client.nextAction || "-"}</td>
      <td>${formatCurrency(client.amount)}</td>
    </tr>
  `).join("") || '<tr><td colspan="8">Aucune fiche ne correspond aux filtres.</td></tr>';

  document.querySelectorAll(".table-link").forEach((button) => {
    button.addEventListener("click", () => {
      activeClientId = Number(button.dataset.clientId);
      switchView("crm");
    });
  });
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
      <span>${label(stage.name)}</span>
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
      <span>${label(member.role || "Referent")}${member.email ? " - " + member.email : ""}</span>
    </div>
  `).join("") || '<div class="dashboard-list-item"><strong>Aucun référent</strong><span>Ajoutez l’équipe dans Paramètres</span></div>';

  const alerts = [];
  if (metrics.followups) alerts.push(`${metrics.followups} fiche(s) à relancer`);
  if (metrics.openTasks) alerts.push(`${metrics.openTasks} tâche(s) ouverte(s)`);
  if (!metrics.team) alerts.push("Aucun referent actif");
  if (!alerts.length) alerts.push("Aucune alerte prioritaire");

  document.querySelector("#dashboardAlerts").innerHTML = alerts.map((alert) => `
    <div class="dashboard-list-item">
      <strong>${alert}</strong>
      <span>Mis à jour depuis les tables CRM</span>
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
  renderListView();
}

function switchView(view) {
  viewTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelector(`#${view}View`).classList.add("active");
  render();
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

async function createTaskForCurrentClient(record) {
  const client = currentClient();
  if (!client) return;
  if (isGrist) {
    await grist.docApi.applyUserActions([[
      "AddRecord",
      TABLES.tasks,
      null,
      { Organisation: client.id, ...record }
    ]]);
    await reloadAndRender();
    return;
  }
  setNotice(`Aperçu hors Grist (${BUILD_VERSION}) : la tâche n'a pas été créée. Ajoutez ce widget dans Grist pour écrire dans CRM_Taches.`, "warning");
}

async function updateClientStatus(clientId, status) {
  const client = clients.find((item) => item.id === clientId);
  if (!client || client.status === status) return;
  if (isGrist) {
    await grist.docApi.applyUserActions([
      ["UpdateRecord", TABLES.organisations, clientId, { Statut: status }],
      ["AddRecord", TABLES.interactions, null, {
        Organisation: clientId,
        Date: nowSeconds(),
        Canal: "Statut",
        Sujet: `Statut passé à ${label(status)}`,
        Compte_rendu: "Changement de statut depuis le Kanban CRM.",
        Auteur: client.owner || ""
      }]
    ]);
    activeClientId = clientId;
    await reloadAndRender();
    return;
  }
  setNotice(`Aperçu hors Grist (${BUILD_VERSION}) : le statut n'a pas été modifié. Ajoutez ce widget dans Grist pour écrire dans CRM_Organisations.`, "warning");
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

document.querySelector("#toggleNotePanel").addEventListener("click", () => {
  notePanel.hidden = !notePanel.hidden;
  taskPanel.hidden = true;
});

document.querySelector("#toggleTaskPanel").addEventListener("click", () => {
  taskPanel.hidden = !taskPanel.hidden;
  notePanel.hidden = true;
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
    setNotice(`Fiche créée dans CRM_Organisations (${BUILD_VERSION}) : ${record.Nom}.`);
  } else {
    setNotice(`Aperçu hors Grist (${BUILD_VERSION}) : la fiche n'a pas été créée. Ajoutez ce widget dans Grist pour écrire dans CRM_Organisations.`, "warning");
  }

  createClientForm.reset();
  createClientPanel.hidden = true;
  render();
});

viewTabs.forEach((button) => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
});

[listTypeFilter, listStatusFilter, listPriorityFilter, listSort].forEach((input) => {
  input.addEventListener("change", renderListView);
});

noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const subject = document.querySelector("#noteSubject").value.trim();
  const body = document.querySelector("#noteBody").value.trim();
  const channel = document.querySelector("#noteChannel").value;
  if (!subject) return;
  await addInteraction(channel, subject, body);
  noteForm.reset();
  notePanel.hidden = true;
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = document.querySelector("#taskAction").value.trim();
  if (!action) return;
  const dueDate = dateInputToSeconds(document.querySelector("#taskDueDate").value);
  await createTaskForCurrentClient({
    Action: action,
    Canal: document.querySelector("#taskChannel").value,
    Echeance: dueDate,
    Statut: "A faire",
    Priorite: document.querySelector("#taskPriority").value,
    Assigne_a: currentClient()?.owner || ""
  });
  taskForm.reset();
  taskPanel.hidden = true;
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
    setNotice(`Aperçu hors Grist (${BUILD_VERSION}) : le rôle n'a pas été créé. Ajoutez ce widget dans Grist pour écrire dans CRM_Roles_Referents.`, "warning");
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
    setNotice(`Aperçu hors Grist (${BUILD_VERSION}) : le référent n'a pas été créé. Ajoutez ce widget dans Grist pour écrire dans CRM_Referents.`, "warning");
  }
  memberForm.reset();
  renderCreateOptions();
});

async function init() {
  isGrist = insideGrist() && !!window.grist;
  if (isGrist) {
    setNotice(`Connexion à Grist (${BUILD_VERSION})...`);
    await grist.ready({ requiredAccess: "full" });
    if (!grist.docApi) {
      throw new Error("API document Grist indisponible apres grist.ready(). Verifiez le niveau d'acces du widget.");
    }
    setNotice(`Connecté à Grist (${BUILD_VERSION}) : aucune donnée client fictive n'est injectée.`);
    await ensureCrmTables();
    setNotice(`Tables CRM vérifiées (${BUILD_VERSION}). Chargement des données...`);
    await loadGristData();
    await syncChoiceColumns();
    attachGristLiveReload();
    setNotice(`Connecté à Grist (${BUILD_VERSION}) : ${clients.length} fiche(s) dans CRM_Organisations.`);
  } else {
    setNotice(`Aperçu hors Grist (${BUILD_VERSION}) : aucune table n'est créée ici. Ajoutez cette URL comme widget Custom dans Grist avec Full document access.`, "warning");
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
