/**
 * ==============================================================================
 * 🏛️ سامانه جامع، پیشرفته و هوشمند مدیریت امانت‌داری کریمی
 * نسخه کامل سرور ربات تلگرام - Enterprise Full Architecture (1200 Lines Clean)
 * مجهز به جستجوی پیشرفته چندگانه، پشتیبانی از اعداد فارسی/عربی، مدیریت کامل تراکنش‌ها
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";
const MASTER_ADMIN_ID = "802655440";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

const userStates = {};
const systemCache = {
  accounts: [],
  transactions: [],
  admins: [],
  operationTypes: []
};

/* ==============================================================================
 * ۱. موتور پردازش اعداد، تبدیل ارقام (فارسی، عربی، انگلیسی) و فرمت‌دهی مالی
 * ============================================================================== */

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
  let cleanNum = toEnglishDigits(amount).replace(/[^0-9.-]+/g, "");
  let num = parseFloat(cleanNum);
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

function formatCurrencyCode(curr) {
  if (!curr) return 'AFN';
  let clean = String(curr).trim().toUpperCase();
  if (clean.includes('دینار') || clean === 'IQD') return 'IQD';
  if (clean.includes('تومان') || clean === 'TOM') return 'تومان';
  if (clean.includes('افغانی') || clean === 'AFN') return 'AFN';
  if (clean.includes('دلار') || clean === 'USD') return 'USD';
  return 'AFN';
}

/* ==============================================================================
 * ۲. ارتباطات پیشرفته تلگرام (Telegram API Communication Engine)
 * ============================================================================== */

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

/* ==============================================================================
 * ۳. پایگاه داده و مدیریت اطلاعات (Supabase Database Layer)
 * ============================================================================== */

