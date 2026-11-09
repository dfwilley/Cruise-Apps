# Port Side Quests: switching on the shared journal

The app works without this: quests, the journal and photos are kept on each phone.
These steps (about 15 minutes, done once) let two or more travelers share one trip journal.

## 1. Create a Supabase project (free plan)
1. Sign in at https://supabase.com/dashboard and choose **New project**.
2. Name it `port-side-quests`, pick a region near you, and save the database password somewhere safe (the app never needs it).

## 2. Create the tables
1. Open **SQL Editor**, paste the whole of `supabase/schema.sql`, and press **Run**.
2. It should say *Success. No rows returned*. If it says *Stopped: … already holds rows*, nothing was changed; ask before going further.

## 3. Email sign-in with a code
1. **Authentication → Sign In / Providers → Email**: make sure Email is on.
2. **Authentication → URL Configuration**: set **Site URL** to `https://dfwilley.github.io/Cruise-Apps/port-side-quests/` and add the same address under **Redirect URLs**.
3. **Authentication → Emails → Magic Link** template: make the message include the code, for example
   ```html
   <h2>Your Port Side Quests sign-in code</h2>
   <p>Type this code into the app: <strong>{{ .Token }}</strong></p>
   <p>Or, on a computer, <a href="{{ .ConfirmationURL }}">click here to sign in</a>.</p>
   ```
   The code is what makes sign-in work inside the iPhone app.
4. Supabase's built-in email sender only sends a few emails per hour. That's fine for two people.

## 4. Connect the app
1. **Project Settings → API Keys**: copy the **Project URL** and the **publishable** key (starts with `sb_publishable_`).
2. Put them in `port-side-quests/sync-config.js`. The publishable key is meant to be public. **Never** put the secret or `service_role` key there.
3. Commit. GitHub Pages and the iPhone builds pick it up.

## 5. Test with two people
1. Traveler A: **Shared trip** tab → email → enter the code → **Start a new trip** → **Send invitation…**
2. Traveler B: opens the invitation link (or pastes the code under **Join a trip**), signs in with their own email, and joins.
3. Each records a discovery with a photo; tap **Refresh now** on the other phone (it also refreshes every minute).
4. Check that a third email address, not invited, sees no trips.

## How privacy works
- Each person signs in separately. The database only shows a trip, its entries and photos to that trip's members (row level security).
- Invitations are 64 random characters; only a scrambled copy (hash) is stored. They expire after 14 days. The owner can make a new one (the old one stops working) or turn invitations off.
- The owner can remove people or delete the whole trip (entries and photos). Members can leave.
- Photos sit in a private storage bucket; the app gets one-hour viewing links.
- This is not end-to-end encryption: whoever runs the Supabase project can see the data. Copies on each phone stay until deleted there; use **Journal → Backup** to keep a file copy.
