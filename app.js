import { computeSchedule } from "./schedule.js";
import { coerceMinutes, createStep, emptyPlan, moveStep } from "./plan.js";
import {
  createTemplate,
  findTemplate,
  findTemplateByName,
  planStepsFrom,
  removeTemplate,
  saveTemplate,
} from "./templates.js";
import {
  SHARE_PARAM,
  addImported,
  exportLibrary,
  parseExportFile,
  readSharedLink,
  shareUrl,
  uniqueName,
} from "./sharing.js";
import {
  loadActiveTemplateId,
  loadPlan,
  loadTemplates,
  savePlan,
  saveActiveTemplateId,
  saveTemplates,
} from "./storage.js";

const UNDO_MS = 6000;

const deadlineLabelEl = document.querySelector("#deadline-label");
const deadlineInputEl = document.querySelector("#deadline-input");
const deadlineTimeEl = document.querySelector("#deadline-time");
const deadlineDateEl = document.querySelector("#deadline-date");
const hintEl = document.querySelector("#hint");
const stepsEl = document.querySelector("#steps");
const leaveEl = document.querySelector("#leave");
const leaveTimeEl = document.querySelector("#leave-time");
const leaveDateEl = document.querySelector("#leave-date");
const leaveTotalEl = document.querySelector("#leave-total");
const addStepEl = document.querySelector("#add-step");
const newLabelEl = document.querySelector("#new-label");
const newMinutesEl = document.querySelector("#new-minutes");
const clearAllEl = document.querySelector("#clear-all");
const reorderEl = document.querySelector("#reorder");
const undoEl = document.querySelector("#undo");
const undoMessageEl = document.querySelector("#undo-message");
const undoActionEl = document.querySelector("#undo-action");
const tabsEl = document.querySelector(".tabs");
const tabEls = [...document.querySelectorAll(".tab")];
const planningTabEl = document.querySelector("#tab-planning");
const templatesTabEl = document.querySelector("#tab-templates");
const saveTemplateEl = document.querySelector("#template-save");
const templateListEl = document.querySelector("#template-list");
const templatesEmptyEl = document.querySelector("#templates-empty");
const exportAllEl = document.querySelector("#export-all");
const importOpenEl = document.querySelector("#import-open");
const importFileEl = document.querySelector("#import-file");
const importDialogEl = document.querySelector("#import-dialog");
const importFormEl = document.querySelector("#import-form");
const importTitleEl = document.querySelector("#import-title");
const importBodyEl = document.querySelector("#import-body");
const importAllRowEl = document.querySelector("#import-all-row");
const importAllEl = document.querySelector("#import-all");
const importAllLabelEl = document.querySelector("#import-all-label");
const importButtonsEl = document.querySelector("#import-buttons");

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const state = loadPlan();

let library = loadTemplates();
// The template the Update button writes to: whichever was last loaded or
// saved. Persisted, so Update survives a reload of the installed app.
let activeId = loadActiveTemplateId();
if (findTemplate(library, activeId) === undefined) activeId = "";

// Which name is being typed, and what for: null, {kind:"new"}, or
// {kind:"rename", id}. The field is rendered into the list rather than kept in
// the markup, so a rename can appear in the row it belongs to.
let naming = null;

// Reorder mode swaps each row's minutes and delete for move buttons. It is a
// passing mode, not a setting: leaving the tab or reloading ends it.
let reordering = false;

// A destructive action applies immediately and parks an undo here for UNDO_MS.
// The parked value is a closure that puts the previous state back — including
// persisting and re-rendering, since what needs saving differs between a step
// and a template. Only one is ever pending: a second action commits the first.
let pending = null;
let pendingTimer = 0;

function formatAt(date, withDate) {
  const time = timeFmt.format(date);
  return withDate ? `${time} (${dateFmt.format(date)})` : time;
}

