// PokeFanIconZ Discord Bot v3.0
import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, ChannelType
} from 'discord.js';
import fs   from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '..', 'bot-data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── PERSISTENT DATA ─────────────────────────────────────────────────────────
function loadJson(file, def = {}) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return typeof def === 'function' ? def() : JSON.parse(JSON.stringify(def)); }
}
function saveJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

let guildConfigs  = loadJson('guild-configs.json');
let warnings      = loadJson('warnings.json');
let economy       = loadJson('economy.json');
let dailyClaims   = loadJson('daily-claims.json');
let shopCodes     = loadJson('shop-codes.json');
let msgStats      = loadJson('msg-stats.json');
let xpData        = loadJson('xp-data.json');
let birthdays     = loadJson('birthdays.json');
let reminders     = loadJson('reminders.json');
let tierHistory   = loadJson('tier-history.json');
let ytMonitors    = loadJson('yt-monitors.json');   // { guildId: { channelId, ytChannelId, ytHandle, lastVideoId, discordChannelId } }
let customCmds    = loadJson('custom-cmds.json');   // { guildId: { name: { response, embed } } }
let stickyMsgs    = loadJson('sticky-msgs.json');   // { channelId: { content, lastMsgId } }
let reactionRoles = loadJson('reaction-roles.json');// { guildId: [{ messageId, channelId, emoji, roleId }] }
let afkUsers      = loadJson('afk-users.json');     // { userId: { reason, since } }
let tags          = loadJson('tags.json');           // { guildId: { name: { content, author } } }
let giveaways     = loadJson('giveaways.json');     // { messageId: { ... } }
let partnerships  = loadJson('partnerships.json');  // { guildId: [entry] }
let serverRules   = loadJson('server-rules.json');  // { guildId: rules[] }
let statChannels  = loadJson('stat-channels.json'); // { guildId: { memberChanId, onlineChanId, botChanId } }
let snipeCache    = {};
let editSnipe     = {};
let msgCooldown   = new Map();

function getGuildCfg(gid) {
  if (!guildConfigs[gid]) guildConfigs[gid] = {};
  return guildConfigs[gid];
}
function saveGuildCfg() { saveJson('guild-configs.json', guildConfigs); }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const MCPE_SERVERS = ['Hive','CubeCraft','Zeqa','Mineplex','Galaxite','NetherGames','Custom'];
const INVITE_LINK  = 'https://discord.gg/55urXdkXqc';

function progressBar(score, len = 10) {
  const s = Math.max(0, Math.min(100, score));
  const f = Math.round(s / 10);
  return '█'.repeat(f) + '░'.repeat(len - f);
}
function getGrade(score) {
  if (score >= 90) return { letter:'S', label:'Legendary',     color:'#FFD700' };
  if (score >= 80) return { letter:'A', label:'Excellent',     color:'#5865F2' };
  if (score >= 70) return { letter:'B', label:'Good',          color:'#57F287' };
  if (score >= 60) return { letter:'C', label:'Average',       color:'#FEE75C' };
  if (score >= 50) return { letter:'D', label:'Below Average', color:'#ED4245' };
  return                   { letter:'F', label:'Poor',          color:'#99AAB5' };
}
const GRADE_COLORS = { S:'#FFD700', A:'#5865F2', B:'#57F287', C:'#FEE75C', D:'#ED4245', F:'#99AAB5' };
function parseMs(str) {
  const m = /^(\d+)(s|m|h|d)$/i.exec((str ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1]);
  return { s:1000, m:60000, h:3600000, d:86400000 }[m[2].toLowerCase()] * n;
}
function fmtMs(ms) {
  if (ms < 60000) return `${Math.floor(ms/1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms/60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h`;
  return `${Math.floor(ms/86400000)}d`;
}
function hexToInt(hex) {
  const n = parseInt((hex ?? '').replace('#',''), 16);
  return isNaN(n) ? 0x5865F2 : n;
}
function getBal(uid) {
  if (!economy[uid]) economy[uid] = { emeralds:0, rubies:0 };
  return economy[uid];
}
function getXP(uid) {
  if (!xpData[uid]) xpData[uid] = { xp:0, level:0 };
  return xpData[uid];
}
function xpForLevel(lvl) { return Math.floor(100 * Math.pow(1.3, lvl)); }
function isServerOwner(interaction) { return interaction.guild?.ownerId === interaction.user.id; }
function hasTierTesterRole(interaction) {
  const cfg = getGuildCfg(interaction.guildId);
  if (!cfg.tierTesterRoleId) return true;
  return !!interaction.member?.roles?.cache?.has(cfg.tierTesterRoleId);
}

// Safe option getters — never throw regardless of command version
function sg(i, n)  { try { return i.options.getString(n);  } catch { return null; } }
function su(i, n)  { try { return i.options.getUser(n);    } catch { return null; } }
function sch(i, n) { try { return i.options.getChannel(n); } catch { return null; } }
function sr(i, n)  { try { return i.options.getRole(n);    } catch { return null; } }
function si(i, n)  { try { return i.options.getInteger(n); } catch { return null; } }
function sb(i, n)  { try { return i.options.getBoolean(n); } catch { return null; } }

