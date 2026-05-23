import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const STORAGE_KEY = "service-registration-app";
const WEEKDAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];
const DATA_EXPORT_VERSION = 2;
const MONTH_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
});
const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
});
const TOAST_DURATION_MS = 7000;
const REMINDER_CHECK_INTERVAL_MS = 30 * 1000;
const REMINDER_MAX_SCHEDULE_MS = 30 * 24 * 60 * 60 * 1000;
const REMINDER_CATCHUP_MS = 36 * 60 * 60 * 1000;
const DAY_BEFORE_REMINDER_HOUR = 9;
const RETURN_DAY_REMINDER_HOUR = 8;

const state = loadState();

let reminderIntervalId = null;
let serviceWorkerRegistration = null;
const scheduledReminderTimeouts = [];
let dayEditorDate = null;
let dayEditorEditingPreachingId = null;
let dayEditorEditingCreditId = null;

document.addEventListener("DOMContentLoaded", () => {
  initializeDefaults();
  bindTabs();
  bindForms();
  bindFilters();
  bindMonthlyGoal();
  bindDayEditor();
  bindReminderActions();
  bindReminderVisibility();
  bindDataBackup();
  applyInitialRoute();
  renderNotificationStatus();
  renderAll();
  initializeNotificationSupport();
  startReminderLoop();
  checkFollowupReminders(false);
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }

    const parsed = JSON.parse(raw);

    return {
      preachingRecords: Array.isArray(parsed.preachingRecords) ? parsed.preachingRecords : [],
      creditRecords: Array.isArray(parsed.creditRecords) ? parsed.creditRecords : [],
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
      reminderLog: parsed.reminderLog && typeof parsed.reminderLog === "object" ? parsed.reminderLog : {},
      filters: {
        preachingMonth: parsed.filters?.preachingMonth || "",
        preachingWeek: parsed.filters?.preachingWeek || "",
        creditMonth: parsed.filters?.creditMonth || "",
        creditWeek: parsed.filters?.creditWeek || "",
      },
      editing: {
        preachingId: null,
        creditId: null,
        followupId: null,
      },
      monthlyGoals:
        parsed.monthlyGoals && typeof parsed.monthlyGoals === "object" ? parsed.monthlyGoals : {},
    };
  } catch (error) {
    console.error("No se pudo leer el almacenamiento local:", error);
    return createDefaultState();
  }
}

function createDefaultState() {
  return {
    preachingRecords: [],
    creditRecords: [],
    followUps: [],
    reminderLog: {},
    filters: {
      preachingMonth: "",
      preachingWeek: "",
      creditMonth: "",
      creditWeek: "",
    },
    editing: {
      preachingId: null,
      creditId: null,
      followupId: null,
    },
    monthlyGoals: {},
  };
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      preachingRecords: state.preachingRecords,
      creditRecords: state.creditRecords,
      followUps: state.followUps,
      reminderLog: state.reminderLog,
      filters: state.filters,
      monthlyGoals: state.monthlyGoals,
    })
  );
}

function initializeDefaults() {
  const today = new Date();

  document.getElementById("preachingDate").value = toDateInputValue(today);
  document.getElementById("creditDate").value = toDateInputValue(today);
  document.getElementById("followupReturnDate").value = toDateInputValue(today);
  document.getElementById("followupReturnTime").value = "18:00";
  syncFilterInputsFromState();
  syncMonthlyGoalInput();
  saveState();
}

function syncFilterInputsFromState() {
  const currentMonth = toMonthValue(new Date());

  if (!state.filters.preachingMonth) {
    state.filters.preachingMonth = currentMonth;
  }
  if (!state.filters.creditMonth) {
    state.filters.creditMonth = currentMonth;
  }

  document.getElementById("preachingMonthFilter").value = state.filters.preachingMonth;
  document.getElementById("preachingWeekFilter").value = state.filters.preachingWeek;
  document.getElementById("creditMonthFilter").value = state.filters.creditMonth;
  document.getElementById("creditWeekFilter").value = state.filters.creditWeek;
}

function getActiveMonthValue() {
  return document.getElementById("preachingMonthFilter")?.value || toMonthValue(new Date());
}

function getCombinedHours(recordsA, recordsB) {
  return sumHours(recordsA) + sumHours(recordsB);
}

function getCombinedMonthHours(monthValue) {
  return getCombinedHours(
    filterByMonth(state.preachingRecords, monthValue),
    filterByMonth(state.creditRecords, monthValue)
  );
}

function getCombinedDayHours(dateValue) {
  return getCombinedHours(
    state.preachingRecords.filter((item) => item.date === dateValue),
    state.creditRecords.filter((item) => item.date === dateValue)
  );
}

function getMonthlyGoal(monthValue) {
  const goal = state.monthlyGoals?.[monthValue];
  return typeof goal === "number" && !Number.isNaN(goal) ? goal : null;
}

function setMonthlyGoal(monthValue, hours) {
  if (!state.monthlyGoals) {
    state.monthlyGoals = {};
  }

  if (hours === null || hours === undefined || Number.isNaN(hours) || hours <= 0) {
    delete state.monthlyGoals[monthValue];
  } else {
    state.monthlyGoals[monthValue] = hours;
  }

  saveState();
}

function bindMonthlyGoal() {
  const input = document.getElementById("monthlyGoalInput");
  if (!input) {
    return;
  }

  input.addEventListener("input", () => {
    const monthValue = getActiveMonthValue();
    const parsed = Number.parseFloat(input.value);
    setMonthlyGoal(monthValue, input.value === "" ? null : parsed);
    renderMonthlyGoalUI();
  });

  syncMonthlyGoalInput();
}

function syncMonthlyGoalInput() {
  const input = document.getElementById("monthlyGoalInput");
  if (!input) {
    return;
  }

  const goal = getMonthlyGoal(getActiveMonthValue());
  input.value = goal ?? "";
  renderMonthlyGoalUI();
}

function renderMonthlyGoalUI() {
  const progressLabel = document.getElementById("heroGoalProgress");
  const progressBar = document.getElementById("heroGoalBar");
  if (!progressLabel || !progressBar) {
    return;
  }

  const monthValue = getActiveMonthValue();
  const combined = getCombinedMonthHours(monthValue);
  const goal = getMonthlyGoal(monthValue);

  if (goal && goal > 0) {
    const percent = Math.min(100, (combined / goal) * 100);
    progressLabel.textContent = `${formatHours(combined)} de ${formatHours(goal)} (${Math.round(percent)}%)`;
    progressBar.style.width = `${percent}%`;
    return;
  }

  progressBar.style.width = "0%";
  progressLabel.textContent =
    goal === 0 ? `Total del mes: ${formatHours(combined)}` : `Sin meta — total: ${formatHours(combined)}`;
}

