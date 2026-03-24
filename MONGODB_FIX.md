# MongoDB Ulanish - Tez Tuzatish Guide

## Masala: "MongoDB ga ulanmayapti"

### Qismlar:

#### 1️⃣ **MongoDB Atlas o'rnatish** (5 daqiqa)
```
1. https://cloud.mongodb.com ga o'ting
2. "Create Cluster" > M0 (free) tanlang
3. "Create" bosing (3-5 daqiqa kutib oling)
```

#### 2️⃣ **Database User yaratish** (2 daqiqa)
```
1. MongoDB Atlas dashboard
2. "Database Access" > "+ Add New Database User"
3. Username: toyimbor_user
4. Password: Kuchli parol (SAQLAB QOYING!)
5. Role: readWriteAnyDatabase@admin
6. "Add User" bosing
```

#### 3️⃣ **IP Address whitelist qilish** (CRITICAL!)
```
⚠️ BU OSON XATO - ko'p odamlar bunga haloq bo'ladi

1. "Network Access" bo'limiga o'ting
2. "+ Add IP Address" bosing
3. "Allow Access from Anywhere" (0.0.0.0/0) tanlang
   👆 Bu muhim! Aks holda Render ulanmaydi
4. "Confirm" bosing
```

#### 4️⃣ **Connection String olish** (1 daqiqa)
```
1. Clusteringiz nomiga bosing
2. "Connect" tugmasini bosing
3. "Connect your application"
4. Node.js tanlang (default)
5. String nusxalang

Namuna:
mongodb+srv://toyimbor_user:password123@cluster0.xxxxx.mongodb.net/toyimbor_prod?retryWrites=true&w=majority
```

#### 5️⃣ **Render.com da o'rnating**
```
Service > Environment > qo'shing:

MONGODB_URI=mongodb+srv://toyimbor_user:password123@cluster0.xxxxx.mongodb.net/toyimbor_prod?retryWrites=true&w=majority

Keyin "Save" > "Deploy latest commit"
```

#### 6️⃣ **Logs ni tekshiring**
```
Render dashboard > Service > Logs

Quyidagi chiqishi bizni xursand qiladi:
✓ MongoDB ga muvaffaqiyatli ulandi!
🎉 ToyImbor server ishlayapti: http://localhost:10000
```

---

## Eng ko'p xatolar

| Xato | Sabab | Yechim |
|------|-------|--------|
| "Cannot connect to MongoDB" | IP whitelist yo'q | 0.0.0.0/0 qo'shing |
| "Invalid username/password" | Noto'g'ri login ma'lumotlari | Username:password to'g'ri kirganini tekshirg |
| "Server crashed" | MONGODB_URI noto'g'ri | Connection string nusxalang |
| "Connection timeout" | Cluster ishlamayapti | MongoDB Atlas da tekshirib ko'ring |

---

## Local test qilish

```bash
# 1. .env fayl yangilash
MONGODB_URI=mongodb+srv://toyimbor_user:password@...

# 2. Start server
npm start

# 3. Agar quyidagi ko'rsa - OK!
✓ MongoDB ga muvaffaqiyatli ulandi!
```

---

## Hashamatli Debugging

Agar hali ham ishlamasa:

```bash
# Render logs ni ko'ring
# Service > Logs orqali

# Xatolarni tekshiring:
# ❌ "error" yoki "Error" qo'ng'iroqlar
# ❌ "Cannot connect"
# ❌ "timeout"

# MONGODB_URI ni tekshiring:
echo $MONGODB_URI  # Local
# Render > Environment da ko'ring

# MongoDB Atlas statusini tekshiring:
# https://cloud.mongodb.com > Cluster status
```

---

## ✅ Hammasini amalga oshgarida:

1. ✅ MongoDB Atlas cluster active
2. ✅ Database user yaratildi
3. ✅ IP whitelist: 0.0.0.0/0
4. ✅ Connection string nusxalandi
5. ✅ MONGODB_URI Render da o'rnatildi
6. ✅ Server deployed va ishga tushdi
7. ✅ Logs da muvaffaqiyat xabari ko'rind

**Endi MongoDB ulanib bo'ldi! 🎉**

---

## Qo'shimcha Savollar

**S:** Parol unutdim?
**J:** MongoDB Atlas > Database Access > noto'g'ri user ni o'chirib yangi yarating

**S:** Cluster qanday o'chirish kerak?
**J:** Cluster > ... menu > Delete Cluster

**S:** Port 10000 nima?
**J:** Render default porti (custom port o'rnatsa bo'ladi)

**S:** Admin parolini qanday o'zgartirib qo'yaman?
**J:** ADMIN_PASSWORD environment variable o'zgartirib qo'ying

---

📖 **To'liq Deployment Guide:** [RENDER_DEPLOYMENT.md](RENDER_DEPLOYMENT.md)
📖 **MongoDB Setup Guide:** [MONGODB_SETUP.md](MONGODB_SETUP.md)
