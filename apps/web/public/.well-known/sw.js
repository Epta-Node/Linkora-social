// ============================================================================
// Service Worker for Browser Push API (Linkora Social)
// ============================================================================

// 1. Listen for incoming push notifications from the backend server
self.addEventListener('push', function(event) {
  // Gracefully exit if the push event arrives empty
  if (!event.data) {
    console.log('Push event received but contains no data.');
    return;
  }

  try {
    // Parse the incoming JSON payload from the Web Push protocol
    const data = event.data.json();
    const title = data.title || 'Linkora Social';
    
    const options = {
      body: data.body || 'You have received a new update!',
      icon: data.icon || '/logo192.png',     // Adjust if Linkora uses a different logo name
      badge: data.badge || '/badge.png',    // Small monochrome icon shown in status bars
      vibrate: [100, 50, 100],              // Vibration pattern for mobile devices
      data: {
        url: data.url || '/'                // URL to open when clicked
      },
      actions: data.actions || []           // Optional interactive action buttons
    };

    // Keep the service worker alive until the operating system renders the notification
    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('Error handling push event in service worker:', err);
  }
});

// 2. Listen for when a user clicks on the rendered notification UI banner
self.addEventListener('notificationclick', function(event) {
  // Dismiss the notification banner immediately
  event.notification.close();
  
  // Extract target routing URL from configuration data payload
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Look through open tabs/windows; if one is already open at our target URL, focus it
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // If no matching tab is open, launch a fresh browser window targeting the link
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});