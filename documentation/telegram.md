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

Telegram is only a notification and human-input surface. It does not authorize live trading.