function bindDayEditor() {
  const modal = document.getElementById("dayEditorModal");
  if (!modal) {
    return;
  }

  document.getElementById("dayEditorClose")?.addEventListener("click", closeDayEditor);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeDayEditor();
    }
  });

  document.getElementById("dayEditorPreachingForm")?.addEventListener("submit", handleDayEditorPreachingSubmit);
  document.getElementById("dayEditorCreditForm")?.addEventListener("submit", handleDayEditorCreditSubmit);
  document.getElementById("dayEditorPreachingCancel")?.addEventListener("click", resetDayEditorPreachingForm);
  document.getElementById("dayEditorCreditCancel")?.addEventListener("click", resetDayEditorCreditForm);
}

function openDayEditor(dateValue) {
  dayEditorDate = dateValue;
  const modal = document.getElementById("dayEditorModal");
  if (!modal) {
    return;
  }

  document.getElementById("dayEditorTitle").textContent = formatDate(dateValue);
  resetDayEditorPreachingForm();
  resetDayEditorCreditForm();
  renderDayEditor();
  modal.showModal();
}

function closeDayEditor() {
  document.getElementById("dayEditorModal")?.close();
  dayEditorDate = null;
  document.querySelectorAll(".calendar-day.is-selected").forEach((element) => {
    element.classList.remove("is-selected");
  });
}

function renderDayEditor() {
  if (!dayEditorDate) {
    return;
  }

  const preachingRecords = state.preachingRecords.filter((item) => item.date === dayEditorDate);
  const creditRecords = state.creditRecords.filter((item) => item.date === dayEditorDate);

  document.getElementById("dayEditorPreachingTotal").textContent = formatHours(sumHours(preachingRecords));
  document.getElementById("dayEditorCreditTotal").textContent = formatHours(sumHours(creditRecords));
  document.getElementById("dayEditorCombinedTotal").textContent = formatHours(
    getCombinedDayHours(dayEditorDate)
  );

  renderDayEditorList(
    document.getElementById("dayEditorPreachingList"),
    preachingRecords,
    "preaching"
  );
  renderDayEditorList(document.getElementById("dayEditorCreditList"), creditRecords, "credit");
}

function renderDayEditorList(container, records, type) {
  if (!container) {
    return;
  }

  if (!records.length) {
    container.innerHTML = `<p class="day-records-empty">Sin registros en este dia.</p>`;
    return;
  }

  container.innerHTML = records
    .map((record) => {
      const label =
        type === "preaching"
          ? `${formatHours(record.hours)} · ${capitalize(record.shift)}`
          : formatHours(record.hours);

      return `
        <div class="day-record-row">
          <p>${escapeHtml(label)}</p>
          <div class="day-record-actions">
            <button type="button" class="action-button edit" data-day-edit="${type}" data-id="${record.id}">Editar</button>
            <button type="button" class="action-button delete" data-day-delete="${type}" data-id="${record.id}">Eliminar</button>
          </div>
        </div>`;
    })
    .join("");

  container.querySelectorAll("[data-day-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.dayEdit === "preaching") {
        startDayEditorPreachingEdit(button.dataset.id);
      } else {
        startDayEditorCreditEdit(button.dataset.id);
      }
    });
  });

  container.querySelectorAll("[data-day-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.dayDelete === "preaching") {
        removePreaching(button.dataset.id);
        renderDayEditor();
      } else {
        removeCredit(button.dataset.id);
        renderDayEditor();
      }
    });
  });
}

function startDayEditorPreachingEdit(id) {
  const record = state.preachingRecords.find((item) => item.id === id);
  if (!record) {
    return;
  }

  dayEditorEditingPreachingId = id;
  document.getElementById("dayEditorPreachingId").value = record.id;
  document.getElementById("dayEditorPreachingHours").value = record.hours;
  document.getElementById("dayEditorPreachingShift").value = record.shift;
  document.getElementById("dayEditorPreachingCancel").classList.remove("hidden");
  document.getElementById("dayEditorPreachingSubmit").textContent = "Actualizar predicacion";
}

function startDayEditorCreditEdit(id) {
  const record = state.creditRecords.find((item) => item.id === id);
  if (!record) {
    return;
  }

  dayEditorEditingCreditId = id;
  document.getElementById("dayEditorCreditId").value = record.id;
  document.getElementById("dayEditorCreditHours").value = record.hours;
  document.getElementById("dayEditorCreditCancel").classList.remove("hidden");
  document.getElementById("dayEditorCreditSubmit").textContent = "Actualizar credito";
}

function resetDayEditorPreachingForm() {
  dayEditorEditingPreachingId = null;
  document.getElementById("dayEditorPreachingForm")?.reset();
  document.getElementById("dayEditorPreachingShift").value = "manana";
  document.getElementById("dayEditorPreachingCancel")?.classList.add("hidden");
  const submitButton = document.getElementById("dayEditorPreachingSubmit");
  if (submitButton) {
    submitButton.textContent = "Agregar predicacion";
  }
}

function resetDayEditorCreditForm() {
  dayEditorEditingCreditId = null;
  document.getElementById("dayEditorCreditForm")?.reset();
  document.getElementById("dayEditorCreditCancel")?.classList.add("hidden");
  const submitButton = document.getElementById("dayEditorCreditSubmit");
  if (submitButton) {
    submitButton.textContent = "Agregar credito";
  }
}

function handleDayEditorPreachingSubmit(event) {
  event.preventDefault();
  if (!dayEditorDate) {
    return;
  }

  const saved = upsertPreachingRecord({
    editingId: dayEditorEditingPreachingId,
    date: dayEditorDate,
    hours: Number.parseFloat(document.getElementById("dayEditorPreachingHours").value),
    shift: document.getElementById("dayEditorPreachingShift").value,
  });

  if (!saved) {
    return;
  }

  resetDayEditorPreachingForm();
  renderDayEditor();
  renderAll();
}

function handleDayEditorCreditSubmit(event) {
  event.preventDefault();
  if (!dayEditorDate) {
    return;
  }

  const saved = upsertCreditRecord({
    editingId: dayEditorEditingCreditId,
    date: dayEditorDate,
    hours: Number.parseFloat(document.getElementById("dayEditorCreditHours").value),
  });

  if (!saved) {
    return;
  }

  resetDayEditorCreditForm();
  renderDayEditor();
  renderAll();
}

