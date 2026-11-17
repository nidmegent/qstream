import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDget-ixly4mUSF-pZw38ESaDOmQXaOezY',
  authDomain: 'stream-queue-overlay.firebaseapp.com',
  databaseURL: 'https://stream-queue-overlay-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'stream-queue-overlay',
  storageBucket: 'stream-queue-overlay.firebasestorage.app',
  messagingSenderId: '801820592106',
  appId: '1:801820592106:web:3803736e0c438923e59493'
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
