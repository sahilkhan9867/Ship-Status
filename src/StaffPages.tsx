import { useRef, useState, type FormEvent } from 'react'
import { Check, KeyRound } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { createInvitationAuth, inviteStaff, isDemo } from './data'
import { errorMessage, InlineError, useWorkspace } from './ui'

export function InviteStaffPage() {
  const { staff } = useWorkspace()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const address = email.trim()
    setPending(true)
    setError('')
    setConfirmation('')
    try {
      if (!isDemo) await inviteStaff(address)
      setConfirmation(isDemo ? `Demo invitation preview for ${address}.` : `Invitation sent to ${address}.`)
      setEmail('')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setPending(false) }
  }

  if (!staff.isAdmin) return <section className="card form-section staff-page">
    <h1>Admin access required</h1>
    <p className="muted">Ask your ShipStatus admin to invite staff.</p>
    <Link className="button secondary" to="/">Back to Dashboard</Link>
  </section>

  return <div className="page-stack staff-page">
    <div className="page-heading"><div><h1>Add Staff</h1><p>Invite someone to the shared shipment workspace.</p></div></div>
    <form className="card form-section staff-form" onSubmit={(event) => void submit(event)}>
      <label>Work email<input name="email" type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" maxLength={254} disabled={pending} required /></label>
      <p className="muted">{isDemo ? 'Email delivery is disabled in demo mode.' : 'They’ll receive a link to set their password.'}</p>
      {error && <InlineError message={error} />}
      {confirmation && <p className="staff-success" role="status"><Check size={18} />{confirmation}</p>}
      <div className="form-actions"><Link className="button secondary" to="/">Back to Dashboard</Link><button className="button primary" disabled={pending} type="submit">{isDemo ? 'Preview Invitation' : pending ? 'Sending…' : 'Send Invitation'}</button></div>
    </form>
  </div>
}

export function AcceptInvitationPage({ signedIn }: { signedIn: boolean }) {
  const location = useLocation()
  const tokenHash = new URLSearchParams(location.hash.slice(1)).get('token_hash')
  const navigate = useNavigate()
  const invitation = useRef<{ tokenHash: string; client: Awaited<ReturnType<typeof createInvitationAuth>> } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!tokenHash || pending) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== form.get('confirmation')) { setError('The passwords must match.'); return }

    setPending(true)
    setError('')
    try {
      if (invitation.current?.tokenHash !== tokenHash) {
        invitation.current = { tokenHash, client: await createInvitationAuth(tokenHash) }
      }
      const { auth, clear } = invitation.current.client
      const { data: { session } } = await auth.getSession()
      if (!session) {
        const { data, error } = await auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })
        if (error || !data.session) {
          throw new Error(error?.status === 403 || error?.code === 'otp_expired'
            ? 'This invitation has expired or was already used. Ask your admin for a new invite.'
            : (error?.message ?? 'The invitation could not be verified.'))
        }
      }
      const { error } = await auth.updateUser({ password })
      if (error) throw error

      invitation.current = null
      setDone(true)
      navigate(location.pathname, { replace: true })
      void auth.signOut({ scope: 'local' }).finally(clear).catch(() => {})
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setPending(false) }
  }

  const openWorkspace = <Link className="button primary" to={signedIn ? '/' : '/login'}>{signedIn ? 'Back to Dashboard' : 'Go to Sign In'}</Link>

  return <main className="accept-layout">
    <section className="card form-section staff-form staff-page">
      <span className="stat-icon stat-blue"><KeyRound size={23} /></span>
      {done ? <><h1>Password set</h1><p>Use the email that received your invitation and your new password to sign in.</p>{openWorkspace}</>
        : isDemo || !tokenHash ? <><h1>Open your invitation</h1><p>Use the link in your ShipStatus invitation email to set your password.</p>{openWorkspace}</>
        : <>
          <h1>Set your password</h1>
          <p>Choose a password to finish joining ShipStatus.</p>
          <form className="staff-form" onSubmit={(event) => void submit(event)}>
            <label>New password<input type="password" name="password" autoComplete="new-password" minLength={8} maxLength={72} disabled={pending} required /></label>
            <label>Confirm password<input type="password" name="confirmation" autoComplete="new-password" minLength={8} maxLength={72} disabled={pending} required /></label>
            {error && <InlineError message={error} />}
            <button className="button primary" disabled={pending} type="submit">{pending ? 'Saving…' : 'Set Password'}</button>
          </form>
        </>}
    </section>
  </main>
}
