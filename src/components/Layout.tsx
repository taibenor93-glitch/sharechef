import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth, setGuest } from '../hooks/useAuth'

export function Layout() {
  const nav = useNavigate()
  const { session, guest } = useAuth()

  const leave = async () => {
    if (session) await supabase.auth.signOut()
    setGuest(false)
    nav('/login', { replace: true })
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    'nav-link' + (isActive ? ' is-active' : '')

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="ShareChef home">
            <span className="brand-dot" />
            <span className="brand-name">ShareChef</span>
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end className={linkClass}>Cook</NavLink>
            <NavLink to="/saved" className={linkClass}>My recipes</NavLink>
            <button type="button" className="nav-link nav-signout" onClick={leave}>
              {guest && !session ? 'Sign in' : 'Sign out'}
            </button>
          </nav>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '18px 20px 26px',
          display: 'flex',
          gap: 20,
          justifyContent: 'center',
          alignItems: 'center',
          color: 'var(--muted)',
          fontSize: 13,
          flexWrap: 'wrap',
        }}
      >
        <NavLink to="/about" className="link-btn" style={{ textDecoration: 'none' }}>About</NavLink>
        <NavLink to="/faq" className="link-btn" style={{ textDecoration: 'none' }}>FAQ</NavLink>
        <NavLink to="/pricing" className="link-btn" style={{ textDecoration: 'none' }}>Pricing</NavLink>
        <span>© {new Date().getFullYear()} ShareChef</span>
      </footer>
    </div>
  )
}
