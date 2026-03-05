# JOBBER Pro Backend - PostgreSQL + Express.js

## 🎯 Overview

Production-ready Node.js/Express backend for JOBBER Pro desktop application with:
- PostgreSQL database
- JWT authentication
- Trial enforcement (30 days)
- Device fingerprinting
- Angel One account binding
- Audit logging (compliance)
- Rate limiting
- Security headers

---

## 📋 Prerequisites

✅ **PostgreSQL 14+** (You have this!)
✅ **pgAdmin** (You have this!)
✅ **Node.js 18+**
✅ **npm**

---

## ⚡ QUICK START (5 Minutes)

### **STEP 1: Clone/Extract Backend**
```bash
cd C:\Projects
# Extract jobber-backend folder here
cd jobber-backend
```

### **STEP 2: Install Dependencies**
```bash
npm install
```

### **STEP 3: Configure Database**

Open **pgAdmin** and:

1. **Right-click "Databases"** → Create → Database
2. **Name:** `jobber_pro`
3. **Owner:** `postgres`
4. **Click "Save"**

**OR** use command line:
```bash
# Windows (Run in Command Prompt)
psql -U postgres -c "CREATE DATABASE jobber_pro;"
```

### **STEP 4: Create .env File**
```bash
copy .env.example .env
```

**Edit `.env`** (important!):
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jobber_pro
DB_USER=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE  # ← Change this!

JWT_SECRET=change-this-to-random-string-minimum-32-chars
JWT_REFRESH_SECRET=change-this-to-another-random-string-32-chars
```

### **STEP 5: Setup Database Schema**
```bash
npm run db:migrate
```

You should see:
```
🔧 Setting up database...
✓ Database already exists: jobber_pro
📋 Running database schema...
✓ Schema applied successfully

✓ Tables created:
  - users
  - device_fingerprints
  - angel_bindings
  - refresh_tokens
  - audit_logs

✅ Database setup complete!
```

### **STEP 6: Start Backend**
```bash
npm run dev
```

You should see:
```
🚀 JOBBER Pro Backend running on port 3000
📊 Environment: development
🔒 CORS enabled for: http://localhost:5173
```

### **STEP 7: Test It**

Open browser: http://localhost:3000/health

You should see:
```json
{
  "status": "healthy",
  "timestamp": "2024-12-01T...",
  "uptime": 12.345,
  "database": "connected"
}
```

✅ **BACKEND IS READY!**

---

## 🔗 Connect to Electron App

### **Update Electron App .env**

In your **jobber-desktop** folder, edit `.env`:

```env
BACKEND_URL=http://localhost:3000
```

### **Restart Electron App**
```bash
cd ../jobber-desktop
npm run dev
```

### **Test Registration**

1. Click "Register"
2. Enter:
   - Email: `test@test.com`
   - Mobile: `9876543210`
   - Password: `test123`
3. Click "Create Account"

**It should work!** ✅

You'll see a success message or the Angel login screen.

---

## 📊 Database Structure

```sql
users                    # User accounts
├── id                   # UUID
├── email                # Unique email
├── password_hash        # bcrypt hash
├── plan                 # TRIAL, PAID, EXPIRED
├── trial_end_date       # 30 days from registration
└── ...

device_fingerprints      # Hardware fingerprints
├── user_id              # Foreign key
├── fingerprint          # SHA-256 hash (unique)
├── machine_id           # Machine ID
├── platform             # win32, darwin, linux
└── ...

angel_bindings          # Angel One accounts
├── user_id             # Foreign key
├── angel_client_id     # Angel ID (unique)
└── device_fingerprint  # Locked to device

refresh_tokens          # JWT refresh tokens
├── user_id             # Foreign key
├── token               # Refresh token
├── expires_at          # 7 days
└── revoked_at          # Logout time

audit_logs              # Compliance logs
├── user_id             # Foreign key
├── action              # REGISTER, LOGIN, etc.
├── ip_address          # User IP
└── created_at          # Timestamp
```

---

## 🔐 API Endpoints

### **Authentication**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create new user (30-day trial) |
| POST | `/auth/login` | Login existing user |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout (revoke token) |
| GET | `/auth/me` | Get current user |
| POST | `/auth/bind-angel` | Bind Angel account |

### **Health**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |

---

## 🧪 Testing Endpoints

### **1. Register User**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "amit@example.com",
    "mobile": "9876543210",
    "password": "password123",
    "deviceFingerprint": {
      "deviceId": "test-device",
      "machineId": "test-machine",
      "fingerprint": "abc123test",
      "platform": "win32",
      "osVersion": "Windows 11",
      "cpuModel": "Intel i7",
      "cpuCores": 8,
      "totalMemory": 16000000000,
      "macAddress": "00:00:00:00:00:00"
    }
  }'
```

