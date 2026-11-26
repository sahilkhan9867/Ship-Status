import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { reminderSettings, reminderTick, runReminderTick } from '../netlify/lib/reminders.mjs'

const staffId = 'abcdef01-1234-4321-abcd-abcdef012345'
const staffEmail = 'staff@example.test'
const noon = new Date('2026-11-26T06:30:00.000Z')
const afternoon = new Date('2026-11-26T10:30:00.000Z')
const defaults = reminderSettings({})

test('local business time selects the noon and 4 PM slots', () => {
  assert.deepEqual(reminderTick(noon, defaults.clock).slot, {
    p_due_at: noon.toISOString(), p_local_date: '2026-11-26', p_slot_hour: 12,
  })
  assert.deepEqual(reminderTick(new Date('2026-11-26T10:33:55.090Z'), defaults.clock).slot, {
    p_due_at: afternoon.toISOString(), p_local_date: '2026-11-26', p_slot_hour: 16,
  })
  assert.equal(reminderTick(new Date('2026-11-26T06:29:59Z'), defaults.clock).slot, null)
  assert.equal(reminderTick(new Date('2026-11-26T10:35:00Z'), defaults.clock).slot, null)
  const eastern = reminderSettings({ BUSINESS_TIMEZONE: 'America/New_York' })
  assert.equal(reminderTick(new Date('2026-07-10T16:00:00Z'), eastern.clock).slot.p_slot_hour, 12)
  assert.equal(reminderTick(new Date('2026-12-10T17:00:00Z'), eastern.clock).slot.p_slot_hour, 12)
})

