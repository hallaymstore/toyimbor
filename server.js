const path = require("path");
const http = require("http");

try {
  require("dotenv").config();
} catch (error) {
  // dotenv is optional for this setup.
}

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
});

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "toyimbor_change_this_secret";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb+srv://abumafia0:abumafia0@abumafia.h1trttg.mongodb.net/toyimbor?appName=abumafia";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@toyimbor.uz")
  .trim()
  .toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin123!";
const ADMIN_CARD = process.env.ADMIN_CARD || "9860 0101 1010 2020";
const PREMIUM_DAYS = Number(process.env.PREMIUM_DAYS || 365);

const providerRoles = ["photographer", "venue", "restaurant"];
const publicRoles = ["user", ...providerRoles];
const bookingSlots = [
  { value: "morning", label: "Ertalab 09:00 - 13:00" },
  { value: "afternoon", label: "Kunduzi 14:00 - 18:00" },
  { value: "evening", label: "Kechqurun 19:00 - 23:00" },
];

const hasCloudinaryConfig =
  Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(process.env.CLOUDINARY_API_KEY) &&
  Boolean(process.env.CLOUDINARY_API_SECRET);

if (hasCloudinaryConfig) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "ToyImbor");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function toObjectId(value) {
  if (!mongoose.isValidObjectId(value)) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBoolean(value) {
  if (value === true || value === "true" || value === "1" || value === 1) {
    return true;
  }

  if (value === false || value === "false" || value === "0" || value === 0) {
    return false;
  }

  return undefined;
}

function parseList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeId(value) {
  return typeof value === "string" ? value : String(value);
}

function buildThreadKey(a, b) {
  return [normalizeId(a), normalizeId(b)].sort().join(":");
}

function normalizeDay(value) {
  const dateText = String(value || "").trim();
  const date = new Date(`${dateText}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    throw createHttpError(400, "Sana noto'g'ri yuborildi.");
  }

  return date;
}

function formatMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function getRecentMonthSeries(monthCount = 6) {
  const months = [];
  const now = new Date();

  for (let index = monthCount - 1; index >= 0; index -= 1) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1)
    );

    months.push({
      key: formatMonthKey(date),
      label: date.toLocaleString("en-US", { month: "short" }),
      date,
    });
  }

  return months;
}

async function buildMonthlySeries(model, match = {}, field = "createdAt") {
  const months = getRecentMonthSeries(6);
  const fromDate = months[0].date;

  const items = await model.aggregate([
    {
      $match: {
        ...match,
        [field]: { $gte: fromDate },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: `$${field}` },
          month: { $month: `$${field}` },
        },
        total: { $sum: 1 },
      },
    },
  ]);

  const map = new Map();
  items.forEach((item) => {
    const key = `${item._id.year}-${String(item._id.month).padStart(2, "0")}`;
    map.set(key, item.total);
  });

  return months.map((month) => ({
    label: month.label,
    value: map.get(month.key) || 0,
  }));
}

async function uploadFileToCloudinary(file, folder) {
  if (!file) {
    return null;
  }

  if (!hasCloudinaryConfig) {
    throw createHttpError(
      500,
      "Cloudinary sozlanmagan. CLOUDINARY_* env qiymatlarini kiriting."
    );
  }

  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "auto",
  });

  return result.secure_url;
}

function signToken(user) {
  return jwt.sign(
    {
      id: normalizeId(user._id),
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return req.query.token || null;
}

function sanitizeSocials(socials = {}) {
  return {
    instagram: socials.instagram || "",
    telegram: socials.telegram || "",
    website: socials.website || "",
  };
}

function serializeUser(user, viewer = null) {
  const viewerId = viewer ? normalizeId(viewer._id) : null;
  const userId = normalizeId(user._id);
  const isOwner = viewerId === userId;
  const isAdmin = viewer?.role === "admin";
  const followers = user.followers || [];
  const following = user.following || [];

  return {
    id: userId,
    name: user.name,
    email: isOwner || isAdmin ? user.email : "",
    phone: user.phone || "",
    city: user.city || "",
    role: user.role,
    bio: user.bio || "",
    avatarUrl: user.avatarUrl || "",
    coverUrl: user.coverUrl || "",
    tags: user.tags || [],
    serviceArea: user.serviceArea || "",
    priceFrom: user.priceFrom ?? null,
    priceTo: user.priceTo ?? null,
    capacity: user.capacity ?? null,
    premium: Boolean(user.premium),
    verified: Boolean(user.verified),
    premiumExpiresAt: user.premiumExpiresAt || null,
    socials: sanitizeSocials(user.socials),
    followersCount: followers.length,
    followingCount: following.length,
    isFollowing: viewerId
      ? followers.some((id) => normalizeId(id) === viewerId)
      : false,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeService(service) {
  const owner =
    service.owner && typeof service.owner === "object" && service.owner.name
      ? {
          id: normalizeId(service.owner._id),
          name: service.owner.name,
          role: service.owner.role,
          avatarUrl: service.owner.avatarUrl || "",
          verified: Boolean(service.owner.verified),
          premium: Boolean(service.owner.premium),
        }
      : null;

  return {
    id: normalizeId(service._id),
    title: service.title,
    category: service.category || "",
    price: service.price ?? 0,
    durationText: service.durationText || "",
    description: service.description || "",
    coverUrl: service.coverUrl || "",
    features: service.features || [],
    active: Boolean(service.active),
    owner,
    createdAt: service.createdAt,
  };
}

function serializePost(post) {
  const author =
    post.author && typeof post.author === "object" && post.author.name
      ? {
          id: normalizeId(post.author._id),
          name: post.author.name,
          role: post.author.role,
          avatarUrl: post.author.avatarUrl || "",
          verified: Boolean(post.author.verified),
          premium: Boolean(post.author.premium),
        }
      : null;

  return {
    id: normalizeId(post._id),
    caption: post.caption,
    imageUrl: post.imageUrl || "",
    tags: post.tags || [],
    author,
    createdAt: post.createdAt,
  };
}

function serializeNotification(notification) {
  return {
    id: normalizeId(notification._id),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    link: notification.link || "",
    read: Boolean(notification.read),
    meta: notification.meta || {},
    createdAt: notification.createdAt,
  };
}

function serializeMessage(message) {
  const from =
    message.from && typeof message.from === "object" && message.from.name
      ? {
          id: normalizeId(message.from._id),
          name: message.from.name,
          role: message.from.role,
          avatarUrl: message.from.avatarUrl || "",
          verified: Boolean(message.from.verified),
        }
      : { id: normalizeId(message.from) };

  const to =
    message.to && typeof message.to === "object" && message.to.name
      ? {
          id: normalizeId(message.to._id),
          name: message.to.name,
          role: message.to.role,
          avatarUrl: message.to.avatarUrl || "",
          verified: Boolean(message.to.verified),
        }
      : { id: normalizeId(message.to) };

  return {
    id: normalizeId(message._id),
    body: message.body,
    readAt: message.readAt || null,
    from,
    to,
    createdAt: message.createdAt,
  };
}

function serializeBooking(booking) {
  const provider =
    booking.provider &&
    typeof booking.provider === "object" &&
    booking.provider.name
      ? {
          id: normalizeId(booking.provider._id),
          name: booking.provider.name,
          role: booking.provider.role,
          avatarUrl: booking.provider.avatarUrl || "",
          verified: Boolean(booking.provider.verified),
          premium: Boolean(booking.provider.premium),
          city: booking.provider.city || "",
        }
      : { id: normalizeId(booking.provider) };

  const customer =
    booking.customer &&
    typeof booking.customer === "object" &&
    booking.customer.name
      ? {
          id: normalizeId(booking.customer._id),
          name: booking.customer.name,
          role: booking.customer.role,
          avatarUrl: booking.customer.avatarUrl || "",
        }
      : booking.customer
      ? { id: normalizeId(booking.customer) }
      : null;

  const service =
    booking.service &&
    typeof booking.service === "object" &&
    booking.service.title
      ? serializeService(booking.service)
      : null;

  return {
    id: normalizeId(booking._id),
    provider,
    customer,
    service,
    guestName: booking.guestName || "",
    guestPhone: booking.guestPhone || "",
    guestEmail: booking.guestEmail || "",
    eventDate: booking.eventDate,
    slot: booking.slot,
    slotLabel:
      bookingSlots.find((slot) => slot.value === booking.slot)?.label ||
      booking.slot,
    note: booking.note || "",
    attendeeCount: booking.attendeeCount ?? 0,
    status: booking.status,
    createdAt: booking.createdAt,
  };
}

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "photographer", "venue", "restaurant", "admin"],
      required: true,
    },
    phone: { type: String, default: "" },
    city: { type: String, default: "" },
    bio: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    coverUrl: { type: String, default: "" },
    tags: { type: [String], default: [] },
    serviceArea: { type: String, default: "" },
    priceFrom: { type: Number, default: null },
    priceTo: { type: Number, default: null },
    capacity: { type: Number, default: null },
    socials: {
      instagram: { type: String, default: "" },
      telegram: { type: String, default: "" },
      website: { type: String, default: "" },
    },
    premium: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    premiumExpiresAt: { type: Date, default: null },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

UserSchema.index({ role: 1, city: 1, premium: 1, verified: 1 });

const ServiceSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    category: { type: String, default: "" },
    price: { type: Number, default: 0 },
    durationText: { type: String, default: "" },
    description: { type: String, default: "" },
    coverUrl: { type: String, default: "" },
    features: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ServiceSchema.index({ owner: 1, createdAt: -1 });

const PostSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    caption: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: "" },
    tags: { type: [String], default: [] },
  },
  { timestamps: true }
);

PostSchema.index({ author: 1, createdAt: -1 });

const BookingSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      default: null,
    },
    guestName: { type: String, default: "" },
    guestPhone: { type: String, default: "" },
    guestEmail: { type: String, default: "" },
    eventDate: { type: Date, required: true, index: true },
    slot: {
      type: String,
      enum: bookingSlots.map((slot) => slot.value),
      required: true,
    },
    note: { type: String, default: "" },
    attendeeCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "completed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

BookingSchema.index({ provider: 1, eventDate: 1, slot: 1, status: 1 });

const PremiumRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    screenshotUrl: { type: String, required: true },
    note: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, default: "" },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PremiumRequestSchema.index({ status: 1, createdAt: -1 });

const MessageSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    body: { type: String, required: true, trim: true },
    threadKey: { type: String, required: true, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

MessageSchema.index({ threadKey: 1, createdAt: -1 });

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, default: "info" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String, default: "" },
    read: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, read: 1, createdAt: -1 });

const User = mongoose.model("User", UserSchema);
const Service = mongoose.model("Service", ServiceSchema);
const Post = mongoose.model("Post", PostSchema);
const Booking = mongoose.model("Booking", BookingSchema);
const PremiumRequest = mongoose.model("PremiumRequest", PremiumRequestSchema);
const Message = mongoose.model("Message", MessageSchema);
const Notification = mongoose.model("Notification", NotificationSchema);

async function createNotification(userId, payload) {
  const notification = await Notification.create({
    user: userId,
    type: payload.type || "info",
    title: payload.title,
    message: payload.message,
    link: payload.link || "",
    meta: payload.meta || {},
  });

  io.to(`user:${normalizeId(userId)}`).emit(
    "notification:new",
    serializeNotification(notification)
  );

  return notification;
}

async function notifyAdmins(payload) {
  const admins = await User.find({ role: "admin" }).select("_id");
  await Promise.all(
    admins.map((admin) =>
      createNotification(admin._id, {
        ...payload,
      })
    )
  );
}

const authOptional = asyncHandler(async (req, _res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user) {
      req.user = user;
    }
  } catch (error) {
    req.user = null;
  }

  next();
});

const authRequired = asyncHandler(async (req, _res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    throw createHttpError(401, "Tizimga kirish talab qilinadi.");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      throw createHttpError(401, "Foydalanuvchi topilmadi.");
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.status) {
      throw error;
    }

    throw createHttpError(401, "Token muddati tugagan yoki noto'g'ri.");
  }
});

const adminOnly = (req, _res, next) => {
  if (!req.user || req.user.role !== "admin") {
    throw createHttpError(403, "Bu amal faqat admin uchun.");
  }

  next();
};

const providerOnly = (req, _res, next) => {
  if (!req.user || !providerRoles.includes(req.user.role)) {
    throw createHttpError(
      403,
      "Bu bo'lim faqat fotograf, to'yxona yoki restoran akkaunti uchun."
    );
  }

  next();
};

async function ensureAdminUser() {
  const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });
  if (existingAdmin) {
    if (!existingAdmin.verified || !existingAdmin.premium) {
      existingAdmin.verified = true;
      existingAdmin.premium = true;
      if (!existingAdmin.premiumExpiresAt) {
        existingAdmin.premiumExpiresAt = new Date(
          Date.now() + PREMIUM_DAYS * 24 * 60 * 60 * 1000
        );
      }
      await existingAdmin.save();
    }
    return existingAdmin;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await User.create({
    name: "ToyImbor Admin",
    email: ADMIN_EMAIL,
    passwordHash,
    role: "admin",
    bio: "Platformani boshqaruvchi administrator akkaunti.",
    premium: true,
    verified: true,
    premiumExpiresAt: new Date(
      Date.now() + PREMIUM_DAYS * 24 * 60 * 60 * 1000
    ),
  });
}

async function buildDiscoverPayload(users, viewer = null) {
  const ids = users.map((user) => user._id);

  const [serviceStats, postStats] = await Promise.all([
    Service.aggregate([
      { $match: { owner: { $in: ids } } },
      {
        $group: {
          _id: "$owner",
          count: { $sum: 1 },
          minPrice: { $min: "$price" },
        },
      },
    ]),
    Post.aggregate([
      { $match: { author: { $in: ids } } },
      {
        $group: {
          _id: "$author",
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const serviceMap = new Map(
    serviceStats.map((item) => [normalizeId(item._id), item])
  );
  const postMap = new Map(postStats.map((item) => [normalizeId(item._id), item]));

  return users.map((user) => {
    const serialized = serializeUser(user, viewer);
    const serviceItem = serviceMap.get(serialized.id);
    const postItem = postMap.get(serialized.id);

    return {
      ...serialized,
      serviceCount: serviceItem?.count || 0,
      minPrice: serviceItem?.minPrice ?? serialized.priceFrom ?? null,
      postCount: postItem?.count || 0,
    };
  });
}

async function buildHomePayload(viewer = null) {
  const [userCount, providerCount, bookingCount, featuredUsers, latestPosts] =
    await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: { $in: providerRoles } }),
      Booking.countDocuments(),
      User.find({ role: { $in: providerRoles } })
        .sort({ premium: -1, verified: -1, createdAt: -1 })
        .limit(6),
      Post.find()
        .populate("author", "name role avatarUrl verified premium")
        .sort({ createdAt: -1 })
        .limit(6),
    ]);

  return {
    stats: {
      users: userCount,
      providers: providerCount,
      bookings: bookingCount,
    },
    featured: await buildDiscoverPayload(featuredUsers, viewer),
    latestPosts: latestPosts.map((post) => serializePost(post)),
  };
}

app.get(
  "/api/meta",
  asyncHandler(async (_req, res) => {
    res.json({
      roles: publicRoles,
      providerRoles,
      bookingSlots,
      premiumDays: PREMIUM_DAYS,
    });
  })
);

app.get(
  "/api/health",
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      dbState: mongoose.connection.readyState,
    });
  })
);

app.get(
  "/api/home",
  authOptional,
  asyncHandler(async (req, res) => {
    res.json(await buildHomePayload(req.user || null));
  })
);

app.post(
  "/api/auth/register",
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "cover", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!name || !normalizedEmail || !password || !role) {
      throw createHttpError(400, "Ism, email, parol va rol majburiy.");
    }

    if (!publicRoles.includes(role)) {
      throw createHttpError(400, "Tanlangan rol noto'g'ri.");
    }

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) {
      throw createHttpError(409, "Bu email allaqachon ro'yxatdan o'tgan.");
    }

    const avatarFile = req.files?.avatar?.[0];
    const coverFile = req.files?.cover?.[0];

    const [avatarUrl, coverUrl] = await Promise.all([
      avatarFile ? uploadFileToCloudinary(avatarFile, "toyimbor/avatars") : null,
      coverFile ? uploadFileToCloudinary(coverFile, "toyimbor/covers") : null,
    ]);

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      role,
      phone: String(req.body.phone || "").trim(),
      city: String(req.body.city || "").trim(),
      bio: String(req.body.bio || "").trim(),
      avatarUrl: avatarUrl || String(req.body.avatarUrl || "").trim(),
      coverUrl: coverUrl || String(req.body.coverUrl || "").trim(),
      tags: parseList(req.body.tags),
      serviceArea: String(req.body.serviceArea || "").trim(),
      priceFrom: parseNumber(req.body.priceFrom),
      priceTo: parseNumber(req.body.priceTo),
      capacity: parseNumber(req.body.capacity),
      socials: {
        instagram: String(req.body.instagram || "").trim(),
        telegram: String(req.body.telegram || "").trim(),
        website: String(req.body.website || "").trim(),
      },
    });

    const token = signToken(user);

    res.status(201).json({
      token,
      user: serializeUser(user, user),
    });
  })
);

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!email || !password) {
      throw createHttpError(400, "Email va parol majburiy.");
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw createHttpError(401, "Email yoki parol noto'g'ri.");
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw createHttpError(401, "Email yoki parol noto'g'ri.");
    }

    user.lastSeenAt = new Date();
    await user.save();

    res.json({
      token: signToken(user),
      user: serializeUser(user, user),
    });
  })
);

app.get(
  "/api/auth/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const unreadNotifications = await Notification.countDocuments({
      user: req.user._id,
      read: false,
    });

    const unreadMessages = await Message.countDocuments({
      to: req.user._id,
      readAt: null,
    });

    res.json({
      user: serializeUser(req.user, req.user),
      unreadNotifications,
      unreadMessages,
      premiumMeta: providerRoles.includes(req.user.role)
        ? {
            adminCard: ADMIN_CARD,
            premiumDays: PREMIUM_DAYS,
          }
        : null,
    });
  })
);

app.patch(
  "/api/profile",
  authRequired,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "cover", maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const avatarFile = req.files?.avatar?.[0];
    const coverFile = req.files?.cover?.[0];

    if (avatarFile) {
      req.user.avatarUrl = await uploadFileToCloudinary(
        avatarFile,
        "toyimbor/avatars"
      );
    } else if (req.body.avatarUrl !== undefined) {
      req.user.avatarUrl = String(req.body.avatarUrl || "").trim();
    }

    if (coverFile) {
      req.user.coverUrl = await uploadFileToCloudinary(
        coverFile,
        "toyimbor/covers"
      );
    } else if (req.body.coverUrl !== undefined) {
      req.user.coverUrl = String(req.body.coverUrl || "").trim();
    }

    const simpleFields = ["name", "phone", "city", "bio", "serviceArea"];

    simpleFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        req.user[field] = String(req.body[field] || "").trim();
      }
    });

    req.user.tags =
      req.body.tags !== undefined ? parseList(req.body.tags) : req.user.tags;
    req.user.priceFrom =
      req.body.priceFrom !== undefined
        ? parseNumber(req.body.priceFrom)
        : req.user.priceFrom;
    req.user.priceTo =
      req.body.priceTo !== undefined
        ? parseNumber(req.body.priceTo)
        : req.user.priceTo;
    req.user.capacity =
      req.body.capacity !== undefined
        ? parseNumber(req.body.capacity)
        : req.user.capacity;
    req.user.socials = {
      instagram:
        req.body.instagram !== undefined
          ? String(req.body.instagram || "").trim()
          : req.user.socials.instagram,
      telegram:
        req.body.telegram !== undefined
          ? String(req.body.telegram || "").trim()
          : req.user.socials.telegram,
      website:
        req.body.website !== undefined
          ? String(req.body.website || "").trim()
          : req.user.socials.website,
    };

    await req.user.save();

    res.json({
      user: serializeUser(req.user, req.user),
    });
  })
);

app.get(
  "/api/discover",
  authOptional,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 20)));
    const q = String(req.query.q || "").trim();
    const city = String(req.query.city || "").trim();
    const role = String(req.query.role || "").trim();
    const premium = parseBoolean(req.query.premium);
    const verified = parseBoolean(req.query.verified);

    const query = {};

    if (role && publicRoles.includes(role)) {
      query.role = role;
    } else {
      query.role = { $in: providerRoles };
    }

    if (city) {
      query.city = { $regex: city, $options: "i" };
    }

    if (premium !== undefined) {
      query.premium = premium;
    }

    if (verified !== undefined) {
      query.verified = verified;
    }

    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { city: { $regex: q, $options: "i" } },
        { bio: { $regex: q, $options: "i" } },
        { tags: { $elemMatch: { $regex: q, $options: "i" } } },
        { serviceArea: { $regex: q, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .sort({ premium: -1, verified: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.json({
      items: await buildDiscoverPayload(users, req.user || null),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    });
  })
);

app.get(
  "/api/profile/:id",
  authOptional,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createHttpError(404, "Profil topilmadi.");
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      throw createHttpError(404, "Profil topilmadi.");
    }

    const [services, posts, bookingStats] = await Promise.all([
      Service.find({ owner: user._id }).sort({ createdAt: -1 }).limit(20),
      Post.find({ author: user._id })
        .populate("author", "name role avatarUrl verified premium")
        .sort({ createdAt: -1 })
        .limit(20),
      Booking.countDocuments({
        provider: user._id,
        status: { $in: ["pending", "approved", "completed"] },
      }),
    ]);

    res.json({
      user: serializeUser(user, req.user || null),
      services: services.map((service) => serializeService(service)),
      posts: posts.map((post) => serializePost(post)),
      stats: {
        totalServices: services.length,
        totalPosts: posts.length,
        totalRequests: bookingStats,
      },
    });
  })
);

app.post(
  "/api/follow/:id",
  authRequired,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createHttpError(404, "Profil topilmadi.");
    }

    const target = await User.findById(req.params.id);
    if (!target) {
      throw createHttpError(404, "Profil topilmadi.");
    }

    if (normalizeId(target._id) === normalizeId(req.user._id)) {
      throw createHttpError(400, "O'zingizga obuna bo'la olmaysiz.");
    }

    const targetId = normalizeId(target._id);
    const currentUserId = normalizeId(req.user._id);
    const alreadyFollowing = target.followers.some(
      (id) => normalizeId(id) === currentUserId
    );

    if (alreadyFollowing) {
      target.followers = target.followers.filter(
        (id) => normalizeId(id) !== currentUserId
      );
      req.user.following = req.user.following.filter(
        (id) => normalizeId(id) !== targetId
      );
    } else {
      target.followers.push(req.user._id);
      req.user.following.push(target._id);
      await createNotification(target._id, {
        type: "follow",
        title: "Yangi obunachi",
        message: `${req.user.name} sizning profilingizga obuna bo'ldi.`,
        link: `/profile.html?id=${currentUserId}`,
        meta: { userId: currentUserId },
      });
    }

    await Promise.all([target.save(), req.user.save()]);

    res.json({
      following: !alreadyFollowing,
      followersCount: target.followers.length,
      followingCount: req.user.following.length,
    });
  })
);

