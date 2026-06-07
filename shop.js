/* ═══════════════════════════════════════════════════════
   SVS Beauty World — Telegram Shop Module
   Каталог → Карточка → Корзина → Оформлення замовлення
   Працює через inline-кнопки, без AI, повністю автономно
   ═══════════════════════════════════════════════════════ */
const db = require('./db-pg');

// In-memory корзина: userId → [{ variantId, productName, volume, price, qty }]
const carts = new Map();

// Кількість товарів на сторінку
const PAGE_SIZE = 8;

// ──── Каталог: головна магазину ────
async function showShopMain(tg, chatId) {
  const r = await db.query('SELECT id, name FROM brands WHERE EXISTS (SELECT 1 FROM products WHERE products.brand_id = brands.id AND products.active) ORDER BY name');
  const brands = r.rows;
  if (!brands.length) {
    return tg('sendMessage', { chat_id: chatId, text: 'Каталог оновлюється. Спробуйте пізніше.' });
  }
  const kb = brands.map(b => [{ text: b.name, callback_data: `shop:brand:${b.id}` }]);
  kb.push([{ text: '🛒 Кошик', callback_data: 'shop:cart' }]);
  kb.push([{ text: '« Головне меню', callback_data: 'menu:main' }]);
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: '<b>🛍 Магазин косметики SVS Beauty World</b>\n\nОберіть бренд:',
    reply_markup: { inline_keyboard: kb },
  });
}

// ──── Категорії бренду ────
async function showBrandCategories(tg, chatId, brandId) {
  const [brandR, catsR] = await Promise.all([
    db.query('SELECT name FROM brands WHERE id = $1', [brandId]),
    db.query(`
      SELECT DISTINCT c.id, c.name, c.group_name
      FROM categories c
      JOIN products p ON p.category_id = c.id AND p.brand_id = $1 AND p.active
      ORDER BY c.group_name, c.name
    `, [brandId]),
  ]);
  const brandName = brandR.rows[0]?.name || brandId;
  const cats = catsR.rows;
  if (!cats.length) {
    return tg('sendMessage', { chat_id: chatId, text: `У бренда ${brandName} наразі немає товарів.` });
  }
  const kb = cats.map(c => [{ text: `${c.name}`, callback_data: `shop:cat:${brandId}:${c.id}` }]);
  kb.push([{ text: '« Назад до брендів', callback_data: 'shop:main' }]);
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>${brandName}</b>\n\nОберіть категорію:`,
    reply_markup: { inline_keyboard: kb },
  });
}

// ──── Список товарів категорії ────
async function showCategoryProducts(tg, chatId, brandId, categoryId, page = 0) {
  const offset = page * PAGE_SIZE;
  const [catR, prodsR, countR] = await Promise.all([
    db.query('SELECT name FROM categories WHERE id = $1', [categoryId]),
    db.query(`
      SELECT p.id, p.name,
        (SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.active) as min_price
      FROM products p
      WHERE p.brand_id = $1 AND p.category_id = $2 AND p.active
      ORDER BY p.name
      LIMIT $3 OFFSET $4
    `, [brandId, categoryId, PAGE_SIZE, offset]),
    db.query('SELECT COUNT(*)::int as cnt FROM products WHERE brand_id = $1 AND category_id = $2 AND active', [brandId, categoryId]),
  ]);
  const catName = catR.rows[0]?.name || '';
  const prods = prodsR.rows;
  const total = countR.rows[0].cnt;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (!prods.length) {
    return tg('sendMessage', { chat_id: chatId, text: 'Товарів не знайдено.' });
  }

  const kb = prods.map(p => [{
    text: `${p.name} — від ${Math.round(p.min_price)} грн`,
    callback_data: `shop:prod:${p.id}`,
  }]);

  // Пагинация
  const navRow = [];
  if (page > 0) navRow.push({ text: '◀️', callback_data: `shop:cat:${brandId}:${categoryId}:${page - 1}` });
  if (page < totalPages - 1) navRow.push({ text: '▶️', callback_data: `shop:cat:${brandId}:${categoryId}:${page + 1}` });
  if (navRow.length) kb.push(navRow);

  kb.push([{ text: '« Назад до категорій', callback_data: `shop:brand:${brandId}` }]);

  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>${catName}</b> (${total} товарів)\n\nСторінка ${page + 1}/${totalPages}`,
    reply_markup: { inline_keyboard: kb },
  });
}

