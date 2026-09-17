# Localhost + Live Stripe + Live DB (simple)

You are not doing anything wrong. There are **three separate pipes** and people mix them up.

---

## Pipe 1: Your browser → your app

| You open | What runs |
|----------|-----------|
| `http://localhost:3000` | The **Node app on your Mac** (`npm run dev`) |

That is the only thing "localhost" means.

---

## Pipe 2: Your app → Stripe and MongoDB

Your `.env` tells the app **which keys and database to use**.

If you use **live** Stripe keys and **live** MongoDB:

- When you click checkout or load the admin panel, your **local** app talks to **real** Stripe and **real** data.

So: **localhost = where the code runs. Live keys = real money / real customers in that code.**

---

## Pipe 3: Stripe → your server (webhooks)

This is the confusing one.

**Stripe does not know your laptop exists.** It only sends webhooks to **URLs you put in the Stripe Dashboard**, e.g.:

`https://tideincal.com/api/stripe/webhook`

So:

| Event | Goes to |
|-------|---------|
| Customer pays on the real site | Stripe POSTs to **tideincal.com** (your deployed server) |
| You run `npm run dev` on your Mac | Stripe **does not** POST to localhost for that |

Your **local** terminal will **not** show `[webhook]` lines from real customers unless you use **Stripe CLI** to forward events to `127.0.0.1:3000` (advanced / optional for debugging).

**The Stripe Dashboard "Event deliveries" page** shows whether **production** received the webhook. That is the right place to see if live checkouts are OK.

---

## One picture

```
You (browser)  →  localhost:3000  →  Live Mongo + Live Stripe API
                         ↑
                    (your code)

Stripe (servers)  →  tideincal.com/api/stripe/webhook  →  production server
                         ↑
                    (webhooks only — not your Mac unless you forward)
```

---

## What you actually need to care about

| Goal | What to check |
|------|----------------|
| "Are customers' payments updating the live site?" | Stripe Dashboard → Webhooks → **200** on `checkout.session.completed` (you already have this). |
| "Is my local admin panel showing real data?" | Yes, if `MONGO_URI` is production — that's expected. |
| "Do webhooks hit my Mac when I code?" | **No**, not by default — and that's normal. Use CLI only if you need to debug the webhook handler locally. |

---

## If you feel lost

1. **Production health:** Stripe Dashboard webhooks + your live site behavior.  
2. **Local coding:** `npm run dev` + browser on localhost — webhooks are a separate topic.

You can ignore webhook-on-localhost until you specifically need to debug that code path.
