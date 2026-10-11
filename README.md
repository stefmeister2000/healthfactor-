# Healthfactor landing pages

Run `npm start` (Node 20+) and `npm test`. The fitness, boxing and newsletter forms share `/api/lead`.

## Sales CRM connection

Set `CRM_INBOUND_URL=https://crm.verkoop.studio/api/public/inbound-lead` and a **Healthfactor-specific** `CRM_INBOUND_TOKEN` as server-side Railway variables. Never use Verkoop Studio's token or expose either secret in HTML. Existing Resend contact/event/notification delivery continues independently.

In Railway, attach a persistent volume at `/data` before enabling CRM delivery. The server uses `RAILWAY_VOLUME_MOUNT_PATH` for `leads.csv` and the private `crm-pending` outbox. For local runs, optionally use `HEALTHFACTOR_DATA_DIR` with an absolute directory. Do not run more than one replica against this file-based outbox.

Each accepted form is stored before the success response. CRM submissions contain the person's name, email, phone, form source, original timestamp and goal. The CRM uses a stable submission UUID to commit a contact and activity atomically, so network retries do not duplicate history. Match people by email (or phone when no email is supplied), never just by their name. Company routing comes exclusively from the intake token.

The worker retries network errors, rate limits, authentication/configuration failures and server errors with backoff, also after restarts. Invalid payloads remain on disk with `failed: true` for operator review; after fixing the underlying issue, clear `failed` and set `nextAttempt` to `0` to replay the same submission. Logs contain submission IDs rather than contact details or credentials.

## Rollout

First deploy the CRM's `website_contact_intake` migration and application support. Save a copy of the existing container's `leads.csv` before restarting it, attach the volume, configure the Healthfactor key, and deploy this website. Restore the saved rows to `/data/leads.csv` without overwriting newly received rows. This does not automatically import historical submissions; future forms are delivered to the CRM. Verify from the website server with a clearly identified synthetic CRM-only submission so Resend emails are not sent by the test.

Only explicit HTML pages, favicons and image assets are publicly served. Data, server files, dotfiles and tests cannot be downloaded.
