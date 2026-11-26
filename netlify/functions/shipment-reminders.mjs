import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { reminderSettings, reminderTick, runReminderTick } from '../lib/reminders.mjs'

export default async () => {
  const now = new Date()
  const deadline = now.getTime() + 27000
  const settings = reminderSettings(process.env)
  const { expire } = reminderTick(now, settings.clock)
  if (!expire) return new Response(null, { status: 204 })

  const url = process.env.SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url || !secret) {
    console.warn('Shipment reminder database is not configured.')
    return new Response(null, { status: 204 })
  }

  const db = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })
  const smtp = settings.configured ? nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: settings.user, pass: settings.appPassword },
    disableFileAccess: true, disableUrlAccess: true,
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000,
  }) : null

  async function send(message) {
    let timeout
    try {
      return await Promise.race([
        smtp.sendMail(message),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('SMTP confirmation timed out.')), 8000) }),
      ])
    } finally { clearTimeout(timeout) }
  }

  try {
    await runReminderTick({
      now, deadline, settings, send,
      rpc: async (name, args) => {
        const { data, error } = await db.rpc(name, args).abortSignal(AbortSignal.timeout(4500))
        if (error) throw new Error(`${name}: ${error.code || 'request failed'}`)
        return data
      },
    })
  } finally { smtp?.close() }

  return new Response(null, { status: 204 })
}
