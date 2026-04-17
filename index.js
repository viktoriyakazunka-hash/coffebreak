const fs = require("fs");
const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const HISTORY_FILE = "pairs_history.json";
const EXCLUDED_EMAILS = ["viktoriya.kazunka@neuralab.tech"];

// ================= GOOGLE =================
const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

auth.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN));

const calendar = google.calendar({ version: "v3", auth });

// ================= HISTORY =================
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE));
}

function saveHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

// ================= USERS =================
async function getUsers() {
  const res = await slack.conversations.members({ channel: CHANNEL_ID });
  const users = [];

  for (const id of res.members) {
    const info = await slack.users.info({ user: id });
    const u = info.user;

    const email = u.profile.email;
    const status = (u.profile.status_text || "").toLowerCase();

    const isVacation =
      status.includes("vacation") ||
      status.includes("leave") ||
      status.includes("pto") ||
      status.includes("отпуск");

   if (!u.is_bot && !u.deleted) {
  console.log("CHECK USER:", {
    id,
    email,
    status: u.profile.status_text
  });

  const isVacation =
    (u.profile.status_text || "").toLowerCase().includes("vacation") ||
    (u.profile.status_text || "").toLowerCase().includes("leave") ||
    (u.profile.status_text || "").toLowerCase().includes("pto") ||
    (u.profile.status_text || "").toLowerCase().includes("отпуск");

  const isExcluded = email && EXCLUDED_EMAILS.includes(email);

  if (!isVacation && !isExcluded) {
    users.push(id);
  }
}
  }

  return users;
}

async function getEmail(id) {
  const res = await slack.users.info({ user: id });
  return res.user.profile.email;
}

// ================= PAIRS =================
function pairExists(history, a, b) {
  return history.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  );
}

function makePairs(users, history) {
  const shuffled = [...users].sort(() => Math.random() - 0.5);
  const pairs = [];

  while (shuffled.length >= 2) {
    const a = shuffled.shift();

    let idx = shuffled.findIndex(b => !pairExists(history, a, b));
    if (idx === -1) idx = 0;

    const b = shuffled.splice(idx, 1)[0];
    pairs.push([a, b]);
  }

  return pairs;
}

// ================= TIME =================
function getRandomMeetingTime() {
  const now = new Date();

  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;

  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);

  const offset = Math.floor(Math.random() * 5);

  const date = new Date(monday);
  date.setDate(monday.getDate() + offset);

  const hour = 11 + Math.floor(Math.random() * 7);

  date.setHours(hour, 0, 0, 0);

  const end = new Date(date.getTime() + 30 * 60000);

  return { start: date, end };
}

// ================= GOOGLE MEET =================
async function createMeeting(email1, email2) {
  try {
    const { start, end } = getRandomMeetingTime();

    const event = {
      summary: "☕ Random Coffee",
      start: {
        dateTime: start.toISOString(),
        timeZone: "Europe/Moscow"
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "Europe/Moscow"
      },
      attendees: [{ email: email1 }, { email: email2 }],
      conferenceData: {
        createRequest: {
          requestId: `${Date.now()}-${Math.random()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" }
        }
      }
    };

    const res = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
      conferenceDataVersion: 1
    });

    return {
      link: res.data.hangoutLink,
      start
    };

  } catch (e) {
    console.error("Google error:", e.message);
    return null;
  }
}

// ================= DM =================
async function sendDM(userId, partnerId, meeting) {
  if (!meeting) {
    console.log("No meeting for", userId);
    return;
  }

  try {
    console.log("Opening DM for:", userId);

    const open = await slack.conversations.open({
      users: userId
    });

    const channelId = open.channel.id;

    console.log("DM channel:", channelId);

    const date = meeting.start.toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit"
    });

    await slack.chat.postMessage({
      channel: channelId,
      text: `Привет! 👋

Твоя random coffee встреча:

👥 <@${userId}> ↔ <@${partnerId}>
📅 ${date}
🔗 ${meeting.link}

Хорошего общения ☕️`,
      unfurl_links: false
    });

    console.log("DM sent to:", userId);

  } catch (e) {
    console.error("DM ERROR:", JSON.stringify(e.data || e.message));
  }
}

// ================= TEXTS =================
function generateMessage() {
  const templates = [

`Привет, коллеги! 😊

Представьте: случайная встреча у кофейного автомата... но в полностью виртуальном формате!

Устройте себе небольшой перерыв и познакомься с коллегой для непринуждённой беседы. Ссылка от Random Coffee в DM ☕️`,

`Всем привет!

Как проходит начало недели? :sun_with_face:

Предлагаю сделать его ещё лучше — познакомиться с кем-то из команды чуть ближе!
Темы для обсуждения: погода, интересы, как проведете свободное от работы время. 
Это все можно обсудить на встрече, перейдя по ссылке от Random Coffee ☕️`,

`Привет!

Отличное начало недели — это немного общения с коллегой :wink:

Проверьте календарь и сообщения от Random Coffee: встреча уже назначена ☕️`,

`Коллеги, привет! 👋

Время для небольшой кофе-паузы и приятного общения!
Проверьте свои сообщения и календарь на наличие встречи ☕️`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// ================= MAIN =================
async function main() {
  const history = loadHistory();
  const users = await getUsers();
  const pairs = makePairs(users, history);
  console.log("PAIRS:", pairs);

  let newHistory = [...history];

  for (const [a, b] of pairs) {
    const emailA = await getEmail(a);
    const emailB = await getEmail(b);

    const meeting = await createMeeting(emailA, emailB);

    await sendDM(a, b, meeting);
    await sendDM(b, a, meeting);

    newHistory.push([a, b]);
  }

  saveHistory(newHistory);

  const pairsList = pairs
  .map(([a, b]) => `👥 <@${a}> ↔ <@${b}>`)
  .join("\n");

const blocks = [
  {
    type: "header",
    text: { type: "plain_text", text: "☕ Random Coffee" }
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: generateMessage()
    }
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*☕ Пары на эту неделю:*\n${pairsList}`
    }
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: "📅 *Календарь недели:*\nhttps://calendar.google.com/calendar/u/0/r/week"
    }
  }
];

  await slack.chat.postMessage({
    channel: CHANNEL_ID,
    blocks,
    text: "Random Coffee",
    unfurl_links: false,
    unfurl_media: false
  });
}

main();
