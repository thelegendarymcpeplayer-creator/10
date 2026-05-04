# PokeFanIconZ Discord Bot — Railway Deployment Guide

## Step-by-Step: Deploy to Railway in 5 minutes

### 1. Upload to GitHub (one-time setup)
1. Go to https://github.com/new → create a **private** repo (e.g. `pokefanIconZ-bot`)
2. Extract this zip on your computer
3. Open a terminal in the extracted folder and run:
   ```
   git init
   git add .
   git commit -m "Initial deploy"
   git remote add origin https://github.com/YOUR_USERNAME/pokefanIconZ-bot.git
   git push -u origin main
   ```

### 2. Deploy on Railway
1. Go to https://railway.app and log in
2. Click **New Project → Deploy from GitHub repo**
3. Select your `pokefanIconZ-bot` repo
4. Railway will auto-detect the `Dockerfile` and start building

### 3. Set Environment Variables
In Railway, go to your service → **Variables** tab and add:

| Variable | Value |
|----------|-------|
| `DISCORD_TOKEN` | Your bot token (from Discord Developer Portal) |
| `DISCORD_GUILD_ID` | `1454829065466020028` |

> **Where to get your bot token:**
> 1. Go to https://discord.com/developers/applications
> 2. Select your app → **Bot** tab → **Reset Token** → Copy

### 4. Wait for Deploy
Railway will build and deploy automatically (~2 min). Once the status shows **Active**, your bot is live!

---

## Bot Commands Reference

### MCPE Evaluation
| Command | Description |
|---------|-------------|
| `/create-sheet` | Create a full MCPE evaluation sheet (0-100 scoring, tier types, progress bars) |
| `/tier-list` | Create a tier list with S/A/B/C/D rankings |

### Moderation
| Command | Description |
|---------|-------------|
| `/ban` | Ban a member (sends DM first) |
| `/kick` | Kick a member |
| `/timeout` | Timeout a member |
| `/untimeout` | Remove timeout |
| `/unban` | Unban a user |
| `/warn` | Issue a warning |
| `/warnings` | View warnings |
| `/clearwarnings` | Clear all warnings |
| `/nickname` | Change a member's nickname |
| `/lockdown` | Lock all channels |
| `/unlockdown` | Unlock all channels |
| `/purge` | Bulk delete messages |
| `/slowmode` | Set channel slowmode |
| `/role-add` | Add a role to a member |
| `/role-remove` | Remove a role from a member |

### Economy
| Command | Description |
|---------|-------------|
| `/balance` | Check balance |
| `/daily` | Claim daily reward |
| `/shop` | Server shop |
| `/give-ruby` | Give rubies (admin) |
| `/create-code` | Create redeem code |
| `/leaderboard` | Top 10 richest |

### Information
| Command | Description |
|---------|-------------|
| `/userinfo` | Full member info |
| `/serverinfo` | Server statistics |
| `/avatar` | View avatar |
| `/roleinfo` | Role details |
| `/ping` | Bot latency |
| `/botinfo` | Bot stats |
| `/profile` | Combined profile card |
| `/stats` | Message stats |
| `/invites` | Invite tracker |

### Utility
| Command | Description |
|---------|-------------|
| `/math` | Calculator |
| `/color` | Color preview from hex |
| `/say` | Bot sends a message |
| `/announce` | Post announcement embed |
| `/embed` | Build custom embed |
| `/snipe` | Last deleted message |
| `/editsnipe` | Last edited message |
| `/reminder` | Set a personal reminder |
| `/msg-leaderboard` | Most active members |
| `/time` | World clock (autocomplete) |

### Community
| Command | Description |
|---------|-------------|
| `/poll` | Create a poll |
| `/suggestion` | Submit a suggestion |
| `/confession` | Anonymous confession |
| `/birthday set` | Save your birthday |
| `/birthday upcoming` | See upcoming birthdays |
| `/giveaway start/end/reroll` | Full giveaway system |
| `/ticket create/close` | Support tickets |
| `/report` | Report a member |

### Fun
| Command | Description |
|---------|-------------|
| `/coinflip` | Heads or tails |
| `/8ball` | Magic 8-ball |
| `/meme` | Random meme |

### Prefix Commands
| Command | Description |
|---------|-------------|
| `$afk [reason]` | Set AFK status |
| `$time [country]` | World clock |

### Admin Setup
| Command | Description |
|---------|-------------|
| `/set-welcome-channel` | Set welcome channel |
| `/set-report-channel` | Set report channel |
| `/set-suggestion-channel` | Set suggestion channel |
| `/set-confession-channel` | Set confession channel |
| `/set-ticket-category` | Set ticket category |

---

## Bot Invite Link
```
https://discord.com/oauth2/authorize?client_id=1483121399127347362&permissions=8&scope=bot%20applications.commands
```

## Notes
- Bot data (economy, warnings, etc.) is stored in `bot-data/store.json`
- To persist data across Railway redeploys, add a **Railway Volume** mounted at `/app/bot-data`
- Slash commands register globally on startup (~1 hour to propagate) or instantly if `DISCORD_GUILD_ID` is set
