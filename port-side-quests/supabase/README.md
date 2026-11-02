# Port Side Quests — Private shared journal (Version 2)

This web app remains fully usable locally. To activate private journal synchronization between travelers, connect a Supabase project.

## Why Supabase?

- **Authentication:** passwordless email magic link; no password to distribute. Set site URL / redirect allowlist to `https://dfwilley.github.io/Cruise-Apps/port-side-quests/`.
- **Journal storage:** Postgres, row-level security (RLS) scoped to members of a travel group.
- **Photos:** private Supabase Storage bucket, short-lived signed image URLs; JPEG data is compressed by the app before upload.
- **Invitations:** a randomly generated 128-bit secret, displayed to the creator only once as `group-uuid:invitation-code`. Share privately. Anybody who learns the invitation can join; rotate/delete the group in Supabase if exposed. There is currently no self-service invite rotation or member removal.
- **Offline:** local journal and manual export/import continue to work. Newly recorded discoveries sync when online and signed in; if upload fails, use **Share my local discoveries** to retry. Remote entries refresh every 30 seconds while open. There is not yet a background-sync queue or conflict-edit system.

## Setup

1. Create a Supabase project at https://supabase.com/dashboard (use a new project for isolation). Review pricing and storage quota.
2. Under **Authentication → Providers**, enable Email. Under **Authentication → URL Configuration**, set the Site URL to `https://dfwilley.github.io/Cruise-Apps/port-side-quests/` and add the same address under redirect URLs. Check that outbound email delivery and limits support your travelers.
3. In the project **SQL Editor**, run [schema.sql](schema.sql). It creates group/member/entry tables, the private photo bucket, membership policies and invitation functions. Review any SQL before executing it. Keep RLS enabled.
4. In the Supabase project settings, copy the **Project URL** and **publishable/anon client key**. Edit `../sync-config.js` to insert them. Publishable keys may be in public client code; **never** commit the service role or secret key.
5. Wait for GitHub Pages to publish the changed repo. Open the app, sign in by email, create a group and privately share its invitation. Other travelers sign in from their own email and join using the invitation.
6. Test with two independent accounts/devices: add a note, upload a photo, refresh on the other device, and confirm that a third uninvited account cannot access the group, its entries or photos. Confirm photos disappear after signed URL expiry and refresh appropriately.

## Important limitations and safeguards

- No account login or backend exists until YOU configure Supabase; a repository commit alone does not activate sharing.
- Photos are not end-to-end encrypted: your Supabase project operator can access backend storage. Only authenticated group members receive temporary signed photo URLs. A signed URL can be shared and remains valid until its 5-minute expiration.
- Shared entries are append-only from the UI; the app does not yet support edits, group removal or deletion of shared photos. Manual local journal deletion does **not** remove remote entries.
- Browser-local journal exports include embedded photos: handle them privately. Browser storage can be cleared; export backups.
- The app has no offline first-load guarantee; visit it online first. Network access is required for magic links and sync.
- Storage objects are capped at 5 MB, JPEG only. Permissions rely on the project policies, not hiding a key.
- Travel-day return estimates are never sourced from this sharing backend; ship instructions always take priority.
