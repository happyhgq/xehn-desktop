import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installMockApi } from './mock'
import './styles.css'

if (!window.api) {
  installMockApi()
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
