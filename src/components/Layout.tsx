import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export function Layout() {
  const nav = useNavigate()

  const signOut = async () => {
    await supabase.auth.signOut()
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
            <button type="button" className="nav-link nav-signout" onClick={signOut}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
