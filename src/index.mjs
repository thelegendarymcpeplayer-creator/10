import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, EmbedBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, AttachmentBuilder
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'bot-data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// DATA STORE
// ─────────────────────────────────────────────────────────────────────────────
function loadJson(file, def = {}) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
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
let birthdays     = loadJson('birthdays.json');
let giveaways     = loadJson('giveaways.json');
let reminders     = loadJson('reminders.json');
let tickets       = loadJson('tickets.json');
let inviteCache   = {};
let snipeCache    = {};    // channelId → { content, author, time }
let editSnipe     = {};    // channelId → { before, after, author, time }
let afkMap        = {};    // userId → reason

function getGuildCfg(gid) {
  if (!guildConfigs[gid]) guildConfigs[gid] = {};
  return guildConfigs[gid];
}
function saveGuildCfg() { saveJson('guild-configs.json', guildConfigs); }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const MCPE_SERVERS = ['Hive', 'CubeCraft', 'Zeqa', 'Mineplex', 'Galaxite', 'NetherGames', 'Custom'];

function progressBar(score) {
  const filled = Math.round(Math.max(0, Math.min(100, score)) / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}
function getGrade(score) {
  if (score >= 90) return { letter: 'S', label: 'Legendary',     color: '#FFD700' };
  if (score >= 80) return { letter: 'A', label: 'Excellent',     color: '#5865F2' };
  if (score >= 70) return { letter: 'B', label: 'Good',          color: '#57F287' };
  if (score >= 60) return { letter: 'C', label: 'Average',       color: '#FEE75C' };
  if (score >= 50) return { letter: 'D', label: 'Below Average', color: '#ED4245' };
  return                   { letter: 'F', label: 'Poor',          color: '#99AAB5' };
}
function parseMs(str) {
  const m = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const n = parseInt(m[1]);
  const u = m[2].toLowerCase();
  return u === 's' ? n*1000 : u === 'm' ? n*60000 : u === 'h' ? n*3600000 : n*86400000;
}
function fmtMs(ms) {
  if (ms < 60000) return `${Math.floor(ms/1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms/60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)}h`;
  return `${Math.floor(ms/86400000)}d`;
}
function hexToInt(hex) {
  const h = hex?.replace('#','');
  const n = parseInt(h, 16);
  return isNaN(n) ? 0x5865F2 : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function isServerOwner(interaction) {
  return interaction.guild?.ownerId === interaction.user.id;
}
function hasTierTesterRole(interaction) {
  const cfg = getGuildCfg(interaction.guildId);
  if (!cfg.tierTesterRoleId) return true; // no restriction set
  return interaction.member?.roles?.cache?.has(cfg.tierTesterRoleId);
}

// ─────────────────────────────────────────────────────────────────────────────
// ECONOMY
// ─────────────────────────────────────────────────────────────────────────────
function getBal(uid) {
  if (!economy[uid]) economy[uid] = { emeralds: 0, rubies: 0 };
  return economy[uid];
}
function addEm(uid, n) { getBal(uid).emeralds += n; saveJson('economy.json', economy); }
function addRuby(uid, n) { getBal(uid).rubies += n; saveJson('economy.json', economy); }

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────────────────────────────────────
const MCPE_SERVER_CHOICES = MCPE_SERVERS.map(s => ({ name: s, value: s }));

const commands = [
  // ── TIER TESTING (redesigned) ──────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('create-sheet')
    .setDescription('Create an MCPE tier evaluation sheet for a player')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Player being evaluated').setRequired(true))
    .addStringOption(o => o.setName('server').setDescription('MCPE Server network').setRequired(true)
      .addChoices(...MCPE_SERVER_CHOICES))
    .addChannelOption(o => o.setName('result_channel').setDescription('Override: channel to post results (uses configured tier channel by default)'))
    .addUserOption(o => o.setName('dm_user2').setDescription('Extra user to DM the results to'))
    .addUserOption(o => o.setName('dm_user3').setDescription('Another user to DM the results to')),

  new SlashCommandBuilder()
    .setName('set-tier-channel')
    .setDescription('Set the channel where tier test results are posted (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set-tier-tester-role')
    .setDescription('Set which role can use DM commands — only usable by the server owner')
    .addRoleOption(o => o.setName('role').setDescription('Tier tester role').setRequired(true)),

  new SlashCommandBuilder()
    .setName('tier-list')
    .setDescription('Create an MCPE tier list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('title').setDescription('Tier list title'))
    .addBooleanOption(o => o.setName('public').setDescription('Post publicly? (default: Yes)')),

  // ── DM ────────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('dm-user')
    .setDescription('Send a custom DM to a specific user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('User to DM').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Embed title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text')),

  new SlashCommandBuilder()
    .setName('dm-all')
    .setDescription('Mass DM every member (Tier Tester/Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('message').setDescription('Message body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Embed title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text')),

  new SlashCommandBuilder()
    .setName('dm-role')
    .setDescription('DM all members with a role')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addRoleOption(o => o.setName('role').setDescription('Target role').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Embed title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color'))
    .addStringOption(o => o.setName('footer').setDescription('Footer text')),

  // ── Moderation ────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('warn').setDescription('Issue a warning to a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),

  new SlashCommandBuilder().setName('warnings').setDescription('View warnings for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Member to check').setRequired(true)),

  new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear all warnings (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Member to clear').setRequired(true)),

  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .addIntegerOption(o => o.setName('delete-messages').setDescription('Delete messages from N days (0–7)').setMinValue(0).setMaxValue(7)),

  new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user-id').setDescription('Discord User ID').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),

  new SlashCommandBuilder().setName('nickname').setDescription('Change or reset a nickname')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName('user').setDescription('Target').setRequired(true))
    .addStringOption(o => o.setName('nickname').setDescription('New nickname (blank = reset)')),

  new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('Messages to delete (1–100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('seconds').setDescription('Slowmode in seconds (0 = disable)').setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder().setName('lockdown').setDescription('Lock all channels (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('unlockdown').setDescription('Lift the lockdown (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('role-add').setDescription('Add a role to a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to add').setRequired(true)),

  new SlashCommandBuilder().setName('role-remove').setDescription('Remove a role from a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)),

  // ── Reports ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('report').setDescription('Report a member to the mod team')
    .addUserOption(o => o.setName('user').setDescription('Member to report').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .addAttachmentOption(o => o.setName('proof').setDescription('Proof image (optional)')),

  new SlashCommandBuilder().setName('set-report-channel').setDescription('Set the report channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),

  // ── Welcome ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('set-welcome-channel').setDescription('Set the welcome channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),

  // ── Info ──────────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('invites').setDescription('View invite stats for a member')
    .addUserOption(o => o.setName('user').setDescription('Member to check')),

  new SlashCommandBuilder().setName('userinfo').setDescription('View detailed info about a member')
    .addUserOption(o => o.setName('user').setDescription('Member to inspect')),

  new SlashCommandBuilder().setName('serverinfo').setDescription('View detailed server statistics'),

  new SlashCommandBuilder().setName('avatar').setDescription("View a user's avatar in full size")
    .addUserOption(o => o.setName('user').setDescription('Member')),

  new SlashCommandBuilder().setName('roleinfo').setDescription('View detailed info about a role')
    .addRoleOption(o => o.setName('role').setDescription('Role to inspect').setRequired(true)),

  new SlashCommandBuilder().setName('ping').setDescription("Check the bot's latency"),
  new SlashCommandBuilder().setName('botinfo').setDescription('View bot information and uptime'),

  new SlashCommandBuilder().setName('profile').setDescription("View a member's full profile card")
    .addUserOption(o => o.setName('user').setDescription('Member')),

  new SlashCommandBuilder().setName('stats').setDescription('View message activity stats')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Member to check')),

  // ── Economy ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('balance').setDescription('Check your balance')
    .addUserOption(o => o.setName('user').setDescription('Check another user')),

  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily 200 💎 Emeralds'),

  new SlashCommandBuilder().setName('give-ruby').setDescription('Give rubies to a member (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 richest members in the server'),
  new SlashCommandBuilder().setName('msg-leaderboard').setDescription('Top 10 most active members by messages'),

  new SlashCommandBuilder().setName('shop').setDescription('Open the server shop')
    .addSubcommand(s => s.setName('menu').setDescription('Browse the shop'))
    .addSubcommand(s => s.setName('create-role').setDescription('Buy a custom role (2,500 💎)')
      .addStringOption(o => o.setName('name').setDescription('Role name').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('Hex color').setRequired(true)))
    .addSubcommand(s => s.setName('redeem').setDescription('Redeem a code')
      .addStringOption(o => o.setName('code').setDescription('Your code').setRequired(true))),

  new SlashCommandBuilder().setName('create-code').setDescription('Create a reward code (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('code').setDescription('Code string').setRequired(true))
    .addIntegerOption(o => o.setName('emeralds').setDescription('Emeralds reward').setMinValue(0))
    .addIntegerOption(o => o.setName('rubies').setDescription('Rubies reward').setMinValue(0))
    .addIntegerOption(o => o.setName('max-uses').setDescription('Max uses (default 1)').setMinValue(1)),

  // ── Utility ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('poll').setDescription('Create a voting poll in this channel')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption(o => o.setName('option1').setDescription('Option 1'))
    .addStringOption(o => o.setName('option2').setDescription('Option 2'))
    .addStringOption(o => o.setName('option3').setDescription('Option 3'))
    .addStringOption(o => o.setName('option4').setDescription('Option 4')),

  new SlashCommandBuilder().setName('announce').setDescription('Send an announcement embed to a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Announcement body').setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Title'))
    .addStringOption(o => o.setName('color').setDescription('Hex color')),

  new SlashCommandBuilder().setName('say').setDescription('Have the bot say a message in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),

  new SlashCommandBuilder().setName('embed').setDescription('Build and send a custom embed (opens a form)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder().setName('snipe').setDescription('Show the last deleted message in this channel'),
  new SlashCommandBuilder().setName('editsnipe').setDescription('Show the last edited message in this channel'),

  new SlashCommandBuilder().setName('reminder').setDescription('Set a personal reminder')
    .addStringOption(o => o.setName('time').setDescription('Duration: 10s / 30m / 2h / 1d (max 7d)').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Reminder message').setRequired(true)),

  new SlashCommandBuilder().setName('giveaway').setDescription('Giveaway management')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName('start').setDescription('Start a new giveaway')
      .addStringOption(o => o.setName('prize').setDescription('Prize description').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration: 10m / 1h / 7d').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(10))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post in')))
    .addSubcommand(s => s.setName('end').setDescription('End a giveaway early')
      .addStringOption(o => o.setName('message-id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand(s => s.setName('reroll').setDescription('Reroll giveaway winners')
      .addStringOption(o => o.setName('message-id').setDescription('Giveaway message ID').setRequired(true))),

  new SlashCommandBuilder().setName('ticket').setDescription('Support ticket system')
    .addSubcommand(s => s.setName('create').setDescription('Open a new support ticket')
      .addStringOption(o => o.setName('reason').setDescription('What do you need help with?')))
    .addSubcommand(s => s.setName('close').setDescription('Close this ticket channel')),

  new SlashCommandBuilder().setName('math').setDescription('Calculate a math expression')
    .addStringOption(o => o.setName('expression').setDescription('e.g. 25 * 4 + 10 / 2').setRequired(true)),

  new SlashCommandBuilder().setName('color').setDescription('Preview a hex color')
    .addStringOption(o => o.setName('hex').setDescription('Hex color code e.g. #ff0000').setRequired(true)),

  new SlashCommandBuilder().setName('birthday').setDescription('Birthday system')
    .addSubcommand(s => s.setName('set').setDescription('Save your birthday')
      .addIntegerOption(o => o.setName('month').setDescription('Month (1–12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption(o => o.setName('day').setDescription('Day (1–31)').setRequired(true).setMinValue(1).setMaxValue(31)))
    .addSubcommand(s => s.setName('upcoming').setDescription('View upcoming birthdays in the server')),

  new SlashCommandBuilder().setName('suggestion').setDescription('Submit a suggestion for the server')
    .addStringOption(o => o.setName('text').setDescription('Your suggestion').setRequired(true)),

  new SlashCommandBuilder().setName('confession').setDescription('Post an anonymous confession')
    .addStringOption(o => o.setName('message').setDescription('Your anonymous message').setRequired(true)),

  new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin — heads or tails?'),

  new SlashCommandBuilder().setName('8ball').setDescription('Ask the Magic 8-Ball a question')
    .addStringOption(o => o.setName('question').setDescription('Your yes/no question').setRequired(true)),

  new SlashCommandBuilder().setName('meme').setDescription('Fetch a random meme from the internet'),

  new SlashCommandBuilder().setName('time').setDescription('Check time in any country')
    .addStringOption(o => o.setName('country').setDescription('Country name').setRequired(true)),

  // ── Admin Setup ───────────────────────────────────────────────────────────
  new SlashCommandBuilder().setName('set-suggestion-channel').setDescription('Set the suggestion channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),

  new SlashCommandBuilder().setName('set-confession-channel').setDescription('Set the confession channel (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('channel').setDescription('Text channel').setRequired(true)),

  new SlashCommandBuilder().setName('set-ticket-category').setDescription('Set the category for ticket channels (Admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('category').setDescription('Category channel').setRequired(true)),
].map(c => c.toJSON());

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY SESSION MAPS
// ─────────────────────────────────────────────────────────────────────────────
const pendingSheets    = new Map(); // interactionId → ctx
const pendingTierLists = new Map();
const pendingEmbeds    = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// CREATE-SHEET HANDLER (redesigned)
// ─────────────────────────────────────────────────────────────────────────────
async function handleCreateSheet(interaction) {
  const user   = interaction.options.getUser('user', true);
  const server = interaction.options.getString('server', true);
  const resultChannel = interaction.options.getChannel('result_channel');
  const dmUser2 = interaction.options.getUser('dm_user2');
  const dmUser3 = interaction.options.getUser('dm_user3');

  // Store session data BEFORE showing modal
  pendingSheets.set(interaction.id, {
    targetUserId:    user.id,
    server,
    resultChannelId: resultChannel?.id ?? null,
    dmUser2Id:       dmUser2?.id ?? null,
    dmUser3Id:       dmUser3?.id ?? null,
    givenBy:         interaction.user.username,
    givenById:       interaction.user.id,
    guildId:         interaction.guildId,
  });

  const modal = new ModalBuilder()
    .setCustomId(`sheet_${interaction.id}`)
    .setTitle(`🎮 Tier Evaluation — ${server}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('game')
        .setLabel('Game Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. SkyWars, BedWars, Crystal PvP, Sumo...')
        .setRequired(true)
        .setMaxLength(50)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('results')
        .setLabel('Game Mode Results  (Mode: score per line, 0–100)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('SkyWars: 87\nBedWars: 74\nSumo: 91\nCrystal PvP: 68\nNethPot: 82')
        .setRequired(true)
        .setMaxLength(700)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('student_info')
        .setLabel('Student Info (playtime, rank, other notes)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. Diamond rank, 200h playtime, main: SkyWars')
        .setRequired(false)
        .setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Tier Tester Notes & Recommendations')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Write your overall evaluation, feedback, or recommendations for the player...')
        .setRequired(false)
        .setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('tier_override')
        .setLabel('Tier Override (optional: S / A / B / C / D / F)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Leave blank to auto-calculate from scores')
        .setRequired(false)
        .setMaxLength(2)
    )
  );

  await interaction.showModal(modal);
}

async function handleSheetModalSubmit(interaction) {
  // MUST defer first to avoid "application not responding"
  await interaction.deferReply({ ephemeral: true });

  const interactionId = interaction.customId.replace('sheet_', '');
  const ctx = pendingSheets.get(interactionId);
  pendingSheets.delete(interactionId);

  if (!ctx) {
    await interaction.editReply('❌ Session expired. Please run `/create-sheet` again.');
    return;
  }

  const guild = interaction.guild;
  const game        = interaction.fields.getTextInputValue('game').trim();
  const resultsRaw  = interaction.fields.getTextInputValue('results').trim();
  const studentInfo = interaction.fields.getTextInputValue('student_info').trim() || null;
  const notes       = interaction.fields.getTextInputValue('notes').trim() || null;
  const tierOvr     = interaction.fields.getTextInputValue('tier_override').trim().toUpperCase() || null;

  // Fetch target user
  const targetUser = await guild.client.users.fetch(ctx.targetUserId).catch(() => null);
  if (!targetUser) {
    await interaction.editReply('❌ Could not fetch the selected player.');
    return;
  }
  const targetMember = await guild.members.fetch(ctx.targetUserId).catch(() => null);

  // Parse game mode results
  const lines = resultsRaw.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 10);
  const parsed = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const mode  = line.slice(0, colonIdx).trim();
    const score = Math.min(100, Math.max(0, parseInt(line.slice(colonIdx + 1).trim(), 10) || 0));
    if (mode) parsed.push({ mode, score });
  }

  if (parsed.length === 0) {
    await interaction.editReply('❌ No valid results found. Use format: `SkyWars: 85` (one per line).');
    return;
  }

  const avg = Math.round(parsed.reduce((s, e) => s + e.score, 0) / parsed.length);
  const validLetters = ['S','A','B','C','D','F'];
  const overallGrade = tierOvr && validLetters.includes(tierOvr)
    ? { letter: tierOvr, label: { S:'Legendary', A:'Excellent', B:'Good', C:'Average', D:'Below Average', F:'Poor' }[tierOvr] }
    : getGrade(avg);

  const gradeColor = { S:'#FFD700', A:'#5865F2', B:'#57F287', C:'#FEE75C', D:'#ED4245', F:'#99AAB5' }[overallGrade.letter] ?? '#5865F2';

  const acctAge  = Math.floor((Date.now() - targetUser.createdTimestamp) / 86400000);
  const joinedAt = targetMember?.joinedAt
    ? `<t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:D>` : 'Unknown';

  // Build game mode results fields (two-column layout: name | bar + score)
  const modeLines = parsed.map(({ mode, score }) => {
    const g   = getGrade(score);
    const bar = progressBar(score);
    return `\`${mode.padEnd(14)}\` \`${bar}\` **${score}**/100 — \`${g.letter}\``;
  }).join('\n');

  const serverIcon = guild.iconURL({ size: 256 });

  const embed = new EmbedBuilder()
    .setColor(gradeColor)
    .setTitle(`🎮 Tier Evaluation Sheet — ${ctx.server}`)
    // Show selected player's avatar prominently at the top
    .setAuthor({
      name:    `${targetUser.username}${targetMember?.nickname ? ` (${targetMember.nickname})` : ''}`,
      iconURL: targetUser.displayAvatarURL({ size: 256 }),
    })
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .addFields(
      // ── Player Identity ──
      {
        name: '👤 Player',
        value: [
          `**Username:** ${targetUser.username}`,
          `**Mention:** ${targetUser}`,
          `**User ID:** \`${targetUser.id}\``,
          `**Account Age:** ${acctAge} days`,
          `**Joined Server:** ${joinedAt}`,
          studentInfo ? `**Info:** ${studentInfo}` : null,
        ].filter(Boolean).join('\n'),
        inline: true,
      },
      // ── Sheet Meta ──
      {
        name: '📋 Sheet Info',
        value: [
          `**Network:** ${ctx.server}`,
          `**Game:** ${game}`,
          `**Evaluated By:** ${ctx.givenBy}`,
          `**Date:** <t:${Math.floor(Date.now() / 1000)}:D>`,
          `**Modes Tested:** ${parsed.length}`,
        ].join('\n'),
        inline: true,
      },
      { name: '─────────────────────────────', value: ' ', inline: false },
      // ── Game Mode Results ──
      {
        name: '📊 Game Mode Results',
        value: modeLines,
        inline: false,
      },
      { name: '─────────────────────────────', value: ' ', inline: false },
      // ── Overall Grade ──
      {
        name: '🏁 Overall Result',
        value: [
          `\`${progressBar(avg)}\``,
          `**Average Score:** ${avg}/100`,
          `**Overall Grade:** \`${overallGrade.letter}\` — ${overallGrade.label}`,
        ].join('\n'),
        inline: false,
      },
    );

  if (notes) {
    embed.addFields({ name: '📝 Tier Tester Notes', value: notes, inline: false });
  }

  embed.setFooter({
    text: `${guild.name} · Tier Evaluation`,
    iconURL: serverIcon ?? undefined,
  }).setTimestamp();

  // ── Determine result channel ──
  const cfg = getGuildCfg(guild.id);
  const channelId = ctx.resultChannelId ?? cfg.tierChannelId ?? null;
  let postedInChannel = false;

  if (channelId) {
    try {
      const ch = await guild.channels.fetch(channelId).catch(() => null);
      if (ch?.isTextBased()) {
        await ch.send({
          content: `📋 New tier evaluation for ${targetUser}!`,
          embeds: [embed],
        });
        postedInChannel = true;
      }
    } catch { /* ignore */ }
  }

  // ── DM the evaluated player ──
  let dmResults = [];
  const dmTargets = [
    ctx.targetUserId,
    ctx.dmUser2Id,
    ctx.dmUser3Id,
  ].filter(Boolean);

  for (const uid of dmTargets) {
    try {
      const u = await guild.client.users.fetch(uid).catch(() => null);
      if (!u) { dmResults.push(`❌ Couldn't find user \`${uid}\``); continue; }
      await u.send({
        content: `📋 You received a **Tier Evaluation** from **${guild.name}**!`,
        embeds: [embed],
      });
      dmResults.push(`✅ DM sent to **${u.username}**`);
    } catch {
      dmResults.push(`⚠️ Could not DM **<@${uid}>** — DMs may be disabled.`);
    }
  }

  const lines2 = [];
  lines2.push('✅ Evaluation sheet created!');
  if (postedInChannel) lines2.push(`📢 Posted in <#${channelId}>`);
  else lines2.push('⚠️ No tier channel configured — use `/set-tier-channel` or pass `result_channel` to post publicly.');
  if (dmResults.length) lines2.push(...dmResults);

  await interaction.editReply(lines2.join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER-LIST HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleTierList(interaction) {
  const title    = interaction.options.getString('title') ?? 'MCPE Tier List';
  const isPublic = interaction.options.getBoolean('public') ?? true;
  pendingTierLists.set(interaction.id, { title, isPublic });

  const modal = new ModalBuilder()
    .setCustomId(`tierlist_${interaction.id}`)
    .setTitle('MCPE Tier List — Fill in Tiers');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('s_tier').setLabel('🌟 S Tier — Legendary (90-100)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('a_tier').setLabel('🔴 A Tier — Excellent (80-89)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('b_tier').setLabel('🟠 B Tier — Good (70-79)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('c_tier').setLabel('🟡 C Tier — Average (60-69)').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('d_tier').setLabel('⚫ D/F Tier — Below Average / Poor').setStyle(TextInputStyle.Short).setPlaceholder('Player1, Player2').setRequired(false).setMaxLength(200)
    )
  );
  await interaction.showModal(modal);
}

async function handleTierListModalSubmit(interaction) {
  const interactionId = interaction.customId.replace('tierlist_', '');
  const ctx = pendingTierLists.get(interactionId);
  pendingTierLists.delete(interactionId);
  const title    = ctx?.title ?? 'MCPE Tier List';
  const isPublic = ctx?.isPublic ?? true;
  await interaction.deferReply({ ephemeral: !isPublic });

  const tiers = [
    { key: 's_tier', label: 'S Tier', emoji: '🌟', sub: 'Legendary (90-100)' },
    { key: 'a_tier', label: 'A Tier', emoji: '🔴', sub: 'Excellent (80-89)'  },
    { key: 'b_tier', label: 'B Tier', emoji: '🟠', sub: 'Good (70-79)'       },
    { key: 'c_tier', label: 'C Tier', emoji: '🟡', sub: 'Average (60-69)'    },
    { key: 'd_tier', label: 'D/F Tier', emoji: '⚫', sub: 'Below Average / Poor' },
  ];
  const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🏆 ${title}`).setTimestamp();
  const serverIcon = interaction.guild?.iconURL({ size: 256 });
  if (serverIcon) embed.setThumbnail(serverIcon);
  let hasContent = false;
  for (const tier of tiers) {
    const raw = interaction.fields.getTextInputValue(tier.key).trim();
    if (!raw) continue;
    hasContent = true;
    const players = raw.split(',').map(p => p.trim()).filter(Boolean);
    embed.addFields({ name: `${tier.emoji} ${tier.label} — ${tier.sub}`, value: players.map(p => `• **${p}**`).join('\n'), inline: false });
  }
  if (!hasContent) embed.setDescription('No players added to any tier.');
  embed.setFooter({ text: `${interaction.guild?.name ?? 'Server'} · MCPE Tier List`, iconURL: serverIcon ?? undefined });
  await interaction.editReply({ embeds: [embed] });
}

// ─────────────────────────────────────────────────────────────────────────────
// EMBED BUILDER
// ─────────────────────────────────────────────────────────────────────────────
async function handleEmbedBuilder(interaction) {
  pendingEmbeds.set(interaction.id, { channelId: interaction.channelId });
  const modal = new ModalBuilder().setCustomId(`embed_${interaction.id}`).setTitle('Custom Embed Builder');
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Embed Title').setStyle(TextInputStyle.Short).setPlaceholder('My Announcement').setRequired(false).setMaxLength(256)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Embed Description / Body').setStyle(TextInputStyle.Paragraph).setPlaceholder('Type your message here...').setRequired(true).setMaxLength(4000)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('color').setLabel('Color (Hex, e.g. #5865f2)').setStyle(TextInputStyle.Short).setPlaceholder('#5865f2').setRequired(false).setMaxLength(7)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('footer').setLabel('Footer Text').setStyle(TextInputStyle.Short).setPlaceholder('Optional footer text').setRequired(false).setMaxLength(2048)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image URL (optional)').setStyle(TextInputStyle.Short).setPlaceholder('https://example.com/image.png').setRequired(false))
  );
  await interaction.showModal(modal);
}

async function handleEmbedModalSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const interactionId = interaction.customId.replace('embed_', '');
  const ctx = pendingEmbeds.get(interactionId);
  pendingEmbeds.delete(interactionId);
  const title    = interaction.fields.getTextInputValue('title').trim() || null;
  const desc     = interaction.fields.getTextInputValue('description').trim();
  const colorRaw = interaction.fields.getTextInputValue('color').trim();
  const footer   = interaction.fields.getTextInputValue('footer').trim() || null;
  const image    = interaction.fields.getTextInputValue('image').trim() || null;
  const color    = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : '#5865F2';
  const embed    = new EmbedBuilder().setColor(color).setDescription(desc).setTimestamp();
  if (title)  embed.setTitle(title);
  if (footer) embed.setFooter({ text: footer });
  if (image)  embed.setImage(image);
  const channelId = ctx?.channelId ?? interaction.channelId;
  try {
    const ch = await interaction.client.channels.fetch(channelId);
    await ch.send({ embeds: [embed] });
    await interaction.editReply('✅ Embed posted!');
  } catch {
    await interaction.editReply({ content: '⚠️ Could not post to channel, but here is a preview:', embeds: [embed] });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DM HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function sendDMEmbed(interaction, members, opts) {
  let sent = 0, failed = 0;
  const embed = new EmbedBuilder().setColor(hexToInt(opts.color)).setDescription(opts.message).setTimestamp();
  if (opts.title)  embed.setTitle(opts.title);
  if (opts.footer) embed.setFooter({ text: opts.footer });
  if (interaction.guild?.name) embed.setAuthor({ name: interaction.guild.name, iconURL: interaction.guild.iconURL() ?? undefined });
  for (const m of members) {
    if (m.user?.bot) continue;
    try { await m.send({ embeds: [embed] }); sent++; } catch { failed++; }
  }
  return { sent, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN INTERACTION HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleInteraction(interaction, client) {
  // ── Autocomplete ──
  if (interaction.isAutocomplete()) return;

  // ── Modal Submit ──
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('sheet_'))    { await handleSheetModalSubmit(interaction);   return; }
    if (interaction.customId.startsWith('tierlist_')) { await handleTierListModalSubmit(interaction); return; }
    if (interaction.customId.startsWith('embed_'))    { await handleEmbedModalSubmit(interaction);   return; }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ── Commands that show a modal (must NOT defer before showModal) ──
  if (commandName === 'create-sheet') { await handleCreateSheet(interaction); return; }
  if (commandName === 'tier-list')    { await handleTierList(interaction);    return; }
  if (commandName === 'embed')        { await handleEmbedBuilder(interaction); return; }

  // ── All other commands: defer first ──
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const cfg   = getGuildCfg(guild.id);

  // ── Set Tier Channel ──
  if (commandName === 'set-tier-channel') {
    const ch = interaction.options.getChannel('channel', true);
    cfg.tierChannelId = ch.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Tier results will now be posted in ${ch}.`);

  // ── Set Tier Tester Role (server owner only) ──
  } else if (commandName === 'set-tier-tester-role') {
    if (!isServerOwner(interaction)) {
      await interaction.editReply('❌ Only the **server owner** can set the tier tester role.');
      return;
    }
    const role = interaction.options.getRole('role', true);
    cfg.tierTesterRoleId = role.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Tier tester role set to **${role.name}**. Only members with this role can use \`/dm-user\` and \`/dm-all\`.`);

  // ── DM User ──
  } else if (commandName === 'dm-user') {
    if (!hasTierTesterRole(interaction)) {
      await interaction.editReply('❌ You need the Tier Tester role to use this command.');
      return;
    }
    const u   = interaction.options.getUser('user', true);
    const msg = interaction.options.getString('message', true);
    const m   = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    const { sent } = await sendDMEmbed(interaction, [m], { message: msg, title: interaction.options.getString('title'), color: interaction.options.getString('color'), footer: interaction.options.getString('footer') });
    await interaction.editReply(sent > 0 ? `✅ DM sent to **${u.username}**.` : `❌ Failed to DM **${u.username}** — DMs may be disabled.`);

  // ── DM All ──
  } else if (commandName === 'dm-all') {
    if (!hasTierTesterRole(interaction)) {
      await interaction.editReply('❌ You need the Tier Tester role to use this command.');
      return;
    }
    await interaction.editReply('📨 Sending DMs...');
    const mbs = await guild.members.fetch();
    const { sent, failed } = await sendDMEmbed(interaction, [...mbs.values()], { message: interaction.options.getString('message', true), title: interaction.options.getString('title'), color: interaction.options.getString('color'), footer: interaction.options.getString('footer') });
    await interaction.editReply(`Done! ✅ ${sent} sent | ❌ ${failed} failed`);

  // ── DM Role ──
  } else if (commandName === 'dm-role') {
    const role = interaction.options.getRole('role', true);
    await interaction.editReply(`📨 Sending DMs to role **${role.name}**...`);
    const mbs     = await guild.members.fetch();
    const targets = [...mbs.values()].filter(m => m.roles.cache.has(role.id));
    if (!targets.length) { await interaction.editReply(`❌ No members with role **${role.name}**.`); return; }
    const { sent, failed } = await sendDMEmbed(interaction, targets, { message: interaction.options.getString('message', true), title: interaction.options.getString('title'), color: interaction.options.getString('color'), footer: interaction.options.getString('footer') });
    await interaction.editReply(`Done! ✅ ${sent} sent | ❌ ${failed} failed`);

  // ── Warnings ──
  } else if (commandName === 'warn') {
    const u = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    if (!warnings[guild.id]) warnings[guild.id] = {};
    if (!warnings[guild.id][u.id]) warnings[guild.id][u.id] = [];
    warnings[guild.id][u.id].push({ reason, by: interaction.user.username, at: Date.now() });
    saveJson('warnings.json', warnings);
    const total = warnings[guild.id][u.id].length;
    const embed = new EmbedBuilder().setColor('#FEE75C').setTitle('⚠️ Warning Issued')
      .addFields({ name: 'Member', value: `${u}`, inline: true }, { name: 'Reason', value: reason, inline: true }, { name: 'Total Warnings', value: `${total}`, inline: true })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    try { await u.send({ content: `⚠️ You received a warning in **${guild.name}**.\n**Reason:** ${reason}` }); } catch {}

  } else if (commandName === 'warnings') {
    const u = interaction.options.getUser('user', true);
    const list = warnings[guild.id]?.[u.id] ?? [];
    const embed = new EmbedBuilder().setColor('#FEE75C').setTitle(`⚠️ Warnings — ${u.username}`)
      .setDescription(list.length ? list.map((w, i) => `**${i+1}.** ${w.reason} — by *${w.by}*`).join('\n') : 'No warnings.')
      .setFooter({ text: `Total: ${list.length}` }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'clearwarnings') {
    const u = interaction.options.getUser('user', true);
    if (warnings[guild.id]) delete warnings[guild.id][u.id];
    saveJson('warnings.json', warnings);
    await interaction.editReply(`✅ Cleared all warnings for **${u.username}**.`);

  // ── Moderation ──
  } else if (commandName === 'timeout') {
    const u = interaction.options.getUser('user', true);
    const dur = parseMs(interaction.options.getString('duration', true));
    if (!dur || dur > 28*86400000) { await interaction.editReply('❌ Invalid duration. Use e.g. 10m, 2h, 1d (max 28d).'); return; }
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.timeout(dur, reason);
    await interaction.editReply(`✅ **${u.username}** timed out for **${fmtMs(dur)}**. Reason: ${reason}`);
    try { await u.send(`⏱️ You were timed out in **${guild.name}** for **${fmtMs(dur)}**.\n**Reason:** ${reason}`); } catch {}

  } else if (commandName === 'untimeout') {
    const u = interaction.options.getUser('user', true);
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.timeout(null);
    await interaction.editReply(`✅ Timeout removed from **${u.username}**.`);

  } else if (commandName === 'ban') {
    const u = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const delDays = interaction.options.getInteger('delete-messages') ?? 0;
    try { await u.send(`🔨 You were banned from **${guild.name}**.\n**Reason:** ${reason}`); } catch {}
    await guild.members.ban(u.id, { reason, deleteMessageSeconds: delDays * 86400 });
    await interaction.editReply(`✅ **${u.username}** has been banned. Reason: ${reason}`);

  } else if (commandName === 'unban') {
    const uid = interaction.options.getString('user-id', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    await guild.members.unban(uid, reason);
    await interaction.editReply(`✅ User \`${uid}\` has been unbanned.`);
    try { const u = await client.users.fetch(uid); await u.send(`✅ You have been unbanned from **${guild.name}**.`); } catch {}

  } else if (commandName === 'kick') {
    const u = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    try { await u.send(`👢 You were kicked from **${guild.name}**.\n**Reason:** ${reason}`); } catch {}
    await m.kick(reason);
    await interaction.editReply(`✅ **${u.username}** has been kicked. Reason: ${reason}`);

  } else if (commandName === 'nickname') {
    const u    = interaction.options.getUser('user', true);
    const nick = interaction.options.getString('nickname') ?? null;
    const m    = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.setNickname(nick);
    await interaction.editReply(nick ? `✅ Nickname for **${u.username}** set to **${nick}**.` : `✅ Nickname for **${u.username}** reset.`);

  } else if (commandName === 'purge') {
    const amount = interaction.options.getInteger('amount', true);
    const ch = interaction.channel;
    const deleted = await ch.bulkDelete(amount, true);
    await interaction.editReply(`🗑️ Deleted **${deleted.size}** messages.`);

  } else if (commandName === 'slowmode') {
    const sec = interaction.options.getInteger('seconds', true);
    await interaction.channel.setRateLimitPerUser(sec);
    await interaction.editReply(sec === 0 ? '✅ Slowmode disabled.' : `✅ Slowmode set to **${sec}s**.`);

  } else if (commandName === 'lockdown') {
    const channels = guild.channels.cache.filter(c => c.isTextBased() && c.type === ChannelType.GuildText);
    for (const [, ch] of channels) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
    }
    await interaction.editReply('🔒 Server locked down! All text channels are now read-only.');

  } else if (commandName === 'unlockdown') {
    const channels = guild.channels.cache.filter(c => c.isTextBased() && c.type === ChannelType.GuildText);
    for (const [, ch] of channels) {
      await ch.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
    }
    await interaction.editReply('🔓 Lockdown lifted! Channels restored.');

  } else if (commandName === 'role-add') {
    const u = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.roles.add(role);
    await interaction.editReply(`✅ Added **${role.name}** to **${u.username}**.`);

  } else if (commandName === 'role-remove') {
    const u = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);
    const m = await guild.members.fetch(u.id).catch(() => null);
    if (!m) { await interaction.editReply('❌ Member not found.'); return; }
    await m.roles.remove(role);
    await interaction.editReply(`✅ Removed **${role.name}** from **${u.username}**.`);

  // ── Reports ──
  } else if (commandName === 'report') {
    const u      = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const proof  = interaction.options.getAttachment('proof');
    if (!cfg.reportChannelId) { await interaction.editReply('⚠️ No report channel set. Ask an admin to use `/set-report-channel`.'); return; }
    const ch = await guild.channels.fetch(cfg.reportChannelId).catch(() => null);
    if (!ch?.isTextBased()) { await interaction.editReply('❌ Report channel not found.'); return; }
    const embed = new EmbedBuilder().setColor('#ED4245').setTitle('🚨 New Report')
      .addFields({ name: 'Reported User', value: `${u} (\`${u.id}\`)`, inline: true }, { name: 'Reporter', value: `${interaction.user}`, inline: true }, { name: 'Reason', value: reason, inline: false })
      .setTimestamp();
    if (proof) embed.setImage(proof.url);
    await ch.send({ embeds: [embed] });
    await interaction.editReply('✅ Report submitted! The mod team has been notified.');

  } else if (commandName === 'set-report-channel') {
    const ch = interaction.options.getChannel('channel', true);
    cfg.reportChannelId = ch.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Report channel set to ${ch}.`);

  // ── Welcome ──
  } else if (commandName === 'set-welcome-channel') {
    const ch = interaction.options.getChannel('channel', true);
    cfg.welcomeChannelId = ch.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Welcome channel set to ${ch}.`);

  // ── Invites ──
  } else if (commandName === 'invites') {
    const u = interaction.options.getUser('user') ?? interaction.user;
    const inv = inviteCache[guild.id]?.[u.id] ?? { uses: 0, code: 'N/A' };
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`📨 Invites — ${u.username}`)
      .addFields({ name: 'Total Uses', value: `${inv.uses}`, inline: true })
      .setThumbnail(u.displayAvatarURL({ size: 256 })).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  // ── Info ──
  } else if (commandName === 'userinfo') {
    const u = interaction.options.getUser('user') ?? interaction.user;
    const m = await guild.members.fetch(u.id).catch(() => null);
    const agedays = Math.floor((Date.now() - u.createdTimestamp) / 86400000);
    const roles = m?.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => `${r}`).slice(0, 10) ?? [];
    const embed = new EmbedBuilder().setColor(m?.displayHexColor ?? '#5865F2').setTitle(`👤 ${u.username}`)
      .setThumbnail(u.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🏷️ Username', value: `\`${u.username}\``, inline: true },
        { name: '🆔 User ID', value: `\`${u.id}\``, inline: true },
        { name: '🤖 Bot', value: u.bot ? 'Yes' : 'No', inline: true },
        { name: '📅 Account Created', value: `<t:${Math.floor(u.createdTimestamp/1000)}:D> (${agedays}d ago)`, inline: false }
      );
    if (m?.joinedAt) embed.addFields({ name: '📥 Joined Server', value: `<t:${Math.floor(m.joinedAt.getTime()/1000)}:D>`, inline: false });
    if (roles.length) embed.addFields({ name: `🎭 Roles (${roles.length})`, value: roles.join(' '), inline: false });
    embed.setFooter({ text: guild.name }).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'serverinfo') {
    await guild.fetch();
    const owner = await guild.fetchOwner().catch(() => null);
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🏠 ${guild.name}`)
      .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
      .addFields(
        { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
        { name: '👑 Owner', value: owner ? `${owner.user}` : 'Unknown', inline: true },
        { name: '📅 Created', value: `<t:${Math.floor(guild.createdTimestamp/1000)}:D>`, inline: true },
        { name: '👥 Members', value: guild.memberCount.toLocaleString(), inline: true },
        { name: '💬 Text Channels', value: guild.channels.cache.filter(c => c.isTextBased()).size.toString(), inline: true },
        { name: '🔊 Voice Channels', value: guild.channels.cache.filter(c => c.isVoiceBased()).size.toString(), inline: true },
        { name: '🎭 Roles', value: guild.roles.cache.size.toString(), inline: true },
        { name: '😀 Emojis', value: guild.emojis.cache.size.toString(), inline: true },
        { name: '🚀 Boost Level', value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0} boosts)`, inline: true }
      ).setFooter({ text: guild.name }).setTimestamp();
    if (guild.description) embed.setDescription(guild.description);
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'avatar') {
    const u = interaction.options.getUser('user') ?? interaction.user;
    const url = u.displayAvatarURL({ size: 1024 });
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🖼️ ${u.username}'s Avatar`)
      .setImage(url).setDescription(`[Open Full Size](${url})`).setFooter({ text: `ID: ${u.id}` });
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'roleinfo') {
    const role = interaction.options.getRole('role', true);
    const memberCount = guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
    const embed = new EmbedBuilder().setColor(role.hexColor).setTitle(`🎭 ${role.name}`)
      .addFields(
        { name: '🆔 Role ID', value: `\`${role.id}\``, inline: true },
        { name: '🎨 Color', value: role.hexColor, inline: true },
        { name: '📍 Position', value: `#${role.position}`, inline: true },
        { name: '👥 Members', value: memberCount.toString(), inline: true },
        { name: '📅 Created', value: `<t:${Math.floor(role.createdTimestamp/1000)}:D>`, inline: true }
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'ping') {
    await interaction.editReply(`🏓 Pong! Latency: **${client.ws.ping}ms**`);

  } else if (commandName === 'botinfo') {
    const uptime = process.uptime();
    const h = Math.floor(uptime/3600), m2 = Math.floor((uptime%3600)/60), s2 = Math.floor(uptime%60);
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🤖 Bot Info')
      .addFields(
        { name: '📛 Name', value: client.user?.username ?? 'Unknown', inline: true },
        { name: '🆔 ID', value: `\`${client.user?.id}\``, inline: true },
        { name: '⏱️ Uptime', value: `${h}h ${m2}m ${s2}s`, inline: true },
        { name: '🏠 Servers', value: client.guilds.cache.size.toString(), inline: true },
        { name: '🏓 Ping', value: `${client.ws.ping}ms`, inline: true }
      ).setThumbnail(client.user?.displayAvatarURL({ size: 256 }) ?? null).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'profile') {
    const u = interaction.options.getUser('user') ?? interaction.user;
    const m = await guild.members.fetch(u.id).catch(() => null);
    const bal = getBal(u.id);
    const warnCount = (warnings[guild.id]?.[u.id] ?? []).length;
    const msgs = msgStats[u.id] ?? 0;
    const embed = new EmbedBuilder().setColor(m?.displayHexColor ?? '#5865F2').setTitle(`📋 ${u.username}'s Profile`)
      .setThumbnail(u.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '💎 Emeralds', value: bal.emeralds.toLocaleString(), inline: true },
        { name: '🔴 Rubies', value: bal.rubies.toLocaleString(), inline: true },
        { name: '⚠️ Warnings', value: warnCount.toString(), inline: true },
        { name: '💬 Messages', value: msgs.toLocaleString(), inline: true }
      ).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'stats') {
    const u = interaction.options.getUser('user') ?? interaction.user;
    const count = msgStats[u.id] ?? 0;
    await interaction.editReply(`📊 **${u.username}** has sent **${count.toLocaleString()}** messages tracked since the bot joined.`);

  // ── Economy ──
  } else if (commandName === 'balance') {
    const u = interaction.options.getUser('user') ?? interaction.user;
    const bal = getBal(u.id);
    const embed = new EmbedBuilder().setColor('#57F287').setTitle(`💰 Balance — ${u.username}`)
      .addFields({ name: '💎 Emeralds', value: bal.emeralds.toLocaleString(), inline: true }, { name: '🔴 Rubies', value: bal.rubies.toLocaleString(), inline: true })
      .setThumbnail(u.displayAvatarURL({ size: 256 })).setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'daily') {
    const last = dailyClaims[interaction.user.id] ?? 0;
    const ms   = Date.now() - last;
    if (ms < 86400000) {
      await interaction.editReply(`⏰ Come back in **${fmtMs(86400000 - ms)}**.`);
      return;
    }
    dailyClaims[interaction.user.id] = Date.now();
    saveJson('daily-claims.json', dailyClaims);
    addEm(interaction.user.id, 200);
    await interaction.editReply(`🎁 You received **200 💎 Emeralds**! Come back tomorrow!`);

  } else if (commandName === 'give-ruby') {
    const u   = interaction.options.getUser('user', true);
    const amt = interaction.options.getInteger('amount', true);
    addRuby(u.id, amt);
    await interaction.editReply(`✅ Gave **${amt} 🔴 Rubies** to **${u.username}**.`);

  } else if (commandName === 'leaderboard') {
    const sorted = Object.entries(economy).sort((a, b) => (b[1].emeralds+b[1].rubies) - (a[1].emeralds+a[1].rubies)).slice(0, 10);
    const lines = await Promise.all(sorted.map(async ([uid, bal], i) => {
      const u = await client.users.fetch(uid).catch(() => null);
      return `**${i+1}.** ${u?.username ?? uid} — 💎 ${bal.emeralds} | 🔴 ${bal.rubies}`;
    }));
    const embed = new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Top 10 Richest Members').setDescription(lines.join('\n') || 'No data.').setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'msg-leaderboard') {
    const sorted = Object.entries(msgStats).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const lines = await Promise.all(sorted.map(async ([uid, count], i) => {
      const u = await client.users.fetch(uid).catch(() => null);
      return `**${i+1}.** ${u?.username ?? uid} — **${count.toLocaleString()}** messages`;
    }));
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('💬 Top 10 Most Active Members').setDescription(lines.join('\n') || 'No data.').setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'shop') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'menu') {
      const embed = new EmbedBuilder().setColor('#FFD700').setTitle('🛍️ Server Shop')
        .setDescription('**Custom Role** — Create your own role with a custom name and color!\n💎 Price: **2,500 Emeralds**')
        .addFields({ name: '📦 How to buy', value: 'Use `/shop create-role name: color:` to purchase!' })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } else if (sub === 'create-role') {
      const name  = interaction.options.getString('name', true);
      const color = interaction.options.getString('color', true);
      const bal   = getBal(interaction.user.id);
      if (bal.emeralds < 2500) { await interaction.editReply(`❌ You need **2,500 💎** but only have **${bal.emeralds}**.`); return; }
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) { await interaction.editReply('❌ Invalid hex color. Use format `#RRGGBB`.'); return; }
      const role = await guild.roles.create({ name, color, reason: `Shop purchase by ${interaction.user.username}` });
      const m    = await guild.members.fetch(interaction.user.id).catch(() => null);
      await m?.roles.add(role);
      getBal(interaction.user.id).emeralds -= 2500;
      saveJson('economy.json', economy);
      await interaction.editReply(`✅ Created and assigned role **${name}**! 2,500 💎 deducted.`);
    } else if (sub === 'redeem') {
      const code = interaction.options.getString('code', true).toUpperCase();
      const c    = shopCodes[code];
      if (!c) { await interaction.editReply('❌ Invalid code.'); return; }
      if (c.uses >= (c.maxUses ?? 1)) { await interaction.editReply('❌ This code has expired.'); return; }
      if (c.usedBy?.includes(interaction.user.id)) { await interaction.editReply('❌ You already redeemed this code.'); return; }
      c.uses++;
      if (!c.usedBy) c.usedBy = [];
      c.usedBy.push(interaction.user.id);
      saveJson('shop-codes.json', shopCodes);
      if (c.emeralds) addEm(interaction.user.id, c.emeralds);
      if (c.rubies) addRuby(interaction.user.id, c.rubies);
      await interaction.editReply(`✅ Code redeemed! You received ${c.emeralds ? `**${c.emeralds} 💎**` : ''} ${c.rubies ? `**${c.rubies} 🔴**` : ''}`);
    }

  } else if (commandName === 'create-code') {
    const code  = interaction.options.getString('code', true).toUpperCase();
    const em    = interaction.options.getInteger('emeralds') ?? 0;
    const ruby  = interaction.options.getInteger('rubies') ?? 0;
    const maxU  = interaction.options.getInteger('max-uses') ?? 1;
    shopCodes[code] = { emeralds: em, rubies: ruby, maxUses: maxU, uses: 0, usedBy: [] };
    saveJson('shop-codes.json', shopCodes);
    await interaction.editReply(`✅ Code **${code}** created! Rewards: ${em} 💎 / ${ruby} 🔴. Max uses: ${maxU}`);

  // ── Utility ──
  } else if (commandName === 'poll') {
    const question = interaction.options.getString('question', true);
    const opts     = [1,2,3,4].map(n => interaction.options.getString(`option${n}`)).filter(Boolean);
    const embed    = new EmbedBuilder().setColor('#5865F2').setTitle('📊 Poll').setDescription(`**${question}**`)
      .setFooter({ text: `Poll by ${interaction.user.username}` }).setTimestamp();
    if (opts.length) {
      const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣'];
      embed.addFields(opts.map((o, i) => ({ name: `${emojis[i]} ${o}`, value: ' ', inline: true })));
    }
    await interaction.editReply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    if (opts.length) {
      const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣'];
      for (let i = 0; i < opts.length; i++) await msg.react(emojis[i]).catch(() => {});
    } else {
      await msg.react('👍').catch(() => {});
      await msg.react('👎').catch(() => {});
    }

  } else if (commandName === 'announce') {
    const ch    = interaction.options.getChannel('channel', true);
    const msg   = interaction.options.getString('message', true);
    const title = interaction.options.getString('title');
    const color = interaction.options.getString('color');
    const embed = new EmbedBuilder().setColor(hexToInt(color)).setDescription(msg).setTimestamp();
    if (title) embed.setTitle(title);
    embed.setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined });
    await ch.send({ embeds: [embed] });
    await interaction.editReply(`✅ Announcement sent in ${ch}.`);

  } else if (commandName === 'say') {
    const ch  = interaction.options.getChannel('channel', true);
    const msg = interaction.options.getString('message', true);
    await ch.send(msg);
    await interaction.editReply(`✅ Message sent in ${ch}.`);

  } else if (commandName === 'snipe') {
    const s = snipeCache[interaction.channelId];
    if (!s) { await interaction.editReply('😶 Nothing to snipe!'); return; }
    const embed = new EmbedBuilder().setColor('#ED4245').setTitle('👻 Last Deleted Message')
      .setDescription(s.content || '*[No text content]*')
      .setFooter({ text: `By ${s.author}`, iconURL: s.avatar }).setTimestamp(s.time);
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'editsnipe') {
    const s = editSnipe[interaction.channelId];
    if (!s) { await interaction.editReply('😶 Nothing to edit-snipe!'); return; }
    const embed = new EmbedBuilder().setColor('#FEE75C').setTitle('✏️ Last Edited Message')
      .addFields({ name: 'Before', value: s.before || '*empty*', inline: true }, { name: 'After', value: s.after || '*empty*', inline: true })
      .setFooter({ text: `By ${s.author}`, iconURL: s.avatar }).setTimestamp(s.time);
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'reminder') {
    const timeStr = interaction.options.getString('time', true);
    const msg     = interaction.options.getString('message', true);
    const ms      = parseMs(timeStr);
    if (!ms || ms > 7*86400000) { await interaction.editReply('❌ Invalid time. Use e.g. 10s, 30m, 2h, 1d (max 7d).'); return; }
    const fireAt = Date.now() + ms;
    if (!reminders[interaction.user.id]) reminders[interaction.user.id] = [];
    reminders[interaction.user.id].push({ msg, fireAt, channelId: interaction.channelId });
    saveJson('reminders.json', reminders);
    await interaction.editReply(`⏰ I'll remind you in **${fmtMs(ms)}**: *${msg}*`);

  } else if (commandName === 'giveaway') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'start') {
      const prize   = interaction.options.getString('prize', true);
      const timeStr = interaction.options.getString('duration', true);
      const ms      = parseMs(timeStr);
      if (!ms) { await interaction.editReply('❌ Invalid duration.'); return; }
      const winners = interaction.options.getInteger('winners') ?? 1;
      const ch      = interaction.options.getChannel('channel') ?? interaction.channel;
      const endsAt  = Date.now() + ms;
      const embed   = new EmbedBuilder().setColor('#FFD700').setTitle('🎉 GIVEAWAY!')
        .setDescription(`**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endsAt/1000)}:R>\n\nReact with 🎉 to enter!`)
        .setTimestamp(endsAt);
      const msg = await ch.send({ embeds: [embed] });
      await msg.react('🎉');
      giveaways[msg.id] = { prize, winners, endsAt, channelId: ch.id, guildId: guild.id, entries: [] };
      saveJson('giveaways.json', giveaways);
      await interaction.editReply(`✅ Giveaway started in ${ch}!`);
    } else {
      await interaction.editReply('⚠️ Use `/giveaway start` to begin a new giveaway.');
    }

  } else if (commandName === 'ticket') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const catId  = cfg.ticketCategoryId;
      const ticketChannel = await guild.channels.create({
        name: `ticket-${interaction.user.username}`.slice(0, 100),
        type: ChannelType.GuildText,
        parent: catId ?? null,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ],
        reason: `Ticket by ${interaction.user.username}`,
      });
      await ticketChannel.send({
        content: `${interaction.user} — **Reason:** ${reason}`,
        embeds: [new EmbedBuilder().setColor('#5865F2').setTitle('🎫 Support Ticket').setDescription('A staff member will assist you shortly. Use `/ticket close` to close this ticket.')],
      });
      await interaction.editReply(`✅ Ticket created: ${ticketChannel}`);
    } else if (sub === 'close') {
      if (!interaction.channel.name.startsWith('ticket-')) { await interaction.editReply('❌ This is not a ticket channel.'); return; }
      await interaction.editReply('🗑️ Closing ticket in 5 seconds...');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

  } else if (commandName === 'math') {
    const expr = interaction.options.getString('expression', true);
    try {
      const result = Function(`"use strict"; return (${expr.replace(/[^0-9+\-*/().\s%]/g, '')})`)();
      await interaction.editReply(`🔢 \`${expr}\` = **${result}**`);
    } catch {
      await interaction.editReply('❌ Invalid expression.');
    }

  } else if (commandName === 'color') {
    const hex = interaction.options.getString('hex', true);
    if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) { await interaction.editReply('❌ Invalid hex color.'); return; }
    const clean = hex.startsWith('#') ? hex : `#${hex}`;
    const embed = new EmbedBuilder().setColor(clean).setTitle(`🎨 Color Preview: ${clean}`)
      .setDescription(`**Hex:** \`${clean}\`\n**Int:** \`${hexToInt(clean)}\``);
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'birthday') {
    const sub = interaction.options.getSubcommand();
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (sub === 'set') {
      const month = interaction.options.getInteger('month', true);
      const day   = interaction.options.getInteger('day', true);
      if (!birthdays[guild.id]) birthdays[guild.id] = {};
      birthdays[guild.id][interaction.user.id] = { month, day };
      saveJson('birthdays.json', birthdays);
      await interaction.editReply(`🎂 Birthday set to **${MONTHS[month-1]} ${day}**!`);
    } else {
      const all  = birthdays[guild.id] ?? {};
      const now  = new Date();
      const cur  = { m: now.getMonth()+1, d: now.getDate() };
      const list = [];
      for (const [uid, bd] of Object.entries(all)) {
        let days = (bd.month - cur.m) * 30 + (bd.day - cur.d);
        if (days < 0) days += 365;
        list.push({ uid, ...bd, days });
      }
      list.sort((a, b) => a.days - b.days);
      const lines = await Promise.all(list.slice(0, 10).map(async e => {
        const u = await client.users.fetch(e.uid).catch(() => null);
        const label = e.days === 0 ? '🎉 **Today!**' : `in **${e.days}** days`;
        return `🎂 **${u?.username ?? e.uid}** — ${MONTHS[e.month-1]} ${e.day} (${label})`;
      }));
      const embed = new EmbedBuilder().setColor('#FF6B9D').setTitle('🎂 Upcoming Birthdays')
        .setDescription(lines.join('\n') || 'No birthdays saved yet. Use `/birthday set` to add yours!')
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    }

  } else if (commandName === 'suggestion') {
    const text = interaction.options.getString('text', true);
    if (!cfg.suggestionChannelId) { await interaction.editReply('⚠️ No suggestion channel set.'); return; }
    const ch = await guild.channels.fetch(cfg.suggestionChannelId).catch(() => null);
    if (!ch?.isTextBased()) { await interaction.editReply('❌ Suggestion channel not found.'); return; }
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('💡 New Suggestion').setDescription(text)
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    const msg = await ch.send({ embeds: [embed] });
    await msg.react('👍');
    await msg.react('👎');
    await interaction.editReply('✅ Suggestion submitted!');

  } else if (commandName === 'confession') {
    const text = interaction.options.getString('message', true);
    if (!cfg.confessionChannelId) { await interaction.editReply('⚠️ No confession channel set.'); return; }
    const ch = await guild.channels.fetch(cfg.confessionChannelId).catch(() => null);
    if (!ch?.isTextBased()) { await interaction.editReply('❌ Confession channel not found.'); return; }
    const embed = new EmbedBuilder().setColor('#2f3136').setTitle('🕵️ Anonymous Confession').setDescription(text)
      .setFooter({ text: 'This confession was submitted anonymously.' }).setTimestamp();
    await ch.send({ embeds: [embed] });
    await interaction.editReply('✅ Confession posted anonymously!');

  } else if (commandName === 'coinflip') {
    const result = Math.random() < 0.5 ? '🪙 **Heads!**' : '🪙 **Tails!**';
    await interaction.editReply(result);

  } else if (commandName === '8ball') {
    const q = interaction.options.getString('question', true);
    const answers = ['Yes, definitely!', 'Without a doubt.', 'Most likely.', 'Signs point to yes.', 'It is certain.', 'Ask again later.', 'Cannot predict now.', 'Concentrate and ask again.', "Don't count on it.", 'My reply is no.', 'My sources say no.', 'Very doubtful.', 'Outlook not so good.'];
    const answer = answers[Math.floor(Math.random() * answers.length)];
    const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎱 Magic 8-Ball')
      .addFields({ name: '❓ Question', value: q, inline: false }, { name: '🎱 Answer', value: `**${answer}**`, inline: false })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });

  } else if (commandName === 'meme') {
    try {
      const subs = ['memes', 'dankmemes', 'me_irl'];
      const sub  = subs[Math.floor(Math.random() * subs.length)];
      const res  = await fetch(`https://www.reddit.com/r/${sub}/random.json`).then(r => r.json());
      const post = res[0]?.data?.children[0]?.data;
      if (!post) { await interaction.editReply('❌ Couldn\'t fetch a meme. Try again!'); return; }
      const embed = new EmbedBuilder().setColor('#FF4500').setTitle(post.title).setImage(post.url)
        .setFooter({ text: `👍 ${post.ups} | r/${sub}` }).setURL(`https://reddit.com${post.permalink}`);
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply('❌ Couldn\'t fetch a meme. Try again!');
    }

  } else if (commandName === 'time') {
    const country = interaction.options.getString('country', true);
    try {
      const res  = await fetch(`https://worldtimeapi.org/api/timezone`).then(r => r.json());
      const zone = (Array.isArray(res) ? res : []).find(z => z.toLowerCase().includes(country.toLowerCase()));
      if (!zone) { await interaction.editReply(`❌ Could not find timezone for **${country}**.`); return; }
      const tRes  = await fetch(`https://worldtimeapi.org/api/timezone/${zone}`).then(r => r.json());
      const embed = new EmbedBuilder().setColor('#5865F2').setTitle(`🕐 Time — ${country}`)
        .addFields({ name: '🌍 Timezone', value: `\`${zone}\``, inline: true }, { name: '🕐 Current Time', value: tRes.datetime?.split('.')[0]?.replace('T', ' ') ?? 'Unknown', inline: true })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply(`❌ Couldn't fetch time for **${country}**.`);
    }

  // ── Admin Setup ──
  } else if (commandName === 'set-suggestion-channel') {
    const ch = interaction.options.getChannel('channel', true);
    cfg.suggestionChannelId = ch.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Suggestion channel set to ${ch}.`);

  } else if (commandName === 'set-confession-channel') {
    const ch = interaction.options.getChannel('channel', true);
    cfg.confessionChannelId = ch.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Confession channel set to ${ch}.`);

  } else if (commandName === 'set-ticket-category') {
    const ch = interaction.options.getChannel('category', true);
    cfg.ticketCategoryId = ch.id;
    saveGuildCfg();
    await interaction.editReply(`✅ Ticket category set to **${ch.name}**.`);

  } else {
    await interaction.editReply('⚠️ Unknown command. If this is new, try restarting the bot to sync commands.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT CLIENT
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN    = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
if (!TOKEN) throw new Error('DISCORD_TOKEN environment variable is required.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', async c => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  // Register slash commands
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log('✅ Global slash commands registered.');
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(c.user.id, GUILD_ID), { body: commands });
      console.log(`✅ Guild commands registered for ${GUILD_ID}.`);
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
  // Start reminder scheduler
  setInterval(() => checkReminders(c), 15000);
});