// Build DM embed from guild template
function buildCustomEmbed(template, vars = {}) {
  if (!template) return null;
  let desc = template.description ?? '';
  let title = template.title ?? '';
  for (const [k, v] of Object.entries(vars)) {
    desc  = desc.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    title = title.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  if (template.embed === false) return { content: `${title ? `**${title}**\n` : ''}${desc}` };
  const emb = new EmbedBuilder().setColor(hexToInt(template.color ?? null)).setTimestamp();
  if (title) emb.setTitle(title);
  emb.setDescription(desc);
  if (template.footer) emb.setFooter({ text: template.footer });
  if (template.gifUrl) emb.setImage(template.gifUrl);
  return { embeds: [emb] };
}

async function sendModDM(client, userId, template, vars) {
  try {
    const u = await client.users.fetch(userId).catch(() => null);
    if (!u) return false;
    const payload = template ? buildCustomEmbed(template, vars) : null;
    if (payload) await u.send(payload).catch(() => {});
    return true;
  } catch { return false; }
}

async function logMod(guild, cfg, embed) {
  if (!cfg.logChannelId) return;
  try {
    const ch = await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (ch?.isTextBased()) await ch.send({ embeds: [embed] });
  } catch {}
}

// ─── COMMANDS REGISTRY ───────────────────────────────────────────────────────
const commands = [
  // ── Tier Testing ──
  new SlashCommandBuilder().setName('create-sheet').setDescription('Create a tier evaluation sheet')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('player').setDescription('Player to evaluate').setRequired(true))
    .addStringOption(o => o.setName('server').setDescription('MCPE server').setRequired(true).addChoices(...MCPE_SERVERS.map(s=>({name:s,value:s}))))
    .addChannelOption(o => o.setName('post_channel').setDescription('Override tier channel'))
    .addUserOption(o => o.setName('also_dm_1').setDescription('Extra DM recipient'))
    .addUserOption(o => o.setName('also_dm_2').setDescription('Extra DM recipient 2')),
  new SlashCommandBuilder().setName('tier-history').setDescription("View a player's past tier evaluations")
    .addUserOption(o => o.setName('player').setDescription('Player to look up').setRequired(true)),
  new SlashCommandBuilder().setName('tier-list').setDescription('Create an MCPE tier list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('title').setDescription('Title'))
    .addBooleanOption(o => o.setName('public').setDescription('Post publicly?')),
  new SlashCommandBuilder().setName('set-tier-channel').setDescription('Set default tier results channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),
  new SlashCommandBuilder().setName('set-tier-tester-role').setDescription('Set Tier Tester role (Server Owner only)')
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),

  // ── YouTube ──
  new SlashCommandBuilder().setName('yt').setDescription('YouTube notification system (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('link').setDescription('Link a YouTube channel')
      .addStringOption(o => o.setName('channel_id').setDescription('YouTube Channel ID (starts with UC...)').setRequired(true))
      .addChannelOption(o => o.setName('discord_channel').setDescription('Discord channel for notifications').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove YouTube monitoring'))
    .addSubcommand(s => s.setName('status').setDescription('Show current YouTube monitor status')),

  // ── Logging ──
  new SlashCommandBuilder().setName('set-log-channel').setDescription('Set moderation log channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Log channel').setRequired(true)),

  // ── Customizable Messages ──
  new SlashCommandBuilder().setName('customize').setDescription('Customize bot messages for warns/bans/kicks/DMs (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('warn-msg').setDescription('Customize the DM sent when a user is warned'))
    .addSubcommand(s => s.setName('ban-msg').setDescription('Customize the DM sent when a user is banned'))
    .addSubcommand(s => s.setName('kick-msg').setDescription('Customize the DM sent when a user is kicked'))
    .addSubcommand(s => s.setName('unban-msg').setDescription('Customize the DM sent when a user is unbanned'))
    .addSubcommand(s => s.setName('dm-template').setDescription('Customize the /dm-user embed template'))
    .addSubcommand(s => s.setName('view').setDescription('View all current message templates'))
    .addSubcommand(s => s.setName('reset').setDescription('Reset all templates to default')
      .addStringOption(o => o.setName('which').setDescription('Which template to reset').addChoices({name:'All',value:'all'},{name:'Warn',value:'warn'},{name:'Ban',value:'ban'},{name:'Kick',value:'kick'},{name:'Unban',value:'unban'},{name:'DM',value:'dm'}))),

  // ── DM ──
  new SlashCommandBuilder().setName('dm-user').setDescription('Send a custom DM to a user (by mention or ID)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('user_id').setDescription('User mention OR User ID (works for users not in server)').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Embed title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text'))
    .addStringOption(o => o.setName('gif_url').setDescription('GIF or image URL to attach')),
  new SlashCommandBuilder().setName('dm-all').setDescription('Mass DM every member (Tier Tester role required)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('message').setDescription('Message body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Embed title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text'))
    .addStringOption(o => o.setName('gif_url').setDescription('GIF or image URL')),
  new SlashCommandBuilder().setName('dm-role').setDescription('DM all members with a specific role')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Embed title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text'))
    .addStringOption(o => o.setName('gif_url').setDescription('GIF or image URL')),

  // ── Moderation ──
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder().setName('warnings').setDescription('View warnings for a member').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear all warnings (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('10m / 2h / 1d (max 28d)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove timeout').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member or user by ID (works even if not in server)').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('User mention OR User ID — works for users not in server').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete messages from N days (0-7)').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID (sends them a DM with server invite)').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('nickname').setDescription('Change or reset a nickname').setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    .addStringOption(o => o.setName('nickname').setDescription('New nickname (leave blank = reset)')),
  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('Messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),
  new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('seconds').setDescription('Seconds (0 = off)').setRequired(true).setMinValue(0).setMaxValue(21600)),
  new SlashCommandBuilder().setName('lockdown').setDescription('Lock all text channels (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('unlockdown').setDescription('Lift lockdown (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('role-add').setDescription('Add a role to a member').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('role-remove').setDescription('Remove a role from a member').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('bulk-role').setDescription('Add/remove a role from ALL members (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('action').setDescription('add or remove').setRequired(true).addChoices({name:'Add',value:'add'},{name:'Remove',value:'remove'}))
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('audit').setDescription('View recent moderation audit log').setDefaultMemberPermissions(PermissionFlagsBits.ViewAuditLog)
    .addIntegerOption(o => o.setName('limit').setDescription('Number of entries (1-20)').setMinValue(1).setMaxValue(20)),

  // ── Reports / Server Setup ──
  new SlashCommandBuilder().setName('report').setDescription('Report a member to the mod team')
    .addUserOption(o => o.setName('user').setDescription('Member to report').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .addAttachmentOption(o => o.setName('proof').setDescription('Proof image')),
  new SlashCommandBuilder().setName('set-report-channel').setDescription('Set report channel (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('set-welcome-channel').setDescription('Set welcome channel (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('set-autorole').setDescription('Auto-assign role when a member joins (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName('role').setDescription('Role to auto-assign (leave empty to disable)').setRequired(false)),

  // ── Info ──
  new SlashCommandBuilder().setName('invites').setDescription("Check a member's invite stats")
    .addUserOption(o => o.setName('user').setDescription('Member to check')),
  new SlashCommandBuilder().setName('userinfo').setDescription('View info about a member')
    .addUserOption(o => o.setName('user').setDescription('Member')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('View server information'),
  new SlashCommandBuilder().setName('avatar').setDescription("View a user's avatar")
    .addUserOption(o => o.setName('user').setDescription('Member')),
  new SlashCommandBuilder().setName('roleinfo').setDescription('View info about a role')
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)),
  new SlashCommandBuilder().setName('lookup').setDescription('Look up any Discord user globally by their User ID')
    .addStringOption(o => o.setName('user_id').setDescription('Discord User ID').setRequired(true)),
  new SlashCommandBuilder().setName('ping').setDescription("Check the bot's latency"),
  new SlashCommandBuilder().setName('botinfo').setDescription('View bot info and uptime'),
  new SlashCommandBuilder().setName('profile').setDescription("View a member's profile card")
    .addUserOption(o => o.setName('user').setDescription('Member')),
  new SlashCommandBuilder().setName('stats').setDescription('View message stats').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Member to check')),

  // ── XP / Levels ──
  new SlashCommandBuilder().setName('rank').setDescription('View your XP rank card')
    .addUserOption(o => o.setName('user').setDescription('Member')),
  new SlashCommandBuilder().setName('xp-leaderboard').setDescription('Top 10 members by XP'),
  new SlashCommandBuilder().setName('give-xp').setDescription('Give XP to a member (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('XP amount').setRequired(true).setMinValue(1)),

  // ── Economy ──
  new SlashCommandBuilder().setName('balance').setDescription('Check your balance')
    .addUserOption(o => o.setName('user').setDescription('Check another user')),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily 200 💎 Emeralds'),
  new SlashCommandBuilder().setName('give-ruby').setDescription('Give rubies to a member (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 richest members'),
  new SlashCommandBuilder().setName('msg-leaderboard').setDescription('Top 10 most active members'),
  new SlashCommandBuilder().setName('shop').setDescription('Open the server shop')
    .addSubcommand(s => s.setName('menu').setDescription('Browse shop'))
    .addSubcommand(s => s.setName('create-role').setDescription('Buy a custom role (2,500 💎)')
      .addStringOption(o => o.setName('name').setDescription('Role name').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color e.g. #ff0000').setRequired(true)))
    .addSubcommand(s => s.setName('redeem').setDescription('Redeem a code')
      .addStringOption(o => o.setName('code').setDescription('Code').setRequired(true))),
  new SlashCommandBuilder().setName('create-code').setDescription('Create a reward code (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('code').setDescription('Code string').setRequired(true))
    .addIntegerOption(o => o.setName('emeralds').setDescription('Emeralds reward').setMinValue(0))
    .addIntegerOption(o => o.setName('rubies').setDescription('Rubies reward').setMinValue(0))
    .addIntegerOption(o => o.setName('max_uses').setDescription('Max uses (default 1)').setMinValue(1)),

  // ── Tags / Custom Commands ──
  new SlashCommandBuilder().setName('tag').setDescription('Quick response tags').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('use').setDescription('Use a tag').addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('create').setDescription('Create a tag')
      .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true))
      .addStringOption(o => o.setName('content').setDescription('Tag content').setRequired(true)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a tag')
      .addStringOption(o => o.setName('name').setDescription('Tag name').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all tags')),

  // ── Reaction Roles ──
  new SlashCommandBuilder().setName('reaction-role').setDescription('Reaction role management').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('add').setDescription('Add a reaction role')
      .addStringOption(o => o.setName('message_id').setDescription('Message ID to add reaction to').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel containing the message').setRequired(false)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a reaction role')
      .addStringOption(o => o.setName('message_id').setDescription('Message ID').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List all reaction roles')),

  // ── AFK ──
  new SlashCommandBuilder().setName('afk').setDescription('Set or remove your AFK status')
    .addSubcommand(s => s.setName('set').setDescription('Set AFK status').addStringOption(o => o.setName('reason').setDescription('Reason (optional)')))
    .addSubcommand(s => s.setName('remove').setDescription('Remove your AFK status')),

  // ── Sticky Messages ──
  new SlashCommandBuilder().setName('sticky').setDescription('Pin a sticky message in the current channel (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('set').setDescription('Set a sticky message').addStringOption(o => o.setName('content').setDescription('Message content').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove the sticky message')),

  // ── Server Stats Channels ──
  new SlashCommandBuilder().setName('server-stats').setDescription('Setup live stat channels (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('setup').setDescription('Create live member/bot count voice channels'))
    .addSubcommand(s => s.setName('remove').setDescription('Remove stat channels')),

  // ── Server Rules ──
  new SlashCommandBuilder().setName('rules').setDescription('Server rules management').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName('show').setDescription('Display server rules'))
    .addSubcommand(s => s.setName('set').setDescription('Set the server rules (Admin)'))
    .addSubcommand(s => s.setName('add').setDescription('Add a rule (Admin)')
      .addStringOption(o => o.setName('rule').setDescription('Rule text').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a rule by number (Admin)')
      .addIntegerOption(o => o.setName('number').setDescription('Rule number to remove').setRequired(true).setMinValue(1))),

  // ── Partnerships ──
  new SlashCommandBuilder().setName('partnership').setDescription('Partnership advertisement system').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('post').setDescription('Post a partnership ad')
      .addStringOption(o => o.setName('server_name').setDescription('Partner server name').setRequired(true))
      .addStringOption(o => o.setName('invite').setDescription('Server invite link').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('About the server').setRequired(true))
      .addStringOption(o => o.setName('banner').setDescription('Banner image URL')))
    .addSubcommand(s => s.setName('set-channel').setDescription('Set partnership channel')
      .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))),

  // ── Utility ──
  new SlashCommandBuilder().setName('poll').setDescription('Create a voting poll')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption(o => o.setName('option1').setDescription('Option 1'))
    .addStringOption(o => o.setName('option2').setDescription('Option 2'))
    .addStringOption(o => o.setName('option3').setDescription('Option 3'))
    .addStringOption(o => o.setName('option4').setDescription('Option 4')),
  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement embed').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('gif_url').setDescription('GIF/image URL')),
  new SlashCommandBuilder().setName('say').setDescription('Have the bot say a message').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),
  new SlashCommandBuilder().setName('embed').setDescription('Build and send a custom embed (opens a form)').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('snipe').setDescription('Show the last deleted message'),
  new SlashCommandBuilder().setName('editsnipe').setDescription('Show the last edited message'),
  new SlashCommandBuilder().setName('reminder').setDescription('Set a personal reminder')
    .addStringOption(o => o.setName('time').setDescription('Duration: 10s / 30m / 2h / 1d').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Reminder message').setRequired(true)),
  new SlashCommandBuilder().setName('giveaway').setDescription('Giveaway management').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('start').setDescription('Start a giveaway')
      .addStringOption(o => o.setName('prize').setDescription('Prize').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration: 10m / 1h / 7d').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(10))
      .addChannelOption(o => o.setName('channel').setDescription('Channel')))
    .addSubcommand(s => s.setName('end').setDescription('End a giveaway early')
      .addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand(s => s.setName('reroll').setDescription('Reroll winners')
      .addStringOption(o => o.setName('message_id').setDescription('Giveaway message ID').setRequired(true))),
  new SlashCommandBuilder().setName('ticket').setDescription('Support ticket system')
    .addSubcommand(s => s.setName('create').setDescription('Open a support ticket').addStringOption(o => o.setName('reason').setDescription('Reason')))
    .addSubcommand(s => s.setName('close').setDescription('Close this ticket')),
  new SlashCommandBuilder().setName('topic').setDescription('Set the topic of the current channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(o => o.setName('text').setDescription('New channel topic (blank = random)')),
  new SlashCommandBuilder().setName('math').setDescription('Calculate a math expression')
    .addStringOption(o => o.setName('expression').setDescription('e.g. 25 * 4 + 10 / 2').setRequired(true)),
  new SlashCommandBuilder().setName('color').setDescription('Preview a hex color')
    .addStringOption(o => o.setName('hex').setDescription('Hex color e.g. #ff0000').setRequired(true)),
  new SlashCommandBuilder().setName('weather').setDescription('Check the weather in any city')
    .addStringOption(o => o.setName('city').setDescription('City name').setRequired(true)),
  new SlashCommandBuilder().setName('translate').setDescription('Translate text to any language')
    .addStringOption(o => o.setName('text').setDescription('Text to translate').setRequired(true))
    .addStringOption(o => o.setName('to').setDescription('Target language e.g. es, fr, ja, de, zh').setRequired(true)),
  new SlashCommandBuilder().setName('qr').setDescription('Generate a QR code for any URL or text')
    .addStringOption(o => o.setName('content').setDescription('URL or text').setRequired(true)),
  new SlashCommandBuilder().setName('fact').setDescription('Get a random interesting fact'),
  new SlashCommandBuilder().setName('quote').setDescription('Get a random inspirational quote'),
  new SlashCommandBuilder().setName('birthday').setDescription('Birthday system')
    .addSubcommand(s => s.setName('set').setDescription('Save your birthday')
      .addIntegerOption(o => o.setName('month').setDescription('Month (1-12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption(o => o.setName('day').setDescription('Day (1-31)').setRequired(true).setMinValue(1).setMaxValue(31)))
    .addSubcommand(s => s.setName('upcoming').setDescription('View upcoming birthdays')),
  new SlashCommandBuilder().setName('suggestion').setDescription('Submit a suggestion')
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true)),
  new SlashCommandBuilder().setName('confession').setDescription('Post an anonymous confession')
    .addStringOption(o => o.setName('message').setDescription('Your message').setRequired(true)),
  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin'),
  new SlashCommandBuilder().setName('8ball').setDescription('Ask the Magic 8-Ball')
    .addStringOption(o => o.setName('question').setDescription('Your yes/no question').setRequired(true)),
  new SlashCommandBuilder().setName('meme').setDescription('Fetch a random meme'),
  new SlashCommandBuilder().setName('time').setDescription('Check the time in any country')
    .addStringOption(o => o.setName('country').setDescription('Country name').setRequired(true)),

  // ── Admin Setup ──
  new SlashCommandBuilder().setName('set-suggestion-channel').setDescription('Set suggestion channel (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('set-confession-channel').setDescription('Set confession channel (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),
  new SlashCommandBuilder().setName('set-ticket-category').setDescription('Set ticket category (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('category').setDescription('Category channel').setRequired(true)),
].map(c => c.toJSON());

// ─── SESSION MAPS ─────────────────────────────────────────────────────────────
const pendingSheets    = new Map();
const pendingTierLists = new Map();
const pendingEmbeds    = new Map();
const pendingCustomize = new Map();
const pendingRules     = new Map();

// ─── CREATE-SHEET ─────────────────────────────────────────────────────────────
async function handleCreateSheet(interaction) {
  const player = su(interaction,'player') ?? su(interaction,'user');
  if (!player) { await interaction.reply({ content:'❌ Could not find the player option.', ephemeral:true }); return; }
  const server = sg(interaction,'server') ?? sg(interaction,'category') ?? 'Custom';
  pendingSheets.set(interaction.id, {
    targetUserId: player.id, server,
    postChannelId: sch(interaction,'post_channel')?.id ?? null,
    alsoDm1Id: su(interaction,'also_dm_1')?.id ?? null,
    alsoDm2Id: su(interaction,'also_dm_2')?.id ?? null,
    givenBy: interaction.member?.displayName ?? interaction.user.username,
    guildId: interaction.guildId,
  });
  const modal = new ModalBuilder().setCustomId(`sheet_${interaction.id}`).setTitle(`📋 Tier Test — ${player.username} on ${server}`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('game').setLabel('Game  (e.g. SkyWars, BedWars, Sumo)').setStyle(TextInputStyle.Short).setPlaceholder('Type the game name here...').setRequired(true).setMaxLength(60)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('mode_marks').setLabel('Game Modes & Marks  (Mode: score  per line)').setStyle(TextInputStyle.Paragraph).setPlaceholder('SkyWars: 85\nBedWars: 72\nSumo: 90\nCrystal PvP: 68\n\n(one game mode per line)').setRequired(true).setMaxLength(800)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('notes').setLabel('Tier Tester Notes & Feedback').setStyle(TextInputStyle.Paragraph).setPlaceholder('Write your evaluation, tips, recommendations...').setRequired(false).setMaxLength(600)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('student_info').setLabel('Student Info  (rank, playtime, device etc.)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. Diamond rank • 300h • Mobile').setRequired(false).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tier_override').setLabel('Override Grade  (S/A/B/C/D/F — optional)').setStyle(TextInputStyle.Short).setPlaceholder('Leave blank = auto-calculated from marks').setRequired(false).setMaxLength(2))
  );
  await interaction.showModal(modal);
}

async function handleSheetModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const id  = interaction.customId.replace('sheet_','');
  const ctx = pendingSheets.get(id);
  pendingSheets.delete(id);
  if (!ctx) { await interaction.editReply('❌ Session expired. Please run `/create-sheet` again.'); return; }

  const guild        = interaction.guild;
  const game         = interaction.fields.getTextInputValue('game').trim();
  const modeMarksRaw = interaction.fields.getTextInputValue('mode_marks').trim();
  const notes        = interaction.fields.getTextInputValue('notes').trim() || null;
  const studentInfo  = interaction.fields.getTextInputValue('student_info').trim() || null;
  const tierOvrRaw   = interaction.fields.getTextInputValue('tier_override').trim().toUpperCase();
  const tierOvr      = ['S','A','B','C','D','F'].includes(tierOvrRaw) ? tierOvrRaw : null;

  const parsed = [];
  for (const line of modeMarksRaw.split('\n').map(l=>l.trim()).filter(Boolean).slice(0,12)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const mode  = line.slice(0, idx).trim();
    const score = Math.min(100, Math.max(0, parseInt(line.slice(idx+1).trim(),10) || 0));
    if (mode) parsed.push({ mode, score });
  }
  if (!parsed.length) {
    await interaction.editReply('❌ Could not read game modes.\n\n**Use this format (one per line):**\n```\nSkyWars: 85\nBedWars: 72\nSumo: 90\n```');
    return;
  }

  const targetUser   = await guild.client.users.fetch(ctx.targetUserId).catch(()=>null);
  const targetMember = await guild.members.fetch(ctx.targetUserId).catch(()=>null);
  if (!targetUser) { await interaction.editReply('❌ Could not fetch the player. They may have left the server.'); return; }

  const avg          = Math.round(parsed.reduce((s,e)=>s+e.score,0) / parsed.length);
  const overallGrade = tierOvr ? { letter:tierOvr, label:{S:'Legendary',A:'Excellent',B:'Good',C:'Average',D:'Below Average',F:'Poor'}[tierOvr] } : getGrade(avg);
  const embedColor   = GRADE_COLORS[overallGrade.letter] ?? '#5865F2';
  const acctAge      = Math.floor((Date.now()-targetUser.createdTimestamp)/86400000);
  const joinedAt     = targetMember?.joinedAt ? `<t:${Math.floor(targetMember.joinedAt.getTime()/1000)}:D>` : 'Unknown';
  const serverIcon   = guild.iconURL({ size:256 });

  function fmtModes(list) {
    return list.map(({mode,score})=>{
      const g = getGrade(score);
      return `\`${progressBar(score)}\`\n**${mode}** — **${score}**/100 \`${g.letter}\``;
    }).join('\n\n');
  }
  const half = Math.ceil(parsed.length/2);

  const embed = new EmbedBuilder().setColor(embedColor)
    .setTitle(`🎮 Tier Evaluation — ${ctx.server}`)
    .setAuthor({ name:`${targetUser.username}${targetMember?.nickname?` (${targetMember.nickname})`:''}`, iconURL:targetUser.displayAvatarURL({size:256}) })
    .setThumbnail(targetUser.displayAvatarURL({size:256}))
    .addFields(
      { name:'👤 Player Info', value:[`**Name:** ${targetUser.username}`,`**Mention:** ${targetUser}`,`**ID:** \`${targetUser.id}\``,`**Account Age:** ${acctAge}d`,`**Joined Server:** ${joinedAt}`,studentInfo?`**Info:** ${studentInfo}`:null].filter(Boolean).join('\n'), inline:true },
      { name:'📋 Evaluation Info', value:[`**Server:** ${ctx.server}`,`**Game:** ${game}`,`**Tier Tester:** ${ctx.givenBy}`,`**Date:** <t:${Math.floor(Date.now()/1000)}:D>`,`**Modes Tested:** ${parsed.length}`].join('\n'), inline:true },
      { name:'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', value:' ', inline:false },
      { name:'📊 Game Mode Marks', value:fmtModes(parsed.slice(0,half))||'\u200B', inline:true }
    );
  if (parsed.length > half) embed.addFields({ name:'\u200B', value:fmtModes(parsed.slice(half)), inline:true });
  embed.addFields(
    { name:'━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', value:' ', inline:false },
    { name:'🏁 Overall Result', value:[`\`${progressBar(avg)}\``,`**Average Score:** ${avg}/100`,`**Overall Grade:** \`${overallGrade.letter}\` — ${overallGrade.label}`,tierOvr?'*(Grade manually overridden by tier tester)*':''].filter(Boolean).join('\n'), inline:false }
  );
  if (notes) embed.addFields({ name:'📝 Tier Tester Notes', value:notes, inline:false });
  embed.setFooter({ text:`${guild.name} · Tier Evaluation · by ${ctx.givenBy}`, iconURL:serverIcon??undefined }).setTimestamp();

  // Post to tier channel
  const cfg = getGuildCfg(guild.id);
  const channelId = ctx.postChannelId ?? cfg.tierChannelId ?? null;
  let postedLink = null;
  if (channelId) {
    try {
      const ch = await guild.channels.fetch(channelId).catch(()=>null);
      if (ch?.isTextBased()) {
        const msg = await ch.send({ content:`📋 New tier evaluation for ${targetUser}!`, embeds:[embed] });
        postedLink = `https://discord.com/channels/${guild.id}/${ch.id}/${msg.id}`;
      }
    } catch {}
  }

  // DM recipients
  const dmIds = [ctx.targetUserId, ctx.alsoDm1Id, ctx.alsoDm2Id].filter(Boolean);
  const dmResults = [];
  for (const uid of dmIds) {
    try {
      const u = await guild.client.users.fetch(uid).catch(()=>null);
      if (!u) { dmResults.push(`⚠️ Could not find \`${uid}\``); continue; }
      await u.send({ content:`📋 You received a **Tier Evaluation** result from **${guild.name}**!`, embeds:[embed] });
      dmResults.push(`✅ DM sent to **${u.username}**`);
    } catch { dmResults.push(`⚠️ Could not DM <@${uid}> — DMs may be closed.`); }
  }

  // Save to tier history
  if (!tierHistory[ctx.targetUserId]) tierHistory[ctx.targetUserId] = [];
  tierHistory[ctx.targetUserId].push({
    guildId:guild.id, guildName:guild.name, server:ctx.server, game, avg, grade:overallGrade.letter,
    modes:parsed, notes, studentInfo, byName:ctx.givenBy, at:Date.now(), postedLink
  });
  if (tierHistory[ctx.targetUserId].length > 50) tierHistory[ctx.targetUserId] = tierHistory[ctx.targetUserId].slice(-50);
  saveJson('tier-history.json', tierHistory);

  const reply = ['✅ **Evaluation sheet created!**'];
  if (postedLink) reply.push(`📢 Posted → [Jump to message](${postedLink})`);
  else reply.push(`⚠️ No tier channel set. Use \`/set-tier-channel\` or pass \`post_channel\` to post publicly.`);
  reply.push(...dmResults);
  await interaction.editReply(reply.join('\n'));
}

// ─── CUSTOMIZE MESSAGES ───────────────────────────────────────────────────────
const CUSTOMIZE_VARS = {
  warn:  '`{user}` `{reason}` `{server}` `{count}` (warning count)',
  ban:   '`{user}` `{reason}` `{server}`',
  kick:  '`{user}` `{reason}` `{server}`',
  unban: '`{user}` `{server}` `{invite}`',
  dm:    '`{user}` `{server}` `{title}` `{message}`',
};

async function handleCustomize(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'view') {
    await interaction.deferReply({ ephemeral:true });
    const cfg = getGuildCfg(interaction.guildId);
    const t   = cfg.msgTemplates ?? {};
    const lines = ['**Current Message Templates:**',''];
    for (const key of ['warn','ban','kick','unban','dm']) {
      const tmpl = t[key];
      if (!tmpl) { lines.push(`**${key.toUpperCase()}:** *Using default*`); continue; }
      lines.push(`**${key.toUpperCase()}:** ${tmpl.embed===false?'Text':'Embed'} · Title: *${tmpl.title||'none'}*`);
    }
    await interaction.editReply(lines.join('\n'));
    return;
  }
  if (sub === 'reset') {
    await interaction.deferReply({ ephemeral:true });
    const which = sg(interaction,'which') ?? 'all';
    const cfg   = getGuildCfg(interaction.guildId);
    if (!cfg.msgTemplates) cfg.msgTemplates = {};
    if (which === 'all') { cfg.msgTemplates = {}; }
    else                 { delete cfg.msgTemplates[which]; }
    saveGuildCfg();
    await interaction.editReply(`✅ **${which === 'all' ? 'All templates' : `\`${which}\` template`}** reset to default.`);
    return;
  }

  const keyMap = { 'warn-msg':'warn', 'ban-msg':'ban', 'kick-msg':'kick', 'unban-msg':'unban', 'dm-template':'dm' };
  const key    = keyMap[sub] ?? 'warn';
  const cfg    = getGuildCfg(interaction.guildId);
  const tmpl   = cfg.msgTemplates?.[key] ?? {};

  pendingCustomize.set(interaction.id, { key, guildId:interaction.guildId });
  const modal = new ModalBuilder().setCustomId(`customize_${interaction.id}`).setTitle(`Customize ${key.toUpperCase()} Message`);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('style').setLabel('Style: "embed" or "text"').setStyle(TextInputStyle.Short).setPlaceholder('embed').setValue(tmpl.embed===false?'text':'embed').setRequired(true).setMaxLength(5)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title (supports variables)').setStyle(TextInputStyle.Short).setPlaceholder('e.g. You have been warned in {server}').setValue(tmpl.title??'').setRequired(false).setMaxLength(256)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel(`Body — variables: ${CUSTOMIZE_VARS[key]}`).setStyle(TextInputStyle.Paragraph).setPlaceholder('**Reason:** {reason}\n\nPlease follow our server rules.').setValue(tmpl.description??'').setRequired(true).setMaxLength(1500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color_gif').setLabel('Hex color & GIF URL  (color | gif_url)').setStyle(TextInputStyle.Short).setPlaceholder('#FEE75C | https://media.giphy.com/...').setValue(`${tmpl.color??''}${tmpl.gifUrl?` | ${tmpl.gifUrl}`:''}`).setRequired(false).setMaxLength(300)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Footer text').setStyle(TextInputStyle.Short).setPlaceholder('Please follow our rules!').setValue(tmpl.footer??'').setRequired(false).setMaxLength(200))
  );
  await interaction.showModal(modal);
}

async function handleCustomizeModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral:true });
  const id  = interaction.customId.replace('customize_','');
  const ctx = pendingCustomize.get(id);
  pendingCustomize.delete(id);
  if (!ctx) { await interaction.editReply('❌ Session expired.'); return; }

  const style    = interaction.fields.getTextInputValue('style').trim().toLowerCase();
  const title    = interaction.fields.getTextInputValue('title').trim() || null;
  const desc     = interaction.fields.getTextInputValue('description').trim();
  const colorGif = interaction.fields.getTextInputValue('color_gif').trim();
  const footer   = interaction.fields.getTextInputValue('footer').trim() || null;

  const [rawColor, rawGif] = colorGif.split('|').map(s=>s.trim());
  const color  = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '#5865F2';
  const gifUrl = rawGif?.startsWith('http') ? rawGif : null;

  const cfg = getGuildCfg(ctx.guildId);
  if (!cfg.msgTemplates) cfg.msgTemplates = {};
  cfg.msgTemplates[ctx.key] = { embed: style !== 'text', title, description:desc, color, gifUrl, footer };
  saveGuildCfg();

  // Preview
  const vars = { user:'ExampleUser', reason:'Test reason', server:'Your Server', count:'3', invite:INVITE_LINK, message:'Test message', title:title??'' };
  const preview = buildCustomEmbed(cfg.msgTemplates[ctx.key], vars);
  const lines   = [`✅ **${ctx.key.toUpperCase()} message customized!**\n`, '**Preview:**'];
  await interaction.editReply({ content:lines.join('\n'), ...(preview.embeds ? preview : {}), ...(preview.content ? { content:`${lines.join('\n')}\n\n${preview.content}` } : {}) });
}

// ─── RULES MODAL ─────────────────────────────────────────────────────────────
async function handleRulesSet(interaction) {
  const existing = (serverRules[interaction.guildId] ?? []).join('\n');
  pendingRules.set(interaction.id, { guildId:interaction.guildId });
  const modal = new ModalBuilder().setCustomId(`rules_${interaction.id}`).setTitle('Set Server Rules');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('rules').setLabel('Rules (one per line)').setStyle(TextInputStyle.Paragraph).setPlaceholder('Be respectful.\nNo spamming.\nFollow Discord ToS.').setValue(existing).setRequired(true).setMaxLength(4000))
  );
  await interaction.showModal(modal);
}

async function handleRulesModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral:true });
  const id  = interaction.customId.replace('rules_','');
  const ctx = pendingRules.get(id);
  pendingRules.delete(id);
  if (!ctx) { await interaction.editReply('❌ Session expired.'); return; }
  const lines = interaction.fields.getTextInputValue('rules').split('\n').map(l=>l.trim()).filter(Boolean);
  serverRules[ctx.guildId] = lines;
  saveJson('server-rules.json', serverRules);
  await interaction.editReply(`✅ ${lines.length} rule${lines.length!==1?'s':''} saved!`);
}

// ─── TIER-LIST MODAL ──────────────────────────────────────────────────────────
async function handleTierList(interaction) {
  const title = sg(interaction,'title') ?? 'MCPE Tier List';
  const pub   = sb(interaction,'public') ?? true;
  pendingTierLists.set(interaction.id, { title, pub });
  const modal = new ModalBuilder().setCustomId(`tierlist_${interaction.id}`).setTitle('MCPE Tier List');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('s').setLabel('🌟 S Tier (90-100)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('a').setLabel('🔴 A Tier (80-89)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('b').setLabel('🟠 B Tier (70-79)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('c').setLabel('🟡 C Tier (60-69)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('d').setLabel('⚫ D/F Tier').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200))
  );
  await interaction.showModal(modal);
}

async function handleTierListModal(interaction) {
  const id  = interaction.customId.replace('tierlist_','');
  const ctx = pendingTierLists.get(id) ?? { title:'MCPE Tier List', pub:true };
  pendingTierLists.delete(id);
  await interaction.deferReply({ ephemeral:!ctx.pub });
  const tiers = [
    { key:'s', label:'S Tier', emoji:'🌟', sub:'Legendary (90-100)' },
    { key:'a', label:'A Tier', emoji:'🔴', sub:'Excellent (80-89)'  },
    { key:'b', label:'B Tier', emoji:'🟠', sub:'Good (70-79)'       },
    { key:'c', label:'C Tier', emoji:'🟡', sub:'Average (60-69)'    },
    { key:'d', label:'D/F Tier', emoji:'⚫', sub:'Below Average/Poor' },
  ];
  const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🏆 ${ctx.title}`).setTimestamp();
  const icon  = interaction.guild?.iconURL({size:256});
  if (icon) embed.setThumbnail(icon);
  let any = false;
  for (const t of tiers) {
    const raw = interaction.fields.getTextInputValue(t.key).trim();
    if (!raw) continue;
    any = true;
    embed.addFields({ name:`${t.emoji} ${t.label} — ${t.sub}`, value:raw.split(',').map(p=>`• **${p.trim()}**`).filter(Boolean).join('\n'), inline:false });
  }
  if (!any) embed.setDescription('No players were added.');
  embed.setFooter({ text:`${interaction.guild?.name} · Tier List`, iconURL:icon??undefined });
  await interaction.editReply({ embeds:[embed] });
}

// ─── EMBED BUILDER ────────────────────────────────────────────────────────────
async function handleEmbedBuilder(interaction) {
  pendingEmbeds.set(interaction.id, { channelId:interaction.channelId });
  const modal = new ModalBuilder().setCustomId(`embed_${interaction.id}`).setTitle('Custom Embed Builder');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setPlaceholder('My Announcement').setRequired(false).setMaxLength(256)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Body').setStyle(TextInputStyle.Paragraph).setPlaceholder('Type your message here...').setRequired(true).setMaxLength(4000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Hex color').setStyle(TextInputStyle.Short).setPlaceholder('#5865f2').setRequired(false).setMaxLength(7)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Footer text').setStyle(TextInputStyle.Short).setPlaceholder('Optional footer').setRequired(false).setMaxLength(2048)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image / GIF URL (optional)').setStyle(TextInputStyle.Short).setPlaceholder('https://...').setRequired(false))
  );
  await interaction.showModal(modal);
}

async function handleEmbedModal(interaction) {
  await interaction.deferReply({ ephemeral:true });
  const id  = interaction.customId.replace('embed_','');
  const ctx = pendingEmbeds.get(id);
  pendingEmbeds.delete(id);
  const title  = interaction.fields.getTextInputValue('title').trim() || null;
  const body   = interaction.fields.getTextInputValue('body').trim();
  const rawCol = interaction.fields.getTextInputValue('color').trim();
  const footer = interaction.fields.getTextInputValue('footer').trim() || null;
  const image  = interaction.fields.getTextInputValue('image').trim() || null;
  const color  = /^#[0-9a-fA-F]{6}$/.test(rawCol) ? rawCol : '#5865F2';
  const emb    = new EmbedBuilder().setColor(color).setDescription(body).setTimestamp();
  if (title)  emb.setTitle(title);
  if (footer) emb.setFooter({ text:footer });
  if (image)  emb.setImage(image);
  try {
    const ch = await interaction.client.channels.fetch(ctx?.channelId ?? interaction.channelId);
    await ch.send({ embeds:[emb] });
    await interaction.editReply('✅ Embed posted!');
  } catch {
    await interaction.editReply({ content:'⚠️ Preview only (couldn\'t post):', embeds:[emb] });
  }
}

// ─── DM SENDER ───────────────────────────────────────────────────────────────
async function buildDMEmbed(opts, guild) {
  const emb = new EmbedBuilder().setColor(hexToInt(opts.color??null)).setDescription(opts.message).setTimestamp();
  if (opts.title)  emb.setTitle(opts.title);
  if (opts.footer) emb.setFooter({ text:opts.footer });
  if (opts.gifUrl) emb.setImage(opts.gifUrl);
  if (guild)       emb.setAuthor({ name:guild.name, iconURL:guild.iconURL()??undefined });
  return emb;
}

// ─── YOUTUBE MONITOR ─────────────────────────────────────────────────────────
async function checkYouTubeChannels(client) {
  for (const [guildId, monitor] of Object.entries(ytMonitors)) {
    try {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${monitor.ytChannelId}`;
      const xml = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } }).then(r=>r.text()).catch(()=>null);
      if (!xml) continue;

      // Parse latest video from RSS
      const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
      if (!entryMatch) continue;
      const entry = entryMatch[1];
      const videoId   = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/))?.[1];
      const title     = (entry.match(/<title>(.*?)<\/title>/))?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      const published = (entry.match(/<published>(.*?)<\/published>/))?.[1];
      const chanName  = (xml.match(/<title>(.*?)<\/title>/))?.[1]?.replace(/&amp;/g,'&');
      const chanUrl   = (xml.match(/<link rel="alternate" href="(.*?)"/))?.[1];

      if (!videoId || videoId === monitor.lastVideoId) continue;

      monitor.lastVideoId = videoId;
      saveJson('yt-monitors.json', ytMonitors);

      const guild = await client.guilds.fetch(guildId).catch(()=>null);
      if (!guild) continue;
      const ch = await guild.channels.fetch(monitor.discordChannelId).catch(()=>null);
      if (!ch?.isTextBased()) continue;

      const embed = new EmbedBuilder().setColor('#FF0000').setTitle(`📹 ${title ?? 'New Video'}`)
        .setURL(`https://www.youtube.com/watch?v=${videoId}`)
        .setImage(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`)
        .addFields({ name:'Channel', value:`[${chanName??'YouTube'}](${chanUrl??'#'})`, inline:true }, { name:'Published', value:published?`<t:${Math.floor(new Date(published).getTime()/1000)}:R>`:'Just now', inline:true })
        .setFooter({ text:'New YouTube video uploaded!' }).setTimestamp();
      await ch.send({ content:`🎬 **New video just dropped!** <@&${guild.roles.everyone.id}>`, embeds:[embed] }).catch(()=>{
        ch.send({ content:`🎬 **New video!** https://www.youtube.com/watch?v=${videoId}`, embeds:[embed] }).catch(()=>{});
      });
    } catch (e) {
      console.error(`YT monitor error for guild ${guildId}:`, e.message);
    }
  }
}

// ─── GIVEAWAY HELPERS ────────────────────────────────────────────────────────
async function endGiveaway(client, msgId, guildId) {
  const gw = giveaways[msgId];
  if (!gw || gw.ended) return null;
  gw.ended = true;
  saveJson('giveaways.json', giveaways);
  try {
    const guild = await client.guilds.fetch(guildId).catch(()=>null);
    const ch    = await guild?.channels.fetch(gw.channelId).catch(()=>null);
    const msg   = await ch?.messages.fetch(msgId).catch(()=>null);
    if (!msg) return null;
    const reactors = await msg.reactions.cache.get('🎉')?.users.fetch().catch(()=>null);
    const eligible = reactors ? [...reactors.values()].filter(u=>!u.bot) : [];
    const winners  = [];
    const pool     = [...eligible];
    const count    = Math.min(gw.winners, pool.length);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random()*pool.length);
      winners.push(pool.splice(idx,1)[0]);
    }
    gw.winnerIds = winners.map(w=>w.id);
    saveJson('giveaways.json', giveaways);
    const winText = winners.length ? winners.map(w=>`${w}`).join(', ') : '*No valid entries*';
    await ch.send({ content:`🎉 Giveaway ended! Winner${winners.length!==1?'s':''}: **${winText}** — Prize: **${gw.prize}**` });
    return winners;
  } catch { return null; }
}

// ─── STAT CHANNELS UPDATE ─────────────────────────────────────────────────────
async function updateStatChannels(client) {
  for (const [guildId, stat] of Object.entries(statChannels)) {
    try {
      const guild = await client.guilds.fetch(guildId).catch(()=>null);
      if (!guild) continue;
      if (stat.memberChanId) {
        const ch = await guild.channels.fetch(stat.memberChanId).catch(()=>null);
        if (ch) await ch.setName(`👥 Members: ${guild.memberCount}`).catch(()=>{});
      }
      if (stat.botChanId) {
        const bots = guild.members.cache.filter(m=>m.user.bot).size;
        const ch   = await guild.channels.fetch(stat.botChanId).catch(()=>null);
        if (ch) await ch.setName(`🤖 Bots: ${bots}`).catch(()=>{});
      }
    } catch {}
  }
}

// ─── MAIN COMMAND HANDLER ─────────────────────────────────────────────────────
async function handleInteraction(interaction, client) {
  if (interaction.isAutocomplete()) return;

  // Modal submits
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('sheet_'))     return handleSheetModalSubmit(interaction);
    if (interaction.customId.startsWith('tierlist_'))  return handleTierListModal(interaction);
    if (interaction.customId.startsWith('embed_'))     return handleEmbedModal(interaction);
    if (interaction.customId.startsWith('customize_')) return handleCustomizeModalSubmit(interaction);
    if (interaction.customId.startsWith('rules_'))     return handleRulesModalSubmit(interaction);
    return;
  }

  // Reaction role tracking
  if (interaction.isButton()) return;

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // Modal-only commands (must NOT defer before)
  if (commandName === 'create-sheet') return handleCreateSheet(interaction);
  if (commandName === 'tier-list')    return handleTierList(interaction);
  if (commandName === 'embed')        return handleEmbedBuilder(interaction);
  if (commandName === 'customize') {
    const sub = interaction.options.getSubcommand();
    if (['warn-msg','ban-msg','kick-msg','unban-msg','dm-template'].includes(sub))
      return handleCustomize(interaction);
  }
  if (commandName === 'rules') {
    if (interaction.options.getSubcommand() === 'set') return handleRulesSet(interaction);
  }

  // Determine if response should be public
  const PUBLIC_CMDS = new Set([
    'balance','daily','leaderboard','msg-leaderboard','meme','invites','profile','avatar',
    'rank','xp-leaderboard','fact','quote','coinflip','8ball','time','weather','translate',
    'color','math','snipe','editsnipe','serverinfo','userinfo','roleinfo','ping','botinfo',
    'qr','poll','tag','birthday','tier-history','lookup'
  ]);
  const isPublic = PUBLIC_CMDS.has(commandName);
  await interaction.deferReply({ ephemeral: !isPublic });

  const guild = interaction.guild;
  const cfg   = getGuildCfg(guild.id);

  // ── Handle customize (view/reset) after defer ──
  if (commandName === 'customize') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const t = cfg.msgTemplates ?? {};
      const lines = ['**Current Message Templates:**',''];
      for (const key of ['warn','ban','kick','unban','dm']) {
        const tmpl = t[key];
        lines.push(tmpl ? `**${key.toUpperCase()}:** ${tmpl.embed===false?'Text':'Embed'} · *${tmpl.title||'no title'}*` : `**${key.toUpperCase()}:** *Default*`);
      }
      await interaction.editReply(lines.join('\n'));
    } else if (sub === 'reset') {
      const which = sg(interaction,'which') ?? 'all';
      if (!cfg.msgTemplates) cfg.msgTemplates = {};
      if (which === 'all') cfg.msgTemplates = {};
      else delete cfg.msgTemplates[which];
      saveGuildCfg();
      await interaction.editReply(`✅ Reset **${which}** template(s) to default.`);
    }
    return;
  }

  // ── Tier ──
  if (commandName === 'tier-history') {
    const u    = su(interaction,'player') ?? interaction.user;
    const hist = tierHistory[u.id] ?? [];
    if (!hist.length) { await interaction.editReply(`📋 **${u.username}** has no tier evaluation history yet.`); return; }
    const recent = hist.slice(-10).reverse();
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`📋 Tier History — ${u.username}`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .setDescription(`Showing ${recent.length} most recent evaluations out of ${hist.length} total.`);
    for (const h of recent) {
      embed.addFields({ name:`\`${h.grade}\` — ${h.game} on ${h.server}`, value:[`**Score:** ${h.avg}/100  |  **By:** ${h.byName}`,`**Date:** <t:${Math.floor(h.at/1000)}:D>  |  **Server:** ${h.guildName}`,h.postedLink?`[View Result](${h.postedLink})`:''].filter(Boolean).join('\n'), inline:false });
    }
    embed.setTimestamp();
    await interaction.editReply({ embeds:[embed] });

  } else if (commandName === 'set-tier-channel') {
    const ch = sch(interaction,'channel');
    cfg.tierChannelId = ch?.id ?? null; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Tier results will post in ${ch}.` : '❌ Channel not found.');

  } else if (commandName === 'set-tier-tester-role') {
    if (!isServerOwner(interaction)) { await interaction.editReply('❌ Only the **server owner** can set this.'); return; }
    const role = sr(interaction,'role');
    cfg.tierTesterRoleId = role?.id ?? null; saveGuildCfg();
    await interaction.editReply(role ? `✅ Tier Tester role set to **${role.name}**.` : '❌ Role not found.');

  // ── YouTube ──
  } else if (commandName === 'yt') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'link') {
      const ytId   = sg(interaction,'channel_id')?.trim();
      const discCh = sch(interaction,'discord_channel');
      if (!ytId || !discCh) { await interaction.editReply('❌ Missing options.'); return; }
      ytMonitors[guild.id] = { ytChannelId:ytId, discordChannelId:discCh.id, lastVideoId:null };
      saveJson('yt-monitors.json', ytMonitors);
      // Immediately fetch current video to set baseline
      try {
        const xml = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ytId}`).then(r=>r.text()).catch(()=>null);
        if (xml) {
          const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
          const vidId = entry?.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
          if (vidId) ytMonitors[guild.id].lastVideoId = vidId;
          saveJson('yt-monitors.json', ytMonitors);
        }
      } catch {}
      await interaction.editReply(`✅ YouTube monitor set up!\n\`${ytId}\` → notifications in ${discCh}\n\nThe bot will check for new videos every 10 minutes.`);
    } else if (sub === 'remove') {
      delete ytMonitors[guild.id];
      saveJson('yt-monitors.json', ytMonitors);
      await interaction.editReply('✅ YouTube monitoring removed.');
    } else {
      const m = ytMonitors[guild.id];
      if (!m) { await interaction.editReply('❌ No YouTube monitor set up. Use `/yt link`.'); return; }
      const ch = await guild.channels.fetch(m.discordChannelId).catch(()=>null);
      await interaction.editReply(`📺 **YouTube Monitor:**\n**Channel ID:** \`${m.ytChannelId}\`\n**Discord Channel:** ${ch??'unknown'}\n**Last Video ID:** \`${m.lastVideoId??'none yet'}\``);
    }

  // ── Logging ──
  } else if (commandName === 'set-log-channel') {
    const ch = sch(interaction,'channel');
    cfg.logChannelId = ch?.id ?? null; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Mod log channel set to ${ch}.` : '❌ Channel not found.');

  // ── DM Commands ──
  } else if (commandName === 'dm-user') {
    if (!hasTierTesterRole(interaction)) {
      await interaction.editReply('❌ You need the **Tier Tester** role to use this command.');
      return;
    }
    const rawId  = sg(interaction,'user_id')?.replace(/[<@!>]/g,'') ?? '';
    const msg    = sg(interaction,'message');
    const title  = sg(interaction,'title');
    const color  = sg(interaction,'color');
    const footer = sg(interaction,'footer');
    const gifUrl = sg(interaction,'gif_url');
    if (!rawId || !msg) { await interaction.editReply('❌ Missing required options.'); return; }
    try {
      const u   = await client.users.fetch(rawId);
      const emb = await buildDMEmbed({ message:msg, title, color, footer, gifUrl }, guild);
      await u.send({ embeds:[emb] });
      await interaction.editReply(`✅ DM sent to **${u.username}**!`);
    } catch {
      await interaction.editReply(`❌ Could not DM \`${rawId}\` — their DMs may be closed, or that ID is invalid.`);
    }

  } else if (commandName === 'dm-all') {
    if (!hasTierTesterRole(interaction)) { await interaction.editReply('❌ You need the **Tier Tester** role.'); return; }
    const msg    = sg(interaction,'message');
    const title  = sg(interaction,'title');
    const color  = sg(interaction,'color');
    const footer = sg(interaction,'footer');
    const gifUrl = sg(interaction,'gif_url');
    if (!msg) { await interaction.editReply('❌ Missing message.'); return; }
    await interaction.editReply('📨 Sending DMs to all members...');
    const mbs  = await guild.members.fetch();
    const emb  = await buildDMEmbed({ message:msg, title, color, footer, gifUrl }, guild);
    let sent = 0, failed = 0;
    for (const [,m] of mbs) {
      if (m.user.bot) continue;
      try { await m.send({ embeds:[emb] }); sent++; } catch { failed++; }
    }
    await interaction.editReply(`📨 Done! ✅ ${sent} sent | ❌ ${failed} failed`);

  } else if (commandName === 'dm-role') {
    const role   = sr(interaction,'role');
    const msg    = sg(interaction,'message');
    const title  = sg(interaction,'title');
    const color  = sg(interaction,'color');
    const footer = sg(interaction,'footer');
    const gifUrl = sg(interaction,'gif_url');
    if (!role || !msg) { await interaction.editReply('❌ Missing required options.'); return; }
    await interaction.editReply(`📨 Sending DMs to **${role.name}** members...`);
    const mbs     = await guild.members.fetch();
    const targets = [...mbs.values()].filter(m=>m.roles.cache.has(role.id) && !m.user.bot);
    if (!targets.length) { await interaction.editReply(`❌ No members have **${role.name}**.`); return; }
    const emb  = await buildDMEmbed({ message:msg, title, color, footer, gifUrl }, guild);
    let sent = 0, failed = 0;
    for (const m of targets) {
      try { await m.send({ embeds:[emb] }); sent++; } catch { failed++; }
    }
    await interaction.editReply(`📨 Done! ✅ ${sent} sent | ❌ ${failed} failed`);

  // ── Moderation ──
  } else if (commandName === 'warn') {
    const u      = su(interaction,'user');
    const reason = sg(interaction,'reason');
    if (!u || !reason) { await interaction.editReply('❌ Missing options.'); return; }
    if (!warnings[guild.id]) warnings[guild.id] = {};
    if (!warnings[guild.id][u.id]) warnings[guild.id][u.id] = [];
    warnings[guild.id][u.id].push({ reason, by:interaction.user.username, at:Date.now() });
    saveJson('warnings.json', warnings);
    const count = warnings[guild.id][u.id].length;
    const logEmb = new EmbedBuilder().setColor('#FEE75C').setTitle('⚠️ Member Warned')
      .addFields({name:'Member',value:`${u} (\`${u.id}\`)`,inline:true},{name:'Moderator',value:`${interaction.user}`,inline:true},{name:'Reason',value:reason},{name:'Total Warnings',value:`${count}`,inline:true}).setTimestamp();
    await logMod(guild, cfg, logEmb);
    // Custom or default DM
    const tmpl = cfg.msgTemplates?.warn;
    const vars = { user:u.username, reason, server:guild.name, count:`${count}` };
    if (tmpl) { await sendModDM(client, u.id, tmpl, vars); }
    else { try { await u.send(`⚠️ You received a warning in **${guild.name}**.\n**Reason:** ${reason}\n**Total warnings:** ${count}`); } catch {} }
    await interaction.editReply({ embeds:[logEmb] });

  } else if (commandName === 'warnings') {
    const u    = su(interaction,'user');
    if (!u) { await interaction.editReply('❌ Missing user.'); return; }
    const list = warnings[guild.id]?.[u.id] ?? [];
    const emb  = new EmbedBuilder().setColor('#FEE75C').setTitle(`⚠️ Warnings — ${u.username}`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .setDescription(list.length ? list.map((w,i)=>`**${i+1}.** ${w.reason} — by *${w.by}* — <t:${Math.floor(w.at/1000)}:D>`).join('\n') : '✅ No warnings!')
      .setFooter({text:`Total: ${list.length}`}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'clearwarnings') {
    const u = su(interaction,'user');
    if (!u) { await interaction.editReply('❌ Missing user.'); return; }
    if (warnings[guild.id]) delete warnings[guild.id][u.id];
    saveJson('warnings.json', warnings);
    await interaction.editReply(`✅ Cleared all warnings for **${u.username}**.`);

  } else if (commandName === 'timeout') {
    const u      = su(interaction,'user');
    const dur    = parseMs(sg(interaction,'duration') ?? '');
    const reason = sg(interaction,'reason') ?? 'No reason';
    if (!u || !dur || dur > 28*86400000) { await interaction.editReply('❌ Invalid. Duration: e.g. 10m, 2h, 1d (max 28d).'); return; }
    const m = await guild.members.fetch(u.id).catch(()=>null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.timeout(dur, reason);
    const logEmb = new EmbedBuilder().setColor('#ED4245').setTitle('⏱️ Member Timed Out')
      .addFields({name:'Member',value:`${u}`,inline:true},{name:'Duration',value:fmtMs(dur),inline:true},{name:'Reason',value:reason}).setTimestamp();
    await logMod(guild, cfg, logEmb);
    try { await u.send(`⏱️ You were timed out in **${guild.name}** for **${fmtMs(dur)}**.\n**Reason:** ${reason}`); } catch {}
    await interaction.editReply({ embeds:[logEmb] });

  } else if (commandName === 'untimeout') {
    const u = su(interaction,'user');
    if (!u) { await interaction.editReply('❌ Missing user.'); return; }
    const m = await guild.members.fetch(u.id).catch(()=>null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.timeout(null);
    await interaction.editReply(`✅ Timeout removed from **${u.username}**.`);

  } else if (commandName === 'ban') {
    const rawId  = sg(interaction,'user_id')?.replace(/[<@!>]/g,'') ?? '';
    const reason = sg(interaction,'reason') ?? 'No reason';
    const delDay = si(interaction,'delete_days') ?? 0;
    if (!rawId) { await interaction.editReply('❌ Provide a user mention or user ID.'); return; }
    try {
      const u = await client.users.fetch(rawId).catch(()=>null);
      // DM before banning (user must still be in server to receive)
      if (u) {
        const tmpl = cfg.msgTemplates?.ban;
        const vars = { user:u.username, reason, server:guild.name };
        if (tmpl) await sendModDM(client, u.id, tmpl, vars);
        else { try { await u.send(`🔨 You have been **banned** from **${guild.name}**.\n**Reason:** ${reason}`); } catch {} }
      }
      await guild.members.ban(rawId, { reason, deleteMessageSeconds:delDay*86400 });
      const logEmb = new EmbedBuilder().setColor('#ED4245').setTitle('🔨 Member Banned')
        .addFields({name:'User',value:`${u?`${u} `:''}(\`${rawId}\`)`,inline:true},{name:'Moderator',value:`${interaction.user}`,inline:true},{name:'Reason',value:reason},{name:'Delete Messages',value:`${delDay}d`,inline:true}).setTimestamp();
      await logMod(guild, cfg, logEmb);
      await interaction.editReply({ embeds:[logEmb] });
    } catch (e) {
      await interaction.editReply(`❌ Could not ban \`${rawId}\`: ${e.message}`);
    }

  } else if (commandName === 'unban') {
    const rawId  = sg(interaction,'user_id')?.replace(/[<@!>]/g,'') ?? '';
    const reason = sg(interaction,'reason') ?? 'No reason';
    if (!rawId) { await interaction.editReply('❌ Provide a user ID.'); return; }
    try {
      await guild.members.unban(rawId, reason);
      const u = await client.users.fetch(rawId).catch(()=>null);
      // DM unban notice + invite
      const tmpl = cfg.msgTemplates?.unban;
      const vars = { user:u?.username??rawId, server:guild.name, invite:INVITE_LINK };
      if (tmpl) await sendModDM(client, rawId, tmpl, vars);
      else {
        try {
          await u?.send(`✅ You have been **unbanned** from **${guild.name}**!\n\nFeel free to rejoin: ${INVITE_LINK}`);
        } catch {}
      }
      const logEmb = new EmbedBuilder().setColor('#57F287').setTitle('✅ Member Unbanned')
        .addFields({name:'User',value:`${u?`${u} `:''}(\`${rawId}\`)`,inline:true},{name:'Moderator',value:`${interaction.user}`,inline:true},{name:'Reason',value:reason}).setTimestamp();
      await logMod(guild, cfg, logEmb);
      await interaction.editReply({ embeds:[logEmb] });
    } catch (e) {
      await interaction.editReply(`❌ Could not unban \`${rawId}\`: ${e.message}`);
    }

  } else if (commandName === 'kick') {
    const u      = su(interaction,'user');
    const reason = sg(interaction,'reason') ?? 'No reason';
    if (!u) { await interaction.editReply('❌ Missing user.'); return; }
    const m = await guild.members.fetch(u.id).catch(()=>null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    const tmpl = cfg.msgTemplates?.kick;
    const vars = { user:u.username, reason, server:guild.name };
    if (tmpl) await sendModDM(client, u.id, tmpl, vars);
    else { try { await u.send(`👢 You were **kicked** from **${guild.name}**.\n**Reason:** ${reason}`); } catch {} }
    await m.kick(reason);
    const logEmb = new EmbedBuilder().setColor('#FEE75C').setTitle('👢 Member Kicked')
      .addFields({name:'Member',value:`${u}`,inline:true},{name:'Moderator',value:`${interaction.user}`,inline:true},{name:'Reason',value:reason}).setTimestamp();
    await logMod(guild, cfg, logEmb);
    await interaction.editReply({ embeds:[logEmb] });

  } else if (commandName === 'nickname') {
    const u    = su(interaction,'user');
    const nick = sg(interaction,'nickname') ?? null;
    if (!u) { await interaction.editReply('❌ Missing user.'); return; }
    const m = await guild.members.fetch(u.id).catch(()=>null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.setNickname(nick);
    await interaction.editReply(nick ? `✅ Set **${u.username}**'s nickname to **${nick}**.` : `✅ Reset **${u.username}**'s nickname.`);

  } else if (commandName === 'purge') {
    const n   = si(interaction,'amount') ?? 1;
    const del = await interaction.channel.bulkDelete(n, true).catch(()=>({ size:0 }));
    await interaction.editReply(`🗑️ Deleted **${del.size}** messages.`);

  } else if (commandName === 'slowmode') {
    const sec = si(interaction,'seconds') ?? 0;
    await interaction.channel.setRateLimitPerUser(sec);
    await interaction.editReply(sec === 0 ? '✅ Slowmode disabled.' : `✅ Slowmode set to **${sec}s**.`);

  } else if (commandName === 'lockdown') {
    const chs = guild.channels.cache.filter(c=>c.type===ChannelType.GuildText);
    for (const [,ch] of chs) await ch.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:false}).catch(()=>{});
    await interaction.editReply(`🔒 Server locked! **${chs.size}** channels are now read-only.`);

  } else if (commandName === 'unlockdown') {
    const chs = guild.channels.cache.filter(c=>c.type===ChannelType.GuildText);
    for (const [,ch] of chs) await ch.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:null}).catch(()=>{});
    await interaction.editReply('🔓 Lockdown lifted!');

  } else if (commandName === 'role-add') {
    const u = su(interaction,'user'); const role = sr(interaction,'role');
    if (!u || !role) { await interaction.editReply('❌ Missing options.'); return; }
    const m = await guild.members.fetch(u.id).catch(()=>null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.roles.add(role);
    await interaction.editReply(`✅ Added **${role.name}** to **${u.username}**.`);

  } else if (commandName === 'role-remove') {
    const u = su(interaction,'user'); const role = sr(interaction,'role');
    if (!u || !role) { await interaction.editReply('❌ Missing options.'); return; }
    const m = await guild.members.fetch(u.id).catch(()=>null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.roles.remove(role);
    await interaction.editReply(`✅ Removed **${role.name}** from **${u.username}**.`);

  } else if (commandName === 'bulk-role') {
    const action = sg(interaction,'action');
    const role   = sr(interaction,'role');
    if (!action || !role) { await interaction.editReply('❌ Missing options.'); return; }
    await interaction.editReply(`⏳ Processing bulk role **${action}** for **${role.name}**...`);
    const mbs = await guild.members.fetch();
    let success = 0, fail = 0;
    for (const [,m] of mbs) {
      if (m.user.bot) continue;
      try {
        if (action === 'add') await m.roles.add(role); else await m.roles.remove(role);
        success++;
      } catch { fail++; }
    }
    await interaction.editReply(`✅ Done! ${action === 'add' ? 'Added' : 'Removed'} **${role.name}** for **${success}** members. (${fail} failed)`);

  } else if (commandName === 'audit') {
    const limit = si(interaction,'limit') ?? 10;
    const logs  = await guild.fetchAuditLogs({ limit }).catch(()=>null);
    if (!logs) { await interaction.editReply('❌ Could not fetch audit log.'); return; }
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('📋 Recent Audit Log').setTimestamp();
    for (const [,entry] of logs.entries) {
      const u = entry.executor;
      embed.addFields({ name:`${entry.actionType} — by ${u?.username??'Unknown'}`, value:`Target: ${entry.target instanceof Object && 'username' in entry.target ? entry.target.username : entry.targetId??'?'}\n${entry.reason?`Reason: ${entry.reason}`:''}`, inline:false });
    }
    await interaction.editReply({ embeds:[embed] });

  // ── Server Setup ──
  } else if (commandName === 'report') {
    const u      = su(interaction,'user');
    const reason = sg(interaction,'reason');
    const proof  = interaction.options.getAttachment?.('proof') ?? null;
    if (!cfg.reportChannelId) { await interaction.editReply('⚠️ No report channel set. Ask an admin to use `/set-report-channel`.'); return; }
    const ch = await guild.channels.fetch(cfg.reportChannelId).catch(()=>null);
    if (!ch?.isTextBased()) { await interaction.editReply('❌ Report channel not found.'); return; }
    const emb = new EmbedBuilder().setColor('#ED4245').setTitle('🚨 New Report')
      .addFields({name:'Reported',value:`${u} (\`${u?.id}\`)`,inline:true},{name:'Reporter',value:`${interaction.user}`,inline:true},{name:'Reason',value:reason??'N/A'}).setTimestamp();
    if (proof) emb.setImage(proof.url);
    await ch.send({ embeds:[emb] });
    await interaction.editReply('✅ Report submitted! Moderators have been notified.');

  } else if (commandName === 'set-report-channel') {
    const ch = sch(interaction,'channel');
    cfg.reportChannelId = ch?.id; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Report channel set to ${ch}.` : '❌ Channel not found.');

  } else if (commandName === 'set-welcome-channel') {
    const ch = sch(interaction,'channel');
    cfg.welcomeChannelId = ch?.id; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Welcome channel set to ${ch}.` : '❌ Channel not found.');

  } else if (commandName === 'set-autorole') {
    const role = sr(interaction,'role');
    cfg.autoRoleId = role?.id ?? null; saveGuildCfg();
    await interaction.editReply(role ? `✅ Auto-role set to **${role.name}**.` : '✅ Auto-role disabled.');

  // ── Info ──
  } else if (commandName === 'invites') {
    const u   = su(interaction,'user') ?? interaction.user;
    const inv = [...(await guild.invites.fetch().catch(()=>new Map())).values()].filter(i=>i.inviter?.id===u.id);
    const total = inv.reduce((s,i)=>s+(i.uses??0),0);
    const emb = new EmbedBuilder().setColor('#5865F2').setTitle(`📨 Invites — ${u.username}`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .addFields({name:'Total Invites Used',value:`${total}`,inline:true},{name:'Active Invite Links',value:`${inv.length}`,inline:true}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'userinfo') {
    const u = su(interaction,'user') ?? interaction.user;
    const m = await guild.members.fetch(u.id).catch(()=>null);
    const age = Math.floor((Date.now()-u.createdTimestamp)/86400000);
    const roles = m?.roles.cache.filter(r=>r.id!==guild.id).sort((a,b)=>b.position-a.position).map(r=>`${r}`).slice(0,15) ?? [];
    const emb = new EmbedBuilder().setColor(m?.displayHexColor??'#5865F2').setTitle(`👤 ${u.username}`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .addFields(
        {name:'Username',value:`\`${u.username}\``,inline:true},{name:'ID',value:`\`${u.id}\``,inline:true},{name:'Bot',value:u.bot?'Yes':'No',inline:true},
        {name:'Account Created',value:`<t:${Math.floor(u.createdTimestamp/1000)}:D> (${age}d ago)`,inline:false}
      );
    if (m?.joinedAt) emb.addFields({name:'Joined Server',value:`<t:${Math.floor(m.joinedAt.getTime()/1000)}:D>`,inline:false});
    if (roles.length) emb.addFields({name:`Roles (${roles.length})`,value:roles.join(' '),inline:false});
    emb.setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'serverinfo') {
    await guild.fetch();
    const owner = await guild.fetchOwner().catch(()=>null);
    const emb = new EmbedBuilder().setColor('#5865F2').setTitle(`🏠 ${guild.name}`)
      .setThumbnail(guild.iconURL({size:256})??null)
      .addFields(
        {name:'Server ID',value:`\`${guild.id}\``,inline:true},{name:'Owner',value:owner?`${owner.user}`:'?',inline:true},{name:'Created',value:`<t:${Math.floor(guild.createdTimestamp/1000)}:D>`,inline:true},
        {name:'Members',value:guild.memberCount.toLocaleString(),inline:true},{name:'Text Channels',value:guild.channels.cache.filter(c=>c.isTextBased()).size.toString(),inline:true},{name:'Voice Channels',value:guild.channels.cache.filter(c=>c.isVoiceBased()).size.toString(),inline:true},
        {name:'Roles',value:guild.roles.cache.size.toString(),inline:true},{name:'Emojis',value:guild.emojis.cache.size.toString(),inline:true},{name:'Boost Level',value:`Lvl ${guild.premiumTier} (${guild.premiumSubscriptionCount??0} boosts)`,inline:true}
      ).setTimestamp();
    if (guild.description) emb.setDescription(guild.description);
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'avatar') {
    const u   = su(interaction,'user') ?? interaction.user;
    const url = u.displayAvatarURL({size:1024, extension:'png'});
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle(`🖼️ ${u.username}'s Avatar`).setImage(url).setDescription(`[Open Full Size](${url})`).setFooter({text:`ID: ${u.id}`})] });

  } else if (commandName === 'roleinfo') {
    const role = sr(interaction,'role');
    if (!role) { await interaction.editReply('❌ Role not found.'); return; }
    const count = guild.members.cache.filter(m=>m.roles.cache.has(role.id)).size;
    const emb = new EmbedBuilder().setColor(role.hexColor).setTitle(`🎭 ${role.name}`)
      .addFields({name:'ID',value:`\`${role.id}\``,inline:true},{name:'Color',value:role.hexColor,inline:true},{name:'Position',value:`#${role.position}`,inline:true},{name:'Members',value:count.toString(),inline:true},{name:'Created',value:`<t:${Math.floor(role.createdTimestamp/1000)}:D>`,inline:true}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'lookup') {
    const rawId = sg(interaction,'user_id')?.replace(/[<@!>]/g,'') ?? '';
    if (!rawId) { await interaction.editReply('❌ Provide a User ID.'); return; }
    const u = await client.users.fetch(rawId, { force:true }).catch(()=>null);
    if (!u) { await interaction.editReply(`❌ No user found with ID \`${rawId}\`.`); return; }
    const age = Math.floor((Date.now()-u.createdTimestamp)/86400000);
    const emb = new EmbedBuilder().setColor('#5865F2').setTitle(`🔍 Global Lookup`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .addFields({name:'Username',value:u.username,inline:true},{name:'ID',value:`\`${u.id}\``,inline:true},{name:'Bot',value:u.bot?'Yes':'No',inline:true},{name:'Account Created',value:`<t:${Math.floor(u.createdTimestamp/1000)}:D> (${age}d ago)`,inline:false}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'ping') {
    await interaction.editReply(`🏓 Pong! Latency: **${client.ws.ping}ms**`);

  } else if (commandName === 'botinfo') {
    const up = process.uptime();
    const h=Math.floor(up/3600),m2=Math.floor((up%3600)/60),s2=Math.floor(up%60);
    const emb = new EmbedBuilder().setColor('#5865F2').setTitle('🤖 Bot Info')
      .setThumbnail(client.user?.displayAvatarURL({size:256})??null)
      .addFields({name:'Name',value:client.user?.username??'?',inline:true},{name:'ID',value:`\`${client.user?.id}\``,inline:true},{name:'Uptime',value:`${h}h ${m2}m ${s2}s`,inline:true},{name:'Servers',value:client.guilds.cache.size.toString(),inline:true},{name:'Ping',value:`${client.ws.ping}ms`,inline:true},{name:'Node.js',value:process.version,inline:true}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'profile') {
    const u   = su(interaction,'user') ?? interaction.user;
    const m   = await guild.members.fetch(u.id).catch(()=>null);
    const bal = getBal(u.id);
    const xp  = getXP(u.id);
    const wc  = (warnings[guild.id]?.[u.id]??[]).length;
    const msgs= msgStats[u.id]??0;
    const emb = new EmbedBuilder().setColor(m?.displayHexColor??'#5865F2').setTitle(`📋 ${u.username}'s Profile`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .addFields(
        {name:'💎 Emeralds',value:bal.emeralds.toLocaleString(),inline:true},{name:'🔴 Rubies',value:bal.rubies.toLocaleString(),inline:true},{name:'⭐ Level',value:`${xp.level}`,inline:true},
        {name:'✨ XP',value:`${xp.xp} / ${xpForLevel(xp.level+1)}`,inline:true},{name:'⚠️ Warnings',value:`${wc}`,inline:true},{name:'💬 Messages',value:msgs.toLocaleString(),inline:true}
      ).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'stats') {
    const u = su(interaction,'user') ?? interaction.user;
    await interaction.editReply(`📊 **${u.username}** has sent **${(msgStats[u.id]??0).toLocaleString()}** messages tracked by the bot.`);

  // ── XP / Levels ──
  } else if (commandName === 'rank') {
    const u    = su(interaction,'user') ?? interaction.user;
    const xp   = getXP(u.id);
    const nxp  = xpForLevel(xp.level+1);
    const bar  = progressBar(Math.round(xp.xp/nxp*100));
    const rank = Object.entries(xpData).sort((a,b)=>((b[1].xp+(b[1].level*1000))-(a[1].xp+(a[1].level*1000)))).findIndex(([id])=>id===u.id)+1;
    const emb  = new EmbedBuilder().setColor('#5865F2').setTitle(`⭐ ${u.username}'s Rank`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .addFields({name:'Level',value:`**${xp.level}**`,inline:true},{name:'XP',value:`${xp.xp} / ${nxp}`,inline:true},{name:'Server Rank',value:`#${rank}`,inline:true},{name:'Progress',value:`\`${bar}\``,inline:false}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'xp-leaderboard') {
    const sorted = Object.entries(xpData).sort((a,b)=>((b[1].xp+b[1].level*1000)-(a[1].xp+a[1].level*1000))).slice(0,10);
    const lines  = await Promise.all(sorted.map(async([uid,d],i)=>{ const u=await client.users.fetch(uid).catch(()=>null); return `**${i+1}.** ${u?.username??uid} — Lvl **${d.level}** • **${d.xp}** XP`; }));
    const emb = new EmbedBuilder().setColor('#5865F2').setTitle('⭐ XP Leaderboard').setDescription(lines.join('\n')||'No data yet.').setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'give-xp') {
    const u   = su(interaction,'user');
    const amt = si(interaction,'amount') ?? 0;
    if (!u || !amt) { await interaction.editReply('❌ Missing options.'); return; }
    const xp = getXP(u.id);
    xp.xp += amt;
    while (xp.xp >= xpForLevel(xp.level+1)) { xp.xp -= xpForLevel(xp.level+1); xp.level++; }
    saveJson('xp-data.json', xpData);
    await interaction.editReply(`✅ Gave **${amt} XP** to **${u.username}**. They are now Level **${xp.level}**.`);

  // ── Economy ──
  } else if (commandName === 'balance') {
    const u   = su(interaction,'user') ?? interaction.user;
    const bal = getBal(u.id);
    const emb = new EmbedBuilder().setColor('#57F287').setTitle(`💰 Balance — ${u.username}`)
      .setThumbnail(u.displayAvatarURL({size:256}))
      .addFields({name:'💎 Emeralds',value:bal.emeralds.toLocaleString(),inline:true},{name:'🔴 Rubies',value:bal.rubies.toLocaleString(),inline:true}).setTimestamp();
    await interaction.editReply({ embeds:[emb] });

  } else if (commandName === 'daily') {
    const last = dailyClaims[interaction.user.id] ?? 0;
    const ms   = Date.now()-last;
    if (ms < 86400000) { await interaction.editReply(`⏰ Come back in **${fmtMs(86400000-ms)}**!`); return; }
    dailyClaims[interaction.user.id] = Date.now();
    saveJson('daily-claims.json', dailyClaims);
    getBal(interaction.user.id).emeralds += 200;
    saveJson('economy.json', economy);
    await interaction.editReply(`🎁 You received **200 💎 Emeralds**! Come back tomorrow for more!`);

  } else if (commandName === 'give-ruby') {
    const u = su(interaction,'user'); const amt = si(interaction,'amount') ?? 0;
    if (!u || !amt) { await interaction.editReply('❌ Missing options.'); return; }
    getBal(u.id).rubies += amt;
    saveJson('economy.json', economy);
    await interaction.editReply(`✅ Gave **${amt} 🔴 Rubies** to **${u.username}**.`);

  } else if (commandName === 'leaderboard') {
    const sorted = Object.entries(economy).sort((a,b)=>(b[1].emeralds+b[1].rubies)-(a[1].emeralds+a[1].rubies)).slice(0,10);
    const lines  = await Promise.all(sorted.map(async([uid,bal],i)=>{ const u=await client.users.fetch(uid).catch(()=>null); return `**${i+1}.** ${u?.username??uid} — 💎 ${bal.emeralds} | 🔴 ${bal.rubies}`; }));
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Top 10 Richest Members').setDescription(lines.join('\n')||'No data yet.').setTimestamp()] });

  } else if (commandName === 'msg-leaderboard') {
    const sorted = Object.entries(msgStats).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const lines  = await Promise.all(sorted.map(async([uid,cnt],i)=>{ const u=await client.users.fetch(uid).catch(()=>null); return `**${i+1}.** ${u?.username??uid} — **${cnt.toLocaleString()}** messages`; }));
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle('💬 Top 10 Most Active Members').setDescription(lines.join('\n')||'No data yet.').setTimestamp()] });

  } else if (commandName === 'shop') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'menu') {
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#FFD700').setTitle('🛍️ Server Shop').setDescription('**🎭 Custom Role** — 💎 2,500 Emeralds\nCreate your own role with a custom name and color!\n\nUse `/shop create-role <name> <color>` to buy\nUse `/shop redeem <code>` to redeem a reward code\nUse `/daily` to earn free emeralds every day!').setTimestamp()] });
    } else if (sub === 'create-role') {
      const name = sg(interaction,'name'); const color = sg(interaction,'color');
      if (!name || !color) { await interaction.editReply('❌ Missing options.'); return; }
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) { await interaction.editReply('❌ Invalid hex color. Use e.g. `#ff0000`.'); return; }
      const bal = getBal(interaction.user.id);
      if (bal.emeralds < 2500) { await interaction.editReply(`❌ You need 2,500 💎 but only have **${bal.emeralds}**.`); return; }
      const role = await guild.roles.create({ name, color, reason:`Shop: ${interaction.user.username}` });
      const m    = await guild.members.fetch(interaction.user.id).catch(()=>null);
      await m?.roles.add(role);
      bal.emeralds -= 2500;
      saveJson('economy.json', economy);
      await interaction.editReply(`✅ Role **${name}** created and assigned! 2,500 💎 deducted.`);
    } else if (sub === 'redeem') {
      const code = (sg(interaction,'code')??'').toUpperCase();
      const c    = shopCodes[code];
      if (!c) { await interaction.editReply('❌ Invalid code.'); return; }
      if (c.uses >= (c.maxUses??1)) { await interaction.editReply('❌ This code has been fully redeemed.'); return; }
      if (c.usedBy?.includes(interaction.user.id)) { await interaction.editReply('❌ You already used this code.'); return; }
      c.uses++;
      if (!c.usedBy) c.usedBy = [];
      c.usedBy.push(interaction.user.id);
      saveJson('shop-codes.json', shopCodes);
      if (c.emeralds) { getBal(interaction.user.id).emeralds += c.emeralds; saveJson('economy.json', economy); }
      if (c.rubies)   { getBal(interaction.user.id).rubies   += c.rubies;   saveJson('economy.json', economy); }
      await interaction.editReply(`✅ Code redeemed! You received ${[c.emeralds?`**${c.emeralds} 💎**`:'',c.rubies?`**${c.rubies} 🔴**`:''].filter(Boolean).join(' + ')}`.trim());
    }

  } else if (commandName === 'create-code') {
    const code = (sg(interaction,'code')??'').toUpperCase();
    const em   = si(interaction,'emeralds') ?? 0;
    const ruby = si(interaction,'rubies') ?? 0;
    const maxU = si(interaction,'max_uses') ?? 1;
    if (!code) { await interaction.editReply('❌ Code cannot be empty.'); return; }
    shopCodes[code] = { emeralds:em, rubies:ruby, maxUses:maxU, uses:0, usedBy:[] };
    saveJson('shop-codes.json', shopCodes);
    await interaction.editReply(`✅ Code **\`${code}\`** created! Rewards: ${em} 💎 + ${ruby} 🔴. Max uses: ${maxU}`);

  // ── Tags ──
  } else if (commandName === 'tag') {
    const sub  = interaction.options.getSubcommand();
    const name = sg(interaction,'name')?.toLowerCase().trim();
    if (!tags[guild.id]) tags[guild.id] = {};
    if (sub === 'use') {
      const t = tags[guild.id]?.[name ?? ''];
      if (!t) { await interaction.editReply(`❌ No tag named \`${name}\`.`); return; }
      await interaction.editReply(t.content);
    } else if (sub === 'create') {
      const content = sg(interaction,'content');
      if (!name || !content) { await interaction.editReply('❌ Missing options.'); return; }
      tags[guild.id][name] = { content, author:interaction.user.username, at:Date.now() };
      saveJson('tags.json', tags);
      await interaction.editReply(`✅ Tag **\`${name}\`** created!`);
    } else if (sub === 'delete') {
      if (!tags[guild.id]?.[name??'']) { await interaction.editReply(`❌ No tag named \`${name}\`.`); return; }
      delete tags[guild.id][name];
      saveJson('tags.json', tags);
      await interaction.editReply(`✅ Tag **\`${name}\`** deleted.`);
    } else {
      const list = Object.keys(tags[guild.id]??{});
      await interaction.editReply(list.length ? `**Tags (${list.length}):** ${list.map(t=>`\`${t}\``).join(', ')}` : 'No tags created yet. Use `/tag create <name> <content>`.');
    }

  // ── Reaction Roles ──
  } else if (commandName === 'reaction-role') {
    const sub = interaction.options.getSubcommand();
    if (!reactionRoles[guild.id]) reactionRoles[guild.id] = [];
    if (sub === 'add') {
      const msgId  = sg(interaction,'message_id');
      const emoji  = sg(interaction,'emoji');
      const role   = sr(interaction,'role');
      const ch     = sch(interaction,'channel') ?? interaction.channel;
      if (!msgId || !emoji || !role) { await interaction.editReply('❌ Missing options.'); return; }
      try {
        const msg = await ch.messages.fetch(msgId);
        await msg.react(emoji);
        reactionRoles[guild.id].push({ messageId:msgId, channelId:ch.id, emoji, roleId:role.id });
        saveJson('reaction-roles.json', reactionRoles);
        await interaction.editReply(`✅ Reaction role added! React with ${emoji} on [that message](https://discord.com/channels/${guild.id}/${ch.id}/${msgId}) to get **${role.name}**.`);
      } catch (e) { await interaction.editReply(`❌ Error: ${e.message}`); }
    } else if (sub === 'remove') {
      const msgId = sg(interaction,'message_id');
      const emoji = sg(interaction,'emoji');
      reactionRoles[guild.id] = reactionRoles[guild.id].filter(r=>!(r.messageId===msgId&&r.emoji===emoji));
      saveJson('reaction-roles.json', reactionRoles);
      await interaction.editReply('✅ Reaction role removed.');
    } else {
      const list = reactionRoles[guild.id]??[];
      if (!list.length) { await interaction.editReply('No reaction roles set up. Use `/reaction-role add`.'); return; }
      const lines = list.map(r=>`${r.emoji} → <@&${r.roleId}> on msg \`${r.messageId}\``);
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle('🎭 Reaction Roles').setDescription(lines.join('\n'))] });
    }

  // ── AFK ──
  } else if (commandName === 'afk') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const reason = sg(interaction,'reason') ?? 'AFK';
      afkUsers[interaction.user.id] = { reason, since:Date.now() };
      saveJson('afk-users.json', afkUsers);
      await interaction.editReply(`✅ You are now AFK: **${reason}**`);
    } else {
      if (!afkUsers[interaction.user.id]) { await interaction.editReply('❌ You are not AFK.'); return; }
      delete afkUsers[interaction.user.id];
      saveJson('afk-users.json', afkUsers);
      await interaction.editReply('✅ Welcome back! AFK status removed.');
    }

  // ── Sticky Messages ──
  } else if (commandName === 'sticky') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      const content = sg(interaction,'content');
      if (!content) { await interaction.editReply('❌ Missing content.'); return; }
      stickyMsgs[interaction.channelId] = { content, lastMsgId:null };
      saveJson('sticky-msgs.json', stickyMsgs);
      await interaction.editReply(`✅ Sticky message set! It will re-post after each new message.`);
    } else {
      delete stickyMsgs[interaction.channelId];
      saveJson('sticky-msgs.json', stickyMsgs);
      await interaction.editReply('✅ Sticky message removed.');
    }

  // ── Server Stats Channels ──
  } else if (commandName === 'server-stats') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') {
      const memberCh = await guild.channels.create({ name:`👥 Members: ${guild.memberCount}`, type:ChannelType.GuildVoice, permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.Connect]}] });
      const botCh    = await guild.channels.create({ name:`🤖 Bots: ${guild.members.cache.filter(m=>m.user.bot).size}`, type:ChannelType.GuildVoice, permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.Connect]}] });
      statChannels[guild.id] = { memberChanId:memberCh.id, botChanId:botCh.id };
      saveJson('stat-channels.json', statChannels);
      await interaction.editReply('✅ Live stat channels created! They update every 10 minutes.');
    } else {
      const stat = statChannels[guild.id];
      if (stat) {
        for (const id of [stat.memberChanId, stat.botChanId]) {
          const ch = await guild.channels.fetch(id).catch(()=>null);
          await ch?.delete().catch(()=>{});
        }
        delete statChannels[guild.id];
        saveJson('stat-channels.json', statChannels);
      }
      await interaction.editReply('✅ Stat channels removed.');
    }

  // ── Rules ──
  } else if (commandName === 'rules') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'show') {
      const list = serverRules[guild.id] ?? [];
      const emb  = new EmbedBuilder().setColor('#5865F2').setTitle(`📜 ${guild.name} Server Rules`)
        .setThumbnail(guild.iconURL({size:256})??null)
        .setDescription(list.length ? list.map((r,i)=>`**${i+1}.** ${r}`).join('\n\n') : '*No rules set yet. Admins can use `/rules set` or `/rules add`.*')
        .setTimestamp();
      await interaction.editReply({ embeds:[emb] });
    } else if (sub === 'add') {
      const rule = sg(interaction,'rule');
      if (!rule) { await interaction.editReply('❌ Missing rule text.'); return; }
      if (!serverRules[guild.id]) serverRules[guild.id] = [];
      serverRules[guild.id].push(rule);
      saveJson('server-rules.json', serverRules);
      await interaction.editReply(`✅ Rule #${serverRules[guild.id].length} added!`);
    } else if (sub === 'remove') {
      const n = (si(interaction,'number') ?? 1) - 1;
      if (!serverRules[guild.id]?.[n]) { await interaction.editReply('❌ That rule number does not exist.'); return; }
      serverRules[guild.id].splice(n, 1);
      saveJson('server-rules.json', serverRules);
      await interaction.editReply(`✅ Rule removed.`);
    }

  // ── Partnership ──
  } else if (commandName === 'partnership') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set-channel') {
      const ch = sch(interaction,'channel');
      cfg.partnerChannelId = ch?.id; saveGuildCfg();
      await interaction.editReply(ch ? `✅ Partnership channel set to ${ch}.` : '❌ Channel not found.');
    } else if (sub === 'post') {
      if (!cfg.partnerChannelId) { await interaction.editReply('⚠️ No partnership channel set. Admin: use `/partnership set-channel`.'); return; }
      const ch = await guild.channels.fetch(cfg.partnerChannelId).catch(()=>null);
      if (!ch?.isTextBased()) { await interaction.editReply('❌ Partnership channel not found.'); return; }
      const sName = sg(interaction,'server_name');
      const invite = sg(interaction,'invite');
      const desc  = sg(interaction,'description');
      const banner= sg(interaction,'banner');
      const emb   = new EmbedBuilder().setColor('#5865F2').setTitle(`🤝 Partnership — ${sName}`)
        .setDescription(desc??'').addFields({name:'Invite',value:invite??'N/A',inline:true},{name:'Submitted by',value:`${interaction.user}`,inline:true}).setTimestamp();
      if (banner) emb.setImage(banner);
      await ch.send({ embeds:[emb] });
      await interaction.editReply(`✅ Partnership with **${sName}** posted in ${ch}!`);
    }

  // ── Utility ──
  } else if (commandName === 'poll') {
    const q    = sg(interaction,'question');
    if (!q) { await interaction.editReply('❌ Missing question.'); return; }
    const opts = [1,2,3,4].map(n=>sg(interaction,`option${n}`)).filter(Boolean);
    const emb  = new EmbedBuilder().setColor('#5865F2').setTitle('📊 Poll').setDescription(`**${q}**`).setFooter({text:`Poll by ${interaction.user.username}`}).setTimestamp();
    const NUMS = ['1️⃣','2️⃣','3️⃣','4️⃣'];
    if (opts.length) opts.forEach((o,i)=>emb.addFields({name:`${NUMS[i]} ${o}`,value:'\u200B',inline:true}));
    const msg = await interaction.channel.send({ embeds:[emb] });
    if (opts.length) { for (const e of NUMS.slice(0,opts.length)) await msg.react(e).catch(()=>{}); }
    else { await msg.react('👍').catch(()=>{}); await msg.react('👎').catch(()=>{}); }
    await interaction.editReply({ content:'✅ Poll posted!', ephemeral:true });

  } else if (commandName === 'announce') {
    const ch   = sch(interaction,'channel');
    const msg  = sg(interaction,'message');
    const title= sg(interaction,'title');
    const color= sg(interaction,'color');
    const gif  = sg(interaction,'gif_url');
    if (!ch || !msg) { await interaction.editReply('❌ Missing options.'); return; }
    const emb  = new EmbedBuilder().setColor(hexToInt(color)).setDescription(msg).setTimestamp();
    if (title) emb.setTitle(title);
    if (gif)   emb.setImage(gif);
    emb.setAuthor({ name:guild.name, iconURL:guild.iconURL()??undefined });
    await ch.send({ embeds:[emb] });
    await interaction.editReply(`✅ Announcement sent in ${ch}.`);

  } else if (commandName === 'say') {
    const ch  = sch(interaction,'channel');
    const msg = sg(interaction,'message');
    if (!ch || !msg) { await interaction.editReply('❌ Missing options.'); return; }
    await ch.send(msg);
    await interaction.editReply(`✅ Sent in ${ch}.`);

  } else if (commandName === 'snipe') {
    const s = snipeCache[interaction.channelId];
    if (!s) { await interaction.editReply('😶 Nothing to snipe here!'); return; }
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#ED4245').setTitle('👻 Last Deleted Message').setDescription(s.content||'*[No text]*').setFooter({text:`By ${s.author}`,iconURL:s.avatar??undefined}).setTimestamp(s.time)] });

  } else if (commandName === 'editsnipe') {
    const s = editSnipe[interaction.channelId];
    if (!s) { await interaction.editReply('😶 Nothing to edit-snipe here!'); return; }
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#FEE75C').setTitle('✏️ Last Edited Message').addFields({name:'Before',value:s.before||'*empty*',inline:true},{name:'After',value:s.after||'*empty*',inline:true}).setFooter({text:`By ${s.author}`,iconURL:s.avatar??undefined}).setTimestamp(s.time)] });

  } else if (commandName === 'reminder') {
    const timeStr = sg(interaction,'time') ?? '';
    const msg     = sg(interaction,'message') ?? '';
    const ms      = parseMs(timeStr);
    if (!ms || ms > 7*86400000) { await interaction.editReply('❌ Invalid time. Use e.g. `10s`, `30m`, `2h`, `1d` (max 7d).'); return; }
    if (!reminders[interaction.user.id]) reminders[interaction.user.id] = [];
    reminders[interaction.user.id].push({ msg, fireAt:Date.now()+ms, channelId:interaction.channelId });
    saveJson('reminders.json', reminders);
    await interaction.editReply(`⏰ I'll remind you in **${fmtMs(ms)}**: *${msg}*`);

  } else if (commandName === 'giveaway') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const prize   = sg(interaction,'prize');
      const timeStr = sg(interaction,'duration') ?? '';
      const ms      = parseMs(timeStr);
      if (!prize || !ms) { await interaction.editReply('❌ Invalid options.'); return; }
      const winCount = si(interaction,'winners') ?? 1;
      const ch       = sch(interaction,'channel') ?? interaction.channel;
      const endsAt   = Date.now()+ms;
      const emb = new EmbedBuilder().setColor('#FFD700').setTitle('🎉 GIVEAWAY!').setDescription(`**Prize:** ${prize}\n**Winners:** ${winCount}\n**Ends:** <t:${Math.floor(endsAt/1000)}:R>\n\nReact with 🎉 to enter!`).setTimestamp(endsAt);
      const msg  = await ch.send({ embeds:[emb] });
      await msg.react('🎉');
      giveaways[msg.id] = { prize, winners:winCount, channelId:ch.id, guildId:guild.id, endsAt, ended:false };
      saveJson('giveaways.json', giveaways);
      setTimeout(()=>endGiveaway(client,msg.id,guild.id), ms);
      await interaction.editReply(`✅ Giveaway started in ${ch}! Ends <t:${Math.floor(endsAt/1000)}:R>.`);
    } else if (sub === 'end') {
      const msgId = sg(interaction,'message_id');
      if (!msgId) { await interaction.editReply('❌ Missing message ID.'); return; }
      const winners = await endGiveaway(client, msgId, guild.id);
      await interaction.editReply(winners ? `🎉 Giveaway ended! Winners: ${winners.map(w=>`${w}`).join(', ') || '*none*'}` : '❌ Could not end that giveaway (invalid ID or already ended).');
    } else if (sub === 'reroll') {
      const msgId = sg(interaction,'message_id');
      if (!msgId) { await interaction.editReply('❌ Missing message ID.'); return; }
      const gw = giveaways[msgId];
      if (!gw) { await interaction.editReply('❌ Giveaway not found.'); return; }
      gw.ended = false; // Temporarily reset to allow re-roll
      const winners = await endGiveaway(client, msgId, guild.id);
      await interaction.editReply(winners?.length ? `🎲 Rerolled! New winner${winners.length!==1?'s':''}: ${winners.map(w=>`${w}`).join(', ')}` : '❌ No eligible entries for reroll.');
    }

  } else if (commandName === 'ticket') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const reason = sg(interaction,'reason') ?? 'No reason provided';
      const ch = await guild.channels.create({
        name:`ticket-${interaction.user.username}`.slice(0,100).replace(/[^a-z0-9-]/gi,'-'),
        type:ChannelType.GuildText,
        parent:cfg.ticketCategoryId??null,
        permissionOverwrites:[{id:guild.roles.everyone,deny:[PermissionFlagsBits.ViewChannel]},{id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]}],
      });
      await ch.send({ content:`${interaction.user} opened a ticket.`, embeds:[new EmbedBuilder().setColor('#5865F2').setTitle('🎫 Support Ticket').setDescription(`**Reason:** ${reason}\n\nA staff member will assist you shortly.\nUse \`/ticket close\` to close this ticket.`).setTimestamp()] });
      await interaction.editReply(`✅ Ticket created: ${ch}`);
    } else {
      if (!interaction.channel?.name.startsWith('ticket-')) { await interaction.editReply('❌ This is not a ticket channel.'); return; }
      await interaction.editReply('🗑️ Closing ticket in 5 seconds...');
      setTimeout(()=>interaction.channel.delete().catch(()=>{}), 5000);
    }

  } else if (commandName === 'topic') {
    const RANDOM_TOPICS = ['Whats your favorite MCPE game mode?','Hot take: Console gaming > PC gaming','If you could add one block to Minecraft, what would it be?','Whats your best PvP tip?','Favorite MCPE server and why?','Whats a skill you want to improve at?'];
    const text = sg(interaction,'text') ?? RANDOM_TOPICS[Math.floor(Math.random()*RANDOM_TOPICS.length)];
    await interaction.channel.setTopic(text).catch(()=>{});
    await interaction.editReply(`✅ Channel topic set to: *${text}*`);

  } else if (commandName === 'math') {
    const expr = sg(interaction,'expression') ?? '';
    try {
      const safe   = expr.replace(/[^0-9+\-*/().\s%]/g,'');
      const result = Function(`"use strict"; return (${safe})`)();
      await interaction.editReply(`🔢 \`${expr}\` = **${result}**`);
    } catch { await interaction.editReply('❌ Invalid expression. Use numbers and operators: `25 * 4 + 10 / 2`'); }

  } else if (commandName === 'color') {
    const hex   = sg(interaction,'hex') ?? '';
    const clean = hex.startsWith('#') ? hex : `#${hex}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(clean)) { await interaction.editReply('❌ Invalid hex. Use `#RRGGBB` e.g. `#ff0000`.'); return; }
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor(clean).setTitle(`🎨 Color Preview: ${clean}`).setDescription(`**Hex:** \`${clean}\`\n**RGB:** \`${parseInt(clean.slice(1,3),16)}, ${parseInt(clean.slice(3,5),16)}, ${parseInt(clean.slice(5,7),16)}\``)] });

  } else if (commandName === 'weather') {
    const city = sg(interaction,'city') ?? '';
    try {
      const data = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`).then(r=>r.json());
      const cur  = data.current_condition[0];
      const area = data.nearest_area[0];
      const name = area.areaName[0].value;
      const country = area.country[0].value;
      const tempC = cur.temp_C;
      const tempF = cur.temp_F;
      const feels = cur.FeelsLikeC;
      const humid = cur.humidity;
      const wind  = cur.windspeedKmph;
      const desc  = cur.weatherDesc[0].value;
      const emb = new EmbedBuilder().setColor('#5865F2').setTitle(`🌤️ Weather — ${name}, ${country}`)
        .addFields({name:'Condition',value:desc,inline:true},{name:'Temperature',value:`${tempC}°C / ${tempF}°F`,inline:true},{name:'Feels Like',value:`${feels}°C`,inline:true},{name:'Humidity',value:`${humid}%`,inline:true},{name:'Wind',value:`${wind} km/h`,inline:true}).setTimestamp();
      await interaction.editReply({ embeds:[emb] });
    } catch { await interaction.editReply(`❌ Could not fetch weather for **${city}**. Check the city name and try again.`); }

  } else if (commandName === 'translate') {
    const text = sg(interaction,'text') ?? '';
    const to   = sg(interaction,'to') ?? 'en';
    try {
      const res  = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${to}`).then(r=>r.json());
      const translated = res.responseData?.translatedText ?? 'Could not translate.';
      const emb = new EmbedBuilder().setColor('#5865F2').setTitle('🌍 Translation')
        .addFields({name:'Original',value:text.slice(0,1024),inline:false},{name:`Translated (→ ${to})`,value:translated.slice(0,1024),inline:false}).setTimestamp();
      await interaction.editReply({ embeds:[emb] });
    } catch { await interaction.editReply('❌ Translation failed. Try a valid language code: `es`, `fr`, `ja`, `de`, `zh`.'); }

  } else if (commandName === 'qr') {
    const content = encodeURIComponent(sg(interaction,'content') ?? '');
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${content}`;
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle('📱 QR Code').setImage(url).setTimestamp()] });

  } else if (commandName === 'fact') {
    try {
      const data = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en').then(r=>r.json());
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#57F287').setTitle('🧠 Random Fact').setDescription(data.text??'Could not fetch a fact.').setTimestamp()] });
    } catch { await interaction.editReply('❌ Could not fetch a fact. Try again!'); }

  } else if (commandName === 'quote') {
    try {
      const data = await fetch('https://zenquotes.io/api/random').then(r=>r.json());
      const q    = data[0];
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#FFD700').setTitle('💬 Inspirational Quote').setDescription(`*"${q?.q}"*\n\n— **${q?.a}**`).setTimestamp()] });
    } catch { await interaction.editReply('❌ Could not fetch a quote. Try again!'); }

  } else if (commandName === 'birthday') {
    const sub    = interaction.options.getSubcommand();
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (sub === 'set') {
      const month = si(interaction,'month'); const day = si(interaction,'day');
      if (!month || !day) { await interaction.editReply('❌ Missing month or day.'); return; }
      if (!birthdays[guild.id]) birthdays[guild.id] = {};
      birthdays[guild.id][interaction.user.id] = { month, day };
      saveJson('birthdays.json', birthdays);
      await interaction.editReply(`🎂 Birthday saved: **${MONTHS[month-1]} ${day}**!`);
    } else {
      const all  = birthdays[guild.id] ?? {};
      const now  = new Date();
      const cur  = { m:now.getMonth()+1, d:now.getDate() };
      const list = Object.entries(all).map(([uid,bd])=>{ let days=(bd.month-cur.m)*30+(bd.day-cur.d); if(days<0)days+=365; return {uid,...bd,days}; }).sort((a,b)=>a.days-b.days);
      const lines = await Promise.all(list.slice(0,10).map(async e=>{ const u=await client.users.fetch(e.uid).catch(()=>null); return `🎂 **${u?.username??e.uid}** — ${MONTHS[e.month-1]} ${e.day} (${e.days===0?'🎉 Today!':`in ${e.days}d`})`; }));
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#FF6B9D').setTitle('🎂 Upcoming Birthdays').setDescription(lines.join('\n')||'No birthdays yet. Use `/birthday set` to add yours!').setTimestamp()] });
    }

  } else if (commandName === 'suggestion') {
    const text = sg(interaction,'text');
    if (!text) { await interaction.editReply('❌ Missing text.'); return; }
    if (!cfg.suggestionChannelId) { await interaction.editReply('⚠️ No suggestion channel set.'); return; }
    const ch = await guild.channels.fetch(cfg.suggestionChannelId).catch(()=>null);
    if (!ch?.isTextBased()) { await interaction.editReply('❌ Channel not found.'); return; }
    const emb = new EmbedBuilder().setColor('#5865F2').setTitle('💡 Suggestion').setDescription(text).setAuthor({name:interaction.user.username,iconURL:interaction.user.displayAvatarURL()}).setTimestamp();
    const msg = await ch.send({ embeds:[emb] });
    await msg.react('👍').catch(()=>{}); await msg.react('👎').catch(()=>{});
    await interaction.editReply('✅ Suggestion submitted!');

  } else if (commandName === 'confession') {
    const text = sg(interaction,'message');
    if (!text) { await interaction.editReply('❌ Missing message.'); return; }
    if (!cfg.confessionChannelId) { await interaction.editReply('⚠️ No confession channel set.'); return; }
    const ch = await guild.channels.fetch(cfg.confessionChannelId).catch(()=>null);
    if (!ch?.isTextBased()) { await interaction.editReply('❌ Channel not found.'); return; }
    await ch.send({ embeds:[new EmbedBuilder().setColor('#2f3136').setTitle('🕵️ Anonymous Confession').setDescription(text).setFooter({text:'Submitted anonymously.'}).setTimestamp()] });
    await interaction.editReply('✅ Posted anonymously!');

  } else if (commandName === 'coinflip') {
    await interaction.editReply(Math.random()<0.5?'🪙 **Heads!**':'🪙 **Tails!**');

  } else if (commandName === '8ball') {
    const q = sg(interaction,'question');
    if (!q) { await interaction.editReply('❌ Missing question.'); return; }
    const ANSWERS = ['Yes, definitely!','Without a doubt.','Most likely.','Signs point to yes.','It is certain.','Ask again later.','Cannot predict now.','Don\'t count on it.','My reply is no.','My sources say no.','Very doubtful.','Outlook not so good.'];
    await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle('🎱 Magic 8-Ball').addFields({name:'❓ Question',value:q},{name:'🎱 Answer',value:`**${ANSWERS[Math.floor(Math.random()*ANSWERS.length)]}**`}).setTimestamp()] });

  } else if (commandName === 'meme') {
    try {
      const subs = ['memes','dankmemes','me_irl'];
      const sub  = subs[Math.floor(Math.random()*subs.length)];
      const res  = await fetch(`https://www.reddit.com/r/${sub}/random.json`,{headers:{'User-Agent':'PokeFanBot/3.0'}}).then(r=>r.json());
      const post = res[0]?.data?.children[0]?.data;
      if (!post?.url) throw new Error('no post');
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#FF4500').setTitle(post.title).setImage(post.url).setFooter({text:`👍 ${post.ups} · r/${sub}`}).setURL(`https://reddit.com${post.permalink}`)] });
    } catch { await interaction.editReply('❌ Could not fetch a meme. Try again!'); }

  } else if (commandName === 'time') {
    const country = sg(interaction,'country') ?? '';
    try {
      const zones = await fetch('https://worldtimeapi.org/api/timezone').then(r=>r.json());
      const zone  = Array.isArray(zones) ? zones.find(z=>z.toLowerCase().includes(country.toLowerCase())) : null;
      if (!zone) { await interaction.editReply(`❌ No timezone found for **${country}**.`); return; }
      const data  = await fetch(`https://worldtimeapi.org/api/timezone/${zone}`).then(r=>r.json());
      await interaction.editReply({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle(`🕐 Time — ${country}`).addFields({name:'Timezone',value:`\`${zone}\``,inline:true},{name:'Current Time',value:(data.datetime??'?').split('.')[0].replace('T',' '),inline:true}).setTimestamp()] });
    } catch { await interaction.editReply(`❌ Could not fetch the time for **${country}**.`); }

  } else if (commandName === 'set-suggestion-channel') {
    const ch = sch(interaction,'channel'); cfg.suggestionChannelId = ch?.id; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Suggestion channel → ${ch}.` : '❌ Channel not found.');
  } else if (commandName === 'set-confession-channel') {
    const ch = sch(interaction,'channel'); cfg.confessionChannelId = ch?.id; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Confession channel → ${ch}.` : '❌ Channel not found.');
  } else if (commandName === 'set-ticket-category') {
    const ch = sch(interaction,'category'); cfg.ticketCategoryId = ch?.id; saveGuildCfg();
    await interaction.editReply(ch ? `✅ Ticket category → **${ch.name}**.` : '❌ Not found.');

  } else {
    await interaction.editReply('⚠️ Unknown command. Commands may still be syncing with Discord (wait 1-2 minutes, or ensure DISCORD_GUILD_ID is set in Railway).');
  }
}

