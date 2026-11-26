import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, CalendarDays, Check, ChevronRight, FlaskConical, LayoutDashboard, LogOut, Menu, Package, RotateCcw, Ship, X } from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { getReminderSettings, isDemo, supabase } from './data'
import { demoSession, demoStaff, resetDemo, startDemo, stopDemo } from './demo'
import { Dashboard, HistoryPage } from './Dashboard'
import { BookingPage, ShipmentPage } from './ShipmentPages'
import { AcceptInvitationPage, InviteStaffPage } from './StaffPages'
import { Empty, errorMessage, InlineError, type Workspace } from './ui'
import { defaultTimezone, staffName, type ReminderSettings, type Staff } from './workflow'

const navigation = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/shipments', label: 'All Shipments', icon: Package },
  { path: '/history', label: 'Reminders / History', icon: Bell },
]
const demoPassword = 'shipstatus-demo'

export function App() {
  const [staff, setStaff] = useState<Staff | null | undefined>(() => isDemo ? demoSession() : undefined)

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      const user = session?.user
      setStaff(user?.email ? {
        id: user.id, email: user.email,
        isAdmin: Boolean(user.email_confirmed_at) && user.app_metadata?.shipstatus_admin === true,
      } : null)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email: string, password: string) {
    if (isDemo) {
      if (email && (email.toLowerCase() !== demoStaff.email || password !== demoPassword)) {
        throw new Error('Use Enter demo workspace to sign in with the sample account.')
      }
      setStaff(startDemo())
      return
    }
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }

  async function signOut() {
    if (isDemo) {
      stopDemo()
      setStaff(null)
      return
    }
    const { error } = await supabase!.auth.signOut()
    if (error) throw new Error(error.message)
  }

  if (staff === undefined) return <div className="boot-state"><Brand /><p role="status">Opening workspace…</p></div>

  return (
    <Routes>
      <Route path="/login" element={<Login staff={staff} signIn={signIn} />} />
      <Route path="/staff/accept" element={<AcceptInvitationPage signedIn={Boolean(staff)} />} />
      <Route element={staff ? <Shell staff={staff} signOut={signOut} /> : <LoginRedirect />}>
        <Route index element={<Dashboard />} />
        <Route path="/shipments" element={<Dashboard all />} />
        <Route path="/shipments/new" element={<BookingPage />} />
        <Route path="/shipments/:code" element={<ShipmentPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/staff/invite" element={<InviteStaffPage />} />
        <Route path="*" element={<Empty title="Page not found" message="Use the dashboard to find a shipment." action={<Link className="button primary" to="/">Open Dashboard</Link>} />} />
      </Route>
    </Routes>
  )
}

function LoginRedirect() {
  const location = useLocation()
  return <Navigate to="/login" replace state={{ from: location.pathname }} />
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon"><Ship size={23} strokeWidth={2.1} /></span>
      <div><strong>ShipStatus</strong><span>Shipment Management</span></div>
    </div>
  )
}

function Login({ staff, signIn }: { staff: Staff | null; signIn: (email: string, password: string) => Promise<void> }) {
  const location = useLocation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  async function submit(email: string, password: string) {
    setPending(true)
    setError('')
    try { await signIn(email, password) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setPending(false) }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    void submit(String(form.get('email')), String(form.get('password')))
  }

  if (staff) return <Navigate to={from} replace />

  return (
    <main className="login-layout">
      <div className="login-visual">
        <Brand />
        <div className="login-caption"><h2>From booking<br />to delivery.</h2><p>Track every shipment in ten clear steps.</p></div>
      </div>
      <div className="login-panel">
        <div className="login-inner">
          <div className="mobile-brand"><Brand /></div>
          <h1>Sign in</h1>
          <p>Open your shipment management workspace.</p>
          <form className="login-form" onSubmit={submitForm}>
            <label>Email<input type="email" name="email" placeholder="you@company.com" autoComplete="username" defaultValue={isDemo ? demoStaff.email : undefined} required /></label>
            <label>Password<input type="password" name="password" placeholder="Enter your password" autoComplete="current-password" defaultValue={isDemo ? demoPassword : undefined} required /></label>
            {error && <InlineError message={error} />}
            <button className="button primary" disabled={pending} type="submit">{pending ? 'Signing in…' : 'Login'}</button>
          </form>
          {isDemo && <div className="login-demo">
            <div className="demo-heading"><FlaskConical size={18} /> Demo mode</div>
            <p>Use sample shipments to try the workflow. Demo changes stay in this browser and email delivery is disabled.</p>
            <button className="button secondary" type="button" disabled={pending} onClick={() => void submit('', '')}>Enter demo workspace</button>
          </div>}
        </div>
      </div>
    </main>
  )
}