app.get(
  "/api/posts/feed",
  authOptional,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 12)));
    const role = String(req.query.role || "").trim();
    const match = {};

    if (role && publicRoles.includes(role)) {
      const authors = await User.find({ role }).select("_id");
      match.author = { $in: authors.map((user) => user._id) };
    }

    const posts = await Post.find(match)
      .populate("author", "name role avatarUrl verified premium")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      items: posts.map((post) => serializePost(post)),
      page,
      hasMore: posts.length === limit,
    });
  })
);

app.post(
  "/api/posts",
  authRequired,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const caption = String(req.body.caption || "").trim();
    if (!caption) {
      throw createHttpError(400, "Post matni majburiy.");
    }

    const imageUrl = req.file
      ? await uploadFileToCloudinary(req.file, "toyimbor/posts")
      : String(req.body.imageUrl || "").trim();

    const post = await Post.create({
      author: req.user._id,
      caption,
      imageUrl,
      tags: parseList(req.body.tags),
    });

    const populated = await post.populate(
      "author",
      "name role avatarUrl verified premium"
    );

    res.status(201).json({
      post: serializePost(populated),
    });
  })
);

app.delete(
  "/api/posts/:id",
  authRequired,
  asyncHandler(async (req, res) => {
    const post = await Post.findById(req.params.id);
    if (!post) {
      throw createHttpError(404, "Post topilmadi.");
    }

    if (
      normalizeId(post.author) !== normalizeId(req.user._id) &&
      req.user.role !== "admin"
    ) {
      throw createHttpError(403, "Bu postni o'chirishga ruxsat yo'q.");
    }

    await post.deleteOne();
    res.json({ ok: true });
  })
);

