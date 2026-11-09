importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js')
firebase.initializeApp({ apiKey: 'AIzaSyCxzSL0I38STGaR8D88gbKUbicU_VOCk8E', authDomain: 'jtbazar-9fc3d.firebaseapp.com', projectId: 'jtbazar-9fc3d', storageBucket: 'jtbazar-9fc3d.firebasestorage.app', messagingSenderId: '763074877925', appId: '1:763074877925:web:bc1449e25a81038b9df70c' })
const messaging = firebase.messaging()
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification?.title || 'JTBazar', { body: payload.notification?.body || 'You have a new update.', icon: '/pwa-icon-192.png', badge: '/favicon-48.png', data: payload.data || {} })
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.link || '/'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    for (const client of windows) { if ('focus' in client) { client.navigate(target); return client.focus() } }
    return clients.openWindow(target)
  }))
})