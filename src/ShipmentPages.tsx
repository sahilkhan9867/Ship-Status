import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronDown, ClipboardList, LockKeyhole, PackageCheck } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { shipmentData } from './data'
import { Activity, Empty, errorMessage, InlineError, Progress, ResourceMessage, StatusBadge, useResource, useWorkspace } from './ui'
import { bookingFields, formatDate, shipmentTypes, stageName, stages, staffName, type Booking, type BookingField } from './workflow'

type Field = { name: BookingField; label: string; type?: string; placeholder?: string }
const customerFields: Field[] = [
  { name: 'customer_name', label: 'Customer Name', placeholder: 'e.g. Evergreen Trading Co.' },
  { name: 'company_name', label: 'Company Name' },
  { name: 'contact_person', label: 'Contact Person' },
  { name: 'phone', label: 'Phone Number', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
]
const shipmentFields: Field[] = [
  { name: 'booking_number', label: 'Booking Number', placeholder: 'e.g. BK-2026-0048' },
  { name: 'shipment_type', label: 'Shipment Type' },
  { name: 'origin', label: 'Origin', placeholder: 'e.g. Mumbai, India' },
  { name: 'destination', label: 'Destination', placeholder: 'e.g. Jebel Ali, UAE' },
  { name: 'vessel_name', label: 'Vessel Name' },
  { name: 'container_number', label: 'Container Number' },
  { name: 'etd', label: 'ETD', type: 'date' },
  { name: 'eta', label: 'ETA', type: 'date' },
  { name: 'remarks', label: 'Remarks' },
]

export function BookingPage() {
  const { staff, notify } = useWorkspace()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const bookingId = useRef<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const booking = Object.fromEntries(bookingFields.map((name) => [name, String(form.get(name) ?? '').trim() || null])) as Booking
    if (!booking.customer_name) { setError('Enter a customer name.'); return }
    setSaving(true)
    setError('')
    try {
      bookingId.current ??= crypto.randomUUID()
      const code = await shipmentData.create(bookingId.current, booking, staff)
      notify('Booking completed successfully. Step 2 is now pending.')
      navigate(`/shipments/${code}`, { replace: true })
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setSaving(false) }
  }

  return <div className="page-stack booking-page">
    <div className="page-heading"><div><h1>New Booking</h1><p>Save the booking to complete Step 1 and start the shipment workflow.</p></div></div>
    <form className="booking-form" onSubmit={(event) => void submit(event)}>
      <fieldset className="card form-section" disabled={saving}>
        <h2>Customer Details</h2>
        <div className="form-grid">{customerFields.map((field) => <BookingInput key={field.name} field={field} />)}</div>
      </fieldset>
      <fieldset className="card form-section" disabled={saving}>
        <h2>Shipment Details</h2>
        <div className="form-grid">{shipmentFields.map((field) => <BookingInput key={field.name} field={field} />)}</div>
      </fieldset>
      {error && <InlineError message={error} />}
      <div className="form-actions"><Link className="button secondary" to="/shipments">Cancel</Link><button className="button primary" type="submit" disabled={saving}>{saving ? 'Saving Booking…' : 'Save Booking'}</button></div>
    </form>
  </div>
}

