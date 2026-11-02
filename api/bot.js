/**
 * ==============================================================================
 * 🏛️ سامانه جامع و هوشمند پردازش متن و ثبت تراکنش صرافی کریمی (بر پایه زبان طبیعی)
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";
const MASTER_ADMIN_ID = "802655440";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

/**
 * تبدیل ارقام فارسی و عربی به انگلیسی استاندارد
 */
function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
    return d.charCodeAt(0) >= 1776 ? d.charCodeAt(0) - 1776 : d.charCodeAt(0) - 1632;
  });
}

/**
 * فرمت‌بندی مبالغ مالی با کاما
 */
function formatMoney(amount) {
  let num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return toEnglishDigits(num.toLocaleString('en-US'));
}

/**
 * ارسال پیام تلگرام با کیبورد شیشه‌ای
 */
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

/**
 * بررسی دسترسی ادمین
 */
async function isAuthorizedAdmin(userId) {
  if (String(userId) === String(MASTER_ADMIN_ID)) return true;
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins) {
      return admins.some(adm => String(adm.ChatID || adm.chatid || '') === String(userId));
    }
  } catch (e) {
    console.error("Auth Error:", e);
  }
  return false;
}

/**
 * استخراج هوشمند و پردازش متن ورودی کاربر بر اساس قوانین تعریف شده
 */
