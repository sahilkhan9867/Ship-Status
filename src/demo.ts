import { type Booking, type EventKind, type HistoryEntry, type HistoryEvent, type ShipmentDetail, type Staff, stages } from './workflow'

const shipmentKey = 'shipstatus.demo.shipments.v1'
const sessionKey = 'shipstatus.demo.session.v1'
const scheduled = 'Daily at 12:00 PM and 4:00 PM while this step is pending.'
const skipped = 'Future reminders skipped because this step was completed.'
export const demoStaff: Staff = { id: 'demo-staff', email: 'demo@shipstatus.example', isAdmin: true }

function addEvent(detail: ShipmentDetail, occurred_at: string, kind: EventKind, step_number: number | null, actor_email: string | null = null, message: string | null = null) {
  const id = (detail.history.at(-1)?.id ?? 0) + 1
  detail.history.push({ id, shipment_id: detail.shipment.id, kind, step_number, actor_email, occurred_at, detail: message })
}

function makeBooking(booking: Booking, id: string, code: string, staff: Staff, at: string): ShipmentDetail {
  const detail: ShipmentDetail = {
    shipment: {
      ...booking, id, shipment_code: code, completed_steps: 1, delivered_at: null,
      created_at: at, created_by: staff.id, created_by_email: staff.email,
    },
    steps: stages.map((_, i) => ({
      step_number: i + 1,
      activated_at: i <= 1 ? at : null,
      completed_at: i === 0 ? at : null,
      completed_by: i === 0 ? staff.id : null,
      completed_by_email: i === 0 ? staff.email : null,
    })),
    history: [],
  }
  addEvent(detail, at, 'booking_created', null, staff.email)
  addEvent(detail, at, 'step_completed', 1, staff.email)
  addEvent(detail, at, 'step_activated', 2)
  addEvent(detail, at, 'reminder_scheduled', 2, null, scheduled)
  return detail
}

function complete(detail: ShipmentDetail, step: number, staff: Staff, at: string) {
  if (step < 2 || step > stages.length || step !== detail.shipment.completed_steps + 1) {
    throw new Error('Only the current pending step can be completed.')
  }
  Object.assign(detail.steps[step - 1], { completed_at: at, completed_by: staff.id, completed_by_email: staff.email })
  detail.shipment.completed_steps = step
  addEvent(detail, at, 'step_completed', step, staff.email)
  addEvent(detail, at, 'reminder_skipped', step, null, skipped)
  if (step === stages.length) {
    detail.shipment.delivered_at = at
    addEvent(detail, at, 'shipment_completed', null, staff.email)
    addEvent(detail, at, 'reminders_stopped', null)
    return
  }
  detail.steps[step].activated_at = at
  addEvent(detail, at, 'step_activated', step + 1)
  addEvent(detail, at, 'reminder_scheduled', step + 1, null, scheduled)
}

function seed() {
  const samples = [
    { customer: 'Evergreen Trading Co.', origin: 'Mumbai, India', destination: 'Jebel Ali, UAE', progress: 1, days: 1 },
    { customer: 'Pacific Textile Exporters', origin: 'Mundra, India', destination: 'Hamburg, Germany', progress: 3, days: 3 },
    { customer: 'Meridian Global Imports', origin: 'Chennai, India', destination: 'Singapore', progress: 6, days: 6 },
    { customer: 'Coastal Harvest Foods', origin: 'Cochin, India', destination: 'Colombo, Sri Lanka', progress: 10, days: 12 },
  ]
  const now = Date.now()
  const year = new Date(now).getUTCFullYear()
  return samples.map((sample, index) => {
    const started = now - (sample.days * 24 + 1) * 3_600_000
    const number = 1004 - index
    const detail = makeBooking({
      customer_name: sample.customer, company_name: sample.customer, contact_person: null, phone: null,
      email: null, booking_number: `BK-${year}-${String(48 - index).padStart(4, '0')}`,
      shipment_type: index === 2 ? 'LCL' : 'FCL', origin: sample.origin, destination: sample.destination,
      vessel_name: index > 0 ? 'MV Ocean Meridian' : null, container_number: index > 0 ? `MSCU 45120${index}7` : null,
      etd: null, eta: null, remarks: null,
    }, `demo-${number}`, `SHP-${year}-${number}`, demoStaff, new Date(started).toISOString())
    for (let step = 2; step <= sample.progress; step++) {
      complete(detail, step, demoStaff, new Date(started + (step - 1) * 12 * 3_600_000).toISOString())
    }
    if (sample.progress < stages.length) {
      addEvent(detail, new Date(now - 1_800_000).toISOString(), 'reminder_not_configured', sample.progress + 1, null, 'Simulated reminder · Email delivery is disabled in demo mode.')
    }
    return detail
  })
}

function save(records: ShipmentDetail[]) {
  localStorage.setItem(shipmentKey, JSON.stringify(records))
}

function read(): ShipmentDetail[] {
  const raw = localStorage.getItem(shipmentKey)
  if (raw) return JSON.parse(raw) as ShipmentDetail[]
  const records = seed()
  save(records)
  return records
}

export function demoSession() {
  return localStorage.getItem(sessionKey) === 'active' ? demoStaff : null
}

export function startDemo() {
  localStorage.setItem(sessionKey, 'active')
  return demoStaff
}

export function stopDemo() {
  localStorage.removeItem(sessionKey)
}

export function resetDemo() {
  save(seed())
}

export const demoData = {
  async list() {
    return read().map(({ shipment }) => shipment)
  },
  async detail(code: string) {
    return read().find(({ shipment }) => shipment.shipment_code === code) ?? null
  },
  async create(id: string, booking: Booking, staff: Staff) {
    const records = read()
    const existing = records.find(({ shipment }) => shipment.id === id)
    if (existing) return existing.shipment.shipment_code
    const serial = 1 + Math.max(1000, ...records.map(({ shipment }) => Number(shipment.shipment_code.split('-').at(-1))))
    const now = new Date()
    const code = `SHP-${now.getUTCFullYear()}-${serial}`
    save([makeBooking(booking, id, code, staff, now.toISOString()), ...records])
    return code
  },
  async complete(id: string, step: number, staff: Staff) {
    const records = read()
    const detail = records.find(({ shipment }) => shipment.id === id)
    if (!detail) throw new Error('Shipment could not be found.')
    complete(detail, step, staff, new Date().toISOString())
    save(records)
  },
  async history(offset: number, limit: number): Promise<HistoryEntry[]> {
    return read().flatMap(({ shipment, history }) => history.map((event: HistoryEvent) => ({
      ...event, shipments: { shipment_code: shipment.shipment_code, customer_name: shipment.customer_name },
    }))).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id).slice(offset, offset + limit)
  },
}