// ──── Карточка товару ────
async function showProduct(tg, chatId, productId) {
  const [prodR, varsR] = await Promise.all([
    db.query('SELECT p.*, b.name as brand_name FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = $1', [productId]),
    db.query('SELECT * FROM product_variants WHERE product_id = $1 AND active ORDER BY price', [productId]),
  ]);
  const prod = prodR.rows[0];
  if (!prod) return tg('sendMessage', { chat_id: chatId, text: 'Товар не знайдено.' });

  const variants = varsR.rows;
  let text =
    `<b>${prod.name}</b>\n` +
    `🏷 ${prod.brand_name}\n\n`;
  if (prod.description) text += `${prod.description}\n\n`;

  if (variants.length === 1) {
    const v = variants[0];
    text += `💰 <b>${Math.round(v.price)} грн</b>`;
    if (v.volume) text += ` (${v.volume})`;
  } else {
    text += '📦 Варіанти:\n';
    variants.forEach(v => {
      text += `• ${v.volume || 'стандарт'} — <b>${Math.round(v.price)} грн</b>\n`;
    });
  }

  const kb = variants.map(v => [{
    text: `🛒 ${v.volume || 'стандарт'} — ${Math.round(v.price)} грн`,
    callback_data: `shop:add:${v.id}`,
  }]);
  kb.push([
    { text: '🛒 Кошик', callback_data: 'shop:cart' },
    { text: '« Назад', callback_data: `shop:cat:${prod.brand_id}:${prod.category_id}` },
  ]);

  if (prod.photo) {
    return tg('sendPhoto', {
      chat_id: chatId,
      photo: prod.photo,
      caption: text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: kb },
    });
  }
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
}

// ──── Додати до кошика ────
async function addToCart(tg, chatId, userId, variantId) {
  const r = await db.query(`
    SELECT pv.id, pv.volume, pv.price, p.name as product_name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.id = $1
  `, [variantId]);
  const v = r.rows[0];
  if (!v) return tg('answerCallbackQuery', { callback_query_id: null, text: 'Товар не знайдено' });

  if (!carts.has(userId)) carts.set(userId, []);
  const cart = carts.get(userId);
  const existing = cart.find(i => i.variantId === variantId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      variantId,
      productName: v.product_name,
      volume: v.volume,
      price: Number(v.price),
      qty: 1,
    });
  }

  const totalItems = cart.reduce((s, i) => s + i.qty, 0);
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `✅ <b>${v.product_name}</b>${v.volume ? ' (' + v.volume + ')' : ''} додано до кошика!\n\n🛒 У кошику: ${totalItems} товар(ів)`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛒 Переглянути кошик', callback_data: 'shop:cart' }],
        [{ text: '🛍 Продовжити покупки', callback_data: 'shop:main' }],
      ],
    },
  });
}

// ──── Кошик ────
async function showCart(tg, chatId, userId) {
  const cart = carts.get(userId) || [];
  if (!cart.length) {
    return tg('sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      text: '🛒 Кошик порожній.\n\nДодайте товари з каталогу!',
      reply_markup: {
        inline_keyboard: [[{ text: '🛍 До каталогу', callback_data: 'shop:main' }]],
      },
    });
  }

  let text = '<b>🛒 Ваш кошик:</b>\n\n';
  let total = 0;
  cart.forEach((item, i) => {
    const sum = item.price * item.qty;
    total += sum;
    text += `${i + 1}. <b>${item.productName}</b>`;
    if (item.volume) text += ` (${item.volume})`;
    text += `\n   ${item.qty} × ${Math.round(item.price)} = <b>${Math.round(sum)} грн</b>\n\n`;
  });
  text += `💰 <b>Разом: ${Math.round(total)} грн</b>`;

  const kb = cart.map((item, i) => [{
    text: `❌ Видалити: ${item.productName}${item.volume ? ' ' + item.volume : ''}`,
    callback_data: `shop:del:${i}`,
  }]);
  kb.push([{ text: '🗑 Очистити кошик', callback_data: 'shop:clear' }]);
  kb.push([{ text: '💳 Оформити замовлення', callback_data: 'shop:checkout' }]);
  kb.push([{ text: '🛍 Продовжити покупки', callback_data: 'shop:main' }]);

  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: kb },
  });
}

