import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import DeviceSelect from './pages/DeviceSelect'
import ProgramDischarge from './pages/ProgramDischarge'
import ControlRoom from './pages/ControlRoom'
import Bibliography from './pages/Bibliography'
import ReplayRoom from './pages/ReplayRoom'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DeviceSelect />} />
        <Route path="/program/:deviceId" element={<ProgramDischarge />} />
        <Route path="/run/:deviceId" element={<ControlRoom />} />
        <Route path="/replay" element={<ReplayRoom />} />
        <Route path="/bibliography" element={<Bibliography />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  )
}