client.on('messageCreate', msg => {
  if (msg.author.bot || !msg.guild) return;
  msgStats[msg.author.id] = (msgStats[msg.author.id] ?? 0) + 1;
  if (msg.content.length > 0) saveJson('msg-stats.json', msgStats);
});

client.on('messageDelete', msg => {
  if (!msg.partial && msg.content) {
    snipeCache[msg.channelId] = {
      content: msg.content,
      author:  msg.author?.username ?? 'Unknown',
      avatar:  msg.author?.displayAvatarURL() ?? null,
      time:    Date.now(),
    };
  }
});

client.on('messageUpdate', (old, now) => {
  if (!old.partial && !now.partial && old.content !== now.content) {
    editSnipe[old.channelId] = {
      before: old.content,
      after:  now.content,
      author: old.author?.username ?? 'Unknown',
      avatar: old.author?.displayAvatarURL() ?? null,
      time:   Date.now(),
    };
  }
});

client.on('guildMemberAdd', async member => {
  const cfg = getGuildCfg(member.guild.id);
  if (!cfg.welcomeChannelId) return;
  const ch = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
  if (!ch?.isTextBased()) return;
  const embed = new EmbedBuilder().setColor('#57F287').setTitle(`👋 Welcome to ${member.guild.name}!`)
    .setDescription(`Welcome ${member}! You are member **#${member.guild.memberCount}**.`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 })).setTimestamp();
  await ch.send({ content: `${member}`, embeds: [embed] }).catch(() => {});
});