function isToday(date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function renderStructure() {
  stepsEl.replaceChildren();

  for (const [index, step] of state.steps.entries()) {
    const li = document.createElement("li");
    li.className = "step";
    li.dataset.id = step.id;

    const time = document.createElement("span");
    time.className = "step__time";

    const label = document.createElement("input");
    label.className = "step__label";
    label.type = "text";
    label.value = step.label;
    label.placeholder = "Unnamed step";
    label.autocomplete = "off";
    label.setAttribute("aria-label", "Step name");

    const minutes = document.createElement("input");
    minutes.className = "step__minutes";
    minutes.type = "number";
    minutes.min = "0";
    minutes.step = "1";
    minutes.inputMode = "numeric";
    minutes.value = String(step.minutes);
    minutes.placeholder = "0";
    minutes.setAttribute("aria-label", "Minutes");

    const unit = document.createElement("span");
    unit.className = "step__unit";
    unit.textContent = "min";

    const remove = document.createElement("button");
    remove.className = "step__delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete step");

    // Always built and shown only in reorder mode, so entering the mode is a
    // class change rather than a rebuild that would drop focus.
    const up = moveButton("up", "▲");
    const down = moveButton("down", "▼");
    up.disabled = index === 0;
    down.disabled = index === state.steps.length - 1;

    li.append(time, label, minutes, unit, remove, up, down);
    nameMoveButtons(li, step.label);
    stepsEl.append(li);
  }
}

function moveButton(direction, text) {
  const button = document.createElement("button");
  button.className = `step__move step__move--${direction}`;
  button.type = "button";
  button.dataset.direction = direction;
  button.textContent = text;
  return button;
}

// The step's name is a sibling of the buttons, so their accessible names have
// to carry it or every row sounds identical.
function nameMoveButtons(li, label) {
  const name = label.trim() === "" ? "step" : `“${label.trim()}”`;
  for (const button of li.querySelectorAll(".step__move")) {
    button.setAttribute("aria-label", `Move ${name} ${button.dataset.direction}`);
  }
}

function renderReorder() {
  // Fewer than two steps leaves nothing to reorder, so the mode ends itself.
  if (state.steps.length < 2) reordering = false;
  reorderEl.hidden = state.steps.length < 2;
  reorderEl.textContent = reordering ? "Done" : "Reorder";
  stepsEl.classList.toggle("steps--reordering", reordering);
  addStepEl.hidden = reordering;
  renderClearButton();
}

function setReordering(next) {
  reordering = next;
  renderReorder();
}

function renderTimes() {
  const { deadlineAt, rows, leaveAt, leaveDayOffset, totalMinutes } = computeSchedule(state);
  const hasDeadline = deadlineAt !== null;
  const hasSteps = state.steps.length > 0;

  // The native picker prints its value in the browser's locale, which would
  // put a 12-hour string at the head of a 24-hour column. So the time is drawn
  // here from the same parsed value the schedule was built from.
  if (hasDeadline) {
    deadlineTimeEl.textContent = timeFmt.format(deadlineAt);
    deadlineTimeEl.classList.remove("deadline__time--unset");
    deadlineDateEl.textContent = isToday(deadlineAt) ? "Today" : dayFmt.format(deadlineAt);
  } else {
    deadlineTimeEl.textContent = "Set a time";
    deadlineTimeEl.classList.add("deadline__time--unset");
    deadlineDateEl.textContent = "";
  }

  if (!hasDeadline) {
    hintEl.textContent = "Set a deadline to see your schedule.";
  } else if (!hasSteps) {
    hintEl.textContent = "Add the last thing you do before it.";
  }
  hintEl.hidden = hasDeadline && hasSteps;

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const li of stepsEl.children) {
    const row = byId.get(li.dataset.id);
    li.querySelector(".step__time").textContent =
      row && hasDeadline ? formatAt(row.startsAt, row.dayOffset !== 0) : "";
    li.classList.toggle("step--zero", row ? row.minutes === 0 : false);
  }

  // With no steps the leave time only restates the deadline, so it is hidden.
  // Its date appears only when leaving falls on a different day than the
  // deadline; on the same day it would only repeat the date in the header.
  leaveEl.hidden = !hasDeadline || !hasSteps;
  if (!leaveEl.hidden) {
    leaveTimeEl.textContent = timeFmt.format(leaveAt);
    leaveDateEl.textContent = leaveDayOffset !== 0 ? `— ${dayFmt.format(leaveAt)}` : "";
    leaveTotalEl.textContent = formatDuration(totalMinutes);
  }

  renderClearButton();
}

