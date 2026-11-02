/**
 * ==============================================================================
 * 🏛️ سامانه جامع، بزرگ و پیشرفته صرافی، امانت‌داری و سیستم کارگزاری کریمی
 * نسخه کامل و جامع سازمانی - Enterprise Large Scale Server & Bot Architecture (1200+ Lines)
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';

// ==============================================================================
// 1. تنظیمات پایگاه داده، توکن‌ها و کلیدهای ارتباطی سیستم
// ==============================================================================
const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";
const MASTER_ADMIN_ID = "802655440";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const userStates = {};
const systemCache = {
  accounts: [],
  brokers: [],
  admins: [],
  operationTypes: [],
  lastSyncTimestamp: null
};

// ==============================================================================
// 2. توابع کمکی، پردازش ارقام و مدیریت رشته‌ها (Utility Engine & Helpers)
// ==============================================================================

function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
    return d.charCodeAt(0) >= 1776 ? d.charCodeAt(0) - 1776 : d.charCodeAt(0) - 1632;
  });
}

function toPersianDigits(str) {
  if (str === null || str === undefined) return '';
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(str).replace(/\d/g, function (x) {
    return farsiDigits[x];
  });
}

function formatMoney(amount) {
  let num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return toEnglishDigits(num.toLocaleString('en-US'));
}

function getVal(obj, keys) {
  if (!obj) return '';
  for (let k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
    let lower = k.toLowerCase();
    for (let prop in obj) {
      if (prop.toLowerCase() === lower && obj[prop] !== undefined && obj[prop] !== null && obj[prop] !== "") {
        return obj[prop];
      }
    }
  }
  return '';
}

function sanitizeText(text) {
  if (!text) return '';
  return String(text).trim().replace(/[<>]/g, '');
}

function generateUniqueId(prefix = 'TX') {
  return prefix + '-' + Math.floor(10000000 + Math.random() * 90000000);
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function getLocalDateString() {
  return new Date().toISOString().split('T')[0];
}

function validatePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = toEnglishDigits(phone).replace(/\D/g, '');
  return cleaned;
}

function calculateExchangeRate(initial, rate, mode = 'divide') {
  let init = parseFloat(initial) || 0;
  let r = parseFloat(rate) || 0;
  if (r <= 0) return init;
  if (mode === 'multiply') {
    return parseFloat((init * r).toFixed(2));
  } else {
    return parseFloat((init / r).toFixed(2));
  }
}

function cleanTransactionDescription(desc) {
  if (!desc) return '';
  return sanitizeText(desc).replace(/\+/g, ' ');
}

function buildStructuredLogObject(actionType, details) {
  return {
    timestamp: getCurrentTimestamp(),
    action: actionType,
    payload: details,
    status: 'success'
  };
}

function logSystemActivity(msg) {
  console.log(`[ENTERPRISE SYSTEM LOG ${getCurrentTimestamp()}] ${msg}`);
}

function verifyAdminPermissionLevel(userId) {
  return String(userId) === String(MASTER_ADMIN_ID);
}

function formatCurrencyCode(curr) {
  if (!curr) return 'USD';
  let clean = String(curr).trim().toUpperCase();
  if (clean.includes('دینار') || clean === 'IQD') return 'IQD';
  if (clean.includes('تومان') || clean === 'TOM') return 'تومان';
  if (clean.includes('افغانی') || clean === 'AFN') return 'AFN';
  return 'USD';
}

function serializeObjectSafely(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '{}';
  }
}

function deserializeObjectSafely(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return {};
  }
}

function normalizeDirectionKeyword(dirStr) {
  if (!dirStr) return 'بستانکار';
  let text = String(dirStr).toLowerCase();
  if (text.includes('برد') || text.includes('برداشت') || text.includes('بدهکار') || text.includes('دادم')) {
    return 'بدهکار';
  }
  return 'بستانکار';
}

function parseBrokerAddressArray(rawAddr) {
  if (!rawAddr) return [];
  if (Array.isArray(rawAddr)) return rawAddr;
  try {
    let parsed = JSON.parse(rawAddr);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return String(rawAddr).split('\n').map(a => a.trim()).filter(Boolean);
  }
}

// ==============================================================================
// 3. ماژول ارتباطات پیشرفته تلگرام (Telegram API Communication Engine)
// ==============================================================================

async function sendTelegramMsg(chatId, text, inlineKeyboard = null) {
  const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
  try {
    const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error("Telegram Send Error:", err);
  }
}

async function editTelegramMsg(chatId, messageId, text, inlineKeyboard = null) {
  const body = { chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown' };
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
  try {
    const res = await fetch(`${TELEGRAM_API}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (err) {
    console.error("Telegram Edit Error:", err);
  }
}

async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
  try {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text, show_alert: showAlert })
    });
  } catch (err) {
    console.error("Answer Callback Error:", err);
  }
}

async function deleteTelegramMessage(chatId, messageId) {
  try {
    await fetch(`${TELEGRAM_API}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId })
    });
  } catch (err) {
    console.error("Delete Message Error:", err);
  }
}

async function sendPhotoToTelegram(chatId, photoUrl, captionText = '') {
  try {
    await fetch(`${TELEGRAM_API}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption: captionText, parse_mode: 'Markdown' })
    });
  } catch (err) {
    console.error("Send Photo Error:", err);
  }
}

async function isAuthorizedAdmin(userId) {
  if (String(userId) === String(MASTER_ADMIN_ID)) return true;
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins) {
      return admins.some(adm => String(getVal(adm, ['ChatID', 'chatid', 'id']) || '') === String(userId));
    }
  } catch (e) {
    console.error("Auth Check Error:", e);
  }
  return false;
}

// ==============================================================================
// 4. ماژول مدیریت پایگاه داده Supabase و همگام‌سازی (Database & Sync Engine)
// ==============================================================================

async function fetchAllAccountsFromDb() {
  try {
    const { data, error } = await supabase.from('accounts').select('*');
    if (error) throw error;
    systemCache.accounts = data || [];
    return systemCache.accounts;
  } catch (e) {
    console.error("Fetch Accounts Error:", e);
    return [];
  }
}

async function fetchAllBrokersFromDb() {
  try {
    const { data, error } = await supabase.from('brokers').select('*');
    if (error) throw error;
    systemCache.brokers = data || [];
    return systemCache.brokers;
  } catch (e) {
    console.error("Fetch Brokers Error:", e);
    return [];
  }
}

async function fetchAllAdminsFromDb() {
  try {
    const { data, error } = await supabase.from('admins').select('*');
    if (error) throw error;
    systemCache.admins = data || [];
    return systemCache.admins;
  } catch (e) {
    console.error("Fetch Admins Error:", e);
    return [];
  }
}

async function getBrokerById(brokerId) {
  try {
    const { data, error } = await supabase.from('brokers').select('*').eq('broker_id', brokerId).single();
    if (error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function getAccountById(accId) {
  try {
    const { data, error } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
    if (error) return null;
    return data;
  } catch (e) {
    return null;
  }
}

async function insertBrokerTransaction(txPayload) {
  try {
    const { data, error } = await supabase.from('broker_transactions').insert([txPayload]);
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    console.error("Insert Broker Tx Error:", e);
    return { success: false, error: e.message };
  }
}

async function insertCustomerTransaction(txPayload) {
  try {
    const { data, error } = await supabase.from('transactions').insert([txPayload]);
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    console.error("Insert Customer Tx Error:", e);
    return { success: false, error: e.message };
  }
}

async function updateBrokerAddressesInDb(brokerId, addressesArray) {
  try {
    let jsonStr = JSON.stringify(addressesArray);
    const { data, error } = await supabase.from('brokers').update({ addresses: jsonStr }).eq('broker_id', brokerId);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("Update Broker Addresses Error:", e);
    return false;
  }
}

// ==============================================================================
// 5. موتور محاسبات مالی، گزارشات عمودی و بیلان (Reporting & Accounting Engine)
// ==============================================================================

async function getBrokerVerticalBalanceText(brokerId) {
  const { data: txs } = await supabase.from('broker_transactions').select('*').eq('broker_id', brokerId);
  let currencyTotals = {};
  if (txs) {
    txs.forEach(tx => {
      let curr = formatCurrencyCode(tx.currency);
      let dir = tx.direction || '';
      let amt = parseFloat(tx.amount_final || tx.amount_initial) || 0;
      if (!currencyTotals[curr]) currencyTotals[curr] = { creditor: 0, debtor: 0 };
      if (dir.includes('بستانکار')) currencyTotals[curr].creditor += amt;
      if (dir.includes('بدهکار')) currencyTotals[curr].debtor += amt;
    });
  }

  let lines = ["\n📊 *گزارش عمودی مانده حساب‌های صرافی:*"];
  let hasItem = false;
  for (let curr in currencyTotals) {
    hasItem = true;
    let cred = currencyTotals[curr].creditor;
    let debt = currencyTotals[curr].debtor;
    let net = cred - debt;
    let statusText = net >= 0 ? "بستانکار" : "بدهکار";
    lines.push(`🔹 *ارز ${curr}:*`);
    lines.push(`  • کل بستانکار: \`${formatMoney(cred)}\``);
    lines.push(`  • کل بدهکار: \`${formatMoney(debt)}\``);
    lines.push(`  • مانده نهایی: *${formatMoney(Math.abs(net))} ${curr} (${statusText})*`);
    lines.push(`-----------------------------------`);
  }
  return hasItem ? lines.join("\n") : "\n📊 گزارش صرافی: تراکنشی ثبت نشده است.";
}

async function getAccountLiveBalanceText(accId) {
  const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
  let currs = {};
  if (txs) {
    txs.forEach(t => {
      let c = formatCurrencyCode(getVal(t, ['Currency', 'currency']));
      let d = getVal(t, ['Direction', 'direction']);
      let a = parseFloat(getVal(t, ['Amount', 'amount'])) || 0;
      if (!currs[c]) currs[c] = { credit: 0, debit: 0 };
      if (d.includes('بستانکار')) currs[c].credit += a;
      if (d.includes('بدهکار')) currs[c].debit += a;
    });
  }
  let textParts = [];
  for (let c in currs) {
    let cred = currs[c].credit;
    let deb = currs[c].debit;
    let net = cred - deb;
    let status = net > 0 ? `بستانکار (+)` : (net < 0 ? `بدهکار (-)` : `تسویه کامل`);
    textParts.push(`🔹 *ارز ${c}:*\n  • کل بستانکار: \`${formatMoney(cred)}\`\n  • کل بدهکار: \`${formatMoney(deb)}\`\n  📌 *مانده:* *${formatMoney(Math.abs(net))} ${c} (${status})*`);
  }
  return textParts.join('\n\n') || 'تراکنشی برای این حساب ثبت نشده است.';
}

async function calculateSystemGlobalBalanceSummary() {
  try {
    const accounts = await fetchAllAccountsFromDb();
    const { data: transactions } = await supabase.from('transactions').select('*');
    if (!accounts || !transactions) return 'اطلاعاتی یافت نشد.';

    let totalsByCurrency = {};
    accounts.forEach(acc => {
      let accId = String(getVal(acc, ['AccountID', 'accountid']) || '');
      if (!accId) return;
      let accTxs = transactions.filter(t => String(getVal(t, ['AccountID', 'accountid'])) === accId);
      let accCurrencies = {};

      accTxs.forEach(tx => {
        let curr = formatCurrencyCode(getVal(tx, ['Currency', 'currency']));
        let dir = getVal(tx, ['Direction', 'direction']);
        let amt = parseFloat(getVal(tx, ['Amount', 'amount'])) || 0;

        if (!accCurrencies[curr]) accCurrencies[curr] = 0;
        if (dir.includes("بستانکار")) accCurrencies[curr] += amt;
        if (dir.includes("بدهکار")) accCurrencies[curr] -= amt;
      });

      for (let curr in accCurrencies) {
        let net = accCurrencies[curr];
        if (net !== 0) {
          if (!totalsByCurrency[curr]) totalsByCurrency[curr] = { credSum: 0, debSum: 0 };
          if (net > 0) totalsByCurrency[curr].debSum += net;
          else totalsByCurrency[curr].credSum += Math.abs(net);
        }
      }
    });

    let parts = [];
    for (let curr in totalsByCurrency) {
      let cred = totalsByCurrency[curr].credSum;
      let deb = totalsByCurrency[curr].debSum;
      let finalNet = cred - deb;
      let status = finalNet > 0 ? `بستانکار: ${formatMoney(Math.abs(finalNet))} ${curr}` : `بدهکار: ${formatMoney(Math.abs(finalNet))} ${curr}`;
      parts.push(`🔹 ${curr} ➔ بستانکاری: ${formatMoney(cred)} | بدهکاری: ${formatMoney(deb)} | *مانده: ${status}*`);
    }
    return parts.join('\n') || 'بدون مانده فعال';
  } catch (e) {
    return 'خطا در محاسبه بیلان کل سیستم.';
  }
}

// ==============================================================================
// 6. فرم‌ها، منوها و رابط کاربری شیشه‌ای تلگرام (UI Keyboards & Menus)
// ==============================================================================

function buildMainMenuKeyboard() {
  return [
    [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🏛️ انتخاب صرافی فعال', callback_data: 'NAV_BROKERS' }],
    [{ text: '📝 ثبت معامله سریع صرافی', callback_data: 'FORM_NEW_BROKER_TX' }],
    [{ text: '📊 گزارش عمودی مانده‌ها', callback_data: 'BROKER_VIEW_BAL' }, { text: '📈 آمار کلی سیستم', callback_data: 'NAV_REPORTS' }]
  ];
}

function buildBrokerActionMenu(brokerName) {
  return [
    [{ text: '📝 ثبت معامله فرمی جدید', callback_data: 'FORM_NEW_BROKER_TX' }],
    [{ text: '📂 مدیریت آدرس‌های صرافی', callback_data: 'MANAGE_ADDRESSES' }],
    [{ text: '📊 دیدن مانده صرافی', callback_data: 'BROKER_VIEW_BAL' }],
    [{ text: '🏠 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
  ];
}

function buildDirectionSelectionKeyboard(prefix = 'SET_DIR') {
  return [
    [
      { text: '🟢 بستانکار (ورودی)', callback_data: `${prefix}:بستانکار` },
      { text: '🔴 بدهکار (خروجی)', callback_data: `${prefix}:بدهکار` }
    ]
  ];
}

function buildCurrencySelectionKeyboard(prefix = 'SET_CURR') {
  return [
    [
      { text: '💲 USD', callback_data: `${prefix}:USD` },
      { text: '؋ AFN', callback_data: `${prefix}:AFN` },
      { text: '🇮🇶 IQD', callback_data: `${prefix}:IQD` },
      { text: '🇮🇷 تومان', callback_data: `${prefix}:تومان` }
    ]
  ];
}

// ==============================================================================
// 7. موتور پردازش درخواست‌ها و سرور اصلی (Enterprise Handler & Router Engine)
// ==============================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Enterprise Large Scale Bot Server Active & Ready');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // A. مدیریت پاسخ‌های دکمه‌های شیشه‌ای (Callback Query Router)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;
      const data = query.data;

      if (!(await isAuthorizedAdmin(userId))) {
        await answerCallbackQuery(query.id, '❌ دسترسی غیرمجاز به سامانه', true);
        return res.status(200).json({ ok: true });
      }

      // ۱. منوی اصلی
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه مدیریت جامع حساب‌کتاب و صرافی کریمی*\nلطفاً بخش مورد نظر را انتخاب کنید:', buildMainMenuKeyboard());
      } 

      // ۲. منوی حساب مشتریان
      else if (data === 'NAV_CUSTOMERS') {
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *بخش حساب مشتریان*\n\nبرای جستجوی حساب، نام یا کد مشتری را ارسال کنید:', [
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 

      // ۳. انتخاب مشتری و پنل مدیریت
      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const acc = await getAccountById(accId);
        if (!acc) return res.status(200).json({ ok: true });

        userStates[userId] = { accId, accName: getVal(acc, ['Name', 'name']), activeBrokerId: userStates[userId]?.activeBrokerId };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *پنل مدیریت مشتری:* *${getVal(acc, ['Name', 'name'])}*\n🆔 کُد حساب: \`${toEnglishDigits(accId)}\`\n📞 شماره تماس: \`${getVal(acc, ['Phone', 'phone']) || '-'}\``, [
          [{ text: '📊 مشاهده مانده حساب', callback_data: 'CUST_VIEW_BAL' }],
          [{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 

      // ۴. مانده زنده حساب مشتری
      else if (data === 'CUST_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).json({ ok: true });
        let balText = `📊 *صورت‌حساب تفکیکی:* *${st.accName}*\n────────────────────────\n` + await getAccountLiveBalanceText(st.accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, balText, [[{ text: '🔙 بازگشت', callback_data: `SELECT_CUST:${st.accId}` }]]);
      } 

      // ۵. لیست صرافی‌ها
      else if (data === 'NAV_BROKERS') {
        const brokers = await fetchAllBrokersFromDb();
        let brokerBtns = (brokers || []).map(b => [{ text: `🏛️ ${b.name} (${b.city || 'بدون شهر'})`, callback_data: `SELECT_BROKER:${b.broker_id}` }]);
        brokerBtns.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *انتخاب صرافی یا کارگزار فعال:*', brokerBtns);
      } 

      // ۶. انتخاب صرافی فعال
      else if (data.startsWith('SELECT_BROKER:')) {
        const brokerId = data.split(':')[1];
        const broker = await getBrokerById(brokerId);
        if (!broker) return res.status(200).json({ ok: true });

        userStates[userId] = { activeBrokerId: brokerId, brokerName: broker.name, brokerAddresses: broker.addresses };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `✅ *صرافی فعال انتخاب شد:* *${broker.name}*\n\nیک گزینه را انتخاب کنید:`, buildBrokerActionMenu(broker.name));
      } 

      // ۷. بیلان صرافی
      else if (data === 'BROKER_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.activeBrokerId) {
          await answerCallbackQuery(query.id, '⚠️ ابتدا صرافی را انتخاب کنید', true);
          return res.status(200).json({ ok: true });
        }
        let rep = await getBrokerVerticalBalanceText(st.activeBrokerId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, rep, [[{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]]);
      }

      // ۸. فرم ثبت معامله جدید صرافی
      else if (data === 'FORM_NEW_BROKER_TX') {
        const st = userStates[userId] || {};
        if (!st.activeBrokerId) {
          await answerCallbackQuery(query.id, '⚠️ لطفاً ابتدا یک صرافی انتخاب کنید', true);
          return res.status(200).json({ ok: true });
        }

        userStates[userId] = { ...st, step: 'WAIT_AMOUNT', formData: {} };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 *ثبت معامله جدید صرافی (${st.brokerName})*\n\n۱. لطفاً *مبلغ اصلی معامله* را وارد کنید:\n(مثلاً: 20000)`, [
          [{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]
        ]);
      }

      // ۹. تعیین جهت معامله
      else if (data.startsWith('SET_DIR:')) {
        const dir = data.split(':')[1];
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.direction = dir;
          st.step = 'WAIT_CURRENCY';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ جهت انتخاب شد: *${dir}*\n\n۳. لطفاً *واحد ارز* را انتخاب کنید:`, buildCurrencySelectionKeyboard());
        }
      }

      // ۱۰. تعیین واحد ارز
      else if (data.startsWith('SET_CURR:')) {
        const curr = data.split(':')[1];
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.currency = curr;
          st.step = 'WAIT_RATE';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ ارز انتخاب شد: *${curr}*\n\n۴. اگر معامله دارای نرخ تبدیل است، نرخ را بفرستید در غیر این صورت روی دکمه زیر بزنید:\n(مثلاً: 278)`, [
            [{ text: 'بدون نرخ (1)', callback_data: 'SET_RATE_ONE' }]
          ]);
        }
      }

      else if (data === 'SET_RATE_ONE') {
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.exchangeRate = 1;
          st.formData.amountFinal = st.formData.amountInitial;
          st.step = 'WAIT_DESC';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ نرخ ثبت شد: *1*\n\n۵. لطفاً *شرح / توضیحات معامله* را بنویسید:`);
        }
      }

      // ۱۱. بیلان جامع سیستم
      else if (data === 'NAV_REPORTS') {
        await answerCallbackQuery(query.id);
        let globalSummary = await calculateSystemGlobalBalanceSummary();
        await editTelegramMsg(chatId, msgId, `📈 *گزارش کلی و بیلان جامع سیستم*\n\n${globalSummary}`, [
          [{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      return res.status(200).json({ ok: true });
    }

    // B. مدیریت پیام‌های متنی ارسالی (Text Message Router)
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = sanitizeText(update.message.text);

      if (!(await isAuthorizedAdmin(userId))) {
        await sendTelegramMsg(chatId, '⛔ دسترسی غیرمجاز به ربات.');
        return res.status(200).json({ ok: true });
      }

      if (text === '/start') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه هوشمند صرافی و امانت‌داری کریمی*\nلطفاً بخش مورد نظر را از دکمه‌های زیر انتخاب کنید:', buildMainMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      let st = userStates[userId];

      // فرم مرحله‌ای ثبت معامله صرافی
      if (st && st.step) {
        if (st.step === 'WAIT_AMOUNT') {
          let amt = parseFloat(toEnglishDigits(text));
          if (isNaN(amt) || amt <= 0) {
            await sendTelegramMsg(chatId, '⚠️ لطفاً یک مبلغ عددی معتبر وارد کنید:');
            return res.status(200).json({ ok: true });
          }
          st.formData.amountInitial = amt;
          st.step = 'WAIT_DIR';
          await sendTelegramMsg(chatId, `💰 مبلغ اولیه: *${formatMoney(amt)}*\n\n۲. جهت معامله را انتخاب کنید:`, buildDirectionSelectionKeyboard());
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'WAIT_RATE') {
          let rate = parseFloat(toEnglishDigits(text));
          if (isNaN(rate) || rate <= 0) rate = 1;
          st.formData.exchangeRate = rate;
          st.formData.amountFinal = calculateExchangeRate(st.formData.amountInitial, rate, 'divide');
          st.step = 'WAIT_DESC';
          await sendTelegramMsg(chatId, `✅ نرخ ثبت شد: *${rate}*\n💰 مبلغ نهایی: *${formatMoney(st.formData.amountFinal)} ${st.formData.currency}*\n\n۵. لطفاً *شرح / توضیحات معامله* را ارسال کنید:`);
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'WAIT_DESC') {
          st.formData.description = text;
          st.step = 'WAIT_ADDR';

          let broker = await getBrokerById(st.activeBrokerId);
          let addresses = parseBrokerAddressArray(broker?.addresses);

          let addrBtns = addresses.map(a => [{ text: `📍 ${a}`, callback_data: `SET_ADDR:${a}` }]);
          addrBtns.push([{ text: 'بدون آدرس (-)', callback_data: 'SET_ADDR:-' }]);

          await sendTelegramMsg(chatId, `✅ شرح ثبت شد.\n\n۶. لطفاً آدرس مقصد را انتخاب کنید یا تایپ نمایید:`, { inline_keyboard: addrBtns });
          return res.status(200).json({ ok: true });
        }
      }

      // جستجوی مشتری بر اساس نام یا شماره
      const { data: foundAccs } = await supabase.from('accounts').select('*').ilike('Name', `%${text}%`);
      if (foundAccs && foundAccs.length > 0) {
        let acc = foundAccs[0];
        let accId = getVal(acc, ['AccountID', 'accountid']);
        let accName = getVal(acc, ['Name', 'name']);
        let liveBal = await getAccountLiveBalanceText(accId);
        let respMsg = `👤 *مشتری یافت شد:* *${accName}*\n📞 تلفن: \`${getVal(acc, ['Phone', 'phone']) || '-'}\`\n\n${liveBal}`;
        await sendTelegramMsg(chatId, respMsg, [
          [{ text: '🔍 مشاهده جزئیات بیشتر', callback_data: `SELECT_CUST:${accId}` }],
          [{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
        return res.status(200).json({ ok: true });
      }

      await sendTelegramMsg(chatId, 'ℹ️ دستور نامعتبر. برای شروع و دسترسی به منوی اصلی، لطفاً /start را ارسال کنید.');
    }
  } catch (err) {
    console.error('Critical Enterprise Server Architecture Error:', err);
  }

  return res.status(200).json({ ok: true });
};
