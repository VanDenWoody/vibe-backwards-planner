import { TEMPLATES_VERSION, sameContent } from "./templates.js";
import { uniqueName } from "./sharing.js";

// Pure merge of two template libraries, for sync. Every rule here must give
// the same answer whichever side is "local": two devices merging the same pair
// of files in opposite directions have to land on the same library, or their
// next writes undo each other.

function comparableName(name) {
  return name.trim().toLocaleLowerCase();
}

function contentKey(template) {
  const { name, deadlineLabel, steps } = template;
  return JSON.stringify({ name, deadlineLabel, steps });
}

// Rule 1: the newer edit wins; on a tie, the copy whose content sorts first.
function pickWinner(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return contentKey(a) <= contentKey(b) ? a : b;
}

// Identical apart from the name, which already compares equal for a clash.
function sameRecipe(a, b) {
  return sameContent({ ...a, name: "" }, { ...b, name: "" });
}

// Returns { library, clashes, merged }. clashes are pairs of different
// templates under one name, one from each side, both kept for now so the
// caller can ask. merged lists identical pairs that were folded into the
// smaller id, so the caller can move an In use marker.
export function mergeLibraries(local, remote) {
  // Rule 2: tombstones union by id, the later delete counts.
  const tombstones = new Map();
  for (const tombstone of [...local.tombstones, ...remote.tombstones]) {
    const known = tombstones.get(tombstone.id);
    if (known === undefined || tombstone.deletedAt > known.deletedAt) {
      tombstones.set(tombstone.id, { id: tombstone.id, deletedAt: tombstone.deletedAt });
    }
  }

  // Local order first, then what only the other side has, so the picker
  // keeps its order on this device.
  const remoteById = new Map(remote.items.map((item) => [item.id, item]));
  const localIds = new Set(local.items.map((item) => item.id));
  const candidates = [
    ...local.items.map((item) => {
      const other = remoteById.get(item.id);
      if (other === undefined) return { item, from: "local" };
      const winner = pickWinner(item, other);
      const same = sameContent(item, other) && item.updatedAt === other.updatedAt;
      return { item: winner, from: same ? "both" : winner === item ? "local" : "remote" };
    }),
    ...remote.items.filter((item) => !localIds.has(item.id)).map((item) => ({ item, from: "remote" })),
  ];

  const kept = [];
  for (const candidate of candidates) {
    const tombstone = tombstones.get(candidate.item.id);
    if (tombstone !== undefined && tombstone.deletedAt >= candidate.item.updatedAt) continue;
    tombstones.delete(candidate.item.id);
    kept.push(candidate);
  }

  // Rule 3: name clashes. Each side holds unique names, so a name is shared by
  // at most two survivors, one from each side.
  const byName = new Map();
  for (const candidate of kept) {
    const key = comparableName(candidate.item.name);
    byName.set(key, [...(byName.get(key) ?? []), candidate]);
  }

  const dropped = new Set();
  const clashes = [];
  const merged = [];
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const [first, second] = group;
    if (sameRecipe(first.item, second.item)) {
      // Smaller id, not "the remote one": device A keeping b while device B
      // keeps a would tombstone both once the writes meet.
      const [keep, drop] = first.item.id < second.item.id ? [first, second] : [second, first];
      dropped.add(drop.item.id);
      tombstones.set(drop.item.id, {
        id: drop.item.id,
        deletedAt: Math.max(keep.item.updatedAt, drop.item.updatedAt),
      });
      merged.push({ dropped: drop.item.id, kept: keep.item.id });
    } else {
      const localSide = first.from === "local" ? first : second;
      const remoteSide = localSide === first ? second : first;
      clashes.push({ local: localSide.item, remote: remoteSide.item });
    }
  }

  const library = {
    version: TEMPLATES_VERSION,
    items: kept.filter((c) => !dropped.has(c.item.id)).map((c) => c.item),
    tombstones: [...tombstones.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  return { library, clashes, merged };
}

// The user's answer to one clash. "keep-both" numbers the other device's copy,
// as Import numbers an incoming template; "replace" deletes this device's.
// Both are edits, stamped with now, so they sync back.
export function applyClashChoice(library, clash, choice, now) {
  if (choice === "replace") {
    return {
      version: TEMPLATES_VERSION,
      items: library.items.filter((item) => item.id !== clash.local.id),
      tombstones: [
        ...library.tombstones.filter((t) => t.id !== clash.local.id),
        { id: clash.local.id, deletedAt: now },
      ],
    };
  }
  const name = uniqueName(library, clash.remote.name);
  return {
    version: TEMPLATES_VERSION,
    items: library.items.map((item) =>
      item.id === clash.remote.id ? { ...item, name, updatedAt: now } : item
    ),
    tombstones: library.tombstones,
  };
}

export function librariesEqual(a, b) {
  if (a.items.length !== b.items.length || a.tombstones.length !== b.tombstones.length) return false;
  const items = new Map(a.items.map((item) => [item.id, item]));
  const sameItems = b.items.every((item) => {
    const other = items.get(item.id);
    return other !== undefined && other.updatedAt === item.updatedAt && sameContent(other, item);
  });
  const tombstones = new Map(a.tombstones.map((t) => [t.id, t.deletedAt]));
  return sameItems && b.tombstones.every((t) => tombstones.get(t.id) === t.deletedAt);
}
