import { useCallback, useState } from 'react'
import { Bell, Clock3, Package, PackageCheck, Plus, Search, UserPlus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isDemo, shipmentData } from './data'
import { Activity, Empty, Progress, ResourceMessage, StatusBadge, useResource, useWorkspace } from './ui'
import { stageName, stages, type Shipment } from './workflow'

const loadShipments = () => shipmentData.list()

export function Dashboard({ all = false }: { all?: boolean }) {
  const { staff } = useWorkspace()
  const { data, error, reload } = useResource(loadShipments)
  const finished = data?.filter(({ completed_steps }) => completed_steps === stages.length).length ?? 0
  const newBooking = <Link className={`button ${all ? 'primary' : 'hero-button'}`} to="/shipments/new"><Plus size={19} /> New Booking</Link>

  return <div className="page-stack">
    {all ? <div className="page-heading"><div><h1>All Shipments</h1><p>Find a booking and open its workflow.</p></div>{newBooking}</div> : <section className="dashboard-hero" aria-labelledby="dashboard-heading">
      <div className="hero-content"><h1 id="dashboard-heading">Shipment Dashboard</h1><p>Manage bookings and track shipments through delivery.</p><div className="hero-actions">
        {newBooking}
        {staff.isAdmin && <Link className="button hero-secondary" to="/staff/invite"><UserPlus size={18} /> Add Staff</Link>}
      </div></div>
    </section>}
    {!all && <section className="stats" aria-label="Shipment totals">
      <div className="stat-card"><span className="stat-icon stat-blue"><Package size={23} /></span><div><h2>Total Shipments</h2><strong>{data ? data.length : '—'}</strong></div></div>
      <div className="stat-card"><span className="stat-icon stat-amber"><Clock3 size={23} /></span><div><h2>Pending Shipments</h2><strong>{data ? data.length - finished : '—'}</strong></div></div>
      <div className="stat-card"><span className="stat-icon stat-green"><PackageCheck size={23} /></span><div><h2>Completed Shipments</h2><strong>{data ? finished : '—'}</strong></div></div>
    </section>}
    {data ? <ShipmentList shipments={data} /> : <section className="card"><ResourceMessage error={error} retry={reload} /></section>}
  </div>
}

function ShipmentList({ shipments }: { shipments: Shipment[] }) {
  const [query, setQuery] = useState('')
  const keyword = query.trim().toLowerCase()
  const filtered = shipments.filter((shipment) => [shipment.shipment_code, shipment.customer_name, shipment.booking_number]
    .some((value) => value?.toLowerCase().includes(keyword)))

  return <section className="card shipment-list" aria-labelledby="shipments-heading">
    <div className="card-heading list-heading">
      <div><h2 id="shipments-heading">Shipments</h2><p>{isDemo ? 'Sample shipments and demo bookings' : 'Current bookings and their progress'}</p></div>
      <div className="search-box"><Search size={17} /><input aria-label="Search by shipment ID, customer or booking number" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shipments…" />{query && <button className="icon-button" type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>}</div>
    </div>
    {filtered.length > 0 ? <div className="table-wrapper">
      <table>
        <thead><tr><th scope="col">Shipment ID</th><th scope="col">Customer Name</th><th scope="col">Booking Number</th><th scope="col">Current Pending Step</th><th scope="col">Progress</th><th scope="col">Status</th><th scope="col" className="table-action"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{filtered.map((shipment) => {
          const completed = shipment.completed_steps === stages.length
          const step = shipment.completed_steps + 1
          return <tr key={shipment.id}>
            <td data-label="Shipment ID" className="shipment-id">{shipment.shipment_code}</td>
            <td data-label="Customer Name" className="customer-name">{shipment.customer_name}</td>
            <td data-label="Booking Number" className="booking-number">{shipment.booking_number ?? '—'}</td>
            <td data-label="Current Pending Step" className="table-stage">{completed ? <span className="muted">—</span> : <><span className="step-label">Step {step}</span><span>{stageName(step)}</span></>}</td>
            <td data-label="Progress"><Progress value={shipment.completed_steps} /></td>
            <td data-label="Status"><StatusBadge completed={completed} /></td>
            <td className="table-action"><Link className="button compact secondary" to={`/shipments/${shipment.shipment_code}`} aria-label={`View Details for ${shipment.shipment_code}`}>View Details</Link></td>
          </tr>
        })}</tbody>
      </table>
    </div> : <Empty title={keyword ? 'No matching shipments' : 'No shipments yet'} message={keyword ? 'Try a different shipment ID, customer name or booking number.' : 'Create a booking to start tracking a shipment.'} />}
    <footer className="table-footer">Showing {filtered.length} of {shipments.length} {shipments.length === 1 ? 'shipment' : 'shipments'}</footer>
  </section>
}

const historyPageSize = 25

export function HistoryPage() {
  const { settings } = useWorkspace()
  const [page, setPage] = useState(0)
  const load = useCallback(() => shipmentData.history(page * historyPageSize, historyPageSize + 1), [page])
  const { data, error, reload } = useResource(load)
  const deliveryStatus = settings.configured === null ? 'Status unavailable' : settings.configured ? 'Configured' : 'Not Configured'

  return <div className="page-stack">
    <div className="page-heading"><div><h1>Reminders / History</h1><p>Review shipment activity and reminder delivery.</p></div></div>
    <section className="card reminder-card" aria-labelledby="reminders-heading">
      <span className="stat-icon stat-blue"><Bell size={22} /></span>
      <div><h2 id="reminders-heading">Gmail reminders</h2><p>Daily at 12:00 PM and 4:00 PM · {settings.timezone}</p>{isDemo && <p>Demo mode uses simulated reminder history.</p>}</div>
      <span className={`status-pill ${settings.configured ? 'status-complete' : 'status-pending'}`}>{deliveryStatus}</span>
    </section>
    <section className="card history-card" aria-labelledby="activity-heading">
      <div className="card-heading"><h2 id="activity-heading">Recent Activity</h2></div>
      {data ? data.length ? <ol className="timeline">{data.slice(0, historyPageSize).map((event) => <Activity key={`${event.shipment_id}-${event.id}`} event={event} timezone={settings.timezone} context={<p><Link to={`/shipments/${event.shipments.shipment_code}`}>{event.shipments.shipment_code}</Link> · {event.shipments.customer_name}</p>} />)}</ol> : <Empty title="No activity yet" message="Booking, workflow and reminder events will appear here." /> : <ResourceMessage error={error} retry={reload} />}
      {(page > 0 || (data && data.length > historyPageSize)) && <div className="table-footer pagination"><button className="button secondary compact" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className="button secondary compact" type="button" disabled={!data || data.length <= historyPageSize} onClick={() => setPage(page + 1)}>Next</button></div>}
    </section>
  </div>
}
