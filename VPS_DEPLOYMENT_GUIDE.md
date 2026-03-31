# VPS Deployment Guide — ZayMail (zayvex.cloud)

## আপনার প্রজেক্টে ৩টি আলাদা সার্ভিস আছে:

| # | সার্ভিস | কাজ | ভাষা |
|---|---------|------|------|
| 1 | **API Server** | Web mail API (Express.js) | Node.js |
| 2 | **Web Mail Client** | Frontend UI (React) | Static HTML/JS/CSS |
| 3 | **Telegram Bot** | Email bot (master_bot.py) | Python |
| 4 | **Cloudflare Worker** | Email receive করা | JS (Cloudflare এ deploy) |

---

## ধাপ ১: VPS এ প্রয়োজনীয় সফটওয়্যার ইনস্টল

```bash
# System update
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS install (recommended for production)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm install
npm install -g pnpm

# Python 3 + pip
sudo apt install -y python3 python3-pip python3-venv

# Nginx (reverse proxy)
sudo apt install -y nginx

# PM2 (process manager — সব সার্ভিস চালু রাখবে, VPS restart হলেও)
npm install -g pm2

# Certbot (free SSL certificate)
sudo apt install -y certbot python3-certbot-nginx
```

---

## ধাপ ২: প্রজেক্ট আপলোড ও বিল্ড

```bash
# প্রজেক্ট আপলোড (git clone অথবা scp/rsync)
cd /home/your-user
git clone <your-repo-url> mailbot
cd mailbot

# Dependencies install
pnpm install

# ===== API Server Build =====
cd artifacts/api-server
pnpm run build
# Output: artifacts/api-server/dist/index.mjs
cd ../..

# ===== Web Mail Build =====
cd artifacts/web-mail
PORT=3000 BASE_PATH=/ pnpm run build
# Output: artifacts/web-mail/dist/public/ (static files)
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

# MongoDB connections (আপনার MongoDB Atlas বা local MongoDB)
BOT1_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/
BOT2_MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/
BOT1_DB_NAME=mailbot_pro
BOT2_DB_NAME=mailbot_pro

# JWT Secret (একটি শক্তিশালী random string দিন)
JWT_SECRET=your-super-secret-random-string-here-change-this

# Cloudflare Worker এর জন্য API key
INCOMING_MAIL_API_KEY=your-incoming-mail-api-key

# ===== Telegram Bot =====
BOT1_API_ID=your-bot1-api-id
BOT1_API_HASH=your-bot1-api-hash
BOT1_BOT_TOKEN=your-bot1-token
BOT2_API_ID=your-bot2-api-id
BOT2_API_HASH=your-bot2-api-hash
BOT2_BOT_TOKEN=your-bot2-token
SUPER_ADMIN_IDS=123456789,987654321

# SMTP (দরকার নেই যদি Cloudflare Email Worker ব্যবহার করেন)
# SMTP_HOST=0.0.0.0
# SMTP_PORT=25
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
# সব সার্ভিস চালু করুন
cd /home/your-user/mailbot
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
    server_name zayvex.cloud;

    # ===== Frontend (Static React Files) =====
    root /home/your-user/mailbot/artifacts/web-mail/dist/public;
    index index.html;

    # React SPA — সব route এ index.html serve করবে
    location / {
        try_files $uri $uri/ /index.html;
    }

    # ===== API Proxy =====
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

    # ===== Static file caching =====
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # File upload size limit
    client_max_body_size 10M;
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/mailbot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t

# Restart nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## ধাপ ৬: Cloudflare Tunnel দিয়ে HTTPS (zayvex.cloud)

Cloudflare Tunnel ব্যবহার করলে SSL certificate, Nginx reverse proxy কিছুই লাগে না! Cloudflare সব handle করবে।

```bash
# cloudflared install
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Login to Cloudflare
cloudflared tunnel login

# Tunnel তৈরি করুন
cloudflared tunnel create zaymail

# Config file তৈরি করুন
mkdir -p ~/.cloudflared
nano ~/.cloudflared/config.yml
```

**config.yml:**
```yaml
tunnel: zaymail
credentials-file: /home/your-user/.cloudflared/<TUNNEL_ID>.json

ingress:
  # API requests
  - hostname: zayvex.cloud
    path: /api/*
    service: http://localhost:8080
  # Frontend (static files via Nginx)
  - hostname: zayvex.cloud
    service: http://localhost:80
  # Catch-all
  - service: http_status:404
```

```bash
# DNS record যোগ করুন (Cloudflare এ CNAME)
cloudflared tunnel route dns zaymail zayvex.cloud

# Tunnel চালু করুন (PM2 দিয়ে)
pm2 start "cloudflared tunnel run zaymail" --name cloudflare-tunnel
pm2 save
```

**Nginx তখনও লাগবে** static files serve করার জন্য (port 80 এ), কিন্তু SSL/HTTPS Cloudflare Tunnel handle করবে। Nginx config এ `listen 80;` আর `server_name zayvex.cloud;` রাখুন।

এই সেটআপে:
- Cloudflare Tunnel → HTTPS terminate করে
- zayvex.cloud → Tunnel → Nginx (frontend) + API Server (backend)
- কোনো port open করতে হবে না VPS এ (extra secure!)

---

## ধাপ ৭: Cloudflare Email Worker Deploy

এটি আপনার VPS এ না, Cloudflare এ deploy হবে:

```bash
# আপনার local machine বা VPS থেকে
cd /home/your-user/mailbot
npx wrangler deploy cloudflare_email_worker.js --config cloudflare_wrangler.toml

# Secret set করুন
npx wrangler secret put INCOMING_MAIL_API_KEY --config cloudflare_wrangler.toml
```

Cloudflare Dashboard এ যান → Email Routing → আপনার domain select করুন → Catch-all rule এ worker সেট করুন।

---

## ফাইল স্ট্রাকচার (VPS এ যা দরকার)

```
/home/your-user/mailbot/
├── .env                              # Environment variables
├── ecosystem.config.cjs              # PM2 config
├── master_bot.py                     # Telegram bot
├── bot1_session, bot2_session        # Telegram sessions
├── artifacts/
│   ├── api-server/
│   │   └── dist/
│   │       └── index.mjs             # Built API server
│   └── web-mail/
│       └── dist/
│           └── public/               # Built frontend (Nginx serves this)
│               ├── index.html
│               ├── assets/
│               └── ...
└── node_modules/                     # pnpm install creates this
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

## Troubleshooting

| সমস্যা | সমাধান |
|--------|--------|
| Site লোড হচ্ছে না | `pm2 status` চেক করুন, `sudo nginx -t` চালান |
| API error | `pm2 logs api-server` দেখুন |
| MongoDB connect fail | `.env` এ URI ঠিক আছে কিনা চেক করুন |
| Bot চলছে না | `pm2 logs telegram-bot` দেখুন, session files চেক করুন |
| Tunnel কাজ করছে না | `pm2 logs cloudflare-tunnel` দেখুন, `cloudflared tunnel info zaymail` চালান |
| Email আসছে না | Cloudflare Dashboard → Email Routing চেক করুন, Worker logs দেখুন |
