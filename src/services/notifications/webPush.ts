import { supabase } from '../lib/supabase'

declare global { interface Window { firebase?: any } }

const firebaseConfig = {
  apiKey: 'AIzaSyCxzSL0I38STGaR8D88gbKUbicU_VOCk8E',
  authDomain: 'jtbazar-9fc3d.firebaseapp.com',
  projectId: 'jtbazar-9fc3d',
  storageBucket: 'jtbazar-9fc3d.firebasestorage.app',
  messagingSenderId: '763074877925',
  appId: '1:763074877925:web:bc1449e25a81038b9df70c',
}
const vapidKey = 'BLuGqLYCEksJlid3YciT2lJKbrd2USfD-yprN9c8C5wJje8ZOfBIJylY9mZC0CTaAbdvRMUQNEG_1TlVy2bwxTA'

function getMessaging() {
  const firebase = window.firebase
  if (!firebase) throw new Error('Firebase Messaging SDK could not be loaded. Refresh and try again.')
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig)
  return firebase.messaging(app)
}

async function callPushFunction(accessToken: string, payload: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const response = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/firebase-push-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Push registration failed (' + response.status + ').')
  return result
}

export async function enableWebPush(accessToken: string) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('This browser does not support web push notifications.')
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')
  if (!await window.firebase?.messaging?.isSupported?.()) throw new Error('Push notifications are not supported in this browser.')
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
  const token = await getMessaging().getToken({ vapidKey, serviceWorkerRegistration: registration })
  if (!token) throw new Error('Firebase did not return a web push token.')
  await callPushFunction(accessToken, { action: 'register', platform: 'web', token, device_label: navigator.userAgent.slice(0, 110) })
  return token
}

export async function disableWebPush(accessToken: string) {
  try {
    const current = getMessaging()
    const token = await current.getToken({ vapidKey })
    if (token) await callPushFunction(accessToken, { action: 'unregister', token })
    await current.deleteToken()
  } catch (error) { console.warn('Could not fully unregister browser push token:', error) }
}