function setActive(id) {
  activeId = id;
  saveActiveTemplateId(id);
}

function summarize(template) {
  const count = template.steps.length;
  if (count === 0) return "No steps";
  const total = template.steps.reduce((sum, step) => sum + step.minutes, 0);
  return `${count} step${count === 1 ? "" : "s"} · ${formatDuration(total)}`;
}

function templateRow(template) {
  const li = document.createElement("li");
  li.className = "template";
  li.dataset.id = template.id;

  const name = document.createElement("span");
  name.className = "template__name";
  name.textContent = template.name;
  li.append(name);

  if (template.id === activeId) {
    const inUse = document.createElement("span");
    inUse.className = "template__in-use";
    inUse.textContent = "In use";
    li.append(inUse);
  }

  const summary = document.createElement("span");
  summary.className = "template__summary";
  summary.textContent = summarize(template);
  li.append(summary);

  const actions = document.createElement("div");
  actions.className = "template__actions";

  for (const [action, label] of [
    ["load", "Load"],
    ["update", "Update"],
    ["share", "Share"],
  ]) {
    actions.append(actionButton(template, action, label, "template__action"));
  }

  // Rename and Delete are the rare ones, so they wait behind ⋯ and the row
  // keeps to one line on a phone.
  const more = document.createElement("details");
  more.className = "template__more";
  const toggle = document.createElement("summary");
  toggle.className = "template__action template__more-toggle";
  toggle.textContent = "⋯";
  toggle.setAttribute("aria-label", `More actions for “${template.name}”`);
  const menu = document.createElement("div");
  menu.className = "template__menu";
  menu.append(
    actionButton(template, "rename", "Rename", "template__menu-item"),
    actionButton(template, "delete", "Delete", "template__menu-item template__menu-item--delete")
  );
  more.append(toggle, menu);
  actions.append(more);

  li.append(actions);
  return li;
}

function actionButton(template, action, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = action === "load" ? `${className} ${className}--load` : className;
  button.dataset.action = action;
  button.textContent = label;
  // The row's name is a sibling, not part of the button, so the accessible
  // name has to carry it or every row sounds identical.
  button.setAttribute("aria-label", `${label} “${template.name}”`);
  return button;
}

function namingRow(value, label) {
  const li = document.createElement("li");
  li.className = "template";

  const form = document.createElement("form");
  form.className = "naming";

  const input = document.createElement("input");
  input.className = "naming__input";
  input.type = "text";
  input.value = value;
  input.placeholder = "Template name";
  input.autocomplete = "off";
  input.setAttribute("aria-label", label);

  const submit = document.createElement("button");
  submit.className = "naming__submit";
  submit.type = "submit";
  submit.textContent = "Save";

  const cancel = document.createElement("button");
  cancel.className = "naming__cancel";
  cancel.type = "button";
  cancel.dataset.action = "cancel";
  cancel.textContent = "Cancel";

  form.append(input, submit, cancel);
  li.append(form);
  return li;
}

function renderTemplates() {
  if (findTemplate(library, activeId) === undefined) activeId = "";

  templateListEl.replaceChildren();

  if (naming !== null && naming.kind === "new") {
    // The deadline's name is what the plan is called, so it is offered as the
    // template's name. It is only a suggestion: nothing is saved until Save.
    templateListEl.append(namingRow(state.deadlineLabel.trim(), "Name this template"));
  }

  for (const template of library.items) {
    const renaming =
      naming !== null && naming.kind === "rename" && naming.id === template.id;
    templateListEl.append(
      renaming ? namingRow(template.name, `Rename “${template.name}”`) : templateRow(template)
    );
  }

  const hasSteps = state.steps.length > 0;
  saveTemplateEl.hidden = !hasSteps || naming !== null;
  exportAllEl.hidden = library.items.length === 0;
  templatesEmptyEl.hidden = library.items.length > 0 || naming !== null;
  templatesEmptyEl.textContent = hasSteps
    ? "Nothing saved yet. Save the plan you have and it will appear here."
    : "Nothing saved yet. Build a plan on the Planning tab, then save it here.";

  // Rebuilding the list threw away whatever had focus, so the field that was
  // just opened has to be handed it back.
  if (naming !== null) {
    const input = templateListEl.querySelector(".naming__input");
    input.focus();
    input.select();
  }
}

