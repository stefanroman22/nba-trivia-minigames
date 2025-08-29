import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GoogleOAuthProvider } from '@react-oauth/google';

createRoot(document.getElementById('root')!).render(
  <GoogleOAuthProvider clientId="504454176332-ut7po2glf32fv3dajltgnb5aho65er7i.apps.googleusercontent.com">
    <App />
  </GoogleOAuthProvider>
)