app.get(
  "/api/services",
  authOptional,
  asyncHandler(async (req, res) => {
    const ownerId = req.query.owner;
    const query = {};

    if (ownerId) {
      if (!mongoose.isValidObjectId(ownerId)) {
        throw createHttpError(400, "Owner noto'g'ri.");
      }
      query.owner = ownerId;
    }

    const services = await Service.find(query)
      .populate("owner", "name role avatarUrl premium verified")
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      items: services.map((service) => serializeService(service)),
    });
  })
);

app.post(
  "/api/services",
  authRequired,
  providerOnly,
  upload.single("cover"),
  asyncHandler(async (req, res) => {
    const title = String(req.body.title || "").trim();
    if (!title) {
      throw createHttpError(400, "Xizmat nomi majburiy.");
    }

    const service = await Service.create({
      owner: req.user._id,
      title,
      category: String(req.body.category || "").trim(),
      price: parseNumber(req.body.price) ?? 0,
      durationText: String(req.body.durationText || "").trim(),
      description: String(req.body.description || "").trim(),
      coverUrl: req.file
        ? await uploadFileToCloudinary(req.file, "toyimbor/services")
        : String(req.body.coverUrl || "").trim(),
      features: parseList(req.body.features),
      active:
        req.body.active !== undefined
          ? Boolean(parseBoolean(req.body.active))
          : true,
    });

    res.status(201).json({
      service: serializeService(service),
    });
  })
);