// ─── BOT CLIENT ──────────────────────────────────────────────────────────────
const TOKEN    = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
if (!TOKEN) throw new Error('DISCORD_TOKEN env var is missing. Set it in Railway → Variables.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', async c => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  const rest = new REST({ version:'10' }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), { body:commands });
      console.log(`✅ Guild commands synced instantly for ${GUILD_ID}`);
    }
    await rest.put(Routes.applicationCommands(c.user.id), { body:commands });
    console.log('✅ Global commands registered (propagate up to 1h)');
  } catch (e) { console.error('Command registration error:', e.message); }

  // Scheduled tasks
  setInterval(()=>checkReminders(c), 15000);
  setInterval(()=>checkYouTubeChannels(c), 10*60*1000);  // every 10 minutes
  setInterval(()=>updateStatChannels(c), 10*60*1000);     // every 10 minutes
  setInterval(()=>checkGiveaways(c), 30000);
  // Initial run
  setTimeout(()=>checkYouTubeChannels(c), 5000);
  setTimeout(()=>updateStatChannels(c), 5000);
});

// ── Message events ──
client.on('messageCreate', async msg => {
  if (msg.author.bot || !msg.guild) return;

  // AFK check
  if (msg.mentions.users.size) {
    for (const [uid, afk] of Object.entries(afkUsers)) {
      if (msg.mentions.users.has(uid)) {
        const ago = fmtMs(Date.now()-afk.since);
        msg.reply({ content:`⚠️ <@${uid}> is AFK: **${afk.reason}** (${ago} ago)`, allowedMentions:{repliedUser:false} }).catch(()=>{});
      }
    }
  }
  if (afkUsers[msg.author.id]) {
    delete afkUsers[msg.author.id];
    saveJson('afk-users.json', afkUsers);
    msg.reply({ content:'👋 Welcome back! Your AFK status has been removed.', allowedMentions:{repliedUser:false} }).catch(()=>{});
  }

  // XP gain (throttled per user, once every 60s)
  const lastXP = msgCooldown.get(msg.author.id) ?? 0;
  if (Date.now()-lastXP >= 60000) {
    msgCooldown.set(msg.author.id, Date.now());
    const xp = getXP(msg.author.id);
    const gained = Math.floor(Math.random()*10)+5;
    xp.xp += gained;
    if (xp.xp >= xpForLevel(xp.level+1)) {
      xp.xp -= xpForLevel(xp.level+1);
      xp.level++;
      msg.channel.send({ content:`🎉 <@${msg.author.id}> leveled up to **Level ${xp.level}**! ⭐`, allowedMentions:{users:[msg.author.id]} }).catch(()=>{});
    }
    saveJson('xp-data.json', xpData);
  }

  // Message stats
  msgStats[msg.author.id] = (msgStats[msg.author.id]??0)+1;
  if (msgStats[msg.author.id]%100===0) saveJson('msg-stats.json', msgStats);

  // Sticky message handling
  const sticky = stickyMsgs[msg.channelId];
  if (sticky && msg.id !== sticky.lastMsgId) {
    try {
      if (sticky.lastMsgId) await msg.channel.messages.fetch(sticky.lastMsgId).then(m=>m.delete()).catch(()=>{});
      const sent = await msg.channel.send({ embeds:[new EmbedBuilder().setColor('#5865F2').setTitle('📌 Pinned Message').setDescription(sticky.content)] });
      stickyMsgs[msg.channelId].lastMsgId = sent.id;
      saveJson('sticky-msgs.json', stickyMsgs);
    } catch {}
  }
});

