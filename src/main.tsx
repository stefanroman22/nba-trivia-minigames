
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { GoogleOAuthProvider } from '@react-oauth/google';
import { Provider } from "react-redux";
import { store } from "./store";
import './index.css';

createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <GoogleOAuthProvider clientId="504454176332-ut7po2glf32fv3dajltgnb5aho65er7i.apps.googleusercontent.com">
      <App />
    </GoogleOAuthProvider>
  </Provider>
)