app.patch(
  "/api/services/:id",
  authRequired,
  providerOnly,
  upload.single("cover"),
  asyncHandler(async (req, res) => {
    const service = await Service.findById(req.params.id);
    if (!service) {
      throw createHttpError(404, "Xizmat topilmadi.");
    }

    if (
      normalizeId(service.owner) !== normalizeId(req.user._id) &&
      req.user.role !== "admin"
    ) {
      throw createHttpError(403, "Bu xizmatni tahrirlashga ruxsat yo'q.");
    }

    const fields = ["title", "category", "durationText", "description"];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        service[field] = String(req.body[field] || "").trim();
      }
    });

    if (req.body.price !== undefined) {
      service.price = parseNumber(req.body.price) ?? 0;
    }

    if (req.body.features !== undefined) {
      service.features = parseList(req.body.features);
    }

    if (req.body.active !== undefined) {
      service.active = Boolean(parseBoolean(req.body.active));
    }

    if (req.file) {
      service.coverUrl = await uploadFileToCloudinary(
        req.file,
        "toyimbor/services"
      );
    } else if (req.body.coverUrl !== undefined) {
      service.coverUrl = String(req.body.coverUrl || "").trim();
    }

    await service.save();

    res.json({
      service: serializeService(service),
    });
  })
);

