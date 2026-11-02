const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

const MASTER_ADMIN_ID = 802655440;
const userStates = {};

function toEnglishDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
}

function formatMoney(amount) {
  let num = parseFloat(amount);
  if (isNaN(num)) return '0';
  return toEnglishDigits(num.toLocaleString('en-US'));
}

async function sendTelegramMsg(chatId, text, inlineKeyboard = null) {
  const opts = { parse_mode: 'Markdown' };
  if (inlineKeyboard) opts.reply_markup = { inline_keyboard: inlineKeyboard };
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (err) {
    console.error("Telegram Send Error:", err);
  }
}

async function editTelegramMsg(chatId, messageId, text, inlineKeyboard = null) {
  const opts = { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' };
  if (inlineKeyboard) opts.reply_markup = { inline_keyboard: inlineKeyboard };
  try {
    return await bot.editMessageText(text, opts);
  } catch (err) {
    console.error("Telegram Edit Error:", err);
  }
}

function parseTransactionText(text) {
  const cleanText = toEnglishDigits(text);
  const amountMatch = cleanText.match(/\d+(\.\d+)?/);
  const amount = amountMatch ? parseFloat(amountMatch[0]) : null;

  let currency = 'USD';
  if (text.includes('افغانی') || text.includes('AFN')) currency = 'AFN';
  else if (text.includes('تومان') || text.includes('تومن')) currency = 'تومان';
  else if (text.includes('دینار') || text.includes('IQD')) currency = 'IQD';

  let isCredit = text.includes('دریافت') || text.includes('رسید') || text.includes('آمد') || text.includes('بستانکار') || text.includes('گرفتم');
  if (text.includes('دادم') || text.includes('رساندم') || text.includes('پرداخت') || text.includes('فرستادم')) {
    isCredit = false;
  }
  const direction = isCredit ? 'بستانکار' : 'بدهکار';

  let opType = 'امانت';
  if (text.includes('حواله')) opType = 'حواله';
  else if (text.includes('تسویه')) opType = 'تسویه';
  else if (text.includes('انتقال')) opType = 'انتقال';

  return { amount, currency, direction, opType };
}

async function getBrokerVerticalBalanceText(brokerId) {
  const { data: txs } = await supabase.from('broker_transactions').select('currency, direction, amount_final, amount_initial').eq('broker_id', brokerId);
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
  for (let curr in currencyTotals) {
    let cred = currencyTotals[curr].creditor;
    let debt = currencyTotals[curr].debtor;
    let net = cred - debt;
    lines.push(`🔹 *ارز ${curr}:*`);
    lines.push(`  • کل بستانکار: \`${formatMoney(cred)}\``);
    lines.push(`  • کل بدهکار: \`${formatMoney(debt)}\``);
    lines.push(`  • مانده نهایی: *${formatMoney(Math.abs(net))} ${curr} (${net >= 0 ? "بستانکار" : "بدهکار"})*`);
    lines.push(`-----------------------------------`);
  }
  return lines.length > 1 ? lines.join("\n") : "\n📊 گزارش صرافی: تراکنشی یافت نشد.";
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running');
  }

  // سریع پاسخ دادن به تلگرام برای جلوگیری از تایم‌اوت و تاخیر
  res.status(200).send('OK');

  try {
    const update = req.body;
    if (!update) return;

    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;
      const data = query.data;

      if (userId !== MASTER_ADMIN_ID) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز', show_alert: true });
        return;
      }

      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه مدیریت حساب‌کتاب* ✨\nلطفاً بخش مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }],
          [{ text: '🏛️ صرافی‌ها و کارگزاران', callback_data: 'NAV_BROKERS' }]
        ]);
      }
      else if (data === 'NAV_CUSTOMERS') {
        userStates[userId] = { step: 'SEARCH_CUST' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *بخش مشتریان*\n\nلطفاً **نام مشتری** را جهت جستجو ارسال کنید:', [
          [{ text: '➕ افتتاح حساب جدید', callback_data: 'NEW_CUST' }],
          [{ text: '🔙 بازگشت', callback_data: 'NAV_MAIN' }]
        ]);
      }
      else if (data === 'NEW_CUST') {
        userStates[userId] = { step: 'WAITING_CUST_NAME' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👤 *افتتاح حساب جدید*\n\nلطفاً نام و فامیلی مشتری را وارد کنید:', [
          [{ text: '❌ انصراف', callback_data: 'NAV_CUSTOMERS' }]
        ]);
      }
      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('Name, Phone, ChatID').eq('AccountID', accId).single();
        if (!acc) return;

        userStates[userId] = { accId, accName: acc.Name, step: 'CUST_PANEL' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `👤 *مشتری:* *${acc.Name}*\n🆔 کد: \`${accId}\`\n📞 تلفن: \`${acc.Phone || '-'}\``, [
          [{ text: '➕ ثبت تراکنش جدید', callback_data: 'CUST_ADD_TX' }],
          [{ text: '🔙 بازگشت به مشتریان', callback_data: 'NAV_CUSTOMERS' }]
        ]);
      }
      else if (data === 'CUST_ADD_TX') {
        userStates[userId].step = 'WAITING_CUST_TX';
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 متن تراکنش را بفرستید (مثلاً: *800 دلار دریافت شد*):`, [
          [{ text: '❌ انصراف', callback_data: `SELECT_CUST:${userStates[userId].accId}` }]
        ]);
      }
      else if (data === 'NAV_BROKERS') {
        const { data: brokers } = await supabase.from('brokers').select('broker_id, name, city');
        if (!brokers || brokers.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'صرافی‌ای یافت نشد', show_alert: true });
          return;
        }
        let btns = brokers.map(b => [{ text: `🏛️ ${b.name} (${b.city || ''})`, callback_data: `SELECT_BROKER:${b.broker_id}` }]);
        btns.push([{ text: '🔙 بازگشت', callback_data: 'NAV_MAIN' }]);
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *لیست صرافی‌ها:*', btns);
      }
      else if (data.startsWith('SELECT_BROKER:')) {
        const brokerId = data.split(':')[1];
        const { data: broker } = await supabase.from('brokers').select('name, city, phone').eq('broker_id', brokerId).single();
        if (!broker) return;

        userStates[userId] = { brokerId, brokerName: broker.name, step: 'BROKER_PANEL' };
        await bot.answerCallbackQuery(query.id);
        let balanceRep = await getBrokerVerticalBalanceText(brokerId);
        await editTelegramMsg(chatId, msgId, `🏛️ *صرافی:* *${broker.name}*\n${balanceRep}`, [
          [{ text: '➕ ثبت معامله صرافی', callback_data: 'BROKER_ADD_TX' }],
          [{ text: '🔙 لیست صرافی‌ها', callback_data: 'NAV_BROKERS' }]
        ]);
      }
      else if (data === 'BROKER_ADD_TX') {
        userStates[userId].step = 'WAITING_BROKER_TX';
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 متن معامله صرافی را ارسال کنید (مثلاً: *حواله 1000 دلار به کابل*):`, [
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      }
      return;
    }

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (userId !== MASTER_ADMIN_ID) return;

      if (text === '/start') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه مدیریت حساب‌کتاب* ✨\nلطفاً یک بخش را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }],
          [{ text: '🏛️ حساب کارگزاران / صرافی‌ها', callback_data: 'NAV_BROKERS' }]
        ]);
        return;
      }

      let st = userStates[userId];

      if (st && st.step === 'WAITING_CUST_NAME') {
        st.tempName = text;
        st.step = 'WAITING_CUST_PHONE';
        await sendTelegramMsg(chatId, `📞 لطفاً شماره تماس با کد کشور را برای *${text}* وارد کنید (مثل \`+93790000000\`):`);
        return;
      }

      if (st && st.step === 'WAITING_CUST_PHONE') {
        const cleanPhone = toEnglishDigits(text);
        if (!cleanPhone.startsWith('+') || cleanPhone.length < 10) {
          await sendTelegramMsg(chatId, `⚠️ شماره تلفن نامعتبر است! حتماً با کد کشور شروع شود:`);
          return;
        }

        const newAccId = "ACC-" + Math.floor(100000 + Math.random() * 900000);
        await supabase.from('accounts').insert([{ AccountID: newAccId, Name: st.tempName, Phone: cleanPhone, CreatedBy: String(userId) }]);

        userStates[userId] = { accId: newAccId, accName: st.tempName, step: 'CUST_PANEL' };
        await sendTelegramMsg(chatId, `✅ حساب مشتری افتتاح شد:\n👤 ${st.tempName}\n📞 ${cleanPhone}`, [
          [{ text: '➕ ثبت تراکنش', callback_data: 'CUST_ADD_TX' }]
        ]);
        return;
      }

      if (st && st.step === 'SEARCH_CUST') {
        const { data: accounts } = await supabase.from('accounts').select('AccountID, Name');
        let matched = accounts ? accounts.filter(a => (a.Name || '').toLowerCase().includes(text.toLowerCase())) : [];

        if (matched.length === 0) {
          await sendTelegramMsg(chatId, `⚠️ مشتری یافت نشد.`);
          return;
        }
        let btns = matched.map(a => [{ text: `👤 ${a.Name}`, callback_data: `SELECT_CUST:${a.AccountID}` }]);
        await sendTelegramMsg(chatId, `🔍 نتایج جستجو:`, btns);
        return;
      }

      if (st && st.step === 'WAITING_CUST_TX') {
        const parsed = parseTransactionText(text);
        if (!parsed.amount) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ معتبری در متن یافت نشد.');
          return;
        }

        const transId = "TX-" + Math.floor(10000000 + Math.random() * 90000000);
        await supabase.from('transactions').insert([{
          TransID: transId,
          AccountID: st.accId,
          Direction: parsed.direction,
          Amount: parsed.amount,
          Currency: parsed.currency,
          OperationType: parsed.opType,
          Description: text,
          Date: new Date().toISOString()
        }]);

        let msg = `✅ تراکنش ثبت شد:\n👤 ${st.accName}\n💰 ${formatMoney(parsed.amount)} ${parsed.currency} (${parsed.direction})`;
        await sendTelegramMsg(chatId, msg, [[{ text: '👤 پنل مشتری', callback_data: `SELECT_CUST:${st.accId}` }]]);
        delete userStates[userId];
        return;
      }

      if (st && st.step === 'WAITING_BROKER_TX') {
        const parsed = parseTransactionText(text);
        if (!parsed.amount) {
          await sendTelegramMsg(chatId, '⚠️ مبلغ معتبری یافت نشد.');
          return;
        }

        const brokerTxId = "BTX-" + Math.floor(10000000 + Math.random() * 90000000);
        await supabase.from('broker_transactions').insert([{
          broker_tx_id: brokerTxId,
          broker_id: st.brokerId,
          date: new Date().toISOString().split('T')[0],
          operation_type: parsed.opType,
          direction: parsed.direction,
          currency: parsed.currency,
          amount_initial: parsed.amount,
          amount_final: parsed.amount,
          description: text,
          address_dashboard: text.includes('آدرس') ? text.split('آدرس')[1].trim() : '-'
        }]);

        let verticalRep = await getBrokerVerticalBalanceText(st.brokerId);
        let msg = `✅ معامله صرافی ثبت شد (${st.brokerName}):\n💰 ${formatMoney(parsed.amount)} ${parsed.currency} (${parsed.direction})\n${verticalRep}`;
        await sendTelegramMsg(chatId, msg, [[{ text: '🏛️ پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]);
        delete userStates[userId];
        return;
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
};
