# PokeFanIconZ Discord Bot

A Discord bot for MCPE tier testing and server management, deployable on Railway.

## 🚀 Deploy on Railway

1. **Extract** this zip into a folder
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub (or drag the folder)
3. In the **Variables** tab, set:
   - `DISCORD_TOKEN` — your bot token from the [Discord Developer Portal](https://discord.com/developers/applications)
   - `DISCORD_GUILD_ID` — your server ID (optional but recommended for instant command sync)
4. Railway will automatically build and start the bot using the Dockerfile

## ⚙️ First-Time Server Setup (Admin commands)

| Command | What it does |
|---|---|
| `/set-tier-channel #channel` | Where tier evaluation results are posted |
| `/set-tier-tester-role @role` | **Server owner only** — who can use `/dm-user` and `/dm-all` |
| `/set-report-channel #channel` | Where member reports go |
| `/set-welcome-channel #channel` | Where welcome messages are sent |
| `/set-suggestion-channel #channel` | Where suggestions are posted |
| `/set-confession-channel #channel` | Where anonymous confessions go |
| `/set-ticket-category #category` | Category for support ticket channels |

## 🎮 Tier Testing — `/create-sheet`

**Usage:** `/create-sheet @player server:Hive [result_channel:#channel] [dm_user2:@user] [dm_user3:@user]`

A modal will open with 5 fields:
1. **Game Name** — e.g. SkyWars, Crystal PvP
2. **Game Mode Results** — one per line: `SkyWars: 85`
3. **Student Info** — playtime, rank, other player info
4. **Tier Tester Notes** — your evaluation and recommendations
5. **Tier Override** — optionally force a grade: S / A / B / C / D / F

Results are:
- Posted in the configured tier channel (or the `result_channel` override)
- DM'd to the evaluated player + up to 2 extra users

The result embed shows:
- Player's avatar and name at the top
- Game mode scores with progress bars and grades side by side
- Overall average grade
- All tier tester notes

## 🔐 Permissions

- **`/set-tier-tester-role`** — only the **server owner** can run this
- **`/dm-user`** and **`/dm-all`** — require the tier tester role (if set)
- All other admin commands require the `Administrator` or `ManageMessages` Discord permission

## 📦 Data

Bot data is stored in `bot-data/` as JSON files. When deploying on Railway, use a **Volume** mounted at `/app/bot-data` to persist data across restarts:
- Railway → Service → Volumes → Add Volume → Mount path: `/app/bot-data`

## 🤖 All Commands

### Tier Testing
- `/create-sheet` `/tier-list` `/set-tier-channel` `/set-tier-tester-role`

### DM
- `/dm-user` `/dm-all` `/dm-role`

### Moderation
- `/warn` `/warnings` `/clearwarnings` `/timeout` `/untimeout` `/ban` `/unban` `/kick` `/nickname` `/purge` `/slowmode` `/lockdown` `/unlockdown` `/role-add` `/role-remove`

### Info & Utility
- `/userinfo` `/serverinfo` `/avatar` `/roleinfo` `/ping` `/botinfo` `/profile` `/stats` `/invites`

### Economy
- `/balance` `/daily` `/give-ruby` `/leaderboard` `/msg-leaderboard` `/shop` `/create-code`

### Fun & Social
- `/poll` `/announce` `/say` `/embed` `/snipe` `/editsnipe` `/reminder` `/giveaway` `/ticket` `/math` `/color` `/birthday` `/suggestion` `/confession` `/coinflip` `/8ball` `/meme` `/time`