function Shell({ staff, signOut }: { staff: Staff; signOut: () => Promise<void> }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileNav, setMobileNav] = useState(false)
  const [settings, setSettings] = useState<ReminderSettings>({ configured: isDemo ? false : null, timezone: defaultTimezone })
  const [notice, setNotice] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [revision, setRevision] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const profile = staffName(staff.email)
  const route = navigation.find(({ path }) => path === location.pathname)
  const section = route?.label ?? (location.pathname === '/staff/invite' ? 'Add Staff' : location.pathname.startsWith('/shipments/') ? 'All Shipments' : 'Dashboard')
  const subsection = location.pathname === '/shipments/new' ? 'New Booking' : 'Shipment Details'
  const date = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: settings.timezone }).format(new Date())

  useEffect(() => {
    let active = true
    void getReminderSettings().then((result) => { if (active) setSettings(result) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 6500)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function logout() {
    setLeaving(true)
    setSessionError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (cause) { setSessionError(errorMessage(cause)) }
    finally { setLeaving(false) }
  }

  function reset() {
    try {
      resetDemo()
      setRevision((count) => count + 1)
      setNotice('Demo data has been reset.')
      setMobileNav(false)
      dialog.current?.close()
      navigate('/')
    } catch (cause) { setSessionError(errorMessage(cause)); dialog.current?.close() }
  }

  return (
    <div className="workspace">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside id="primary-sidebar" className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <Link className="sidebar-brand" to="/" aria-label="ShipStatus dashboard" onClick={() => setMobileNav(false)}><Brand /></Link>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navigation.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} end={path === '/'} to={path} onClick={() => setMobileNav(false)}><Icon size={19} strokeWidth={1.9} />{label}</NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {isDemo && <button type="button" onClick={() => dialog.current?.showModal()}><RotateCcw size={18} /> Reset demo data</button>}
          <button type="button" onClick={() => void logout()} disabled={leaving}><LogOut size={18} /> Logout</button>
        </div>
      </aside>
      {mobileNav && <button className="nav-scrim" aria-label="Close menu" type="button" onClick={() => setMobileNav(false)} />}
      <div className="workspace-body">
        <header className="topbar">
          <div className="topbar-path">
            <button type="button" className="icon-button menu-toggle" aria-label={mobileNav ? 'Close menu' : 'Open menu'} aria-controls="primary-sidebar" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}>{mobileNav ? <X size={22} /> : <Menu size={22} />}</button>
            {!route && section === 'All Shipments' ? <><Link to="/shipments">{section}</Link><ChevronRight className="crumb-divider" size={15}/><span>{subsection}</span></> : <span>{section}</span>}
          </div>
          <div className="topbar-meta">
            <span className="topbar-date"><CalendarDays size={16} /> {date}</span>
            {isDemo && <span className="demo-badge"><FlaskConical size={14} /> Demo mode</span>}
            <div className="profile" title={staff.email}><span className="avatar">{profile[0]?.toUpperCase()}</span><span className="profile-name">{profile}</span></div>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {sessionError && <InlineError message={sessionError} />}
          <Outlet key={revision} context={{ staff, settings, notify: setNotice } satisfies Workspace} />
        </main>
      </div>
      {notice && <div className="toast" role="status"><span className="toast-check"><Check size={18} /></span><span>{notice}</span><button className="icon-button" type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={18} /></button></div>}
      <dialog ref={dialog} className="reset-dialog" aria-labelledby="reset-title">
        <h2 id="reset-title">Reset demo data?</h2><p>This will remove demo bookings and changes from this browser and restore the four sample shipments.</p>
        <div className="form-actions"><button className="button secondary" autoFocus type="button" onClick={() => dialog.current?.close()}>Cancel</button><button className="button primary" type="button" onClick={reset}>Reset demo data</button></div>
      </dialog>
    </div>
  )
}

