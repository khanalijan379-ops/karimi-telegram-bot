const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || "8900776593:AAG1OBNUY_4oo5VJ7Ohmrz9EgHYNmQeGH3Y";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

const MASTER_ADMIN_ID = "802655440";
const MASTER_ADMIN_EMAIL = "mohammadsharifkarimi4@gmail.com";

// حافظه موقت حالت‌های تعاملی ادمین‌ها
const userStates = {};

// تبدیل اعداد فارسی/عربی به انگلیسی
function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

// فرمت‌دهی پول
function formatMoney(amount) {
  let num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return toEnglishDigits(num.toLocaleString('en-US'));
}

// بررسی احراز هویت ادمین
async function getAdminData(userId) {
  if (String(userId) === MASTER_ADMIN_ID) {
    return { id: 'master_owner', name: 'مدیر اصلی', email: MASTER_ADMIN_EMAIL, isMaster: true };
  }
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins && admins.length > 0) {
      const found = admins.find(a => String(a.ChatID || a.chatid || '') === String(userId));
      if (found) {
        return {
          id: String(found.AdminID || found.adminid || found.id),
          name: found.Name || found.name || 'ادمین همکار',
          email: (found.Email || found.email || '').toLowerCase(),
          isMaster: (found.Email || found.email || '').toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()
        };
      }
    }
  } catch (e) {
    console.error("Auth Exception:", e);
  }
  return null;
}

// پارسر هوشمند متون تراکنش
async function parseTransactionDetails(text, currentAccountId = null) {
  const cleanStr = toEnglishDigits(text);
  
  // استخراج مبلغ
  const amountMatch = cleanStr.match(/\d+(\.\d+)?/);
  let amount = amountMatch ? parseFloat(amountMatch[0]) : null;

  // استخراج ارز
  let currency = 'USD';
  if (text.includes('افغانی') || text.includes('AFN') || text.includes('افغانی')) currency = 'AFN';
  else if (text.includes('تومان') || text.includes('تومن') || text.includes('IRR')) currency = 'تومان';
  else if (text.includes('دینار') || text.includes('IQD')) currency = 'IQD';
  else if (text.includes('دلار') || text.includes('USD') || text.includes('دولار') || text.includes('دالر')) currency = 'USD';

  // استخراج جهت (بستانکار / بدهکار)
  let direction = 'بستانکار';
  if (
    text.includes('پرداخت') || text.includes('دادم') || text.includes('داده') || 
    text.includes('خرید') || text.includes('بدهکار') || text.includes('بده') ||
    text.includes('ارسال') || text.includes('برد')
  ) {
    direction = 'بدهکار';
  } else if (
    text.includes('دریافت') || text.includes('گرفتم') || text.includes('آمد') || 
    text.includes('رسید') || text.includes('بستانکار') || text.includes('واریز')
  ) {
    direction = 'بستانکار';
  }

  // استخراج نوع عملیات
  let opType = 'امانت';
  if (text.includes('حواله')) opType = 'حواله';
  else if (text.includes('تسویه')) opType = 'تسویه';
  else if (text.includes('انتقال')) opType = 'انتقال';
  else if (text.includes('معامله')) opType = 'معامله';
  else if (text.includes('پرداخت')) opType = 'پرداخت';
  else if (text.includes('دریافت')) opType = 'دریافت';

  // حالت ویژه: تسویه کامل حساب بر اساس مانده دیتابیس
  if (text.includes('تسویه') && (text.includes('کامل') || text.includes('صفر') || text.includes('همه') || !amount) && currentAccountId) {
    const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', currentAccountId);
    let net = 0;
    if (txs) {
      txs.filter(t => (t.Currency || t.currency || 'USD').toUpperCase() === currency).forEach(t => {
        let dir = t.Direction || t.direction || '';
        let a = parseFloat(t.Amount || t.amount) || 0;
        if (dir.includes('بستانکار')) net += a;
        if (dir.includes('بدهکار')) net -= a;
      });
    }
    if (net !== 0) {
      amount = Math.abs(net);
      direction = net > 0 ? 'بدهکار' : 'بستانکار'; // جهت معکوس برای صفر کردن
    }
  }

  return { amount, currency, direction, opType, rawText: text };
}