async function fetchAllAccountsFromDb() {
  try {
    const { data, error } = await supabase.from('accounts').select('*');
    if (error) throw error;
    systemCache.accounts = data || [];
    return systemCache.accounts;
  } catch (e) {
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

async function getTransactionById(txId) {
  try {
    const { data, error } = await supabase.from('transactions').select('*').eq('TransID', txId).single();
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
    return { success: false, error: e.message };
  }
}

async function updateCustomerTransaction(txId, updates) {
  try {
    const { data, error } = await supabase.from('transactions').update(updates).eq('TransID', txId);
    if (error) throw error;
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function deleteCustomerTransaction(txId) {
  try {
    const { error } = await supabase.from('transactions').delete().eq('TransID', txId);
    if (error) throw error;
    return true;
  } catch (e) {
    return false;
  }
}

async function deleteCustomerAccount(accId) {
  try {
    await supabase.from('transactions').delete().eq('AccountID', accId);
    const { error } = await supabase.from('accounts').delete().eq('AccountID', accId);
    if (error) throw error;
    return true;
  } catch (e) {
    return false;
  }
}

/* ==============================================================================
 * ۴. محاسبات مالی، بیلان و گزارشات تفکیکی
 * ============================================================================== */

async function getAccountLiveBalanceText(accId) {
  const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
  let currs = {};
  if (txs) {
    txs.forEach(t => {
      let c = formatCurrencyCode(getVal(t, ['Currency', 'currency']));
      let d = getVal(t, ['Direction', 'direction']);
      let a = parseFloat(toEnglishDigits(getVal(t, ['Amount', 'amount']))) || 0;
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
        let amt = parseFloat(toEnglishDigits(getVal(tx, ['Amount', 'amount']))) || 0;

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
      parts.push(`🔹 ${curr} ➔ کل بستانکاری: ${formatMoney(cred)} | کل بدهکاری: ${formatMoney(deb)} | *مانده: ${status}*`);
    }
    return parts.join('\n') || 'بدون مانده فعال در سیستم';
  } catch (e) {
    return 'خطا در محاسبه بیلان کل سیستم.';
  }
}

/* ==============================================================================
 * ۵. رابط کاربری و کیبوردهای شیشه‌ای پیشرفته (UI Keyboards)
 * ============================================================================== */

function buildMainMenuKeyboard() {
  return [
    [{ text: '👥 لیست حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🔍 جستجوی پیشرفته مشتری', callback_data: 'NAV_SEARCH_PRO' }],
    [{ text: '📝 ثبت تراکنش جدید', callback_data: 'FORM_SELECT_CUSTOMER_FOR_TX' }],
    [{ text: '📈 آمار و بیلان جامع کل سیستم', callback_data: 'NAV_REPORTS' }]
  ];
}

function buildCustomerActionMenu(accId) {
  return [
    [{ text: '📊 مشاهده مانده تفکیکی حساب', callback_data: `CUST_VIEW_BAL:${accId}` }],
    [{ text: '📜 لیست تراکنش‌ها (مدیریت/ویرایش/حذف)', callback_data: `CUST_LIST_TXS:${accId}` }],
    [{ text: '➕ ثبت تراکنش جدید برای این مشتری', callback_data: `CUST_ADD_TX:${accId}` }],
    [{ text: '🗑️ حذف کامل حساب', callback_data: `CUST_DELETE_CONFIRM:${accId}` }],
    [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
  ];
}

function buildTransactionActionMenu(txId, accId) {
  return [
    [
      { text: '✏️ ویرایش مبلغ/شرح', callback_data: `TX_EDIT_START:${txId}` },
      { text: '🗑️ حذف تراکنش', callback_data: `TX_DELETE_EXEC:${txId}` }
    ],
    [
      { text: '📄 متن رسید انتقال / گزارش', callback_data: `TX_RECEIPT_VIEW:${txId}` },
      { text: '🔙 بازگشت به حساب مشتری', callback_data: `SELECT_CUST:${accId}` }
    ]
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

/* ==============================================================================
 * ۶. موتور اصلی پردازش درخواست‌ها و روتر هوشمند ربات (Router & Handler)
 * ============================================================================== */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Enterprise Trust Management Bot Server Active & Ready');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // A. مدیریت دکمه‌های شیشه‌ای (Callback Query Router)
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

      // ۱. منوی اصلی
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه هوشمند مدیریت امانت‌داری کریمی*\nلطفاً گزینه مورد نظر خود را انتخاب کنید:', buildMainMenuKeyboard());
      } 

      // ۲. لیست حساب مشتریان
      else if (data === 'NAV_CUSTOMERS') {
        const accounts = await fetchAllAccountsFromDb();
        let custBtns = (accounts || []).slice(0, 15).map(acc => [
          { text: `👤 ${getVal(acc, ['Name', 'name']) || 'بدون نام'} (${getVal(acc, ['AccountID', 'accountid'])})`, callback_data: `SELECT_CUST:${getVal(acc, ['AccountID', 'accountid'])}` }
        ]);
        custBtns.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *لیست کامل حساب‌های مشتریان فعال:*', custBtns);
      }

      // ۳. راهنمای جستجوی پیشرفته
      else if (data === 'NAV_SEARCH_PRO') {
        userStates[userId] = { step: 'SEARCH_PRO_WAIT' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🔍 *سیستم جستجوی پیشرفته و هوشمند*\n\nلطفاً نام یا بخشی از نام مشتری مورد نظر را ارسال کنید (مثلاً: *علی* یا *علی فلانی* تا تمامی موارد مشابه نمایش داده شوند):', [
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 

      // ۴. انتخاب مشتری و ورود به پنل مدیریت اختصاصی
      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const acc = await getAccountById(accId);
        if (!acc) return res.status(200).json({ ok: true });

        userStates[userId] = { accId, accName: getVal(acc, ['Name', 'name']) };
        let liveBal = await getAccountLiveBalanceText(accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *پنل مدیریت حساب مشتری:* *${getVal(acc, ['Name', 'name'])}*\n🆔 کُد حساب: \`${accId}\`\n📞 تلفن: \`${getVal(acc, ['Phone', 'phone']) || '-'}\`\n\n${liveBal}`, buildCustomerActionMenu(accId));
      } 

      // ۵. مشاهده مانده زنده حساب
      else if (data.startsWith('CUST_VIEW_BAL:')) {
        const accId = data.split(':')[1];
        const acc = await getAccountById(accId);
        let balText = `📊 *صورت‌حساب تفکیکی:* *${getVal(acc, ['Name', 'name'])}*\n────────────────────────\n` + await getAccountLiveBalanceText(accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, balText, [
          [{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${accId}` }]
        ]);
      } 

      // ۶. لیست تراکنش‌های مشتری جهت مدیریت (ویرایش یا حذف)
      else if (data.startsWith('CUST_LIST_TXS:')) {
        const accId = data.split(':')[1];
        const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
        
        if (!txs || txs.length === 0) {
          await answerCallbackQuery(query.id, 'تراکنشی برای این حساب ثبت نشده است.', true);
          return res.status(200).json({ ok: true });
        }

        let txBtns = txs.slice(-10).reverse().map(t => [
          { text: `🔹 ${getVal(t, ['OperationType', 'operationtype']) || 'تراکنش'} | ${formatMoney(getVal(t, ['Amount', 'amount']))} ${getVal(t, ['Currency', 'currency'])} (${getVal(t, ['Direction', 'direction'])})`, callback_data: `TX_DETAILS:${getVal(t, ['TransID', 'transid'])}` }
        ]);
        txBtns.push([{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${accId}` }]);

        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📜 *لیست تراکنش‌های اخیر مشتری*\nجهت مدیریت (ویرایش یا حذف)، تراکنش مورد نظر را انتخاب کنید:`, txBtns);
      }

      // ۷. جزئیات کامل تراکنش و دسترسی به ویرایش / حذف
      else if (data.startsWith('TX_DETAILS:')) {
        const txId = data.split(':')[1];
        const tx = await getTransactionById(txId);
        if (!tx) return res.status(200).json({ ok: true });

        let accId = getVal(tx, ['AccountID', 'accountid']);
        let txDetailsMsg = `🔍 *جزئیات تراکنش*\n\n` +
                           `🆔 کد تراکنش: \`${txId}\`\n` +
                           `💰 مبلغ: *${formatMoney(getVal(tx, ['Amount', 'amount']))} ${getVal(tx, ['Currency', 'currency'])}*\n` +
                           `🟢 جهت: *${getVal(tx, ['Direction', 'direction'])}*\n` +
                           `⚙️ نوع عملیات: *${getVal(tx, ['OperationType', 'operationtype'])}*\n` +
                           `📝 شرح: _${getVal(tx, ['Description', 'description']) || '-'}_`;

        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, txDetailsMsg, buildTransactionActionMenu(txId, accId));
      }

      // ۸. آغاز روند ویرایش تراکنش
      else if (data.startsWith('TX_EDIT_START:')) {
        const txId = data.split(':')[1];
        userStates[userId] = { step: 'TX_EDIT_WAIT_VAL', editTxId: txId };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `✏️ *ویرایش تراکنش*\nلطفاً مبلغ جدید و شرح جدید را با فاصله ارسال کنید (مثلاً: \`5000 بابت تسویه حساب\`):`, [
          [{ text: '❌ انصراف', callback_data: `TX_DETAILS:${txId}` }]
        ]);
      }

      // ۹. اجرای حذف تراکنش
      else if (data.startsWith('TX_DELETE_EXEC:')) {
        const txId = data.split(':')[1];
        const tx = await getTransactionById(txId);
        let accId = tx ? getVal(tx, ['AccountID', 'accountid']) : null;
        
        let success = await deleteCustomerTransaction(txId);
        await answerCallbackQuery(query.id, success ? 'تراکنش با موفقیت حذف شد.' : 'خطا در حذف تراکنش', true);
        
        if (accId) {
          let liveBal = await getAccountLiveBalanceText(accId);
          await editTelegramMsg(chatId, msgId, `✅ تراکنش مورد نظر با موفقیت حذف گردید.\n\n${liveBal}`, [
            [{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${accId}` }]
          ]);
        } else {
          await editTelegramMsg(chatId, msgId, '✅ تراکنش حذف شد.', [[{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]]);
        }
      }

      // ۱۰. نمایش رسید و گزارش انتقال
      else if (data.startsWith('TX_RECEIPT_VIEW:')) {
        const txId = data.split(':')[1];
        const tx = await getTransactionById(txId);
        if (!tx) return res.status(200).json({ ok: true });

        let receiptText = `📜 ═════════════════ 📜\n` +
                          `       *رسید انتقال / گزارش*\n` +
                          `📜 ═════════════════ 📜\n\n` +
                          `💰 مبلغ: ${formatMoney(getVal(tx, ['Amount', 'amount']))} ${getVal(tx, ['Currency', 'currency'])}\n` +
                          `📝 شرح: ${getVal(tx, ['Description', 'description']) || '-'}\n\n` +
                          `⚠️ *برای گرفتن پول داشتن اسناد الزامی است*`;

        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, receiptText, [
          [{ text: '🔙 بازگشت به جزئیات تراکنش', callback_data: `TX_DETAILS:${txId}` }]
        ]);
      }

      // ۱۱. تأیید حذف کامل حساب مشتری
      else if (data.startsWith('CUST_DELETE_CONFIRM:')) {
        const accId = data.split(':')[1];
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `⚠️ *هشدار جدی*\nآیا از حذف کامل این حساب و تمام تراکنش‌های آن اطمینان دارید؟ این عملیات غیرقابل بازگشت است.`, [
          [
            { text: 'بله، کاملاً حذف شود 🗑️', callback_data: `CUST_DELETE_EXEC:${accId}` },
            { text: 'انصراف ❌', callback_data: `SELECT_CUST:${accId}` }
          ]
        ]);
      }

      // ۱۲. اجرای حذف حساب مشتری
      else if (data.startsWith('CUST_DELETE_EXEC:')) {
        const accId = data.split(':')[1];
        let success = await deleteCustomerAccount(accId);
        await answerCallbackQuery(query.id, success ? 'حساب با موفقیت حذف شد.' : 'خطا در حذف حساب', true);
        await editTelegramMsg(chatId, msgId, '✅ حساب مشتری و کلیه تراکنش‌های آن با موفقیت از سیستم پاک شد.', [
          [{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      // ۱۳. ثبت تراکنش جدید برای مشتری مشخص
      else if (data.startsWith('CUST_ADD_TX:') || data === 'FORM_SELECT_CUSTOMER_FOR_TX') {
        let accId = data.startsWith('CUST_ADD_TX:') ? data.split(':')[1] : null;
        if (!accId) {
          const accounts = await fetchAllAccountsFromDb();
          let custBtns = (accounts || []).slice(0, 15).map(acc => [
            { text: `👤 ${getVal(acc, ['Name', 'name'])}`, callback_data: `CUST_ADD_TX:${getVal(acc, ['AccountID', 'accountid'])}` }
          ]);
          custBtns.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, '📝 *ثبت تراکنش جدید*\nلطفاً مشتری مورد نظر را انتخاب کنید:', custBtns);
          return res.status(200).json({ ok: true });
        }

        const acc = await getAccountById(accId);
        userStates[userId] = { step: 'TX_WAIT_AMOUNT', formData: { accId, accName: getVal(acc, ['Name', 'name']) } };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 *ثبت تراکنش برای:* *${getVal(acc, ['Name', 'name'])}*\n\n۱. لطفاً *مبلغ تراکنش* را وارد کنید (پشتیبانی از اعداد فارسی، عربی و انگلیسی):`, [
          [{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]
        ]);
      }

      // ۱۴. انتخاب جهت تراکنش
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

      // ۱۵. انتخاب ارز تراکنش
      else if (data.startsWith('TX_SET_CURR:')) {
        const curr = data.split(':')[1];
        const st = userStates[userId];
        if (st && st.formData) {
          st.formData.currency = curr;
          st.step = 'TX_WAIT_OPTYPE';
          await answerCallbackQuery(query.id);
          await editTelegramMsg(chatId, msgId, `✅ ارز انتخاب شد: *${curr}*\n\n۴. نوع عملیات را انتخاب کنید:`, [
            [{ text: 'امانت', callback_data: 'TX_SET_OP:امانت' }, { text: 'حواله', callback_data: 'TX_SET_OP:حواله' }],
            [{ text: 'انتقال', callback_data: 'TX_SET_OP:انتقال' }, { text: 'تسویه', callback_data: 'TX_SET_OP:تسویه' }]
          ]);
        }
      }

      // ۱۶. انتخاب نوع عملیات
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

      // ۱۷. بیلان جامع سیستم
      else if (data === 'NAV_REPORTS') {
        await answerCallbackQuery(query.id);
        let globalSummary = await calculateSystemGlobalBalanceSummary();
        await editTelegramMsg(chatId, msgId, `📈 *آمار و بیلان جامع کل سیستم امانت‌داری*\n\n${globalSummary}`, [
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      return res.status(200).json({ ok: true });
    }

    // B. مدیریت پیام‌های متنی و استعلام‌های جستجوی پیشرفته (Text Message Router)
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

      // اجرای ویرایش تراکنش
      if (st && st.step === 'TX_EDIT_WAIT_VAL') {
        let parts = text.split(' ');
        let newAmt = parseFloat(toEnglishDigits(parts[0]));
        let newDesc = parts.slice(1).join(' ') || 'ویرایش شده';

        if (isNaN(newAmt) || newAmt <= 0) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ وارد شده معتبر نیست. لطفاً مجدداً با فرمت صحیح (مبلغ شرح) ارسال کنید:');
          return res.status(200).json({ ok: true });
        }

        let updateRes = await updateCustomerTransaction(st.editTxId, { Amount: newAmt, Description: newDesc });
        let tx = await getTransactionById(st.editTxId);
        let accId = tx ? getVal(tx, ['AccountID', 'accountid']) : null;
        delete userStates[userId];

        if (updateRes.success) {
          await sendTelegramMsg(chatId, `✅ *تراکنش با موفقیت ویرایش شد!*`, {
            inline_keyboard: [[{ text: '🔙 بازگشت به حساب مشتری', callback_data: `SELECT_CUST:${accId}` }]]
          });
        } else {
          await sendTelegramMsg(chatId, '❌ خطا در بروزرسانی تراکنش.');
        }
        return res.status(200).json({ ok: true });
      }

      // روند ثبت تراکنش مرحله‌ای با پشتیبانی از ارقام فارسی/عربی/انگلیسی
      if (st && st.step) {
        if (st.step === 'TX_WAIT_AMOUNT') {
          let cleanInput = toEnglishDigits(text);
          let amt = parseFloat(cleanInput);
          if (isNaN(amt) || amt <= 0) {
            await sendTelegramMsg(chatId, '⚠️ مبلغ نامعتبر است. لطفاً یک عدد صحیح یا اعشاری وارد کنید (پشتیبانی از اعداد فارسی، عربی و انگلیسی):');
            return res.status(200).json({ ok: true });
          }
          st.formData.amount = amt;
          st.step = 'TX_WAIT_DIR';
          await sendTelegramMsg(chatId, `💰 مبلغ ثبت شد: *${formatMoney(amt)}*\n\n۲. جهت تراکنش را انتخاب کنید:`, { inline_keyboard: buildDirectionSelectionKeyboard('TX_SET_DIR') });
          return res.status(200).json({ ok: true });
        }

        if (st.step === 'TX_WAIT_DESC') {
          st.formData.description = text;

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
            await sendTelegramMsg(chatId, `✅ *تراکنش با موفقیت ثبت شد و در سیستم ذخیره گردید!*\n\n👤 مشتری: *${customerName}*\n💰 مبلغ: *${formatMoney(txPayload.Amount)} ${txPayload.Currency}* (${txPayload.Direction})\n📝 شرح: _${txPayload.Description || '-'}_`, {
              inline_keyboard: [[{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }, { text: '👥 پنل مشتری', callback_data: `SELECT_CUST:${customerAccId}` }]]
            });
          } else {
            await sendTelegramMsg(chatId, `❌ خطا در ذخیره تراکنش در پایگاه داده.`);
          }
          return res.status(200).json({ ok: true });
        }

        if (st && st.step === 'SEARCH_PRO_WAIT') {
          delete userStates[userId];
          let queryTerm = text.toLowerCase();
          const accounts = await fetchAllAccountsFromDb();

          // جستجوی پیشرفته تطبیقی (مثلاً علی فلانی، علی و غیره)
          let matched = accounts.filter(acc => {
            let name = String(getVal(acc, ['Name', 'name']) || '').toLowerCase();
            let phone = String(getVal(acc, ['Phone', 'phone']) || '').toLowerCase();
            let accId = String(getVal(acc, ['AccountID', 'accountid']) || '').toLowerCase();
            return name.includes(queryTerm) || phone.includes(queryTerm) || accId.includes(queryTerm);
          });

          if (matched.length === 0) {
            await sendTelegramMsg(chatId, `ℹ️ هیچ موردی با عبارت «${text}» یافت نشد.`, [
              [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
            ]);
            return res.status(200).json({ ok: true });
          }

          let resultsBtns = matched.map(acc => [
            { text: `👤 ${getVal(acc, ['Name', 'name'])} (تلفن: ${getVal(acc, ['Phone', 'phone']) || '-'})`, callback_data: `SELECT_CUST:${getVal(acc, ['AccountID', 'accountid'])}` }
          ]);
          resultsBtns.push([{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]);

          await sendTelegramMsg(chatId, `🔍 نتایج جستجوی پیشرفته برای عبارت: *${text}* (${matched.length} مورد یافت شد):`, resultsBtns);
          return res.status(200).json({ ok: true });
        }
      }

      // جستجوی عمومی و هوشمند خودکار نام مشتریان در متن پیام
      const accounts = await fetchAllAccountsFromDb();
      let matchedAccs = (accounts || []).filter(acc => {
        let name = String(getVal(acc, ['Name', 'name']) || '').toLowerCase();
        let phone = String(getVal(acc, ['Phone', 'phone']) || '').toLowerCase();
        let accId = String(getVal(acc, ['AccountID', 'accountid']) || '').toLowerCase();
        return name.includes(text.toLowerCase()) || phone.includes(text.toLowerCase()) || accId.includes(text.toLowerCase());
      });

      if (matchedAccs.length > 0) {
        let buttons = matchedAccs.map(acc => [
          { text: `👤 ${getVal(acc, ['Name', 'name'])} (کُد: ${getVal(acc, ['AccountID', 'accountid'])})`, callback_data: `SELECT_CUST:${getVal(acc, ['AccountID', 'accountid'])}` }
        ]);
        buttons.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);

        await sendTelegramMsg(chatId, `🔍 چند حساب مرتبط با عبارت «${text}» یافت شد. لطفاً مورد نظر را انتخاب کنید:`, buttons);
        return res.status(200).json({ ok: true });
      }

      await sendTelegramMsg(chatId, 'ℹ️ دستور یا متن نامعتبر. برای دسترسی به منوی اصلی، لطفاً دستور /start را ارسال کنید.');
    }
  } catch (err) {
    console.error('Critical Enterprise Server Architecture Error:', err);
  }

  return res.status(200).json({ ok: true });
};
