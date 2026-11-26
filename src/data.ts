import { createClient } from '@supabase/supabase-js'
import { demoData } from './demo'
import { defaultTimezone, type Booking, type HistoryEntry, type ReminderSettings, type Shipment, type ShipmentDetail, type Staff } from './workflow'

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL
const publicKey: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && publicKey ? createClient(url, publicKey) : null
export const isDemo = !supabase

export async function inviteStaff(email: string) {
  const { data, error } = await supabase!.auth.getSession()
  if (error || !data.session) throw new Error('Sign in again to send invitations.')

  const response = await fetch('/.netlify/functions/invite-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify({ email }),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || result?.sent !== true) {
    throw new Error(result?.message ?? 'The invitation service is unavailable. Try again shortly.')
  }
}

export async function createInvitationAuth(tokenHash: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tokenHash))
  const key = 'shipstatus-invite-' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const { auth } = createClient(url!, publicKey!, {
    auth: {
      storageKey: key,
      storage: window.sessionStorage,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return { auth, clear: () => window.sessionStorage.removeItem(key) }
}

const productionData = {
  async list(): Promise<Shipment[]> {
    const rows: Shipment[] = []
    const pageSize = 250
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase!.from('shipments').select('*')
        .order('created_at', { ascending: false }).order('id').range(from, from + pageSize - 1)
      if (error) throw new Error(error.message)
      rows.push(...data as Shipment[])
      if (data.length < pageSize) return rows
    }
  },
  async detail(code: string): Promise<ShipmentDetail | null> {
    const { data, error } = await supabase!.rpc('shipment_detail', { p_code: code })
    if (error) throw new Error(error.message)
    return data as ShipmentDetail | null
  },
  async create(id: string, booking: Booking, _staff: Staff): Promise<string> {
    const { data, error } = await supabase!.rpc('create_shipment', { p_id: id, p_booking: booking })
    if (error) throw new Error(error.message)
    return data as string
  },
  async complete(id: string, step: number, _staff: Staff) {
    const { error } = await supabase!.rpc('complete_shipment_step', { p_id: id, p_step: step })
    if (error) throw new Error(error.message)
  },
  async history(offset: number, limit: number): Promise<HistoryEntry[]> {
    const { data, error } = await supabase!.from('shipment_history').select('*, shipments(shipment_code, customer_name)')
      .order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
    if (error) throw new Error(error.message)
    return data as HistoryEntry[]
  },
}

export const shipmentData = isDemo ? demoData : productionData

export async function getReminderSettings(): Promise<ReminderSettings> {
  if (isDemo) return { configured: false, timezone: defaultTimezone }
  try {
    const response = await fetch('/.netlify/functions/reminder-settings', { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('Reminder settings unavailable.')
    return await response.json() as ReminderSettings
  } catch {
    return { configured: null, timezone: defaultTimezone }
  }
}
