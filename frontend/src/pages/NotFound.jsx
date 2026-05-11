import { useLocation, Link } from 'react-router-dom'
import Scanlines from '../components/effects/Scanlines'

// <!-- FRAGMENT: _f0und_ -->
// <!-- nice try. but this isn't the door. -->
// <!-- the architect leaves headers. check the wire. -->

export default function NotFound() {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center relative">
      <Scanlines />

      {/* Hidden fragments — visible only in page source */}
      {/* FRAGMENT: _f0und_ */}
      {/* nice try. but this isn't the door. */}
      {/* the architect leaves headers. check the wire. */}

      <div className="relative z-10 max-w-lg w-full px-6 text-center space-y-6">
        <div className="space-y-2">
          <p className="font-mono text-sm text-ember tracking-widest">
            {'> ERROR: PATH NOT FOUND'}
          </p>
          <p className="font-mono text-xs text-ghost">
            {'LOCATION: '}<span className="text-bone">{pathname}</span>
          </p>
          <p className="font-mono text-xs text-ghost">
            {'STATUS: 404'}
          </p>
          <p className="font-mono text-xs text-ghost">
            {'go back, there is nothing here.'}
          </p>
        </div>

        <Link
          to="/"
          className="inline-block font-mono text-xs tracking-widest px-6 py-2 border border-ember/50 text-ember hover:border-ember hover:bg-ember/10 transition-all rounded-sm"
        >
          [ RETURN TO DEADNET ]
        </Link>
      </div>
    </div>
  )
}
