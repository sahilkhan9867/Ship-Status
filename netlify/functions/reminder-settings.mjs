import { reminderSettings } from '../lib/reminders.mjs'

export default () => {
  const { configured, timezone } = reminderSettings(process.env)
  return Response.json({ configured, timezone }, { headers: { 'Cache-Control': 'no-store' } })
}
