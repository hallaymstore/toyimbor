# MongoDB Render.com Deployment Guide

## MongoDB Atlas sozlash

### 1. MongoDB Atlas akkauntini yaratish
- https://www.mongodb.com/cloud/atlas ga o'ting
- Bepul akkaunt yarating

### 2. Cluster yaratish
1. "Create Cluster" tugmasini bosing
2. M0 (bepul) tariffni tanlang
3. Cloud provider (AWS, GCP, Azure) tanlang - istalgan bo'ladi
4. Region tanlang (eng yaqin)
5. Cluster nomini kiriting
6. "Create Cluster" bosing

### 3. Database Users yaratish
1. "Database Access" bo'limiga o'ting
2. "+ Add New Database User" bosing
3. Username: `toyimbor_user` (istalgan)
4. Password: **Kuchli parol yarating** (saqlab oling!)
5. Database scope: "All Databases" tanlang
6. Roles: "readWriteAnyDatabase@admin" tanlang
7. "Add User" bosing

### 4. IP Whitelist qo'shish (Muhim!)
1. "Network Access" bo'limiga o'ting
2. "+ Add IP Address" bosing
3. "Allow Access from Anywhere" tanlang (0.0.0.0/0)
4. "Confirm" bosing

**ESLATMA:** Production uchun Render.com IP manzilini qo'shish kerak bo'ladi

### 5. Connection String olish
1. Clusteringiz ustiga "Connect" bosing
2. "Connect your application" tanlang
3. Node.js tanlang
4. Connection string nusxalang

## Render.com da deploy qilish

### 1. .env.production faylini yangilash
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/toyimbor_prod?retryWrites=true&w=majority
```

**Almashtirib o'tkazing:**
- `username` - sizning database userining
- `password` - sizning parolning
- `cluster` - sizning cluster nomining

### 2. Render.com da Environment Variables o'rnatish
1. Render dashboard ga o'ting
2. Sizning service ni tanlang
3. "Environment" bo'limiga o'ting
4. Quyidagi o'zgaruvchilarni qo'shing:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/toyimbor_prod?retryWrites=true&w=majority
JWT_SECRET=super_kuchli_secret_key_yarating
ADMIN_EMAIL=admin@toyimbor.uz
ADMIN_PASSWORD=kuchli_parol_yarating
NODE_ENV=production
```

### 3. Settings da PORT o'rnatish
- PORT: 10000 (Render default)
- yoki custom port o'rnating

### 4. Redeploy qilish
1. "Manual Deploys" > "Deploy latest commit"
2. Logs ni tekshiring

## Xatolarni tuzatish

### "Cannot connect to MongoDB"
**Buning sabablari:**
1. ❌ IP whitelisted emas - Har IP manzil qo'shy (0.0.0.0/0)
2. ❌ Noto'g'ri username/password
3. ❌ Noto'g'ri cluster nomi
4. ❌ Internet ulanmasi

### MongoDB tunnelini tekshirish
```bash
# Local terminalni ochib:
npm start
# Logs da "MongoDB ga muvaffaqiyatli ulandi!" bo'lishi kerak
```

### Render logs ni ko'rish
1. Render dashboard > Service
2. "Logs" bo'limiga o'ting
3. Xatolarni qidiring

## MongoDB ma'lumotlarni tekshirish

### MongoDB Atlas UI orqali
1. Atlas dashboard ga o'ting
2. "Collections" > "Browse Collections" 
3. Database: `toyimbor_prod`
4. Collections ni ko'ring

## Performance Tips
- **Index yarating:** `db.users.createIndex({ email: 1 })`
- **Connection pooling:** Orqali enabled (default)
- **Monitoring:** MongoDB free monitoring ni yoqing

## Backup va Security
- MongoDB Atlas automatic backup qiladi (daily)
- IP whitelist to'g'ri sozlash
- Parol regul. o'zgartirib turing
- Production parolni shaxsiy saqlang