function setNaming(next) {
  naming = next;
  renderTemplates();
}

function selectTab(tab, { focus = true } = {}) {
  for (const el of tabEls) {
    const selected = el === tab;
    el.setAttribute("aria-selected", String(selected));
    el.tabIndex = selected ? 0 : -1;
    document.querySelector(`#${el.getAttribute("aria-controls")}`).hidden = !selected;
  }
  if (focus) tab.focus();
  // Leaving the tab abandons a half-typed name rather than keeping it waiting
  // out of sight.
  if (tab !== templatesTabEl && naming !== null) setNaming(null);
  if (tab !== planningTabEl && reordering) setReordering(false);
}

function render() {
  renderStructure();
  renderTimes();
  renderReorder();
  renderTemplates();
}

function planIsEmpty() {
  return state.deadline === "" && state.deadlineLabel === "" && state.steps.length === 0;
}

function renderClearButton() {
  clearAllEl.hidden = planIsEmpty() || reordering;
}

function focusDeleteAt(index) {
  const rows = stepsEl.children;
  if (rows.length === 0) return;
  rows[Math.min(index, rows.length - 1)].querySelector(".step__delete").focus();
}

function commitPending() {
  if (pendingTimer !== 0) {
    clearTimeout(pendingTimer);
    pendingTimer = 0;
  }
  pending = null;
  undoEl.hidden = true;
  undoMessageEl.textContent = "";
}

function beginPending(message, restore) {
  commitPending();
  pending = restore;
  undoMessageEl.textContent = message;
  undoActionEl.hidden = false;
  undoEl.hidden = false;
  pendingTimer = window.setTimeout(commitPending, UNDO_MS);
}

// The undo bar without its button, for news that has nothing to take back. It
// still commits whatever undo was pending, as any other action does.
function showNotice(message) {
  commitPending();
  undoMessageEl.textContent = message;
  undoActionEl.hidden = true;
  undoEl.hidden = false;
  pendingTimer = window.setTimeout(commitPending, UNDO_MS);
}

function undoPending() {
  if (pending === null) return;

  const restore = pending;
  commitPending();
  restore();
}

// A click reaches the invisible control and focuses it, but on desktop that
// only selects a segment: the picker opens from the calendar icon, which is
// invisible here. Since the drawn value cannot show a caret either, editing by
// keyboard alone would be blind. Asking for the picker makes one click enough
// on every platform; a tap that already opened it lands in the catch.
deadlineInputEl.addEventListener("click", () => {
  try {
    deadlineInputEl.showPicker();
  } catch {
    // No showPicker, or it is open already. Focus and typing still work.
  }
});

// change, not input: a half-typed date reads as an empty value, which would
// blank the header and the leave time between keystrokes.
deadlineInputEl.addEventListener("change", () => {
  state.deadline = deadlineInputEl.value;
  savePlan(state);
  renderTimes();
});

deadlineLabelEl.addEventListener("input", () => {
  state.deadlineLabel = deadlineLabelEl.value;
  savePlan(state);
  // Nothing else on screen reads the label, so a full render would be waste;
  // but the button's visibility now depends on it, so it has to be told.
  renderClearButton();
});

stepsEl.addEventListener("input", (event) => {
  const li = event.target.closest("li.step");
  if (li === null) return;

  const step = state.steps.find((candidate) => candidate.id === li.dataset.id);
  if (step === undefined) return;

  if (event.target.classList.contains("step__label")) {
    step.label = event.target.value;
    nameMoveButtons(li, step.label);
  } else if (event.target.classList.contains("step__minutes")) {
    step.minutes = coerceMinutes(event.target.value);
  } else {
    return;
  }

  savePlan(state);
  renderTimes();
});

