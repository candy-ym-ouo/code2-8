const WEIGHT_EPSILON = 0.001;

function round(value, precision = 1) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

/**
 * 规划一次批量分配：把多封待处理邮件按给定顺序插入同一信使的航线末尾。
 *
 * 语义约定：
 * - 整批原子：任一限制（封数 / 载重）不满足时返回 ok:false 且不产出新方案，
 *   调用方保持原方案不变，即整批撤回。
 * - 不重复占用容量：批量中的邮件先从现有方案移除再重新装入，无论它们此前
 *   在哪条航线上都按“移动”处理，载重与封数只占用一次；批量内重复的邮件
 *   也只保留第一次出现。
 * - 确认前不结算：本函数纯计算、不修改任何游戏状态；结算仍由
 *   “执行当日调度”确认后通过 /api/game/day/advance 进行。
 *
 * @param {object} input
 * @param {Array} input.assignments 当前调度方案（不会被修改）
 * @param {Array} input.letters 待批量装入的邮件对象，数组顺序即插入顺序
 * @param {object} input.courier 目标信使（含 id/name/capacity/maxLetters）
 * @param {Map<string, object>} input.lettersById 邮件 id → 邮件对象，用于核算现有航线载重
 * @returns {{ ok: true, assignments: Array, insertedCount: number, totalWeight: number }
 *           | { ok: false, issues: Array<{ code: string, message: string }> }}
 */
export function planBatchAssignment({ assignments = [], letters = [], courier, lettersById = new Map() }) {
  if (!courier || typeof courier.id !== 'string') {
    return { ok: false, issues: [{ code: 'COURIER_NOT_FOUND', message: '找不到目标信使，批量分配已撤回。' }] };
  }

  // 同一封邮件在批量中只保留第一次出现，避免重复占用容量。
  const batchLetters = [];
  const batchIds = new Set();
  for (const letter of letters) {
    if (!letter || typeof letter.id !== 'string' || batchIds.has(letter.id)) continue;
    batchIds.add(letter.id);
    batchLetters.push(letter);
  }

  if (batchLetters.length === 0) {
    return { ok: false, issues: [{ code: 'BATCH_EMPTY', message: '没有可分配的邮件，批量分配已撤回。' }] };
  }

  // 先移除批量邮件的旧占位，再按最终状态核算载重与封数。
  const remaining = assignments.filter((assignment) => !batchIds.has(assignment.letterId));
  const lane = remaining
    .filter((assignment) => assignment.courierId === courier.id)
    .sort((first, second) => first.order - second.order);

  const laneWeight = round(lane.reduce((sum, assignment) => sum + (lettersById.get(assignment.letterId)?.weight ?? 0), 0));
  const batchWeight = round(batchLetters.reduce((sum, letter) => sum + letter.weight, 0));
  const nextCount = lane.length + batchLetters.length;
  const nextWeight = round(laneWeight + batchWeight);

  const issues = [];
  if (nextCount > courier.maxLetters) {
    issues.push({
      code: 'LETTER_LIMIT_EXCEEDED',
      message: `${courier.name} 最多携带 ${courier.maxLetters} 封，批量装入后将为 ${nextCount} 封。`
    });
  }
  if (nextWeight > courier.capacity + WEIGHT_EPSILON) {
    issues.push({
      code: 'WEIGHT_LIMIT_EXCEEDED',
      message: `${courier.name} 载重上限 ${courier.capacity} kg，批量装入后将为 ${nextWeight} kg。`
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // 顺序插入：整批追加在航线末尾，保持批内先后顺序。
  let nextOrder = lane.length ? Math.max(...lane.map((assignment) => assignment.order)) + 1 : 0;
  const inserted = batchLetters.map((letter) => {
    const entry = {
      letterId: letter.id,
      courierId: courier.id,
      targetIslandId: letter.recipientIslandId,
      order: nextOrder
    };
    nextOrder += 1;
    return entry;
  });

  return {
    ok: true,
    assignments: [...remaining, ...inserted],
    insertedCount: inserted.length,
    totalWeight: nextWeight
  };
}
