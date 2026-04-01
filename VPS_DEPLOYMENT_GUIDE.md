# VPS Deployment Guide — ZayMail (mail.zayvex.cloud)

## আপনার প্রজেক্টে ৩টি আলাদা সার্ভিস আছে:

| # | সার্ভিস | কাজ | ভাষা |
|---|---------|------|------|
| 1 | **API Server** | Web mail API (Express.js) + email notification via Bot API | Node.js |
| 2 | **Web Mail Client** | Frontend UI (React) | Static HTML/JS/CSS |
| 3 | **Telegram Bot** | Email bot (master_bot.py) | Python |
| 4 | **Cloudflare Worker** | Email receive করা | JS (Cloudflare এ deploy) |

## Email Flow (Port 25 দরকার নেই!)

```
Email আসে → Cloudflare Email Routing → Worker → POST /api/incoming-mail → MongoDB store → Telegram notification (Bot API)
```

- VPS-এ কোনো SMTP server/port 25 লাগে না
- Cloudflare Worker email receive করে API-তে POST করে
- API email store করে + Bot API দিয়ে Telegram notification পাঠায়

---

## ধাপ ১: VPS এ প্রয়োজনীয় সফটওয়্যার ইনস্টল

```bash
sudo apt update && sudo apt upgrade -y

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

npm install -g pnpm

sudo apt install -y python3 python3-pip python3-venv

sudo apt install -y nginx

npm install -g pm2
```

---

## ধাপ ২: প্রজেক্ট আপলোড ও বিল্ড

```bash
cd /home/your-user
git clone <your-repo-url> mailbot
cd mailbot

pnpm install

cd artifacts/api-server
pnpm run build
cd ../..

cd artifacts/web-mail
PORT=3000 BASE_PATH=/ pnpm run build
cd ../..
```

---

## ধাপ ৩: Environment Variables সেটআপ

প্রজেক্ট root এ `.env` ফাইল তৈরি করুন:

```bash
nano /home/your-user/mailbot/.env
```

```env
# ===== API Server =====
PORT=8080
NODE_ENV=production

# MongoDB connections
BOT1_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/
BOT2_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/
BOT1_DB_NAME=mailbot_pro
BOT2_DB_NAME=mailbot_pro

# JWT Secret (একটি শক্তিশালী random string দিন)
JWT_SECRET=your-super-secret-random-string-here-change-this

# API key (Cloudflare Worker + Bot token generation দুটোই এটা ব্যবহার করে)
INCOMING_MAIL_API_KEY=your-incoming-mail-api-key

# CORS
CORS_ORIGINS=https://mail.zayvex.cloud

# Bot tokens (API server থেকে Telegram notification পাঠানোর জন্য)
BOT1_TG_BOT_TOKEN=123456:ABC-your-bot1-token
BOT2_TG_BOT_TOKEN=789012:DEF-your-bot2-token
BOT1_SUPER_ADMIN_IDS=7166047321
BOT2_SUPER_ADMIN_IDS=7166047321

# ===== Telegram Bot =====
BOT1_API_ID=your-bot1-api-id
BOT1_API_HASH=your-bot1-api-hash
BOT2_API_ID=your-bot2-api-id
BOT2_API_HASH=your-bot2-api-hash
SUPER_ADMIN_IDS=7166047321

# Bot → API communication (login link generation)
API_BASE_URL=https://mail.zayvex.cloud/api
# INCOMING_MAIL_API_KEY উপরেরটাই ব্যবহার হবে (একই key)

WEB_BASE_URL=https://mail.zayvex.cloud
TIMEZONE=Asia/Dhaka
```

---

## ধাপ ৪: PM2 দিয়ে সার্ভিসগুলো চালু করা

**ecosystem.config.cjs** ফাইল তৈরি করুন (প্রজেক্ট root এ):

```bash
nano /home/your-user/mailbot/ecosystem.config.cjs
```

```javascript
module.exports = {
  apps: [
    {
      name: "api-server",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/home/your-user/mailbot",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        PORT: 8080,
      },
      env_file: ".env",
      instances: 1,
      autorestart: true,
      max_memory_restart: "500M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
    {
      name: "telegram-bot",
      script: "master_bot.py",
      cwd: "/home/your-user/mailbot",
      interpreter: "python3",
      env_file: ".env",
      autorestart: true,
      max_memory_restart: "300M",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
```

```bash
# Python Dependencies
cd /home/your-user/mailbot
pip3 install telethon motor aiohttp python-dotenv uvloop bcrypt

# সব সার্ভিস চালু করুন
pm2 start ecosystem.config.cjs

# চেক করুন সব চলছে কিনা
pm2 status

# VPS restart হলে যেন auto-start হয়
pm2 startup
pm2 save

# লগ দেখতে
pm2 logs api-server
pm2 logs telegram-bot
```

