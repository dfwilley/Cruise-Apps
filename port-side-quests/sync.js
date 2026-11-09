/* Port Side Quests — shared trip journal through Supabase (optional; the app works without it).
   Sign-in is by a one-time code emailed to each traveler, so it also works inside the iPhone app.
   Everything here only works after the owner has set up Supabase (see SETUP.md). */
(function (root) {
  'use strict';
  const cfg = root.QUEST_SYNC_CONFIG || {};
  const BUCKET = 'quest-photos';
  let db = null, user = null;
  const listeners = new Set();
  const emit = () => listeners.forEach(f => { try { f(user); } catch (e) { console.error(e); } });
  const fail = e => { throw new Error((e && (e.message || e.error_description)) || 'Shared journal error'); };
  const check = ({ data, error }) => { if (error) fail(error); return data; };
  const randomCode = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');

  function configured() { return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url || '') && !!cfg.publishableKey && !!root.supabase; }

  async function init() {
    if (!configured()) return false;
    db = root.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data } = await db.auth.getSession();
    user = (data && data.session && data.session.user) || null;
    db.auth.onAuthStateChange((_e, s) => { const next = (s && s.user) || null; if ((next && next.id) !== (user && user.id)) { user = next; emit(); } });
    emit();
    return true;
  }

  async function sendCode(email) {
    email = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address');
    const redirect = /^https:/.test(location.href) ? location.origin + location.pathname : undefined;
    check(await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirect } }));
  }
  async function verifyCode(email, code) {
    code = String(code || '').replace(/\D/g, '');
    if (code.length < 6 || code.length > 10) throw new Error('Enter the code from the email (6 to 10 digits)');
    const data = check(await db.auth.verifyOtp({ email: String(email).trim(), token: code, type: 'email' }));
    user = data.user || user; emit();
  }
  async function signOut() { await db.auth.signOut(); user = null; emit(); }

  async function trips() {
    const rows = check(await db.from('quest_trips').select('id,name,owner_id,invite_expires_at,created_at').order('created_at', { ascending: false }));
    return rows.map(t => Object.assign(t, { mine: t.owner_id === user.id, invitesOn: !!t.invite_expires_at && new Date(t.invite_expires_at) > new Date() }));
  }
  async function createTrip(name, display) {
    const code = randomCode();
    const id = check(await db.rpc('quest_create_trip', { p_name: String(name).trim(), p_code: code, p_display: display || '' }));
    return { id, code };
  }
  const joinTrip = async (code, display) => check(await db.rpc('quest_join_trip', { p_code: String(code).trim().toLowerCase(), p_display: display || '' }));
  async function newInvite(tripId) { const code = randomCode(); const expires = check(await db.rpc('quest_new_invite', { p_trip: tripId, p_code: code })); return { code, expires }; }
  const stopInvite = async tripId => check(await db.rpc('quest_stop_invite', { p_trip: tripId }));
  const members = async tripId => check(await db.rpc('quest_list_members', { p_trip: tripId }));
  const setName = async (tripId, name) => check(await db.rpc('quest_set_name', { p_trip: tripId, p_display: name }));
  const removeMember = async (tripId, userId) => check(await db.rpc('quest_remove_member', { p_trip: tripId, p_user: userId }));
  const leaveTrip = async tripId => check(await db.rpc('quest_leave_trip', { p_trip: tripId }));

  async function deleteTrip(tripId) {
    // Photos first, through the Storage API (deleting them with SQL would leave the files behind).
    for (;;) {
      const list = check(await db.storage.from(BUCKET).list(tripId, { limit: 100 }));
      if (!list.length) break;
      check(await db.storage.from(BUCKET).remove(list.map(o => tripId + '/' + o.name)));
      if (list.length < 100) break;
    }
    check(await db.rpc('quest_delete_trip', { p_trip: tripId }));
  }

  /** Shared entries for a trip, newest first, each with short-lived photo links. */
  async function entries(tripId) {
    const rows = check(await db.from('quest_entries').select('*').eq('trip_id', tripId).order('found_at', { ascending: false }).limit(1000));
    const paths = rows.flatMap(r => r.photo_paths || []);
    const urls = {};
    for (let i = 0; i < paths.length; i += 100) {
      const signed = check(await db.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), 3600));
      for (const s of signed) if (s.signedUrl) urls[s.path] = s.signedUrl;
    }
    return rows.map(r => Object.assign(r, { photoUrls: (r.photo_paths || []).map(p => urls[p]).filter(Boolean), mine: r.author_id === user.id }));
  }

  /** Sends one journal entry from this phone to the shared trip (safe to repeat). */
  async function upload(entry, tripId) {
    const paths = [];
    for (let i = 0; i < Math.min(3, (entry.photos || []).length); i++) {
      const path = tripId + '/' + entry.id + '-' + (i + 1) + '.jpg';
      const blob = entry.photos[i];
      if (blob.size > 5e6) throw new Error('A photo is over 5 MB after compression');
      const { error } = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (error && !/exist|duplicate|409/i.test(error.message + ' ' + (error.statusCode || ''))) fail(error);
      paths.push(path);
    }
    check(await db.from('quest_entries').upsert({
      id: entry.id, trip_id: tripId, author_id: user.id, theme: entry.theme, title: entry.title.slice(0, 200),
      kind: (entry.kind || '').slice(0, 60), port: (entry.port || '').slice(0, 200), port_id: (entry.portId || '').slice(0, 100),
      note: (entry.note || '').slice(0, 5000), photo_paths: paths, found_at: entry.foundAt
    }, { onConflict: 'id', ignoreDuplicates: true }));
  }
  const updateNote = async (id, note) => check(await db.from('quest_entries').update({ note: String(note).slice(0, 5000) }).eq('id', id));
  async function deleteEntry(row) {
    if ((row.photo_paths || []).length) check(await db.storage.from(BUCKET).remove(row.photo_paths));
    check(await db.from('quest_entries').delete().eq('id', row.id));
  }

  root.QuestSync = {
    configured, init, onChange: f => listeners.add(f), user: () => user,
    sendCode, verifyCode, signOut, trips, createTrip, joinTrip, newInvite, stopInvite, members, setName,
    removeMember, leaveTrip, deleteTrip, entries, upload, updateNote, deleteEntry
  };
})(window);
