// The deadline picker: a bottom sheet with a keypad on touch screens, a small
// popover you type into on desktop. Both edit the time the same way. It replaces the browser's datetime-local
// picker, which is slow to aim at an exact time on every platform.

const PARTS = {
  hours: { first: 2, max: 23 },
  minutes: { first: 5, max: 59 },
};

const pad = (n) => String(n).padStart(2, "0");

// A calendar day as the plan stores it: "2026-10-24", in local time.
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateOf(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Built from local parts, so a daylight saving change in between still moves
// exactly one calendar day per day.
export function addDays(key, days) {
  const date = dateOf(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

export function splitDeadline(deadline) {
  const match = typeof deadline === "string" && deadline.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  return { date: match[1], hours: Number(match[2]), minutes: Number(match[3]) };
}

export function joinDeadline(date, hours, minutes) {
  return `${date}T${pad(hours)}:${pad(minutes)}`;
}

// The picker edits the hours and the minutes as two parts. typed holds
// the digits of the selected part that are not a full value yet. A part that is
// never typed keeps the deadline's old value, so the minutes can be changed
// without retyping the hour.
export function startEntry(old) {
  return {
    hours: old?.hours ?? null,
    minutes: old?.minutes ?? null,
    touched: { hours: false, minutes: false },
    part: "hours",
    typed: "",
  };
}

function store(entry, value) {
  return {
    ...entry,
    [entry.part]: value,
    touched: { ...entry.touched, [entry.part]: true },
    typed: "",
  };
}

// A lone digit counts as a value once the part is left: "9" is 09.
function settle(entry) {
  return entry.typed === "" ? entry : store(entry, Number(entry.typed));
}

export function typeDigit(entry, digit) {
  const { first, max } = PARTS[entry.part];
  if (entry.typed === "" && Number(digit) <= first) return { ...entry, typed: String(digit) };

  // A first digit above the limit cannot start a two-digit value, so it is the
  // whole value. A second digit that makes 25 or 61 is ignored.
  const value = Number(entry.typed + digit);
  if (value > max) return entry;
  const done = store(entry, value);
  return entry.part === "hours" ? { ...done, part: "minutes" } : done;
}

export function eraseDigit(entry) {
  return { ...entry, typed: entry.typed.slice(0, -1) };
}

export function choosePart(entry, part) {
  return part === entry.part ? entry : { ...settle(entry), part };
}

export function pickMinutes(entry, minutes) {
  const base = entry.part === "minutes" ? { ...entry, typed: "" } : settle(entry);
  return store({ ...base, part: "minutes" }, minutes);
}

// The time the entry stands for, or null while there is no hour. Minutes
// nobody gave are :00.
export function entryTime(entry) {
  const settled = settle(entry);
  if (settled.hours === null) return null;
  return { hours: settled.hours, minutes: settled.minutes ?? 0 };
}

const chipFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });

export function createDeadlinePicker(dialog, { onPick }) {
  const q = (selector) => dialog.querySelector(selector);
  const bodyEl = q(".picker__body");
  const chipEls = [...dialog.querySelectorAll(".picker__chip")];
  const otherChipEl = q('[data-day="other"]');
  const datelineEl = q(".picker__dateline");
  const clockEl = q(".picker__clock");
  const partEls = [...dialog.querySelectorAll(".picker__part")];
  const setEls = [...dialog.querySelectorAll(".picker__set")];
  const calendarEl = q(".picker__calendar");
  const monthEl = q(".picker__month-name");
  const prevMonthEl = q('[data-month="-1"]');
  const daysEl = q(".picker__days");

  // Everything about one opening of the picker. null while it is closed.
  let view = null;

  const today = () => dateKey(new Date());

  function open(deadline, anchor) {
    const parts = splitDeadline(deadline);
    const old = parts === null ? null : { hours: parts.hours, minutes: parts.minutes };
    const touch = window.matchMedia("(pointer: coarse)").matches;
    view = {
      touch,
      date: parts?.date ?? today(),
      entry: startEntry(old),
      calendar: false,
      month: null,
    };
    dialog.classList.toggle("picker--touch", touch);
    dialog.classList.toggle("picker--keys", !touch);
    render();
    dialog.showModal();
    if (!touch) place(anchor);
  }

  // Under the deadline, kept inside the window.
  function place(anchor) {
    const rect = anchor.getBoundingClientRect();
    const width = dialog.offsetWidth;
    dialog.style.top = `${Math.round(rect.bottom + 8)}px`;
    dialog.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)))}px`;
  }

  function choose() {
    const picked = entryTime(view.entry);
    if (picked === null) return;
    const deadline = joinDeadline(view.date, picked.hours, picked.minutes);
    dialog.close();
    onPick(deadline);
  }

  function chooseDay(day) {
    if (day === "other") {
      view.calendar = true;
      view.month = null;
    } else {
      view.date = day === "today" ? today() : addDays(today(), 1);
      view.calendar = false;
    }
    render();
  }

  function dayName(key) {
    if (key === today()) return "Today";
    if (key === addDays(today(), 1)) return "Tomorrow";
    return "";
  }

  function renderChips() {
    const name = dayName(view.date);
    for (const chip of chipEls) {
      const day = chip.dataset.day;
      const on = day === "other" ? view.calendar || name === "" : !view.calendar && name.toLowerCase() === day;
      chip.classList.toggle("picker__chip--on", on);
      chip.setAttribute("aria-pressed", String(on));
    }
    otherChipEl.textContent = !view.calendar && name === "" ? chipFmt.format(dateOf(view.date)) : "Other…";
  }

  // Two parts you can select. A part not typed yet shows the deadline's old
  // value, or a faint 00 when there is none.
  function renderTime() {
    const { entry } = view;
    for (const el of partEls) {
      const part = el.dataset.part;
      const selected = entry.part === part;
      el.classList.toggle("picker__part--on", selected);
      el.setAttribute("aria-pressed", String(selected));
      // On desktop Tab switches the parts, so they are not tab stops.
      el.tabIndex = view.touch ? 0 : -1;
      if (selected && entry.typed !== "") {
        el.innerHTML = `${entry.typed}<span class="picker__faint">_</span>`;
      } else if (entry.touched[part]) {
        el.textContent = pad(entry[part]);
      } else if (entry[part] === null) {
        el.innerHTML = `<span class="picker__faint">00</span>`;
      } else {
        el.innerHTML = `<span class="picker__old">${pad(entry[part])}</span>`;
      }
    }
    for (const el of setEls) el.disabled = entryTime(entry) === null;
  }

  function renderCalendar() {
    const selected = dateOf(view.date);
    view.month ??= new Date(selected.getFullYear(), selected.getMonth(), 1);
    const month = view.month;
    const now = dateOf(today());
    monthEl.textContent = monthFmt.format(month);
    prevMonthEl.disabled = month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth();

    daysEl.replaceChildren();
    // Monday first: 2026-10-19 is a Monday.
    for (let i = 0; i < 7; i++) {
      const label = document.createElement("span");
      label.className = "picker__weekday";
      label.textContent = weekdayFmt.format(new Date(2026, 9, 19 + i));
      daysEl.append(label);
    }
    for (let i = 0; i < (month.getDay() + 6) % 7; i++) daysEl.append(document.createElement("span"));
    const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= length; day++) {
      const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
      const button = document.createElement("button");
      button.type = "button";
      button.className = "picker__day";
      button.textContent = day;
      button.dataset.date = key;
      button.disabled = key < today();
      button.classList.toggle("picker__day--today", key === today());
      button.classList.toggle("picker__day--on", key === view.date);
      daysEl.append(button);
    }
  }

  function render() {
    renderChips();
    const name = dayName(view.date);
    const date = chipFmt.format(dateOf(view.date));
    datelineEl.textContent = view.calendar ? "Pick a day" : name === "" ? date : `${name}, ${date}`;
    clockEl.hidden = view.calendar;
    calendarEl.hidden = !view.calendar;
    if (view.calendar) renderCalendar();
    else renderTime();
  }

  dialog.addEventListener("click", (event) => {
    // The backdrop counts as the dialog itself; the content sits in the body.
    if (!bodyEl.contains(event.target)) {
      dialog.close();
      return;
    }
    const button = event.target.closest("button");
    if (button === null || button.disabled) return;

    if (button.dataset.day) chooseDay(button.dataset.day);
    else if (button.dataset.date) {
      view.date = button.dataset.date;
      view.calendar = false;
      render();
    } else if (button.dataset.month) {
      const month = view.month;
      view.month = new Date(month.getFullYear(), month.getMonth() + Number(button.dataset.month), 1);
      renderCalendar();
    } else if (button.dataset.part) {
      view.entry = choosePart(view.entry, button.dataset.part);
      renderTime();
    } else if (button.dataset.minutes) {
      view.entry = pickMinutes(view.entry, Number(button.dataset.minutes));
      renderTime();
    } else if (button.dataset.key) {
      press(button.dataset.key);
    } else if (button.classList.contains("picker__set")) {
      choose();
    }
  });

  function press(key) {
    if (view.calendar) return;
    view.entry = key === "erase" ? eraseDigit(view.entry) : typeDigit(view.entry, key);
    renderTime();
  }

  dialog.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (/^\d$/.test(key)) press(key);
    else if (key === "backspace") press("erase");
    // Tab and Shift+Tab switch between the hours and the minutes. The chips and
    // Set have letter keys and Enter, so nothing is out of reach.
    else if (key === "tab" && !view.calendar) {
      view.entry = choosePart(view.entry, view.entry.part === "hours" ? "minutes" : "hours");
      renderTime();
    }
    else if (key === "t") chooseDay("today");
    else if (key === "m") chooseDay("tomorrow");
    else if (key === "o") chooseDay("other");
    // Enter would otherwise also click whichever button has focus.
    else if (key === "enter" && !event.target.dataset?.date) choose();
    else return;
    event.preventDefault();
  });

  // Esc steps back out of the calendar before it closes the picker.
  dialog.addEventListener("cancel", (event) => {
    if (view?.calendar) {
      event.preventDefault();
      view.calendar = false;
      render();
    }
  });

  dialog.addEventListener("close", () => {
    view = null;
  });

  return { open, isOpen: () => dialog.open };
}
