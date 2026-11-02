/**
 * ==============================================================================
 * 🏛️ سامانه جامع و هوشمند ربات تلگرام صرافی و امانت‌داری کریمی
 * مبتنی بر پردازش هوشمند و دقیق متن (Smart NLP Parser - v2)
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

function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[۰-۹٠-٩]/g, function (d) {
    return d.charCodeAt(0) >= 1776 ? d.charCodeAt(0) - 1776 : d.charCodeAt(0) - 1632;
  });
}

function formatMoney(amount) {
  let num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return toEnglishDigits(num.toLocaleString('en-US'));
}

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
      return admins.some(adm => String(adm.ChatID || adm.chatid || '') === String(userId));
    }
  } catch (e) {
    console.error("Auth Error:", e);
  }
  return false;
}

async function getBrokerVerticalBalanceText(brokerId) {
  const { data: txs } = await supabase.from('broker_transactions').select('*').eq('broker_id', brokerId);
  let currencyTotals = {};
  if (txs) {
    txs.forEach(tx => {
      let curr = (tx.currency || 'USD').toUpperCase();
      let dir = tx.direction || '';
      let amt = parseFloat(tx.amount_final || tx.amount_initial) || 0;
      if (!currencyTotals[curr]) currencyTotals[curr] = { creditor: 0, debtor: 0 };
      if (dir.includes('بستانکار')) currencyTotals[curr].creditor += amt;
      if (dir.includes('بدهکار')) currencyTotals[curr].debtor += amt;
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
 * 🧠 موتور اصلاح‌شده تجزیه و تحلیل متن (Smart NLP Parser)
 */
