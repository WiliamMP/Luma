# Luma

Desktop chat app (Tauri + React + Supabase): servers, text and voice channels, screen sharing, direct messages, replies, edits and reactions, image/file uploads, profiles with status and bio, online status, typing indicator, auto-update.

## Setup (once)

1. Create a free project at [supabase.com](https://supabase.com).
2. Supabase > **SQL Editor** > paste all of `supabase/schema.sql` > **Run**. Then the same, in order, with `supabase/002_unread.sql`, `003_private_uploads.sql`, `004_private_voice.sql` and `005_features.sql`.
3. Supabase > **Authentication > Sign In / Providers > Email**: turn off **Confirm email** (a desktop app has no page for the confirmation link to land on). Leave it on only if you set up a redirect.
4. Supabase > **Authentication > Emails > Reset Password**: put the code in the message body, e.g. `Seu código do Luma: {{ .Token }}`. The app's "Esqueci minha senha" screen asks for that code (the default template only has a link, which has nowhere to land in a desktop app).
5. Copy `.env.example` to `.env` and fill in the values from **Project Settings > API** (Project URL and the `anon` public key).

## Voice through strict NAT (optional)

Without TURN, voice only connects when both peers can reach each other directly (STUN). Some networks (mobile data, corporate, CGNAT) need a relay:

1. Cloudflare dashboard > **Realtime > TURN Server** > create a TURN key. Copy the **Turn Token ID** and the **API Token**.
2. ```sh
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase secrets set CF_TURN_KEY_ID=... CF_TURN_API_TOKEN=...
   npx supabase functions deploy turn
   ```

The app asks the function for credentials (valid 24 h, logged-in users only) each time it joins a voice channel. Free tier: 1,000 GB of relayed traffic a month.

## Run

```sh
npm install
npx tauri dev      # development
npx tauri build    # installer in src-tauri/target/release/bundle/nsis
```

The Supabase URL and key are baked in at build time, so rebuild after changing `.env`.

## How it works

- Data and permissions: Postgres tables with row level security (`supabase/schema.sql`). Members only see their servers, channels and messages; actions that need several writes (create server, join with invite, open DM) are SQL functions called with `supabase.rpc`.
- Live updates: Supabase Realtime `postgres_changes` for messages (new, edited, deleted, reactions), channels, members, DMs and profiles.
- Typing indicator: a private Realtime broadcast topic per channel/DM (`typing:<id>`).
- Files: private `uploads` bucket; the database stores paths and the app shows them through signed URLs (`003_private_uploads.sql`).
- Online status and "who is in which voice channel": one Realtime presence channel (`online`).
- Unread: a `reads` table keeps the last message id each user has seen per channel/DM; `unread_counts()` counts the rest. Windows notifications come from `tauri-plugin-notification`.
- Voice and screen share: WebRTC peer-to-peer mesh (`src/voice.ts`), signalling over a private Realtime broadcast channel per voice room (only members of the server can join it). STUN, plus TURN relays from Cloudflare when the `turn` edge function is deployed (see below).

## Known limits

- Voice is a mesh: fine for small rooms (~8 people).
- Server mute and the chosen microphone are saved per device, not per account.
- Renaming a server reaches other members on their next load (servers are not in Realtime).
