/**
 * ==============================================================================
 * 🏛️ سامانه جامع، پیشرفته و تمام‌عیار ربات تلگرام مدیریت امانت‌داری و صرافی کریمی
 * شامل تمامی بخش‌ها: مشتریان، تراکنش‌ها، صرافی‌ها، معاملات، آدرس‌ها، گزارشات و ادمین‌ها
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";
const MASTER_ADMIN_ID = "802655440";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// حافظه موقت جامع برای مدیریت ویزاردها، وضعیت‌ها و نشست‌های ادمین‌ها
const userStates = {};

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
 * فرمت‌بندی مبالغ با کاما
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
 * ویرایش پیام تلگرام
 */
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

/**
 * پاسخ به Callback Query
 */
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

/**
 * بررسی دسترسی ادمین (مالک اصلی یا ادمین‌های همکار ثبت شده در جدول admins)
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
 * دریافت توکن و چت‌آیدی اختصاصی ادمین فعال
 */
async function getAdminTokenAndChat(userId) {
  if (String(userId) === String(MASTER_ADMIN_ID)) {
    return { token: TELEGRAM_TOKEN, chatId: MASTER_ADMIN_ID };
  }
  try {
    const { data: admins } = await supabase.from('admins').select('*');
    if (admins) {
      let found = admins.find(a => String(a.ChatID || a.chatid || '') === String(userId));
      if (found) {
        return {
          token: found.BotToken || found.bottoken || found.Token || found.token || TELEGRAM_TOKEN,
          chatId: found.ChatID || found.chatid || userId
        };
      }
    }
  } catch (e) {}
  return { token: TELEGRAM_TOKEN, chatId: userId };
}

/**
 * محاسبه گزارش عمودی مانده حساب‌های صرافی به تفکیک تمام ارزها
 */
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
    lines.push(`🔹 *ارز ${curr}:*`);
    lines.push(`  • کل بستانکار: \`${formatMoney(cred)}\``);
    lines.push(`  • کل بدهکار: \`${formatMoney(debt)}\``);
    lines.push(`  • مانده نهایی: *${formatMoney(Math.abs(net))} ${curr} (${net >= 0 ? "بستانکار" : "بدهکار"})*`);
    lines.push(`-----------------------------------`);
  }
  return hasItem ? lines.join("\n") : "\n📊 گزارش صرافی: تراکنشی ثبت نشده است.";
}

/**
 * محاسبه بیلان زنده حساب مشتری
 */
async function getAccountLiveBalanceText(accId) {
  const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', accId);
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
  let textParts = [];
  for (let c in currs) {
    let cred = currs[c].credit;
    let deb = currs[c].debit;
    let net = cred - deb;
    let status = net > 0 ? `بستانکار (+)` : (net < 0 ? `بدهکار (-)` : `تسویه کامل`);
    textParts.push(`🔹 *ارز ${c}:*\n  • کل بستانکار: \`${formatMoney(cred)}\`\n  • کل بدهکار: \`${formatMoney(deb)}\`\n  📌 *مانده:* *${formatMoney(Math.abs(net))} ${c} (${status})*`);
  }
  return textParts.join('\n\n') || 'تراکنشی برای این حساب ثبت نشده است.';
}

