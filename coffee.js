import os
import random
from slack_sdk import WebClient

SLACK_TOKEN = os.environ["SLACK_BOT_TOKEN"]
CHANNEL_ID = os.environ["SLACK_CHANNEL_ID"]

client = WebClient(token=SLACK_TOKEN)


def get_users():
    response = client.conversations_members(channel=CHANNEL_ID)
    members = response["members"]

    # получаем инфу о пользователях и фильтруем
    users = []
    for user_id in members:
        user_info = client.users_info(user=user_id)["user"]

        # исключаем ботов и неактивных
        if not user_info.get("is_bot") and not user_info.get("deleted"):
            users.append(user_id)

    return users


def make_pairs(users):
    random.shuffle(users)
    pairs = []

    for i in range(0, len(users), 2):
        if i + 1 < len(users):
            pairs.append((users[i], users[i + 1]))

    return pairs


def format_pairs(pairs):
    text = ""
    for u1, u2 in pairs:
        text += f"<@{u1}> и <@{u2}>\n"
    return text


def generate_message(pairs_text):
    templates = [
        f"""Привет, коллеги! 👋

Представьте: случайная встреча у кофейного автомата... но в полностью виртуальном формате!

Устрой себе заслуженный перерыв и познакомься со случайным коллегой ☕️

Вот пары на эту неделю:
{pairs_text}

Свяжись со своим напарником, чтобы договориться о встрече на 30 минут.

Открой календарь:
https://calendar.google.com/calendar/u/0/r/week

Отлично проведите время!""",

        f"""Всем привет! 😊

Как ваше начало недели?

Предлагаем сделать его ещё лучше — познакомиться с коллегой чуть ближе!

Ваши random coffee пары:
{pairs_text}

Договоритесь о встрече на 30 минут в течение недели 🙂

Открой календарь:
https://calendar.google.com/calendar/u/0/r/week

Хорошего настроения!""",

        f"""Привет! ☕️

Отличное начало недели — это новые знакомства!

На этой неделе у вас есть шанс пообщаться с коллегой вне рабочих задач:

{pairs_text}

Темы для разговора:
— Как проходит неделя?
— Чем занимаетесь вне работы?
— Любимые фильмы или сериалы?

Не откладывайте — напишите своему напарнику 🙂

Открой календарь:
https://calendar.google.com/calendar/u/0/r/week"""
    ]

    return random.choice(templates)


def main():
    users = get_users()
    pairs = make_pairs(users)
    pairs_text = format_pairs(pairs)
    message = generate_message(pairs_text)

    client.chat_postMessage(
        channel=CHANNEL_ID,
        text=message
    )


if __name__ == "__main__":
    main()
