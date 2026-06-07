/* ═══════════════════════════════════════════════════════
   Booking Routes — онлайн-запись с верификацией через TG
   POST /api/booking/init        → создать pending + deep-link
   POST /api/booking/telegram    → webhook Telegram бота
   GET  /api/booking/status/:tk  → опрос с фронта (poll)
   GET  /api/booking/services    → список услуг из BeautyPro
   GET  /api/booking/masters     → мастера для услуги
   GET  /api/booking/slots       → свободные слоты
   ═══════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const router = express.Router();
const bp = require('../beautyproClient');
const shop = require('../shop');

// In-memory pending bookings (MVP — replace with SQLite later)
const store = new Map();
const db = {
  insert(token, row) { store.set(token, { ...row, status: 'pending', created_at: Date.now() }); },
  get(token) { return store.get(token) || null; },
  byTgUser(uid) {
    const list = [...store.values()].filter(r => r.tg_user_id === uid && r.status === 'pending');
    return list.sort((a,b)=>b.created_at-a.created_at)[0] || null;
  },
  update(token, patch) {
    const r = store.get(token); if (!r) return; Object.assign(r, patch); store.set(token, r);
  },
};

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'Svs_beautybot';

// === Helpers ============================================
function genToken() {
  return crypto.randomBytes(16).toString('hex');
}

function tg(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      method: 'POST',
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// In-memory schema — no init needed

// === POST /init =========================================
router.post('/init', (req, res) => {
  try {
    const { service_id, employee_id, date_from, date_to, client_name } = req.body;
    if (!service_id || !employee_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'service_id, employee_id, date_from, date_to обовʼязкові' });
    }
    const token = genToken();
    db.insert(token, { token, service_id, employee_id, date_from, date_to, client_name: client_name || null });

    res.json({
      ok: true,
      token,
      deep_link: `https://t.me/${BOT_USERNAME}?start=${token}`,
    });
  } catch (e) {
    console.error('[booking/init]', e.message);
    res.status(500).json({ error: 'Не вдалось ініціалізувати запис' });
  }
});

// === GET /status/:token =================================
router.get('/status/:token', (req, res) => {
  const row = db.get(req.params.token);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ status: row.status, appointment_id: row.appointment_id || null, error: row.error || null });
});

// === Sarafan-style menu constants =======================
const SITE_URL = process.env.SVS_SITE_URL || 'https://svs-beauty-space.com';
const ADMIN_PHONE = process.env.SVS_ADMIN_PHONE || '+380991283375';
const ADMIN_TG = process.env.SVS_ADMIN_TG || 'Svsf1rstbot';
const CAT_LABEL = {
  hair: '💇‍♀️ Перукарські послуги',
  nails: '💅 Нігтьовий сервіс',
  brows: '✨ Візаж та брови',
  lashes: '👁 Нарощення вій',
  massage: '💆‍♀️ Масаж боді / фейс ліфтинг',
};
const CAT_ORDER = ['hair', 'nails', 'brows', 'lashes', 'massage'];

// Фото-довідник довжини волосся (окрема кнопка, не в альбомі)
const HAIR_LENGTH_PHOTO = 'AgACAgQAAxkDAAPLaiTBtXP0jsJy5gKbRElPhB8YYEwAAn4NaxtmQChRjFmstnOiScUBAAMCAAN5AAM7BA';

// Прайс-фото file_id (загружены в Telegram)
const CAT_PRICE_PHOTO = {
  hair: [
    'AgACAgQAAxkDAAPMaiTBtxHyvGLXn38ppsR3hLxFR-EAAn8NaxtmQChR_Zg4RgshisQBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPOaiTCFmyEsE9VmDGJXe_8AWtlUVAAAoENaxtmQChRDefRjeWiJjMBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPPaiTCUmJ0FwT_4WOw5efP49QHW2wAAoINaxtmQChRNmPSkA8EBMsBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPQaiTCiipqzVODxRK-dBzCxKYmfD8AAoMNaxtmQChRcUeC44XSFSoBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPRaiTCxCCpX2aFjyn4_n1I1KQW-ocAAoQNaxtmQChRVCL-iab5r5UBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPSaiTC_znY5wFOzKIftWsvLDLGuvoAAoUNaxtmQChRKVIM_aPk94QBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPTaiTDObSgRs0x_RWzUsiPalCTixAAAoYNaxtmQChR9u2eA6lWlYcBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPUaiTDd7nApyRanOEhYxLm6KWOZsAAAocNaxtmQChRzlFYntAV-8gBAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPVaiTDrQNJltvsmnWB8P5kVY2VpN8AAogNaxtmQChRqE9aFUqUBOUBAAMCAAN5AAM7BA',
  ],
  nails: [
    'AgACAgQAAxkDAAPNaiTBuAEF9g_PgG4RBVFCxsNeQ3MAAoANaxtmQChRtLNBm2y_j84BAAMCAAN5AAM7BA',
    'AgACAgQAAxkDAAPWaiTD6AbeLGPYqRf1cteWd9wDa4wAAokNaxtmQChRJLRQQ__cuoIBAAMCAAN3AAM7BA',
  ],
  brows: 'AgACAgQAAxkDAAPXaiTEHnWgh9hUelTmN_RX_tqz_ucAAooNaxtmQChR8ujJfVqHKPgBAAMCAAN3AAM7BA',
  lashes: null,
  massage: 'AgACAgQAAxkDAAPYaiTEUBHCzTVP4L64s4DWtRbUnlkAAosNaxtmQChRI_4J42yrDQsBAAMCAAN3AAM7BA',
};

// In-memory: tg_user_id → phone (для "Мої записи")
const userPhones = new Map();
// In-memory: tg_user_id → { username, first_name, last_name } з метаданих ТГ
const userMeta = new Map();

// In-memory: chat_id → 1, щоб не дёргати setChatMenuButton кожен раз
const menuButtonSet = new Map();

async function ensureBookingMenuButton(chatId) {
  if (menuButtonSet.get(chatId)) return;
  try {
    // default + 0 команд = у багатьох клієнтів синя Menu кнопка взагалі ховається
    await tg('setChatMenuButton', {
      chat_id: chatId,
      menu_button: { type: 'default' },
    });
    menuButtonSet.set(chatId, 1);
  } catch (e) { /* ignore */ }
}