function upsertPreachingRecord({ editingId, date, hours, shift }) {
  if (!date || Number.isNaN(hours) || hours < 0) {
    return false;
  }

  const existing = editingId ? state.preachingRecords.find((item) => item.id === editingId) : null;
  const record = {
    id: editingId || crypto.randomUUID(),
    date,
    hours,
    shift,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  if (editingId) {
    state.preachingRecords = state.preachingRecords.map((item) =>
      item.id === editingId ? record : item
    );
  } else {
    state.preachingRecords.push(record);
  }

  saveState();
  return true;
}

function upsertCreditRecord({ editingId, date, hours }) {
  if (!date || Number.isNaN(hours) || hours < 0) {
    return false;
  }

  const existing = editingId ? state.creditRecords.find((item) => item.id === editingId) : null;
  const record = {
    id: editingId || crypto.randomUUID(),
    date,
    hours,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  if (editingId) {
    state.creditRecords = state.creditRecords.map((item) => (item.id === editingId ? record : item));
  } else {
    state.creditRecords.push(record);
  }

  saveState();
  return true;
}

function applyInitialRoute() {
  if (window.location.hash === "#seguimiento") {
    const targetButton = document.querySelector('.tab-button[data-tab="seguimiento"]');
    targetButton?.click();
  }
}

function bindTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabPanels = document.querySelectorAll(".tab-panel");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      tabButtons.forEach((item) => item.classList.remove("active"));
      tabPanels.forEach((panel) => panel.classList.remove("active"));

      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });
}

function bindForms() {
  document.getElementById("preachingForm").addEventListener("submit", handlePreachingSubmit);
  document.getElementById("creditForm").addEventListener("submit", handleCreditSubmit);
  document.getElementById("followupForm").addEventListener("submit", handleFollowupSubmit);
  document.getElementById("preachingDate").addEventListener("input", renderPreachingStats);

  document.getElementById("preachingCancelEdit").addEventListener("click", resetPreachingForm);
  document.getElementById("creditCancelEdit").addEventListener("click", resetCreditForm);
  document.getElementById("followupCancelEdit").addEventListener("click", resetFollowupForm);
}

function bindFilters() {
  document.getElementById("preachingMonthFilter").addEventListener("input", (event) => {
    state.filters.preachingMonth = event.target.value;
    saveState();
    syncMonthlyGoalInput();
    renderPreachingSection();
    renderHeroSummary();
  });

  document.getElementById("preachingWeekFilter").addEventListener("input", (event) => {
    state.filters.preachingWeek = event.target.value;
    saveState();
    renderPreachingSection();
  });

  document.getElementById("creditMonthFilter").addEventListener("input", (event) => {
    state.filters.creditMonth = event.target.value;
    saveState();
    renderCreditSection();
    renderHeroSummary();
  });

  document.getElementById("creditWeekFilter").addEventListener("input", (event) => {
    state.filters.creditWeek = event.target.value;
    saveState();
    renderCreditSection();
  });
}

function bindReminderActions() {
  document.getElementById("enableNotifications").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      showToast({
        title: "Navegador no compatible",
        body: "Este navegador no admite notificaciones del sistema, pero los avisos internos siguen activos.",
        tone: "warning",
        badge: "Aviso interno",
      });
      renderNotificationStatus();
      return;
    }

    const permission = await Notification.requestPermission();
    renderNotificationStatus();

    if (permission === "granted") {
      notify("Notificaciones activadas", "Recibiras recordatorios en la app y tambien desde el navegador.");
      showToast({
        title: "Notificaciones activadas",
        body: "Ya quedo habilitado el permiso del navegador. Los avisos internos y del sistema estan activos.",
        tone: "success",
        badge: "Activadas",
      });
      checkFollowupReminders(true);
    } else {
      showToast({
        title: "Permiso no concedido",
        body: "Seguiremos mostrando recordatorios dentro de la web con el mismo estilo visual.",
        tone: permission === "denied" ? "warning" : "info",
        badge: "Aviso interno",
      });
    }
  });

  document.getElementById("checkRemindersNow").addEventListener("click", () => {
    checkFollowupReminders(true);
  });
}

function bindDataBackup() {
  document.getElementById("exportPdfButton")?.addEventListener("click", () => {
    exportMonthlyPdf().catch((error) => {
      console.error("No se pudo generar el PDF:", error);
      showToast({
        title: "Error al exportar",
        body: "No se pudo crear el informe PDF. Intenta de nuevo.",
        tone: "warning",
        badge: "PDF",
      });
    });
  });
  document.getElementById("exportJsonButton")?.addEventListener("click", exportJsonBackup);
  document.getElementById("importDataInput")?.addEventListener("change", handleImportData);
}

