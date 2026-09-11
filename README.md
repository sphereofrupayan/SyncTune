# SyncTune

A private synchronized YouTube music room for friends.

## Features

- Username/password login
- Admin-created friend accounts
- Private room
- Paste a YouTube URL
- Everyone receives the same video
- Play/pause/seek synchronization
- Live online-user count
- Reconnect + state synchronization
- Ready for Render deployment

## Local setup

```bash
npm install
```

Copy `.env.example` to `.env` and set a long `JWT_SECRET`, a private `ADMIN_KEY`, and your `ROOM_NAME`.

```bash
npm start
```

Open `http://localhost:10000`.

## Create friend accounts

After the server starts, create accounts with the admin key.

Windows PowerShell:

```powershell
$headers = @{ "x-admin-key" = "YOUR_ADMIN_KEY" }
$body = @{ username = "friend1"; password = "friendpass123" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:10000/api/admin/users -Headers $headers -ContentType "application/json" -Body $body
```

Repeat for each friend.

## Render deployment

Create a Render Web Service from this repository.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Environment variables:

```text
JWT_SECRET=your-long-random-secret
ADMIN_KEY=your-private-admin-key
ROOM_NAME=Friends Room
```

The application uses Socket.IO/WebSockets for real-time synchronization.

## YouTube

SyncTune uses the official YouTube IFrame Player API. Browser autoplay policies can require each user to interact with the player before audio can start automatically.
