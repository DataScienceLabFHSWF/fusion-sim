import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import DeviceSelect from './pages/DeviceSelect'
import ProgramPulse from './pages/ProgramPulse'
import ControlRoom from './pages/ControlRoom'
import Bibliography from './pages/Bibliography'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DeviceSelect />} />
        <Route path="/program/:deviceId" element={<ProgramPulse />} />
        <Route path="/run/:deviceId" element={<ControlRoom />} />
        <Route path="/bibliography" element={<Bibliography />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  )
}