app.delete(
  "/api/services/:id",
  authRequired,
  providerOnly,
  asyncHandler(async (req, res) => {
    const service = await Service.findById(req.params.id);
    if (!service) {
      throw createHttpError(404, "Xizmat topilmadi.");
    }

    if (
      normalizeId(service.owner) !== normalizeId(req.user._id) &&
      req.user.role !== "admin"
    ) {
      throw createHttpError(403, "Bu xizmatni o'chirishga ruxsat yo'q.");
    }

    await service.deleteOne();
    res.json({ ok: true });
  })
);

app.get(
  "/api/bookings/availability/:providerId",
  asyncHandler(async (req, res) => {
    const providerId = req.params.providerId;
    const dayText =
      String(req.query.date || "").trim() ||
      new Date().toISOString().slice(0, 10);

    if (!mongoose.isValidObjectId(providerId)) {
      throw createHttpError(404, "Provider topilmadi.");
    }

    const provider = await User.findById(providerId);
    if (!provider || !providerRoles.includes(provider.role)) {
      throw createHttpError(404, "Provider topilmadi.");
    }

    const day = normalizeDay(dayText);
    const bookings = await Booking.find({
      provider: provider._id,
      eventDate: day,
      status: { $in: ["pending", "approved"] },
    }).populate("customer service");

    res.json({
      date: day.toISOString().slice(0, 10),
      provider: serializeUser(provider, null),
      slots: bookingSlots.map((slot) => {
        const booking = bookings.find((item) => item.slot === slot.value);
        return {
          value: slot.value,
          label: slot.label,
          available: !booking,
          booking: booking ? serializeBooking(booking) : null,
        };
      }),
    });
  })
);

app.post(
  "/api/bookings",
  authOptional,
  asyncHandler(async (req, res) => {
    const providerId = String(req.body.providerId || "").trim();
    const serviceId = String(req.body.serviceId || "").trim();
    const eventDate = normalizeDay(req.body.eventDate);
    const slot = String(req.body.slot || "").trim();

    if (!mongoose.isValidObjectId(providerId)) {
      throw createHttpError(400, "Provider tanlanmadi.");
    }

    if (!bookingSlots.some((item) => item.value === slot)) {
      throw createHttpError(400, "Bron vaqti noto'g'ri.");
    }

    const provider = await User.findById(providerId);
    if (!provider || !providerRoles.includes(provider.role)) {
      throw createHttpError(404, "Tanlangan xizmat egasi topilmadi.");
    }

    let service = null;
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) {
        throw createHttpError(400, "Xizmat noto'g'ri.");
      }
      service = await Service.findById(serviceId);
      if (!service || normalizeId(service.owner) !== normalizeId(provider._id)) {
        throw createHttpError(404, "Xizmat topilmadi.");
      }
    }

    const duplicate = await Booking.findOne({
      provider: provider._id,
      eventDate,
      slot,
      status: { $in: ["pending", "approved"] },
    });

    if (duplicate) {
      throw createHttpError(
        409,
        "Bu sana va vaqt oralig'i allaqachon band qilingan."
      );
    }

    const guestName = String(req.body.guestName || "").trim();
    const guestPhone = String(req.body.guestPhone || "").trim();
    const guestEmail = String(req.body.guestEmail || "").trim();

    if (!req.user && (!guestName || !guestPhone)) {
      throw createHttpError(
        400,
        "Mehmon sifatida bron qilish uchun ism va telefon majburiy."
      );
    }

    const booking = await Booking.create({
      provider: provider._id,
      customer: req.user?._id || null,
      service: service?._id || null,
      guestName: guestName || req.user?.name || "",
      guestPhone: guestPhone || req.user?.phone || "",
      guestEmail: guestEmail || req.user?.email || "",
      eventDate,
      slot,
      note: String(req.body.note || "").trim(),
      attendeeCount: parseNumber(req.body.attendeeCount) ?? 0,
    });

    await createNotification(provider._id, {
      type: "booking",
      title: "Yangi bron so'rovi",
      message: `${
        booking.guestName || req.user?.name || "Yangi foydalanuvchi"
      } ${slot} uchun bron yubordi.`,
      link: "/dashboard.html",
      meta: { bookingId: normalizeId(booking._id) },
    });

    const populated = await Booking.findById(booking._id)
      .populate("provider", "name role avatarUrl verified premium city")
      .populate("customer", "name role avatarUrl")
      .populate("service");

    res.status(201).json({
      booking: serializeBooking(populated),
    });
  })
);

