# Cruise Port Side Quests — Version 2 cloud journal setup

The app remains usable without a cloud project. Shared journal synchronization requires a **separate Supabase project**, configured by the owner. No service role key belongs in GitHub or a browser.

## Design
- **Authentication:** Supabase Auth email magic links, separate login for each traveler.
- **Authorization:** PostgreSQL Row Level Security (RLS): only members can read trip entries/photos; only an entry's author can delete their entry.
- **Invitation:** 32 cryptographically random bytes represented as 64 hex characters. Only SHA-256 hash stored server-side. Anyone holding the code *and signed in* can join. Treat codes as private credentials; current first version has no invitation revocation or participant removal.
- **Entries:** Postgres `quest_entries`. Photos: private `quest-photos` Supabase Storage bucket, compressed to JPEG before upload; rendered using short-lived signed URLs.
- **Sync:** after local save, upload when authenticated and a trip selected; manual refresh and 30-second refresh while tab is active. If offline, local save remains; click **Upload existing local entries** when back online. Entries are deduplicated by UUID. Uploading does not delete local records.
- **Limitations:** browser-local photos may use storage space; photo upload can succeed when a later database operation fails, leaving an orphan object. Remote deletion is not in this UI. Journals with hundreds of photos may take time to refresh. Signed URLs grant temporary access to anyone receiving the URL. This is not end-to-end encryption or a backup service.

## Activate
1. Create a Supabase project at https://supabase.com/dashboard. In **SQL Editor**, execute `supabase-schema.sql` once. Review policies and verify no unexpected existing tables/policies in the project. Prefer a dedicated project.
2. In **Authentication → Providers**, enable Email. In **URL Configuration**, set the site URL and add redirect URL: `https://dfwilley.github.io/Cruise-Apps/port-side-quests/`.
3. In **Project Settings → API**, copy the **Project URL** and browser **publishable** key. Edit `sync-config.js` to set `url` and `publishableKey`. It is normal for a publishable key to be visible; never paste a service_role key.
4. Confirm Storage bucket `quest-photos` is **private** and has 5 MB limit, JPEG-only upload. Confirm database RLS enabled on all quest tables and correct policies.
5. Open the published site over HTTPS, enter an email, follow the link, create a trip, privately send its invitation to the other traveler. Each traveler signs in separately and joins.
6. Test on two devices: add note + photo on A, wait up to 30 seconds on B or click Refresh; confirm it appears. Test a second unrelated signed-in account cannot access the private trip until invited.
7. Review the dashboard's quotas, email sending limits and backup needs. Keep local journal exports as backups.

## Sources
- https://supabase.com/docs/reference/javascript/auth
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals

V2 ships as code/config + migration, **not** as an already activated service. No backend credentials or project has been provisioned automatically.
