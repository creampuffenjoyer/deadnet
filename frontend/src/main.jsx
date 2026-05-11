import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// VO1D console signature — fires on every app load
// eslint-disable-next-line no-console
console.log(
  '%c DEADNET %c Built by s0L %c v1.0',
  'background:#FF4500;color:white;padding:4px 8px;font-weight:bold',
  'background:#0E0E1A;color:#6B6B85;padding:4px 8px',
  'background:#0E0E1A;color:#6B6B85;padding:4px 8px',
)
// eslint-disable-next-line no-console
console.log('the void is not empty as everyone may seem.')
// eslint-disable-next-line no-console
console.log("have you ever played contra?")
// eslint-disable-next-line no-console

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
