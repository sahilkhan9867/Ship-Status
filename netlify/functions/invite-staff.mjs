import { createClient } from '@supabase/supabase-js'

const emailPattern = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/

function reply(status, body) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export default async function inviteStaff(request) {
  if (request.method !== 'POST') return reply(405, { message: 'Use POST to send an invitation.' })
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1]
  if (!token) return reply(401, { message: 'Sign in again to send invitations.' })

  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: secret, SITE_URL, URL: netlifyUrl } = process.env
  const site = URL.canParse(SITE_URL || netlifyUrl || '') ? new URL(SITE_URL || netlifyUrl) : null
  const isLocal = site?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(site.hostname)
  if (!url || !secret || (site?.protocol !== 'https:' && !isLocal)) {
    return reply(503, { message: 'Staff invitations are not configured. Check the server settings.' })
  }

  try {
    const { auth } = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: userError } = await auth.getUser(token)
    if (userError?.status === 0 || userError?.status >= 500) {
      return reply(502, { message: 'The sign-in service is unavailable. Try again shortly.' })
    }
    if (userError || !user) return reply(401, { message: 'Sign in again to send invitations.' })
    if (!user.email_confirmed_at || user.app_metadata?.shipstatus_admin !== true) {
      return reply(403, { message: 'Only ShipStatus admins can invite staff.' })
    }

    const body = await request.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (email.length > 254 || !emailPattern.test(email)) return reply(400, { message: 'Enter a valid work email address.' })

    const redirectTo = new URL('/staff/accept', site).href
    const { error } = await auth.admin.inviteUserByEmail(email, { redirectTo })
    if (!error) return reply(200, { sent: true })
    if (error.code === 'email_exists' || error.code === 'user_already_exists') {
      return reply(409, { message: 'This email already has a ShipStatus account.' })
    }
    if (error.status === 429) return reply(429, { message: 'Too many invitations were requested. Try again in a few minutes.' })
    console.warn('Staff invitation rejected by Supabase Auth.', error.code || error.status)
    return reply(502, { message: 'The invitation could not be sent. Check the Supabase Auth email settings and try again.' })
  } catch {
    return reply(502, { message: 'The invitation service is unavailable. Try again shortly.' })
  }
}
