# Telegram Notifications

Kairos uses the Telegram Bot API for human-facing alerts and lightweight commands.

## Create the bot

1. Open Telegram and message `@BotFather`.
2. Run `/newbot` and choose a display name and bot username.
3. Copy the bot token into `TELEGRAM_BOT_TOKEN`.
4. Set `KAIROS_TELEGRAM_NOTIFICATIONS_ENABLED=true`.
5. Set `TELEGRAM_WEBHOOK_SECRET` to a long random value.

## Configure the webhook through Kairos

Start the API, then call:

```bash
curl -X POST http://127.0.0.1:4321/telegram/webhook/configure \
  -H 'content-type: application/json' \
  -H 'x-kairos-local-request: 1' \
  -d '{"url":"https://YOUR_PUBLIC_HOST/telegram/webhook","dropPendingUpdates":true}'
```

Telegram requires an HTTPS webhook URL for the hosted Bot API.

## Bind your chat

After the webhook is configured, open your bot in Telegram and send:

```text
/start
```

Kairos stores that chat as an active Telegram binding. You can also bypass binding storage by setting `TELEGRAM_CHAT_ID` directly.

## Commands

- `/start`: enable alerts for the chat.
- `/stop`: disable alerts for the chat.
- `/status`: confirm the bot is connected.

## Research chat behavior

Non-command Telegram messages route to a Telegram-specific Deep Research wrapper.
It uses the same Deep Research tools, memory context, and image attachment
format, but with a group-chat-aware prompt:

- It understands private chats, groups, and supergroups.
- It treats different senders as different people in the conversation.
- It can answer casual remarks briefly instead of over-researching.
- It can interpret research intent, source-sharing, screenshots, charts, and
  "remember this" style messages.
- It preserves trading safety boundaries and never executes trades from chat.

## Group setup

Telegram bots in groups run in privacy mode by default. With privacy mode on,
the bot only receives commands, replies to the bot, and messages explicitly
meant for it. If the trading group expects Kairos to see ordinary group
conversation, add the bot as a group admin or disable privacy mode through
`@BotFather` and re-add the bot to the group.

## Images

Telegram image messages are converted into Deep Research image attachments.
Photos use the largest available Telegram photo size. Image documents are
accepted when their MIME type is PNG, JPEG, WebP, or GIF.

The hosted Telegram Bot API can download files up to 20 MB. Larger files require
running a local Telegram Bot API server or sending a smaller image.

Telegram is only a notification and human-input surface. It does not authorize live trading.
