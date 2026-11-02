const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// تنظیمات اتصال به دیتابیس Supabase و توکن تلگرام
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8900776593:AAG1OBNUY_4oo5VJ7Ohmrz9EgHYNmQeGH3Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

const MASTER_ADMIN_ID = 802655440;

// تبدیل اعداد فارسی/عربی به انگلیسی جهت پردازش دقیق محاسباتی
function toEnglishDigits(str) {
  if (!str) return '';
  return String(str)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

// بررسی دسترسی ادمین (مالک اصلی یا همکاران ثبت‌شده در جدول admins)
async function isAuthorizedAdmin(userId) {
  if (Number(userId) === MASTER_ADMIN_ID) return true;
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins && admins.length > 0) {
      return admins.some(adm => String(adm.ChatID || adm.chatid || '') === String(userId));
    }
  } catch (e) {
    console.error("Admin Auth Error:", e);
  }
  return false;
}

// پارسر هوشمند متن تراکنش (مشتری یا صرافی/کارگزار)
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

  const isBrokerTx = text.includes('صرافی') || text.includes('کارگزار') || text.includes('نرخ') || text.includes('براکر');

  return { amount, currency, direction, opType, isBrokerTx, rawText: text };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running & Ready');
  }

  try {
    const update = req.body;

    // 🔴 ۱. مدیریت کلیک روی دکمه‌های شیشه‌ای (تایید یا لغو تراکنش)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز به دکمه‌ها.', show_alert: true });
        return res.status(200).send('OK');
      }

      const data = query.data;

      if (data.startsWith('CONFIRM_CUST:')) {
        const [, accId, amount, currency, direction, opType, ...descParts] = data.split(':');
        const description = descParts.join(':');
        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString();

        // ثبت در جدول تراکنش‌های مشتریان (دقیقاً مشابه وب)
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
          await bot.answerCallbackQuery(query.id, { text: '❌ خطا در ثبت: ' + error.message, show_alert: true });
        } else {
          await bot.answerCallbackQuery(query.id, { text: '✅ تراکنش با موفقیت در سیستم ثبت شد.' });
          await bot.editMessageText(
            `✅ *معامله مشتری در دیتابیس ثبت گردید.*\n\n` +
            `🆔 کُد: \`${transId}\`\n` +
            `💰 مبلغ: *${parseFloat(amount).toLocaleString()} ${currency}* (${direction})\n` +
            `📝 شرح: ${description || '-'}`,
            {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );

          // ارسال پیام به مشتری در صورت داشتن چت‌آیدی
          try {
            const { data: accData } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
            if (accData && (accData.ChatID || accData.chatid)) {
              const custChatId = accData.ChatID || accData.chatid;
              await bot.sendMessage(
                custChatId,
                `✨ *ثبت تراکنش جدید در حساب شما* ✨\n\n` +
                `🔹 نوع: *${opType}* (${direction})\n` +
                `💰 مبلغ: *${parseFloat(amount).toLocaleString()} ${currency}*\n` +
                `📝 شرح: ${description || '-'}`,
                { parse_mode: 'Markdown' }
              );
            }
          } catch (e) {
            console.log("Could not send to customer chat:", e);
          }
        }
      } else if (data.startsWith('CONFIRM_BROKER:')) {
        const [, brokerId, amount, currency, direction, opType, ...descParts] = data.split(':');
        const description = descParts.join(':');
        const brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString().split('T')[0];

        // ثبت در جدول تراکنش‌های کارگزار / صرافی (مشابه صفحه broker.html)
        const { error } = await supabase.from('broker_transactions').insert([{
          broker_tx_id: brokerTxId,
          broker_id: brokerId,
          date: txDate,
          operation_type: opType,
          direction: direction,
          currency: currency,
          amount_initial: parseFloat(amount),
          amount_final: parseFloat(amount),
          description: description
        }]);

        if (error) {
          await bot.answerCallbackQuery(query.id, { text: '❌ خطا در ثبت صرافی: ' + error.message, show_alert: true });
        } else {
          await bot.answerCallbackQuery(query.id, { text: '✅ معامله صرافی ثبت شد.' });
          await bot.editMessageText(
            `✅ *معامله صرافی/کارگزار با موفقیت ثبت شد.*\n\n` +
            `🆔 کُد: \`${brokerTxId}\`\n` +
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
        await bot.answerCallbackQuery(query.id, { text: 'عملیات لغو شد.' });
        await bot.editMessageText('❌ *این تراکنش توسط ادمین لغو گردید.*', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
      }

      return res.status(200).send('OK');
    }

    // 🟢 ۲. دریافت پیام‌های متنی از سوی ادمین
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.sendMessage(chatId, '⛔ این ربات اختصاصی بوده و دسترسی شما مجاز نیست.');
        return res.status(200).send('OK');
      }

      if (text === '/start') {
        // ارسال کیبورد منوی سریع زیر پیام خوش‌آمدگویی
        await bot.sendMessage(
          chatId,
          `✨ *سامانه هوشمند مدیریت حساب‌کتاب و صرافی* ✨[cite: 8, 10]\n\n` +
          `سلام ادمین گرامی؛ برای ثبت تراکنش، متن خود را به صورت طبیعی ارسال کنید.\n\n` +
          `📌 *مثال ثبت مشتری:* \`دریافت شد ۵۰۰ دلار از احمد بابت تسویه\`\n` +
          `📌 *مثال ثبت صرافی:* \`صرافی: ارسال شد ۱۰۰۰ دلار به برادران عظیمی بابت حواله\``,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [
                [{ text: '📊 گزارش مانده کل' }, { text: '📜 آخرین تراکنش‌ها' }]
              ],
              resize_keyboard: true
            }
          }
        );
        return res.status(200).send('OK');
      }

      if (text === '📊 گزارش مانده کل') {
        // محاسبه و ارسال مانده کل حساب‌ها
        const { data: accs } = await supabase.from('accounts').select('*');
        const { data: txs } = await supabase.from('transactions').select('*');
        
        let totals = {};
        if (accs && txs) {
          txs.forEach(t => {
            let curr = (t.Currency || t.currency || 'USD').toUpperCase();
            let dir = t.Direction || t.direction || '';
            let amt = parseFloat(t.Amount || t.amount) || 0;
            if (!totals[curr]) totals[curr] = 0;
            if (dir.includes('بستانکار')) totals[curr] += amt;
            if (dir.includes('بدهکار')) totals[curr] -= amt;
          });
        }

        let report = `📊 *گزارش موجودی و مانده کل سیستم:*\n`;
        for (let c in totals) {
          report += `• ارز *${c}*: \`${totals[c].toLocaleString()}\`\n`;
        }
        await bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
      }

      // تجزیه هوشمند متن تراکنش
      const parsed = parseTransactionText(text);

      if (!parsed.amount) {
        await bot.sendMessage(chatId, '⚠️ مبلغ معتبری در متن تشخیص داده نشد. لطفاً مبلغ را با عدد وارد کنید.');
        return res.status(200).send('OK');
      }

      // تشخیص اینکه آیا معامله مربوط به صرافی/کارگزار است یا مشتری
      if (parsed.isBrokerTx) {
        // جستجوی صرافی فعال یا اولین صرافی
        const { data: brokers } = await supabase.from('brokers').select('*');
        let activeBroker = brokers && brokers.length > 0 ? brokers[0] : null;

        if (!activeBroker) {
          await bot.sendMessage(chatId, '⚠️ هیچ صرافی‌ای در دیتابیس ثبت نشده است. ابتدا یک صرافی در وب ایجاد کنید.');
          return res.status(200).send('OK');
        }

        const callbackData = `CONFIRM_BROKER:${activeBroker.broker_id || activeBroker.BrokerID}:${parsed.amount}:${parsed.currency}:${parsed.direction}:${parsed.opType}:${text.slice(0, 30)}`;

        await bot.sendMessage(
          chatId,
          `🏛️ *پیش‌نمایش معامله صرافی/کارگزار:*\n\n` +
          `🏢 صرافی: *${activeBroker.name}*\n` +
          `💰 مبلغ: *${parsed.amount.toLocaleString()} ${parsed.currency}*\n` +
          `🔄 جهت و نوع: *${parsed.direction}* (${parsed.opType})\n` +
          `📝 شرح: _${text}_\n\n` +
          `آیا این معامله در بخش صرافی ثبت شود؟`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🟢 تایید و ثبت در صرافی', callback_data: callbackData },
                  { text: '🔴 لغو', callback_data: 'CANCEL' }
                ]
              ]
            }
          }
        );
        return res.status(200).send('OK');
      }

      // جستجوی مشتری در جدول accounts
      const { data: accounts } = await supabase.from('accounts').select('*');
      let matchedAcc = null;

      if (accounts && accounts.length > 0) {
        matchedAcc = accounts.find(acc => {
          let name = (acc.Name || acc.name || '').toLowerCase();
          return name && text.toLowerCase().includes(name);
        });
      }

      if (!matchedAcc) {
        await bot.sendMessage(
          chatId,
          `⚠️ *مشتری مورد نظر در دیتابیس یافت نشد.*\n` +
          `مبلغ استخراج‌شده: *${parsed.amount.toLocaleString()} ${parsed.currency}*\n` +
          `لطفاً نام مشتری را واضح‌تر بنویسید یا حساب او را در پنل وب ایجاد کنید.`,
          { parse_mode: 'Markdown' }
        );
        return res.status(200).send('OK');
      }

      const accId = matchedAcc.AccountID || matchedAcc.accountid;
      const accName = matchedAcc.Name || matchedAcc.name;
      const callbackCust = `CONFIRM_CUST:${accId}:${parsed.amount}:${parsed.currency}:${parsed.direction}:${parsed.opType}:${text.slice(0, 30)}`;

      // ارسال پیش‌نمایش همراه با دکمه‌های شیشه‌ای تعاملی (تایید / لغو)
      await bot.sendMessage(
        chatId,
        `📋 *پیش‌نمایش تراکنش مشتری (هماهنگ با وب):*\n\n` +
        `👤 *مشتری:* ${accName} (\`${accId}\`)\n` +
        `💰 *مبلغ:* *${parsed.amount.toLocaleString()} ${parsed.currency}*\n` +
        `🔄 *نوع عملیات:* *${parsed.direction}* (${parsed.opType})\n` +
        `📝 *شرح متن:* _${text}_\n\n` +
        `آیا اطلاعات تایید می‌شود؟`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟢 تایید و ثبت نهایی', callback_data: callbackCust },
                { text: '🔴 لغو', callback_data: 'CANCEL' }
              ]
            ]
          }
        }
      );
    }

  } catch (err) {
    console.error('Bot Server Critical Error:', err);
  }

  return res.status(200).send('OK');
};
