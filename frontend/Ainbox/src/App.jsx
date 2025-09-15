import ThemeChange from "./components/ThemeChange"
import Home from "./components/appComponents/home"
import { Routes, Route } from 'react-router-dom'
import Terms from './pages/Terms'
import Dashboard from './pages/Dashboard'
import ProtectedRoute from './components/routing/ProtectedRoute'

function App() {


  return (
    <>
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
        <Route path="*" element={<Home />} />
      </Routes>
    </>
  )
}

export default App