---

## ধাপ ৫: Nginx কনফিগ (Reverse Proxy + Static Files)

```bash
sudo nano /etc/nginx/sites-available/mailbot
```

```nginx
server {
    listen 80;
    server_name mail.zayvex.cloud;

    root /home/your-user/mailbot/artifacts/web-mail/dist/public;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_buffering off;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    client_max_body_size 10M;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mailbot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## ধাপ ৬: Cloudflare Tunnel দিয়ে HTTPS (mail.zayvex.cloud)

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel login

cloudflared tunnel create zaymail

mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

**config.yml:**
```yaml
tunnel: zaymail
credentials-file: /home/your-user/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: mail.zayvex.cloud
    path: /api/*
    service: http://localhost:8080
  - hostname: mail.zayvex.cloud
    service: http://localhost:80
  - service: http_status:404
```

```bash
cloudflared tunnel route dns zaymail mail.zayvex.cloud

pm2 start "cloudflared tunnel run zaymail" --name cloudflare-tunnel
pm2 save
```

**Nginx তখনও লাগবে** static files serve করার জন্য (port 80 এ), কিন্তু SSL/HTTPS Cloudflare Tunnel handle করবে।

---

## ধাপ ৭: Cloudflare Email Worker Deploy

এটি আপনার VPS এ না, Cloudflare এ deploy হবে:

```bash
cd /home/your-user/mailbot
npx wrangler deploy cloudflare_email_worker.js --config cloudflare_wrangler.toml

npx wrangler secret put INCOMING_MAIL_API_KEY --config cloudflare_wrangler.toml
```

Cloudflare Dashboard এ যান → Email Routing → আপনার domain select করুন → Catch-all rule এ worker সেট করুন।

**Email Routing সেটআপ:**
1. Cloudflare Dashboard → আপনার domain → Email → Email Routing
2. Enable Email Routing
3. Routes → Catch-all → Edit → Route to Worker → `zaymail-email-worker` select করুন
4. Save

---

## গুরুত্বপূর্ণ: INCOMING_MAIL_API_KEY

এই একটি key ৩ জায়গায় একই থাকতে হবে:

| যেখানে | কেন |
|--------|-----|
| **API Server `.env`** | Cloudflare Worker + Bot দুটোই এটা দিয়ে authenticate করে |
| **Cloudflare Worker secret** | Email POST করার সময় `X-API-Key` header এ পাঠায় |
| **Bot `.env`** (`INCOMING_MAIL_API_KEY`) | Login link তৈরি করার সময় API-তে authenticate করতে |

---

## ফাইল স্ট্রাকচার (VPS এ যা দরকার)

```
/home/your-user/mailbot/
├── .env
├── ecosystem.config.cjs
├── master_bot.py
├── bot1_session, bot2_session
├── artifacts/
│   ├── api-server/
│   │   └── dist/
│   │       └── index.mjs
│   └── web-mail/
│       └── dist/
│           └── public/
│               ├── index.html
│               ├── assets/
│               └── ...
└── node_modules/
```

---

## দরকারী PM2 Commands

```bash
pm2 status                  # সব সার্ভিস এর অবস্থা
pm2 logs                    # সব লগ দেখা
pm2 logs api-server         # শুধু API লগ
pm2 restart api-server      # API restart
pm2 restart all             # সব restart
pm2 monit                   # Live monitoring
pm2 stop all                # সব বন্ধ
```

---

## আপডেট করার সময়

```bash
cd /home/your-user/mailbot
git pull

# API rebuild
cd artifacts/api-server && pnpm run build && cd ../..

# Frontend rebuild
cd artifacts/web-mail && PORT=3000 BASE_PATH=/ pnpm run build && cd ../..

# Restart
pm2 restart api-server
pm2 restart telegram-bot
```

---

## Troubleshooting

| সমস্যা | সমাধান |
|--------|--------|
| Site লোড হচ্ছে না | `pm2 status` চেক করুন, `sudo nginx -t` চালান |
| API error | `pm2 logs api-server` দেখুন |
| MongoDB connect fail | `.env` এ URI ঠিক আছে কিনা চেক করুন |
| Bot চলছে না | `pm2 logs telegram-bot` দেখুন, session files চেক করুন |
| Tunnel কাজ করছে না | `pm2 logs cloudflare-tunnel` দেখুন |
| Email আসছে না | Cloudflare Dashboard → Email Routing চেক করুন, Worker logs দেখুন |
| Login link কাজ করছে না | Bot ও API-তে `INCOMING_MAIL_API_KEY` একই কিনা চেক করুন |
| Notification আসছে না | API-তে `BOT1_TG_BOT_TOKEN`/`BOT2_TG_BOT_TOKEN` সেট আছে কিনা চেক করুন |