/**
 * هندلر اصلی سرورلس ربات تلگرام (Vercel Serverless Function)
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running & Ready');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // ۱. مدیریت Callback Query دکمه‌های شیشه‌ای
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;
      const data = query.data;

      if (!(await isAuthorizedAdmin(userId))) {
        await answerCallbackQuery(query.id, '❌ دسترسی غیرمجاز به سامانه', true);
        return res.status(200).json({ ok: true });
      }

      // منوی اصلی
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه هوشمند مدیریت حساب‌کتاب و صرافی کریمی* ✨\nلطفاً بخش مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🏛️ حساب صرافی‌ها', callback_data: 'NAV_BROKERS' }],
          [{ text: '📈 گزارشات کلی و مالی', callback_data: 'NAV_REPORTS' }, { text: '🛡️ مدیریت ادمین‌ها', callback_data: 'NAV_ADMINS' }]
        ]);
      } 
      // بخش مشتریان
      else if (data === 'NAV_CUSTOMERS') {
        userStates[userId] = { step: 'SEARCH_CUSTOMER_PROMPT' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *بخش مدیریت حساب مشتریان*\n\nلطفاً **نام یا شماره مشتری** را جهت جستجو ارسال کنید:', [
          [{ text: '➕ افتتاح حساب جدید', callback_data: 'CREATE_NEW_ACC' }],
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 
      else if (data === 'CREATE_NEW_ACC') {
        userStates[userId] = { step: 'WAITING_NEW_ACC_NAME' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👤 *افتتاح حساب جدید برای مشتری*\n\nلطفاً **نام و فامیلی کامل مشتری** را بفرستید:', [
          [{ text: '❌ انصراف', callback_data: 'NAV_CUSTOMERS' }]
        ]);
      } 
      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        if (!acc) return res.status(200).json({ ok: true });
        const accName = acc.Name || acc.name;
        userStates[userId] = { accId, accName, step: 'CUSTOMER_MENU' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *پنل اختصاصی مشتری:* *${accName}*\n🆔 کُد حساب: \`${toEnglishDigits(accId)}\`\n📞 تلفن: \`${acc.Phone || acc.phone || '-'}\``, [
          [{ text: '📊 دیدن مانده‌ها', callback_data: 'CUST_VIEW_BAL' }, { text: '📜 دیدن تراکنش‌ها', callback_data: 'CUST_VIEW_TXS' }],
          [{ text: '➕ ثبت تراکنش جدید', callback_data: 'CUST_ADD_TX' }],
          [{ text: '🗑️ حذف حساب', callback_data: 'CUST_DELETE_ACC' }],
          [{ text: '🔙 جستجوی مشتری دیگر', callback_data: 'NAV_CUSTOMERS' }, { text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 
      else if (data === 'CUST_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).json({ ok: true });
        let balText = `📊 *صورت‌حساب و مانده مشتری:* *${st.accName}*\n────────────────────────\n` + await getAccountLiveBalanceText(st.accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, balText, [[{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]]);
      } 
      else if (data === 'CUST_VIEW_TXS') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).json({ ok: true });
        const { data: txs } = await supabase.from('transactions').select('*').eq('AccountID', st.accId);
        if (!txs || txs.length === 0) {
          await answerCallbackQuery(query.id, 'تراکنشی یافت نشد', true);
          return res.status(200).json({ ok: true });
        }
        let txBtns = txs.slice(-10).reverse().map(t => {
          let dirSymbol = (t.Direction || t.direction || '').includes('بستانکار') ? '🟢' : '🔴';
          return [{ text: `${dirSymbol} ${formatMoney(t.Amount || t.amount)} ${t.Currency || t.currency} - ${t.OperationType || t.operationtype}`, callback_data: `VIEW_TX_DETAIL:${t.TransID || t.transid}` }];
        });
        txBtns.push([{ text: '🔙 بازگشت', callback_data: `SELECT_CUST:${st.accId}` }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📜 *تراکنش‌های اخیر مشتری:* *${st.accName}*`, txBtns);
      } 
      else if (data.startsWith('VIEW_TX_DETAIL:')) {
        const txId = data.split(':')[1];
        const { data: tx } = await supabase.from('transactions').select('*').eq('TransID', txId).single();
        if (!tx) return res.status(200).json({ ok: true });
        let detailText = `🔍 *جزئیات تراکنش:* \`${toEnglishDigits(txId)}\`\n\n` +
          `💰 مبلغ: *${formatMoney(tx.Amount || tx.amount)} ${tx.Currency || tx.currency}*\n` +
          `🔄 جهت: *${tx.Direction || tx.direction}*\n` +
          `📋 نوع عملیات: *${tx.OperationType || tx.operationtype}*\n` +
          `📅 تاریخ: \`${toEnglishDigits((tx.Date || tx.date || '').split('T')[0])}\`\n` +
          `📝 شرح: _${tx.Description || tx.description || '-'}_`;
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, detailText, [
          [{ text: '🗑️ حذف تراکنش', callback_data: `DELETE_TX:${txId}` }],
          [{ text: '🔙 لیست تراکنش‌ها', callback_data: 'CUST_VIEW_TXS' }]
        ]);
      } 
      else if (data.startsWith('DELETE_TX:')) {
        const txId = data.split(':')[1];
        await supabase.from('transactions').delete().eq('TransID', txId);
        await answerCallbackQuery(query.id, 'تراکنش حذف گردید.');
        const st = userStates[userId];
        if (st && st.accId) {
          await editTelegramMsg(chatId, msgId, '✅ *تراکنش با موفقیت حذف شد.*', [[{ text: '🔙 بازگشت به پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]]);
        }
      } 
      else if (data === 'CUST_ADD_TX') {
        const st = userStates[userId];
        userStates[userId].wizard = { target: 'CUST', step: 'OP_TYPE' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 *ثبت تراکنش برای مشتری:* *${st.accName}*\n\nگام ۱: نوع عملیات را انتخاب کنید:`, [
          [{ text: 'حواله', callback_data: 'WZ_C_OP:حواله' }, { text: 'معامله', callback_data: 'WZ_C_OP:معامله' }],
          [{ text: 'دریافت / پرداخت', callback_data: 'WZ_C_OP:پرداخت' }, { text: 'تسویه', callback_data: 'WZ_C_OP:تسویه' }],
          [{ text: '❌ انصراف', callback_data: `SELECT_CUST:${st.accId}` }]
        ]);
      } 
      else if (data.startsWith('WZ_C_OP:')) {
        userStates[userId].wizard.opType = data.split(':')[1];
        userStates[userId].wizard.step = 'C_DIR';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '📌 گام ۲: جهت تراکنش مشتری را انتخاب کنید:', [
          [{ text: '🟢 بستانکار (+)', callback_data: 'WZ_C_DIR:بستانکار' }],
          [{ text: '🔴 بدهکار (-)', callback_data: 'WZ_C_DIR:بدهکار' }]
        ]);
      } 
      else if (data.startsWith('WZ_C_DIR:')) {
        userStates[userId].wizard.direction = data.split(':')[1];
        userStates[userId].wizard.step = 'C_CURR';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '📌 گام ۳: واحد ارز را انتخاب کنید:', [
          [{ text: 'USD', callback_data: 'WZ_C_CURR:USD' }, { text: 'AFN', callback_data: 'WZ_C_CURR:AFN' }],
          [{ text: 'تومان', callback_data: 'WZ_C_CURR:تومان' }, { text: 'IQD', callback_data: 'WZ_C_CURR:IQD' }]
        ]);
      } 
      else if (data.startsWith('WZ_C_CURR:')) {
        userStates[userId].wizard.currency = data.split(':')[1];
        userStates[userId].wizard.step = 'C_WAITING_AMT';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '📌 گام ۴: لطفاً مبلغ تراکنش را بفرستید:');
      } 
      else if (data === 'CUST_DELETE_ACC') {
        const st = userStates[userId];
        await supabase.from('accounts').delete().eq('AccountID', st.accId);
        await supabase.from('transactions').delete().eq('AccountID', st.accId);
        delete userStates[userId];
        await answerCallbackQuery(query.id, 'حساب حذف شد.');
        await editTelegramMsg(chatId, msgId, '✅ *حساب مشتری و تراکنش‌های آن حذف گردید.*', [[{ text: '👥 بخش مشتریان', callback_data: 'NAV_CUSTOMERS' }]]);
      } 
      // بخش صرافی‌ها و کارگزاران
      else if (data === 'NAV_BROKERS') {
        const { data: brokers } = await supabase.from('brokers').select('*');
        if (!brokers || brokers.length === 0) {
          await answerCallbackQuery(query.id, 'هیچ صرافی‌ای ثبت نشده است.', true);
          return res.status(200).json({ ok: true });
        }
        let brokerBtns = brokers.map(b => [{ text: `🏛️ ${b.name} (${b.city || 'بدون شهر'})`, callback_data: `SELECT_BROKER:${b.broker_id}` }]);
        brokerBtns.push([{ text: '➕ افزودن صرافی جدید', callback_data: 'ADD_NEW_BROKER' }, { text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *لیست صرافی‌ها و کارگزاران فعال:*', brokerBtns);
      } 
      else if (data === 'ADD_NEW_BROKER') {
        userStates[userId] = { step: 'WAITING_NEW_BROKER_NAME' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *افزودن صرافی جدید*\n\nلطفاً **نام صرافی** را وارد کنید:', [[{ text: '❌ انصراف', callback_data: 'NAV_BROKERS' }]]);
      }
      else if (data.startsWith('SELECT_BROKER:')) {
        const brokerId = data.split(':')[1];
        const { data: broker } = await supabase.from('brokers').select('*').eq('broker_id', brokerId).single();
        if (!broker) return res.status(200).json({ ok: true });
        userStates[userId] = { brokerId, brokerName: broker.name, brokerAddresses: broker.addresses, step: 'BROKER_MENU' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `🏛️ *پنل کارگزار / صرافی:* *${broker.name}*\nشهر: \`${broker.city || '-'}\` | تلفن: \`${broker.phone || '-'}\``, [
          [{ text: '📊 دیدن مانده صرافی', callback_data: 'BROKER_VIEW_BAL' }, { text: '📜 دیدن تراکنش‌ها', callback_data: 'BROKER_VIEW_TXS' }],
          [{ text: '➕ ثبت معامله پله‌به‌پله صرافی', callback_data: 'WIZARD_STEP_OP' }, { text: '📍 مدیریت آدرس‌ها', callback_data: 'BROKER_MANAGE_ADDR' }],
          [{ text: '🗑️ حذف صرافی', callback_data: `DELETE_BROKER:${brokerId}` }],
          [{ text: '🔙 لیست صرافی‌ها', callback_data: 'NAV_BROKERS' }, { text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 
      else if (data === 'BROKER_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.brokerId) return res.status(200).json({ ok: true });
        let rep = await getBrokerVerticalBalanceText(st.brokerId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, rep, [[{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]);
      } 
      else if (data === 'BROKER_VIEW_TXS') {
        const st = userStates[userId];
        if (!st || !st.brokerId) return res.status(200).json({ ok: true });
        const { data: bTxs } = await supabase.from('broker_transactions').select('*').eq('broker_id', st.brokerId);
        if (!bTxs || bTxs.length === 0) {
          await answerCallbackQuery(query.id, 'تراکنشی یافت نشد', true);
          return res.status(200).json({ ok: true });
        }
        let txBtns = bTxs.slice(-10).reverse().map(t => {
          let dirSymbol = (t.direction || '').includes('بستانکار') ? '🟢' : '🔴';
          return [{ text: `${dirSymbol} ${formatMoney(t.amount_final || t.amount_initial)} ${t.currency} - ${t.operation_type}`, callback_data: `VIEW_BROKER_TX:${t.broker_tx_id}` }];
        });
        txBtns.push([{ text: '🔙 بازگشت', callback_data: `SELECT_BROKER:${st.brokerId}` }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📜 *معاملات صرافی:* *${st.brokerName}*`, txBtns);
      } 
      else if (data.startsWith('VIEW_BROKER_TX:')) {
        const bTxId = data.split(':')[1];
        const { data: tx } = await supabase.from('broker_transactions').select('*').eq('broker_tx_id', bTxId).single();
        if (!tx) return res.status(200).json({ ok: true });
        let detailText = `🔍 *جزئیات معامله صرافی:* \`${toEnglishDigits(bTxId)}\`\n\n` +
          `💰 مبلغ: *${formatMoney(tx.amount_final || tx.amount_initial)} ${tx.currency}*\n` +
          `🔄 جهت: *${tx.direction}*\n` +
          `📋 نوع عملیات: *${tx.operation_type}*\n` +
          `📅 تاریخ: \`${toEnglishDigits((tx.date || '').split('T')[0])}\`\n` +
          `📍 آدرس: _${tx.address_dashboard || '-'}_ \n` +
          `📝 شرح: _${tx.description || '-'}_`;
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, detailText, [
          [{ text: '🗑️ حذف معامله', callback_data: `DELETE_BROKER_TX:${bTxId}` }],
          [{ text: '🔙 لیست معاملات', callback_data: 'BROKER_VIEW_TXS' }]
        ]);
      } 
      else if (data.startsWith('DELETE_BROKER_TX:')) {
        const bTxId = data.split(':')[1];
        await supabase.from('broker_transactions').delete().eq('broker_tx_id', bTxId);
        await answerCallbackQuery(query.id, 'معامله حذف گردید.');
        const st = userStates[userId];
        if (st && st.brokerId) {
          await editTelegramMsg(chatId, msgId, '✅ *معامله با موفقیت حذف شد.*', [[{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]);
        }
      }
      else if (data.startsWith('DELETE_BROKER:')) {
        const bId = data.split(':')[1];
        await supabase.from('brokers').delete().eq('broker_id', bId);
        await answerCallbackQuery(query.id, 'صرافی حذف شد.');
        await editTelegramMsg(chatId, msgId, '✅ *صرافی و اطلاعات آن حذف گردید.*', [[{ text: '🏛️ لیست صرافی‌ها', callback_data: 'NAV_BROKERS' }]]);
      }
      // مدیریت آدرس‌های صرافی
      else if (data === 'BROKER_MANAGE_ADDR') {
        const st = userStates[userId];
        let addrs = [];
        try { addrs = typeof st.brokerAddresses === 'string' ? JSON.parse(st.brokerAddresses) : (st.brokerAddresses || []); } catch(e) { addrs = []; }
        let addrBtns = addrs.map(a => [{ text: `📍 ${a} (حذف)`, callback_data: `DEL_ADDR:${a}` }]);
        addrBtns.push([{ text: '➕ افزودن آدرس جدید', callback_data: 'ADD_NEW_ADDR' }]);
        addrBtns.push([{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📍 *مدیریت آدرس‌های صرافی:* *${st.brokerName}*`, addrBtns);
      }
      else if (data === 'ADD_NEW_ADDR') {
        userStates[userId].step = 'WAITING_NEW_ADDR_TEXT';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✍️ لطفاً **عنوان آدرس جدید** (مثلاً صرافی مرکزی، کیف پول تتر و...) را بفرستید:');
      }
      else if (data.startsWith('DEL_ADDR:')) {
        const addrToRemove = data.split(':')[1];
        const st = userStates[userId];
        let addrs = [];
        try { addrs = typeof st.brokerAddresses === 'string' ? JSON.parse(st.brokerAddresses) : (st.brokerAddresses || []); } catch(e) { addrs = []; }
        addrs = addrs.filter(a => a !== addrToRemove);
        st.brokerAddresses = JSON.stringify(addrs);
        await supabase.from('brokers').update({ addresses: st.brokerAddresses }).eq('broker_id', st.brokerId);
        await answerCallbackQuery(query.id, 'آدرس حذف شد.');
        await editTelegramMsg(chatId, msgId, '✅ *آدرس با موفقیت حذف گردید.*', [[{ text: '📍 مدیریت آدرس‌ها', callback_data: 'BROKER_MANAGE_ADDR' }]]);
      }
      // ویزارد ثبت معامله پله‌به‌پله صرافی
      else if (data === 'WIZARD_STEP_OP') {
        userStates[userId].wizard = { target: 'BROKER', step: 'OP_TYPE' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '📌 **گام ۱:** نوع معامله را انتخاب کنید:', [
          [{ text: 'حواله', callback_data: 'WZ_OP:حواله' }, { text: 'معامله', callback_data: 'WZ_OP:معامله' }],
          [{ text: 'دریافت / پرداخت', callback_data: 'WZ_OP:پرداخت' }, { text: 'تسویه', callback_data: 'WZ_OP:تسویه' }],
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      } 
      else if (data.startsWith('WZ_OP:')) {
        userStates[userId].wizard.opType = data.split(':')[1];
        userStates[userId].wizard.step = 'DIR';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۲:** جهت معامله را انتخاب کنید:`, [
          [{ text: '🟢 بستانکار (ورودی)', callback_data: 'WZ_DIR:بستانکار' }],
          [{ text: '🔴 بدهکار (خروجی)', callback_data: 'WZ_DIR:بدهکار' }],
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      } 
      else if (data.startsWith('WZ_DIR:')) {
        userStates[userId].wizard.direction = data.split(':')[1];
        userStates[userId].wizard.step = 'CURR';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۳:** ارز معامله را انتخاب کنید:`, [
          [{ text: 'USD (دلار)', callback_data: 'WZ_CURR:USD' }, { text: 'AFN (افغانی)', callback_data: 'WZ_CURR:AFN' }],
          [{ text: 'تومان', callback_data: 'WZ_CURR:تومان' }, { text: 'IQD (دینار)', callback_data: 'WZ_CURR:IQD' }],
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      } 
      else if (data.startsWith('WZ_CURR:')) {
        userStates[userId].wizard.currency = data.split(':')[1];
        userStates[userId].wizard.step = 'WAITING_AMT_INIT';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۴:** لطفاً **مبلغ اولیه معامله** را به عدد بفرستید:`, [
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      } 
      else if (data === 'WZ_SKIP_RATE') {
        const wz = userStates[userId].wizard;
        wz.amountFinal = wz.amountInit;
        wz.exchangeRate = null;
        wz.step = 'SELECT_ADDR';
        let addrs = [];
        try { addrs = typeof userStates[userId].brokerAddresses === 'string' ? JSON.parse(userStates[userId].brokerAddresses) : (userStates[userId].brokerAddresses || []); } catch (e) { addrs = []; }
        let btns = addrs.map(a => [{ text: `📍 ${a}`, callback_data: `WZ_ADDR:${a}` }]);
        btns.push([{ text: '✍️ تایپ آدرس جدید', callback_data: 'WZ_TYPING_ADDR' }]);
        btns.push([{ text: '⏭️ رد شدن از آدرس', callback_data: 'WZ_ADDR:-' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۵:** آدرس مقصد را انتخاب یا تایپ کنید:\n\n💰 مبلغ نهایی: *${formatMoney(wz.amountFinal)} ${wz.currency}*`, btns);
      } 
      else if (data.startsWith('WZ_ADDR:')) {
        const addr = data.split(':')[1];
        userStates[userId].wizard.address = addr;
        userStates[userId].wizard.step = 'WAITING_DESC';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 لطفاً **شرح / توضیحات معامله** را وارد کنید:`, [
          [{ text: '⏭️ بدون توضیحات (ثبت نهایی)', callback_data: 'WZ_FINALIZE' }]
        ]);
      } 
      else if (data === 'WZ_TYPING_ADDR') {
        userStates[userId].wizard.step = 'WAITING_CUSTOM_ADDR';
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `✍️ لطفاً آدرس مقصد را تایپ کرده و بفرستید:`);
      } 
      else if (data === 'WZ_FINALIZE') {
        const wz = userStates[userId].wizard;
        const st = userStates[userId];
        const brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString().split('T')[0];
        
        await supabase.from('broker_transactions').insert([{
          broker_tx_id: brokerTxId,
          broker_id: st.brokerId,
          date: txDate,
          operation_type: wz.opType,
          direction: wz.direction,
          currency: wz.currency,
          amount_initial: wz.amountInit,
          exchange_rate: wz.exchangeRate,
          amount_final: wz.amountFinal,
          description: wz.description || '-',
          address_dashboard: wz.address || '-'
        }]);

        let verticalRep = await getBrokerVerticalBalanceText(st.brokerId);
        let summaryMsg = `✅ *معامله صرافی با موفقیت ثبت شد.*\n\n` +
          `🏛️ صرافی: *${st.brokerName}*\n` +
          `🆔 کد معامله: \`${brokerTxId}\`\n` +
          `💰 مبلغ نهایی: *${formatMoney(wz.amountFinal)} ${wz.currency}* (${wz.direction})\n` +
          `📍 آدرس: _${wz.address || '-'}\n` +
          `${verticalRep}`;

        // ارسال گزارش هوشمند به ادمین و صرافی
        let { token, chatId: adminChat } = await getAdminTokenAndChat(userId);
        await sendTelegramMsg(adminChat, summaryMsg);

        await answerCallbackQuery(query.id, 'ثبت شد!');
        await editTelegramMsg(chatId, msgId, summaryMsg, [[{ text: '🏛️ بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]);
        delete userStates[userId].wizard;
      }
      // بخش گزارشات کلی و مالی
      else if (data === 'NAV_REPORTS') {
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '📈 *بخش گزارشات و آمار مالی جامع*\n\nنوع گزارش مورد نظر را انتخاب کنید:', [
          [{ text: '📊 گزارش کل موجودی‌ها', callback_data: 'REP_GLOBAL' }],
          [{ text: '🟢 لیست بستانکاران', callback_data: 'REP_CREDITORS' }, { text: '🔴 لیست بدهکاران', callback_data: 'REP_DEBTORS' }],
          [{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }
      else if (data === 'REP_GLOBAL') {
        const { data: accounts } = await supabase.from('accounts').select('*');
        const { data: allTxs } = await supabase.from('transactions').select('*');
        let globalCurrs = {};
        if (allTxs) {
          allTxs.forEach(t => {
            let c = (t.Currency || t.currency || 'USD').toUpperCase();
            let d = t.Direction || t.direction || '';
            let a = parseFloat(t.Amount || t.amount) || 0;
            if (!globalCurrs[c]) globalCurrs[c] = { credit: 0, debit: 0 };
            if (d.includes('بستانکار')) globalCurrs[c].credit += a;
            if (d.includes('بدهکار')) globalCurrs[c].debit += a;
          });
        }
        let repText = `📈 *گزارش کل سیستم و موجودی‌ها*\n────────────────────────\n`;
        for (let c in globalCurrs) {
          let net = globalCurrs[c].credit - globalCurrs[c].debit;
          repText += `🔹 *ارز ${c}:*\n  • کل بستانکاری کل: \`${formatMoney(globalCurrs[c].credit)}\`\n  • کل بدهکاری کل: \`${formatMoney(globalCurrs[c].debit)}\`\n  📌 *خالص کل:* *${formatMoney(Math.abs(net))} ${c}*\n\n`;
        }
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, repText, [[{ text: '🔙 بازگشت به گزارشات', callback_data: 'NAV_REPORTS' }]]);
      }
      // بخش مدیریت ادمین‌های همکار
      else if (data === 'NAV_ADMINS') {
        const { data: admins } = await supabase.from('admins').select('*');
        let admBtns = [];
        if (admins) {
          admins.forEach(a => {
            admBtns.push([{ text: `🛡️ ${a.Name || a.username || a.AdminID} (حذف)`, callback_data: `DEL_ADM:${a.AdminID || a.id}` }]);
          });
        }
        admBtns.push([{ text: '➕ افزودن ادمین همکار جدید', callback_data: 'ADD_NEW_ADMIN' }]);
        admBtns.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🛡️ *مدیریت ادمین‌های همکار سیستم:*', admBtns);
      }
      else if (data === 'ADD_NEW_ADMIN') {
        userStates[userId] = { step: 'WAITING_ADMIN_NAME' };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🛡️ **افزودن ادمین همکار جدید**\n\nلطفاً **نام ادمین** را وارد کنید:', [[{ text: '❌ انصراف', callback_data: 'NAV_ADMINS' }]]);
      }
      else if (data.startsWith('DEL_ADM:')) {
        const admId = data.split(':')[1];
        await supabase.from('admins').delete().eq('AdminID', admId);
        await answerCallbackQuery(query.id, 'ادمین حذف شد.');
        await editTelegramMsg(chatId, msgId, '✅ *ادمین همکار با موفقیت حذف گردید.*', [[{ text: '🛡️ مدیریت ادمین‌ها', callback_data: 'NAV_ADMINS' }]]);
      }

      return res.status(200).json({ ok: true });
    }

    // ۲. مدیریت پیام‌های متنی و ماشین وضعیت (State Machine / Wizard)
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await sendTelegramMsg(chatId, '⛔ دسترسی غیرمجاز به ربات مدیریت.');
        return res.status(200).json({ ok: true });
      }

      if (text === '/start') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه مدیریت حساب‌کتاب و صرافی کریمی* ✨\nلطفاً یک بخش را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🏛️ حساب صرافی‌ها', callback_data: 'NAV_BROKERS' }],
          [{ text: '📈 گزارشات مالی', callback_data: 'NAV_REPORTS' }, { text: '🛡️ ادمین‌ها', callback_data: 'NAV_ADMINS' }]
        ]);
        return res.status(200).json({ ok: true });
      }

      let st = userStates[userId];

      if (st && st.step === 'SEARCH_CUSTOMER_PROMPT') {
        const { data: accounts } = await supabase.from('accounts').select('*');
        let matched = accounts ? accounts.filter(a => (a.Name || a.name || '').toLowerCase().includes(text.toLowerCase()) || (a.Phone || a.phone || '').includes(text)) : [];
        if (matched.length === 0) {
          await sendTelegramMsg(chatId, `⚠️ مشتری با مشخصات «${text}» یافت نشد.`, [[{ text: `➕ ساخت حساب برای «${text}»`, callback_data: 'CREATE_NEW_ACC' }]]);
          return res.status(200).json({ ok: true });
        }
        let btns = matched.map(a => [{ text: `👤 ${a.Name || a.name} (${a.Phone || '-'.trim()})`, callback_data: `SELECT_CUST:${a.AccountID || a.accountid}` }]);
        await sendTelegramMsg(chatId, `🔍 نتایج جستجوی مشتریان:`, btns);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_NEW_ACC_NAME') {
        st.tempName = text;
        st.step = 'WAITING_NEW_ACC_PHONE';
        await sendTelegramMsg(chatId, `📞 لطفاً شماره تماس با کد کشور را برای *${text}* وارد کنید:`);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_NEW_ACC_PHONE') {
        const cleanPhone = toEnglishDigits(text);
        const newAccId = "ACC-" + Math.floor(100000 + Math.random() * 900000);
        await supabase.from('accounts').insert([{ AccountID: newAccId, Name: st.tempName, Phone: cleanPhone, CreatedBy: String(userId) }]);
        userStates[userId] = { accId: newAccId, accName: st.tempName, step: 'CUSTOMER_MENU' };
        await sendTelegramMsg(chatId, `✅ حساب مشتری با موفقیت افتتاح شد:\n👤 نام: ${st.tempName}\n📞 تلفن: ${cleanPhone}`, [[{ text: '👤 ورود به پنل مدیریت مشتری', callback_data: `SELECT_CUST:${newAccId}` }]]);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_NEW_BROKER_NAME') {
        st.tempBrokerName = text;
        st.step = 'WAITING_NEW_BROKER_PHONE';
        await sendTelegramMsg(chatId, `📞 لطفاً شماره تماس / واتساپ صرافی *${text}* را وارد کنید:`);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_NEW_BROKER_PHONE') {
        st.tempBrokerPhone = text;
        st.step = 'WAITING_NEW_BROKER_CITY';
        await sendTelegramMsg(chatId, `🏙️ لطفاً شهر فعالیت صرافی را وارد کنید:`);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_NEW_BROKER_CITY') {
        const brokerId = "BRK-" + Math.floor(1000 + Math.random() * 9000);
        await supabase.from('brokers').insert([{
          broker_id: brokerId,
          name: st.tempBrokerName,
          phone: st.tempBrokerPhone,
          city: text,
          CreatedBy: String(userId)
        }]);
        delete userStates[userId];
        await sendTelegramMsg(chatId, `✅ صرافی جدید با موفقیت ثبت شد.`, [[{ text: '🏛️ لیست صرافی‌ها', callback_data: 'NAV_BROKERS' }]]);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_NEW_ADDR_TEXT') {
        let addrs = [];
        try { addrs = typeof st.brokerAddresses === 'string' ? JSON.parse(st.brokerAddresses) : (st.brokerAddresses || []); } catch(e) { addrs = []; }
        addrs.push(text);
        st.brokerAddresses = JSON.stringify(addrs);
        await supabase.from('brokers').update({ addresses: st.brokerAddresses }).eq('broker_id', st.brokerId);
        await sendTelegramMsg(chatId, `✅ آدرس جدید «${text}» با موفقیت اضافه شد.`, [[{ text: '📍 مدیریت آدرس‌ها', callback_data: 'BROKER_MANAGE_ADDR' }]]);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_ADMIN_NAME') {
        st.tempAdmName = text;
        st.step = 'WAITING_ADMIN_CHATID';
        await sendTelegramMsg(chatId, `🆔 لطفاً چت‌آیدی (ChatID) تلگرام ادمین همکار را وارد کنید:`);
        return res.status(200).json({ ok: true });
      }

      if (st && st.step === 'WAITING_ADMIN_CHATID') {
        const admId = "ADM-" + Math.floor(1000 + Math.random() * 9000);
        await supabase.from('admins').insert([{
          AdminID: admId,
          Name: st.tempAdmName,
          ChatID: toEnglishDigits(text)
        }]);
        delete userStates[userId];
        await sendTelegramMsg(chatId, `✅ ادمین همکار جدید با موفقیت ایجاد شد.`, [[{ text: '🛡️ مدیریت ادمین‌ها', callback_data: 'NAV_ADMINS' }]]);
        return res.status(200).json({ ok: true });
      }

      // ثبت تراکنش مشتری
      if (st && st.wizard && st.wizard.target === 'CUST' && st.wizard.step === 'C_WAITING_AMT') {
        const amt = parseFloat(toEnglishDigits(text));
        if (isNaN(amt) || amt <= 0) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ معتبری وارد کنید:');
          return res.status(200).json({ ok: true });
        }
        st.wizard.amount = amt;
        st.wizard.step = 'C_WAITING_DESC';
        await sendTelegramMsg(chatId, '📝 لطفاً توضیحات یا شرح تراکنش را بفرستید:');
        return res.status(200).json({ ok: true });
      }

      if (st && st.wizard && st.wizard.target === 'CUST' && st.wizard.step === 'C_WAITING_DESC') {
        st.wizard.description = text;
        const wz = st.wizard;
        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString();
        
        await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: st.accId,
          Direction: wz.direction,
          Amount: wz.amount,
          Currency: wz.currency,
          OperationType: wz.opType,
          Description: text,
          Date: txDate
        }]);

        await sendTelegramMsg(chatId, `✅ تراکنش مشتری با موفقیت ثبت شد.\nمبلغ: ${formatMoney(wz.amount)} ${wz.currency} (${wz.direction})`, [[{ text: '👤 پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]]);
        delete userStates[userId].wizard;
        return res.status(200).json({ ok: true });
      }

      // ثبت مبلغ اولیه معامله صرافی
      if (st && st.wizard && st.wizard.step === 'WAITING_AMT_INIT') {
        const amt = parseFloat(toEnglishDigits(text));
        if (isNaN(amt) || amt <= 0) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ معتبری وارد کنید:');
          return res.status(200).json({ ok: true });
        }
        st.wizard.amountInit = amt;
        st.wizard.calcMode = 'divide';
        st.wizard.step = 'WAITING_RATE';
        await sendTelegramMsg(chatId, `💰 مبلغ اولیه: *${formatMoney(amt)} ${st.wizard.currency}*\n\n🔢 لطفاً **نرخ تبدیل / صرف** را وارد کنید:`, [
          [{ text: '⏭️ بدون نرخ (مبلغ نهایی = اولیه)', callback_data: 'WZ_SKIP_RATE' }]
        ]);
        return res.status(200).json({ ok: true });
      }

      // رفع کامل مشکل گیر کردن در مرحله‌ی نرخ تبدیل صرافی
      if (st && st.wizard && st.wizard.step === 'WAITING_RATE') {
        const rate = parseFloat(toEnglishDigits(text));
        if (isNaN(rate) || rate <= 0) {
          await sendTelegramMsg(chatId, '⚠️ نرخ معتبری وارد کنید:');
          return res.status(200).json({ ok: true });
        }
        st.wizard.exchangeRate = rate;
        st.wizard.amountFinal = st.wizard.calcMode === 'multiply' ? (st.wizard.amountInit * rate) : (st.wizard.amountInit / rate);
        st.wizard.step = 'SELECT_ADDR';

        let addrs = [];
        try { addrs = typeof st.brokerAddresses === 'string' ? JSON.parse(st.brokerAddresses) : (st.brokerAddresses || []); } catch (e) { addrs = []; }
        let btns = addrs.map(a => [{ text: `📍 ${a}`, callback_data: `WZ_ADDR:${a}` }]);
        btns.push([{ text: '✍️ تایپ آدرس جدید', callback_data: 'WZ_TYPING_ADDR' }]);
        btns.push([{ text: '⏭️ رد شدن از آدرس', callback_data: 'WZ_ADDR:-' }]);

        await sendTelegramMsg(chatId, `✅ نرخ اعمال شد.\n💵 مبلغ نهایی: *${formatMoney(st.wizard.amountFinal)} ${st.wizard.currency}*\n\nآدرس مقصد را انتخاب کنید:`, btns);
        return res.status(200).json({ ok: true });
      }

      if (st && st.wizard && st.wizard.step === 'WAITING_CUSTOM_ADDR') {
        st.wizard.address = text;
        st.wizard.step = 'WAITING_DESC';
        await sendTelegramMsg(chatId, `📍 آدرس: *${text}*\n\n📝 لطفاً توضیحات معامله را بنویسید:`, [
          [{ text: '⏭️ بدون توضیحات (ثبت نهایی)', callback_data: 'WZ_FINALIZE' }]
        ]);
        return res.status(200).json({ ok: true });
      }

      if (st && st.wizard && st.wizard.step === 'WAITING_DESC') {
        st.wizard.description = text;
        const wz = st.wizard;
        const brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
        const txDate = new Date().toISOString().split('T')[0];
        
        await supabase.from('broker_transactions').insert([{
          broker_tx_id: brokerTxId,
          broker_id: st.brokerId,
          date: txDate,
          operation_type: wz.opType,
          direction: wz.direction,
          currency: wz.currency,
          amount_initial: wz.amountInit,
          exchange_rate: wz.exchangeRate,
          amount_final: wz.amountFinal,
          description: text,
          address_dashboard: wz.address || '-'
        }]);

        let verticalRep = await getBrokerVerticalBalanceText(st.brokerId);
        let summaryMsg = `✅ *معامله صرافی با موفقیت ثبت شد.*\n\n` +
          `🏛️ صرافی: *${st.brokerName}*\n` +
          `🆔 کد: \`${brokerTxId}\`\n` +
          `💰 مبلغ نهایی: *${formatMoney(wz.amountFinal)} ${wz.currency}* (${wz.direction})\n` +
          `📝 شرح: _${text}_\n` +
          `${verticalRep}`;

        await sendTelegramMsg(chatId, summaryMsg, [[{ text: '🏛️ پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]);
        delete userStates[userId].wizard;
        return res.status(200).json({ ok: true });
      }
    }
  } catch (err) {
    console.error('Critical Error:', err);
  }

  return res.status(200).json({ ok: true });
};