function exportJsonBackup() {
  const payload = {
    version: DATA_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    preachingRecords: state.preachingRecords,
    creditRecords: state.creditRecords,
    followUps: state.followUps,
    filters: state.filters,
    monthlyGoals: state.monthlyGoals,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `predicacion-respaldo-${toDateInputValue(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);

  showToast({
    title: "JSON exportado",
    body: "Se descargo una copia completa de todos tus datos para importar despues.",
    tone: "success",
    badge: "Respaldo",
  });
}

function formatMonthTitle(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  return capitalize(MONTH_FORMATTER.format(new Date(year, month - 1, 1)));
}

function formatMonthSlug(monthValue) {
  return formatMonthTitle(monthValue)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-");
}

function getFollowupsForMonth(monthValue) {
  return state.followUps
    .filter((item) => item.returnDate?.startsWith(monthValue))
    .sort((left, right) => {
      const leftDateTime = `${left.returnDate}T${left.returnTime}`;
      const rightDateTime = `${right.returnDate}T${right.returnTime}`;
      return new Date(leftDateTime) - new Date(rightDateTime);
    });
}

function getDailyBreakdownForMonth(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const rows = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateValue = toDateInputValue(new Date(year, month - 1, day));
    const preachingHours = sumHours(
      state.preachingRecords.filter((item) => item.date === dateValue)
    );
    const creditHours = sumHours(state.creditRecords.filter((item) => item.date === dateValue));
    const totalHours = preachingHours + creditHours;

    if (totalHours > 0) {
      rows.push({
        dateValue,
        preachingHours,
        creditHours,
        totalHours,
      });
    }
  }

  return rows;
}

const PDF_THEME = {
  primary: [90, 124, 255],
  credit: [47, 165, 138],
  text: [33, 48, 70],
  muted: [102, 117, 140],
};

function drawPdfSectionTitle(doc, title, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...PDF_THEME.text);
  doc.text(title, 14, y);
  doc.setDrawColor(...PDF_THEME.primary);
  doc.setLineWidth(0.4);
  doc.line(14, y + 2, 196, y + 2);
  return y + 8;
}

async function exportMonthlyPdf() {
  const monthValue = getActiveMonthValue();
  const monthTitle = formatMonthTitle(monthValue);
  const preachingRecords = filterByMonth(state.preachingRecords, monthValue).sort(sortByDateDesc);
  const creditRecords = filterByMonth(state.creditRecords, monthValue).sort(sortByDateDesc);
  const followups = getFollowupsForMonth(monthValue);
  const dailyRows = getDailyBreakdownForMonth(monthValue);

  const preachingTotal = sumHours(preachingRecords);
  const creditTotal = sumHours(creditRecords);
  const combinedTotal = preachingTotal + creditTotal;
  const monthlyGoal = getMonthlyGoal(monthValue);
  const progressPercent =
    monthlyGoal && monthlyGoal > 0 ? Math.min(100, Math.round((combinedTotal / monthlyGoal) * 100)) : null;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...PDF_THEME.primary);
  doc.rect(0, 0, pageWidth, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Servicio de Predicacion y Seguimiento", 14, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(`Informe mensual · ${monthTitle}`, 14, 21);
  doc.setFontSize(9);
  doc.text(`Generado el ${DATE_FORMATTER.format(new Date())}`, 14, 27);

  let cursorY = 40;

  autoTable(doc, {
    startY: cursorY,
    theme: "plain",
    margin: { left: 14, right: 14 },
    body: [
      ["Meta mensual", monthlyGoal ? formatHours(monthlyGoal) : "No definida"],
      ["Horas de predicacion", formatHours(preachingTotal)],
      ["Horas de credito", formatHours(creditTotal)],
      ["Total combinado", formatHours(combinedTotal)],
      [
        "Progreso de la meta",
        progressPercent !== null ? `${formatHours(combinedTotal)} / ${formatHours(monthlyGoal)} (${progressPercent}%)` : "—",
      ],
    ],
    styles: {
      fontSize: 10,
      cellPadding: 4,
      textColor: PDF_THEME.text,
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 70 },
      1: { halign: "right" },
    },
    alternateRowStyles: {
      fillColor: [248, 251, 255],
    },
  });

  cursorY = doc.lastAutoTable.finalY + 10;

  cursorY = drawPdfSectionTitle(doc, "Resumen por dia", cursorY);

  autoTable(doc, {
    startY: cursorY,
    head: [["Fecha", "Predicacion", "Credito", "Total dia"]],
    body: dailyRows.length
      ? dailyRows.map((row) => [
          formatDate(row.dateValue),
          formatHours(row.preachingHours),
          formatHours(row.creditHours),
          formatHours(row.totalHours),
        ])
      : [["Sin registros en este mes", "", "", ""]],
    margin: { left: 14, right: 14 },
    headStyles: {
      fillColor: PDF_THEME.primary,
      textColor: 255,
      fontStyle: "bold",
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right", fontStyle: "bold" },
    },
  });

  cursorY = doc.lastAutoTable.finalY + 10;

  cursorY = drawPdfSectionTitle(doc, "Horas de predicacion", cursorY);

  autoTable(doc, {
    startY: cursorY,
    head: [["Fecha", "Horas", "Momento del dia"]],
    body: preachingRecords.length
      ? preachingRecords.map((record) => [
          formatDate(record.date),
          formatHours(record.hours),
          capitalize(record.shift),
        ])
      : [["Sin registros", "", ""]],
    margin: { left: 14, right: 14 },
    headStyles: {
      fillColor: PDF_THEME.primary,
      textColor: 255,
      fontStyle: "bold",
    },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      1: { halign: "right" },
    },
    foot: preachingRecords.length
      ? [["Total del mes", formatHours(preachingTotal), ""]]
      : undefined,
    footStyles: {
      fillColor: [233, 238, 255],
      textColor: PDF_THEME.text,
      fontStyle: "bold",
    },
  });

  cursorY = doc.lastAutoTable.finalY + 10;

  if (cursorY > 240) {
    doc.addPage();
    cursorY = 18;
  }

  cursorY = drawPdfSectionTitle(doc, "Horas de credito", cursorY);

  autoTable(doc, {
    startY: cursorY,
    head: [["Fecha", "Horas"]],
    body: creditRecords.length
      ? creditRecords.map((record) => [formatDate(record.date), formatHours(record.hours)])
      : [["Sin registros", ""]],
    margin: { left: 14, right: 14 },
    headStyles: {
      fillColor: PDF_THEME.credit,
      textColor: 255,
      fontStyle: "bold",
    },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      1: { halign: "right" },
    },
    foot: creditRecords.length ? [["Total del mes", formatHours(creditTotal)]] : undefined,
    footStyles: {
      fillColor: [222, 248, 240],
      textColor: PDF_THEME.text,
      fontStyle: "bold",
    },
  });

  cursorY = doc.lastAutoTable.finalY + 10;

  if (cursorY > 220) {
    doc.addPage();
    cursorY = 18;
  }

  cursorY = drawPdfSectionTitle(doc, "Revisitas y estudios (regreso en el mes)", cursorY);

  autoTable(doc, {
    startY: cursorY,
    head: [["Persona", "Direccion", "Regreso", "Tipo", "Notas"]],
    body: followups.length
      ? followups.map((followUp) => [
          followUp.name,
          followUp.address,
          `${formatDate(followUp.returnDate)} ${followUp.returnTime}`,
          capitalize(followUp.type),
          followUp.notes || "Sin notas",
        ])
      : [["Sin seguimientos en este mes", "", "", "", ""]],
    margin: { left: 14, right: 14 },
    headStyles: {
      fillColor: [122, 73, 216],
      textColor: 255,
      fontStyle: "bold",
    },
    styles: {
      fontSize: 8,
      cellPadding: 3,
      overflow: "linebreak",
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 38 },
      2: { cellWidth: 32 },
      3: { cellWidth: 22 },
      4: { cellWidth: "auto" },
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(...PDF_THEME.muted);
    doc.text(`Informe ${monthTitle}`, 14, 287);
    doc.text(`Pagina ${page} de ${pageCount}`, pageWidth - 14, 287, { align: "right" });
  }

  doc.save(`Informe-Predicacion-${formatMonthSlug(monthValue)}.pdf`);

  showToast({
    title: "PDF exportado",
    body: `Se descargo el informe de ${monthTitle}.`,
    tone: "success",
    badge: "PDF",
  });
}

async function handleImportData(event) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) {
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());

    if (
      !Array.isArray(parsed.preachingRecords) ||
      !Array.isArray(parsed.creditRecords) ||
      !Array.isArray(parsed.followUps)
    ) {
      throw new Error("El archivo no contiene el formato esperado.");
    }

    if (
      !window.confirm(
        "Se reemplazaran todos los datos actuales por los del archivo importado. Deseas continuar?"
      )
    ) {
      return;
    }

    state.preachingRecords = parsed.preachingRecords;
    state.creditRecords = parsed.creditRecords;
    state.followUps = parsed.followUps;
    state.reminderLog = {};
    state.editing = createDefaultState().editing;
    state.filters = {
      ...createDefaultState().filters,
      ...(parsed.filters && typeof parsed.filters === "object" ? parsed.filters : {}),
    };
    state.monthlyGoals =
      parsed.monthlyGoals && typeof parsed.monthlyGoals === "object"
        ? parsed.monthlyGoals
        : createDefaultState().monthlyGoals;

    saveState();
    resetPreachingForm();
    resetCreditForm();
    resetFollowupForm();
    syncFilterInputsFromState();
    syncMonthlyGoalInput();
    renderAll();

    checkFollowupReminders(false);

    showToast({
      title: "Datos importados",
      body: "Tus registros se restauraron correctamente desde la copia de seguridad.",
      tone: "success",
      badge: "Respaldo",
    });
  } catch (error) {
    console.error("No se pudo importar la copia:", error);
    showToast({
      title: "Importacion fallida",
      body: "No se pudo leer el archivo. Verifica que sea un JSON de respaldo valido.",
      tone: "warning",
      badge: "Respaldo",
    });
  }
}

function handlePreachingSubmit(event) {
  event.preventDefault();

  const saved = upsertPreachingRecord({
    editingId: state.editing.preachingId,
    date: document.getElementById("preachingDate").value,
    hours: Number.parseFloat(document.getElementById("preachingHours").value),
    shift: document.getElementById("preachingShift").value,
  });

  if (!saved) {
    return;
  }

  resetPreachingForm();
  renderAll();
}

function handleCreditSubmit(event) {
  event.preventDefault();

  const saved = upsertCreditRecord({
    editingId: state.editing.creditId,
    date: document.getElementById("creditDate").value,
    hours: Number.parseFloat(document.getElementById("creditHours").value),
  });

  if (!saved) {
    return;
  }

  resetCreditForm();
  renderAll();
}

function handleFollowupSubmit(event) {
  event.preventDefault();

  const followUp = {
    id: state.editing.followupId || crypto.randomUUID(),
    name: document.getElementById("followupName").value.trim(),
    address: document.getElementById("followupAddress").value.trim(),
    notes: document.getElementById("followupNotes").value.trim(),
    returnDate: document.getElementById("followupReturnDate").value,
    returnTime: document.getElementById("followupReturnTime").value,
    type: document.getElementById("followupType").value,
    createdAt: state.editing.followupId
      ? getFollowupById(state.editing.followupId)?.createdAt || new Date().toISOString()
      : new Date().toISOString(),
  };

  if (!followUp.name || !followUp.address || !followUp.returnDate || !followUp.returnTime) {
    return;
  }

  if (state.editing.followupId) {
    state.followUps = state.followUps.map((item) =>
      item.id === state.editing.followupId ? followUp : item
    );
  } else {
    state.followUps.push(followUp);
  }

  saveState();
  resetFollowupForm();
  renderFollowups();
  showToast({
    title: "Seguimiento guardado",
    body: `Se registro ${followUp.type} para ${followUp.name}.`,
    tone: "success",
    badge: capitalize(followUp.type),
  });
  checkFollowupReminders(false);
}

function resetPreachingForm() {
  state.editing.preachingId = null;
  document.getElementById("preachingForm").reset();
  document.getElementById("preachingDate").value = toDateInputValue(new Date());
  document.getElementById("preachingShift").value = "manana";
  document.getElementById("preachingCancelEdit").classList.add("hidden");
  document.querySelector("#preachingForm .primary-button").textContent = "Guardar registro";
}

function resetCreditForm() {
  state.editing.creditId = null;
  document.getElementById("creditForm").reset();
  document.getElementById("creditDate").value = toDateInputValue(new Date());
  document.getElementById("creditCancelEdit").classList.add("hidden");
  document.querySelector("#creditForm .primary-button").textContent = "Guardar credito";
}

function resetFollowupForm() {
  state.editing.followupId = null;
  document.getElementById("followupForm").reset();
  document.getElementById("followupReturnDate").value = toDateInputValue(new Date());
  document.getElementById("followupReturnTime").value = "18:00";
  document.getElementById("followupType").value = "revisita";
  document.getElementById("followupCancelEdit").classList.add("hidden");
  document.querySelector("#followupForm .primary-button").textContent = "Guardar seguimiento";
}

function editPreaching(id) {
  const record = state.preachingRecords.find((item) => item.id === id);
  if (!record) {
    return;
  }

  state.editing.preachingId = id;
  document.getElementById("preachingId").value = record.id;
  document.getElementById("preachingDate").value = record.date;
  document.getElementById("preachingHours").value = record.hours;
  document.getElementById("preachingShift").value = record.shift;
  document.getElementById("preachingCancelEdit").classList.remove("hidden");
  document.querySelector("#preachingForm .primary-button").textContent = "Actualizar registro";
  document.getElementById("preachingDate").focus();
}

function editCredit(id) {
  const record = state.creditRecords.find((item) => item.id === id);
  if (!record) {
    return;
  }

  state.editing.creditId = id;
  document.getElementById("creditId").value = record.id;
  document.getElementById("creditDate").value = record.date;
  document.getElementById("creditHours").value = record.hours;
  document.getElementById("creditCancelEdit").classList.remove("hidden");
  document.querySelector("#creditForm .primary-button").textContent = "Actualizar credito";
  document.getElementById("creditDate").focus();
}

function editFollowup(id) {
  const followUp = getFollowupById(id);
  if (!followUp) {
    return;
  }

  state.editing.followupId = id;
  document.getElementById("followupId").value = followUp.id;
  document.getElementById("followupName").value = followUp.name;
  document.getElementById("followupAddress").value = followUp.address;
  document.getElementById("followupNotes").value = followUp.notes;
  document.getElementById("followupReturnDate").value = followUp.returnDate;
  document.getElementById("followupReturnTime").value = followUp.returnTime;
  document.getElementById("followupType").value = followUp.type;
  document.getElementById("followupCancelEdit").classList.remove("hidden");
  document.querySelector("#followupForm .primary-button").textContent = "Actualizar seguimiento";
  document.getElementById("followupName").focus();
}

function removePreaching(id) {
  if (!window.confirm("Se eliminara este registro de predicacion. Deseas continuar?")) {
    return;
  }

  state.preachingRecords = state.preachingRecords.filter((item) => item.id !== id);
  if (state.editing.preachingId === id) {
    resetPreachingForm();
  }
  saveState();
  renderAll();
}

function removeCredit(id) {
  if (!window.confirm("Se eliminara este registro de credito. Deseas continuar?")) {
    return;
  }

  state.creditRecords = state.creditRecords.filter((item) => item.id !== id);
  if (state.editing.creditId === id) {
    resetCreditForm();
  }
  saveState();
  renderAll();
}

function removeFollowup(id) {
  if (!window.confirm("Se eliminara este seguimiento. Deseas continuar?")) {
    return;
  }

  state.followUps = state.followUps.filter((item) => item.id !== id);
  Object.keys(state.reminderLog).forEach((key) => {
    if (key.startsWith(`${id}:`)) {
      delete state.reminderLog[key];
    }
  });
  if (state.editing.followupId === id) {
    resetFollowupForm();
  }
  saveState();
  renderFollowups();
  scheduleAllFollowupReminders();
}

function renderAll() {
  renderHeroSummary();
  renderPreachingSection();
  renderCreditSection();
  renderFollowups();
  renderNotificationStatus();
}

function renderHeroSummary() {
  const monthValue = getActiveMonthValue();
  const preachingMonthTotal = sumHours(filterByMonth(state.preachingRecords, monthValue));
  const creditMonthTotal = sumHours(filterByMonth(state.creditRecords, monthValue));
  const combinedMonthTotal = preachingMonthTotal + creditMonthTotal;

  document.getElementById("heroPreachingMonth").textContent = formatHours(preachingMonthTotal);
  document.getElementById("heroCreditMonth").textContent = formatHours(creditMonthTotal);
  document.getElementById("heroCombinedMonth").textContent = formatHours(combinedMonthTotal);
  renderMonthlyGoalUI();
}

function renderPreachingSection() {
  renderPreachingStats();
  renderPreachingTable();
  renderCalendar();
}

function renderPreachingStats() {
  const selectedDate = document.getElementById("preachingDate").value || toDateInputValue(new Date());
  const weekValue = document.getElementById("preachingWeekFilter").value || toWeekInputValue(new Date());
  const monthValue = document.getElementById("preachingMonthFilter").value || toMonthValue(new Date());

  const dayTotal = sumHours(
    state.preachingRecords.filter((item) => item.date === selectedDate)
  );
  const weekTotal = sumHours(
    filterByWeek(state.preachingRecords, weekValue)
  );
  const monthTotal = sumHours(
    filterByMonth(state.preachingRecords, monthValue)
  );

  const combinedMonthTotal = getCombinedMonthHours(monthValue);

  document.getElementById("preachingDayTotal").textContent = formatHours(dayTotal);
  document.getElementById("preachingWeekTotal").textContent = formatHours(weekTotal);
  document.getElementById("preachingMonthTotal").textContent = formatHours(monthTotal);
  document.getElementById("preachingCombinedMonthTotal").textContent = formatHours(combinedMonthTotal);
}

function renderCreditSection() {
  const weekValue = document.getElementById("creditWeekFilter").value || toWeekInputValue(new Date());
  const monthValue = document.getElementById("creditMonthFilter").value || toMonthValue(new Date());

  const creditMonthTotal = sumHours(filterByMonth(state.creditRecords, monthValue));
  const combinedMonthTotal = getCombinedMonthHours(monthValue);

  document.getElementById("creditWeekTotal").textContent = formatHours(
    sumHours(filterByWeek(state.creditRecords, weekValue))
  );
  document.getElementById("creditMonthTotal").textContent = formatHours(creditMonthTotal);
  document.getElementById("creditCombinedMonthTotal").textContent = formatHours(combinedMonthTotal);

  renderCreditTable();
}

function renderCalendar() {
  const monthValue = document.getElementById("preachingMonthFilter").value || toMonthValue(new Date());
  const calendarGrid = document.getElementById("calendarGrid");
  const weekdaysContainer = document.getElementById("calendarWeekdays");

  weekdaysContainer.innerHTML = WEEKDAYS.map((day) => `<span>${day}</span>`).join("");
  calendarGrid.innerHTML = "";

  const [year, month] = monthValue.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const leadingEmptySlots = (firstDay.getDay() + 6) % 7;

  document.getElementById("calendarTitle").textContent = capitalize(MONTH_FORMATTER.format(firstDay));

  for (let index = 0; index < leadingEmptySlots; index += 1) {
    const filler = document.createElement("div");
    filler.className = "calendar-filler";
    calendarGrid.appendChild(filler);
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const currentDate = new Date(year, month - 1, day);
    const dayValue = toDateInputValue(currentDate);
    const preachingRecords = state.preachingRecords.filter((item) => item.date === dayValue);
    const creditRecords = state.creditRecords.filter((item) => item.date === dayValue);

    const dayElement = document.createElement("div");
    dayElement.className = "calendar-day";

    if (dayValue === toDateInputValue(new Date())) {
      dayElement.classList.add("is-today");
    }
    if (preachingRecords.length && creditRecords.length) {
      dayElement.classList.add("mixed-day");
    } else if (preachingRecords.length) {
      dayElement.classList.add("preaching-day");
    } else if (creditRecords.length) {
      dayElement.classList.add("credit-day");
    }

    const combinedDayHours = getCombinedDayHours(dayValue);
    const combinedTag =
      preachingRecords.length && creditRecords.length
        ? `<span class="tag combined">${formatHours(combinedDayHours)}</span>`
        : "";

    dayElement.innerHTML = `
      <div class="day-number">${day}</div>
      <div class="day-tags">
        ${preachingRecords.length ? `<span class="tag preaching">${formatHours(sumHours(preachingRecords))}</span>` : ""}
        ${creditRecords.length ? `<span class="tag credit">${formatHours(sumHours(creditRecords))}</span>` : ""}
        ${combinedTag}
      </div>
    `;

    dayElement.dataset.date = dayValue;
    dayElement.setAttribute("role", "button");
    dayElement.setAttribute("tabindex", "0");
    dayElement.setAttribute("aria-label", `Editar registros del ${formatDate(dayValue)}`);

    if (dayEditorDate === dayValue) {
      dayElement.classList.add("is-selected");
    }

    dayElement.addEventListener("click", () => openDayEditor(dayValue));
    dayElement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDayEditor(dayValue);
      }
    });

    calendarGrid.appendChild(dayElement);
  }
}

function renderPreachingTable() {
  const monthValue = document.getElementById("preachingMonthFilter").value;
  const weekValue = document.getElementById("preachingWeekFilter").value;
  const records = applyCombinedFilters(state.preachingRecords, monthValue, weekValue);

  renderTable(
    document.getElementById("preachingTableBody"),
    records
      .sort(sortByDateDesc)
      .map(
        (record) => `
          <tr>
            <td>${formatDate(record.date)}</td>
            <td>${formatHours(record.hours)}</td>
            <td>${capitalize(record.shift)}</td>
            <td><span class="type-pill preaching">Predicacion</span></td>
            <td>
              <div class="table-actions">
                <button class="action-button edit" data-action="edit-preaching" data-id="${record.id}">Editar</button>
                <button class="action-button delete" data-action="delete-preaching" data-id="${record.id}">Eliminar</button>
              </div>
            </td>
          </tr>`
      ),
    5
  );
}

function renderCreditTable() {
  const monthValue = document.getElementById("creditMonthFilter").value;
  const weekValue = document.getElementById("creditWeekFilter").value;
  const records = applyCombinedFilters(state.creditRecords, monthValue, weekValue);

  renderTable(
    document.getElementById("creditTableBody"),
    records
      .sort(sortByDateDesc)
      .map(
        (record) => `
          <tr>
            <td>${formatDate(record.date)}</td>
            <td>${formatHours(record.hours)}</td>
            <td><span class="type-pill credit">Credito</span></td>
            <td>
              <div class="table-actions">
                <button class="action-button edit" data-action="edit-credit" data-id="${record.id}">Editar</button>
                <button class="action-button delete" data-action="delete-credit" data-id="${record.id}">Eliminar</button>
              </div>
            </td>
          </tr>`
      ),
    4
  );
}

function renderFollowups() {
  renderTable(
    document.getElementById("followupTableBody"),
    [...state.followUps]
      .sort((left, right) => {
        const leftDateTime = `${left.returnDate}T${left.returnTime}`;
        const rightDateTime = `${right.returnDate}T${right.returnTime}`;
        return new Date(leftDateTime) - new Date(rightDateTime);
      })
      .map(
        (followUp) => `
          <tr>
            <td>${escapeHtml(followUp.name)}</td>
            <td>${escapeHtml(followUp.address)}</td>
            <td>${escapeHtml(followUp.notes || "Sin notas")}</td>
            <td>${formatDate(followUp.returnDate)} ${formatTimeFromValue(followUp.returnDate, followUp.returnTime)}</td>
            <td><span class="type-pill followup">${capitalize(followUp.type)}</span></td>
            <td>
              <div class="table-actions">
                <button class="action-button edit" data-action="edit-followup" data-id="${followUp.id}">Editar</button>
                <button class="action-button delete" data-action="delete-followup" data-id="${followUp.id}">Eliminar</button>
              </div>
            </td>
          </tr>`
      ),
    6
  );
}

function renderTable(tableBody, rows, colspan) {
  tableBody.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td colspan="${colspan}" class="empty-state">Aun no hay registros para mostrar.</td></tr>`;

  tableBody.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const { action, id } = button.dataset;

      if (action === "edit-preaching") {
        editPreaching(id);
      }
      if (action === "delete-preaching") {
        removePreaching(id);
      }
      if (action === "edit-credit") {
        editCredit(id);
      }
      if (action === "delete-credit") {
        removeCredit(id);
      }
      if (action === "edit-followup") {
        editFollowup(id);
      }
      if (action === "delete-followup") {
        removeFollowup(id);
      }
    });
  });
}

function bindReminderVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      checkFollowupReminders(false);
    }
  });

  window.addEventListener("focus", () => {
    checkFollowupReminders(false);
  });
}

async function initializeNotificationSupport() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
    serviceWorkerRegistration = await navigator.serviceWorker.ready;
  } catch (error) {
    console.error("No se pudo registrar el service worker:", error);
  }
}

function getFollowupReminderEvents(followUp) {
  const events = [];
  const createdAt = new Date(followUp.createdAt);
  const createdDayValue = toDateInputValue(startOfDay(createdAt));
  const returnDateTime = new Date(`${followUp.returnDate}T${followUp.returnTime}`);

  events.push({
    logKey: `${followUp.id}:created:${createdDayValue}`,
    at: createdAt.getTime(),
    title: "Seguimiento agregado hoy",
    body: `${capitalize(followUp.type)} agregada para ${followUp.name}. Regreso: ${formatDate(followUp.returnDate)} a las ${followUp.returnTime}.`,
    badge: capitalize(followUp.type),
    tone: "success",
    onlyOnCreatedDay: true,
  });

  const dayBeforeMorning = new Date(`${followUp.returnDate}T00:00:00`);
  dayBeforeMorning.setDate(dayBeforeMorning.getDate() - 1);
  dayBeforeMorning.setHours(DAY_BEFORE_REMINDER_HOUR, 0, 0, 0);

  events.push({
    logKey: `${followUp.id}:before:${toDateInputValue(startOfDay(dayBeforeMorning))}`,
    at: dayBeforeMorning.getTime(),
    title: "Recordatorio de regreso",
    body: `Manana regresas con ${followUp.name} a las ${followUp.returnTime}.`,
    badge: "Manana",
    tone: "reminder",
  });

  const returnDayMorning = new Date(`${followUp.returnDate}T00:00:00`);
  returnDayMorning.setHours(RETURN_DAY_REMINDER_HOUR, 0, 0, 0);

  events.push({
    logKey: `${followUp.id}:return-day:${followUp.returnDate}`,
    at: returnDayMorning.getTime(),
    title: "Regreso hoy",
    body: `Hoy regresas con ${followUp.name} a las ${followUp.returnTime}.`,
    badge: "Hoy",
    tone: "reminder",
  });

  events.push({
    logKey: `${followUp.id}:return-time:${followUp.returnDate}T${followUp.returnTime}`,
    at: returnDateTime.getTime(),
    title: "Hora de regreso",
    body: `Es la hora de regresar con ${followUp.name}.`,
    badge: "Ahora",
    tone: "reminder",
  });

  return events;
}