function saveUserMeta(from) {
  if (!from || !from.id) return;
  userMeta.set(from.id, {
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
  });
}

async function askShareContact(chatId, firstName) {
  // Одне повідомлення з reply-кнопкою request_contact
  // Працює на iOS, Android, Desktop — без web_app / Mini App
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `Вітаю, <b>${firstName || 'друже'}</b>! 👋\n\n` +
      `Я — бот <b>SVS Beauty Space</b>.\n\n` +
      `Щоб ви могли користуватись усіма функціями (онлайн-запис, мої записи, знижки, нагадування), мені потрібен ваш номер телефону.\n\n` +
      `👇 <b>Натисніть кнопку нижче «📱 Поділитись номером»</b>`,
    reply_markup: {
      keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

function mainMenuKeyboard() {
  return {
    keyboard: [
      [{ text: '🗓 Записатись на візит' }],
      [{ text: '📄 Прайс-лист' }, { text: 'ℹ️ Мої записи' }],
      [{ text: '🛍 Магазин косметики' }],
      [{ text: '🎁 Отримати знижку' }, { text: '❤️ Запросити подругу' }],
      [{ text: '🧚 Адміністратор салону' }],
    ],
    resize_keyboard: true,
  };
}

async function showMainMenu(chatId, name) {
  const text =
    `<b>SVS Beauty Space</b> — салон краси у Львові 💖\n\n` +
    `Що ми вміємо тут, у боті:\n` +
    `🗓 Записатись онлайн до майстра за пару кліків\n` +
    `📄 Подивитись прайс по категоріях\n` +
    `🛍 Купити професійну косметику онлайн\n` +
    `ℹ️ Подивитись свої записи\n` +
    `🎁 Отримати знижку та бонуси\n` +
    `❤️ Запросити подругу і отримати кешбек\n` +
    `🧚 Звʼязатися з адміністратором\n\n` +
    `Оберіть кнопку нижче 👇`;
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text,
    reply_markup: mainMenuKeyboard(),
  });
}

// Один салон — Суми
async function showBranchBritanska(chatId) { return showAdmin(chatId); }
async function showBranchKharkivska(chatId) { return showAdmin(chatId); }

async function showBookVisit(chatId) {
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `<b>🗓 Запис на візит</b>\n\n` +
      `Для запису на процедуру зателефонуйте адміністратору:\n\n` +
      `📞 +380991283375\n\n` +
      `Або напишіть нам в Instagram:`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '📸 Написати в Instagram', url: 'https://www.instagram.com/svs_beauty_space/' }],
      ],
    },
  });
}

async function showPriceCategories(chatId) {
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: '<b>📋 Прайс-лист</b>\n\nОберіть категорію послуг:',
    reply_markup: {
      inline_keyboard: CAT_ORDER.map(c => [{ text: CAT_LABEL[c], callback_data: `cat:${c}` }]),
    },
  });
}

async function showCategoryServices(chatId, cat, messageId) {
  const photoId = CAT_PRICE_PHOTO[cat];
  const kb = { inline_keyboard: [[{ text: '« Назад до категорій', callback_data: 'menu:price' }]] };

  if (Array.isArray(photoId)) {
    // Несколько фото — медиагруппа
    const media = photoId.map((id, i) => ({
      type: 'photo', media: id,
      ...(i === 0 ? { caption: `<b>${CAT_LABEL[cat] || cat}</b>`, parse_mode: 'HTML' } : {}),
    }));
    await tg('sendMediaGroup', { chat_id: chatId, media });
    // Для hair — додаткова кнопка "Дізнатись свою довжину"
    if (cat === 'hair') {
      kb.inline_keyboard.unshift([{ text: '📏 Дізнатись свою довжину', callback_data: 'hair:length' }]);
    }
    return tg('sendMessage', { chat_id: chatId, text: '👆 Прайс-лист вище', reply_markup: kb });
  }

  if (photoId) {
    return tg('sendPhoto', {
      chat_id: chatId, photo: photoId,
      caption: `<b>${CAT_LABEL[cat] || cat}</b>`, parse_mode: 'HTML', reply_markup: kb,
    });
  }

  // Заглушка пока нет фото
  const text = `<b>${CAT_LABEL[cat] || cat}</b>\n\nПрайс-лист оновлюється. Зверніться до адміністратора для уточнення цін.\n\n📞 +380991283375`;
  if (messageId) return tg('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', reply_markup: kb });
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: kb });
}

async function showMyAppointments(chatId, tgUserId, firstName) {
  const phone = userPhones.get(tgUserId);
  if (!phone) {
    return tg('sendMessage', {
      chat_id: chatId,
      text: '📜 Щоб побачити ваші записи — поділіться номером телефону:',
      reply_markup: {
        keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }], [{ text: '« Назад' }]],
        resize_keyboard: true, one_time_keyboard: true,
      },
    });
  }
  try {
    const client = await bp.findClientByPhone(phone).catch(() => null);
    if (!client) return tg('sendMessage', { chat_id: chatId, text: 'У CRM не знайдено записів за вашим номером.', reply_markup: mainMenuKeyboard() });
    const cid = client.id || client.client_id;
    const appts = await bp.raw('GET', `/clients/${cid}/appointments`, { limit: 10 }).catch(() => null);
    const list = Array.isArray(appts) ? appts : (appts && appts.appointments) || [];
    if (!list.length) return tg('sendMessage', { chat_id: chatId, text: 'У вас поки немає записів.', reply_markup: mainMenuKeyboard() });
    const lines = list.slice(0, 10).map(a => {
      const dt = (a.date_from || a.start || '').replace('T', ' ').slice(0, 16);
      const svc = a.service_name || a.service || '';
      const status = a.status === 'confirmed' || a.status === 'active' ? '✅' : (a.status === 'cancelled' ? '❌' : '⏳');
      return `${status} <b>${dt}</b> — ${svc}`;
    });
    return tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `<b>📜 Ваші записи</b>\n\n${lines.join('\n')}`, reply_markup: mainMenuKeyboard() });
  } catch (e) {
    console.error('[bot/my]', e.message);
    return tg('sendMessage', { chat_id: chatId, text: 'Не вдалось завантажити записи.', reply_markup: mainMenuKeyboard() });
  }
}