stepsEl.addEventListener("click", (event) => {
  const move = event.target.closest("button.step__move");
  if (move !== null) {
    moveStepFrom(move);
    return;
  }

  const button = event.target.closest("button.step__delete");
  if (button === null) return;

  const li = button.closest("li.step");
  const index = state.steps.findIndex((step) => step.id === li.dataset.id);
  if (index === -1) return;

  const [removed] = state.steps.splice(index, 1);
  savePlan(state);
  render();

  const name = removed.label.trim();
  beginPending(name === "" ? "Deleted a step" : `Deleted “${name}”`, () => {
    state.steps.splice(Math.min(index, state.steps.length), 0, removed);
    savePlan(state);
    render();
    focusDeleteAt(index);
  });
  focusDeleteAt(index);
});

// A move is not parked for undo: the other arrow takes it back.
function moveStepFrom(button) {
  const index = state.steps.findIndex((step) => step.id === button.closest("li.step").dataset.id);
  if (index === -1) return;

  const direction = button.dataset.direction;
  const target = direction === "up" ? index - 1 : index + 1;
  state.steps = moveStep(state.steps, index, direction === "up" ? -1 : 1);
  savePlan(state);
  render();

  // Rebuilding the rows dropped focus. It follows the step, on the same arrow
  // so repeated presses keep moving it, or the other one once it hits an end.
  const row = stepsEl.children[Math.max(0, Math.min(target, stepsEl.children.length - 1))];
  const same = row.querySelector(`.step__move--${direction}`);
  (same.disabled ? row.querySelector(".step__move:not(:disabled)") : same).focus();
}

reorderEl.addEventListener("click", () => setReordering(!reordering));

clearAllEl.addEventListener("click", () => {
  if (planIsEmpty()) return;

  // A shallow copy is enough: emptyPlan hands back a fresh steps array rather
  // than emptying this one, so the snapshot keeps pointing at the old steps.
  const previous = { ...state };
  const previousActive = activeId;

  Object.assign(state, emptyPlan());
  // Writing an input's value is banned during render, where it would eat the
  // caret. Here the user is not typing, so the fields have to be told.
  deadlineInputEl.value = "";
  deadlineLabelEl.value = "";
  // The plan no longer came from a template, so Update has nothing to write
  // back to — leaving the pointer would aim it at an emptied plan.
  setActive("");
  savePlan(state);
  render();

  beginPending("Cleared the plan", () => {
    Object.assign(state, previous);
    deadlineInputEl.value = state.deadline;
    deadlineLabelEl.value = state.deadlineLabel;
    setActive(previousActive);
    savePlan(state);
    render();
    focusDeleteAt(0);
  });
  undoActionEl.focus();
});

undoActionEl.addEventListener("click", undoPending);

newLabelEl.addEventListener("input", () => {
  newLabelEl.setCustomValidity("");
});

addStepEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = newLabelEl.value.trim();
  if (label === "") {
    newLabelEl.setCustomValidity("Give the step a name.");
    newLabelEl.reportValidity();
    return;
  }

  state.steps.push(createStep(label, newMinutesEl.value));
  savePlan(state);
  render();

  addStepEl.reset();
  newLabelEl.focus();
});

function commitLibrary(next) {
  library = next;
  saveTemplates(library);
  renderTemplates();
}

function loadTemplate(template) {
  const previousSteps = state.steps;
  const previousLabel = state.deadlineLabel;
  const previousActive = activeId;

  state.steps = planStepsFrom(template);
  state.deadlineLabel = template.deadlineLabel;
  // Writing an input's value is banned during render, where it would eat the
  // caret. Here the user is not typing, so the field has to be told.
  deadlineLabelEl.value = state.deadlineLabel;
  setActive(template.id);
  savePlan(state);
  render();
  selectTab(planningTabEl, { focus: false });

  beginPending(`Loaded “${template.name}”`, () => {
    state.steps = previousSteps;
    state.deadlineLabel = previousLabel;
    deadlineLabelEl.value = previousLabel;
    setActive(previousActive);
    savePlan(state);
    render();
  });
}