app.get(
  "/api/bookings/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const scope = String(req.query.scope || "").trim() || "default";
    let query = {};

    if (req.user.role === "admin" && scope === "all") {
      query = {};
    } else if (providerRoles.includes(req.user.role) && scope === "incoming") {
      query = { provider: req.user._id };
    } else if (scope === "incoming") {
      query = { provider: req.user._id };
    } else {
      query = { customer: req.user._id };
    }

    const bookings = await Booking.find(query)
      .populate("provider", "name role avatarUrl verified premium city")
      .populate("customer", "name role avatarUrl")
      .populate("service")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      items: bookings.map((booking) => serializeBooking(booking)),
    });
  })
);

app.patch(
  "/api/bookings/:id/status",
  authRequired,
  asyncHandler(async (req, res) => {
    const booking = await Booking.findById(req.params.id)
      .populate("provider", "name role avatarUrl verified premium city")
      .populate("customer", "name role avatarUrl");

    if (!booking) {
      throw createHttpError(404, "Bron topilmadi.");
    }

    const nextStatus = String(req.body.status || "").trim();
    const allowedStatuses = [
      "approved",
      "rejected",
      "cancelled",
      "completed",
    ];

    if (!allowedStatuses.includes(nextStatus)) {
      throw createHttpError(400, "Status noto'g'ri.");
    }

    const isAdmin = req.user.role === "admin";
    const isProvider =
      normalizeId(booking.provider._id) === normalizeId(req.user._id);
    const isCustomer =
      booking.customer &&
      normalizeId(booking.customer._id) === normalizeId(req.user._id);

    if (!isAdmin && !isProvider && !isCustomer) {
      throw createHttpError(403, "Bu bronni boshqarishga ruxsat yo'q.");
    }

    if (isCustomer && nextStatus !== "cancelled" && !isAdmin) {
      throw createHttpError(403, "Foydalanuvchi faqat bekor qila oladi.");
    }

    if (
      isProvider &&
      !["approved", "rejected", "completed"].includes(nextStatus) &&
      !isAdmin
    ) {
      throw createHttpError(
        403,
        "Provider faqat tasdiqlash, rad etish yoki yakunlashi mumkin."
      );
    }

    booking.status = nextStatus;
    await booking.save();

    if (booking.customer) {
      await createNotification(booking.customer._id, {
        type: "booking",
        title: "Bron holati yangilandi",
        message: `${booking.provider.name} so'rovingizni ${nextStatus} holatiga o'tkazdi.`,
        link: "/dashboard.html",
        meta: { bookingId: normalizeId(booking._id) },
      });
    }

    const populated = await Booking.findById(booking._id)
      .populate("provider", "name role avatarUrl verified premium city")
      .populate("customer", "name role avatarUrl")
      .populate("service");

    res.json({
      booking: serializeBooking(populated),
    });
  })
);

app.get(
  "/api/premium/info",
  authRequired,
  asyncHandler(async (req, res) => {
    res.json({
      adminCard: ADMIN_CARD,
      premiumDays: PREMIUM_DAYS,
      current: {
        premium: req.user.premium,
        verified: req.user.verified,
        premiumExpiresAt: req.user.premiumExpiresAt,
      },
    });
  })
);

app.get(
  "/api/premium/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const requests = await PremiumRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      items: requests.map((item) => ({
        id: normalizeId(item._id),
        screenshotUrl: item.screenshotUrl,
        note: item.note,
        status: item.status,
        rejectionReason: item.rejectionReason,
        createdAt: item.createdAt,
        reviewedAt: item.reviewedAt,
      })),
    });
  })
);

app.post(
  "/api/premium/request",
  authRequired,
  providerOnly,
  upload.single("screenshot"),
  asyncHandler(async (req, res) => {
    const pending = await PremiumRequest.findOne({
      user: req.user._id,
      status: "pending",
    });

    if (pending) {
      throw createHttpError(
        409,
        "Sizda hali ko'rib chiqilayotgan premium so'rov mavjud."
      );
    }

    const screenshotUrl = req.file
      ? await uploadFileToCloudinary(req.file, "toyimbor/premium")
      : String(req.body.screenshotUrl || "").trim();

    if (!screenshotUrl) {
      throw createHttpError(400, "To'lov screenshoti majburiy.");
    }

    const premiumRequest = await PremiumRequest.create({
      user: req.user._id,
      screenshotUrl,
      note: String(req.body.note || "").trim(),
    });

    await notifyAdmins({
      type: "premium",
      title: "Yangi premium so'rov",
      message: `${req.user.name} premium aktivatsiya uchun so'rov yubordi.`,
      link: "/admin.html",
      meta: { premiumRequestId: normalizeId(premiumRequest._id) },
    });

    res.status(201).json({
      request: {
        id: normalizeId(premiumRequest._id),
        screenshotUrl: premiumRequest.screenshotUrl,
        note: premiumRequest.note,
        status: premiumRequest.status,
        createdAt: premiumRequest.createdAt,
      },
    });
  })
);

app.get(
  "/api/notifications",
  authRequired,
  asyncHandler(async (req, res) => {
    const items = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({
      items: items.map((item) => serializeNotification(item)),
    });
  })
);

app.post(
  "/api/notifications/read-all",
  authRequired,
  asyncHandler(async (req, res) => {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { read: true }
    );

    res.json({ ok: true });
  })
);

app.patch(
  "/api/notifications/:id/read",
  authRequired,
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      throw createHttpError(404, "Bildirishnoma topilmadi.");
    }

    res.json({
      notification: serializeNotification(notification),
    });
  })
);