async function parseAndExecuteNaturalLanguage(chatId, text) {
  const cleanText = toEnglishDigits(text);
  
  // ۱. بررسی قانون تعیین جهت بر اساس فاعل (اول شخص / سوم شخص)
  // اول شخص (کردم، اجرا کردم، پرداخت کردم، رساندم، گرفتم) = بدهکار
  // سوم شخص (کرد، اجرا کرد، پرداخت کرد، واریز کرد، رساند، گرفت، گرفتش) = بستانکار
  let isFirstPerson = /(کردم|اجرا کردم|پرداخت کردم|رساندم|گرفتم)/.test(cleanText);
  let isThirdPerson = /(کرد|اجرا کرد|پرداخت کرد|واریز کرد|رساند|گرفت|گرفتش)/.test(cleanText);
  
  let direction = "بدهکار"; // پیش‌فرض
  if (isThirdPerson && !isFirstPerson) {
    direction = "بستانکار";
  } else if (isFirstPerson) {
    direction = "بدهکار";
  }

  // ۲. استخراج واحد پول (USD, AFN, تومان, IQD, دینار, دلار)
  let currency = "USD";
  if (/دینار|iqd/i.test(cleanText)) currency = "IQD";
  else if (/تومان/i.test(cleanText)) currency = "تومان";
  else if (/افغانی|afn/i.test(cleanText)) currency = "AFN";
  else if (/دلار|usd/i.test(cleanText)) currency = "USD";

  // ۳. استخراج مبالغ
  const numbers = cleanText.match(/\d+(\.\d+)?/g);
  let amountInitial = numbers && numbers.length > 0 ? parseFloat(numbers[0]) : 0;
  
  // ۴. استخراج نرخ تبدیل (اگر علامت تقسیم یا ضرب یا عدد دوم وجود داشته باشد)
  let exchangeRate = null;
  let amountFinal = amountInitial;
  if (cleanText.includes('÷') || cleanText.includes('/') || cleanText.includes('تقسیم')) {
    if (numbers && numbers.length > 1) {
      exchangeRate = parseFloat(numbers[1]);
      if (exchangeRate > 0) amountFinal = amountInitial / exchangeRate;
    }
  } else if (cleanText.includes('✖️') || cleanText.includes('*') || cleanText.includes('ضرب')) {
    if (numbers && numbers.length > 1) {
      exchangeRate = parseFloat(numbers[1]);
      if (exchangeRate > 0) amountFinal = amountInitial * exchangeRate;
    }
  }

  // ۵. استخراج آدرس مقصد (مثل کابل، تهران، etc)
  let address = "-";
  const knownAddresses = ["کابل", "تهران", "کویته", "هرات", "مزار شریف", "قندهار"];
  for (let addr of knownAddresses) {
    if (cleanText.includes(addr)) {
      address = addr;
      break;
    }
  }

  // ۶. بررسی اتصال به حساب مشتری (در صورت وجود نام یا شماره در متن)
  let customerConnected = false;
  let targetCustomerName = null;
  
  // جستجو در میان مشتریان موجود بر اساس نام در متن
  const { data: accounts } = await supabase.from('accounts').select('*');
  if (accounts) {
    for (let acc of accounts) {
      let accName = acc.Name || acc.name || '';
      if (accName && cleanText.includes(accName)) {
        customerConnected = true;
        targetCustomerName = accName;
        
        // ثبت تراکنش در حساب مشتری مطابق با قوانین تعیین‌شده
        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: acc.AccountID || acc.accountid,
          Direction: direction === "بدهکار" ? "بدهکار (-)" : "بستانکار (+)",
          Amount: amountFinal || amountInitial,
          Currency: currency,
          OperationType: "معامله / حواله",
          Description: text,
          Date: new Date().toISOString()
        }]);
        break;
      }
    }
  }

  // ۷. ثبت معامله در صرافی (بخش بروکر پیش‌فرض)
  const { data: brokers } = await supabase.from('brokers').select('*');
  let defaultBrokerId = brokers && brokers.length > 0 ? (brokers[0].broker_id || brokers[0].id) : "BRK-DEFAULT";
  
  const brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
  await supabase.from('broker_transactions').insert([{
    broker_tx_id: brokerTxId,
    broker_id: defaultBrokerId,
    date: new Date().toISOString().split('T')[0],
    operation_type: "حواله / معامله متنی",
    direction: direction,
    currency: currency,
    amount_initial: amountInitial,
    exchange_rate: exchangeRate,
    amount_final: amountFinal,
    description: text,
    address_dashboard: address
  }]);

  // پاسخ نهایی به کاربر
  let responseMsg = `✅ *تراکنش با موفقیت پردازش و ثبت شد.*\n\n` +
    `💰 مبلغ اولیه: *${formatMoney(amountInitial)} ${currency}*\n` +
    `🔄 جهت تشخیص‌داده‌شده: *${direction}*\n` +
    (exchangeRate ? `🔢 نرخ تبدیل: \`${exchangeRate}\` (نهایی: *${formatMoney(amountFinal)} ${currency}*)\n` : ``) +
    `📍 آدرس مقصد: _${address}_\n` +
    (customerConnected ? `👤 اتصال به حساب مشتری: *${targetCustomerName}* (ثبت شد)\n` : `👥 حساب مشتری: _بدون اتصال (حالت صرافی مستقل)_\n`) +
    `📝 شرح: _${text}_`;

  await sendTelegramMsg(chatId, responseMsg);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Natural Language Bot Server is Running');
  }

  try {
    const update = req.body;
    if (!update || !update.message || !update.message.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = update.message.chat.id;
    const userId = update.message.from.id;
    const text = update.message.text.trim();

    if (!(await isAuthorizedAdmin(userId))) {
      await sendTelegramMsg(chatId, '⛔ دسترسی غیرمجاز.');
      return res.status(200).json({ ok: true });
    }

    if (text === '/start') {
      await sendTelegramMsg(chatId, '✨ *سامانه هوشمند ثبت متنی معاملات صرافی کریمی* ✨\n\nپیام خود را به زبان طبیعی بفرستید تا به صورت خودکار تفکیک و ثبت شود.');
      return res.status(200).json({ ok: true });
    }

    // پردازش متن ارسال شده از طریق هوش متن‌شناس
    await parseAndExecuteNaturalLanguage(chatId, text);

  } catch (err) {
    console.error('Critical Error:', err);
  }

  return res.status(200).json({ ok: true });
};
