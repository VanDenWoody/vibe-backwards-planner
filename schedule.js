const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;

function parseDeadline(value) {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMinutes(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function dayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
  );
}

export function computeSchedule({ deadline, steps }) {
  const deadlineDate = parseDeadline(deadline);
  if (deadlineDate === null) {
    return { rows: [], leaveAt: null, leaveDayOffset: 0 };
  }

  const list = Array.isArray(steps) ? steps : [];
  const baseDay = dayNumber(deadlineDate);
  let cursor = deadlineDate.getTime();

  const rows = list.map((step) => {
    const minutes = toMinutes(step.minutes);
    cursor -= minutes * MS_PER_MINUTE;
    const startsAt = new Date(cursor);
    return {
      id: step.id,
      label: step.label,
      minutes,
      startsAt,
      dayOffset: dayNumber(startsAt) - baseDay,
    };
  });

  const leaveAt = new Date(cursor);
  return { rows, leaveAt, leaveDayOffset: dayNumber(leaveAt) - baseDay };
}
