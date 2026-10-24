import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  choosePart,
  dateKey,
  entryTime,
  eraseDigit,
  joinDeadline,
  pickMinutes,
  splitDeadline,
  startEntry,
  streamMinutes,
  streamTime,
  typeDigit,
  typeStream,
} from "./picker.js";

const typeAll = (entry, digits) => [...digits].reduce(typeDigit, entry);
const streamAll = (digits) => [...digits].reduce(typeStream, "");

test("splitDeadline reads a plan deadline into date, hours and minutes", () => {
  assert.deepEqual(splitDeadline("2026-10-24T08:15"), { date: "2026-10-24", hours: 8, minutes: 15 });
  assert.equal(splitDeadline(""), null);
  assert.equal(splitDeadline("garbage"), null);
});

test("joinDeadline writes the datetime-local format the plan stores", () => {
  assert.equal(joinDeadline("2026-10-24", 9, 5), "2026-10-24T09:05");
});

test("dateKey and addDays work on local calendar days", () => {
  assert.equal(dateKey(new Date(2026, 9, 24, 23, 59)), "2026-10-24");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");
});

test("a new entry has no time until an hour is typed", () => {
  const entry = startEntry(null);
  assert.equal(entry.part, "hours");
  assert.equal(entryTime(entry), null);
});

test("a full hour moves on to the minutes; empty minutes become :00", () => {
  const entry = typeAll(startEntry(null), "14");
  assert.equal(entry.part, "minutes");
  assert.deepEqual(entryTime(entry), { hours: 14, minutes: 0 });
});

test("four digits give an exact time", () => {
  assert.deepEqual(entryTime(typeAll(startEntry(null), "1435")), { hours: 14, minutes: 35 });
});

test("a first digit that cannot start a two-digit value stands alone", () => {
  const entry = typeAll(startEntry(null), "9");
  assert.equal(entry.part, "minutes");
  assert.deepEqual(entryTime(typeAll(entry, "7")), { hours: 9, minutes: 7 });
});

test("digits that would make an impossible time are ignored", () => {
  assert.deepEqual(entryTime(typeAll(startEntry(null), "2514")), { hours: 21, minutes: 4 });
  assert.deepEqual(entryTime(typeAll(startEntry(null), "106")), { hours: 10, minutes: 6 });
});

test("typing on after a complete time starts the minutes over", () => {
  assert.deepEqual(entryTime(typeAll(startEntry(null), "143512")), { hours: 14, minutes: 12 });
});

test("a lone typed digit counts once the entry is read", () => {
  assert.deepEqual(entryTime(typeAll(startEntry(null), "1")), { hours: 1, minutes: 0 });
});

test("editing keeps whatever part is not typed", () => {
  const old = { hours: 8, minutes: 15 };
  assert.deepEqual(entryTime(startEntry(old)), old);
  assert.deepEqual(entryTime(typeAll(startEntry(old), "14")), { hours: 14, minutes: 15 });
  const minutesOnly = typeAll(choosePart(startEntry(old), "minutes"), "40");
  assert.deepEqual(entryTime(minutesOnly), { hours: 8, minutes: 40 });
});

test("leaving a part with one digit typed keeps that digit", () => {
  const entry = choosePart(typeAll(startEntry({ hours: 8, minutes: 15 }), "1"), "minutes");
  assert.equal(entry.hours, 1);
  assert.equal(entry.typed, "");
});

test("erasing undoes typing in the selected part only", () => {
  const entry = eraseDigit(typeAll(startEntry({ hours: 8, minutes: 15 }), "1"));
  assert.equal(entry.typed, "");
  assert.deepEqual(entryTime(entry), { hours: 8, minutes: 15 });
});

test("quick minutes change only the minutes", () => {
  const entry = pickMinutes(typeAll(startEntry(null), "1"), 30);
  assert.deepEqual(entryTime(entry), { hours: 1, minutes: 30 });
  assert.deepEqual(entryTime(pickMinutes(startEntry({ hours: 8, minutes: 15 }), 45)), {
    hours: 8,
    minutes: 45,
  });
});

test("the desktop stream fills the time digit by digit", () => {
  assert.equal(streamAll("1435"), "1435");
  assert.equal(streamAll("9"), "09");
  assert.equal(streamAll("25"), "2");
  assert.equal(streamAll("106"), "1006", "a minute digit above 5 stands alone");
  assert.equal(streamAll("14351"), "1", "a fifth digit starts over");
});

test("the desktop stream reads short input the same way as the phone", () => {
  assert.deepEqual(streamTime("1435", null), { hours: 14, minutes: 35 });
  assert.deepEqual(streamTime("14", null), { hours: 14, minutes: 0 });
  assert.deepEqual(streamTime("143", null), { hours: 14, minutes: 3 });
  assert.deepEqual(streamTime("1", null), { hours: 1, minutes: 0 });
  assert.equal(streamTime("", null), null);
  assert.deepEqual(streamTime("", { hours: 8, minutes: 15 }), { hours: 8, minutes: 15 });
});

test("desktop quick minutes need the hour first", () => {
  assert.equal(streamMinutes("1", 30), "1");
  assert.equal(streamMinutes("14", 30), "1430");
  assert.equal(streamMinutes("1435", 0), "1400");
});