// ──── Видалити з кошика ────
function removeFromCart(tg, chatId, userId, index) {
  const cart = carts.get(userId) || [];
  if (index >= 0 && index < cart.length) {
    cart.splice(index, 1);
  }
  return showCart(tg, chatId, userId);
}

// ──── Очистити кошик ────
function clearCart(tg, chatId, userId) {
  carts.delete(userId);
  return tg('sendMessage', {
    chat_id: chatId,
    text: '🗑 Кошик очищено.',
    reply_markup: {
      inline_keyboard: [[{ text: '🛍 До каталогу', callback_data: 'shop:main' }]],
    },
  });
}

// ──── Оформлення замовлення — Telegram Payments ────
async function checkout(tg, chatId, userId, userPhone) {
  const cart = carts.get(userId) || [];
  if (!cart.length) {
    return tg('sendMessage', { chat_id: chatId, text: 'Кошик порожній.' });
  }

  const providerToken = process.env.PAYMENT_PROVIDER_TOKEN;
  if (!providerToken) {
    // Fallback: без платіжного провайдера — просте підтвердження
    return checkoutFallback(tg, chatId, userId, userPhone);
  }

  // Формуємо prices для Telegram (в копійках — UAH × 100)
  const prices = cart.map(item => ({
    label: `${item.productName}${item.volume ? ' (' + item.volume + ')' : ''} × ${item.qty}`,
    amount: Math.round(item.price * item.qty * 100),
  }));

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const description = cart.map(i =>
    `${i.productName}${i.volume ? ' ' + i.volume : ''} × ${i.qty}`
  ).join(', ');

  // Зберігаємо userId → cart для обробки successful_payment
  pendingPayments.set(userId, { cart: [...cart], userPhone });

  return tg('sendInvoice', {
    chat_id: chatId,
    title: 'Замовлення SVS Beauty World',
    description: description.length > 255 ? description.slice(0, 252) + '...' : description,
    payload: `order_${userId}_${Date.now()}`,
    provider_token: providerToken,
    currency: 'UAH',
    prices,
    need_phone_number: !userPhone,
    need_shipping_address: false,
    is_flexible: false,
    start_parameter: 'shop',
  });
}

// Fallback без платіжної системи
async function checkoutFallback(tg, chatId, userId, userPhone) {
  const cart = carts.get(userId) || [];
  let total = 0;
  let itemsText = '';
  cart.forEach((item, i) => {
    const sum = item.price * item.qty;
    total += sum;
    itemsText += `${i + 1}. ${item.productName}${item.volume ? ' (' + item.volume + ')' : ''} × ${item.qty} = ${Math.round(sum)} грн\n`;
  });
  return tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `<b>📋 Ваше замовлення:</b>\n\n${itemsText}\n💰 <b>Разом: ${Math.round(total)} грн</b>\n\n` +
      `Підтвердіть замовлення:`,
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Підтвердити', callback_data: 'shop:confirm' }],
        [{ text: '« Назад до кошика', callback_data: 'shop:cart' }],
      ],
    },
  });
}

// Pending payments: userId → { cart, userPhone }
const pendingPayments = new Map();

// ──── pre_checkout_query — Telegram вимагає відповідь за 10 сек ────
async function handlePreCheckout(tg, query) {
  return tg('answerPreCheckoutQuery', {
    pre_checkout_query_id: query.id,
    ok: true,
  });
}