function updateTemplate(template) {
  const previous = library;
  const previousActive = activeId;
  // createTemplate does the stripping and trimming; keeping the original id is
  // what turns the result from a new template into a replacement.
  const replacement = {
    ...createTemplate(template.name, state.deadlineLabel, state.steps),
    id: template.id,
  };

  setActive(template.id);
  commitLibrary(saveTemplate(library, replacement));

  beginPending(`Updated “${template.name}”`, () => {
    setActive(previousActive);
    commitLibrary(previous);
  });
}

function deleteTemplate(template) {
  const previous = library;
  const previousActive = activeId;

  if (activeId === template.id) setActive("");
  commitLibrary(removeTemplate(library, template.id));

  beginPending(`Deleted “${template.name}”`, () => {
    setActive(previousActive);
    commitLibrary(previous);
  });
}

for (const tab of tabEls) {
  tab.addEventListener("click", () => selectTab(tab, { focus: false }));
}

tabsEl.addEventListener("keydown", (event) => {
  const index = tabEls.indexOf(document.activeElement);
  if (index === -1) return;

  const last = tabEls.length - 1;
  let next = null;
  if (event.key === "ArrowRight") next = tabEls[index === last ? 0 : index + 1];
  else if (event.key === "ArrowLeft") next = tabEls[index === 0 ? last : index - 1];
  else if (event.key === "Home") next = tabEls[0];
  else if (event.key === "End") next = tabEls[last];
  if (next === null) return;

  event.preventDefault();
  selectTab(next);
});

saveTemplateEl.addEventListener("click", () => setNaming({ kind: "new" }));

templateListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (button === null) return;

  if (button.dataset.action === "cancel") {
    setNaming(null);
    saveTemplateEl.focus();
    return;
  }

  const template = findTemplate(library, button.closest("li.template").dataset.id);
  if (template === undefined) return;

  if (button.dataset.action === "load") loadTemplate(template);
  else if (button.dataset.action === "update") updateTemplate(template);
  else if (button.dataset.action === "share") shareTemplate(template);
  else if (button.dataset.action === "rename") setNaming({ kind: "rename", id: template.id });
  else if (button.dataset.action === "delete") deleteTemplate(template);
});

// An open ⋯ menu closes on a click anywhere else, and on Escape.
document.addEventListener("click", (event) => {
  for (const more of templateListEl.querySelectorAll(".template__more[open]")) {
    if (!more.contains(event.target)) more.open = false;
  }
});

templateListEl.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const more = event.target.closest(".template__more[open]");
  if (more === null) return;
  more.open = false;
  more.querySelector("summary").focus();
});

templateListEl.addEventListener("input", (event) => {
  if (event.target.classList.contains("naming__input")) event.target.setCustomValidity("");
});

templateListEl.addEventListener("submit", (event) => {
  event.preventDefault();
  if (naming === null) return;

  const input = event.target.querySelector(".naming__input");
  const name = input.value.trim();
  if (name === "") {
    input.setCustomValidity("Give the template a name.");
    input.reportValidity();
    return;
  }

  // Overwriting is what Update is for, so a taken name is refused here rather
  // than raising a confirm dialog the rest of the app manages without. A
  // rename is allowed to keep its own name, which is what exceptId is for.
  const exceptId = naming.kind === "rename" ? naming.id : undefined;
  const clash = findTemplateByName(library, name, exceptId);
  if (clash !== undefined) {
    input.setCustomValidity(`“${clash.name}” already exists. Update that one instead.`);
    input.reportValidity();
    return;
  }

  const previous = library;
  const previousActive = activeId;

  if (naming.kind === "new") {
    const template = createTemplate(name, state.deadlineLabel, state.steps);
    naming = null;
    setActive(template.id);
    commitLibrary(saveTemplate(library, template));

    beginPending(`Saved “${template.name}”`, () => {
      setActive(previousActive);
      commitLibrary(previous);
    });
    return;
  }

  const template = findTemplate(library, naming.id);
  naming = null;
  if (template === undefined) {
    renderTemplates();
    return;
  }

  const was = template.name;
  // Submitting an unchanged name is not a rename. Closing the row quietly beats
  // announcing one and offering to undo something that never happened.
  if (name === was) {
    renderTemplates();
    return;
  }

  commitLibrary(saveTemplate(library, { ...template, name }));
  beginPending(`Renamed “${was}” to “${name}”`, () => commitLibrary(previous));
});

