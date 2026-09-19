import test from 'node:test';
import assert from 'node:assert/strict';
import { planBatchAssignment } from '../../client/src/batchAssign.js';
import { createInitialState, previewPlan } from '../engine.js';

const zephyr = { id: 'zephyr', name: '风信子号', capacity: 11, maxLetters: 5 };

function letter(id, weight, recipientIslandId = 'sun') {
  return { id, weight, recipientIslandId };
}

function mapOf(letters) {
  return new Map(letters.map((item) => [item.id, item]));
}

test('批量分配按顺序插入航线末尾，其他信使的方案不受影响', () => {
  const existing = [
    { letterId: 'L1', courierId: 'zephyr', targetIslandId: 'sun', order: 0 },
    { letterId: 'L9', courierId: 'comet', targetIslandId: 'gale', order: 0 }
  ];
  const all = [
    letter('L1', 2),
    letter('L9', 1),
    letter('L2', 1.5, 'gale'),
    letter('L3', 2.5, 'mist'),
    letter('L4', 1, 'forge')
  ];

  const result = planBatchAssignment({
    assignments: existing,
    letters: [all[2], all[3], all[4]],
    courier: zephyr,
    lettersById: mapOf(all)
  });

  assert.equal(result.ok, true);
  assert.equal(result.insertedCount, 3);

  const lane = result.assignments
    .filter((assignment) => assignment.courierId === 'zephyr')
    .sort((first, second) => first.order - second.order);
  assert.deepEqual(lane.map((assignment) => assignment.letterId), ['L1', 'L2', 'L3', 'L4']);
  assert.deepEqual(lane.map((assignment) => assignment.order), [0, 1, 2, 3]);
  assert.deepEqual(lane.slice(1).map((assignment) => assignment.targetIslandId), ['gale', 'mist', 'forge']);

  const cometLane = result.assignments.filter((assignment) => assignment.courierId === 'comet');
  assert.deepEqual(cometLane, [{ letterId: 'L9', courierId: 'comet', targetIslandId: 'gale', order: 0 }]);

  // 纯函数：入参方案不被修改。
  assert.equal(existing.length, 2);
});

test('批量超出载重或封数时整批撤回，不产出部分方案', () => {
  const heavy = [letter('H1', 6), letter('H2', 6)];
  const overweight = planBatchAssignment({ assignments: [], letters: heavy, courier: zephyr, lettersById: mapOf(heavy) });
  assert.equal(overweight.ok, false);
  assert.ok(overweight.issues.some((issue) => issue.code === 'WEIGHT_LIMIT_EXCEEDED'));
  assert.equal(overweight.assignments, undefined);

  const many = Array.from({ length: 6 }, (_, index) => letter(`M${index}`, 0.5));
  const tooMany = planBatchAssignment({ assignments: [], letters: many, courier: zephyr, lettersById: mapOf(many) });
  assert.equal(tooMany.ok, false);
  assert.ok(tooMany.issues.some((issue) => issue.code === 'LETTER_LIMIT_EXCEEDED'));

  // 即使其中一部分能装下，只要整批超限就整体失败。
  const laneLetter = letter('L1', 9);
  const existing = [{ letterId: 'L1', courierId: 'zephyr', targetIslandId: 'sun', order: 0 }];
  const batch = [letter('N1', 1), letter('N2', 1), letter('N3', 1)];
  const partial = planBatchAssignment({
    assignments: existing,
    letters: batch,
    courier: zephyr,
    lettersById: mapOf([laneLetter, ...batch])
  });
  assert.equal(partial.ok, false);
  assert.deepEqual(existing, [{ letterId: 'L1', courierId: 'zephyr', targetIslandId: 'sun', order: 0 }]);
});

test('批量变更不会重复占用信使容量', () => {
  // X 已占满 zephyr 全部载重：随批量重新装入是“移动”，只计一次重量。
  const x = letter('X', 11);
  const y = letter('Y', 1, 'gale');
  const existing = [{ letterId: 'X', courierId: 'zephyr', targetIslandId: 'sun', order: 0 }];

  const moved = planBatchAssignment({
    assignments: existing,
    letters: [x],
    courier: zephyr,
    lettersById: mapOf([x, y])
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.assignments.filter((assignment) => assignment.letterId === 'X').length, 1);
  assert.equal(moved.totalWeight, 11);

  // 从其他信使移动过来的邮件会释放原航线占用，且不会出现在两条航线上。
  const elsewhere = [{ letterId: 'Y', courierId: 'comet', targetIslandId: 'gale', order: 0 }];
  const relocated = planBatchAssignment({
    assignments: elsewhere,
    letters: [y],
    courier: zephyr,
    lettersById: mapOf([x, y])
  });
  assert.equal(relocated.ok, true);
  assert.equal(relocated.assignments.filter((assignment) => assignment.letterId === 'Y').length, 1);
  assert.equal(relocated.assignments.some((assignment) => assignment.letterId === 'Y' && assignment.courierId === 'comet'), false);

  // 批量内重复选择的邮件只装入一次。
  const duplicated = planBatchAssignment({
    assignments: [],
    letters: [y, y],
    courier: zephyr,
    lettersById: mapOf([y])
  });
  assert.equal(duplicated.ok, true);
  assert.equal(duplicated.insertedCount, 1);
});

test('批量规划结果与服务端校验一致', () => {
  const state = createInitialState({ seed: 'batch-assign' });
  const lettersById = new Map(state.letters.map((item) => [item.id, item]));
  const open = state.letters.filter((item) => item.status === 'inbox');
  const zephyrState = state.couriers.find((courier) => courier.id === 'zephyr');
  const comet = state.couriers.find((courier) => courier.id === 'comet');

  // 在载重与封数范围内挑选一批，规划结果必须通过服务端预览校验。
  const fitting = [];
  let weight = 0;
  for (const item of open) {
    if (fitting.length >= zephyrState.maxLetters || weight + item.weight > zephyrState.capacity) continue;
    fitting.push(item);
    weight += item.weight;
  }
  assert.ok(fitting.length >= 2);

  const planned = planBatchAssignment({
    assignments: [],
    letters: fitting,
    courier: zephyrState,
    lettersById
  });
  assert.equal(planned.ok, true);
  const preview = previewPlan(state, planned.assignments);
  assert.equal(preview.valid, true);

  // 全部塞给最小的彗尾号：客户端整批撤回，服务端同样判定非法。
  const overloaded = planBatchAssignment({ assignments: [], letters: open, courier: comet, lettersById });
  assert.equal(overloaded.ok, false);
  const serverPreview = previewPlan(state, open.map((item, index) => ({
    letterId: item.id,
    courierId: 'comet',
    targetIslandId: item.recipientIslandId,
    order: index
  })));
  assert.equal(serverPreview.valid, false);
});

test('批量规划与预览在确认前不触发结算', () => {
  const state = createInitialState({ seed: 'no-settlement-before-confirm' });
  const snapshot = structuredClone(state);
  const lettersById = new Map(state.letters.map((item) => [item.id, item]));
  const zephyrState = state.couriers.find((courier) => courier.id === 'zephyr');
  const target = state.letters.find((item) => item.status === 'inbox');

  const planned = planBatchAssignment({
    assignments: [],
    letters: [target],
    courier: zephyrState,
    lettersById
  });
  assert.equal(planned.ok, true);

  const preview = previewPlan(state, planned.assignments);
  assert.equal(preview.valid, true);

  // 状态零变化：未结算、未推进、信誉邮资与邮件状态保持原样。
  assert.deepEqual(state, snapshot);
});