function parseTransactionText(rawText) {
  const text = toEnglishDigits(rawText);

  // ۱. تعیین جهت بر اساس قانون فاعل
  let direction = 'بستانکار';
  const firstPersonVerbs = ['کردم', 'اجرا کردم', 'پرداخت کردم', 'رساندم', 'دادم'];
  const thirdPersonDebtors = ['گرفت', 'گرفتش'];

  if (firstPersonVerbs.some(v => text.includes(v)) || thirdPersonDebtors.some(v => text.includes(v))) {
    direction = 'بدهکار';
  }

  // ۲. استخراج واحد ارز
  let currency = 'USD';
  if (/تومان|تمن/i.test(text)) currency = 'تومان';
  else if (/افغانی|AFN/i.test(text)) currency = 'AFN';
  else if (/دینار|IQD/i.test(text)) currency = 'IQD';
  else if (/دلار|USD|\$/i.test(text)) currency = 'USD';

  // ۳. استخراج مبالغ و نرخ تبدیل (بررسی دقیق عملگر تقسیم ➗ یا /)
  let amountInitial = 0;
  let exchangeRate = null;
  let amountFinal = 0;

  // جستجوی خط اصلی مبلغ معامله (معمولاً خط اول یا دوم قبل از بخش توضیحات)
  const lines = text.split('\n');
  const mainLine = lines[0] || text;
  const numbers = mainLine.match(/\d+(\.\d+)?/g);

  if (numbers && numbers.length > 0) {
    amountInitial = parseFloat(numbers[0]);
    amountFinal = amountInitial;

    // اگر علامت تقسیم یا نرخ مشخصی در متن بود
    if (text.includes('÷') || text.includes('/')) {
      // استخراج نرخ در صورت وجود علامت تقسیم
      const matchRate = text.match(/[÷\/]\s*(\d+(\.\d+)?)/);
      if (matchRate && matchRate[1]) {
        exchangeRate = parseFloat(matchRate[1]);
        if (exchangeRate > 0) {
          amountFinal = parseFloat((amountInitial / exchangeRate).toFixed(2));
        }
      }
    }
  }

  // ۴. استخراج آدرس مقصد از لیست آدرس‌ها
  let address = '-';
  const cities = ['کابل', 'تهران', 'هرات', 'مزار', 'قندهار', 'دبی', 'مشهد', 'اصفهان'];
  for (let city of cities) {
    if (text.includes(city)) {
      address = city;
      break;
    }
  }

  // ۵. استخراج دقیق بخش شرح و توضیحات
  let description = text;
  const descMatch = text.match(/توضیح[:\s]*(.+)/s);
  if (descMatch && descMatch[1]) {
    description = descMatch[1].trim();
  }

  let operationType = text.includes('حواله') ? 'حواله' : 'معامله';

  return {
    direction,
    currency,
    amountInitial,
    exchangeRate,
    amountFinal,
    address,
    operationType,
    description
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running & Ready');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;
      const data = query.data;

      if (!(await isAuthorizedAdmin(userId))) {
        await answerCallbackQuery(query.id, '❌ دسترسی غیرمجاز', true);
        return res.status(200).json({ ok: true });
      }

      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه مدیریت حساب‌کتاب و صرافی کریمی*\nلطفاً بخش مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🏛️ حساب صرافی‌ها', callback_data: 'NAV_BROKERS' }],
          [{ text: '📈 گزارشات کلی', callback_data: 'NAV_REPORTS' }]
        ]);
      } 
      else if (data === 'NAV_CUSTOMERS') {
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *بخش حساب مشتریان*\n\nبرای جستجو نام یا شماره مشتری را ارسال کنید:', [
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 
      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        if (!acc) return res.status(200).json({ ok: true });
        userStates[userId] = { accId, accName: acc.Name || acc.name, activeBrokerId: userStates[userId]?.activeBrokerId };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *پنل مشتری:* *${acc.Name || acc.name}*\n🆔 کد: \`${toEnglishDigits(accId)}\`\n📞 تلفن: \`${acc.Phone || acc.phone || '-'}\``, [
          [{ text: '📊 دیدن مانده‌ها', callback_data: 'CUST_VIEW_BAL' }],
          [{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 
      else if (data === 'CUST_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.accId) return res.status(200).json({ ok: true });
        let balText = `📊 *صورت‌حساب:* *${st.accName}*\n────────────────────────\n` + await getAccountLiveBalanceText(st.accId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, balText, [[{ text: '🔙 بازگشت', callback_data: `SELECT_CUST:${st.accId}` }]]);
      } 
      else if (data === 'NAV_BROKERS') {
        const { data: brokers } = await supabase.from('brokers').select('*');
        let brokerBtns = (brokers || []).map(b => [{ text: `🏛️ ${b.name} (${b.city || 'بدون شهر'})`, callback_data: `SELECT_BROKER:${b.broker_id}` }]);
        brokerBtns.push([{ text: '🔙 منوی اصلی', callback_data: 'NAV_MAIN' }]);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *انتخاب صرافی فعال:*', brokerBtns);
      } 
      else if (data.startsWith('SELECT_BROKER:')) {
        const brokerId = data.split(':')[1];
        const { data: broker } = await supabase.from('brokers').select('*').eq('broker_id', brokerId).single();
        if (!broker) return res.status(200).json({ ok: true });
        userStates[userId] = { activeBrokerId: brokerId, brokerName: broker.name };
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `✅ *صرافی فعال انتخاب شد:* *${broker.name}*\n\nاکنون هر پیام متنی بفرستید، مستقیماً برای این صرافی پردازش و ثبت می‌شود.`, [
          [{ text: '📊 دیدن مانده صرافی', callback_data: 'BROKER_VIEW_BAL' }],
          [{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      } 
      else if (data === 'BROKER_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.activeBrokerId) return res.status(200).json({ ok: true });
        let rep = await getBrokerVerticalBalanceText(st.activeBrokerId);
        await answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, rep, [[{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]]);
      }

      return res.status(200).json({ ok: true });
    }

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await sendTelegramMsg(chatId, '⛔ دسترسی غیرمجاز.');
        return res.status(200).json({ ok: true });
      }

      if (text === '/start') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه هوشمند صرافی و امانت‌داری کریمی*\nلطفاً صرافی مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🏛️ انتخاب صرافی', callback_data: 'NAV_BROKERS' }]
        ]);
        return res.status(200).json({ ok: true });
      }

      let st = userStates[userId] || {};
      const parsedData = parseTransactionText(text);

      if (!parsedData.amountInitial || parsedData.amountInitial <= 0) {
        await sendTelegramMsg(chatId, '⚠️ مبلغی در متن پیام شما یافت نشد.');
        return res.status(200).json({ ok: true });
      }

      // ثبت در صرافی
      let brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
      let txDate = new Date().toISOString().split('T')[0];

      if (st.activeBrokerId) {
        await supabase.from('broker_transactions').insert([{
          broker_tx_id: brokerTxId,
          broker_id: st.activeBrokerId,
          date: txDate,
          operation_type: parsedData.operationType,
          direction: parsedData.direction,
          currency: parsedData.currency,
          amount_initial: parsedData.amountInitial,
          exchange_rate: parsedData.exchangeRate,
          amount_final: parsedData.amountFinal,
          description: parsedData.description,
          address_dashboard: parsedData.address
        }]);
      }

      // اتصال هوشمند به مشتری و استخراج مبلغ اختصاصی مشتری از متن
      const { data: accounts } = await supabase.from('accounts').select('*');
      let matchedCustomer = null;
      if (accounts) {
        matchedCustomer = accounts.find(a => text.includes(a.Name || a.name));
      }

      let customerReportMsg = "";
      if (matchedCustomer) {
        // استخراج مبلغ مخصوص مشتری از متن (اگر در بخش اتصال مبلغ جداگانه ذکر شده باشد)
        let custAmount = parsedData.amountFinal;
        const custMatch = text.match(/(?:برداشت|اضافه|واریز|پرداخت)?\s*(\d+(\.\d+)?)\s*(دینار|دلار|تومان|افغانی|IQD|USD|AFN)/i);
        if (custMatch && custMatch[1]) {
          custAmount = parseFloat(custMatch[1]);
        }

        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: matchedCustomer.AccountID || matchedCustomer.accountid,
          Direction: parsedData.direction,
          Amount: custAmount,
          Currency: parsedData.currency,
          OperationType: parsedData.operationType,
          Description: parsedData.description,
          Date: new Date().toISOString()
        }]);
        customerReportMsg = `\n👤 *اتصال به مشتری:* ${matchedCustomer.Name || matchedCustomer.name} (${formatMoney(custAmount)} ${parsedData.currency} ثبت شد)`;
      }

      let summaryMsg = `✅ *تراکنش با موفقیت پردازش و ثبت گردید.*\n\n` +
        `🔄 *جهت:* ${parsedData.direction}\n` +
        `💰 *مبلغ نهایی:* ${formatMoney(parsedData.amountFinal)} ${parsedData.currency}\n` +
        `📍 *آدرس مقصد:* ${parsedData.address}\n` +
        `📝 *شرح:* _${parsedData.description}_` +
        customerReportMsg;

      if (st.activeBrokerId) {
        let verticalRep = await getBrokerVerticalBalanceText(st.activeBrokerId);
        summaryMsg += `\n${verticalRep}`;
      }

      await sendTelegramMsg(chatId, summaryMsg);
    }
  } catch (err) {
    console.error('Critical Error:', err);
  }

  return res.status(200).json({ ok: true });
};
