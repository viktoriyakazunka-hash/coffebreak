const fs = require("fs");
const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const HISTORY_FILE = "pairs_history.json";

// ================= GOOGLE =================
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN));

const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

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

    const status = (u.profile.status_text || "").toLowerCase();

    const isVacation =
      status.includes("vacation") ||
      status.includes("pto") ||
      status.includes("leave") ||
      status.includes("отпуск");

    if (!u.is_bot && !u.deleted && !isVacation) {
      users.push(id);
    }
  }

  return users;
}

async function getEmail(userId) {
  const res = await slack.users.info({ user: userId });
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
    const u1 = shuffled.shift();

    let idx = shuffled.findIndex(u2 => !pairExists(history, u1, u2));
    if (idx === -1) idx = 0;

    const u2 = shuffled.splice(idx, 1)[0];
    pairs.push([u1, u2]);
  }

  return pairs;
}

// ================= TIME (FIXED) =================
function getRandomMeetingTime() {
  const now = new Date();

  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = (day + 6) % 7;

  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);

  const dayOffset = Math.floor(Math.random() * 5); // Mon–Fri

  const date = new Date(monday);
  date.setDate(monday.getDate() + dayOffset);

  const hour = 11 + Math.floor(Math.random() * 7); // 11–17

  date.setHours(hour, 0, 0, 0);

  const end = new Date(date.getTime() + 30 * 60000);

  return { start: date, end };
}

// ================= GOOGLE MEET =================
async function createEvent(email1, email2) {
  try {
    const { start, end } = getRandomMeetingTime();

    const event = {
      summary: "☕ Random Coffee",
      description: "Internal random coffee meeting",
      start: {
        dateTime: start.toISOString(),
        timeZone: "Europe/Moscow",
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: "Europe/Moscow",
      },
      attendees: [{ email: email1 }, { email: email2 }],
      conferenceData: {
        createRequest: {
          requestId: `${Date.now()}-${Math.random()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const res = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
      conferenceDataVersion: 1,
    });

    return res.data.hangoutLink;

  } catch (e) {
    console.error("Google error:", e.message);
    return null;
  }
}

// ================= TEXTS =================
function generateMessage(pairsText) {
  const templates = [
`Привет, коллеги! 👋

Вот ваши random coffee пары:
${pairsText}

Отличного общения ☕️`,

`Всем привет! 😊

Как начало недели?

Ваши пары:
${pairsText}`,

`Привет! ☕️

Новые знакомства на этой неделе:

${pairsText}`,

`Коллеги, привет! 👋

Случайные пары:
${pairsText}

Найдите 30 минут для общения 🙂`
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

  let newHistory = [...history];

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "☕ Random Coffee"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: message
      }
    },
    { type: "divider" }
  ];

  for (const [a, b] of pairs) {
    const emailA = await getEmail(a);
    const emailB = await getEmail(b);

    const meet = await createEvent(emailA, emailB);

    newHistory.push([a, b]);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `👥 <@${a}> ↔ <@${b}>\n📅 ${meet || "не удалось создать встречу"}`
      }
    });
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
