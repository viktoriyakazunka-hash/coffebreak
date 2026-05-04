const fs = require("fs");
const { WebClient } = require("@slack/web-api");
const { google } = require("googleapis");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

const HISTORY_FILE = "pairs_history.json";

const EXCLUDED_EMAILS = ["viktoriya.kazunka@neuralab.tech"];

const SPECIAL_GROUP_EMAILS = [
  "v.kovalev@twinby.com",
  "a.parfenova@twinby.com",
  "gusev.dev@twinby.com",
  "egorov.dev@twinby.com"
];

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

// ================= EMAIL CACHE =================
const emailCache = {};

async function getEmailCached(id) {
  if (!emailCache[id]) {
    const res = await slack.users.info({ user: id });
    emailCache[id] = res.user.profile.email;
  }
  return emailCache[id];
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
      status.includes("vacationing") ||
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

  if (shuffled.length === 1 && pairs.length > 0) {
    const leftover = shuffled.shift();
    const randomIndex = Math.floor(Math.random() * pairs.length);
    pairs[randomIndex].push(leftover);
  }

  return pairs;
}

// ================= TIME =================
function getFixedThursdaySlot() {
  const now = new Date();

  // текущее время в МСК
  const moscowNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Moscow" })
  );

  const day = moscowNow.getDay(); // 0 вс, 1 пн, ..., 4 чт

  // считаем ближайший четверг
  let diffToThursday = 4 - day;

  // если уже после четверга → берем следующий
  if (diffToThursday < 0) diffToThursday += 7;

  const thursday = new Date(moscowNow);
  thursday.setDate(moscowNow.getDate() + diffToThursday);

  // ставим 15:00 МСК
  thursday.setHours(12, 0, 0, 0);

  const end = new Date(thursday.getTime() + 30 * 60000);

  return {
    start: thursday,
    end
  };
}

// ================= GOOGLE MEET =================
async function createMeeting(emails) {
  try {
    const { start, end } = getFixedThursdaySlot();

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
      guestsCanModify: true,
  guestsCanInviteOthers: false,
  guestsCanSeeOtherGuests: true,
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

Если слот неудобен — просто перенеси встречу в календаре 🙂

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

Напоминаю: наши виртуальные кофе-брейки теперь проходят каждый четверг в 15:00 по МСК :coffee:

Если время неудобное — не делайте вид, что не заметили. Напишите напарнику в DM: «Давай перенесём, а то у меня тут дедлайн горит». Он всё поймёт. Свои же люди. :blush:

Главное — не пропускайте возможность пообщаться! :custard:`,

`Всем привет!

Как проходит начало недели? :sun_with_face:

Предлагаю сделать его ещё лучше — познакомиться с кем-то из команды чуть ближе!
Темы для обсуждения: погода, интересы, как проведете свободное от работы время :coffee:

Напоминаю, что в четверг в 15:00 по МСК встречаемся с коллегой по Random Coffee.
Если время не подходит — смело пишите напарнику. Предложите своё. Поторгуйтесь. Можете даже камень-ножницы-бумага в DM устроить. Главное, чтобы кофе состоялся :pancakes:`,

`Привет!

Отличный повод отвлечься — встретиться с коллегой для непринужденной беседы :speech_balloon:

Если время не подходит — не ждите чуда. Чудо не случится. Напишите партнёру сами и договоритесь о переносе в DM. Главное — пообщаться! :cookie::coffee:`,

`Коллеги, привет! :wave:

Время для небольшой кофе-паузы и приятного общения!

Напоминаю: каждый четверг в 15:00 МСК — время Random Coffee. Встречайтесь в это время или договоритесь о переносе в личке.

Кофе-пауза ждёт! :cake::coffee:`,
    
 `Всем бодрого начала недели :grin:

Я запланировал в вашем календаре 30 минут для классного общения с коллегой по цеху!

Но если время не ваше — «заберите» встречу в личные сообщения и выпейте кофе в удобный для вас обоих день. Главное — не отменяйте, а переносите! :pretzel::coffee:`,
    
    `Всем привет! 🕵️‍♀️

У вас есть секретная миссия на четверг. В 15:00 по МСК встретиться с коллегой на Random Coffee и обменяться парой фраз не о работе.

Если время не шпионское (ну, заняты вы), откройте DM и переназначьте встречу на удобный час. Связь не прерывать! :coffee::doughnut:`,

 `Привет, команда! 🎧

Ваш позывной — Random Coffee. Задание: выйти на связь с коллегой в четверг в 15:00 МСК.

Если в эфир не пробиться :face_in_clouds: — переходите в DM и согласуйте новое время. Операция «Кофе-пауза» должна состояться в любом случае! :icecream::coffee:`,

`Привет! Как начало недели?
В четверг в 15:00 вас ждёт Random Coffee :wink:

Если вы, конечно, не заняты чем-то очень важным. Например, перекладываете файлы из одной папки в другую или смотрите в потолок. Тогда напишите в DM напарнику: «Давай перенесём». 
  Он поймёт. У него тоже есть потолок. :grin::coffee:`  
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

// ================= MAIN =================
async function main() {
  const history = loadHistory();
  const users = await getUsers();

  if (users.length < 2) {
    await slack.chat.postMessage({
      channel: CHANNEL_ID,
      text: "Недостаточно участников для random coffee ☕️"
    });
    return;
  }

  // ===== делим на группы =====
  const specialGroup = [];
  const regularGroup = [];

  for (const userId of users) {
    const email = await getEmailCached(userId);

    if (email && SPECIAL_GROUP_EMAILS.includes(email)) {
      specialGroup.push(userId);
    } else {
      regularGroup.push(userId);
    }
  }

  // фикс выпадения
  if (specialGroup.length < 2) {
    regularGroup.push(...specialGroup);
    specialGroup.length = 0;
  }

  // ===== пары =====
  const pairsSpecial = makePairs(specialGroup, history);
  const pairsRegular = makePairs(regularGroup, history);

  const pairs = [...pairsSpecial, ...pairsRegular];

  let newHistory = [...history];

  for (const group of pairs) {
    const emails = await Promise.all(group.map(getEmailCached));
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
