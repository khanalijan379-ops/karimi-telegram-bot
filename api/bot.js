const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8900776593:AAG1OBNUY_4oo5VJ7Ohmrz9EgHYNmQeGH3Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

const MASTER_ADMIN_ID = 802655440;

// حافظه موقت برای نگهداری وضعیت پویای هر ادمین در حال ثبت تراکنش
const userStates = {};

function toEnglishDigits(str) {
  if (!str) return '';
  return String(str)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

async function isAuthorizedAdmin(userId) {
  if (Number(userId) === MASTER_ADMIN_ID) return true;
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins && admins.length > 0) {
      return admins.some(adm => String(adm.ChatID || adm.chatid || '') === String(userId));
    }
  } catch (e) {
    console.error("Auth Error:", e);
  }
  return false;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running & Ready');
  }

  try {
    const update = req.body;

    // ۱. مدیریت کلیک روی دکمه‌های شیشه‌ای (داخل صفحه چت)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز', show_alert: true });
        return res.status(200).send('OK');
      }

      const data = query.data;

      // الف) انتخاب حساب مشتری از لیست جستجوی پویا
      if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        
        // دریافت نام مشتری از دیتابیس
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        const accName = acc ? (acc.Name || acc.name) : accId;

        if (!userStates[userId]) userStates[userId] = {};
        userStates[userId].accId = accId;
        userStates[userId].accName = accName;
        userStates[userId].step = 'WAITING_FOR_AMOUNT';

        await bot.answerCallbackQuery(query.id, { text: `حساب ${accName} انتخاب شد.` });
        await bot.editMessageText(
          `👤 مشتری انتخاب‌شده: *${accName}* (\`${accId}\`)\n\n` +
          `اکنون **مبلغ و واحد ارز** را بفرستید (مثلاً: \`800 دلار\` یا \`5000 افغانی\` یا \`10000 تومان\`):`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          }
        );
      } 
      // ب) انتخاب جهت تراکنش (بستانکار / بدهکار) با دکمه شیشه‌ای
      else if (data.startsWith('SET_DIR:')) {
        const direction = data.split(':')[1];
        if (!userStates[userId]) userStates[userId] = {};
        userStates[userId].direction = direction;
        userStates[userId].step = 'WAITING_FOR_OPTYPE';

        // نمایش دکمه‌های شیشه‌ای برای انتخاب نوع عملیات
        await bot.answerCallbackQuery(query.id, { text: `جهت: ${direction}` });
        await bot.editMessageText(
          `🔄 جهت انتخاب‌شده: *${direction}*\n\n` +
          `حالا نوع عملیات را انتخاب کنید:`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🤝 امانت', callback_data: 'SET_OP:امانت' },
                  { text: '📜 حواله', callback_data: 'SET_OP:حواله' }
                ],
                [
                  { text: '💳 تسویه', callback_data: 'SET_OP:تسویه' },
                  { text: '🔄 انتقال', callback_data: 'SET_OP:انتقال' }
                ]
              ]
            }
          }
        );
      }
      // ج) انتخاب نوع عملیات و ثبت نهایی در دیتابیس
      else if (data.startsWith('SET_OP:')) {
        const opType = data.split(':')[1];
        const state = userStates[userId];

        if (!state || !state.accId) {
          await bot.answerCallbackQuery(query.id, { text: '❌ نشست منقضی شد. دوباره شروع کنید.', show_alert: true });
          return res.status(200).send('OK');
        }

        state.opType = opType;
        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString();

        // ثبت تراکنش در جدول Supabase
        const { error } = await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: state.accId,
          Direction: state.direction,
          Amount: state.amount,
          Currency: state.currency,
          OperationType: state.opType,
          Description: state.description || 'ثبت پویا از طریق ربات تلگرام',
          Date: txDate
        }]);

        if (error) {
          await bot.answerCallbackQuery(query.id, { text: '❌ خطا در ثبت دیتابیس', show_alert: true });
        } else {
          await bot.answerCallbackQuery(query.id, { text: '✅ تراکنش با موفقیت ثبت شد!' });
          await bot.editMessageText(
            `✅ *معامله با موفقیت در سیستم ثبت گردید.*\n\n` +
            `👤 مشتری: *${state.accName}*\n` +
            `🆔 کُد تراکنش: \`${transId}\`\n` +
            `💰 مبلغ: *${state.amount.toLocaleString()} ${state.currency}* (${state.direction})\n` +
            `🔄 نوع: ${state.opType}\n` +
            `📅 تاریخ: ${new Date().toLocaleDateString('fa-IR')}`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );

          // پاکسازی حافظه موقت این ادمین
          delete userStates[userId];
        }
      }
      else if (data === 'CANCEL') {
        delete userStates[userId];
        await bot.answerCallbackQuery(query.id, { text: 'عملیات لغو شد.' });
        await bot.editMessageText('❌ *عملیات لغو گردید.*', {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
      }

      return res.status(200).send('OK');
    }

    // ۲. مدیریت پیام‌های متنی ارسالی ادمین
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.sendMessage(chatId, '⛔ دسترسی غیرمجاز.');
        return res.status(200).send('OK');
      }

      if (text === '/start' || text === '↩️ شروع مجدد') {
        delete userStates[userId];
        await bot.sendMessage(
          chatId,
          `✨ *سامانه هوشمند و پویا مدیریت حساب‌کتاب* ✨\n\n` +
          `برای شروع ثبت تراکنش، کافیست **نام مشتری** را بفرستید (مثلاً: \`زهرا انوری\` یا \`احمد\`)[cite: 8].`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [
                [{ text: '📊 گزارش مانده کل' }, { text: '↩️ شروع مجدد' }]
              ],
              resize_keyboard: true
            }
          }
        );
        return res.status(200).send('OK');
      }

      if (text === '📊 گزارش مانده کل') {
        const { data: txs } = await supabase.from('transactions').select('*');
        let totals = {};
        if (txs) {
          txs.forEach(t => {
            let curr = (t.Currency || t.currency || 'USD').toUpperCase();
            let dir = t.Direction || t.direction || '';
            let amt = parseFloat(t.Amount || t.amount) || 0;
            if (!totals[curr]) totals[curr] = 0;
            if (dir.includes('بستانکار')) totals[curr] += amt;
            if (dir.includes('بدهکار')) totals[curr] -= amt;
          });
        }
        let rep = `📊 *موجودی و مانده کل سیستم:*\n`;
        for (let c in totals) rep += `• ${c}: \`${totals[c].toLocaleString()}\`\n`;
        await bot.sendMessage(chatId, rep, { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
      }

      // بررسی وضعیت جاری ادمین در ماشین حالت پویا
      let state = userStates[userId];

      // مرحله ۱: اگر ادمین منتظر ورود مبلغ است
      if (state && state.step === 'WAITING_FOR_AMOUNT') {
        const cleanText = toEnglishDigits(text);
        const amountMatch = cleanText.match(/\d+(\.\d+)?/);
        const amount = amountMatch ? parseFloat(amountMatch[0]) : null;

        if (!amount) {
          await bot.sendMessage(chatId, '⚠️ مبلغ معتبری تشخیص داده نشد. لطفاً مبلغ را به همراه عدد وارد کنید (مثلاً: 800 دلار):');
          return res.status(200).send('OK');
        }

        let currency = 'USD';
        if (text.includes('افغانی') || text.includes('AFN')) currency = 'AFN';
        else if (text.includes('تومان') || text.includes('تومن')) currency = 'تومان';
        else if (text.includes('دینار') || text.includes('IQD')) currency = 'IQD';

        state.amount = amount;
        state.currency = currency;
        state.description = text;
        state.step = 'WAITING_FOR_DIRECTION';

        // نمایش دکمه‌های شیشه‌ای داخل چت برای انتخاب جهت (بستانکار / بدهکار)
        await bot.sendMessage(
          chatId,
          `💰 مبلغ: *${amount.toLocaleString()} ${currency}*\n\n` +
          `اکنون **جهت تراکنش** را انتخاب کنید:`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🟢 بستانکار (دریافت / رساندن +)', callback_data: 'SET_DIR:بستانکار' },
                  { text: '🔴 بدهکار (پرداخت / دادن -)', callback_data: 'SET_DIR:بدهکار' }
                ],
                [
                  { text: '❌ انصراف', callback_data: 'CANCEL' }
                ]
              ]
            }
          }
        );
        return res.status(200).send('OK');
      }

      // مرحله پیش‌فرض: جستجوی پویای نام مشتری در دیتابیس
      const { data: accounts } = await supabase.from('accounts').select('*');
      let matchedAccs = [];

      if (accounts && accounts.length > 0) {
        matchedAccs = accounts.filter(acc => {
          let name = (acc.Name || acc.name || '').toLowerCase();
          return name && text.toLowerCase().includes(name);
        });
      }

      if (matchedAccs.length === 0) {
        await bot.sendMessage(
          chatId,
          `⚠️ مشتری با نام «*${text}*» در دیتابیس یافت نشد.\n` +
          `لطفاً نام دیگری جستجو کنید یا ابتدا حساب مشتری را در پنل وب ایجاد کنید.`,
          { parse_mode: 'Markdown' }
        );
        return res.status(200).send('OK');
      }

      // ساخت دکمه‌های شیشه‌ای پویا بر اساس نتایج جستجوی مشتریان
      let inlineKeyboard = matchedAccs.map(acc => [
        {
          text: `👤 ${acc.Name || acc.name} (${acc.Phone || acc.phone || 'بدون تلفن'})`,
          callback_data: `SELECT_CUST:${acc.AccountID || acc.accountid}`
        }
      ]);
      inlineKeyboard.push([{ text: '❌ انصراف', callback_data: 'CANCEL' }]);

      userStates[userId] = { step: 'WAITING_FOR_CUST_SELECT' };

      await bot.sendMessage(
        chatId,
        `🔍 نتایج جستجوی مشتری برای «*${text}*»:\nلطفاً حساب مورد نظر را از دکمه‌های زیر انتخاب کنید:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        }
      );
    }

  } catch (err) {
    console.error('Dynamic Bot Error:', err);
  }

  return res.status(200).send('OK');
};
