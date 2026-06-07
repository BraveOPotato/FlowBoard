import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import FlowBoard from './FlowBoard.tsx'
import './App.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlowBoard />
  </StrictMode>,
)