function shouldFireReminderEvent(event, followUp, nowMs) {
  if (state.reminderLog[event.logKey]) {
    return false;
  }

  if (event.onlyOnCreatedDay) {
    const todayValue = toDateInputValue(new Date(nowMs));
    const createdDayValue = toDateInputValue(startOfDay(new Date(followUp.createdAt)));
    if (todayValue !== createdDayValue) {
      return false;
    }
  }

  if (nowMs < event.at) {
    return false;
  }

  return nowMs - event.at <= REMINDER_CATCHUP_MS;
}

function clearScheduledReminderTimeouts() {
  while (scheduledReminderTimeouts.length) {
    clearTimeout(scheduledReminderTimeouts.pop());
  }
}

function scheduleAllFollowupReminders() {
  clearScheduledReminderTimeouts();
  const nowMs = Date.now();

  state.followUps.forEach((followUp) => {
    getFollowupReminderEvents(followUp).forEach((event) => {
      if (event.onlyOnCreatedDay || event.at <= nowMs) {
        return;
      }

      const delayMs = event.at - nowMs;
      if (delayMs > REMINDER_MAX_SCHEDULE_MS) {
        return;
      }

      const timeoutId = window.setTimeout(() => {
        const currentFollowUp = getFollowupById(followUp.id);
        if (!currentFollowUp) {
          return;
        }

        if (shouldFireReminderEvent(event, currentFollowUp, Date.now())) {
          maybeNotify({
            title: event.title,
            body: event.body,
            badge: event.badge,
            tone: event.tone,
            logKey: event.logKey,
          });
        }
      }, delayMs);

      scheduledReminderTimeouts.push(timeoutId);
    });
  });
}

