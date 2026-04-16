const fs = require("fs");
const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const HISTORY_FILE = "pairs_history.json";

// ===== GOOGLE =====
const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

oAuth2Client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN));

const calendar = google.calendar({ version: "v3", auth: oAuth2Client });

// ===== HISTORY =====
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  return JSON.parse(fs.readFileSync(HISTORY_FILE));
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ===== USERS =====
async function getUsers() {
  const res = await slack.conversations.members({ channel: CHANNEL_ID });
  const users = [];

  for (const id of res.members) {
    const info = await slack.users.info({ user: id });
    const user = info.user;

    const status = (user.profile.status_text || "").toLowerCase();

    const isOnVacation =
      status.includes("vacation") ||
      status.includes("pto") ||
      status.includes("leave") ||
      status.includes("отпуск");

    if (!user.is_bot && !user.deleted && !isOnVacation) {
      users.push(id);
    }
  }

  return users;
}

async function getUserEmail(userId) {
  const res = await slack.users.info({ user: userId });
  return res.user.profile.email;
}

// ===== PAIRS =====
function pairExists(history, u1, u2) {
  return history.some(
    ([a, b]) => (a === u1 && b === u2) || (a === u2 && b === u1)
  );
}

function makePairs(users, history) {
  let shuffled = [...users].sort(() => 0.5 - Math.random());
  const pairs = [];

  while (shuffled.length >= 2) {
    let u1 = shuffled.shift();

    let index = shuffled.findIndex(u2 => !pairExists(history, u1, u2));
    if (index === -1) index = 0;

    let u2 = shuffled.splice(index, 1)[0];
    pairs.push([u1, u2]);
  }

  return pairs;
}

// ===== TIME =====
function getRandomMeetingTime() {
  const now = new Date();

  const dayOffset = Math.floor(Math.random() * 5); // пн-пт
  const hour = 11 + Math.floor(Math.random() * 7); // 11-17

  const date = new Date();
  date.setDate(now.getDate() + dayOffset + 1);
  date.setHours(hour, 0, 0);

  const end = new Date(date.getTime() + 30 * 60000);

  return { start: date, end };
}

// ===== GOOGLE EVENT =====
async function createEvent(email1, email2) {
  try {
    const { start, end } = getRandomMeetingTime();

    const event = {
      summary: "☕ Random Coffee",
      description: "Неформальная встреча",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: [{ email: email1 }, { email: email2 }],
      conferenceData: {
        createRequest: {
          requestId: Math.random().toString(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const res = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
      conferenceDataVersion: 1,
    });

    console.log("EVENT CREATED:", res.data.htmlLink);

    return res.data.hangoutLink;

  } catch (e) {
    console.error("GOOGLE ERROR:", e.message);
    return "❌ не удалось создать встречу";
  }
}

// ===== TEXT =====
function generateMessage(pairsText) {
  const texts = [
`Привет, коллеги! 👋

Представьте: случайная встреча у кофейного автомата... но в полностью виртуальном формате!

Устрой себе небольшой перерыв и познакомься с коллегой ☕️

Вот пары на эту неделю:
${pairsText}

Свяжись со своим напарником и выберите удобное время.

Отличного общения!`,

`Всем привет! 😊

Как проходит начало недели?

Ваши random coffee пары:
${pairsText}

Запланируйте 30 минут на знакомство 🙂`,

`Привет! ☕️

Новые знакомства — лучший способ начать неделю:

${pairsText}

Не откладывайте — напишите друг другу 🙂`,

`Коллеги, привет! 👋

Случайные пары на эту неделю:
${pairsText}

Найдите 30 минут для общения 🙂`
  ];

  return texts[Math.floor(Math.random() * texts.length)];
}

// ===== MAIN =====
async function main() {
  const history = loadHistory();
  const users = await getUsers();
  const pairs = makePairs(users, history);

  const pairsText = pairs
    .map(([u1, u2]) => `<@${u1}> и <@${u2}>`)
    .join("\n");

  const message = generateMessage(pairsText);

  const newHistory = [...history];

  for (const [u1, u2] of pairs) {
    const email1 = await getUserEmail(u1);
    const email2 = await getUserEmail(u2);

    const meetLink = await createEvent(email1, email2);

    console.log(`Meeting for ${u1} & ${u2}: ${meetLink}`);

    newHistory.push([u1, u2]);
  }

  saveHistory(newHistory);

  await slack.chat.postMessage({
    channel: CHANNEL_ID,
    text: message,
  });
}

main();
