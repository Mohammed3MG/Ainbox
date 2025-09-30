import ThemeChange from "./components/ThemeChange"
import Home from "./components/appComponents/home"
import { Routes, Route } from 'react-router-dom'
import Terms from './pages/Terms'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import ProtectedRoute from './components/routing/ProtectedRoute'
import ErrorBoundary from './components/routing/ErrorBoundary'

function App() {


  return (
    <ErrorBoundary>
      {/* <ThemeChange> </ThemeChange> */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/terms" element={
          <ProtectedRoute>
            <Terms />
          </ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/calendar" element={
          <ProtectedRoute>
            <Calendar />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Home />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default App
