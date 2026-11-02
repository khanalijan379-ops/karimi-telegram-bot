const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

// تنظیمات اتصال به Supabase و توکن جدید ربات تلگرام
const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

const MASTER_ADMIN_ID = 802655440;

// حافظه موقت برای مدیریت ماشین حالت (State Machine) کاربران
const userStates = {};

// تبدیل اعداد فارسی و عربی به انگلیسی
function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

// فرمت‌دهی مبالغ مالی
function formatMoney(amount) {
  let num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return toEnglishDigits(num.toLocaleString('en-US'));
}

// بررسی دسترسی ادمین
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

// پارسر هوشمند متون تراکنش (با تطبیق دقیق جهت‌ها و انواع عملیات مشابه وب‌سایت)
function parseTransactionText(text) {
  const cleanText = toEnglishDigits(text);
  const amountMatch = cleanText.match(/\d+(\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null;

  let currency = 'USD';
  if (text.includes('افغانی') || text.includes('AFN')) currency = 'AFN';
  else if (text.includes('تومان') || text.includes('تومن')) currency = 'تومان';
  else if (text.includes('دینار') || text.includes('IQD')) currency = 'IQD';

  // منطق دقیق جهت‌ها مطابقت‌یافته با سیستم وب
  let isCredit = text.includes('دریافت') || text.includes('رسید') || text.includes('آمد') || text.includes('بستانکار') || text.includes('گرفتم') || text.includes('حواله آمد');
  if (text.includes('دادم') || text.includes('رساندم') || text.includes('پرداخت') || text.includes('فرستادم')) {
    isCredit = false;
  }
  const direction = isCredit ? 'بستانکار' : 'بدهکار';

  let opType = 'امانت';
  if (text.includes('حواله')) opType = 'حواله';
  else if (text.includes('تسویه')) opType = 'تسویه';
  else if (text.includes('انتقال')) opType = 'انتقال';
  else if (text.includes('معامله')) opType = 'معامله';
  else if (text.includes('پرداخت')) opType = 'پرداخت';

  return { amount, currency, direction, opType, rawText: text };
}

// محاسبه گزارش عمودی مانده حساب‌های صرافی (مشابه بخش صرافی وب‌سایت)
async function getBrokerVerticalBalanceText(brokerId) {
  const { data: txs } = await supabase.from('broker_transactions').select('*').eq('broker_id', brokerId);
  let currencyTotals = {};
  if (txs) {
    txs.forEach(tx => {
      let curr = (tx.currency || 'USD').toUpperCase();
      let dir = tx.direction || '';
      let amt = parseFloat(tx.amount_final || tx.amount_initial) || 0;
      if (!currencyTotals[curr]) currencyTotals[curr] = { creditor: 0, debtor: 0 };
      if (dir === 'بستانکار') currencyTotals[curr].creditor += amt;
      if (dir === 'بدهکار') currencyTotals[curr].debtor += amt;
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
  if (!hasItem) return "\n📊 *گزارش عمودی مانده صرافی:* تراکنشی ثبت نشده است.";
  return lines.join("\n");
}

// ارسال پیام به تلگرام با قابلیت کیبورد شیشه‌ای
async function sendTelegramMsg(chatId, text, inlineKeyboard = null) {
  const opts = { parse_mode: 'Markdown' };
  if (inlineKeyboard) {
    opts.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error("Telegram Send Error:", err);
  }
}

// ویرایش پیام موجود در تلگرام
async function editTelegramMsg(chatId, messageId, text, inlineKeyboard = null) {
  const opts = { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' };
  if (inlineKeyboard) {
    opts.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  try {
    return await bot.editMessageText(text, opts);
  } catch (err) {
    console.error("Telegram Edit Error:", err);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running & Ready');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).send('OK');

    // 🔴 ۱. مدیریت کلیک روی دکمه‌های شیشه‌ای (Callback Queries)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز', show_alert: true });
        return res.status(200).send('OK');
      }

      const data = query.data;

      // ---------------- منوی اصلی ----------------
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه هوشمند مدیریت حساب‌کتاب و صرافی* ✨\nلطفاً بخش مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }],
          [{ text: '🏛️ حساب کارگزاران / صرافی‌ها', callback_data: 'NAV_BROKERS' }]
        ]);
      }

      // ---------------- بخش مشتریان ----------------
      else if (data === 'NAV_CUSTOMERS') {
        userStates[userId] = { step: 'SEARCH_CUSTOMER_PROMPT' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *بخش مدیریت حساب مشتریان*\n\nلطفاً **نام مشتری** را جهت جستجو ارسال کنید (مثلاً: `احمد`):', [
          [{ text: '➕ افتتاح حساب جدید', callback_data: 'CREATE_NEW_ACC' }],
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      else if (data === 'CREATE_NEW_ACC') {
        userStates[userId] = { step: 'WAITING_NEW_ACC_NAME' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👤 *افتتاح حساب جدید برای مشتری*\n\nلطفاً **نام و فامیلی کامل مشتری** را بفرستید:', [
          [{ text: '❌ انصراف', callback_data: 'NAV_CUSTOMERS' }]
        ]);
      }

      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        if (!acc) {
          await bot.answerCallbackQuery(query.id, { text: 'حساب یافت نشد!', show_alert: true });
          return res.status(200).send('OK');
        }

        const accName = acc.Name || acc.name;
        userStates[userId] = { accId, accName, step: 'CUSTOMER_MENU' };
        await bot.answerCallbackQuery(query.id);

        await editTelegramMsg(
          chatId,
          msgId,
          `👤 *پنل اختصاصی مشتری:* *${accName}*\n🆔 کُد حساب: \`${toEnglishDigits(accId)}\`\n📞 تلفن: \`${acc.Phone || acc.phone || '-'}\`\n💬 چت‌آیدی: \`${acc.ChatID || acc.chatid || '-'}\``,
          [
            [{ text: '📊 دیدن مانده‌ها', callback_data: 'CUST_VIEW_BAL' }, { text: '📜 دیدن تراکنش‌ها', callback_data: 'CUST_VIEW_TXS' }],
            [{ text: '➕ ثبت تراکنش جدید', callback_data: 'CUST_ADD_TX' }],
            [{ text: '🗑️ حذف حساب', callback_data: 'CUST_DELETE_ACC' }],
            [{ text: '🔙 جستجوی مشتری دیگر', callback_data: 'NAV_CUSTOMERS' }, { text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
          ]
        );
      }

      else if (data === 'CUST_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).send('OK');

        const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', st.accId);
        let currs = {};
        if (txs) {
          txs.forEach(t => {
            let c = (t.Currency || t.currency || 'USD').toUpperCase();
            let d = t.Direction || t.direction || '';
            let a = parseFloat(t.Amount || t.amount) || 0;
            if (!currs[c]) currs[c] = { credit: 0, debit: 0 };
            if (d.includes('بستانکار')) currs[c].credit += a;
            if (d.includes('بدهکار')) currs[c].debit += a;
          });
        }

        let balText = `📊 *صورت‌حساب و مانده زنده:* *${st.accName}*\n────────────────────────\n`;
        let count = 0;
        for (let c in currs) {
          count++;
          let net = currs[c].credit - currs[c].debit;
          let status = net > 0 ? `بستانکار (+)` : (net < 0 ? `بدهکار (-)` : `تسویه کامل`);
          balText += `🔹 *ارز ${c}:*\n  • کل بستانکار: \`${formatMoney(currs[c].credit)}\`\n  • کل بدهکار: \`${formatMoney(currs[c].debit)}\`\n  📌 *مانده:* *${formatMoney(Math.abs(net))} ${c} (${status})*\n\n`;
        }
        if (count === 0) balText += '_تراکنشی برای این حساب ثبت نشده است._';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, balText, [
          [{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]
        ]);
      }

      else if (data === 'CUST_VIEW_TXS') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).send('OK');

        const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', st.accId);
        if (!txs || txs.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'تراکنشی یافت نشد', show_alert: true });
          return res.status(200).send('OK');
        }

        let txBtns = txs.slice(-10).reverse().map(t => {
          let dirSymbol = (t.Direction || t.direction || '').includes('بستانکار') ? '🟢' : '🔴';
          return [{
            text: `${dirSymbol} ${formatMoney(t.Amount || t.amount)} ${t.Currency || t.currency} - ${t.OperationType || t.operationtype}`,
            callback_data: `VIEW_TX_DETAIL:${t.TransID || t.transid}`
          }];
        });
        txBtns.push([{ text: '🔙 بازگشت', callback_data: `SELECT_CUST:${st.accId}` }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📜 *۱۰ تراکنش اخیر مشتری:* *${st.accName}*\nبرای مشاهده جزئیات یا حذف، روی تراکنش بزنید:`, txBtns);
      }

      else if (data.startsWith('VIEW_TX_DETAIL:')) {
        const txId = data.split(':')[1];
        const { data: tx } = await supabase.from('transactions').select('*').eq('TransID', txId).single();
        if (!tx) return res.status(200).send('OK');

        let detailText = `🔍 *جزئیات تراکنش:* \`${toEnglishDigits(txId)}\`\n\n` +
          `💰 مبلغ: *${formatMoney(tx.Amount || tx.amount)} ${tx.Currency || tx.currency}*\n` +
          `🔄 جهت: *${tx.Direction || tx.direction}*\n` +
          `📋 نوع عملیات: *${tx.OperationType || tx.operationtype}*\n` +
          `📅 تاریخ: \`${toEnglishDigits((tx.Date || tx.date || '').split('T')[0])}\`\n` +
          `📝 شرح: _${tx.Description || tx.description || '-'}_`;

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, detailText, [
          [{ text: '🗑️ حذف تراکنش', callback_data: `DELETE_TX:${txId}` }],
          [{ text: '🔙 لیست تراکنش‌ها', callback_data: 'CUST_VIEW_TXS' }]
        ]);
      }

      else if (data.startsWith('DELETE_TX:')) {
        const txId = data.split(':')[1];
        await supabase.from('transactions').delete().eq('TransID', txId);
        await bot.answerCallbackQuery(query.id, { text: 'تراکنش حذف گردید.' });

        const st = userStates[userId];
        if (st && st.accId) {
          await editTelegramMsg(chatId, msgId, '✅ *تراکنش با موفقیت حذف شد.*', [
            [{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]
          ]);
        }
      }

      else if (data === 'CUST_ADD_TX') {
        const st = userStates[userId];
        st.step = 'WAITING_CUST_TX_FULLTEXT';
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 *ثبت یک‌جای تراکنش برای:* *${st.accName}*\n\nلطفاً متن کامل تراکنش را بفرستید.\n\n📌 *نمونه متن:* \`800 دلار از ${st.accName} دریافت شد بابت تسویه\``, [
          [{ text: '❌ انصراف', callback_data: `SELECT_CUST:${st.accId}` }]
        ]);
      }

      else if (data === 'CUST_DELETE_ACC') {
        const st = userStates[userId];
        await supabase.from('accounts').delete().eq('AccountID', st.accId);
        await supabase.from('transactions').delete().eq('AccountID', st.accId);
        delete userStates[userId];

        await bot.answerCallbackQuery(query.id, { text: 'حساب حذف شد.' });
        await editTelegramMsg(chatId, msgId, '✅ *حساب مشتری و تمامی تراکنش‌های آن با موفقیت حذف گردید.*', [
          [{ text: '👥 بخش مشتریان', callback_data: 'NAV_CUSTOMERS' }]
        ]);
      }

      // ---------------- بخش صرافی‌ها / کارگزاران ----------------
      else if (data === 'NAV_BROKERS') {
        const { data: brokers } = await supabase.from('brokers').select('*');
        if (!brokers || brokers.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'هیچ صرافی‌ای در دیتابیس ثبت نشده است.', show_alert: true });
          return res.status(200).send('OK');
        }

        let brokerBtns = brokers.map(b => [{ text: `🏛️ ${b.name} (${b.city || 'بدون شهر'})`, callback_data: `SELECT_BROKER:${b.broker_id}` }]);
        brokerBtns.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *لیست صرافی‌ها و کارگزاران فعال:*', brokerBtns);
      }

      else if (data.startsWith('SELECT_BROKER:')) {
        const brokerId = data.split(':')[1];
        const { data: broker } = await supabase.from('brokers').select('*').eq('broker_id', brokerId).single();
        if (!broker) return res.status(200).send('OK');

        userStates[userId] = { brokerId, brokerName: broker.name, step: 'BROKER_MENU' };
        await bot.answerCallbackQuery(query.id);

        await editTelegramMsg(
          chatId,
          msgId,
          `🏛️ *پنل کارگزار / صرافی:* *${broker.name}*\nشهر: \`${broker.city || '-'}\` | تلفن: \`${broker.phone || '-'}\``,
          [
            [{ text: '📊 دیدن مانده صرافی', callback_data: 'BROKER_VIEW_BAL' }, { text: '📜 دیدن تراکنش‌ها', callback_data: 'BROKER_VIEW_TXS' }],
            [{ text: '➕ ثبت معامله صرافی', callback_data: 'BROKER_ADD_TX' }],
            [{ text: '🔙 لیست صرافی‌ها', callback_data: 'NAV_BROKERS' }, { text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
          ]
        );
      }

      else if (data === 'BROKER_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.brokerId) return res.status(200).send('OK');

        let rep = await getBrokerVerticalBalanceText(st.brokerId);
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, rep, [
          [{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]
        ]);
      }

      else if (data === 'BROKER_VIEW_TXS') {
        const st = userStates[userId];
        if (!st || !st.brokerId) return res.status(200).send('OK');

        const { data: bTxs } = await supabase.from('broker_transactions').select('*').eq('broker_id', st.brokerId);
        if (!bTxs || bTxs.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'تراکنشی یافت نشد', show_alert: true });
          return res.status(200).send('OK');
        }

        let txBtns = bTxs.slice(-10).reverse().map(t => {
          let dirSymbol = (t.direction || '').includes('بستانکار') ? '🟢' : '🔴';
          return [{
            text: `${dirSymbol} ${formatMoney(t.amount_final || t.amount_initial)} ${t.currency} - ${t.operation_type}`,
            callback_data: `VIEW_BROKER_TX:${t.broker_tx_id}`
          }];
        });
        txBtns.push([{ text: '🔙 بازگشت', callback_data: `SELECT_BROKER:${st.brokerId}` }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📜 *۱۰ معامله اخیر صرافی:* *${st.brokerName}*`, txBtns);
      }

      else if (data.startsWith('VIEW_BROKER_TX:')) {
        const bTxId = data.split(':')[1];
        const { data: tx } = await supabase.from('broker_transactions').select('*').eq('broker_tx_id', bTxId).single();
        if (!tx) return res.status(200).send('OK');

        let detailText = `🔍 *جزئیات معامله صرافی:* \`${toEnglishDigits(bTxId)}\`\n\n` +
          `💰 مبلغ: *${formatMoney(tx.amount_final || tx.amount_initial)} ${tx.currency}*\n` +
          `🔄 جهت: *${tx.direction}*\n` +
          `📋 نوع عملیات: *${tx.operation_type}*\n` +
          `📅 تاریخ: \`${toEnglishDigits((tx.date || '').split('T')[0])}\`\n` +
          `📍 آدرس: _${tx.address_dashboard || '-'}_` +
          `📝 شرح: _${tx.description || '-'}_`;

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, detailText, [
          [{ text: '🗑️ حذف معامله', callback_data: `DELETE_BROKER_TX:${bTxId}` }],
          [{ text: '🔙 لیست معاملات', callback_data: 'BROKER_VIEW_TXS' }]
        ]);
      }

      else if (data.startsWith('DELETE_BROKER_TX:')) {
        const bTxId = data.split(':')[1];
        await supabase.from('broker_transactions').delete().eq('broker_tx_id', bTxId);
        await bot.answerCallbackQuery(query.id, { text: 'معامله صرافی حذف گردید.' });

        const st = userStates[userId];
        if (st && st.brokerId) {
          await editTelegramMsg(chatId, msgId, '✅ *معامله با موفقیت حذف شد.*', [
            [{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]
          ]);
        }
      }

      else if (data === 'BROKER_ADD_TX') {
        const st = userStates[userId];
        st.step = 'WAITING_BROKER_TX_TEXT';
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 *ثبت معامله برای صرافی:* *${st.brokerName}*\n\nلطفاً متن معامله را بفرستید.\n📌 *مثال:* \`حواله 1000 دلار به کابل آدرس مرکز\``, [
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${st.brokerId}` }]
        ]);
      }

      return res.status(200).send('OK');
    }

    // 🟢 ۲. مدیریت پیام‌های متنی ارسالی کاربران
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await sendTelegramMsg(chatId, '⛔ *دسترسی غیرمجاز.*');
        return res.status(200).send('OK');
      }

      if (text === '/start' || text === '↩️ شروع مجدد') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه هوشمند مدیریت حساب‌کتاب و صرافی* ✨\nلطفاً بخش مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }],
          [{ text: '🏛️ حساب کارگزاران / صرافی‌ها', callback_data: 'NAV_BROKERS' }]
        ]);
        return res.status(200).send('OK');
      }

      let st = userStates[userId];

      // جستجوی نام مشتری در دیتابیس
      if (st && st.step === 'SEARCH_CUSTOMER_PROMPT') {
        const { data: accounts } = await supabase.from('accounts').select('*');
        let matched = accounts ? accounts.filter(a => {
          let n = (a.Name || a.name || '').toLowerCase();
          return n && n.includes(text.toLowerCase());
        }) : [];

        if (matched.length === 0) {
          await sendTelegramMsg(chatId, `⚠️ مشتری با نام «*${text}*» یافت نشد. آیا می‌خواهید حساب جدید بسازید؟`, [
            [{ text: `➕ ساخت حساب جدید برای «${text}»`, callback_data: 'CREATE_NEW_ACC' }],
            [{ text: '🔍 جستجوی مجدد', callback_data: 'NAV_CUSTOMERS' }]
          ]);
          return res.status(200).send('OK');
        }

        let btns = matched.map(a => [{
          text: `👤 ${a.Name || a.name} (کد: ${toEnglishDigits(a.AccountID || a.accountid)})`,
          callback_data: `SELECT_CUST:${a.AccountID || a.accountid}`
        }]);
        btns.push([{ text: '❌ انصراف', callback_data: 'NAV_CUSTOMERS' }]);

        await sendTelegramMsg(chatId, `🔍 *نتایج جستجو برای «${text}»:*`, btns);
        return res.status(200).send('OK');
      }

      // ساخت نام حساب جدید (با اخذ شماره تماس الزامی و چک کردن کد کشور)
      if (st && st.step === 'WAITING_NEW_ACC_NAME') {
        st.tempName = text;
        st.step = 'WAITING_NEW_ACC_PHONE';
        await sendTelegramMsg(chatId, `📞 لطفاً **شماره تماس با کد کشور** را برای مشتری *${text}* وارد کنید (مثلاً: \`+93790000000\` یا \`+989120000000\`):`);
        return res.status(200).send('OK');
      }

      if (st && st.step === 'WAITING_NEW_ACC_PHONE') {
        const cleanPhone = toEnglishDigits(text);
        if (!cleanPhone.startsWith('+') || cleanPhone.length < 10) {
          await sendTelegramMsg(chatId, `⚠️ شماره تلفن نامعتبر است! حتماً باید **با کد کشور (مثل +93 یا +98)** شروع شود. مجدد وارد کنید:`);
          return res.status(200).send('OK');
        }

        const newAccId = "ACC-" + Math.floor(100000 + Math.random() * 900000);
        const { error } = await supabase.from('accounts').insert([{
          AccountID: newAccId,
          Name: st.tempName,
          Phone: cleanPhone,
          CreatedBy: String(userId)
        }]);

        if (error) {
          await sendTelegramMsg(chatId, '❌ خطا در افتتاح حساب: ' + error.message);
        } else {
          userStates[userId] = { accId: newAccId, accName: st.tempName, step: 'CUSTOMER_MENU' };
          await sendTelegramMsg(chatId, `🎉 *حساب جدید با موفقیت افتتاح شد.*\n\n👤 نام: *${st.tempName}*\n📞 تلفن: \`${cleanPhone}\`\n🆔 کد حساب: \`${newAccId}\``, [
            [{ text: '➕ ثبت اولین تراکنش', callback_data: 'CUST_ADD_TX' }],
            [{ text: '👤 پنل مدیریت مشتری', callback_data: `SELECT_CUST:${newAccId}` }]
          ]);
        }
        return res.status(200).send('OK');
      }

      // ثبت یک‌جای تراکنش متنی مشتری با تفکیک دقیق بدهکار و بستانکار
      if (st && st.step === 'WAITING_CUST_TX_FULLTEXT') {
        const parsed = parseTransactionText(text);

        if (!parsed.amount || parsed.amount <= 0) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ معتبری در متن شما یافت نشد. لطفاً مبلغ را با عدد بنویسید (مثلاً: 800 دلار):');
          return res.status(200).send('OK');
        }

        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString();

        const { error } = await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: st.accId,
          Direction: parsed.direction,
          Amount: parsed.amount,
          Currency: parsed.currency,
          OperationType: parsed.opType,
          Description: text,
          Date: txDate
        }]);

        if (error) {
          await sendTelegramMsg(chatId, '❌ خطا در ثبت تراکنش: ' + error.message);
        } else {
          let successResponse = `✅ *تراکنش با موفقیت ثبت شد.*\n\n` +
            `👤 مشتری: *${st.accName}*\n` +
            `🆔 کد: \`${transId}\`\n` +
            `💰 مبلغ: *${formatMoney(parsed.amount)} ${parsed.currency}* (${parsed.direction})\n` +
            `📋 نوع: *${parsed.opType}*\n` +
            `📝 شرح: _${text}_`;

          await sendTelegramMsg(chatId, successResponse, [
            [{ text: '➕ ثبت تراکنش دیگر', callback_data: 'CUST_ADD_TX' }],
            [{ text: '👤 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]
          ]);
          await sendTelegramMsg(MASTER_ADMIN_ID, `🔔 *گزارش تراکنش مشتری*\n${successResponse}`);
        }
        return res.status(200).send('OK');
      }

      // ثبت معامله متنی صرافی با استخراج آدرس و ارسال گزارش عمودی مانده‌ها
      if (st && st.step === 'WAITING_BROKER_TX_TEXT') {
        const parsed = parseTransactionText(text);
        if (!parsed.amount) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ معتبری در متن معامله تشخیص داده نشد.');
          return res.status(200).send('OK');
        }

        const brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString().split('T')[0];

        const { error } = await supabase.from('broker_transactions').insert([{
          broker_tx_id: brokerTxId,
          broker_id: st.brokerId,
          date: txDate,
          operation_type: parsed.opType,
          direction: parsed.direction,
          currency: parsed.currency,
          amount_initial: parsed.amount,
          amount_final: parsed.amount,
          description: text,
          address_dashboard: text.includes('آدرس') ? text.split('آدرس')[1].trim() : '-'
        }]);

        if (error) {
          await sendTelegramMsg(chatId, '❌ خطا در ثبت معامله صرافی: ' + error.message);
        } else {
          let verticalRep = await getBrokerVerticalBalanceText(st.brokerId);
          let brokerMsg = `✅ *معامله صرافی با موفقیت ثبت شد.*\n\n` +
            `🏛️ صرافی: *${st.brokerName}*\n` +
            `🆔 کد: \`${brokerTxId}\`\n` +
            `💰 مبلغ: *${formatMoney(parsed.amount)} ${parsed.currency}* (${parsed.direction})\n` +
            `📝 شرح: _${text}_\n` +
            `${verticalRep}`;

          await sendTelegramMsg(chatId, brokerMsg, [
            [{ text: '🏛️ بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]
          ]);
          await sendTelegramMsg(MASTER_ADMIN_ID, `🔔 *گزارش معامله صرافی*\n${brokerMsg}`);
        }
        return res.status(200).send('OK');
      }

      // پیام راهنمای پیش‌فرض
      await sendTelegramMsg(chatId, 'برای شروع مدیریت، دستور /start را بفرستید.');
    }

  } catch (err) {
    console.error('Bot Server Critical Error:', err);
  }

  return res.status(200).send('OK');
};
