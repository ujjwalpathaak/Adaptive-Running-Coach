import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard'
import { GarminRunDetailPage } from './pages/GarminRunDetail'
import { GarminRuns } from './pages/GarminRuns'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/runs" element={<GarminRuns />} />
        <Route path="/runs/:id" element={<GarminRunDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