// محاسبه بیلان زنده حساب مشتری
async function getAccountLiveBalanceText(accId) {
  const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
  if (!txs || txs.length === 0) return 'تراکنشی ثبت نشده است.';

  let currs = {};
  txs.forEach(tx => {
    let curr = String(tx.Currency || tx.currency || 'USD').toUpperCase();
    let dir = String(tx.Direction || tx.direction || '');
    let amt = parseFloat(tx.Amount || tx.amount) || 0;
    if (!currs[curr]) currs[curr] = { credit: 0, debit: 0 };
    if (dir.includes("بستانکار")) currs[curr].credit += amt;
    if (dir.includes("بدهکار")) currs[curr].debit += amt;
  });

  let textParts = [];
  for (let curr in currs) {
    let cred = currs[curr].credit;
    let deb = currs[curr].debit;
    let net = cred - deb;
    let status = net > 0 ? `بستانکار (+): ${formatMoney(Math.abs(net))} ${curr}` : (net < 0 ? `بدهکار (-): ${formatMoney(Math.abs(net))} ${curr}` : `تسویه کامل (0)`);
    textParts.push(`🔹 *واحد ارز: ${curr}*\n  ▫️ کل بستانکاری: ${formatMoney(cred)} ${curr}\n  ▫️ کل بدهکاری: ${formatMoney(deb)} ${curr}\n  📌 *وضعیت مانده: ${status}*`);
  }
  return textParts.join('\n\n');
}