async function shareTemplate(template) {
  const url = shareUrl(window.location.href, template);

  // The share sheet is how a phone reaches WhatsApp and the rest. Dismissing
  // it is an answer, not a failure, so only a real error falls through.
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: template.name, text: `Template “${template.name}”`, url });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showNotice(`Copied a link to “${template.name}”`);
  } catch {
    window.prompt("Copy this link", url);
  }
}

function localDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function exportAll() {
  const blob = new Blob([exportLibrary(library)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `backwards-planner-templates-${localDate(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One dialog serves every import question. ask() fills it and resolves with
// the value of the button pressed; Escape resolves with "", which every caller
// reads as "stop". check, when given, can keep the dialog open for a fix.
let askResolve = null;
let askCheck = null;

function ask({ title, body, buttons, all = "", check = null }) {
  importTitleEl.textContent = title;
  importBodyEl.replaceChildren(...body);
  importAllRowEl.hidden = all === "";
  importAllLabelEl.textContent = all;
  importAllEl.checked = false;
  importButtonsEl.replaceChildren(
    ...buttons.map(({ value, label, primary = false }) => {
      const button = document.createElement("button");
      button.value = value;
      button.textContent = label;
      button.className = primary ? "import__button import__button--primary" : "import__button";
      // Validation is check's job; the browser's own would block Cancel too.
      button.formNoValidate = true;
      return button;
    })
  );
  askCheck = check;
  importDialogEl.returnValue = "";
  importDialogEl.showModal();
  return new Promise((resolve) => {
    askResolve = resolve;
  });
}

importFormEl.addEventListener("submit", (event) => {
  if (askCheck !== null && !askCheck(event.submitter?.value ?? "")) event.preventDefault();
});

importDialogEl.addEventListener("close", () => {
  const resolve = askResolve;
  askResolve = null;
  askCheck = null;
  if (resolve !== null) resolve({ choice: importDialogEl.returnValue, all: importAllEl.checked });
});

function facts(...lines) {
  const list = document.createElement("ul");
  list.className = "import__facts";
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  return list;
}

function deadlineFact(template) {
  return template.deadlineLabel.trim() === "" ? [] : [`Deadline: ${template.deadlineLabel}`];
}

// Imports a shared template (one, asked about first) or a file (many, asked
// about only when a name is taken). Nothing reaches the library until every
// question is answered, so stopping half way leaves it as it was, and the
// whole import comes back with one undo.
async function importTemplates(incoming, { fromFile }) {
  let next = library;
  let count = 0;
  let lastName = "";
  let lastMode = "";
  let remembered = "";

  for (let i = 0; i < incoming.length; i += 1) {
    const template = incoming[i];
    const clash = findTemplateByName(next, template.name);
    let mode = "new";

    if (clash !== undefined) {
      mode = remembered;
      if (mode === "") {
        const later = incoming
          .slice(i + 1)
          .filter((other) => findTemplateByName(next, other.name) !== undefined).length;
        const answer = await ask({
          title: `You already have “${clash.name}”.`,
          body: [
            facts(
              `Yours: ${summarize(clash)}`,
              `${fromFile ? "In the file" : "Shared"}: ${summarize(template)}`
            ),
          ],
          buttons: [
            { value: "replace", label: "Replace mine", primary: true },
            { value: "new", label: "Keep both" },
            fromFile ? { value: "skip", label: "Skip" } : { value: "", label: "Cancel" },
          ],
          all:
            later === 0
              ? ""
              : `Do the same for the ${later} other${later === 1 ? "" : "s"} with a name you already have`,
        });
        if (answer.choice === "") return;
        mode = answer.choice;
        if (answer.all) remembered = mode;
      }
    } else if (!fromFile) {
      const answer = await ask({
        title: `Import template “${template.name}”?`,
        body: [facts(summarize(template), ...deadlineFact(template))],
        buttons: [
          { value: "new", label: "Import", primary: true },
          { value: "", label: "Cancel" },
        ],
      });
      if (answer.choice === "") return;
    }

    if (mode === "skip") continue;
    // Worked out before the add: a kept copy is saved under a numbered name,
    // and the message has to quote the name that actually landed.
    lastName = mode === "replace" ? clash.name : uniqueName(next, template.name);
    lastMode = mode;
    next = addImported(next, template, mode);
    count += 1;
  }

  if (count === 0) {
    showNotice("Nothing imported");
    return;
  }

  const previous = library;
  selectTab(templatesTabEl, { focus: false });
  commitLibrary(next);
  let message = `Imported ${count} templates`;
  if (count === 1) message = lastMode === "replace" ? `Replaced “${lastName}”` : `Imported “${lastName}”`;
  beginPending(message, () => commitLibrary(previous));
}

async function openImport() {
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "import__file";
  choose.textContent = "Choose a file…";
  // The file picker only opens from inside the click itself, so this cannot
  // wait for the dialog's answer like the other buttons do.
  choose.addEventListener("click", () => {
    importDialogEl.close("");
    importFileEl.click();
  });

  const or = document.createElement("p");
  or.className = "import__or";
  or.textContent = "or paste a link someone shared with you:";

  const paste = document.createElement("input");
  paste.className = "import__paste";
  paste.type = "text";
  paste.placeholder = "Shared link";
  paste.autocomplete = "off";
  paste.setAttribute("aria-label", "Shared link");
  paste.addEventListener("input", () => paste.setCustomValidity(""));

  let pasted = null;
  const answer = await ask({
    title: "Import templates",
    body: [choose, or, paste],
    buttons: [
      { value: "paste", label: "Import", primary: true },
      { value: "", label: "Cancel" },
    ],
    check(value) {
      if (value !== "paste") return true;
      pasted = readSharedLink(paste.value);
      if (pasted !== null) return true;
      paste.setCustomValidity(
        paste.value.trim() === "" ? "Paste a link first." : "That is not a template link."
      );
      paste.reportValidity();
      return false;
    },
  });
  if (answer.choice === "paste") importTemplates([pasted], { fromFile: false });
}

// A shared link opens the app with the template in the hash. It is read once
// and then cleared, so a reload does not ask again.
function takeSharedLink() {
  if (!window.location.hash.includes(`${SHARE_PARAM}=`)) return;
  const incoming = readSharedLink(window.location.hash);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  selectTab(templatesTabEl, { focus: false });
  if (incoming === null) {
    showNotice("That shared link is damaged or from a newer version");
    return;
  }
  importTemplates([incoming], { fromFile: false });
}

exportAllEl.addEventListener("click", exportAll);
importOpenEl.addEventListener("click", openImport);

importFileEl.addEventListener("change", async () => {
  const [file] = importFileEl.files;
  // Cleared at once, so choosing the same file again still fires change.
  importFileEl.value = "";
  if (file === undefined) return;

  const incoming = parseExportFile(await file.text());
  if (incoming === null) showNotice("That file is not a template export");
  else if (incoming.length === 0) showNotice("That file has no templates");
  else importTemplates(incoming, { fromFile: true });
});

window.addEventListener("hashchange", takeSharedLink);

deadlineInputEl.value = state.deadline;
deadlineLabelEl.value = state.deadlineLabel;
render();
takeSharedLink();

if ("serviceWorker" in navigator) {
  // The page on screen was served from the old cache, so a new version only
  // shows after a reload. Reload once the new worker takes over, but not over a
  // half-typed name or an undo that is still on offer: those would be lost, and
  // the new version will be there the next time the app opens anyway. A first
  // install has no previous controller and needs no reload.
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && naming === null && pending === null) window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((registration) => {
        // An installed app on a phone is resumed rather than reopened, so the
        // browser's own update check on load rarely runs. Ask on every return.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") registration.update().catch(() => {});
        });
      })
      .catch(() => {
        // Not a secure context, or the browser refused. The app works regardless.
      });
  });
}