client.on('messageDelete', msg => {
  if (!msg.partial && msg.content) {
    snipeCache[msg.channelId] = { content:msg.content.slice(0,2000), author:msg.author?.username??'Unknown', avatar:msg.author?.displayAvatarURL()??null, time:Date.now() };
  }
});

client.on('messageUpdate', (old, now) => {
  if (!old.partial && !now.partial && old.content !== now.content) {
    editSnipe[old.channelId] = { before:(old.content||'').slice(0,1024), after:(now.content||'').slice(0,1024), author:old.author?.username??'Unknown', avatar:old.author?.displayAvatarURL()??null, time:Date.now() };
  }
});

// Reaction roles
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const guild = reaction.message.guild;
  if (!guild) return;
  const rrs = reactionRoles[guild.id] ?? [];
  const rr  = rrs.find(r=>r.messageId===reaction.message.id&&r.emoji===reaction.emoji.name||r.emoji===reaction.emoji.toString());
  if (!rr) return;
  const member = await guild.members.fetch(user.id).catch(()=>null);
  if (member) await member.roles.add(rr.roleId).catch(()=>{});
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
  const guild = reaction.message.guild;
  if (!guild) return;
  const rrs = reactionRoles[guild.id] ?? [];
  const rr  = rrs.find(r=>r.messageId===reaction.message.id&&(r.emoji===reaction.emoji.name||r.emoji===reaction.emoji.toString()));
  if (!rr) return;
  const member = await guild.members.fetch(user.id).catch(()=>null);
  if (member) await member.roles.remove(rr.roleId).catch(()=>{});
});

