Here's everything you need, straight and practical.

---

## Setup

**1. Create an account**

Go to [twilio.com](https://www.twilio.com) and sign up. You'll receive $10 credit when you upgrade to a paid account, but the free trial lets you send messages to verified numbers immediately. No credit card required for the trial.

**2. Get your credentials**

From the [Twilio Console](https://console.twilio.com):
- Copy your **Account SID** Ñ starts with `AC...`
- Copy your **Auth Token** Ñ click the eye icon to reveal it
- Click **Get phone number** to provision a Twilio number (free on trial)

**3. Install the SDK**

```bash
pip install twilio python-dotenv
```

**4. Store credentials in `.env`**

```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_FROM_NUMBER=+15017122661    # your Twilio number
TWILIO_TO_NUMBER=+14155552671      # your personal number
```

---

## Sending Your First SMS

```python
import os
from dotenv import load_dotenv
from twilio.rest import Client

load_dotenv()

client = Client(
    os.environ["TWILIO_ACCOUNT_SID"],
    os.environ["TWILIO_AUTH_TOKEN"]
)

message = client.messages.create(
    body="Hello from your trading agent ??",
    from_=os.environ["TWILIO_FROM_NUMBER"],
    to=os.environ["TWILIO_TO_NUMBER"]
)

print(f"Sent: {message.sid}")  # SID confirms delivery
```

That's it. Run it and you'll get a text.

---

## Trial Account Limitation

On a free trial account you can only send to **verified numbers**. To verify your personal number:
- Go to Console ? Phone Numbers ? Verified Caller IDs
- Add and verify your number

This is the only real friction on the free tier. Once you add a paid method and upgrade, this restriction disappears.

---

## The Notification Function for Your Trading System

This is what you actually want Ñ a clean async function your agents call:

```python
import os
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException

_client = Client(
    os.environ["TWILIO_ACCOUNT_SID"],
    os.environ["TWILIO_AUTH_TOKEN"]
)

FROM = os.environ["TWILIO_FROM_NUMBER"]
TO   = os.environ["TWILIO_TO_NUMBER"]

def notify(message: str, urgent: bool = False) -> bool:
    """
    Send an SMS notification. Returns True if sent successfully.
    Keep messages under 160 chars for a single SMS segment.
    """
    prefix = "?? URGENT: " if urgent else "?? "
    body = f"{prefix}{message}"

    try:
        msg = _client.messages.create(body=body, from_=FROM, to=TO)
        print(f"SMS sent: {msg.sid}")
        return True
    except TwilioRestException as e:
        print(f"SMS failed: {e.msg}")
        return False


# Usage examples
notify("Law PLTR_DEALS fired. Confidence 0.83. Check debate.")
notify("BUY PLTR executed: 40 shares @ $83.60", urgent=True)
notify("Trade outcome: PLTR +7.2% in 5 days. Law performing well.")
```

---

## Message Length & Cost

- **160 characters** = 1 SMS segment = ~$0.0079
- Over 160 chars splits into multiple segments, each billed separately
- Keep trading alerts concise Ñ they're not emails

```python
def notify_trade_decision(
    ticker: str,
    decision: str,
    confidence: float,
    reasoning: str
) -> None:
    # Keep under 160 chars
    msg = f"{ticker}: {decision} ({confidence:.0%}). {reasoning[:80]}"
    notify(msg, urgent=(decision in ("BUY", "SELL")))
```

---

## Checking Message Status

```python
# Check if a message was delivered
msg = _client.messages(message_sid).fetch()
print(msg.status)
# "queued" ? "sending" ? "sent" ? "delivered" | "failed" | "undelivered"
```

---

## WhatsApp (Optional Upgrade)

Twilio also supports WhatsApp with the same API Ñ just change the `from_` and `to` prefixes:

```python
message = client.messages.create(
    body="Trading alert via WhatsApp",
    from_="whatsapp:+14155238886",   # Twilio's WhatsApp sandbox number
    to="whatsapp:+14155552671"       # your number
)
```

WhatsApp requires joining the sandbox first (one-time) Ñ text "join <sandbox-word>" to the sandbox number. After that it works identically to SMS but is free to receive on your end.

---

## Pricing Summary

| Type | Cost |
|---|---|
| Trial credit | ~$15 free |
| US SMS sent | ~$0.0079/segment |
| Phone number | ~$1.00/month |
| WhatsApp | ~$0.005/message |

For a trading system sending maybe 5-20 alerts per day, you're looking at a few dollars a month at most. Basically free.