// ──── successful_payment — оплата пройшла ────
async function handleSuccessfulPayment(tg, msg, adminChatId, savedPhone) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const payment = msg.successful_payment;
  const pending = pendingPayments.get(userId);
  const cart = pending?.cart || carts.get(userId) || [];
  const userPhone = payment.order_info?.phone_number || pending?.userPhone || savedPhone || null;

  let total = payment.total_amount / 100;
  let itemsText = '';
  cart.forEach((item, i) => {
    const sum = item.price * item.qty;
    itemsText += `${i + 1}. ${item.productName}${item.volume ? ' (' + item.volume + ')' : ''} × ${item.qty} = ${Math.round(sum)} грн\n`;
  });

  // Повідомлення клієнту
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `✅ <b>Оплата пройшла успішно!</b>\n\n` +
      itemsText +
      `\n💰 Сплачено: <b>${Math.round(total)} грн</b>\n\n` +
      `Дякуємо за покупку! Адміністратор зв'яжеться з вами щодо доставки.\n\n` +
      `📞 +380991283375`,
  });

  // Повідомлення адміну
  if (adminChatId) {
    const phoneInfo = userPhone || 'не вказано';
    await tg('sendMessage', {
      chat_id: adminChatId,
      parse_mode: 'HTML',
      text:
        `💳 <b>Нова оплата!</b>\n\n` +
        `👤 ${msg.from.first_name || ''}${msg.from.last_name ? ' ' + msg.from.last_name : ''}${msg.from.username ? ' (@' + msg.from.username + ')' : ''}\n` +
        `📞 Телефон: ${phoneInfo}\n` +
        `💰 Сума: <b>${Math.round(total)} грн</b>\n` +
        `🧾 ID: <code>${payment.telegram_payment_charge_id}</code>\n\n` +
        itemsText,
    });
  }

  // Очищаємо
  carts.delete(userId);
  pendingPayments.delete(userId);
}

// ──── Підтвердження замовлення (fallback без оплати) ────
async function confirmOrder(tg, chatId, userId, userPhone, adminChatId) {
  const cart = carts.get(userId) || [];
  if (!cart.length) return;

  let total = 0;
  let itemsText = '';
  cart.forEach((item, i) => {
    const sum = item.price * item.qty;
    total += sum;
    itemsText += `${i + 1}. ${item.productName}${item.volume ? ' (' + item.volume + ')' : ''} × ${item.qty} = ${Math.round(sum)} грн\n`;
  });

  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      `✅ <b>Замовлення прийнято!</b>\n\n` +
      itemsText +
      `\n💰 Разом: <b>${Math.round(total)} грн</b>\n\n` +
      `Адміністратор зв'яжеться з вами для уточнення деталей доставки та оплати.\n📞 +380991283375`,
  });

  if (adminChatId) {
    await tg('sendMessage', {
      chat_id: adminChatId,
      parse_mode: 'HTML',
      text:
        `🛒 <b>Нове замовлення (без оплати)!</b>\n\n` +
        `👤 User ID: ${userId}\n` +
        (userPhone ? `📞 Телефон: ${userPhone}\n` : '') +
        `\n${itemsText}\n💰 Разом: <b>${Math.round(total)} грн</b>`,
    });
  }

  carts.delete(userId);
}

// ──── Роутер callback_data ────
async function handleCallback(tg, chatId, userId, data, userPhone, adminChatId) {
  if (data === 'shop:main') return showShopMain(tg, chatId);
  if (data === 'shop:cart') return showCart(tg, chatId, userId);
  if (data === 'shop:clear') return clearCart(tg, chatId, userId);
  if (data === 'shop:checkout') return checkout(tg, chatId, userId, userPhone);
  if (data === 'shop:confirm') return confirmOrder(tg, chatId, userId, userPhone, adminChatId);

  if (data.startsWith('shop:brand:')) {
    return showBrandCategories(tg, chatId, data.slice(11));
  }
  if (data.startsWith('shop:cat:')) {
    const parts = data.slice(9).split(':');
    const [brandId, categoryId, page] = parts;
    return showCategoryProducts(tg, chatId, brandId, categoryId, parseInt(page) || 0);
  }
  if (data.startsWith('shop:prod:')) {
    return showProduct(tg, chatId, data.slice(10));
  }
  if (data.startsWith('shop:add:')) {
    return addToCart(tg, chatId, userId, parseInt(data.slice(9)));
  }
  if (data.startsWith('shop:del:')) {
    return removeFromCart(tg, chatId, userId, parseInt(data.slice(9)));
  }
  return null;
}

module.exports = { handleCallback, showShopMain, handlePreCheckout, handleSuccessfulPayment };
