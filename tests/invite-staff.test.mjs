import assert from 'node:assert/strict'
import { test } from 'node:test'
import inviteStaff from '../netlify/functions/invite-staff.mjs'

const authUrl = 'https://auth.example.test'
const workspaceUrl = 'https://shipments.example.test'
const serviceKey = 'test-service-role-key'

function inviteRequest(token, body = { email: 'new.staff@example.test' }) {
  return new Request(`${workspaceUrl}/.netlify/functions/invite-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  })
}

test('staff invites require a verified admin and use the configured workspace origin', async (t) => {
  const previous = process.env
  process.env = { ...previous, SUPABASE_URL: authUrl, SUPABASE_SECRET_KEY: serviceKey, SITE_URL: workspaceUrl }
  t.after(() => { process.env = previous })
  const requests = []
  let deliveryError
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    if (request.url === `${authUrl}/auth/v1/user`) {
      const credential = request.headers.get('Authorization')
      if (credential === 'Bearer unverified-token') return Response.json({ message: 'Invalid token' }, { status: 401 })
      return Response.json({
        id: 'test-staff', email: 'staff@example.test',
        email_confirmed_at: credential === 'Bearer unconfirmed-admin' ? null : '2026-11-27T05:00:00Z',
        user_metadata: { shipstatus_admin: true },
        app_metadata: { shipstatus_admin: credential !== 'Bearer regular-staff' },
      })
    }
    assert.equal(new URL(request.url).pathname, '/auth/v1/invite')
    if (deliveryError) return Response.json({ error_code: deliveryError.code }, { status: deliveryError.status })
    return Response.json({ id: 'invited-user', email: 'new.staff@example.test' })
  })

  assert.equal((await inviteStaff(new Request(workspaceUrl))).status, 405)
  assert.equal((await inviteStaff(inviteRequest(null))).status, 401)
  assert.equal(requests.length, 0)
  assert.equal((await inviteStaff(inviteRequest('unverified-token'))).status, 401)
  assert.equal((await inviteStaff(inviteRequest('unconfirmed-admin'))).status, 403)
  assert.equal((await inviteStaff(inviteRequest('regular-staff', { email: 'new.staff@example.test', shipstatus_admin: true }))).status, 403)
  assert.equal((await inviteStaff(inviteRequest('verified-admin', { email: 'invalid' }))).status, 400)
  assert.ok(requests.every(({ method }) => method === 'GET'))

  const sent = await inviteStaff(inviteRequest('verified-admin', { email: ' New.Staff@Example.Test ', redirectTo: 'https://other.example.test', role: 'admin' }))
  assert.equal(sent.status, 200)
  assert.deepEqual(await sent.json(), { sent: true })
  const invite = requests.at(-1)
  assert.equal(invite.headers.get('Authorization'), `Bearer ${serviceKey}`)
  assert.equal(new URL(invite.url).searchParams.get('redirect_to'), `${workspaceUrl}/staff/accept`)
  assert.deepEqual(await invite.json(), { email: 'new.staff@example.test' })

  deliveryError = { code: 'over_email_send_rate_limit', status: 429 }
  assert.equal((await inviteStaff(inviteRequest('verified-admin'))).status, 429)
  deliveryError = { code: 'email_exists', status: 422 }
  assert.equal((await inviteStaff(inviteRequest('verified-admin'))).status, 409)
  delete process.env.SUPABASE_SECRET_KEY
  assert.equal((await inviteStaff(inviteRequest('verified-admin'))).status, 503)
})
