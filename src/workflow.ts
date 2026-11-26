import stages from '../shared/stages.json'

export { stages }

export const bookingFields = [
  'customer_name', 'company_name', 'contact_person', 'phone', 'email',
  'booking_number', 'shipment_type', 'origin', 'destination', 'vessel_name',
  'container_number', 'etd', 'eta', 'remarks',
] as const

export const shipmentTypes = ['FCL', 'LCL', 'Air', 'Other'] as const

export type BookingField = typeof bookingFields[number]
export type Booking = Record<BookingField, string | null> & { customer_name: string }
export type Staff = { id: string; email: string; isAdmin: boolean }
export type Shipment = Booking & {
  id: string
  shipment_code: string
  completed_steps: number
  created_at: string
  created_by: string
  created_by_email: string
  delivered_at: string | null
}
export type Step = {
  step_number: number
  activated_at: string | null
  completed_at: string | null
  completed_by: string | null
  completed_by_email: string | null
}
export type EventKind =
  | 'booking_created' | 'step_activated' | 'step_completed' | 'shipment_completed'
  | 'reminder_scheduled' | 'reminder_sent' | 'reminder_failed' | 'reminder_skipped'
  | 'reminder_not_configured' | 'reminders_stopped'
export type HistoryEvent = {
  id: number
  shipment_id: string
  kind: EventKind
  step_number: number | null
  actor_email: string | null
  occurred_at: string
  detail: string | null
}
export type HistoryEntry = HistoryEvent & { shipments: Pick<Shipment, 'shipment_code' | 'customer_name'> }
export type ShipmentDetail = { shipment: Shipment; steps: Step[]; history: HistoryEvent[] }
export type ReminderSettings = { configured: boolean | null; timezone: string }

export const defaultTimezone = 'Asia/Kolkata'
export const stageName = (step: number) => stages[step - 1]
export const eventLabels: Record<EventKind, string> = {
  booking_created: 'Booking Created',
  step_activated: 'Activated',
  step_completed: 'Completed',
  shipment_completed: 'Shipment Completed',
  reminder_scheduled: 'Reminder Scheduled',
  reminder_sent: 'Reminder Sent',
  reminder_failed: 'Reminder Failed',
  reminder_skipped: 'Reminder Skipped',
  reminder_not_configured: 'Reminder Not Configured',
  reminders_stopped: 'Reminders Stopped',
}

export function eventTitle(event: HistoryEvent) {
  if (event.step_number && (event.kind === 'step_activated' || event.kind === 'step_completed')) {
    return `Step ${event.step_number} · ${stageName(event.step_number)} ${eventLabels[event.kind]}`
  }
  return eventLabels[event.kind] + (event.step_number ? ` · Step ${event.step_number}` : '')
}

export function formatDate(value: string, timezone = defaultTimezone) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: timezone,
  }).format(new Date(value))
}

export function staffName(email: string) {
  return (email.split('@')[0] || 'Staff')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
