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

function getAllReminders() {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };

      tx.oncomplete = () => {
        db.close();
      };

      tx.onerror = () => {
        db.close();
      };
    } catch (error) {
      reject(error);
    }
  });
}

function updateReminderLog(reminderId) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const getRequest = store.get(reminderId);

      getRequest.onsuccess = () => {
        const reminder = getRequest.result;
        if (reminder) {
          reminder.lastNotified = new Date().toISOString();
          store.put(reminder);
        }
      };

      tx.oncomplete = () => {
        db.close();
        resolve();
      };

      tx.onerror = (event) => {
        db.close();
        reject(tx.error || event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

async function checkReminders() {
  const now = new Date();
  const reminders = await getAllReminders();

  for (const reminder of reminders) {
    if (!reminder.enabled) continue;

    if (reminder.type === "daily") {
      // Handle daily recurring reminders (bible study)
      const reminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), reminder.reminderHour, reminder.reminderMinute, 0);
      const lastNotified = reminder.lastNotified ? new Date(reminder.lastNotified) : null;

      // Check if it's time to notify (after the reminder time and not notified today)
      if (now >= reminderTime && (!lastNotified || lastNotified.getDate() !== now.getDate() || lastNotified.getMonth() !== now.getMonth() || lastNotified.getFullYear() !== now.getFullYear())) {
        // Show notification
        await self.registration.showNotification(reminder.title, {
          body: reminder.body,
          badge: "./icons/app-icon.svg",
          icon: "./icons/app-icon.svg",
          tag: reminder.id,
          data: {
            url: "./index.html#estudio-biblico",
          },
        });

        // Update last notified time
        await updateReminderLog(reminder.id);
      }
    } else {
      // Handle one-time reminders (followups)
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
  const targetUrl = event.notification.data?.url || "./index.html#seguimiento";

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
