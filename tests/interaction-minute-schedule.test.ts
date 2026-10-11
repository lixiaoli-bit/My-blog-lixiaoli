import { expect, it } from 'vitest';
import { clockTime, parseClockTime, validTimeSpan } from '../src/cadence/entities/schedule/time-input';
import { clampSpan } from '../src/cadence/entities/schedule/model';
import { parseScheduleText } from '../src/cadence/entities/schedule/nl';
import { createEvent, updateEventDetails, moveEvent, resizeEvent } from '../src/cadence/features/schedule/usecases';
import type { ScheduleDeps } from '../src/cadence/features/schedule/usecases';
import type { ScheduleEvent } from '../src/cadence/entities/schedule/model';
import { planCadenceChanges } from '../src/lib/cadence-store';
import type { SyncChange } from '../src/cadence/sync/protocol';
function fixture() {
  const rows = new Map<string, ScheduleEvent>();
  const deps = { database: { scheduleEvents: { where: () => ({ equals: () => ({ toArray: async () => [...rows.values()] }) }), put: async (value: ScheduleEvent) => { rows.set(value.id, value); } } } } as unknown as ScheduleDeps;
  return { deps, rows };
}
it('parses minute values, rejects incomplete/invalid input and preserves midnight endpoint', () => {
  expect(parseClockTime('09:07')).toBe(547); expect(parseClockTime('24:00')).toBeNaN(); expect(parseClockTime('09:')).toBeNaN();
  expect(clockTime(547)).toBe('09:07'); expect(validTimeSpan(1439, 1440)).toBe(true); expect(validTimeSpan(547, 547)).toBe(false);
  expect(clampSpan(547, 548)).toEqual({ startMin: 547, endMin: 548 });
});
it('creates, edits, moves and resizes exact one-minute events without rounding', async () => {
  const { deps } = fixture();
  const value = await createEvent(deps, '2026-10-07', { title: 'one minute', startMin: 547, endMin: 548 }, 1);
  expect(await updateEventDetails(deps, value.dateKey, value.id, { startMin: 1439, endMin: 1440 }, 2)).toMatchObject({ startMin: 1439, endMin: 1440 });
  expect(await moveEvent(deps, value.dateKey, value.id, 612, 3)).toMatchObject({ startMin: 612, endMin: 613 });
  expect(await resizeEvent(deps, value.dateKey, value.id, 619, 4)).toMatchObject({ startMin: 612, endMin: 619 });
  await expect(updateEventDetails(deps, value.dateKey, value.id, { startMin: 620, endMin: 619 }, 5)).rejects.toThrow();
  await expect(createEvent(deps, value.dateKey, { title: 'overlap', startMin: 615, endMin: 616 }, 6)).rejects.toThrow('重叠');
});
it('natural language retains an arbitrary minute start/end', () => {
  expect(parseScheduleText('09:07到09:08阅读').items[0]).toMatchObject({ startMin: 547, endMin: 548 });
});

function scheduleChange(id: string, startMin: number, endMin: number, dateKey = '2026-10-11'): SyncChange {
  return { table: 'scheduleEvents', recordId: id, baseRevision: null,
    payload: { id, dateKey, startMin, endMin, title: 'minute sync', done: false, createdAt: 1, updatedAt: 1 } };
}
it('cloud sync preserves arbitrary minutes and accepts an update ending at midnight', () => {
  const first = planCadenceChanges([], [scheduleChange('minute', 547, 548)]);
  expect(first.conflicts).toEqual([]);
  expect(first.records[0]?.payload).toMatchObject({ startMin: 547, endMin: 548 });
  const next = planCadenceChanges(first.records, [{ ...scheduleChange('minute', 1439, 1440), baseRevision: first.records[0]!.revision }]);
  expect(next.conflicts).toEqual([]);
  expect(next.records[0]?.payload).toMatchObject({ startMin: 1439, endMin: 1440 });
});
it.each([[547, 547], [548, 547], [-1, 1], [1439, 1441], [1440, 1441], [547.5, 548.5], [NaN, 548], [547, Infinity]])(
  'cloud sync rejects an invalid span %s–%s', (start, end) => {
    expect(() => planCadenceChanges([], [scheduleChange('invalid', start, end)])).toThrow('整数分钟');
  },
);
it('cloud sync rejects overlaps but accepts touching events and the same time on different days', () => {
  const first = planCadenceChanges([], [scheduleChange('first', 547, 549)]);
  expect(() => planCadenceChanges(first.records, [scheduleChange('overlap', 548, 550)])).toThrow('重叠');
  expect(planCadenceChanges(first.records, [scheduleChange('touch', 549, 550)]).conflicts).toEqual([]);
  expect(planCadenceChanges(first.records, [scheduleChange('next-day', 547, 548, '2026-10-12')]).conflicts).toEqual([]);
});
