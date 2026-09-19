import test from 'node:test';
import assert from 'node:assert/strict';
import { planBatchAssignment } from '../../client/src/utils.js';

const zephyr = { id: 'zephyr', name: '风信子号', capacity: 11, maxLetters: 5 };
const comet = { id: 'comet', name: '彗尾号', capacity: 7, maxLetters: 3 };

const letters = [
  { id: 'L01', weight: 2.5, recipientIslandId: 'sun', status: 'inbox' },
  { id: 'L02', weight: 3.0, recipientIslandId: 'gale', status: 'inbox' },
  { id: 'L03', weight: 4.0, recipientIslandId: 'mist', status: 'backlog' },
  { id: 'L04', weight: 3.5, recipientIslandId: 'forge', status: 'inbox' },
  { id: 'L05', weight: 1.0, recipientIslandId: 'sun', status: 'delivered' },
  { id: 'L06', weight: 6.0, recipientIslandId: 'gale', status: 'inbox' },
  { id: 'L07', weight: 0.5, recipientIslandId: 'mist', status: 'inbox' },
  { id: 'L08', weight: 0.5, recipientIslandId: 'forge', status: 'inbox' },
  { id: 'L09', weight: 0.5, recipientIslandId: 'sun', status: 'inbox' },
  { id: 'L10', weight: 0.5, recipientIslandId: 'gale', status: 'inbox' }
];

function laneOf(assignments, courierId) {
  return assignments
    .filter((assignment) => assignment.courierId === courierId)
    .sort((first, second) => first.order - second.order);
}

test('批量分配按给定顺序插入航线末尾并沿用收件岛', () => {
  const assignments = [
    { letterId: 'L01', courierId: 'zephyr', targetIslandId: 'sun', order: 0 },
    { letterId: 'L02', courierId: 'comet', targetIslandId: 'gale', order: 0 }
  ];

  const result = planBatchAssignment({ assignments, letters, courier: zephyr, letterIds: ['L03', 'L04'] });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 2);
  const lane = laneOf(result.assignments, 'zephyr');
  assert.deepEqual(lane.map((assignment) => assignment.letterId), ['L01', 'L03', 'L04']);
  assert.deepEqual(lane.map((assignment) => assignment.order), [0, 1, 2]);
  assert.equal(result.assignments.find((assignment) => assignment.letterId === 'L03').targetIslandId, 'mist');
  // 其他信使的航线不受影响
  assert.deepEqual(laneOf(result.assignments, 'comet').map((assignment) => assignment.letterId), ['L02']);
});

test('批量分配不改动传入的方案数组', () => {
  const assignments = [{ letterId: 'L01', courierId: 'zephyr', targetIslandId: 'sun', order: 0 }];
  const snapshot = structuredClone(assignments);

  const result = planBatchAssignment({ assignments, letters, courier: zephyr, letterIds: ['L02'] });

  assert.equal(result.ok, true);
  assert.deepEqual(assignments, snapshot);
  assert.notEqual(result.assignments, assignments);
});

test('载重不足时整批撤回，一封也不装入', () => {
  const assignments = [
    { letterId: 'L01', courierId: 'zephyr', targetIslandId: 'sun', order: 0 },
    { letterId: 'L06', courierId: 'zephyr', targetIslandId: 'gale', order: 1 }
  ];

  // L02 单独装得下，但整批 2.5+6+4+3=15.5 超过 11 kg，必须整批撤回
  const result = planBatchAssignment({ assignments, letters, courier: zephyr, letterIds: ['L03', 'L02'] });

  assert.equal(result.ok, false);
  assert.equal(result.assignments, assignments);
  assert.equal(result.addedCount, 0);
  assert.ok(result.issues.some((issue) => issue.includes('载重上限')));
});

test('封数超限时整批撤回', () => {
  const assignments = [
    { letterId: 'L01', courierId: 'zephyr', targetIslandId: 'sun', order: 0 },
    { letterId: 'L02', courierId: 'zephyr', targetIslandId: 'gale', order: 1 }
  ];

  const result = planBatchAssignment({ assignments, letters, courier: zephyr, letterIds: ['L07', 'L08', 'L09', 'L10'] });

  assert.equal(result.ok, false);
  assert.equal(result.assignments, assignments);
  assert.ok(result.issues.some((issue) => issue.includes('最多携带')));
  assert.ok(!result.issues.some((issue) => issue.includes('载重上限')));
});

test('载重恰好等于上限时仍可装入', () => {
  const result = planBatchAssignment({ assignments: [], letters, courier: zephyr, letterIds: ['L03', 'L06', 'L07', 'L08'] });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 4);
  assert.equal(laneOf(result.assignments, 'zephyr').length, 4);
});

test('已在方案中的邮件会被改派而不是重复占用容量', () => {
  const assignments = [
    { letterId: 'L01', courierId: 'comet', targetIslandId: 'sun', order: 0 },
    { letterId: 'L03', courierId: 'zephyr', targetIslandId: 'mist', order: 0 }
  ];

  const result = planBatchAssignment({ assignments, letters, courier: zephyr, letterIds: ['L01', 'L04'] });

  assert.equal(result.ok, true);
  assert.equal(result.assignments.filter((assignment) => assignment.letterId === 'L01').length, 1);
  assert.equal(result.assignments.find((assignment) => assignment.letterId === 'L01').courierId, 'zephyr');
  assert.equal(laneOf(result.assignments, 'comet').length, 0);
  assert.deepEqual(
    laneOf(result.assignments, 'zephyr').map((assignment) => assignment.letterId),
    ['L03', 'L01', 'L04']
  );
});

test('改派到同一信使会移到航线末尾且容量只计一次', () => {
  const assignments = [
    { letterId: 'L01', courierId: 'zephyr', targetIslandId: 'sun', order: 0 },
    { letterId: 'L02', courierId: 'zephyr', targetIslandId: 'gale', order: 1 }
  ];

  const result = planBatchAssignment({ assignments, letters, courier: zephyr, letterIds: ['L01'] });

  assert.equal(result.ok, true);
  assert.equal(result.assignments.length, 2);
  assert.deepEqual(
    laneOf(result.assignments, 'zephyr').map((assignment) => assignment.letterId),
    ['L02', 'L01']
  );
});

test('批量内重复的邮件只会装入一次', () => {
  const result = planBatchAssignment({ assignments: [], letters, courier: zephyr, letterIds: ['L01', 'L01', 'L02'] });

  assert.equal(result.ok, true);
  assert.equal(result.addedCount, 2);
  assert.equal(result.assignments.filter((assignment) => assignment.letterId === 'L01').length, 1);
});

test('包含不存在的邮件时整批失败', () => {
  const result = planBatchAssignment({ assignments: [], letters, courier: zephyr, letterIds: ['L01', 'L99'] });

  assert.equal(result.ok, false);
  assert.equal(result.assignments.length, 0);
  assert.ok(result.issues.some((issue) => issue.includes('L99')));
});

test('包含已投递邮件时整批失败', () => {
  const result = planBatchAssignment({ assignments: [], letters, courier: zephyr, letterIds: ['L05'] });

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('待投递队列')));
});

test('空选择与缺失信使都会安全失败', () => {
  const empty = planBatchAssignment({ assignments: [], letters, courier: zephyr, letterIds: [] });
  assert.equal(empty.ok, false);
  assert.ok(empty.issues.length > 0);

  const noCourier = planBatchAssignment({ assignments: [], letters, courier: null, letterIds: ['L01'] });
  assert.equal(noCourier.ok, false);
  assert.ok(noCourier.issues.length > 0);
});
