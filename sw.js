// sw.js - Service Worker for background sync

const CACHE_NAME = 'bharat-kyc-cache-v1';
const UPLOAD_QUEUE_STORE = 'upload_queue';

// Basic caching for app shell (optional but good practice)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll([
                '/',
                'index.html',
                'login.html',
                'register.html',
                'upload.html'
                // Add other static assets if needed
            ]);
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request);
        })
    );
});


// Listen for the 'sync' event to process the upload queue
self.addEventListener('sync', event => {
    if (event.tag === 'sync-uploads') {
        event.waitUntil(processUploadQueue());
    }
});

function openDB() {
    return new Promise((resolve, reject) => {
        const request = self.indexedDB.open('BharatKYC-DB', 1);
        request.onerror = (event) => reject("IndexedDB error: " + event.target.errorCode);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore(UPLOAD_QUEUE_STORE, { autoIncrement: true });
        };
    });
}

async function processUploadQueue() {
    const db = await openDB();
    const tx = db.transaction(UPLOAD_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(UPLOAD_QUEUE_STORE);
    const requests = await getAllFromStore(store);

    return Promise.all(requests.map(async (req) => {
        try {
            const response = await fetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
            });

            if (!response.ok) {
                 // If server responds with an error, it might be a permanent failure.
                 // For simplicity here, we assume it might be transient.
                 // In a real app, handle 4xx vs 5xx errors differently.
                throw new Error(`Server responded with status: ${response.status}`);
            }
            
            // If fetch is successful, remove it from the queue
            const deleteTx = db.transaction(UPLOAD_QUEUE_STORE, 'readwrite');
            await deleteFromStore(deleteTx.objectStore(UPLOAD_QUEUE_STORE), req.key);
            console.log('Successfully uploaded queued request:', req.url);

        } catch (error) {
            console.error('Failed to upload queued request, will retry later.', error);
            // The request remains in IndexedDB for the next sync attempt.
        }
    }));
}

function getAllFromStore(store) {
    return new Promise((resolve, reject) => {
        const request = store.openCursor();
        const items = [];
        request.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor) {
                items.push({ ...cursor.value, key: cursor.primaryKey });
                cursor.continue();
            } else {
                resolve(items);
            }
        };
        request.onerror = event => reject(event.target.error);
    });
}

function deleteFromStore(store, key) {
     return new Promise((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = event => reject(event.target.error);
    });
}