// محاسبه گزارش عمودی صرافی
async function getBrokerVerticalReport(brokerId) {
  const { data: txs } = await supabase.from('broker_transactions').select('*').eq('broker_id', brokerId);
  if (!txs || txs.length === 0) return 'بدون تراکنش فعال';

  let totals = {};
  txs.forEach(tx => {
    let curr = (tx.currency || 'USD').toUpperCase();
    let dir = tx.direction || '';
    let amt = parseFloat(tx.amount_final || tx.amount_initial) || 0;
    if (!totals[curr]) totals[curr] = { creditor: 0, debtor: 0 };
    if (dir === 'بستانکار') totals[curr].creditor += amt;
    if (dir === 'بدهکار') totals[curr].debtor += amt;
  });

  let lines = ["\n📊 *گزارش عمودی مانده صرافی:*"];
  for (let curr in totals) {
    let cred = totals[curr].creditor;
    let debt = totals[curr].debtor;
    let net = cred - debt;
    let status = net >= 0 ? "بستانکار" : "بدهکار";
    lines.push(`🔹 *ارز ${curr}:*`);
    lines.push(`  • کل بستانکار: \`${formatMoney(cred)}\``);
    lines.push(`  • کل بدهکار: \`${formatMoney(debt)}\``);
    lines.push(`  • مانده نهایی: *${formatMoney(Math.abs(net))} ${curr} (${status})*`);
    lines.push(`-----------------------------------`);
  }
  return lines.join('\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Telegram Bot Server Active');

  try {
    const update = req.body;

    // ==========================================
    // ۱. پردازش کلیک روی دکمه‌های شیشه‌ای (Inline Keyboards)
    // ==========================================
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;

      const admin = await getAdminData(userId);
      if (!admin) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز', show_alert: true });
        return res.status(200).send('OK');
      }

      const data = query.data;

      // 🔴 لغو / بازگشت به منوی اصلی
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText('✨ *سامانه مدیریت حساب‌کتاب و صرافی*', {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUST_MENU' }, { text: '🏛️ حساب صرافی‌ها', callback_data: 'NAV_BROKER_MENU' }]
            ]
          }
        });
        return res.status(200).send('OK');
      }

      // 👥 منوی بخش مشتریان
      if (data === 'NAV_CUST_MENU') {
        userStates[userId] = { step: 'WAITING_FOR_CUST_SEARCH' };
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, '🔍 *نام مشتری* را جهت جستجو وارد کنید:', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]] }
        });
        return res.status(200).send('OK');
      }

      // ➕ ایجاد حساب جدید مشتری
      if (data === 'NAV_CREATE_CUST') {
        userStates[userId] = { step: 'WAITING_FOR_NEW_CUST_NAME' };
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, '👤 *نام مشتری جدید* را وارد کنید:', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]] }
        });
        return res.status(200).send('OK');
      }

      // 👤 انتخاب مشتری و نمایش پروفایل اختصاصی
      if (data.startsWith('SEL_CUST:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        if (!acc) {
          await bot.answerCallbackQuery(query.id, { text: 'حساب یافت نشد', show_alert: true });
          return res.status(200).send('OK');
        }

        userStates[userId] = { selectedAccId: accId, selectedAccName: acc.Name || acc.name };
        await bot.answerCallbackQuery(query.id);

        const accName = acc.Name || acc.name;
        const phone = acc.Phone || acc.phone || '-';
        const cId = acc.ChatID || acc.chatid || '-';

        await bot.sendMessage(chatId, 
          `👤 *مدیریت حساب مشتری: ${accName}*\n` +
          `🆔 کُد حساب: \`${accId}\`\n` +
          `📞 تلفن: \`${phone}\` | 💬 چت‌آیدی: \`${cId}\``, 
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📊 دیدن مانده‌ها', callback_data: `CUST_BAL:${accId}` }, { text: '📜 دیدن تراکنش‌ها', callback_data: `CUST_TXS:${accId}` }],
                [{ text: '➕ ثبت تراکنش جدید (متنی)', callback_data: `CUST_ADD_TX:${accId}` }],
                [{ text: '✏️ ویرایش نام/تلفن مشتری', callback_data: `CUST_EDIT:${accId}` }, { text: '🗑️ حذف کامل حساب', callback_data: `CUST_DEL:${accId}` }],
                [{ text: '🔙 بازگشت', callback_data: 'NAV_CUST_MENU' }]
              ]
            }
          }
        );
        return res.status(200).send('OK');
      }

      // 📊 دیدن مانده‌های مشتری
      if (data.startsWith('CUST_BAL:')) {
        const accId = data.split(':')[1];
        const balText = await getAccountLiveBalanceText(accId);
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, `📊 *صورت‌حساب و مانده زنده:*\n\n${balText}`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: `SEL_CUST:${accId}` }]] }
        });
        return res.status(200).send('OK');
      }

      // 📜 دیدن تراکنش‌های مشتری
      if (data.startsWith('CUST_TXS:')) {
        const accId = data.split(':')[1];
        const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
        await bot.answerCallbackQuery(query.id);

        if (!txs || txs.length === 0) {
          await bot.sendMessage(chatId, 'هیچ تراکنشی ثبت نشده است.', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: `SEL_CUST:${accId}` }]] }
          });
          return res.status(200).send('OK');
        }

        let buttons = txs.slice().reverse().slice(0, 10).map(t => [
          {
            text: `#${toEnglishDigits(t.TransID || t.transid)} - ${formatMoney(t.Amount || t.amount)} ${t.Currency || t.currency} (${t.Direction || t.direction})`,
            callback_data: `TX_DETAIL:${t.TransID || t.transid}`
          }
        ]);
        buttons.push([{ text: '🔙 بازگشت', callback_data: `SEL_CUST:${accId}` }]);

        await bot.sendMessage(chatId, `📜 *لیست ۱۰ تراکنش اخیر:*`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons }
        });
        return res.status(200).send('OK');
      }

      // 🔍 جزئیات تراکنش مشتری
      if (data.startsWith('TX_DETAIL:')) {
        const txId = data.split(':')[1];
        const { data: tx } = await supabase.from('transactions').select('*').eq('TransID', txId).single();
        await bot.answerCallbackQuery(query.id);

        if (!tx) {
          await bot.sendMessage(chatId, 'تراکنش یافت نشد.');
          return res.status(200).send('OK');
        }

        const amt = formatMoney(tx.Amount || tx.amount);
        const curr = tx.Currency || tx.currency;
        const dir = tx.Direction || tx.direction;
        const op = tx.OperationType || tx.operationtype || 'امانت';
        const desc = (tx.Description || tx.description || '-').replaceAll('+', ' ');

        await bot.sendMessage(chatId,
          `🔍 *جزئیات تراکنش #${txId}*\n\n` +
          `💰 مبلغ: *${amt} ${curr}* (${dir})\n` +
          `🔹 نوع عملیات: *${op}*\n` +
          `📝 شرح: ${desc}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '💬 ارسال رسید واتساپ', callback_data: `WA_TX:${txId}` }],
                [{ text: '✏️ ویرایش تراکنش', callback_data: `EDIT_TX:${txId}` }, { text: '🗑️ حذف تراکنش', callback_data: `DEL_TX:${txId}` }],
                [{ text: '🔙 بازگشت', callback_data: `SEL_CUST:${tx.AccountID || tx.accountid}` }]
              ]
            }
          }
        );
        return res.status(200).send('OK');
      }

      // 🗑️ حذف تراکنش مشتری
      if (data.startsWith('DEL_TX:')) {
        const txId = data.split(':')[1];
        const { data: tx } = await supabase.from('transactions').select('*').eq('TransID', txId).single();
        if (tx) {
          const accId = tx.AccountID || tx.accountid;
          await supabase.from('transactions').delete().eq('TransID', txId);
          await bot.answerCallbackQuery(query.id, { text: '✅ تراکنش با موفقیت حذف شد.' });
          await bot.sendMessage(chatId, '🗑️ *تراکنش انتخاب‌شده حذف گردید.*', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به حساب', callback_data: `SEL_CUST:${accId}` }]] }
          });
        }
        return res.status(200).send('OK');
      }

      // ➕ شروع ثبت متنی تراکنش مشتری
      if (data.startsWith('CUST_ADD_TX:')) {
        const accId = data.split(':')[1];
        userStates[userId] = { step: 'WAITING_FOR_CUST_TX_TEXT', accId: accId };
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId,
          `📝 *ثبت یک‌جای تراکنش*\n` +
          `متن کامل تراکنش را بفرستید (مثال: \`800 دلار بابت حواله دریافت شد\`):`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: `SEL_CUST:${accId}` }]] }
          }
        );
        return res.status(200).send('OK');
      }

      // 🏛️ منوی صرافی‌ها
      if (data === 'NAV_BROKER_MENU') {
        let queryBuilder = supabase.from('brokers').select('*');
        if (!admin.isMaster) queryBuilder = queryBuilder.eq('CreatedBy', admin.id);
        const { data: brokers } = await queryBuilder;

        await bot.answerCallbackQuery(query.id);
        if (!brokers || brokers.length === 0) {
          await bot.sendMessage(chatId, 'هیچ صرافی‌ای ثبت نشده است.', {
            reply_markup: { inline_keyboard: [[{ text: '➕ صرافی جدید', callback_data: 'NEW_BROKER' }, { text: '🔙 اصلی', callback_data: 'NAV_MAIN' }]] }
          });
          return res.status(200).send('OK');
        }

        let buttons = brokers.map(b => [{ text: `🏛️ ${b.name} (${b.city || 'شهر مشخص نشده'})`, callback_data: `SEL_BROKER:${b.broker_id}` }]);
        buttons.push([{ text: '➕ صرافی جدید', callback_data: 'NEW_BROKER' }, { text: '🔙 اصلی', callback_data: 'NAV_MAIN' }]);

        await bot.sendMessage(chatId, '🏛️ *انتخاب صرافی فعال:*', {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons }
        });
        return res.status(200).send('OK');
      }

      // 🏛️ انتخاب صرافی و نمایش مدیریت آن
      if (data.startsWith('SEL_BROKER:')) {
        const bId = data.split(':')[1];
        const { data: b } = await supabase.from('brokers').select('*').eq('broker_id', bId).single();
        await bot.answerCallbackQuery(query.id);

        if (!b) return res.status(200).send('OK');

        userStates[userId] = { selectedBrokerId: bId, selectedBrokerName: b.name };

        await bot.sendMessage(chatId,
          `🏛️ *صرافی انتخاب‌شده: ${b.name}*\n` +
          `📞 تلفن: \`${b.phone || '-'}\` | شهر: \`${b.city || '-'}\``,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📊 دیدن مانده صرافی', callback_data: `BROKER_BAL:${bId}` }, { text: '📜 تراکنش‌های صرافی', callback_data: `BROKER_TXS:${bId}` }],
                [{ text: '➕ ثبت معامله صرافی (امکانات کامل)', callback_data: `BROKER_ADD_TX:${bId}` }],
                [{ text: '🔙 بازگشت به صرافی‌ها', callback_data: 'NAV_BROKER_MENU' }]
              ]
            }
          }
        );
        return res.status(200).send('OK');
      }

      // 📊 مانده عمودی صرافی
      if (data.startsWith('BROKER_BAL:')) {
        const bId = data.split(':')[1];
        const report = await getBrokerVerticalReport(bId);
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, report, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: `SEL_BROKER:${bId}` }]] }
        });
        return res.status(200).send('OK');
      }

      // ➕ شروع ثبت معامله صرافی
      if (data.startsWith('BROKER_ADD_TX:')) {
        const bId = data.split(':')[1];
        userStates[userId] = { step: 'WAITING_FOR_BROKER_TX_TEXT', brokerId: bId };
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId,
          `📝 *ثبت معامله صرافی*\n` +
          `متن کامل را ارسال کنید (مثال: \`معامله 1000 دلار به نرخ 68.5 بابت حواله صرافی مرکزی\`):`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ انصراف', callback_data: `SEL_BROKER:${bId}` }]] }
          }
        );
        return res.status(200).send('OK');
      }

      // 🟢 تایید و ذخیره کامل معامله صرافی در دیتابیس
      if (data.startsWith('CONFIRM_BROKER_SAVE:')) {
        const state = userStates[userId];
        if (!state || !state.pendingBrokerTx) {
          await bot.answerCallbackQuery(query.id, { text: 'خطا یا انقضای جلسه', show_alert: true });
          return res.status(200).send('OK');
        }

        const btx = state.pendingBrokerTx;
        const { error } = await supabase.from('broker_transactions').insert([btx]);

        if (error) {
          await bot.answerCallbackQuery(query.id, { text: 'خطا در ذخیره: ' + error.message, show_alert: true });
          return res.status(200).send('OK');
        }

        // بررسی اتصال هم‌زمان مشتری
        if (state.pendingCustomerTx) {
          let ctx = state.pendingCustomerTx;
          if (!ctx.AccountID) {
            // ساخت مشتری جدید اگر قبلاً نبوده
            const newAccId = "ACC-" + Math.floor(100000 + Math.random() * 900000);
            await supabase.from('accounts').insert([{
              AccountID: newAccId,
              Name: state.pendingCustomerName,
              CreatedBy: String(admin.id)
            }]);
            ctx.AccountID = newAccId;
          }
          await supabase.from('transactions').insert([ctx]);
        }

        delete userStates[userId];
        await bot.answerCallbackQuery(query.id, { text: '✅ معامله صرافی با موفقیت ثبت شد!' });
        await bot.sendMessage(chatId, `✅ *معامله صرافی با موفقیت در دیتابیس ثبت گردید.*`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🏛️ بازگشت به صرافی', callback_data: `SEL_BROKER:${btx.broker_id}` }]] }
        });
        return res.status(200).send('OK');
      }

    }

    // ==========================================
    // ۲. پردازش پیام‌های متنی (Message Text)
    // ==========================================
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      const admin = await getAdminData(userId);
      if (!admin) return res.status(200).send('OK');

      // دستور /start
      if (text === '/start') {
        delete userStates[userId];
        await bot.sendMessage(chatId, '✨ *سامانه مدیریت حساب‌کتاب و صرافی*', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUST_MENU' }, { text: '🏛️ حساب صرافی‌ها', callback_data: 'NAV_BROKER_MENU' }]
            ]
          }
        });
        return res.status(200).send('OK');
      }

      const state = userStates[userId] || {};

      // 🔍 گام ۱: جستجوی نام مشتری
      if (state.step === 'WAITING_FOR_CUST_SEARCH') {
        let queryBuilder = supabase.from('accounts').select('*');
        if (!admin.isMaster) queryBuilder = queryBuilder.eq('CreatedBy', admin.id);
        const { data: accounts } = await queryBuilder;

        const cleanQ = toEnglishDigits(text).toLowerCase();
        let filtered = [];
        if (accounts) {
          filtered = accounts.filter(a => {
            let n = (a.Name || a.name || '').toLowerCase();
            let p = (a.Phone || a.phone || '').toLowerCase();
            let id = String(a.AccountID || a.accountid || '').toLowerCase();
            return n.includes(cleanQ) || p.includes(cleanQ) || id.includes(cleanQ);
          });
        }

        if (filtered.length === 0) {
          await bot.sendMessage(chatId, `⚠️ مشتری با عنوان «*${text}*» یافت نشد.`, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '➕ ایجاد حساب جدید برای این نام', callback_data: 'NAV_CREATE_CUST' }],
                [{ text: '🔍 جستجوی مجدد', callback_data: 'NAV_CUST_MENU' }, { text: '❌ انصراف', callback_data: 'NAV_MAIN' }]
              ]
            }
          });
          return res.status(200).send('OK');
        }

        let buttons = filtered.map(a => [{
          text: `👤 ${a.Name || a.name} (${a.Phone || a.phone || 'بدون شماره'})`,
          callback_data: `SEL_CUST:${a.AccountID || a.accountid}`
        }]);
        buttons.push([{ text: '➕ ایجاد مشتری جدید', callback_data: 'NAV_CREATE_CUST' }]);
        buttons.push([{ text: '❌ انصراف', callback_data: 'NAV_MAIN' }]);

        await bot.sendMessage(chatId, `🔍 *نتایج یافت‌شده برای «${text}»:*`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons }
        });
        return res.status(200).send('OK');
      }

      // ➕ گام ۲: ساخت مشتری جدید
      if (state.step === 'WAITING_FOR_NEW_CUST_NAME') {
        const newAccId = "ACC-" + Math.floor(100000 + Math.random() * 900000);
        await supabase.from('accounts').insert([{
          AccountID: newAccId,
          Name: text,
          CreatedBy: String(admin.id)
        }]);

        delete userStates[userId];
        await bot.sendMessage(chatId, `✅ حساب مشتری *${text}* با کُد \`${newAccId}\` ایجاد گردید.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '👤 ورود به حساب مشتری', callback_data: `SEL_CUST:${newAccId}` }]]
          }
        });
        return res.status(200).send('OK');
      }

      // 📝 گام ۳: پردازش و ثبت متنی تراکنش مشتری
      if (state.step === 'WAITING_FOR_CUST_TX_TEXT') {
        const accId = state.accId;
        const parsed = await parseTransactionDetails(text, accId);

        if (!parsed.amount) {
          await bot.sendMessage(chatId, '⚠️ مبلغ در متن یافت نشد. لطفاً مبلغ عددی را مشخص کنید (مثال: 800 دلار بابت...).');
          return res.status(200).send('OK');
        }

        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txObj = {
          TransID: transId,
          AccountID: accId,
          Direction: parsed.direction,
          Amount: parsed.amount,
          Currency: parsed.currency,
          OperationType: parsed.opType,
          Description: text,
          Date: new Date().toISOString()
        };

        await supabase.from('transactions').insert([txObj]);
        delete userStates[userId];

        await bot.sendMessage(chatId,
          `✅ *تراکنش مشتری با موفقیت ثبت شد.*\n\n` +
          `🆔 شماره: \`${transId}\`\n` +
          `💰 مبلغ: *${formatMoney(parsed.amount)} ${parsed.currency}* (${parsed.direction})\n` +
          `🔹 نوع: *${parsed.opType}*\n` +
          `📝 شرح: ${text}`,
          {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '👤 بازگشت به حساب مشتری', callback_data: `SEL_CUST:${accId}` }]] }
          }
        );
        return res.status(200).send('OK');
      }

      // 🏛️ گام ۴: پردازش متنی معامله صرافی و اتصال به مشتری
      if (state.step === 'WAITING_FOR_BROKER_TX_TEXT') {
        const bId = state.brokerId;
        const parsed = await parseTransactionDetails(text);

        if (!parsed.amount) {
          await bot.sendMessage(chatId, '⚠️ مبلغ معامله تشخیص داده نشد. لطفاً متن را شامل عدد و ارز ارسال کنید.');
          return res.status(200).send('OK');
        }

        // استخراج نرخ تبدیل در صورت وجود
        const cleanStr = toEnglishDigits(text);
        const rateMatch = cleanStr.match(/نرخ\s*(\d+(\.\d+)?)/);
        const rate = rateMatch ? parseFloat(rateMatch[1]) : null;

        const btxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
        const brokerTxObj = {
          broker_tx_id: btxId,
          broker_id: bId,
          date: new Date().toISOString().split('T')[0],
          operation_type: parsed.opType,
          direction: parsed.direction,
          currency: parsed.currency,
          amount_initial: parsed.amount,
          exchange_rate: rate,
          amount_final: parsed.amount,
          description: text
        };

        // بررسی اینکه آیا نام مشتری در متن صرافی ذکر شده است
        const { data: allAccs } = await supabase.from('accounts').select('*');
        let matchedCust = null;
        if (allAccs) {
          matchedCust = allAccs.find(a => (a.Name || a.name || '').toLowerCase() && text.toLowerCase().includes((a.Name || a.name).toLowerCase()));
        }

        let custTxObj = null;
        let custNameText = "";

        if (matchedCust) {
          custNameText = matchedCust.Name || matchedCust.name;
          custTxObj = {
            TransID: "TX-" + Math.floor(10000000 + Math.random() * 90000000),
            AccountID: matchedCust.AccountID || matchedCust.accountid,
            Direction: parsed.direction,
            Amount: parsed.amount,
            Currency: parsed.currency,
            OperationType: parsed.opType,
            Description: `اتصال به صرافی | ${text}`,
            Date: new Date().toISOString()
          };
        }

        userStates[userId] = {
          pendingBrokerTx: brokerTxObj,
          pendingCustomerTx: custTxObj,
          pendingCustomerName: custNameText
        };

        await bot.sendMessage(chatId,
          `📋 *پیش‌نمایش ثبت معامله صرافی:*\n\n` +
          `🆔 کُد معامله: \`${btxId}\`\n` +
          `💰 مبلغ: *${formatMoney(parsed.amount)} ${parsed.currency}* (${parsed.direction})\n` +
          `🔹 نوع: *${parsed.opType}* ${rate ? `| نرخ: ${rate}` : ''}\n` +
          `${custNameText ? `🔗 *اتصال هم‌زمان به حساب مشتری:* ${custNameText}\n` : ''}` +
          `📝 شرح: ${text}\n\n` +
          `آیا اطلاعات مورد تایید است؟`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🟢 تایید و ثبت نهایی', callback_data: 'CONFIRM_BROKER_SAVE:OK' }],
                [{ text: '❌ انصراف', callback_data: `SEL_BROKER:${bId}` }]
              ]
            }
          }
        );
        return res.status(200).send('OK');
      }

    }

  } catch (err) {
    console.error('Critical Bot Error:', err);
  }

  return res.status(200).send('OK');
};
```

### اقدامات بعدی:
1. فایل `api/bot.js` جدید را در مخزن ورسل خود جایگزین کنید.
2. با دستور `/start` در تلگرام، منوی پویا را اجرا نموده و فرآیند ثبت متنی تراکنش‌ها و صرافی را بررسی کنید.
