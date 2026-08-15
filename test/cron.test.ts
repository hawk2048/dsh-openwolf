import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCron, cronMatches, dueTasks, nextMinuteDelay, type CronTask } from '../src/cron.ts'

test('parseCron handles stars, steps, ranges, lists', () => {
  assert.doesNotThrow(() => parseCron('* * * * *'))
  const every15 = parseCron('*/15 * * * *')
  assert.ok(every15.minute.has(0) && every15.minute.has(15) && every15.minute.has(45))
  assert.ok(!every15.minute.has(7))
  const nightly = parseCron('0 2 * * *')
  assert.ok(nightly.minute.has(0) && nightly.hour.has(2))
  const range = parseCron('0 9-17 * * 1-5')
  assert.ok(range.hour.has(9) && range.hour.has(17) && !range.hour.has(8))
  assert.ok(range.dow.has(1) && range.dow.has(5) && !range.dow.has(6))
  const list = parseCron('5,10 * * * *')
  assert.ok(list.minute.has(5) && list.minute.has(10))
})

test('parseCron rejects bad expressions', () => {
  assert.throws(() => parseCron('* * * *'), /5 fields/)
  assert.throws(() => parseCron('60 * * * *'), /out of range/)
  assert.throws(() => parseCron('* * 32 * *'), /out of range/)
  assert.throws(() => parseCron('* * * * wat'), /invalid cron field/)
})

test('cronMatches respects all five fields', () => {
  const expr = parseCron('30 2 * * *')
  assert.equal(cronMatches(expr, new Date(2026, 7, 15, 2, 30)), true)
  assert.equal(cronMatches(expr, new Date(2026, 7, 15, 2, 31)), false)
  assert.equal(cronMatches(expr, new Date(2026, 7, 15, 3, 30)), false)
})

test('cronMatches dom/dow OR semantics', () => {
  // Both restricted: 1st of month OR Sunday.
  const expr = parseCron('0 0 1 * 0')
  const firstOfMonth = new Date(2026, 7, 1) // Saturday Aug 1 2026
  const sunday = new Date(2026, 7, 2)
  const wednesday = new Date(2026, 7, 5)
  assert.equal(cronMatches(expr, firstOfMonth), true, 'first of month')
  assert.equal(cronMatches(expr, sunday), true, 'sunday')
  assert.equal(cronMatches(expr, wednesday), false)
  // dow 7 alias for Sunday
  assert.equal(cronMatches(parseCron('0 0 * * 7'), sunday), true)
})

test('dueTasks guards per-minute reruns', () => {
  const now = new Date(2026, 7, 15, 2, 30, 45)
  const base: CronTask = { id: 't1', name: 'nightly', expr: '30 2 * * *', action: 'scan', enabled: true, created_at: now.toISOString() }
  assert.equal(dueTasks([base], now).length, 1, 'never-run task is due')
  assert.equal(dueTasks([{ ...base, last_run: new Date(2026, 7, 15, 2, 30, 5).toISOString() }], now).length, 0, 'ran this minute')
  assert.equal(dueTasks([{ ...base, last_run: new Date(2026, 7, 15, 2, 29).toISOString() }], now).length, 1, 'ran last minute')
  assert.equal(dueTasks([{ ...base, enabled: false }], now).length, 0, 'disabled')
  assert.equal(dueTasks([{ ...base, expr: 'bogus' }], now).length, 0, 'invalid expr skipped')
})

test('parseCron supports @ shorthands and month/weekday names', () => {
  assert.deepEqual(parseCron('@daily'), parseCron('0 0 * * *'))
  assert.deepEqual(parseCron('@hourly'), parseCron('0 * * * *'))
  assert.deepEqual(parseCron('@weekly'), parseCron('0 0 * * 0'))
  assert.deepEqual(parseCron('@monthly'), parseCron('0 0 1 * *'))
  assert.deepEqual(parseCron('@yearly'), parseCron('0 0 1 1 *'))
  const names = parseCron('0 9 * JAN MON-FRI')
  assert.ok(names.month.has(1) && !names.month.has(2))
  assert.ok(names.dow.has(1) && names.dow.has(5) && !names.dow.has(6))
  const lower = parseCron('0 9 * jan sun')
  assert.ok(lower.month.has(1) && lower.dow.has(0))
})

test('nextMinuteDelay targets the next minute boundary', () => {
  const d = new Date(2026, 7, 15, 2, 30, 15, 250)
  assert.equal(nextMinuteDelay(d), 44_750)
  const e = new Date(2026, 7, 15, 2, 30, 0, 0)
  assert.equal(nextMinuteDelay(e), 60_000)
})
