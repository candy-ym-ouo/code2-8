export function formatHour(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return '--:--';

  const totalMinutes = Math.round(numericValue * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

/**
 * 批量分配预检：把一批邮件按给定顺序追加到指定信使的航线末尾。
 *
 * - 任一封邮件超不出容量/封数限制时整批撤回：返回 ok:false，assignments 保持原样；
 * - 批量内重复、或已在方案中的邮件会被去重/改派，不会重复占用信使容量；
 * - 通过时返回追加后的新方案，不改动传入的 assignments。
 */
export function planBatchAssignment({ assignments = [], letters = [], courier, letterIds = [] }) {
  if (!courier) {
    return { ok: false, assignments, addedCount: 0, issues: ['找不到目标信使。'] };
  }

  const uniqueIds = [...new Set(letterIds)];
  const letterMap = new Map(letters.map((letter) => [letter.id, letter]));
  const batchLetters = [];
  const issues = [];

  for (const letterId of uniqueIds) {
    const letter = letterMap.get(letterId);
    if (!letter) {
      issues.push(`找不到邮件 ${letterId || '(空)'}。`);
    } else if (letter.status && letter.status !== 'inbox' && letter.status !== 'backlog') {
      issues.push(`${letter.id} 已不在待投递队列。`);
    } else {
      batchLetters.push(letter);
    }
  }

  if (issues.length > 0) {
    return { ok: false, assignments, addedCount: 0, issues };
  }
  if (batchLetters.length === 0) {
    return { ok: false, assignments, addedCount: 0, issues: ['请先选择要批量分配的邮件。'] };
  }

  // 先移除这批邮件的既有分配：改派而不是重复占位。
  const batchIdSet = new Set(batchLetters.map((letter) => letter.id));
  const remaining = assignments.filter((assignment) => !batchIdSet.has(assignment.letterId));
  const lane = remaining.filter((assignment) => assignment.courierId === courier.id);
  const laneWeight = lane.reduce((sum, assignment) => sum + (letterMap.get(assignment.letterId)?.weight || 0), 0);
  const batchWeight = batchLetters.reduce((sum, letter) => sum + letter.weight, 0);
  const totalCount = lane.length + batchLetters.length;
  const totalWeight = roundToTenth(laneWeight + batchWeight);

  if (totalCount > courier.maxLetters) {
    issues.push(`${courier.name} 最多携带 ${courier.maxLetters} 封，批量装入后将达到 ${totalCount} 封。`);
  }
  if (totalWeight > courier.capacity + 0.001) {
    issues.push(`${courier.name} 载重上限 ${courier.capacity} kg，批量装入后将达到 ${totalWeight} kg。`);
  }
  if (issues.length > 0) {
    return { ok: false, assignments, addedCount: 0, issues };
  }

  const nextOrder = lane.length ? Math.max(...lane.map((assignment) => assignment.order)) + 1 : 0;
  const additions = batchLetters.map((letter, index) => ({
    letterId: letter.id,
    courierId: courier.id,
    targetIslandId: letter.recipientIslandId,
    order: nextOrder + index
  }));

  return {
    ok: true,
    assignments: [...remaining, ...additions],
    addedCount: additions.length,
    addedWeight: roundToTenth(batchWeight),
    issues: []
  };
}
