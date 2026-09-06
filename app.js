import { computeSchedule } from "./schedule.js";
import { coerceMinutes, createStep } from "./plan.js";
import {
  createTemplate,
  findTemplate,
  findTemplateByName,
  planStepsFrom,
  removeTemplate,
  saveTemplate,
} from "./templates.js";
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
const leaveTotalEl = document.querySelector("#leave-total");
const addStepEl = document.querySelector("#add-step");
const newLabelEl = document.querySelector("#new-label");
const newMinutesEl = document.querySelector("#new-minutes");
const clearAllEl = document.querySelector("#clear-all");
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

  for (const step of state.steps) {
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

    li.append(time, label, minutes, unit, remove);
    stepsEl.append(li);
  }
}

function renderTimes() {
  const { deadlineAt, rows, leaveAt, totalMinutes } = computeSchedule(state);
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
  // Its date appears whenever leaving is not today, which the day offset from
  // the deadline cannot tell you on its own.
  leaveEl.hidden = !hasDeadline || !hasSteps;
  if (!leaveEl.hidden) {
    leaveTimeEl.textContent = formatAt(leaveAt, !isToday(leaveAt));
    leaveTotalEl.textContent = `${formatDuration(totalMinutes)} of steps`;
  }

  clearAllEl.hidden = !hasSteps;
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
    ["rename", "Rename"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      action === "load" ? "template__action template__action--load" : "template__action";
    button.dataset.action = action;
    button.textContent = label;
    // The row's name is a sibling, not part of the button, so the accessible
    // name has to carry it or every row sounds identical.
    button.setAttribute("aria-label", `${label} “${template.name}”`);
    actions.append(button);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "template__delete";
  remove.dataset.action = "delete";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `Delete “${template.name}”`);
  actions.append(remove);

  li.append(actions);
  return li;
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
    templateListEl.append(namingRow("", "Name this template"));
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
}

function render() {
  renderStructure();
  renderTimes();
  renderTemplates();
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
});

stepsEl.addEventListener("input", (event) => {
  const li = event.target.closest("li.step");
  if (li === null) return;

  const step = state.steps.find((candidate) => candidate.id === li.dataset.id);
  if (step === undefined) return;

  if (event.target.classList.contains("step__label")) {
    step.label = event.target.value;
  } else if (event.target.classList.contains("step__minutes")) {
    step.minutes = coerceMinutes(event.target.value);
  } else {
    return;
  }

  savePlan(state);
  renderTimes();
});

stepsEl.addEventListener("click", (event) => {
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

clearAllEl.addEventListener("click", () => {
  const count = state.steps.length;
  if (count === 0) return;

  const removed = state.steps;
  state.steps = [];
  savePlan(state);
  render();

  beginPending(`Cleared ${count} step${count === 1 ? "" : "s"}`, () => {
    state.steps = removed;
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
  else if (button.dataset.action === "rename") setNaming({ kind: "rename", id: template.id });
  else if (button.dataset.action === "delete") deleteTemplate(template);
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

deadlineInputEl.value = state.deadline;
deadlineLabelEl.value = state.deadlineLabel;
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Not a secure context, or the browser refused. The app works regardless.
    });
  });
}
