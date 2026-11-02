/**
 * ==============================================================================
 * 🏛️ سامانه متمرکز ثبت و مدیریت تراکنش‌های امانت‌داری کریمی
 * نسخه کاملاً بهینه‌شده و اختصاصی برای جدول تراکنش‌ها و ثبت سریع
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

/* ۱. موتور پاکسازی و تبدیل ارقام (فارسی، عربی، انگلیسی) */
function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
    return d.charCodeAt(0) >= 1776 ? d.charCodeAt(0) - 1776 : d.charCodeAt(0) - 1632;
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

async function sendTelegramMsg(chatId, text, inlineKeyboard = null) {
  const body = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error("Telegram Send Error:", err);
  }
}

async function getAccountLiveBalanceText(accId) {
  const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
  let currs = {};
  if (txs) {
    txs.forEach(t => {
      let c = String(getVal(t, ['Currency', 'currency']) || 'AFN').toUpperCase();
      let d = String(getVal(t, ['Direction', 'direction']) || '');
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
    textParts.push(`🔹 ارز ${c}:\n  • کل بستانکار: ${formatMoney(cred)}\n  • کل بدهکار: ${formatMoney(deb)}\n  📌 مانده: ${status}`);
  }
  return textParts.join('\n\n') || 'تراکنشی ثبت نشده است.';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Transaction Service Active');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // مدیریت کلیک روی دکمه‌های شیشه‌ای مربوط به ثبت تراکنش
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const data = query.data;

      // انتخاب مشتری برای ثبت تراکنش
      if (data.startsWith('TX_START_ACC:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        if (!acc) return res.status(200).json({ ok: true });

        userStates[userId] = { step: 'WAIT_AMOUNT', accId: accId, accName: getVal(acc, ['Name', 'name']) };
        await sendTelegramMsg(chatId, `📝 ثبت تراکنش برای مشتری: *${getVal(acc, ['Name', 'name'])}*\n\nلطفاً *مبلغ تراکنش* را ارسال کنید (پشتیبانی از اعداد فارسی و انگلیسی):`);
      }
      return res.status(200).json({ ok: true });
    }

    // مدیریت مرحله‌ای ثبت تراکنش از طریق پیام متنی ربات
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = String(update.message.text).trim();

      let st = userStates[userId];

      if (st && st.step === 'WAIT_AMOUNT') {
        let cleanAmt = parseFloat(toEnglishDigits(text));
        if (isNaN(cleanAmt) || cleanAmt <= 0) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ وارد شده معتبر نیست. لطفاً فقط یک عدد صحیح وارد کنید:');
          return res.status(200).json({ ok: true });
        }
        st.amount = cleanAmt;
        st.step = 'WAIT_DIRECTION';
        await sendTelegramMsg(chatId, `💰 مبلغ ثبت شد: *${formatMoney(cleanAmt)}*\n\nحالا جهت تراکنش را انتخاب کنید:`, {
          inline_keyboard: [
            [{ text: '🟢 بستانکار (ورودی +)', callback_data: 'TX_DIR:بستانکار' }, { text: '🔴 بدهکار (خروجی -)', callback_data: 'TX_DIR:بدهکار' }]
          ]
        });
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAIT_DIRECTION') {
        // دریافت جهت از متن یا دکمه
        st.direction = text.includes('بدهکار') ? 'بدهکار' : 'بستانکار';
        st.step = 'WAIT_CURRENCY';
        await sendTelegramMsg(chatId, `✅ جهت تراکنش ثبت شد.\n\nحالا واحد ارز را انتخاب کنید (مثلاً: AFN, USD, تومان):`);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAIT_CURRENCY') {
        st.currency = text.toUpperCase();
        st.step = 'WAIT_DESC';
        await sendTelegramMsg(chatId, `✅ ارز ثبت شد: *${st.currency}*\n\nدر نهایت، *توضیحات یا شرح تراکنش* را ارسال کنید:`);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAIT_DESC') {
        st.description = text;

        const txPayload = {
          TransID: 'TX-' + Math.floor(10000000 + Math.random() * 90000000),
          AccountID: st.accId,
          Direction: st.direction || 'بستانکار',
          Amount: st.amount,
          Currency: st.currency || 'AFN',
          OperationType: 'امانت',
          Description: st.description,
          Date: new Date().toISOString()
        };

        const { error } = await supabase.from('transactions').insert([txPayload]);
        let targetAccId = st.accId;
        let targetName = st.accName;
        delete userStates[userId];

        if (!error) {
          let liveBal = await getAccountLiveBalanceText(targetAccId);
          await sendTelegramMsg(chatId, `✅ *تراکنش با موفقیت در جدول ثبت شد!*\n\n👤 مشتری: *${targetName}*\n💰 مبلغ: *${formatMoney(txPayload.Amount)} ${txPayload.Currency}* (${txPayload.Direction})\n📝 شرح: ${txPayload.Description}\n\n${liveBal}`);
        } else {
          await sendTelegramMsg(chatId, `❌ خطا در ذخیره تراکنش در پایگاه داده.`);
        }
        return res.status(200).json({ ok: true });
      }
    }
  } catch (err) {
    console.error("Transaction Error:", err);
  }

  return res.status(200).json({ ok: true });
};
