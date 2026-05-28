const DB_NAME = "PreachingAppDB";
const DB_VERSION = 1;
const STORE_NAME = "reminders";
const CHECK_INTERVAL_MS = 60000; // Check every minute

let checkIntervalId = null;

// IndexedDB functions
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

async function getAllReminders() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const reminders = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await tx.complete;
    db.close();
    return reminders;
  } catch (error) {
    console.error("Error getting reminders from IndexedDB:", error);
    return [];
  }
}

async function updateReminderLog(reminderId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const reminder = await new Promise((resolve, reject) => {
      const request = store.get(reminderId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (reminder) {
      reminder.lastNotified = new Date().toISOString();
      await store.put(reminder);
    }
    await tx.complete;
    db.close();
  } catch (error) {
    console.error("Error updating reminder log:", error);
  }
}

async function checkReminders() {
  const now = new Date();
  const reminders = await getAllReminders();

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;

    const targetTime = new Date(reminder.targetTime);
    const lastNotified = reminder.lastNotified ? new Date(reminder.lastNotified) : null;

    // Check if it's time to notify
    if (now >= targetTime && (!lastNotified || lastNotified < targetTime)) {
      // Show notification
      await self.registration.showNotification(reminder.title, {
        body: reminder.body,
        badge: "./icons/app-icon.svg",
        icon: "./icons/app-icon.svg",
        tag: reminder.id,
        data: {
          url: "./index.html#seguimiento",
        },
      });

      // Update last notified time
      await updateReminderLog(reminder.id);
    }
  }
}

function startReminderCheck() {
  if (checkIntervalId) {
    clearInterval(checkIntervalId);
  }

  checkIntervalId = setInterval(checkReminders, CHECK_INTERVAL_MS);
  checkReminders(); // Check immediately
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
  startReminderCheck();
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL("./index.html#seguimiento", self.location.href).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            return client.focus().then(() => client.navigate(targetUrl));
          }
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