function BookingInput({ field }: { field: Field }) {
  const required = field.name === 'customer_name'
  const label = <span>{field.label}{required && <span className="required" aria-hidden="true"> *</span>}</span>

  if (field.name === 'remarks') return <label className="full-field">{label}<textarea name={field.name} rows={3} maxLength={4000} /></label>
  if (field.name === 'shipment_type') return <label>{label}<div className="select-wrap"><select name={field.name} defaultValue=""><option value="">Select a shipment type</option>{shipmentTypes.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={16} /></div></label>
  return <label>{label}<input name={field.name} type={field.type ?? 'text'} required={required} maxLength={field.type === 'date' ? undefined : 160} placeholder={field.placeholder} /></label>
}

export function ShipmentPage() {
  const { code = '' } = useParams()
  const { notify, staff, settings } = useWorkspace()
  const load = useCallback(() => shipmentData.detail(code), [code])
  const { data, error, reload, replace } = useResource(load)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')

  if (data === undefined) return <section className="card"><ResourceMessage error={error} retry={reload} /></section>
  if (!data) return <section className="card"><Empty title="Shipment not found" message="Check the shipment ID or find it in All Shipments." action={<Link className="button primary" to="/shipments">All Shipments</Link>} /></section>

  const { shipment, steps, history } = data
  const completed = shipment.completed_steps === stages.length
  const currentStep = shipment.completed_steps + 1

  async function markComplete(step: number) {
    setSaving(true)
    setActionError('')
    try {
      await shipmentData.complete(shipment.id, step, staff)
      notify(step === stages.length ? 'Shipment Successfully Delivered' : `Step ${step} completed. Step ${step + 1} is now pending.`)
      replace(await load())
    } catch (cause) {
      setActionError(errorMessage(cause))
      reload()
    } finally { setSaving(false) }
  }

  return <div className="page-stack detail-page">
    <section className="card shipment-summary">
      <div className="summary-heading"><div><p className="summary-code">{shipment.shipment_code}</p><h1>{shipment.customer_name}</h1></div><StatusBadge completed={completed} /></div>
      <dl className="summary-grid">
        <div><dt>Booking Number</dt><dd>{shipment.booking_number ?? '—'}</dd></div>
        <div><dt>Origin</dt><dd>{shipment.origin ?? '—'}</dd></div>
        <div><dt>Destination</dt><dd>{shipment.destination ?? '—'}</dd></div>
        <div><dt>Overall Progress</dt><dd><Progress value={shipment.completed_steps} /></dd></div>
      </dl>
      <div className={`current-summary ${completed ? 'current-completed' : ''}`}>
        {completed ? <><PackageCheck size={22} /><div><strong>Shipment Successfully Delivered</strong>{shipment.delivered_at && <p>{formatDate(shipment.delivered_at, settings.timezone)} · Reminders stopped</p>}</div></> : <><span className="current-marker" /><div><span>Current Pending Step</span><strong>Step {currentStep} · {stageName(currentStep)}</strong></div></>}
      </div>
    </section>
    <section className="card workflow-card" aria-labelledby="workflow-heading">
      <div className="card-heading"><div><h2 id="workflow-heading">Shipment Workflow</h2><p>{completed ? 'All ten steps are complete.' : 'Mark the current step complete when the activity is finished.'}</p></div></div>
      {actionError && <div className="workflow-error"><InlineError message={actionError} /></div>}
      <ol className="step-list">{steps.map((step) => {
        const isCurrent = step.step_number === currentStep
        const isComplete = Boolean(step.completed_at)
        return <li className={`step-row ${isCurrent ? 'step-current' : isComplete ? 'step-complete' : 'step-locked'}`} key={step.step_number}>
          <span className="step-marker" aria-hidden="true">{isComplete ? <Check size={19} /> : isCurrent ? step.step_number : <LockKeyhole size={16} />}</span>
          <div className="step-copy"><span>Step {step.step_number}</span><h3>{stageName(step.step_number)}</h3>{step.completed_at && <p>{formatDate(step.completed_at, settings.timezone)}{step.completed_by_email && <> · <span title={step.completed_by_email}>{staffName(step.completed_by_email)}</span></>}</p>}</div>
          <div className="step-action">{isCurrent ? <><span className="step-state">Current / Pending</span><button type="button" className="button primary" disabled={saving} onClick={() => void markComplete(step.step_number)}>{saving ? 'Completing…' : 'Mark as Complete'}</button></> : <span className="step-state">{isComplete ? 'Completed' : 'Locked'}</span>}</div>
        </li>
      })}</ol>
    </section>
    <details className="card booking-record">
      <summary><ClipboardList size={20} /> Booking Details <ChevronDown size={18} /></summary>
      <dl className="record-grid">{[...customerFields, ...shipmentFields].map(({ name, label }) => <div key={name}><dt>{label}</dt><dd>{shipment[name] ?? '—'}</dd></div>)}</dl>
    </details>
    <section className="card history-card" aria-labelledby="shipment-history-heading">
      <div className="card-heading"><h2 id="shipment-history-heading">Shipment History</h2></div>
      <ol className="timeline">{history.map((event) => <Activity key={event.id} event={event} timezone={settings.timezone} />)}</ol>
    </section>
  </div>
}