**Response:**
```json
{
  "user": {
    "id": "uuid...",
    "email": "amit@example.com",
    "plan": "TRIAL",
    "trialEndDate": "2024-12-31T..."
  },
  "tokens": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "expiresAt": 1234567890
  },
  "requiresAngelLogin": true
}
```

### **2. Login**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "amit@example.com",
    "password": "password123",
    "deviceFingerprint": {
      "deviceId": "test-device",
      "machineId": "test-machine",
      "fingerprint": "abc123test",
      "platform": "win32",
      "osVersion": "Windows 11",
      "cpuModel": "Intel i7",
      "cpuCores": 8,
      "totalMemory": 16000000000,
      "macAddress": "00:00:00:00:00:00"
    }
  }'
```

### **3. Get Current User**
```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## 🔧 Database Management

### **View Tables (pgAdmin)**

1. Open **pgAdmin**
2. Expand: **Servers** → **PostgreSQL 14** → **Databases** → **jobber_pro**
3. Right-click **jobber_pro** → **Query Tool**

```sql
-- View all users
SELECT * FROM users;

-- View device fingerprints
SELECT * FROM device_fingerprints;

-- View audit logs
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10;

-- Check trial expirations
SELECT email, trial_end_date, plan 
FROM users 
WHERE plan = 'TRIAL';
```

### **Manual Schema Update**

If you need to update the schema:

1. Edit `database/schema.sql`
2. Run:
```bash
psql -U postgres -d jobber_pro -f database/schema.sql
```

### **Reset Database**

```bash
# Drop and recreate
psql -U postgres -c "DROP DATABASE jobber_pro;"
psql -U postgres -c "CREATE DATABASE jobber_pro;"
npm run db:migrate
```

---

## 🚨 Troubleshooting

### **Error: "Database does not exist"**
```bash
# Create manually
psql -U postgres -c "CREATE DATABASE jobber_pro;"
```

### **Error: "password authentication failed"**
→ Check `.env` file - `DB_PASSWORD` must match your PostgreSQL password

### **Error: "Port 3000 already in use"**
→ Change port in `.env`:
```env
PORT=3001
```

### **Error: "relation does not exist"**
→ Run migrations:
```bash
npm run db:migrate
```

### **CORS Error in Electron**
→ Check `CORS_ORIGIN` in `.env`:
```env
CORS_ORIGIN=http://localhost:5173
```

---

## 📝 Environment Variables

```env
# Required
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jobber_pro
DB_USER=postgres
DB_PASSWORD=your_password

JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-key

# Optional
PORT=3000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

---

## 🔒 Security Features

✅ **bcrypt password hashing** (10 rounds)
✅ **JWT tokens** (15min access, 7day refresh)
✅ **Rate limiting** (100 req/15min, 5 login/15min)
✅ **Helmet.js** (security headers)
✅ **CORS** (restricted origins)
✅ **Device fingerprinting** (hardware-based)
✅ **Audit logging** (compliance trail)
✅ **SQL injection protection** (parameterized queries)

---

## 📊 Trial Enforcement

### **How It Works**

1. **Registration:** User gets 30-day trial
   ```sql
   trial_end_date = CURRENT_TIMESTAMP + INTERVAL '30 days'
   ```

2. **Trial Check:** Automatic expiry check
   ```sql
   SELECT * FROM users 
   WHERE plan = 'TRIAL' 
   AND trial_end_date < CURRENT_TIMESTAMP;
   ```

3. **Hard Lock:** After 30 days
   ```sql
   UPDATE users SET plan = 'EXPIRED' WHERE ...
   ```

4. **Device Binding:** One device per trial user
   ```sql
   UNIQUE(user_id, angel_client_id)
   ```

---

## 🎯 Next Steps

1. ✅ Backend running
2. ⬜ Test with Electron app
3. ⬜ Add payment integration (Stripe/Razorpay)
4. ⬜ Deploy to production
5. ⬜ Setup monitoring

---

## 📞 Need Help?

Tell me:
1. What error you see
2. Which step you're on
3. Screenshot of error (if possible)

---

**Ready to test with the Electron app!** 🚀