function startReminderLoop() {
  if (reminderIntervalId) {
    clearInterval(reminderIntervalId);
  }

  reminderIntervalId = window.setInterval(() => {
    checkFollowupReminders(false);
  }, REMINDER_CHECK_INTERVAL_MS);
}

function checkFollowupReminders(forceManualCheck) {
  const nowMs = Date.now();
  let triggeredReminders = 0;

  state.followUps.forEach((followUp) => {
    getFollowupReminderEvents(followUp).forEach((event) => {
      if (!shouldFireReminderEvent(event, followUp, nowMs)) {
        return;
      }

      maybeNotify({
        title: event.title,
        body: event.body,
        badge: event.badge,
        tone: event.tone,
        logKey: event.logKey,
      });
      triggeredReminders += 1;
    });
  });

  if (forceManualCheck && triggeredReminders === 0) {
    showToast({
      title: "Sin recordatorios pendientes",
      body: "No hay seguimientos que deban avisarse en este momento.",
      tone: "info",
      badge: "Revisado",
    });
  }

  scheduleAllFollowupReminders();
}

function maybeNotify({ title, body, badge, tone, logKey }) {
  showToast({
    title,
    body,
    badge,
    tone,
    actionLabel: "Ver agenda",
    onAction: openFollowupSection,
  });

  if (canUseSystemNotifications()) {
    notify(title, body);
  }

  state.reminderLog[logKey] = new Date().toISOString();
  saveState();
}

