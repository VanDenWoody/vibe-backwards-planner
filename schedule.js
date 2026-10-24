const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;

function parseDeadline(value) {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Callers MUST pass a real number here. A numeric string (e.g. "30") fails
// Number.isFinite and silently becomes 0 — it is not coerced for you. Use
// coerceMinutes from plan.js at the point user input enters the system.
function toMinutes(value) {
  return Number.isFinite(value) ? value : 0;
}

function dayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
  );
}

export function computeSchedule({ deadline, steps }) {
  const deadlineDate = parseDeadline(deadline);
  if (deadlineDate === null) {
    return { deadlineAt: null, rows: [], meetAt: null, meetDayOffset: 0, leaveAt: null, leaveDayOffset: 0, totalMinutes: 0 };
  }

  const list = Array.isArray(steps) ? steps : [];
  const baseDay = dayNumber(deadlineDate);
  let cursor = deadlineDate.getTime();

  // A negative step is someone else's time after the deadline: it moves the
  // cursor forward, so its start is where the cursor was and its end where it
  // lands. Callers keep negative steps on top (orderSteps), so the cursor ends
  // their run at the meet time and then counts your steps back from there.
  let meetAt = null;
  const rows = list.map((step) => {
    const minutes = toMinutes(step.minutes);
    const before = cursor;
    cursor -= minutes * MS_PER_MINUTE;
    if (minutes < 0) meetAt = new Date(cursor);
    const startsAt = new Date(Math.min(before, cursor));
    const endsAt = new Date(Math.max(before, cursor));
    return {
      id: step.id,
      label: step.label,
      minutes,
      startsAt,
      endsAt,
      dayOffset: dayNumber(minutes < 0 ? endsAt : startsAt) - baseDay,
    };
  });

  const leaveAt = new Date(cursor);
  // Your own time only: what the leave line reports is how long you are busy
  // between leaving and meeting.
  const totalMinutes = rows.reduce((sum, row) => sum + Math.max(0, row.minutes), 0);
  return {
    deadlineAt: deadlineDate,
    rows,
    meetAt,
    meetDayOffset: meetAt === null ? 0 : dayNumber(meetAt) - baseDay,
    leaveAt,
    leaveDayOffset: dayNumber(leaveAt) - baseDay,
    totalMinutes,
  };
}
