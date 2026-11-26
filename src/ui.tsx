import { useEffect, useReducer, useState, type ReactNode } from 'react'
import { AlertCircle, Bell, Check, CircleAlert, Clock3, Package } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import { eventTitle, formatDate, type HistoryEvent, type ReminderSettings, type Staff, staffName } from './workflow'

export type Workspace = { staff: Staff; settings: ReminderSettings; notify: (message: string) => void }
export const useWorkspace = () => useOutletContext<Workspace>()

export function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : 'Something went wrong. Please try again.' }

export function InlineError({ message }: { message: string }) {
  return <p role="alert" className="inline-error"><CircleAlert size={18} /> {message}</p>
}

export function Empty({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="empty"><Package size={26} /><h2>{title}</h2><p>{message}</p>{action}</div>
}

export function useResource<T>(load: () => Promise<T>) {
  const [result, setResult] = useState<{ load: typeof load; value?: T; error?: string }>()
  const [attempt, reload] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    let active = true
    void load().then(
      (value) => { if (active) setResult({ load, value }) },
      (cause) => { if (active) setResult({ load, error: errorMessage(cause) }) },
    )
    return () => { active = false }
  }, [load, attempt])
  const current = result?.load === load ? result : undefined
  return { data: current?.value, error: current?.error, reload, replace: (value: T) => setResult({ load, value }) }
}

export function ResourceMessage({ error, retry }: { error?: string; retry: () => void }) {
  if (error) return <div className="resource-message"><InlineError message={error} /><button className="button secondary" type="button" onClick={retry}>Try again</button></div>
  return <p className="resource-message" role="status">Loading…</p>
}

export function StatusBadge({ completed }: { completed: boolean }) {
  return <span className={`status-pill ${completed ? 'status-complete' : 'status-pending'}`}>
    {completed ? <Check size={14} /> : <Clock3 size={14} />} {completed ? 'Completed' : 'Pending'}
  </span>
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return <div className={`progress ${className}`}>
    <progress max={10} value={value} aria-label="Shipment progress" className={value === 10 ? 'progress-complete' : ''} />
    <span>{value}/10</span>
  </div>
}

export function Activity({ event, timezone, context }: { event: HistoryEvent; timezone: string; context?: ReactNode }) {
  const isReminder = event.kind.startsWith('reminder')
  const Icon = event.kind === 'reminder_failed' ? AlertCircle : isReminder ? Bell : event.kind.endsWith('completed') ? Check : Package
  return <li className="activity-item">
    <span className={`activity-icon${event.kind === 'reminder_failed' ? ' activity-failed' : ''}`}><Icon size={16} /></span>
    <div className="activity-content"><strong>{eventTitle(event)}</strong>{context}{event.actor_email && <p>By <span title={event.actor_email}>{staffName(event.actor_email)}</span></p>}{event.detail && <p>{event.detail}</p>}</div>
    <time dateTime={event.occurred_at}>{formatDate(event.occurred_at, timezone)}</time>
  </li>
}
