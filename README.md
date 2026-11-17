# Luma

Desktop chat app (Tauri + React + Supabase): servers (with icons, kick, rename), text and voice channels, camera and screen sharing, per-person volume, direct messages, replies, edits, reactions, pins, @mentions, Markdown-style formatting, search, image/file uploads, profiles with status and bio, Online/Ausente/Não perturbe, typing indicator, auto-update.

## Setup (once)

1. Create a free project at [supabase.com](https://supabase.com).
2. Database: GitHub repo > **Settings > Secrets and variables > Actions** > new secret `SUPABASE_DB_URL` = Supabase > **Connect** > **Session pooler** connection string, with the database password filled in. Then run the **Migrate database** workflow (Actions tab), which applies everything in `supabase/migrations`. Without GitHub: `npx supabase db push --remote="<that connection string>"`.
3. Supabase > **Authentication > Sign In / Providers > Email**: turn off **Confirm email** (a desktop app has no page for the confirmation link to land on). Leave it on only if you set up a redirect.
4. Supabase > **Authentication > Emails > Reset Password**: put the code in the message body, e.g. `Seu código do Luma: {{ .Token }}`. The app's "Esqueci minha senha" screen asks for that code (the default template only has a link, which has nowhere to land in a desktop app).
5. Copy `.env.example` to `.env` and fill in the values from **Project Settings > API** (Project URL and the `anon` public key).

## Database changes

Add a new file to `supabase/migrations` named `<YYYYMMDDHHMMSS>_<what>.sql` (later timestamp than the others; `npx supabase migration new <what>` creates it). Never edit a migration that already ran.

`.github/workflows/migrate.yml` applies new migrations with `supabase db push`:
- on every push to `master` that touches `supabase/migrations`;
- before every release build (`release.yml` waits for it), so a published version never expects columns that do not exist yet.

## Voice through strict NAT (optional)

Without TURN, voice only connects when both peers can reach each other directly (STUN). Some networks (mobile data, corporate, CGNAT) need a relay:

1. Cloudflare dashboard > **Realtime > TURN Server** > create a TURN key. Copy the **Turn Token ID** and the **API Token**.
2. GitHub repo > **Settings > Secrets and variables > Actions**, add:
   - `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN` (the Cloudflare values);
   - `SUPABASE_ACCESS_TOKEN`: Supabase > **Account > Access Tokens** > generate one.
3. Actions tab > **Deploy functions** > **Run workflow**. It copies the Cloudflare values into the function's secrets and deploys `supabase/functions/turn`. Later pushes that change `supabase/functions` deploy by themselves.

The app asks the function for credentials (valid 24 h, logged-in users only) each time it joins a voice channel. Free tier: 1,000 GB of relayed traffic a month.

## Run

```sh
npm install
npx tauri dev      # development
npx tauri build    # installer in src-tauri/target/release/bundle/nsis
```

The Supabase URL and key are baked in at build time, so rebuild after changing `.env`.

## How it works

- Data and permissions: Postgres tables with row level security (`supabase/migrations`). Members only see their servers, channels and messages; actions that need several writes (create server, join with invite, open DM) are SQL functions called with `supabase.rpc`.
- Live updates: Supabase Realtime `postgres_changes` for messages (new, edited, deleted, reactions), channels, members, DMs and profiles.
- Typing indicator: a private Realtime broadcast topic per channel/DM (`typing:<id>`).
- Files: private `uploads` bucket; the database stores paths and the app shows them through signed URLs (`*_private_uploads.sql`).
- Online status (Online/Ausente/Não perturbe), "who is in which voice channel" and who is sharing a screen: one Realtime presence channel (`online`).
- Unread: a `reads` table keeps the last message id each user has seen per channel/DM; `unread_counts()` counts the rest. Windows notifications come from `tauri-plugin-notification`.
- Voice, camera and screen share: WebRTC peer-to-peer mesh (`src/voice.ts`), signalling over a private Realtime broadcast channel per voice room (only members of the server can join it). STUN, plus TURN relays from Cloudflare when the `turn` edge function is deployed (see below).

## Known limits

- Voice is a mesh: fine for small rooms (~8 people).
- Server mute, status, microphone and per-person volumes are saved per device, not per account.
- Renaming a server or changing its icon reaches other members on their next load (servers are not in Realtime).
- Search lists up to 50 matches; a match more than 1000 messages back is listed but not opened in the chat.
- Deleting an account leaves its uploaded files in storage.