async function notify(title, body) {
  const notificationOptions = {
    body,
    tag: title,
    icon: "./icons/app-icon.svg",
    data: {
      url: "./index.html#seguimiento",
    },
  };

  if (serviceWorkerRegistration && typeof serviceWorkerRegistration.showNotification === "function") {
    try {
      await serviceWorkerRegistration.showNotification(title, notificationOptions);
      return;
    } catch (error) {
      console.error("No se pudo mostrar la notificacion con el service worker:", error);
    }
  }

  new Notification(title, notificationOptions);
}

function canUseSystemNotifications() {
  return "Notification" in window && Notification.permission === "granted";
}

function renderNotificationStatus() {
  const statusPill = document.getElementById("notificationStatusPill");
  const statusText = document.getElementById("notificationStatusText");
  const enableButton = document.getElementById("enableNotifications");

  if (!statusPill || !statusText || !enableButton) {
    return;
  }

  statusPill.className = "status-pill internal";

  if (!("Notification" in window)) {
    statusPill.textContent = "Internas activas";
    statusText.textContent = "Tu navegador no admite avisos del sistema, pero las notificaciones visuales de la app ya estan activas.";
    enableButton.disabled = true;
    enableButton.textContent = "Navegador no compatible";
    return;
  }

  enableButton.disabled = false;

  if (Notification.permission === "granted") {
    statusPill.className = "status-pill granted";
    statusPill.textContent = "Navegador activado";
    statusText.textContent =
      "Recordatorios de revisitas activos: dia anterior, dia del regreso y hora exacta (con la pagina abierta o en segundo plano).";
    enableButton.textContent = "Permiso concedido";
    enableButton.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    statusPill.className = "status-pill denied";
    statusPill.textContent = "Permiso bloqueado";
    statusText.textContent = "El navegador tiene bloqueados los avisos del sistema. Los recordatorios visuales de la app siguen funcionando.";
    enableButton.textContent = "Permiso bloqueado";
    return;
  }

  statusPill.className = "status-pill default";
  statusPill.textContent = "Falta permiso";
  statusText.textContent = "Los recordatorios internos ya funcionan. Pulsa el boton para habilitar tambien los avisos del navegador.";
  enableButton.textContent = "Activar avisos del navegador";
}

function openFollowupSection() {
  window.location.hash = "seguimiento";
  const targetButton = document.querySelector('.tab-button[data-tab="seguimiento"]');
  if (targetButton) {
    targetButton.click();
  }

  document.getElementById("followupForm")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function showToast({ title, body, badge = "Recordatorio", tone = "info", actionLabel, onAction }) {
  const toastRegion = document.getElementById("toastRegion");
  if (!toastRegion) {
    return;
  }

  const toast = document.createElement("article");
  toast.className = `toast ${tone}`;
  toast.setAttribute("role", "status");

  toast.innerHTML = `
    <div class="toast-header">
      <div>
        <span class="toast-badge">${escapeHtml(badge)}</span>
        <h3 class="toast-title">${escapeHtml(title)}</h3>
      </div>
      <button type="button" class="toast-close" aria-label="Cerrar notificacion">x</button>
    </div>
    <p class="toast-body">${escapeHtml(body)}</p>
    ${actionLabel ? `<div class="toast-actions"><button type="button" class="toast-action">${escapeHtml(actionLabel)}</button></div>` : ""}
  `;

  const closeToast = () => {
    if (toast.dataset.leaving === "true") {
      return;
    }

    toast.dataset.leaving = "true";
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 180);
  };

  toast.querySelector(".toast-close").addEventListener("click", closeToast);

  if (actionLabel && typeof onAction === "function") {
    const actionButton = toast.querySelector(".toast-action");
    actionButton.addEventListener("click", () => {
      onAction();
      closeToast();
    });
  }

  toastRegion.prepend(toast);
  window.setTimeout(closeToast, TOAST_DURATION_MS);
}

function getFollowupById(id) {
  return state.followUps.find((item) => item.id === id);
}

function filterByMonth(records, monthValue) {
  if (!monthValue) {
    return records;
  }
  return records.filter((item) => item.date.startsWith(monthValue));
}

function filterByWeek(records, weekValue) {
  if (!weekValue) {
    return records;
  }

  return records.filter((item) => toWeekInputValue(new Date(`${item.date}T00:00:00`)) === weekValue);
}

function applyCombinedFilters(records, monthValue, weekValue) {
  return records.filter((item) => {
    const matchesMonth = !monthValue || item.date.startsWith(monthValue);
    const matchesWeek = !weekValue || toWeekInputValue(new Date(`${item.date}T00:00:00`)) === weekValue;
    return matchesMonth && matchesWeek;
  });
}

function sumHours(records) {
  return records.reduce((total, item) => total + Number(item.hours || 0), 0);
}

function formatHours(value) {
  return `${Number(value).toFixed(2).replace(/\.00$/, "")} h`;
}

function formatDate(value) {
  return DATE_FORMATTER.format(new Date(`${value}T00:00:00`));
}

function formatTimeFromValue(dateValue, timeValue) {
  return TIME_FORMATTER.format(new Date(`${dateValue}T${timeValue}`));
}

function toDateInputValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function toMonthValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toWeekInputValue(date) {
  const target = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
  return `${target.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function sortByDateDesc(left, right) {
  return new Date(`${right.date}T00:00:00`) - new Date(`${left.date}T00:00:00`);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dayDifference(left, right) {
  return Math.round((right - left) / (24 * 60 * 60 * 1000));
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
