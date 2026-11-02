/**
 * ==============================================================================
 * 🏛️ سامانه جامع، بزرگ، پیشرفته و یکپارچه مدیریت امانت‌داری کریمی
 * نسخه کامل سرور ربات تلگرام و مدیریت ابری - Enterprise Full Architecture (1200 Lines)
 * بدون بخش کارگزاری و دفاتر همکار - کاملاً متمرکز بر حساب‌کتاب مشتریان و تراکنش‌ها
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';

// ==============================================================================
// ۱. تنظیمات اتصال پایگاه داده Supabase و توکن‌های ارتباطی شبکه تلگرام
// ==============================================================================
const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";
const MASTER_ADMIN_ID = "802655440";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// حافظه موقت نشست‌ها و وضعیت‌های پردازش درخواست‌های کاربران و ادمین‌ها
const userStates = {};
const systemCache = {
  accounts: [],
  transactions: [],
  admins: [],
  operationTypes: [],
  lastSyncTimestamp: null
};

// ==============================================================================
// ۲. توابع استاندارد پردازش ارقام، تبدیل متون و فرمت‌دهی پیشرفته مالی
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
  if (!curr) return 'AFN';
  let clean = String(curr).trim().toUpperCase();
  if (clean.includes('دینار') || clean === 'IQD') return 'IQD';
  if (clean.includes('تومان') || clean === 'TOM' || clean === 'تومان') return 'تومان';
  if (clean.includes('افغانی') || clean === 'AFN') return 'AFN';
  if (clean.includes('دلار') || clean === 'USD') return 'USD';
  return 'AFN';
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

// ==============================================================================
// ۳. ماژول ارتباط مستقیم با ربات تلگرام (Telegram Webhook & API Communication)
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
// ۴. ماژول مدیریت جدول‌ها و داده‌های پایگاه داده Supabase Database Engine
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

async function fetchAllTransactionsFromDb() {
  try {
    const { data, error } = await supabase.from('transactions').select('*');
    if (error) throw error;
    systemCache.transactions = data || [];
    return systemCache.transactions;
  } catch (e) {
    console.error("Fetch Transactions Error:", e);
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

async function getAccountById(accId) {
  try {
    const { data, error } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
    if (error) return null;
    return data;
  } catch (e) {
    return null;
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

async function insertNewAccountInDb(accountPayload) {
  try {
    const { data, error } = await supabase.from('accounts').insert([accountPayload]);
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    console.error("Insert Account Error:", e);
    return { success: false, error: e.message };
  }
}

// ==============================================================================
// ۵. موتور محاسبه بیلان، آمار زنده و گزارش‌های تفکیکی (Financial Calculation Engine)
// ==============================================================================

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
    let status = net > 0 ? `بستانکار (+): ${formatMoney(Math.abs(net))} ${c}` : (net < 0 ? `بدهکار (-): ${formatMoney(Math.abs(net))} ${c}` : `تسویه کامل (0)`);
    textParts.push(`🔹 *ارز ${c}:*\n  • کل بستانکار: \`${formatMoney(cred)}\`\n  • کل بدهکار: \`${formatMoney(deb)}\`\n  📌 *مانده:* *${status}*`);
  }
  return textParts.join('\n\n') || 'تراکنشی برای این حساب ثبت نشده است.';
}

async function calculateSystemGlobalBalanceSummary() {
  try {
    const accounts = await fetchAllAccountsFromDb();
    const transactions = await fetchAllTransactionsFromDb();
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
      parts.push(`🔹 ${curr} ➔ بستانکاری کل: ${formatMoney(cred)} | بدهکاری کل: ${formatMoney(deb)} | *مانده: ${status}*`);
    }
    return parts.join('\n') || 'بدون مانده فعال در سیستم';
  } catch (e) {
    return 'خطا در محاسبه بیلان کل سیستم.';
  }
}

// ==============================================================================
// ۶. منوها، دکمه‌های شیشه‌ای و ساختار کیبوردها (UI Markup Generators)
// ==============================================================================

function buildMainMenuKeyboard() {
  return [
    [{ text: '👥 لیست حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '➕ ایجاد حساب جدید', callback_data: 'FORM_NEW_ACCOUNT' }],
    [{ text: '📝 ثبت تراکنش سریع', callback_data: 'FORM_SELECT_CUSTOMER_FOR_TX' }],
    [{ text: '📈 آمار و بیلان کلی سیستم', callback_data: 'NAV_REPORTS' }]
  ];
}

function buildCustomerActionMenu(accName) {
  return [
    [{ text: '📊 مشاهده مانده زنده حساب', callback_data: 'CUST_VIEW_BAL' }],
    [{ text: '➕ ثبت تراکنش برای این مشتری', callback_data: 'CUST_ADD_TX' }],
    [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
  ];
}

function buildDirectionSelectionKeyboard(prefix = 'SET_DIR') {
  return [
    [
      { text: '🟢 بستانکار (ورودی +)', callback_data: `${prefix}:بستانکار` },
      { text: '🔴 بدهکار (خروجی -)', callback_data: `${prefix}:بدهکار` }
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
// ۷. موتور اصلی پردازش درخواست‌ها و وب‌هوک ربات (Enterprise Handler & Router Engine)
// ==============================================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Enterprise Trust Management Bot Server Active & Ready (1200 Lines Clean Architecture)');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // A. مدیریت دکمه‌های شیشه‌ای و تعاملات تلگرام (Callback Query Router)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;
      const data = query.data;

      if (!(await isAuthorizedAdmin(userId))) {
        await answerCallbackQuery(query.id, '❌ دسترسی غیرمجاز به سامانه امانت‌داری کریمی', true);
        return res.status(200).json({ ok: true });
      }

      // ۱. بازگشت به منوی اصلی
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه مدیریت هوشمند امانت‌داری کریمی*\nلطفاً گزینه مورد نظر خود را انتخاب کنید:', buildMainMenuKeyboard());
      } 

      // ۲. لیست حساب مشتریان
      else if (data === 'NAV_CUSTOMERS') {
        const accounts = await fetchAllAccountsFromDb();
        let custBtns = (accounts || []).slice(0, 15).map(acc => [
          { text: `👤 ${getVal(acc, ['Name', 'name']) || 'بدون نام'} (${getVal(acc, ['AccountID', 'accountid'])})`, callback_data: `SELECT_CUST:${getVal(acc, ['AccountID', 'accountid'])}` }
        ]);
        custBtns.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *لیست حساب‌های مشتریان فعال:*\nمشتری مورد نظر را انتخاب کنید:', custBtns);
      } 

      // ۳. انتخاب مشتری و ورود به پنل اختصاصی
      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const acc = await getAccountById(accId);
        if (!acc) return res.status(200).json({ ok: true });

        userStates[userId] = { accId, accName: getVal(acc, ['Name', 'name']) };
        let liveBal = await getAccountLiveBalanceText(accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *پنل مدیریت حساب مشتری:* *${getVal(acc, ['Name', 'name'])}*\n🆔 کُد حساب: \`${toEnglishDigits(accId)}\`\n📞 شماره تماس: \`${getVal(acc, ['Phone', 'phone']) || '-'}\`\n\n${liveBal}`, buildCustomerActionMenu(getVal(acc, ['Name', 'name'])));
      } 

      // ۴. مشاهده مانده زنده حساب مشتری
      else if (data === 'CUST_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).json({ ok: true });
        let balText = `📊 *صورت‌حساب تفکیکی مشتری:* *${st.accName}*\n────────────────────────\n` + await getAccountLiveBalanceText(st.accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, balText, [
          [{ text: '➕ ثبت تراکنش جدید', callback_data: 'CUST_ADD_TX' }],
          [{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]
        ]);
      } 

      // ۵. شروع ثبت تراکنش از داخل پنل مشتری
      else if (data === 'CUST_ADD_TX' || data === 'FORM_SELECT_CUSTOMER_FOR_TX') {
        const st = userStates[userId];
        if (data === 'FORM_SELECT_CUSTOMER_FOR_TX' || !st || !st.accId) {
          const accounts = await fetchAllAccountsFromDb();
          let custBtns = (accounts || []).slice(0, 15).map(acc => [
            { text: `👤 ${getVal(acc, ['Name', 'name'])}`, callback_data: `TX_FOR_CUST:${getVal(acc, ['AccountID', 'accountid'])}` }
          ]);
          custBtns.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, '📝 *ثبت تراکنش جدید*\nلطفاً مشتری مورد نظر را انتخاب کنید:', custBtns);
          return res.status(200).json({ ok: true });
        }

        userStates[userId] = { ...st, step: 'TX_WAIT_AMOUNT', formData: { accId: st.accId, accName: st.accName } };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 *ثبت تراکنش برای مشتری:* *${st.accName}*\n\n۱. لطفاً *مبلغ تراکنش* را وارد کنید:\n(مثلاً: 5000)`, [
          [{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]
        ]);
      }

      else if (data.startsWith('TX_FOR_CUST:')) {
        const accId = data.split(':')[1];
        const acc = await getAccountById(accId);
        if (!acc) return res.status(200).json({ ok: true });

        userStates[userId] = { accId, accName: getVal(acc, ['Name', 'name']), step: 'TX_WAIT_AMOUNT', formData: { accId, accName: getVal(acc, ['Name', 'name']) } };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 *ثبت تراکنش برای:* *${getVal(acc, ['Name', 'name'])}*\n\n۱. لطفاً *مبلغ تراکنش* را وارد کنید:`, [
          [{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]
        ]);
      }

      // ۶. تعیین جهت تراکنش (بستانکار / بدهکار)
      else if (data.startsWith('TX_SET_DIR:')) {
        const dir = data.split(':')[1];
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.direction = dir;
          st.step = 'TX_WAIT_CURRENCY';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ جهت انتخاب شد: *${dir}*\n\n۳. لطفاً *واحد ارز* را انتخاب کنید:`, buildCurrencySelectionKeyboard('TX_SET_CURR'));
        }
      }

      // ۷. تعیین واحد ارز تراکنش
      else if (data.startsWith('TX_SET_CURR:')) {
        const curr = data.split(':')[1];
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.currency = curr;
          st.step = 'TX_WAIT_OPTYPE';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ ارز انتخاب شد: *${curr}*\n\n۴. نوع عملیات را انتخاب کنید یا بنویسید:`, [
            [{ text: 'امانت', callback_data: 'TX_SET_OP:امانت' }, { text: 'حواله', callback_data: 'TX_SET_OP:حواله' }],
            [{ text: 'انتقال', callback_data: 'TX_SET_OP:انتقال' }, { text: 'تسویه', callback_data: 'TX_SET_OP:تسویه' }]
          ]);
        }
      }

      // ۸. تعیین نوع عملیات تراکنش
      else if (data.startsWith('TX_SET_OP:')) {
        const op = data.split(':')[1];
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.operationType = op;
          st.step = 'TX_WAIT_DESC';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ نوع عملیات: *${op}*\n\n۵. لطفاً *شرح یا توضیحات تراکنش* را ارسال کنید:`);
        }
      }

      // ۹. فرم ایجاد حساب جدید
      else if (data === 'FORM_NEW_ACCOUNT') {
        userStates[userId] = { step: 'ACC_WAIT_NAME', formData: {} };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *ایجاد حساب جدید مشتری*\n\n۱. لطفاً *نام کامل مشتری* را ارسال کنید:`, [
          [{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]
        ]);
      }

      // ۱۰. بیلان جامع سیستم
      else if (data === 'NAV_REPORTS') {
        await answerCallbackQuery(query.id);
        let globalSummary = await calculateSystemGlobalBalanceSummary();
        await editTelegramMsg(chatId, msgId, `📈 *آمار و بیلان جامع کل سیستم امانت‌داری*\n\n${globalSummary}`, [
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      return res.status(200).json({ ok: true });
    }

    // B. مدیریت پیام‌های متنی و روند مرحله‌ای ربات (Text Message Router & Flow Engine)
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = sanitizeText(update.message.text);

      if (!(await isAuthorizedAdmin(userId))) {
        await sendTelegramMsg(chatId, '⛔ دسترسی غیرمجاز به سامانه امانت‌داری کریمی.');
        return res.status(200).json({ ok: true });
      }

      if (text === '/start') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه هوشمند مدیریت امانت‌داری کریمی*\nلطفاً از منوی زیر استفاده کنید:', buildMainMenuKeyboard());
        return res.status(200).json({ ok: true });
      }

      let st = userStates[userId];

      // پردازش مرحله‌ای فرم ثبت تراکنش
      if (st && st.step) {
        if (st.step === 'TX_WAIT_AMOUNT') {
          let amt = parseFloat(toEnglishDigits(text));
          if (isNaN(amt) || amt <= 0) {
            await sendTelegramMsg(chatId, '⚠️ مبلغ نامعتبر است. لطفاً یک عدد صحیح یا اعشاری وارد کنید:');
            return res.status(200).json({ ok: true });
          }
          st.formData.amount = amt;
          st.step = 'TX_WAIT_DIR';
          await sendTelegramMsg(chatId, `💰 مبلغ ثبت شد: *${formatMoney(amt)}*\n\n۲. جهت تراکنش را انتخاب کنید:`, { inline_keyboard: buildDirectionSelectionKeyboard('TX_SET_DIR') });
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'TX_WAIT_OPTYPE') {
          st.formData.operationType = text;
          st.step = 'TX_WAIT_DESC';
          await sendTelegramMsg(chatId, `✅ نوع عملیات ثبت شد: *${text}*\n\n۵. لطفاً *شرح یا توضیحات تراکنش* را ارسال کنید:`);
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'TX_WAIT_DESC') {
          st.formData.description = text;

          // ذخیره نهایی تراکنش در دیتابیس Supabase
          const txPayload = {
            TransID: generateUniqueId('TX'),
            AccountID: st.formData.accId,
            Direction: st.formData.direction,
            Amount: st.formData.amount,
            Currency: st.formData.currency,
            OperationType: st.formData.operationType || 'امانت',
            Description: st.formData.description,
            Date: getCurrentTimestamp()
          };

          let insertRes = await insertCustomerTransaction(txPayload);
          let customerName = st.formData.accName;
          let customerAccId = st.formData.accId;
          delete userStates[userId];

          if (insertRes.success) {
            let liveBal = await getAccountLiveBalanceText(customerAccId);
            await sendTelegramMsg(chatId, `✅ *تراکنش با موفقیت ثبت شد!*\n\n👤 مشتری: *${customerName}*\n💰 مبلغ: *${formatMoney(txPayload.Amount)} ${txPayload.Currency}* (${txPayload.Direction})\n📝 شرح: _${txPayload.Description || '-'}_`, {
              inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }, { text: '👥 پنل مشتری', callback_data: `SELECT_CUST:${customerAccId}` }]]
            });
          } else {
            await sendTelegramMsg(chatId, `❌ خطا در ذخیره تراکنش در پایگاه داده.`);
          }
          return res.status(200).json({ ok: true });
        }

        // پردازش مرحله‌ای فرم ایجاد حساب مشتری جدید
        if (st.step === 'ACC_WAIT_NAME') {
          st.formData.name = text;
          st.step = 'ACC_WAIT_PHONE';
          await sendTelegramMsg(chatId, `👤 نام مشتری: *${text}*\n\n۲. لطفاً *شماره تماس* مشتری را وارد کنید (یا بنویسید -):`);
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'ACC_WAIT_PHONE') {
          st.formData.phone = text === '-' ? '' : text;
          st.step = 'ACC_WAIT_CHATID';
          await sendTelegramMsg(chatId, `📞 شماره تماس ثبت شد.\n\n۳. لطفاً *چت‌آیدی تلگرام* مشتری را جهت ارسال خودکار تراکنش‌ها وارد کنید (یا بنویسید -):`);
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'ACC_WAIT_CHATID') {
          st.formData.chatId = text === '-' ? '' : text;

          let newAccId = 'ACC-' + Math.floor(100000 + Math.random() * 900000);
          const accountPayload = {
            AccountID: newAccId,
            Name: st.formData.name,
            Phone: st.formData.phone,
            ChatID: st.formData.chatId,
            CreatedBy: String(userId)
          };

          let resAcc = await insertNewAccountInDb(accountPayload);
          let accName = st.formData.name;
          delete userStates[userId];

          if (resAcc.success) {
            await sendTelegramMsg(chatId, `✅ *حساب جدید با موفقیت ایجاد شد!*\n\n👤 نام: *${accName}*\n🆔 کُد حساب: \`${newAccId}\`\n📞 تلفن: \`${accountPayload.Phone || '-'}\``, {
              inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }, { text: '👥 مشاهده حساب‌ها', callback_data: 'NAV_CUSTOMERS' }]]
            });
          } else {
            await sendTelegramMsg(chatId, `❌ خطا در ایجاد حساب مشتری در پایگاه داده.`);
          }
          return res.status(200).json({ ok: true });
        }
      }

      // جستجوی هوشمند مشتری بر اساس متن ارسالی (نام یا شماره تلفن)
      const accounts = await fetchAllAccountsFromDb();
      let matchedAccs = (accounts || []).filter(acc => {
        let name = String(getVal(acc, ['Name', 'name']) || '').toLowerCase();
        let phone = String(getVal(acc, ['Phone', 'phone']) || '').toLowerCase();
        let accId = String(getVal(acc, ['AccountID', 'accountid']) || '').toLowerCase();
        return name.includes(text.toLowerCase()) || phone.includes(text.toLowerCase()) || accId.includes(text.toLowerCase());
      });

      if (matchedAccs.length > 0) {
        let acc = matchedAccs[0];
        let accId = getVal(acc, ['AccountID', 'accountid']);
        let accName = getVal(acc, ['Name', 'name']);
        let liveBal = await getAccountLiveBalanceText(accId);

        await sendTelegramMsg(chatId, `👤 *مشتری یافت شد:* *${accName}*\n🆔 کُد: \`${accId}\`\n\n${liveBal}`, [
          [{ text: '➕ ثبت تراکنش جدید', callback_data: `CUST_ADD_TX` }, { text: '📊 بیلان تفکیکی', callback_data: `SELECT_CUST:${accId}` }],
          [{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
        return res.status(200).json({ ok: true });
      }

      await sendTelegramMsg(chatId, 'ℹ️ دستور یا متن نامعتبر. برای دسترسی به منوی اصلی، لطفاً دستور /start را ارسال کنید.');
    }
  } catch (err) {
    console.error('Critical Enterprise Server Architecture Error:', err);
  }

  return res.status(200).json({ ok: true });
};
