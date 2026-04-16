const fs = require("fs");
const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const HISTORY_FILE = "pairs_history.json";

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

function saveHistory(h) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2));
}

// ================= USERS =================
async function getUsers() {
  const res = await slack.conversations.members({ channel: CHANNEL_ID });

  const users = [];

  for (const id of res.members) {
    const info = await slack.users.info({ user: id });
    const u = info.user;

    const status = (u.profile.status_text || "").toLowerCase();

    const isVacation =
      status.includes("vacation") ||
      status.includes("leave") ||
      status.includes("pto") ||
      status.includes("отпуск");

    if (!u.is_bot && !u.deleted && !isVacation) {
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

// ================= TIME (FIXED, NO UTC BUG) =================
function getRandomMeetingTime() {
  const now = new Date();

  const day = now.getDay(); // 0 Sunday
  const diffToMonday = (day + 6) % 7;

  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);

  const offset = Math.floor(Math.random() * 5); // Mon-Fri

  const date = new Date(monday);
  date.setDate(monday.getDate() + offset);

  const hour = 11 + Math.floor(Math.random() * 7); // 11–17

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
      description: "Weekly coffee chat",
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

    return res.data.hangoutLink;

  } catch (e) {
    console.error("Google error:", e.message);
    return null;
  }
}

// ================= YOUR ORIGINAL TEXTS (RESTORED) =================
function generateMessage(pairsText) {
  const templates = [

`Привет, коллеги! 👋

Представьте: случайная встреча у кофейного автомата... но в полностью виртуальном формате!

Устрой себе небольшой перерыв и познакомься с коллегой для непринуждённой беседы ☕️

Вот пары на эту неделю:
${pairsText}

Свяжись со своим напарником и выберите удобное время для 30-минутной встречи.

Отличного общения!`,

`Всем привет! 😊

Как проходит начало недели?

Предлагаем сделать его ещё лучше — познакомиться с кем-то из команды чуть ближе!

Ваши random coffee пары:
${pairsText}

Договоритесь о короткой встрече на 30 минут в течение недели 🙂`,

`Привет! ☕️

Отличное начало недели — это новые знакомства!

На этой неделе у вас есть шанс пообщаться:

${pairsText}

Темы: неделя, жизнь, фильмы, хобби 🙂`,

`Коллеги, привет! 👋

Время для небольшой паузы и общения!

Случайные пары:
${pairsText}

Найдите 30 минут и просто пообщайтесь 🙂`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// ================= MAIN =================
async function main() {
  const history = loadHistory();
  const users = await getUsers();
  const pairs = makePairs(users, history);

  const pairsText = pairs
    .map(([a, b]) => `<@${a}> ↔ <@${b}>`)
    .join("\n");

  const message = generateMessage(pairsText);

  const calendarLink = "https://calendar.google.com/calendar/u/0/r/week";

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "☕ Random Coffee" }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: message }
    },
    { type: "divider" }
  ];

  let newHistory = [...history];

  for (const [a, b] of pairs) {
    const emailA = await getEmail(a);
    const emailB = await getEmail(b);

    const meet = await createMeeting(emailA, emailB);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `👥 <@${a}> ↔ <@${b}>\n📅 ${meet || "meeting not created"}`
      }
    });

    newHistory.push([a, b]);
  }

  blocks.push(
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📅 *Календарь недели*\n${calendarLink}`
      }
    }
  );

  saveHistory(newHistory);

  await slack.chat.postMessage({
    channel: CHANNEL_ID,
    blocks,
    text: "Random Coffee"
  });
}

main();
