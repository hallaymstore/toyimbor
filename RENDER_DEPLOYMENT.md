# ToyImbor - Render.com Deployment Guide

## Tez boshlash (Quick Start)

### 1. MongoDB Atlas o'rnatish
1. https://www.mongodb.com/cloud/atlas ga o'ting
2. **Cluster yarating:**
   - M0 (bepul) tariffni tanlang
   - Region: serveringiz yaqinida
   - Cluster nomi: `toyimbor`

3. **Database User yarating:**
   - Go'ing: Database Access
   - Username: `toyimbor_user`
   - Password: **Kuchli parol yarating**
   - Roles: `readWriteAnyDatabase@admin`

4. **IP manzilni whitelisting qilish (MUHIM!):**
   - Go'ing: Network Access
   - "+ Add IP Address" bosing
   - **0.0.0.0/0** tanlang (barcha IP dan ulanish ruxsati)
   - "Confirm" bosing

5. **Connection String olish:**
   - "Connect" > "Connect your application"
   - Nusxalang: `mongodb+srv://username:password@cluster.mongodb.net/toyimbor?retryWrites=true&w=majority`

### 2. Render.com da veb-xizmati yaratish

1. https://render.com ga o'ting
2. "New +" > "Web Service" bosing
3. GitHub reposini ulantirib ('toyimbor' tanlang)
4. Build command: `npm install`
5. Start command: `node server.js`

### 3. Environment Variables o'rnatish

Render dashboard da Service > Environment > quyidagilarni qo'shing:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/toyimbor?retryWrites=true&w=majority
JWT_SECRET=kuchli_secret_key_yarating
ADMIN_EMAIL=admin@toyimbor.uz
ADMIN_PASSWORD=kuchli_parol_yarating
ADMIN_CARD=9860010110102020
NODE_ENV=production
PORT=10000
```

### 4. Deploy qilish

```bash
git push  # Automatic deploy
```

yoki Render dashboard da "Deploy" tugmasini bosing.

## Logs ni tekshirish

```bash
# Render dashboard da
Service > Logs > 
```

Bulatda quyidagilar ko'rinishi kerak:
```
✓ MongoDB ga muvaffaqiyatli ulandi!
🎉 ToyImbor server ishlayapti: http://localhost:10000
```

## Xatolarni tuzatish

### "Cannot find module" xatosi
**Yechim:**
```bash
# Local
npm install
git push

# Render da automatic rebuild bo'ladi
```

### MongoDB ulanmasa
**Tekshirib ko'ring:**
1. ✅ MONGODB_URI to'g'ri o'rnatilganmi?
2. ✅ IP whitelist qo'shilganmi (0.0.0.0/0)?
3. ✅ Username va password to'g'rimi?
4. ✅ Cluster active mi?

**Debug qilish:**
```javascript
// server.js da test qilish
console.log(`MONGODB_URI: ${MONGODB_URI.substring(0, 50)}...`);
```

### Port xatosi
- Render automatic PORT o'rnaydi
- .env da PORT=10000 bo'lsin

## Local testing (localhost)

```bash
# 1. .env fayl sozlash
MONGODB_URI=your_connection_string_here

# 2. Install
npm install

# 3. Start
npm start

# 4. Test
curl http://localhost:3000
```

## Production Checklist

- [ ] MongoDB Atlas account yaratildi
- [ ] Cluster yaratildi
- [ ] Database user yaratildi  
- [ ] IP whitelist qo'shildi (0.0.0.0/0)
- [ ] Connection string olindi
- [ ] Render.com ga o'rnatildi
- [ ] Environment variables o'rnatildi
- [ ] Deploy qilindi
- [ ] Logs da sambhalmagulikni tekshirdi
- [ ] Admin login test qilindi

## Deployment URL
```
https://your-service-name.onrender.com
```

## Admin Login
```
Email: admin@toyimbor.uz
Password: Admin123! (o'zgartirib qo'ying!)
```

## Support

**Xatolar va savollar:**
- Render logs: https://render.com/docs/logs
- MongoDB docs: https://docs.mongodb.com/manual/
- Node.js docs: https://nodejs.org/docs/

---

**Eslatma:** Production uchun JWT_SECRET va ADMIN_PASSWORD o'zgartirib qo'yish majbur!
