const SPECIAL_GROUP_EMAILS = [
  "v.kovalev@twinby.com",
  "a.parfenova@twinby.com",
  "gusev.dev@twinby.com",
  "egorov.dev@twinby.com"
];
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

    const isExcluded = email && EXCLUDED_EMAILS.includes(email);

    if (!u.is_bot && !u.deleted && !isVacation && !isExcluded) {
      users.push(id);
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
  return history.some(group => group.includes(a) && group.includes(b));
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

  // если остался один — добавляем в случайную пару
  if (shuffled.length === 1 && pairs.length > 0) {
    const leftover = shuffled.shift();
    const randomIndex = Math.floor(Math.random() * pairs.length);
    pairs[randomIndex].push(leftover);
  }

  return pairs;
}

// ================= TIME =================
function getRandomSlot() {
  const now = new Date();

  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;

  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);

  const offset = Math.floor(Math.random() * 5);

  const date = new Date(monday);
  date.setDate(monday.getDate() + offset);

  const hour = 11 + Math.floor(Math.random() * 7); // 11-17

  date.setHours(hour, 0, 0, 0);

  const end = new Date(date.getTime() + 30 * 60000);

  return { start: date, end };
}

// ================= GOOGLE MEETING =================
async function createMeeting(emails) {
  try {
    const { start, end } = getRandomSlot();

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
      attendees: emails.map(e => ({ email: e })),
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
      conferenceDataVersion: 1,
      sendUpdates: "all"
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
async function sendDM(userId, group, meeting) {
  if (!meeting) return;

  const date = meeting.start.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  });

  const text = `Привет! 👋

Твоя random coffee встреча:

👥 ${group.map(u => `<@${u}>`).join(" ↔ ")}

📅 ${date}
🔗 ${meeting.link}

Если время не подходит — можно перенести встречу в календаре 🙂

Хорошего общения ☕️`;

  const open = await slack.conversations.open({ users: userId });

  await slack.chat.postMessage({
    channel: open.channel.id,
    text,
    unfurl_links: false
  });
}

// ================= TEXT =================
function generateMessage() {
  const templates = [
`Привет, коллеги! :blush:

Представьте: случайная встреча у кофейного автомата... но в полностью виртуальном формате!

Устройте себе небольшой перерыв и познакомься с коллегой для непринуждённой беседы. Проверьте DM :custard::coffee:`,

`Всем привет!

Как проходит начало недели? :sun_with_face:

Предлагаю сделать его ещё лучше — познакомиться с кем-то из команды чуть ближе!
Темы для обсуждения: погода, интересы, как проведете свободное от работы время. 
Это все можно обсудить на встрече, перейдя по ссылке от Random Coffee :pancakes::coffee:`,

`Привет!

Отличное начало недели — это немного общения с коллегой :speech_balloon:

Проверьте свои сообщения от Random Coffee :cookie::coffee:`,

`Коллеги, привет! :wave:

Время для небольшой кофе-паузы и приятного общения!
Все детали уже у вас в личке :cake::coffee:`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// ================= MAIN =================
async function main() {
  const history = loadHistory();
  const users = await getUsers();

// разделение на группы
const specialGroup = [];
const regularGroup = [];

for (const userId of users) {
  const email = await getEmail(userId);

  if (email && SPECIAL_GROUP_EMAILS.includes(email)) {
    specialGroup.push(userId);
  } else {
    regularGroup.push(userId);
  }
}

  if (users.length < 2) {
    await slack.chat.postMessage({
      channel: CHANNEL_ID,
      text: "Недостаточно участников для random coffee ☕️"
    });
    return;
  }

  const pairsSpecial = makePairs(specialGroup, history);
const pairsRegular = makePairs(regularGroup, history);

const pairs = [...pairsSpecial, ...pairsRegular];
  let newHistory = [...history];

  for (const group of pairs) {
    const emails = await Promise.all(group.map(getEmail));
    const meeting = await createMeeting(emails);

    for (const user of group) {
      await sendDM(user, group, meeting);
    }

    newHistory.push(group);
  }

  saveHistory(newHistory);

  const pairsList = pairs
    .map(group => `👥 ${group.map(u => `<@${u}>`).join(" ↔ ")}`)
    .join("\n");

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "☕ Random Coffee" }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: generateMessage() }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Пары на эту неделю:*\n${pairsList}` }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "📅 https://calendar.google.com/calendar/u/0/r/week"
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
