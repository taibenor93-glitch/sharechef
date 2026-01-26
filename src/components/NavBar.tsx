import { Link } from "react-router-dom"

export function NavBar() {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-left">
          <span className="brand">ShareChef</span>
        </div>
        <div className="nav-right">
          <Link className="pill" to="/">
            Home
          </Link>
          <Link className="pill" to="/link-in-bio">
            Link in Bio
          </Link>
        </div>
      </div>
    </nav>
  )
}
