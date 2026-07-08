import { lazy, Suspense } from 'react'
import { useLocation } from './hooks/useClient'
import { DEFAULT_THEME, ThemeProvider } from '@zendeskgarden/react-theming'

const NavBar = lazy(() => import('./locations/NavBar'))

const LOCATIONS = {
  nav_bar: NavBar,
  default: () => null
}

function App() {
  const location = useLocation()
  const Location = LOCATIONS[location] || LOCATIONS.default

  return (
    <ThemeProvider theme={{ ...DEFAULT_THEME }}>
      <Suspense fallback={<span>Loading...</span>}>
        <Location />
      </Suspense>
    </ThemeProvider>
  )
}

export default App
