import { computeSchedule } from "./schedule.js";
import { coerceMinutes, createStep } from "./plan.js";
import { loadPlan, savePlan } from "./storage.js";

const deadlineLabelEl = document.querySelector("#deadline-label");
const deadlineWhenEl = document.querySelector("#deadline-when");
const emptyHintEl = document.querySelector("#empty-hint");
const stepsEl = document.querySelector("#steps");
const leaveEl = document.querySelector("#leave");
const leaveTimeEl = document.querySelector("#leave-time");
const addStepEl = document.querySelector("#add-step");
const newLabelEl = document.querySelector("#new-label");
const newMinutesEl = document.querySelector("#new-minutes");

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

const state = loadPlan();

function formatAt(date, dayOffset) {
  if (date === null) return "";
  const time = timeFmt.format(date);
  return dayOffset === 0 ? time : `${time} (${dateFmt.format(date)})`;
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
    label.autocomplete = "off";
    label.setAttribute("aria-label", "Step name");

    const minutes = document.createElement("input");
    minutes.className = "step__minutes";
    minutes.type = "number";
    minutes.min = "0";
    minutes.step = "1";
    minutes.inputMode = "numeric";
    minutes.value = String(step.minutes);
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
  const { rows, leaveAt, leaveDayOffset } = computeSchedule(state);
  const hasDeadline = leaveAt !== null;

  emptyHintEl.hidden = hasDeadline;
  leaveEl.hidden = !hasDeadline;

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const li of stepsEl.children) {
    const row = byId.get(li.dataset.id);
    li.querySelector(".step__time").textContent =
      row && hasDeadline ? formatAt(row.startsAt, row.dayOffset) : "";
    li.classList.toggle("step--zero", row ? row.minutes === 0 : false);
  }

  if (hasDeadline) {
    leaveTimeEl.textContent = formatAt(leaveAt, leaveDayOffset);
  }
}

deadlineWhenEl.addEventListener("input", () => {
  state.deadline = deadlineWhenEl.value;
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
  state.steps = state.steps.filter((step) => step.id !== li.dataset.id);
  savePlan(state);
  renderStructure();
  renderTimes();
});

addStepEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = newLabelEl.value.trim();
  if (label === "") return;

  state.steps.push(createStep(label, newMinutesEl.value));
  savePlan(state);
  renderStructure();
  renderTimes();

  addStepEl.reset();
  newLabelEl.focus();
});

deadlineWhenEl.value = state.deadline;
deadlineLabelEl.value = state.deadlineLabel;
renderStructure();
renderTimes();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Not a secure context, or the browser refused. The app works regardless.
    });
  });
}