async function showInviteFriend(chatId, tgUserId) {
  const ref = `ref_${tgUserId}`;
  const link = `https://t.me/${BOT_USERNAME}?start=${ref}`;
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>👯 Запросіть подругу</b>\n\nПодаруйте подрузі <b>10% знижку</b> на перший візит, а собі — <b>200 грн бонусу</b> на наступну послугу.\n\nВаше реферальне посилання:\n${link}`,
    reply_markup: {
      inline_keyboard: [[{ text: '📤 Поділитись', switch_inline_query: `Записуйся у SVS Beauty Space зі знижкою 10%: ${link}` }]],
    },
  });
}

async function showDiscount(chatId) {
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>🎁 Знижки та програма лояльності</b>\n\n• <b>−10%</b> на перший візит\n• <b>−15%</b> на день народження (тиждень до/після)\n• <b>Кешбек 5%</b> на наступний візит від суми чека\n• <b>Реферальна −10%</b> подрузі + 200 грн вам\n\nПодробиці — натисніть «📞 Адміністратор».`,
    reply_markup: mainMenuKeyboard(),
  });
}

async function showAdmin(chatId) {
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
    text:
      `🧚 <b>SVS Beauty Space</b>\n\n` +
      `📍 <b>Адреса:</b> <a href="https://maps.google.com/?q=1-ша+Набережна+р.+Стрілка+50+Суми">1-ша Набережна р. Стрілка, 50, Суми</a>\n\n` +
      `📞 <b>Зателефонувати:</b> +380991283375\n\n` +
      `🕐 <b>Графік роботи:</b>\nПн — Нд: 8:00 — 19:00\n\n` +
      `Будемо раді бачити вас! 💛`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '📸 Ми в Instagram', url: 'https://www.instagram.com/svs_beauty_space/' }],
      ],
    },
  });
}

