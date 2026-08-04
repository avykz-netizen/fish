# Fish

An online version of the 9-set card game Fish: 6 players, 2 teams of 3, real-time
rooms with a shareable code, and bots that track public information (who's said no
to what, who's received what) and play with real probability-based reasoning.

This is a real server (Node + Express + Socket.io), not a browser-only demo:
- Hands are stored server-side and only ever sent to the player who owns them —
  no peeking, no trust required.
- The server is the referee, so nobody's browser tab has to stay open for the
  game to keep running.
- Rooms live in memory. That's plenty for a game night with friends; if the
  server restarts, in-progress rooms are lost (no database needed for this).

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Open a second tab (or have a friend on the
same network hit `http://YOUR-LOCAL-IP:3000`) to test a real multiplayer game.

## Deploy it for free, so friends can join from anywhere

### Step 1: get this code onto GitHub

You need this project in a GitHub repository before Render (or any host) can
deploy it. Two ways to do that — pick whichever feels easier.

**Option A — no command line, just drag and drop (easiest):**

1. Go to [github.com](https://github.com) and sign up if you don't have an
   account (free).
2. Click the **+** in the top-right corner → **New repository**.
3. Name it something like `fish-game`. Leave it **Public** (Render's free
   tier needs to read it). Don't check any of the "initialize with" boxes.
   Click **Create repository**.
4. On the next page, click the link that says **uploading an existing
   file**.
5. Unzip the `fish-app.zip` I gave you on your computer first. Then drag
   the *contents* of that unzipped `fish-app` folder (not the folder
   itself — go inside it and select everything) into the GitHub upload box.
   You should see `server.js`, `engine.js`, `package.json`, `README.md`,
   the `public` folder, etc.
6. **Important:** do NOT upload a `node_modules` folder if one exists on
   your computer — it's huge and unnecessary (the `.gitignore` file
   included in the project tells Git to skip it, but the drag-and-drop
   uploader doesn't read `.gitignore`, so just don't drag that folder in).
   Everything else in the project should go up.
7. Scroll down, add a commit message like "Initial commit," click
   **Commit changes**.

That's it — your repo is ready. Copy its URL from the address bar (looks
like `https://github.com/your-username/fish-game`) — you'll pick this repo
in Render in Step 2.

**Option B — command line (if you have `git` installed):**

```bash
cd fish-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/fish-game.git
git push -u origin main
```

(Create the empty repo on GitHub first, same as steps 1-3 above, just skip
step 4 onward — GitHub will show you this exact command block on the new
repo's page too, under "...or push an existing repository from the command
line.")

If GitHub asks for a password when you `git push` and rejects your normal
account password: GitHub no longer accepts account passwords over the
command line. Use a **Personal Access Token** instead (GitHub ->
Settings -> Developer settings -> Personal access tokens -> Generate new
token -> give it "repo" access -> use that token as the password when
prompted), or install [GitHub Desktop](https://desktop.github.com) for a
point-and-click alternative to the commands above.

### Step 2: deploy the repo on Render

The easiest free option that supports WebSockets and doesn't sleep too
aggressively is **Render**.

1. Go to [render.com](https://render.com) and sign up (free, no card
   required for this tier) — easiest is "Sign up with GitHub" so it can see
   your repos right away.
2. Click **New +** → **Web Service**.
3. Find and select the `fish-game` repo you just created.
4. Fill in the settings:
   - **Name**: anything, e.g. `fish-game` (this becomes part of your URL)
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Click **Create Web Service**. Render will build and start it — this
   takes a minute or two the first time. When it's done, you'll see a URL
   at the top of the page like `https://fish-game-abcd.onrender.com`.
   That's the link you send to friends.

Note on the free tier: the service spins down after ~15 minutes of no
traffic and takes 30-60 seconds to wake back up on the next visit. Fine for
casual play — just give it a moment to load if it's been idle. If that's
annoying, alternatives with similar free tiers are [Fly.io](https://fly.io)
and [Glitch](https://glitch.com) (Glitch is the least setup of all — you
can literally import straight from your GitHub repo, no separate host
signup needed).

## How a game works

- **Play vs Bots** — instantly playable, fills the other 5 seats with bots.
- **Create Room** — you become the host and get a 5-character code.
- **Join Room** — enter a friend's code to take an open seat. The host can
  fill any remaining empty seats with bots and starts the game when ready.

Refreshing the page won't kick you out — it reconnects you to your seat
automatically (your browser remembers who you are via `localStorage`).

## Project layout

```
server.js       Express + Socket.io server — rooms, turns, the authoritative
                game state (including everyone's hands)
engine.js       Pure game rules: deck/sets, legal moves, ask/declare/pass,
                the bot AI (belief tracking + probability-weighted choices)
public/
  index.html    Page shell + styling
  app.js        Client UI, driven entirely by server events
  cards.js      Small display-only helpers shared with the client
                (card labels, set names — no game logic or hidden info)
```

## Extending it

A few natural next steps if you want to keep building:
- Persist rooms to a database (e.g. SQLite or Redis) so a server restart
  doesn't lose in-progress games.
- Add a spectator mode for seat-less friends watching along.
- Add sound/animation for successful steals and declares.
- Rate-limit room creation if you ever open this up publicly.
