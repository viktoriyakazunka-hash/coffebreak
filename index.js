const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const slack = new WebClient(SLACK_TOKEN);

// ===== GOOGLE SETUP =====
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/calendar"],
  process.env.GOOGLE_IMPERSONATE_USER // user@company.com
);

const calendar = google.calendar({ version: "v3", auth });

// ===== GET USERS =====
async function getUsers() {
  const res = await slack.conversations.members({
    channel: CHANNEL_ID,
  });

  const users = [];

  for (const id of res.members) {
    const info = await slack.users.info({ user: id });

    if (!info.user.is_bot && !info.user.deleted) {
      users.push(id);
    }
  }

  return users;
}

// ===== MAKE PAIRS =====
function makePairs(users) {
  const shuffled = users.sort(() => 0.5 - Math.random());
  const pairs = [];

  for (let i = 0; i < shuffled.length; i += 2) {
    if (shuffled[i + 1]) {
      pairs.push([shuffled[i], shuffled[i + 1]]);
    }
  }

  return pairs;
}

// ===== FORMAT =====
function formatPairs(pairs) {
  return pairs
    .map(([u1, u2]) => `<@${u1}> и <@${u2}>`)
    .join("\n");
}

// ===== RANDOM TEXT =====
function generateMessage(pairsText) {
  const templates = [
`Привет, коллеги! 👋

Вот ваши random coffee пары:
${pairsText}

Свяжитесь друг с другом и найдите удобное время ☕️

Открыть календарь:
https://calendar.google.com/calendar/u/0/r/week`,

`Всем привет! 😊

Как начало недели?

Пары для общения:
${pairsText}

Запланируйте 30 минут на знакомство 🙂`,

`Привет! ☕️

Новые знакомства = хорошее настроение!

Ваши пары:
${pairsText}

Не откладывайте — напишите друг другу 🚀`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// ===== CREATE GOOGLE EVENT =====
async function createEvent(email1, email2) {
  const event = {
    summary: "☕ Random Coffee",
    description: "Неформальная встреча",
    start: {
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // завтра
      timeZone: "Europe/Berlin",
    },
    end: {
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60000),
      timeZone: "Europe/Berlin",
    },
    attendees: [
      { email: email1 },
      { email: email2 },
    ],
    conferenceData: {
      createRequest: {
        requestId: Math.random().toString(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const res = await calendar.events.insert({
    calendarId: process.env.GOOGLE_IMPERSONATE_USER,
    resource: event,
    conferenceDataVersion: 1,
  });

  return res.data.hangoutLink;
}

// ===== MAIN =====
async function main() {
  const users = await getUsers();
  const pairs = makePairs(users);
  const pairsText = formatPairs(pairs);

  const message = generateMessage(pairsText);

  await slack.chat.postMessage({
    channel: CHANNEL_ID,
    text: message,
  });
}

main();