async function showAbout(chatId) {
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>ℹ️ SVS Beauty Space</b>\n\nПреміум салон краси у Львові: волосся, нігті, обличчя, масаж та body sculpt.\n\nКоманда сертифікованих майстрів, преміум-косметика, авторські процедури.\n\n🌐 ${SITE_URL}`,
    reply_markup: mainMenuKeyboard(),
  });
}

// === POST /telegram (webhook) ===========================
router.post('/telegram', async (req, res) => {
  res.json({ ok: true }); // ack immediately
  try {
    const upd = req.body;

    // ── pre_checkout_query (Telegram Payments — відповідь за 10 сек!) ──
    if (upd.pre_checkout_query) {
      console.log('[pre_checkout] received, id:', upd.pre_checkout_query.id);
      try {
        const pcResult = await tg('answerPreCheckoutQuery', {
          pre_checkout_query_id: upd.pre_checkout_query.id,
          ok: true,
        });
        console.log('[pre_checkout] answered:', JSON.stringify(pcResult));
        return;
      } catch (pcErr) {
        console.error('[pre_checkout] ERROR:', pcErr.message);
        return;
      }
    }

    // ── callback_query (inline buttons) ───────────────
    if (upd.callback_query) {
      const cq = upd.callback_query;
      const data = cq.data || '';
      const chatId = cq.message.chat.id;
      const msgId = cq.message.message_id;
      await tg('answerCallbackQuery', { callback_query_id: cq.id });
      if (data === 'menu:price') return showPriceCategories(chatId);
      if (data === 'menu:main') return showMainMenu(chatId, cq.from.first_name);
      if (data.startsWith('cat:')) return showCategoryServices(chatId, data.slice(4), msgId);
      if (data === 'hair:length') {
        return tg('sendPhoto', {
          chat_id: chatId, photo: HAIR_LENGTH_PHOTO,
          caption: '<b>📏 Визначте свою довжину волосся</b>\n\nЗнайдіть свій рівень на фото (1-6) та орієнтуйтесь на відповідні ціни у прайсі.',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '« Назад до категорій', callback_data: 'menu:price' }]] },
        });
      }
      if (data === 'action:call_admin') return showAdmin(chatId);
      // ── Shop callbacks ──
      if (data.startsWith('shop:')) {
        const userPhone = userPhones.get(cq.from.id) || null;
        return shop.handleCallback(tg, chatId, cq.from.id, data, userPhone, process.env.ADMIN_CHAT_ID || null);
      }
      return;
    }

    const msg = upd.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Завжди фіксуємо username/ім'я з ТГ
    saveUserMeta(msg.from);
    // Замінюємо синю Menu кнопку на "📅 Записатись" (одноразово на чат)
    ensureBookingMenuButton(chatId);

    // ── /start <token> — підтвердження запису з сайту ─
    if (text.startsWith('/start ')) {
      const token = text.split(' ')[1];
      if (token && !token.startsWith('ref_')) {
        const row = db.get(token);
        if (!row) return tg('sendMessage', { chat_id: chatId, text: '⌛ Запис застарів. Поверніться на сайт і почніть знову.' });
        if (row.status !== 'pending') return tg('sendMessage', { chat_id: chatId, text: '✓ Цей запис вже підтверджено.' });
        db.update(token, { tg_user_id: msg.from.id });
        // Якщо телефон вже відомий — підтверджуємо одразу без request_contact
        const knownPhone = userPhones.get(msg.from.id);
        if (knownPhone) {
          try {
            const client = await bp.createClient({ phone: knownPhone, name: row.client_name || msg.from.first_name });
            const appt = await bp.createAppointment({
              client_id: client.id || client.client_id,
              service_id: row.service_id,
              employee_id: row.employee_id,
              date_from: row.date_from,
              date_to: row.date_to,
            });
            db.update(token, { status: 'confirmed', phone: knownPhone, appointment_id: String(appt.id || appt.appointment_id || ''), verified_at: Date.now() });
            return tg('sendMessage', { chat_id: chatId, text: '✅ Запис підтверджено! Чекаємо вас у салоні.', reply_markup: mainMenuKeyboard() });
          } catch (e) {
            console.error('[booking/bp-push-known]', e.message);
            // якщо CRM упав — просимо контакт явно, як було раніше
          }
        }
        return tg('sendMessage', {
          chat_id: chatId,
          text: 'Для підтвердження запису поділіться номером телефону:',
          reply_markup: {
            keyboard: [[{ text: '📱 Поділитись номером', request_contact: true }]],
            one_time_keyboard: true, resize_keyboard: true,
          },
        });
      }
      // ref_XXX або просто /start без аргументу → меню (з перевіркою phone)
      if (!userPhones.get(msg.from.id)) return askShareContact(chatId, msg.from.first_name);
      return showMainMenu(chatId, msg.from.first_name);
    }

    // ── /start без аргументу ──────────────────────────
    if (text === '/start' || text === '/menu') {
      console.log('[/start]', { chatId, userId: msg.from.id, hasPhone: !!userPhones.get(msg.from.id) });
      if (!userPhones.get(msg.from.id)) {
        const result = await askShareContact(chatId, msg.from.first_name);
        console.log('[askShareContact result]', JSON.stringify(result));
        return result;
      }
      return showMainMenu(chatId, msg.from.first_name);
    }

    // ── Адміністратор — доступний без phone gate ──────
    if (text === '🧚 Адміністратор салону') return showAdmin(chatId);

    // ── ЖОРСТКИЙ GATE: до того як поділився номером — нічого не доступне ──
    if (!userPhones.get(msg.from.id) && !msg.contact) {
      return askShareContact(chatId, msg.from.first_name);
    }

    // ── Reply keyboard кнопки ────────────────────────
    if (text === '🗓 Записатись на візит') return showBookVisit(chatId);
    if (text === '❤️ Запросити подругу') return showInviteFriend(chatId, msg.from.id);
    if (text === 'ℹ️ Мої записи') return showMyAppointments(chatId, msg.from.id, msg.from.first_name);
    if (text === '📄 Прайс-лист') return showPriceCategories(chatId);
    if (text === '🛍 Магазин косметики') return shop.showShopMain(tg, chatId);
    if (text === '🎁 Отримати знижку') return showDiscount(chatId);
    if (text === '« Назад') return showMainMenu(chatId, msg.from.first_name);

    // ── Successful payment ─────────────────────────────
    if (msg.successful_payment) {
      console.log('[payment] successful_payment received:', JSON.stringify(msg.successful_payment));
      const savedPhone = userPhones.get(msg.from.id) || null;
      return shop.handleSuccessfulPayment(tg, msg, process.env.ADMIN_CHAT_ID || null, savedPhone);
    }

    // ── Contact received ──────────────────────────────
    if (msg.contact) {
      if (msg.contact.user_id !== msg.from.id) {
        return tg('sendMessage', { chat_id: chatId, text: '❌ Можна поділитись лише власним номером.' });
      }
      const phone = '+' + msg.contact.phone_number.replace(/\D/g, '');
      userPhones.set(msg.from.id, phone);

      // Якщо є pending booking — підтверджуємо
      const row = db.byTgUser(msg.from.id);
      if (row) {
        try {
          const client = await bp.createClient({ phone, name: row.client_name || msg.from.first_name });
          const appt = await bp.createAppointment({
            client_id: client.id || client.client_id,
            service_id: row.service_id,
            employee_id: row.employee_id,
            date_from: row.date_from,
            date_to: row.date_to,
          });
          db.update(row.token, { status: 'confirmed', phone, appointment_id: String(appt.id || appt.appointment_id || ''), verified_at: Date.now() });
          return tg('sendMessage', {
            chat_id: chatId,
            text: '✅ Запис підтверджено! Чекаємо вас у салоні.',
            reply_markup: mainMenuKeyboard(),
          });
        } catch (e) {
          console.error('[booking/bp-push]', e.message);
          db.update(row.token, { status: 'failed', error: e.message.slice(0, 200) });
          return tg('sendMessage', { chat_id: chatId, text: '⚠️ Не вдалось зберегти запис у CRM. Адміністратор звʼяжеться з вами.', reply_markup: mainMenuKeyboard() });
        }
      }

      // Інакше — вітаємо в головному меню (без pending)
      await tg('sendMessage', {
        chat_id: chatId,
        text: `Дякуємо, ${msg.from.first_name || ''}! Ваш номер збережено ✅`,
        reply_markup: mainMenuKeyboard(),
      });
      return showMainMenu(chatId, msg.from.first_name);
    }

    // ── Fallback ──────────────────────────────────────
    return showMainMenu(chatId, msg.from.first_name);
  } catch (e) {
    console.error('[booking/telegram]', e.message);
  }
});

// === POST /direct — пряма запис без Telegram ===========
// body: { phone, name, service_id, service_name?, employee_id, master_name?,
//         date_from, date_to, idempotency_key? }
router.post('/direct', async (req, res) => {
  const db = require('../db/client');
  try {
    const {
      phone: rawPhone, name, service_id, service_name,
      employee_id, master_name, date_from, date_to, idempotency_key
    } = req.body || {};
    if (!rawPhone || !name || !service_id || !employee_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'phone, name, service_id, employee_id, date_from, date_to обовʼязкові' });
    }
    const digits = String(rawPhone).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
      return res.status(400).json({ error: 'Невірний номер телефону' });
    }
    const phone = '+' + digits;
    const cleanName = String(name).trim().slice(0, 80);
    if (cleanName.length < 2) {
      return res.status(400).json({ error: 'Введіть імʼя' });
    }

    // Blacklist check
    if (await db.isBlacklisted(phone)) {
      return res.status(403).json({ error: 'Онлайн-запис недоступний. Зателефонуйте салону.' });
    }

    // Idempotency — захист від подвійного кліку / retry
    const idemKey = idempotency_key || null;
    if (idemKey) {
      const claim = await db.tryClaimIdempotency(idemKey, phone);
      if (!claim.claimed) {
        if (claim.existing && claim.existing.status === 'success' && claim.existing.response_body) {
          return res.json(JSON.parse(claim.existing.response_body));
        }
        if (claim.existing && claim.existing.status === 'pending') {
          return res.status(409).json({ error: 'Запит уже обробляється, зачекайте секунду' });
        }
        try { await db.getDb().query('DELETE FROM idempotency_keys WHERE key = $1', [idemKey]); } catch (_) {}
        await db.tryClaimIdempotency(idemKey, phone);
      }
    }

    try {
      const client = await bp.createClient({ phone, name: cleanName });
      const appt = await bp.createAppointment({
        client_id: client.id || client.client_id,
        service_id,
        employee_id,
        date_from,
        date_to,
        note: 'Онлайн-запис з сайту',
      });
      const appointment_id = String(appt.id || appt.appointment_id || '');

      // Тривалість для cancel_token
      const startMs = Date.parse(date_from);
      const endMs = Date.parse(date_to);
      const duration_min = Math.round((endMs - startMs) / 60000) || 60;

      // Локальний лог + cancel_token
      let cancel_token = null;
      try {
        await db.logAppointment({
          appointment_id, client_phone: phone, client_name: cleanName,
          service_id, service_name, master_id: employee_id, master_name,
          start_at: new Date(date_from).toISOString(), duration_min,
          status: 'active', source: 'widget',
        });
        cancel_token = await db.createCancelToken({
          appointment_id, client_phone: phone,
          service_id, service_name,
          master_id: employee_id, master_name,
          start_at: new Date(date_from).toISOString(), duration_min,
        });
      } catch (logErr) {
        console.error('[booking/direct] log/token error:', logErr.message);
        // не валимо запис якщо локальна БД мовчить
      }

      // Спринт 3 — планування нагадувань 24г та 2г до запису
      try {
        const startTs = startMs;
        const remind24 = new Date(startTs - 24*3600*1000).toISOString().slice(0,19).replace('T',' ');
        const remind2 = new Date(startTs - 2*3600*1000).toISOString().slice(0,19).replace('T',' ');
        const payload = {
          service_name: service_name || null,
          master_name: master_name || null,
          start_at: new Date(startTs).toISOString(),
          duration_min,
          cancel_token,
        };
        if (startTs - Date.now() > 24*3600*1000) {
          await db.scheduleNotification({ appointment_id, cancel_token, client_phone: phone,
            event: 'reminder_24h', scheduled_at: remind24, payload });
        }
        if (startTs - Date.now() > 2*3600*1000 + 5*60*1000) {
          await db.scheduleNotification({ appointment_id, cancel_token, client_phone: phone,
            event: 'reminder_2h', scheduled_at: remind2, payload });
        }
      } catch (notifErr) {
        console.error('[booking/direct] schedule notif:', notifErr.message);
      }

      const responseBody = { ok: true, appointment_id, cancel_token };
      if (idemKey) await db.completeIdempotency(idemKey, appointment_id, responseBody);
      return res.json(responseBody);
    } catch (crmErr) {
      if (idemKey) await db.failIdempotency(idemKey, crmErr.message);
      throw crmErr;
    }
  } catch (e) {
    console.error('[booking/direct]', e.message);
    res.status(500).json({ error: e.message || 'CRM error' });
  }
});

// === GET /confirm?token — клієнт підтверджує прихід (по лінку з нагадування) ==
router.get('/confirm', async (req, res) => {
  const db = require('../db/client');
  const token = String(req.query.token || '');
  if (!token) return res.status(400).send('<h1>Помилка</h1><p>Невірне посилання</p>');
  const row = await db.getCancelToken(token);
  if (!row) return res.status(404).send('<h1>Не знайдено</h1><p>Посилання застаріло або скасоване</p>');
  if (row.status !== 'active') return res.send('<h1>Запис уже оброблено</h1>');
  try {
    await db.getDb().query(`UPDATE cancel_tokens SET used_at = NOW() WHERE token = $1`, [token]);
  } catch (_) { /* не критично */ }
  const html = `<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Запис підтверджено</title>
<style>body{font-family:system-ui;background:#faf6f1;color:#2a1f17;padding:40px 20px;text-align:center}
h1{color:#8b6f47}.box{max-width:480px;margin:0 auto;background:#fff;padding:32px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06)}
.svc{font-weight:600;font-size:18px;margin:16px 0}.muted{color:#8a7d6e;font-size:14px}</style>
</head><body><div class="box"><h1>✓ Дякуємо!</h1>
<div class="svc">${row.service_name || 'Запис'} · ${new Date(row.start_at).toLocaleString('uk-UA')}</div>
${row.master_name ? '<div class="muted">Майстер: '+row.master_name+'</div>' : ''}
<p>Чекаємо вас у SVS Beauty Space.<br>До зустрічі!</p>
<p class="muted">Якщо плани раптом змінились — зателефонуйте салону: +380 99 128 33 75</p>
</div></body></html>`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(html);
});

// === GET /booking/info/:token — деталі запису для екрану «скасувати/перенести»
router.get('/info/:token', async (req, res) => {
  const db = require('../db/client');
  const row = await db.getCancelToken(String(req.params.token || ''));
  if (!row) return res.status(404).json({ error: 'Токен не знайдено' });
  res.json({
    appointment_id: row.appointment_id,
    service_name: row.service_name,
    master_name: row.master_name,
    start_at: row.start_at,
    duration_min: row.duration_min,
    status: row.status,
    used_action: row.used_action,
  });
});

// === POST /booking/cancel — клієнт скасовує свою запис ==========
// body: { token, reason? }
router.post('/cancel', async (req, res) => {
  const db = require('../db/client');
  try {
    const { token, reason } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token обовʼязковий' });
    const row = await db.getCancelToken(token);
    if (!row) return res.status(404).json({ error: 'Токен не знайдено або протух' });
    if (row.status !== 'active') return res.status(409).json({ error: 'Запис вже оброблено: ' + (row.used_action || row.status) });

    const minHours = 2;
    const hoursToAppt = (new Date(row.start_at).getTime() - Date.now()) / 3600000;
    if (hoursToAppt < minHours) {
      return res.status(422).json({
        error: `Скасування доступне не пізніше ніж за ${minHours}г. Зателефонуйте салону: +380 99 128 33 75`
      });
    }

    let crmOk = false;
    try {
      if (typeof bp.cancelAppointment === 'function') {
        await bp.cancelAppointment(row.appointment_id, reason || 'cancelled_by_client');
        crmOk = true;
      }
    } catch (crmErr) {
      console.error('[booking/cancel] CRM error:', crmErr.message);
    }

    await db.consumeCancelToken(token, 'cancel');
    await db.updateAppointmentStatus(row.appointment_id, 'cancelled');
    res.json({ ok: true, crm_synced: crmOk });
  } catch (e) {
    console.error('[booking/cancel]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === POST /booking/reschedule — клієнт переносить запис =========
// body: { token, new_date_from, new_date_to }
router.post('/reschedule', async (req, res) => {
  const db = require('../db/client');
  try {
    const { token, new_date_from, new_date_to } = req.body || {};
    if (!token || !new_date_from || !new_date_to) {
      return res.status(400).json({ error: 'token, new_date_from, new_date_to обовʼязкові' });
    }
    const row = await db.getCancelToken(token);
    if (!row) return res.status(404).json({ error: 'Токен не знайдено' });
    if (row.status !== 'active') return res.status(409).json({ error: 'Запис вже оброблено' });

    const minHours = 2;
    const hoursToAppt = (new Date(row.start_at).getTime() - Date.now()) / 3600000;
    if (hoursToAppt < minHours) {
      return res.status(422).json({ error: `Перенос можливий не пізніше ніж за ${minHours}г` });
    }

    try {
      if (typeof bp.cancelAppointment === 'function') {
        await bp.cancelAppointment(row.appointment_id, 'rescheduled_by_client');
      }
      const appt = await bp.createAppointment({
        client_id: null,
        service_id: row.service_id,
        employee_id: row.master_id,
        date_from: new_date_from,
        date_to: new_date_to,
        note: 'Перенесено клієнтом',
      });
      const new_appointment_id = String(appt.id || appt.appointment_id || '');
      await db.consumeCancelToken(token, 'reschedule');
      await db.updateAppointmentStatus(row.appointment_id, 'rescheduled');

      const new_token = await db.createCancelToken({
        appointment_id: new_appointment_id,
        client_phone: row.client_phone,
        service_id: row.service_id, service_name: row.service_name,
        master_id: row.master_id, master_name: row.master_name,
        start_at: new Date(new_date_from).toISOString(),
        duration_min: row.duration_min,
      });
      res.json({ ok: true, new_appointment_id, new_cancel_token: new_token });
    } catch (crmErr) {
      console.error('[booking/reschedule] CRM error:', crmErr.message);
      res.status(500).json({ error: 'Не вдалося перенести: ' + crmErr.message });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === Catalog endpoints ==================================
// Карта позицій BeautyPro → 3 категорії виджета (від 06.06)
const POSITION_TO_CATEGORY = {
  '88de9f81-ba4e-ca1e-2721-6e896f54727c': 'hair',    // Стилист
  '88de9f81-ba11-bad5-2721-6e897f6aeaf3': 'face',    // Визажист
  '88de9f81-ba86-ef50-2721-6e891694e6c5': 'nails',   // Мастер маникюра
  '88dec3b1-f6dc-b5f0-61c1-6b5a6950e003': 'massage', // Масажист
};
// Override по category GUID — для масажу (BODY SCULPT + NATURAL FACE LIFT, створено 06.06)
const CATEGORY_OVERRIDE = {
  '88dec3b1-3738-99ff-499c-0c4226c659f1': 'massage', // BODY SCULPT
  '88dec3b1-373d-0c5a-5a8d-479b1f45cf16': 'massage', // NATURAL FACE LIFT
};

// Кеш каталогу — щоб віджет не лагав при кожному відкритті (5 хв TTL)
let svcCache = { ts: 0, body: null };
const SVC_TTL_MS = 5 * 60 * 1000;

router.get('/services', async (req, res) => {
  try {
    const now = Date.now();
    if (svcCache.body && (now - svcCache.ts) < SVC_TTL_MS) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(svcCache.body);
    }
    const [svcs, emps] = await Promise.all([bp.listServices(), bp.listEmployees()]);
    const svcArr = Array.isArray(svcs) ? svcs : (svcs.data || svcs.items || []);
    const empArr = Array.isArray(emps) ? emps : (emps.data || emps.items || []);
    // serviceId → { hair: n, face: n, nails: n } — голоси по позиціях мастерів
    const votes = {};
    for (const m of empArr) {
      const positions = m.positions || (m.position ? [m.position] : []);
      const cat = positions.map(p => POSITION_TO_CATEGORY[p]).find(Boolean);
      if (!cat) continue;
      for (const s of (m.services || [])) {
        const sid = s.id || s;
        votes[sid] = votes[sid] || { hair: 0, face: 0, nails: 0 };
        votes[sid][cat]++;
      }
    }
    // Прикріплюємо widget_category до кожної послуги
    const out = svcArr.map(svc => {
      // 1) Override по категорії має пріоритет (масаж: BODY SCULPT / NATURAL FACE LIFT)
      const cid = typeof svc.category === 'string' ? svc.category : (svc.category && svc.category.id);
      if (cid && CATEGORY_OVERRIDE[cid]) {
        return { ...svc, widget_category: CATEGORY_OVERRIDE[cid] };
      }
      // 2) Голосування по позиціях мастерів
      const v = votes[svc.id];
      let wc = null;
      if (v) {
        const top = Object.entries(v).sort((a,b)=>b[1]-a[1])[0];
        if (top && top[1] > 0) wc = top[0];
      }
      return { ...svc, widget_category: wc };
    });
    svcCache = { ts: now, body: out };
    res.set('Cache-Control', 'public, max-age=60');
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/masters', async (req, res) => {
  try { res.json(await bp.listEmployees()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// === Helper: список майстрів які вміють послугу ==========
async function mastersForService(service_id) {
  const all = await bp.listEmployees();
  const list = Array.isArray(all) ? all : (all.data || all.items || []);
  const filtered = list.filter(m => Array.isArray(m.services) && m.services.some(x => (x.id || x) === service_id));
  return filtered.length ? filtered : list;
}

// === Helper: побудувати слоти з /schedule (одне звернення на весь період) ===
// Логіка: /schedule повертає worktime+appointments по всіх майстрах одразу.
// Для майстрів без worktime — дефолт 09:00-19:00 (як CRM UI показує).
// Дати в API марковані Z, але CRM пише локальний час → читаємо як локальний.
const DEFAULT_WORK_START = 9 * 60;   // 09:00 в хвилинах
const DEFAULT_WORK_END = 19 * 60;    // 19:00
const STEP_MINUTES = 15;

function parseHM(iso) {
  // "2026-06-06T08:00:00.000Z" → 8*60 (трактуємо як локальний час, ігноруємо Z)
  const m = String(iso).match(/T(\d{2}):(\d{2})/);
  return m ? parseInt(m[1],10) * 60 + parseInt(m[2],10) : null;
}
function parseDateKey(iso) {
  return String(iso).slice(0, 10);
}
function subtractInterval(windows, busyStart, busyEnd) {
  const out = [];
  for (const w of windows) {
    if (busyEnd <= w.start || busyStart >= w.end) { out.push(w); continue; }
    if (busyStart > w.start) out.push({ start: w.start, end: Math.min(busyStart, w.end) });
    if (busyEnd < w.end) out.push({ start: Math.max(busyEnd, w.start), end: w.end });
  }
  return out;
}
function toHHMM(min) {
  return String(Math.floor(min/60)).padStart(2,'0') + ':' + String(min%60).padStart(2,'0');
}

// На вхід: { duration, masterIds:Set, dateKeys:[YYYY-MM-DD], location }
// На вихід: { [dateKey]: { [hhmm]: Set(masterId,...) } }
async function buildAvailabilityFromSchedule({ duration, masterIds, dateKeys, location }) {
  const fromKey = dateKeys[0];
  const toKey = dateKeys[dateKeys.length - 1];
  const sch = await bp.getSchedule({ from: fromKey, to: toKey, location }).catch(() => ({ columns: [], appointments: {} }));
  const columns = Array.isArray(sch.columns) ? sch.columns : [];
  const apptsMap = sch.appointments && typeof sch.appointments === 'object' ? sch.appointments : {};

  // Індекс worktime: prof|date → [{start,end}]
  const worktimeIdx = {};
  // Індекс резервів: prof|date → [{start,end}]
  const reservesIdx = {};
  for (const col of columns) {
    const key = col.professional + '|' + parseDateKey(col.date);
    const wts = (col.worktime || []).map(w => ({ start: parseHM(w.start), end: parseHM(w.end) })).filter(w => w.start != null && w.end != null);
    if (wts.length) worktimeIdx[key] = wts;
    const reserves = (col.reserves || []).map(r => {
      const st = parseHM(r.start);
      return st != null ? { start: st, end: st + (r.duration || 0) } : null;
    }).filter(Boolean);
    if (reserves.length) reservesIdx[key] = reserves;
  }

  // Індекс зайнятих з топ-левел appointments map
  const busyIdx = {};
  for (const apptId of Object.keys(apptsMap)) {
    const a = apptsMap[apptId];
    if (!a || a.cancel) continue;
    const prof = a.professional;
    if (!prof) continue;
    const dk = parseDateKey(a.date);
    const st = parseHM(a.date);
    if (st == null) continue;
    const key = prof + '|' + dk;
    (busyIdx[key] = busyIdx[key] || []).push({ start: st, end: st + (a.duration || 0) });
  }

  const out = {};
  for (const dateKey of dateKeys) {
    for (const empId of masterIds) {
      const key = empId + '|' + dateKey;
      // Видимий графік або fallback
      let windows = worktimeIdx[key];
      if (!windows) {
        // Якщо у API явно вказані інші смени цього майстра в інші дні цього періоду — припускаємо що цей день він не працює
        const hasOtherDays = columns.some(c => c.professional === empId && (c.worktime||[]).length);
        if (hasOtherDays) continue; // майстер має реальний графік, цього дня не працює
        windows = [{ start: DEFAULT_WORK_START, end: DEFAULT_WORK_END }];
      }
      // Вирізаємо зайняті
      const busy = [...(busyIdx[key] || []), ...(reservesIdx[key] || [])];
      for (const b of busy) windows = subtractInterval(windows, b.start, b.end);

      // Нарізаємо слотами кратно STEP_MINUTES
      for (const w of windows) {
        for (let t = w.start; t + duration <= w.end; t += STEP_MINUTES) {
          const hhmm = toHHMM(t);
          out[dateKey] = out[dateKey] || {};
          out[dateKey][hhmm] = out[dateKey][hhmm] || new Set();
          out[dateKey][hhmm].add(empId);
        }
      }
    }
  }
  return out;
}

function buildDateKeys(daysAhead) {
  const now = new Date();
  const out = [];
  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push(d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'));
  }
  return out;
}

// === Helper: розплющити список слотів у плоский масив ===
// BeautyPro формат: { empId: { "YYYY-MM-DD": ["HH:MM", ...] } }
function flattenSlots(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.free_time)) return raw.free_time;
  if (raw && typeof raw === 'object') {
    const out = [];
    for (const empId of Object.keys(raw)) {
      const byDate = raw[empId];
      if (byDate && typeof byDate === 'object' && !Array.isArray(byDate)) {
        for (const dateStr of Object.keys(byDate)) {
          const times = byDate[dateStr];
          if (Array.isArray(times)) {
            for (const tm of times) {
              if (typeof tm === 'string') {
                out.push({ date: dateStr, time: tm, employee_id: empId, from: `${dateStr}T${tm}:00` });
              } else if (tm && (tm.from || tm.start || tm.time)) {
                out.push({ ...tm, employee_id: empId });
              }
            }
          }
        }
      } else if (Array.isArray(byDate)) {
        for (const item of byDate) out.push({ ...(typeof item === 'object' ? item : { from: item }), employee_id: empId });
      }
    }
    if (out.length) return out;
    const legacyArr = Object.values(raw).find(v => Array.isArray(v));
    if (legacyArr) return legacyArr;
  }
  return [];
}

// === GET /availability — доступність по всіх майстрах ====
// query: service_id, days (default 14), [employee_id — обмежити одним]
// → [{date: "2026-06-08", count: 12, first: "10:00", last: "18:30"}]
router.get('/availability', async (req, res) => {
  try {
    const { service_id, employee_id } = req.query;
    const days = Math.min(parseInt(req.query.days || '14', 10) || 14, 30);
    if (!service_id) return res.status(400).json({ error: 'service_id обовʼязковий' });

    const services = await bp.listServices();
    const svc = services.find(s => s.id === service_id);
    if (!svc) return res.status(404).json({ error: 'service not found' });
    const duration = svc.duration;

    const masters = employee_id
      ? [{ id: employee_id }]
      : await mastersForService(service_id);
    const masterIds = new Set(masters.map(m => m.id));
    const dateKeys = buildDateKeys(days);

    // Primary path: /schedule (одне звернення, реальні графіки + fallback дефолт 9-19)
    const slotsByDate = {}; // date → Set(hhmm)
    let scheduleErr = null;
    try {
      const sch = await buildAvailabilityFromSchedule({ duration, masterIds, dateKeys });
      for (const dk of Object.keys(sch)) {
        for (const hhmm of Object.keys(sch[dk])) {
          if (!slotsByDate[dk]) slotsByDate[dk] = new Set();
          slotsByDate[dk].add(hhmm);
        }
      }
    } catch (e) {
      scheduleErr = e.message;
      console.warn('[availability] /schedule failed, fallback to free_time:', e.message);
    }

    // Fallback: якщо /schedule нічого не дав — паралельний freeTime (старий шлях)
    if (Object.keys(slotsByDate).length === 0) {
      const start = new Date(dateKeys[0] + 'T00:00:00');
      const end = new Date(dateKeys[dateKeys.length-1] + 'T23:59:59');
      const fromIso = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString();
      const toIso = new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString();
      const results = await Promise.allSettled(
        masters.map(m => bp.freeTime({ duration, professional: m.id, from: fromIso, to: toIso }))
      );
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        const slots = flattenSlots(r.value);
        for (const s of slots) {
          const from = s.from || s.start || s.time || s;
          const d = new Date(from);
          if (isNaN(d)) continue;
          const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
          if (!slotsByDate[key]) slotsByDate[key] = new Set();
          slotsByDate[key].add(hhmm);
        }
      });
    }

    const out = [];
    let totalSlots = 0;
    for (const key of dateKeys) {
      const set = slotsByDate[key];
      if (set && set.size) {
        const arr = [...set].sort();
        out.push({ date: key, count: arr.length, first: arr[0], last: arr[arr.length - 1] });
        totalSlots += arr.length;
      } else {
        out.push({ date: key, count: 0 });
      }
    }
    // Если виджет старый и ждёт массив — отдаём массив. Иначе — объект с флагом.
    if (req.query.format === 'v2') {
      res.json({ days: out, totalSlots, noSchedule: totalSlots === 0, mastersChecked: masters.length });
    } else {
      // legacy: массив (как раньше) + неинвазивный мета-элемент через res header
      res.setHeader('X-Total-Slots', String(totalSlots));
      res.setHeader('X-No-Schedule', totalSlots === 0 ? '1' : '0');
      res.json(out);
    }
  } catch (e) {
    console.error('[booking/availability]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// === GET /slots — слоти на дату по всіх майстрах =========
// query: service_id, date (YYYY-MM-DD), [employee_id]
// → [{time: "10:00", employees: ["id1", "id2"]}, ...]
router.get('/slots', async (req, res) => {
  try {
    const { service_id, date, employee_id } = req.query;
    if (!service_id || !date) {
      return res.status(400).json({ error: 'service_id + date обовʼязкові' });
    }
    const services = await bp.listServices();
    const svc = services.find(s => s.id === service_id);
    if (!svc) return res.status(404).json({ error: 'service not found' });
    const duration = svc.duration;

    const masters = employee_id
      ? [{ id: employee_id }]
      : await mastersForService(service_id);
    const masterIds = new Set(masters.map(m => m.id));

    // Primary: /schedule на один день
    const byTime = {};
    try {
      const sch = await buildAvailabilityFromSchedule({ duration, masterIds, dateKeys: [date] });
      const day = sch[date] || {};
      for (const hhmm of Object.keys(day)) {
        const emps = [...day[hhmm]];
        byTime[hhmm] = { time: hhmm, from: date + 'T' + hhmm + ':00', employees: emps };
      }
    } catch (e) {
      console.warn('[slots] /schedule failed:', e.message);
    }

    // Fallback: якщо порожньо — старий freeTime
    if (Object.keys(byTime).length === 0) {
      const [y, m, dd] = date.split('-').map(Number);
      const dayStart = new Date(y, m - 1, dd, 0, 0, 0);
      const dayEnd = new Date(y, m - 1, dd, 23, 59, 59);
      const fromIso = new Date(dayStart.getTime() - dayStart.getTimezoneOffset() * 60000).toISOString();
      const toIso = new Date(dayEnd.getTime() - dayEnd.getTimezoneOffset() * 60000).toISOString();
      const results = await Promise.allSettled(
        masters.map(m => bp.freeTime({ duration, professional: m.id, from: fromIso, to: toIso })
          .then(raw => ({ employee_id: m.id, slots: flattenSlots(raw) })))
      );
      results.forEach((r) => {
        if (r.status !== 'fulfilled') return;
        const { employee_id: eid, slots } = r.value;
        for (const s of slots) {
          const from = s.from || s.start || s.time || s;
          const d = new Date(from);
          if (isNaN(d)) continue;
          const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
          if (!byTime[hhmm]) byTime[hhmm] = { time: hhmm, from: typeof from === 'string' ? from : d.toISOString(), employees: [] };
          if (!byTime[hhmm].employees.includes(eid)) byTime[hhmm].employees.push(eid);
        }
      });
    }

    const out = Object.values(byTime).sort((a, b) => a.time.localeCompare(b.time));
    res.json(out);
  } catch (e) {
    console.error('[booking/slots]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