// SAFE interaction handler — wraps everything in try-catch to prevent "application not responding"
client.on('interactionCreate', async interaction => {
  try {
    await handleInteraction(interaction, client);
  } catch (err) {
    console.error('Interaction error:', err);
    // Try to send error to user if interaction hasn't been responded to
    try {
      const errMsg = '❌ Something went wrong. Please try again.';
      if (interaction.isModalSubmit() || interaction.isChatInputCommand()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(errMsg).catch(() => {});
        } else {
          await interaction.reply({ content: errMsg, ephemeral: true }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }
});

client.on('error', err => console.error('Client error:', err));

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────
async function checkReminders(c) {
  const now = Date.now();
  let changed = false;
  for (const [uid, list] of Object.entries(reminders)) {
    const due  = list.filter(r => r.fireAt <= now);
    const keep = list.filter(r => r.fireAt > now);
    if (due.length) {
      changed = true;
      reminders[uid] = keep;
      for (const r of due) {
        try {
          const u = await c.users.fetch(uid).catch(() => null);
          if (u) await u.send(`⏰ **Reminder:** ${r.msg}`);
        } catch { /* ignore */ }
      }
    }
  }
  if (changed) saveJson('reminders.json', reminders);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP KEEPALIVE (Railway health check)
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
const PORT = process.env.PORT ?? 8080;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`PokeFanIconZ Bot — Online\n`);
}).listen(PORT, () => console.log(`🌐 Health server listening on port ${PORT}`));

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
client.login(TOKEN);
