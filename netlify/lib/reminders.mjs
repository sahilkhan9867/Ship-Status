import stages from '../../shared/stages.json' with { type: 'json' }

const slotHours = [12, 16]

export function reminderSettings(env) {
  const timezone = env.BUSINESS_TIMEZONE?.trim() || 'Asia/Kolkata'
  const clock = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  })
  const user = env.GMAIL_SMTP_USER?.trim()
  const appPassword = env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
  const recipients = [...new Set((env.REMINDER_RECIPIENTS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean))]
  const address = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/
  const url = env.SITE_URL?.trim() || env.URL?.trim()
  const siteUrl = url ? new URL(url) : null
  const configured = Boolean(user && address.test(user) && appPassword && recipients.length && recipients.every((entry) => address.test(entry)) && siteUrl?.protocol === 'https:')
  return { timezone, clock, user, appPassword, recipients, siteUrl, configured }
}

export function reminderTick(now, clock) {
  const parts = Object.fromEntries(clock.formatToParts(now).map(({ type, value }) => [type, value]))
  const hour = Number(parts.hour)
  const minute = Number(parts.minute)
  const expire = (hour === 10 && minute === 0) || (slotHours.includes(hour) && minute <= 5)
  const slot = slotHours.includes(hour) && minute < 5 ? {
    p_due_at: new Date(Math.floor(now.getTime() / 60000) * 60000 - minute * 60000).toISOString(),
    p_local_date: `${parts.year}-${parts.month}-${parts.day}`,
    p_slot_hour: hour,
  } : null
  return { slot, expire }
}

export function reminderEmail(job, settings) {
  const link = new URL(`/shipments/${encodeURIComponent(job.shipment_code)}`, settings.siteUrl).href
  return {
    from: { name: 'Logistics AI Shipment Management System', address: settings.user },
    to: settings.recipients,
    subject: `Action Required: Shipment ${job.shipment_code} – Step ${job.step_number} Pending`,
    text: [
      'Hello,', '',
      'This is a reminder that the following shipment requires an update.', '',
      `Shipment ID: ${job.shipment_code}`, '',
      `Customer: ${job.customer_name}`, '',
      `Booking Number: ${job.booking_number || '—'}`, '',
      `Current Pending Step: ${job.step_number} – ${stages[job.step_number - 1]}`, '',
      'Please complete this stage in the shipment management application.', '',
      `Open Shipment: ${link}`, '',
      'Regards,',
      'Logistics AI Shipment Management System',
    ].join('\n'),
  }
}

export async function runReminderTick({ now, settings, rpc, send, deadline = Date.now() + 27000 }) {
  const { slot, expire } = reminderTick(now, settings.clock)
  if (expire) await rpc('expire_shipment_reminders')
  if (!slot) return

  async function deliver(candidate) {
    const job = await rpc('claim_shipment_reminder', { ...slot, p_id: candidate.shipment_id, p_step: candidate.step_number })
    if (!job) return
    let status = 'not_configured'
    let detail = 'Gmail delivery is not configured.'
    if (settings.configured) {
      try {
        const accepted = (await send(reminderEmail(job, settings))).accepted.length
        const total = settings.recipients.length
        status = accepted === total ? 'sent' : 'failed'
        detail = `Gmail accepted ${accepted} of ${total} ${total === 1 ? 'recipient' : 'recipients'}.`
      } catch {
        status = 'failed'
        detail = 'Gmail did not confirm delivery.'
      }
    }
    await rpc('finish_shipment_reminder', { p_reminder_id: job.reminder_id, p_status: status, p_detail: detail })
  }

  const lastStart = deadline - 18000
  while (Date.now() < lastStart) {
    const candidates = await rpc('due_shipment_reminders', slot)
    if (!candidates.length) return
    for (let index = 0; index < candidates.length && Date.now() < lastStart; index += 8) {
      const results = await Promise.allSettled(candidates.slice(index, index + 8).map(deliver))
      const failed = results.filter(({ status }) => status === 'rejected')
      if (failed.length) throw new AggregateError(failed.map(({ reason }) => reason), 'A reminder database operation failed.')
    }
    if (candidates.length < 100) return
  }
}
