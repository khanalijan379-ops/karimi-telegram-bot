const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8900776593:AAG1OBNUY_4oo5VJ7Ohmrz9EgHYNmQeGH3Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

const MASTER_ADMIN_ID = 802655440;

function toEnglishDigits(str) {
  if (!str) return '';
  return String(str)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

// پارسر هوشمند متن برای تشخیص عملیات صرافی، کارگزار یا مشتری
function parseTransactionText(text) {
  const cleanText = toEnglishDigits(text);
  const amountMatch = cleanText.match(/\d+(\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null;

  let currency = 'USD';
  if (text.includes('افغانی') || text.includes('AFN')) currency = 'AFN';
  else if (text.includes('تومان') || text.includes('تومن')) currency = 'تومان';
  else if (text.includes('دینار') || text.includes('IQD')) currency = 'IQD';

  const isCredit = text.includes('دریافت') || text.includes('رسید') || text.includes('آمد') || text.includes('بستانکار');
  const direction = isCredit ? 'بستانکار' : 'بدهکار';

  let opType = 'امانت';
  if (text.includes('حواله')) opType = 'حواله';
  else if (text.includes('تسویه')) opType = 'تسویه';
  else if (text.includes('انتقال')) opType = 'انتقال';
  else if (text.includes('معامله')) opType = 'معامله';
  else if (text.includes('پرداخت')) opType = 'پرداخت';

  const isBrokerTx = text.includes('صرافی') || text.includes('کارگزار') || text.includes('نرخ');

  return { amount, currency, direction, opType, isBrokerTx, rawText: text };
}

async function isAuthorizedAdmin(userId) {
  if (Number(userId) === MASTER_ADMIN_ID) return true;
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins && admins.length > 0) {
      return admins.some(adm => String(adm.ChatID || adm.chatid || '') === String(userId));
    }
  } catch (e) {
    console.error("Admin check error:", e);
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server Ready');
  }

  try {
    const update = req.body;

    // مدیریت دکمه‌های شیشه‌ای (تایید نهایی ثبت تراکنش در دیتابیس)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز', show_alert: true });
        return res.status(200).send('OK');
      }

      const data = query.data;

      if (data.startsWith('CONFIRM_CUST:')) {
        const [, accId, amount, currency, direction, opType, ...descParts] = data.split(':');
        const description = descParts.join(':');
        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString();

        // ثبت تراکنش مشتری دقیقا مانند دکمه ذخیره در وب
        const { error } = await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: accId,
          Direction: direction,
          Amount: parseFloat(amount),
          Currency: currency,
          OperationType: opType,
          Description: description,
          Date: txDate
        }]);

        if (error) {
          await bot.answerCallbackQuery(query.id, { text: '❌ خطا: ' + error.message, show_alert: true });
        } else {
          await bot.answerCallbackQuery(query.id, { text: '✅ تراکنش مشتری ثبت شد' });
          await bot.editMessageText(
            `✅ *تراکنش مشتری در دیتابیس ثبت گردید.*\n\n` +
            `🆔 کُد: \`${transId}\`\n` +
            `💰 مبلغ: *${parseFloat(amount).toLocaleString()} ${currency}* (${direction})\n` +
            `📝 شرح: ${description || '-'}`,
            { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown' }
          );
        }
      } else if (data === 'CANCEL') {
        await bot.answerCallbackQuery(query.id, { text: 'عملیات لغو شد' });
        await bot.editMessageText('❌ *عملیات لغو گردید.*', { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: 'Markdown' });
      }

      return res.status(200).send('OK');
    }

    // دریافت پیام متنی از تلگرام ادمین
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.sendMessage(chatId, '⛔ این ربات اختصاصی است.');
        return res.status(200).send('OK');
      }

      if (text === '/start') {
        await bot.sendMessage(
          chatId,
          `✨ *سامانه هوشمند ثبت سریع تراکنش‌ها* ✨\n\n` +
          `پیام خود را برای ثبت در بخش مشتریان یا کارگزاران ارسال کنید.\n` +
          `مثال مشتری: \`دریافت شد ۵۰۰ دلار از احمد بابت تسویه\``,
          { parse_mode: 'Markdown' }
        );
        return res.status(200).send('OK');
      }

      const parsed = parseTransactionText(text);

      if (!parsed.amount) {
        await bot.sendMessage(chatId, '⚠️ مبلغ معتبری در متن تشخیص داده نشد.');
        return res.status(200).send('OK');
      }

      // جستجوی مشتری در دیتابیس برای اتصال معامله
      const { data: accounts } = await supabase.from('accounts').select('*');
      let matchedAcc = null;

      if (accounts && accounts.length > 0) {
        matchedAcc = accounts.find(acc => {
          const name = (acc.Name || acc.name || '').toLowerCase();
          return name && text.toLowerCase().includes(name);
        });
      }

      const accName = matchedAcc ? (matchedAcc.Name || matchedAcc.name) : 'نامشخص';
      const accId = matchedAcc ? (matchedAcc.AccountID || matchedAcc.accountid) : '';

      if (!matchedAcc) {
        await bot.sendMessage(
          chatId,
          `⚠️ *مشتری در سیستم یافت نشد.*\nمبلغ: *${parsed.amount.toLocaleString()} ${parsed.currency}*\nلطفاً نام مشتری را در متن ذکر کنید یا ابتدا حسابش را در وب بسازید.`,
          { parse_mode: 'Markdown' }
        );
        return res.status(200).send('OK');
      }

      const callbackData = `CONFIRM_CUST:${accId}:${parsed.amount}:${parsed.currency}:${parsed.direction}:${parsed.opType}:${text.slice(0, 30)}`;

      // ارسال پیش‌نمایش تعاملی با دکمه‌های شیشه‌ای
      await bot.sendMessage(
        chatId,
        `📋 *پیش‌نمایش تراکنش (شبیه پنل وب):*\n\n` +
        `👤 *مشتری:* ${accName} (\`${accId}\`)\n` +
        `💰 *مبلغ:* *${parsed.amount.toLocaleString()} ${parsed.currency}*\n` +
        `🔄 *جهت و نوع:* *${parsed.direction}* (${parsed.opType})\n` +
        `📝 *شرح:* _${text}_\n\n` +
        `آیا تایید می‌کنید؟`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟢 تایید و ثبت نهایی', callback_data: callbackData },
                { text: '🔴 لغو', callback_data: 'CANCEL' }
              ]
            ]
          }
        }
      );
    }

  } catch (err) {
    console.error('Bot Error:', err);
  }

  return res.status(200).send('OK');
};