app.get(
  "/api/messages/threads",
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = toObjectId(req.user._id);

    const rows = await Message.aggregate([
      {
        $match: {
          $or: [{ from: userId }, { to: userId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$threadKey",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [{ $eq: ["$to", userId] }, { $eq: ["$readAt", null] }],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
    ]);

    const otherIds = rows
      .map((row) =>
        row._id
          .split(":")
          .find((id) => id !== normalizeId(req.user._id))
      )
      .filter(Boolean);

    const users = await User.find({ _id: { $in: otherIds } });
    const userMap = new Map(users.map((user) => [normalizeId(user._id), user]));

    res.json({
      items: rows.map((row) => {
        const otherId = row._id
          .split(":")
          .find((id) => id !== normalizeId(req.user._id));
        const otherUser = userMap.get(otherId);

        return {
          threadKey: row._id,
          unreadCount: row.unreadCount,
          otherUser: otherUser ? serializeUser(otherUser, req.user) : null,
          lastMessage: {
            id: normalizeId(row.lastMessage._id),
            body: row.lastMessage.body,
            createdAt: row.lastMessage.createdAt,
            from: normalizeId(row.lastMessage.from),
            to: normalizeId(row.lastMessage.to),
          },
        };
      }),
    });
  })
);

app.get(
  "/api/messages/:userId",
  authRequired,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw createHttpError(404, "Foydalanuvchi topilmadi.");
    }

    const otherUser = await User.findById(req.params.userId);
    if (!otherUser) {
      throw createHttpError(404, "Foydalanuvchi topilmadi.");
    }

    const key = buildThreadKey(req.user._id, otherUser._id);

    await Message.updateMany(
      {
        threadKey: key,
        to: req.user._id,
        readAt: null,
      },
      { readAt: new Date() }
    );

    const messages = await Message.find({ threadKey: key })
      .populate("from", "name role avatarUrl verified")
      .populate("to", "name role avatarUrl verified")
      .sort({ createdAt: 1 });

    res.json({
      otherUser: serializeUser(otherUser, req.user),
      items: messages.map((message) => serializeMessage(message)),
    });
  })
);

app.post(
  "/api/messages/:userId",
  authRequired,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      throw createHttpError(404, "Foydalanuvchi topilmadi.");
    }

    const otherUser = await User.findById(req.params.userId);
    if (!otherUser) {
      throw createHttpError(404, "Foydalanuvchi topilmadi.");
    }

    if (normalizeId(otherUser._id) === normalizeId(req.user._id)) {
      throw createHttpError(400, "O'zingizga xabar yubora olmaysiz.");
    }

    const body = String(req.body.body || "").trim();
    if (!body) {
      throw createHttpError(400, "Xabar matni bo'sh bo'lmasligi kerak.");
    }

    const message = await Message.create({
      from: req.user._id,
      to: otherUser._id,
      body,
      threadKey: buildThreadKey(req.user._id, otherUser._id),
    });

    const populated = await Message.findById(message._id)
      .populate("from", "name role avatarUrl verified")
      .populate("to", "name role avatarUrl verified");

    const payload = serializeMessage(populated);
    io.to(`user:${normalizeId(req.user._id)}`).emit("message:new", payload);
    io.to(`user:${normalizeId(otherUser._id)}`).emit("message:new", payload);

    await createNotification(otherUser._id, {
      type: "message",
      title: "Yangi xabar",
      message: `${req.user.name} sizga yangi xabar yubordi.`,
      link: `/messages.html?with=${normalizeId(req.user._id)}`,
      meta: { from: normalizeId(req.user._id) },
    });

    res.status(201).json({
      message: payload,
    });
  })
);

app.get(
  "/api/dashboard/summary",
  authRequired,
  asyncHandler(async (req, res) => {
    const unreadNotifications = await Notification.countDocuments({
      user: req.user._id,
      read: false,
    });
    const unreadMessages = await Message.countDocuments({
      to: req.user._id,
      readAt: null,
    });

    if (req.user.role === "admin") {
      const [
        totalUsers,
        totalProviders,
        totalBookings,
        pendingPremium,
        userSeries,
        bookingSeries,
        roleCounts,
      ] = await Promise.all([
        User.countDocuments({ role: { $ne: "admin" } }),
        User.countDocuments({ role: { $in: providerRoles } }),
        Booking.countDocuments(),
        PremiumRequest.countDocuments({ status: "pending" }),
        buildMonthlySeries(User, { role: { $ne: "admin" } }),
        buildMonthlySeries(Booking, {}),
        User.aggregate([
          { $match: { role: { $ne: "admin" } } },
          { $group: { _id: "$role", count: { $sum: 1 } } },
        ]),
      ]);

      return res.json({
        role: "admin",
        metrics: {
          totalUsers,
          totalProviders,
          totalBookings,
          pendingPremium,
          unreadNotifications,
          unreadMessages,
        },
        charts: {
          monthlyUsers: userSeries,
          monthlyBookings: bookingSeries,
          roleBreakdown: roleCounts.map((item) => ({
            label: item._id,
            value: item.count,
          })),
        },
      });
    }

    if (providerRoles.includes(req.user.role)) {
      const [
        servicesCount,
        postsCount,
        incomingBookings,
        approvedBookings,
        slotBreakdown,
        bookingSeries,
      ] = await Promise.all([
        Service.countDocuments({ owner: req.user._id }),
        Post.countDocuments({ author: req.user._id }),
        Booking.countDocuments({
          provider: req.user._id,
          status: "pending",
        }),
        Booking.countDocuments({
          provider: req.user._id,
          status: "approved",
        }),
        Booking.aggregate([
          { $match: { provider: req.user._id } },
          { $group: { _id: "$slot", count: { $sum: 1 } } },
        ]),
        buildMonthlySeries(Booking, { provider: req.user._id }),
      ]);

      return res.json({
        role: req.user.role,
        metrics: {
          servicesCount,
          postsCount,
          pendingBookings: incomingBookings,
          approvedBookings,
          followersCount: req.user.followers.length,
          unreadNotifications,
          unreadMessages,
          premium: req.user.premium,
          verified: req.user.verified,
        },
        charts: {
          monthlyActivity: bookingSeries,
          slotBreakdown: bookingSlots.map((slot) => ({
            label: slot.label,
            value:
              slotBreakdown.find((item) => item._id === slot.value)?.count || 0,
          })),
        },
      });
    }

    const [bookingsCount, upcomingCount, bookingSeries] = await Promise.all([
      Booking.countDocuments({ customer: req.user._id }),
      Booking.countDocuments({
        customer: req.user._id,
        status: { $in: ["pending", "approved"] },
      }),
      buildMonthlySeries(Booking, { customer: req.user._id }),
    ]);

    res.json({
      role: req.user.role,
      metrics: {
        bookingsCount,
        upcomingCount,
        followingCount: req.user.following.length,
        unreadNotifications,
        unreadMessages,
      },
      charts: {
        monthlyActivity: bookingSeries,
      },
    });
  })
);

