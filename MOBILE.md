# Mobile and offline operations

The dashboard is an installable PWA. The service worker caches only the application shell and static assets; `/api/*`, authenticated responses, and factory records are not cached.

Daily Operations supports IndexedDB drafts scoped by user, factory, date, and shift. Offline Save and Submit actions both remain local drafts. Submission and approval are always server-authoritative.

On reconnect, the operator reviews and syncs the draft. The client sends the server revision it last observed. If the record changed, it shows local and server values and requires an explicit choice before retrying. Never treat a local “pending” state as accepted production data.

Web push is opt-in and requires the production VAPID public key, private key, and subject in secret storage. Critical alerts use a durable delivery queue with bounded retries; email, SMS, and WhatsApp remain disabled.