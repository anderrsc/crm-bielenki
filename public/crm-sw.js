self.addEventListener('push', event => {
  let data = {};
  try { data = event.data.json(); } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'CRM Bielenki', {
    body: data.body || 'Há um novo aviso no CRM.', tag: data.tag || 'crm',
    icon: '/icon.svg', data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/atendimento' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