// Welcome & auto-role
client.on('guildMemberAdd', async member => {
  const cfg = getGuildCfg(member.guild.id);
  if (cfg.welcomeChannelId) {
    try {
      const ch = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(()=>null);
      if (ch?.isTextBased()) {
        const emb = new EmbedBuilder().setColor('#57F287').setTitle(`👋 Welcome to ${member.guild.name}!`)
          .setDescription(`Welcome ${member}! You are member **#${member.guild.memberCount}**.\nCheck out the rules and enjoy your stay!`)
          .setThumbnail(member.user.displayAvatarURL({size:256})).setTimestamp();
        await ch.send({ content:`${member}`, embeds:[emb] });
      }
    } catch {}
  }
  if (cfg.autoRoleId) {
    try { await member.roles.add(cfg.autoRoleId); } catch {}
  }
});

// ── Interaction wrapper ──
client.on('interactionCreate', async interaction => {
  try {
    await handleInteraction(interaction, client);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error (${interaction.commandName??interaction.customId}):`, err.message);
    try {
      const msg = `❌ An error occurred: \`${err.message}\`\nMake sure \`DISCORD_GUILD_ID\` is set in Railway so commands sync instantly.`;
      if (interaction.replied || interaction.deferred) await interaction.editReply(msg).catch(()=>{});
      else if (interaction.isChatInputCommand()||interaction.isModalSubmit()) await interaction.reply({content:msg,ephemeral:true}).catch(()=>{});
    } catch {}
  }
});

