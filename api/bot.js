
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// تنظیم مستقیم مشخصات Supabase و توکن تلگرام
const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8900776593:AAG1OBNUY_4oo5VJ7Ohmrz9EgHYNmQeGH3Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

// تبدیل اعداد فارسی/عربی به انگلیسی
function toEnglishDigits(str) {
  if (!str) return '';
  return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
    return d.charCodeAt(0) >= 1776 ? d.charCodeAt(0) - 1776 : d.charCodeAt(0) - 1632;
  });
}

// تابع هوشمند پردازش متن
function parseTransactionText(text) {
  const cleanText = toEnglishDigits(text);

  // ۱. استخراج مبلغ (اولین عدد پیدا شده)
  const amountMatch = cleanText.match(/\d+(\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null;

  // ۲. تشخیص واحد پول / ارز
  let currency = 'USD'; // پیش‌فرض
  if (text.includes('افغانی') || text.includes('AFN')) currency = 'AFN';
  else if (text.includes('تومان') || text.includes('تومن')) currency = 'تومان';
  else if (text.includes('دینار') || text.includes('IQD')) currency = 'IQD';

  // ۳. تشخیص جهت تراکنش
  const isCredit = text.includes('دریافت') || text.includes('رسید') || text.includes('آمد');
  const direction = isCredit ? 'بستانکار' : 'بدهکار';

  // ۴. تشخیص نوع عملیات
  let opType = 'امانت'; // پیش‌فرض
  if (text.includes('حواله')) opType = 'حواله';
  else if (text.includes('تسویه')) opType = 'تسویه';
  else if (text.includes('انتقال')) opType = 'انتقال';
  else if (text.includes('معامله')) opType = 'معامله';

  return { amount, currency, direction, opType, rawText: text };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server Ready');
  }

  try {
    const update = req.body;

    // 🔴 بخش اول: مدیریت کلیک روی دکمه‌های شیشه‌ای (تأیید / لغو)
    if (update.callback_query) {
      const query = update.callback_query;
      const data = query.data;

      if (data.startsWith('CONFIRM:')) {
        const [, accId, amount, currency, direction, opType, ...descParts] = data.split(':');
        const description = descParts.join(':');

        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString();

        // ثبت در جدول transactions
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
          await bot.answerCallbackQuery(query.id, { text: '❌ خطا در ثبت تراکنش: ' + error.message, show_alert: true });
        } else {
          await bot.answerCallbackQuery(query.id, { text: '✅ تراکنش با موفقیت ثبت شد' });
          await bot.editMessageText(
            `✅ **تراکنش با موفقیت در دیتابیس ثبت شد.**\n\n` +
            `🆔 کُد تراکنش: \`${transId}\`\n` +
            `💰 مبلغ: *${parseFloat(amount).toLocaleString()} ${currency}* (${direction})\n` +
            `📝 شرح: ${description || '-'}`,
            {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        }
      } else if (data === 'CANCEL') {
        await bot.answerCallbackQuery(query.id, { text: 'عملیات لغو شد' });
        await bot.editMessageText('❌ **ثبت تراکنش لغو شد.**', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
      }

      return res.status(200).send('OK');
    }

    // 🟢 بخش دوم: دریافت پیام متنی از کاربر
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text === '/start') {
        await bot.sendMessage(chatId, 'سلام! پیام خود را جهت ثبت تراکنش ارسال کنید.\nمثال: `دریافت شد ۵۰۰ دلار از احمد بابت تسویه`', { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
      }

      const parsed = parseTransactionText(text);

      if (!parsed.amount) {
        await bot.sendMessage(chatId, '⚠️ مبلغ تراکنش در متن ورودی تشخیص داده نشد. لطفاً عدد مبلغ را مشخص کنید.');
        return res.status(200).send('OK');
      }

      // جستجوی حساب مشتری در دیتابیس
      const { data: accounts } = await supabase.from('accounts').select('*');
      let matchedAcc = null;

      if (accounts && accounts.length > 0) {
        matchedAcc = accounts.find(acc => {
          const name = (acc.Name || acc.name || '').toLowerCase();
          return name && text.toLowerCase().includes(name);
        });
      }

      const accName = matchedAcc ? (matchedAcc.Name || matchedAcc.name) : 'نامشخص/انتخاب نشده';
      const accId = matchedAcc ? (matchedAcc.AccountID || matchedAcc.accountid) : '';

      if (!matchedAcc) {
        await bot.sendMessage(chatId, `🔍 **پیش‌نمایش تراکنش:**\n\n⚠️ **نام مشتری در دیتابیس یافت نشد.**\nمبلغ: *${parsed.amount.toLocaleString()} ${parsed.currency}*\nجهت: *${parsed.direction}*\nشرح: _${text}_\n\nلطفاً نام مشتری را دقیق‌تر بنویسید یا ابتدا حسابش را ایجاد کنید.`, { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
      }

      const callbackConfirm = `CONFIRM:${accId}:${parsed.amount}:${parsed.currency}:${parsed.direction}:${parsed.opType}:${text.slice(0, 30)}`;

      // ارسال پیش‌نمایش همراه با دکمه‌های شیشه‌ای
      await bot.sendMessage(
        chatId,
        `📋 **پیش‌نمایش تراکنش جهت تأیید:**\n\n` +
        `👤 **مشتری:** ${accName}\n` +
        `💰 **مبلغ:** *${parsed.amount.toLocaleString()} ${parsed.currency}*\n` +
        `🔄 **جهت:** *${parsed.direction}* (${parsed.opType})\n` +
        `📝 **شرح:** _${text}_\n\n` +
        `آیا اطلاعات فوق مورد تأیید است؟`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟢 تأیید و ثبت نهایی', callback_data: callbackConfirm },
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