app.get(
  "/api/admin/users",
  authRequired,
  adminOnly,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 20)));
    const q = String(req.query.q || "").trim();
    const role = String(req.query.role || "").trim();
    const query = { role: { $ne: "admin" } };

    if (role && publicRoles.includes(role)) {
      query.role = role;
    }

    if (q) {
      query.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
        { city: { $regex: q, $options: "i" } },
      ];
    }

    const [total, users] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.json({
      items: users.map((user) => serializeUser(user, req.user)),
      total,
      page,
      hasMore: page * limit < total,
    });
  })
);

app.patch(
  "/api/admin/users/:id",
  authRequired,
  adminOnly,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user || user.role === "admin") {
      throw createHttpError(404, "Foydalanuvchi topilmadi.");
    }

    if (req.body.verified !== undefined) {
      user.verified = Boolean(parseBoolean(req.body.verified));
    }

    if (req.body.premium !== undefined) {
      user.premium = Boolean(parseBoolean(req.body.premium));
      user.premiumExpiresAt = user.premium
        ? new Date(Date.now() + PREMIUM_DAYS * 24 * 60 * 60 * 1000)
        : null;
    }

    if (req.body.role !== undefined && publicRoles.includes(req.body.role)) {
      user.role = req.body.role;
    }

    await user.save();

    await createNotification(user._id, {
      type: "admin",
      title: "Admin yangilovi",
      message: "Akkauntingiz parametrlari administrator tomonidan yangilandi.",
      link: "/dashboard.html",
    });

    res.json({
      user: serializeUser(user, req.user),
    });
  })
);

app.get(
  "/api/admin/premium-requests",
  authRequired,
  adminOnly,
  asyncHandler(async (req, res) => {
    const items = await PremiumRequest.find()
      .populate("user", "name role avatarUrl verified premium city")
      .populate("reviewedBy", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      items: items.map((item) => ({
        id: normalizeId(item._id),
        user: item.user
          ? {
              id: normalizeId(item.user._id),
              name: item.user.name,
              role: item.user.role,
              avatarUrl: item.user.avatarUrl || "",
              city: item.user.city || "",
              verified: Boolean(item.user.verified),
              premium: Boolean(item.user.premium),
            }
          : null,
        screenshotUrl: item.screenshotUrl,
        note: item.note,
        status: item.status,
        rejectionReason: item.rejectionReason,
        reviewedBy: item.reviewedBy?.name || "",
        reviewedAt: item.reviewedAt,
        createdAt: item.createdAt,
      })),
    });
  })
);

app.patch(
  "/api/admin/premium-requests/:id",
  authRequired,
  adminOnly,
  asyncHandler(async (req, res) => {
    const item = await PremiumRequest.findById(req.params.id).populate("user");
    if (!item) {
      throw createHttpError(404, "Premium so'rov topilmadi.");
    }

    const status = String(req.body.status || "").trim();
    if (!["approved", "rejected"].includes(status)) {
      throw createHttpError(400, "Status noto'g'ri.");
    }

    item.status = status;
    item.rejectionReason = String(req.body.rejectionReason || "").trim();
    item.reviewedBy = req.user._id;
    item.reviewedAt = new Date();

    if (item.user) {
      if (status === "approved") {
        item.user.premium = true;
        item.user.verified = true;
        item.user.premiumExpiresAt = new Date(
          Date.now() + PREMIUM_DAYS * 24 * 60 * 60 * 1000
        );
      } else {
        item.user.premium = false;
      }

      await item.user.save();

      await createNotification(item.user._id, {
        type: "premium",
        title:
          status === "approved"
            ? "Premium tasdiqlandi"
            : "Premium so'rov rad etildi",
        message:
          status === "approved"
            ? "Sizning premium akkauntingiz faol bo'ldi."
            : item.rejectionReason || "Premium so'rovingiz rad etildi.",
        link: "/dashboard.html",
        meta: { premiumRequestId: normalizeId(item._id) },
      });
    }

    await item.save();

    res.json({
      request: {
        id: normalizeId(item._id),
        status: item.status,
        rejectionReason: item.rejectionReason,
        reviewedAt: item.reviewedAt,
      },
    });
  })
);

app.get(
  "/api/admin/bookings",
  authRequired,
  adminOnly,
  asyncHandler(async (req, res) => {
    const status = String(req.query.status || "").trim();
    const query = {};

    if (status) {
      query.status = status;
    }

    const items = await Booking.find(query)
      .populate("provider", "name role avatarUrl verified premium city")
      .populate("customer", "name role avatarUrl")
      .populate("service")
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({
      items: items.map((item) => serializeBooking(item)),
    });
  })
);

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error("Unauthorized"));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return next(new Error("Unauthorized"));
    }

    socket.user = user;
    return next();
  } catch (error) {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = normalizeId(socket.user._id);
  socket.join(`user:${userId}`);

  socket.on("disconnect", async () => {
    try {
      await User.findByIdAndUpdate(userId, { lastSeenAt: new Date() });
    } catch (error) {
      // Ignore disconnect persistence issues.
    }
  });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.message || "Serverda kutilmagan xatolik yuz berdi.";
  console.error(err);
  res.status(status).json({ error: message });
});

async function start() {
  await mongoose.connect(MONGODB_URI);
  await ensureAdminUser();

  server.listen(PORT, () => {
    console.log(`ToyImbor server ishlayapti: http://localhost:${PORT}`);
    console.log(`Admin login: ${ADMIN_EMAIL}`);
    console.log(`Admin password: ${ADMIN_PASSWORD}`);
  });
}

start().catch((error) => {
  console.error("Server ishga tushmadi:", error);
  process.exit(1);
});