client.on('error', err => console.error('Client error:', err.message));

// ─── SCHEDULERS ───────────────────────────────────────────────────────────────
async function checkReminders(c) {
  const now = Date.now();
  let changed = false;
  for (const [uid, list] of Object.entries(reminders)) {
    const due  = list.filter(r=>r.fireAt<=now);
    const keep = list.filter(r=>r.fireAt>now);
    if (!due.length) continue;
    changed = true;
    reminders[uid] = keep;
    for (const r of due) {
      const u = await c.users.fetch(uid).catch(()=>null);
      if (u) await u.send(`⏰ **Reminder:** ${r.msg}`).catch(()=>{});
    }
  }
  if (changed) saveJson('reminders.json', reminders);
}

async function checkGiveaways(c) {
  const now = Date.now();
  for (const [msgId, gw] of Object.entries(giveaways)) {
    if (!gw.ended && gw.endsAt <= now) {
      await endGiveaway(c, msgId, gw.guildId);
    }
  }
}

// ─── HEALTH SERVER ────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type':'text/plain' });
  res.end(`PokeFanIconZ Bot v3.0 • Online • ${new Date().toISOString()}\n`);
}).listen(PORT, ()=>console.log(`🌐 Health server on port ${PORT}`));

// ─── LOGIN ────────────────────────────────────────────────────────────────────
client.login(TOKEN).catch(err => { console.error('❌ Login failed:', err.message); process.exit(1); });