test('PostgreSQL booking, sequential completion, and reminder audit lifecycle', async (t) => {
  const db = await PGlite.create()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql as $$
      select nullif(current_setting('request.jwt.claims', true), '')::jsonb
    $$;
    create function auth.uid() returns uuid language sql as $$
      select (auth.jwt() ->> 'sub')::uuid
    $$;
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261126000000_shipments.sql', import.meta.url), 'utf8'))

  async function staffQuery(sql, args) {
    return db.transaction(async (tx) => {
      await tx.exec('set local role authenticated')
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: staffId, email: staffEmail })])
      return (await tx.query(sql, args)).rows
    })
  }

  async function rpc(name, args = {}) {
    const keys = Object.keys(args)
    const params = keys.map((key, index) => `${key} => $${index + 1}`).join(', ')
    return db.transaction(async (tx) => {
      await tx.exec('set local role service_role')
      const { rows } = await tx.query(`select * from public.${name}(${params})`, Object.values(args))
      return name === 'due_shipment_reminders' ? rows : rows[0]?.[name]
    })
  }

  const id = randomUUID()
  const lateId = randomUUID()
  const booking = { customer_name: 'Sample Exports', booking_number: 'TEST-1001', origin: 'Mumbai', destination: 'Dubai', shipment_type: 'FCL', etd: '2026-11-30' }
  const create = (shipmentId, values) => staffQuery('select public.create_shipment($1, $2) as code', [shipmentId, values]).then(([row]) => row.code)
  const getDetail = (code) => staffQuery('select public.shipment_detail($1) as detail', [code]).then(([row]) => row.detail)
  const complete = (shipmentId, step) => staffQuery('select public.complete_shipment_step($1, $2)', [shipmentId, step])
  const setActivation = (shipmentId, step, activation) => db.query('update public.shipment_steps set activated_at = $3 where shipment_id = $1 and step_number = $2', [shipmentId, step, activation])

  await assert.rejects(db.transaction(async (tx) => {
    await tx.exec('set local role anon')
    await tx.query('select * from public.shipments')
  }), /permission denied/)
  const code = await create(id, booking)
  const lateCode = await create(lateId, { customer_name: 'Late Freight' })
  assert.equal(await create(id, booking), code)
  assert.notEqual(code, lateCode)
  let detail = await getDetail(code)
  assert.equal(detail.shipment.booking_number, booking.booking_number)
  assert.equal(detail.shipment.shipment_type, 'FCL')
  assert.equal(detail.shipment.created_by, staffId)
  assert.equal(detail.shipment.completed_steps, 1)
  assert.equal(detail.steps.length, 10)
  assert.equal(detail.steps[0].completed_by_email, staffEmail)
  assert.ok(detail.steps[0].completed_at)
  assert.ok(detail.steps[1].activated_at)
  assert.equal(detail.steps[2].activated_at, null)
  assert.deepEqual(detail.history.map(({ kind }) => kind), ['booking_created', 'step_completed', 'step_activated', 'reminder_scheduled'])
  await assert.rejects(complete(id, 3), /Only the current pending step/)
  await assert.rejects(staffQuery('update public.shipments set completed_steps = 3'), /permission denied/)
  await assert.rejects(staffQuery('select public.expire_shipment_reminders()'), /permission denied/)

  await setActivation(id, 2, '2026-11-26T05:30:00Z')
  await setActivation(lateId, 2, '2026-11-26T07:30:00Z')
  const configured = reminderSettings({
    SITE_URL: 'https://shipments.example.test',
    GMAIL_SMTP_USER: 'notifications@example.test', GMAIL_APP_PASSWORD: 'example test password',
    REMINDER_RECIPIENTS: 'logistics@example.test,lead@example.test',
  })
  const messages = []
  const send = async (message) => {
    messages.push(message)
    if (message.subject.includes(lateCode)) throw new Error('Simulated SMTP rejection')
    return { accepted: message.to }
  }
  const tick = (now, settings = configured) => runReminderTick({ now, settings, rpc, send })
  await Promise.all([tick(noon), tick(noon)])
  assert.equal(messages.length, 1)
  assert.match(messages[0].subject, /Step 2 Pending/)
  assert.ok(messages[0].text.includes(`https://shipments.example.test/shipments/${code}`))
  assert.ok(messages[0].text.includes('2 – Vessel Schedule Check'))
  assert.ok(messages[0].text.includes('Booking Number: TEST-1001'))

  const concurrent = await Promise.allSettled([complete(id, 2), complete(id, 2)])
  assert.equal(concurrent.filter(({ status }) => status === 'fulfilled').length, 1)
  assert.equal(concurrent.filter(({ status }) => status === 'rejected').length, 1)
  detail = await getDetail(code)
  assert.ok(detail.steps[1].completed_at)
  assert.equal(detail.steps[1].completed_by, staffId)
  assert.ok(detail.steps[2].activated_at)
  assert.equal(detail.shipment.completed_steps, 2)
  assert.equal(detail.history.filter(({ kind, step_number }) => kind === 'step_completed' && step_number === 2).length, 1)
  assert.ok(detail.history.some(({ kind, step_number }) => kind === 'reminder_skipped' && step_number === 2))
  const afternoonSlot = reminderTick(afternoon, defaults.clock).slot
  assert.equal(await rpc('claim_shipment_reminder', { ...afternoonSlot, p_id: id, p_step: 2 }), null)
  await setActivation(id, 3, '2026-11-26T08:30:00Z')
  await tick(afternoon)
  await tick(afternoon)
  assert.equal(messages.length, 3)
  assert.equal(messages.filter(({ subject }) => subject.includes(code) && subject.includes('Step 3')).length, 1)
  assert.ok((await getDetail(lateCode)).history.some(({ kind, detail: text }) => kind === 'reminder_failed' && text.includes('4:00 PM')))

  for (let step = 3; step <= 10; step++) await complete(id, step)
  detail = await getDetail(code)
  assert.equal(detail.shipment.completed_steps, 10)
  assert.ok(detail.shipment.delivered_at)
  assert.ok(detail.steps.every(({ completed_at }) => completed_at))
  assert.deepEqual(detail.history.slice(-2).map(({ kind }) => kind), ['shipment_completed', 'reminders_stopped'])
  await assert.rejects(complete(id, 10), /Only the current pending step/)

  const nextNoon = new Date('2026-11-27T06:30:00Z')
  await tick(nextNoon, defaults)
  await tick(nextNoon)
  assert.equal(messages.length, 3)
  assert.ok((await getDetail(lateCode)).history.some(({ kind }) => kind === 'reminder_not_configured'))
  assert.equal((await getDetail(code)).history.filter(({ kind }) => kind === 'reminder_sent').length, 2)

  const nextAfternoon = new Date('2026-11-27T10:30:00Z')
  const nextSlot = reminderTick(nextAfternoon, defaults.clock).slot
  const interrupted = await rpc('claim_shipment_reminder', { ...nextSlot, p_id: lateId, p_step: 2 })
  await db.query("update public.shipment_reminders set claimed_at = clock_timestamp() - interval '4 minutes' where id = $1", [interrupted.reminder_id])
  await tick(nextAfternoon)
  await tick(nextAfternoon)
  assert.equal(messages.length, 3)
  assert.equal((await getDetail(lateCode)).history.filter(({ kind }) => kind === 'reminder_failed').length, 2)
  assert.equal(await rpc('claim_shipment_reminder', { ...nextSlot, p_id: id, p_step: 10 }), null)
})
