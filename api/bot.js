const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = "https://zpehwkvtbiceurfpafiw.supabase.co";
const SUPABASE_KEY = "sb_publishable__ZK44kWZES328UQJ7P_zzw_tZoc465D";
const TELEGRAM_TOKEN = "8896092487:AAGc5sE1n8iSXwxNZ8HOdnRhUpsPod6Vx5U"; // توکن جدید ربات شما

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TELEGRAM_TOKEN);

const MASTER_ADMIN_ID = "802655440";
const userStates = {};

// تبدیل اعداد فارسی و عربی به انگلیسی
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

// بررسی دسترسی ادمین
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot Server is Running & Ready');
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).send('OK');

    // مدیریت دکمه‌های شیشه‌ای (Callback Queries)
    if (update.callback_query) {
      const query = update.callback_query;
      const userId = query.from.id;
      const chatId = query.message.chat.id;
      const msgId = query.message.message_id;
      const data = query.data;

      if (!(await isAuthorizedAdmin(userId))) {
        await bot.answerCallbackQuery(query.id, { text: '❌ دسترسی غیرمجاز', show_alert: true });
        return res.status(200).send('OK');
      }

      // منوی اصلی
      if (data === 'NAV_MAIN') {
        delete userStates[userId];
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '✨ *سامانه هوشمند مدیریت حساب‌کتاب و صرافی* ✨\nلطفاً بخش مورد نظر را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }],
          [{ text: '🏛️ صرافی‌ها و کارگزاران', callback_data: 'NAV_BROKERS' }]
        ]);
      }

      // مدیریت مشتریان
      else if (data === 'NAV_CUSTOMERS') {
        userStates[userId] = { step: 'SEARCH_CUSTOMER' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👥 *بخش مدیریت مشتریان*\n\nلطفاً **نام مشتری** را جهت جستجو ارسال کنید:', [
          [{ text: '➕ افتتاح حساب جدید', callback_data: 'PROMPT_NEW_CUST' }],
          [{ text: '🔙 بازگشت به منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      else if (data === 'PROMPT_NEW_CUST') {
        userStates[userId] = { step: 'WAITING_CUST_NAME' };
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '👤 *افتتاح حساب جدید*\n\nلطفاً نام و فامیلی کامل مشتری را وارد کنید:', [
          [{ text: '❌ انصراف', callback_data: 'NAV_CUSTOMERS' }]
        ]);
      }

      else if (data.startsWith('SELECT_CUST:')) {
        const accId = data.split(':')[1];
        const { data: acc } = await supabase.from('accounts').select('*').eq('AccountID', accId).single();
        if (!acc) return res.status(200).send('OK');

        const accName = acc.Name || acc.name;
        userStates[userId] = { accId, accName, step: 'CUST_PANEL' };
        await bot.answerCallbackQuery(query.id);

        await editTelegramMsg(chatId, msgId, `👤 *مشتری:* *${accName}*\n🆔 کد حساب: \`${accId}\`\n📞 تلفن: \`${acc.Phone || acc.phone || '-'}\``, [
          [{ text: '📊 دیدن مانده‌ها', callback_data: 'CUST_BAL' }, { text: '📜 دیدن تراکنش‌ها', callback_data: 'CUST_TXS' }],
          [{ text: '➕ ثبت تراکنش جدید', callback_data: 'CUST_ADD_TX' }],
          [{ text: '🔙 بازگشت', callback_data: 'NAV_CUSTOMERS' }, { text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      else if (data === 'CUST_BAL') {
        const st = userStates[userId];
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
        let txt = `📊 *مانده حساب ${st.accName}:*\n\n`;
        for (let c in currs) {
          let net = currs[c].credit - currs[c].debit;
          txt += `🔹 ${c}: بستانکار(${formatMoney(currs[c].credit)}) | بدهکار(${formatMoney(currs[c].debit)}) ➔ *مانده: ${formatMoney(Math.abs(net))} ${c} (${net >= 0 ? 'بستانکار' : 'بدهکار'})*\n`;
        }
        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, txt, [
          [{ text: '🔙 بازگشت', callback_data: `SELECT_CUST:${st.accId}` }]
        ]);
      }

      return res.status(200).send('OK');
    }

    // مدیریت پیام‌های متنی پله‌به‌پله
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();

      if (!(await isAuthorizedAdmin(userId))) {
        await sendTelegramMsg(chatId, '⛔ دسترسی غیرمجاز.');
        return res.status(200).send('OK');
      }

      if (text === '/start') {
        delete userStates[userId];
        await sendTelegramMsg(chatId, '✨ *سامانه مدیریت حساب‌کتاب و صرافی* ✨\nلطفاً یک بخش را انتخاب کنید:', [
          [{ text: '👥 حساب مشتریان', callback_data: 'NAV_CUSTOMERS' }, { text: '🏛️ صرافی‌ها و کارگزاران', callback_data: 'NAV_BROKERS' }]
        ]);
        return res.status(200).send('OK');
      }

      let st = userStates[userId];

      if (st && st.step === 'WAITING_CUST_NAME') {
        st.tempName = text;
        st.step = 'WAITING_CUST_PHONE';
        await sendTelegramMsg(chatId, `📞 لطفاً شماره تماس با کد کشور را برای مشتری *${text}* وارد کنید (مثل \`+93790000000\`):`);
        return res.status(200).send('OK');
      }

      if (st && st.step === 'WAITING_CUST_PHONE') {
        const cleanPhone = toEnglishDigits(text);
        const newAccId = "ACC-" + Math.floor(100000 + Math.random() * 900000);
        await supabase.from('accounts').insert([{
          AccountID: newAccId,
          Name: st.tempName,
          Phone: cleanPhone,
          CreatedBy: String(userId)
        }]);

        userStates[userId] = { accId: newAccId, accName: st.tempName, step: 'CUST_PANEL' };
        await sendTelegramMsg(chatId, `✅ حساب مشتری افتتاح شد:\n👤 ${st.tempName}\n📞 ${cleanPhone}`, [
          [{ text: '👤 پنل مدیریت مشتری', callback_data: `SELECT_CUST:${newAccId}` }]
        ]);
        return res.status(200).send('OK');
      }

      if (st && st.step === 'SEARCH_CUSTOMER') {
        const { data: accounts } = await supabase.from('accounts').select('*');
        let matched = accounts ? accounts.filter(a => (a.Name || a.name || '').toLowerCase().includes(text.toLowerCase())) : [];

        if (matched.length === 0) {
          await sendTelegramMsg(chatId, `⚠️ مشتری با این نام یافت نشد.`);
          return res.status(200).send('OK');
        }
        let btns = matched.map(a => [{ text: `👤 ${a.Name || a.name}`, callback_data: `SELECT_CUST:${a.AccountID || a.accountid}` }]);
        await sendTelegramMsg(chatId, `🔍 *نتایج جستجو:*`, btns);
        return res.status(200).send('OK');
      }
    }
  } catch (err) {
    console.error('Critical Error:', err);
  }

  return res.status(200).send('OK');
};
// ---------------- ادامه مدیریت دکمه‌های شیشه‌ای (Callback Queries) ----------------

      // منوی صرافی‌ها و کارگزاران
      else if (data === 'NAV_BROKERS') {
        const { data: brokers } = await supabase.from('brokers').select('*');
        if (!brokers || brokers.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'هیچ صرافی‌ای در سیستم ثبت نشده است.', show_alert: true });
          return res.status(200).send('OK');
        }

        let btns = brokers.map(b => [{ text: `🏛️ ${b.name} (${b.city || 'بدون شهر'})`, callback_data: `SELECT_BROKER:${b.broker_id}` }]);
        btns.push([{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '🏛️ *لیست صرافی‌ها و دفاتر همکار:*', btns);
      }

      else if (data.startsWith('SELECT_BROKER:')) {
        const brokerId = data.split(':')[1];
        const { data: broker } = await supabase.from('brokers').select('*').eq('broker_id', brokerId).single();
        if (!broker) return res.status(200).send('OK');

        userStates[userId] = { 
          brokerId, 
          brokerName: broker.name, 
          brokerAddresses: broker.addresses,
          step: 'BROKER_PANEL' 
        };
        await bot.answerCallbackQuery(query.id);

        await editTelegramMsg(
          chatId,
          msgId,
          `🏛️ *پنل صرافی:* *${broker.name}*\nشهر: \`${broker.city || '-'}\` | تلفن: \`${broker.phone || '-'}\``,
          [
            [{ text: '📊 دیدن مانده صرافی (عمودی)', callback_data: 'BROKER_VIEW_BAL' }, { text: '📜 دیدن معاملات صرافی', callback_data: 'BROKER_VIEW_TXS' }],
            [{ text: '➕ ثبت معامله پله‌به‌پله صرافی', callback_data: 'START_BROKER_WIZARD' }],
            [{ text: '🔙 لیست صرافی‌ها', callback_data: 'NAV_BROKERS' }, { text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
          ]
        );
      }

      // گزارش عمودی مانده صرافی
      else if (data === 'BROKER_VIEW_BAL') {
        const st = userStates[userId];
        if (!st || !st.brokerId) return res.status(200).send('OK');

        const { data: bTxs } = await supabase.from('broker_transactions').select('*').eq('broker_id', st.brokerId);
        let currs = {};
        if (bTxs) {
          bTxs.forEach(t => {
            let c = (t.currency || 'USD').toUpperCase();
            let d = t.direction || '';
            let a = parseFloat(t.amount_final || t.amount_initial) || 0;
            if (!currs[c]) currs[c] = { credit: 0, debit: 0 };
            if (d === 'بستانکار') currs[c].credit += a;
            if (d === 'بدهکار') currs[c].debit += a;
          });
        }

        let rep = `📊 *گزارش عمودی مانده صرافی:* *${st.brokerName}*\n────────────────────────\n`;
        let count = 0;
        for (let c in currs) {
          count++;
          let net = currs[c].credit - currs[c].debit;
          rep += `🔹 *ارز ${c}:*\n  • کل بستانکار: \`${formatMoney(currs[c].credit)}\`\n  • کل بدهکار: \`${formatMoney(currs[c].debit)}\`\n  📌 *مانده نهایی:* *${formatMoney(Math.abs(net))} ${c} (${net >= 0 ? 'بستانکار' : 'بدهکار'})*\n\n`;
        }
        if (count === 0) rep += '_هیچ معامله‌ای ثبت نشده است._';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, rep, [
          [{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]
        ]);
      }

      // ---------------- ماشین حالت ثبت معامله پله‌به‌پله صرافی ----------------
      else if (data === 'START_BROKER_WIZARD') {
        const st = userStates[userId];
        const { data: opTypes } = await supabase.from('operation_types').select('*');
        let ops = opTypes && opTypes.length > 0 ? opTypes.map(o => o.title) : ["حواله", "معامله", "دریافت", "پرداخت", "تسویه"];
        
        st.wizard = { step: 'WZ_OP' };
        let btns = ops.map(op => [{ text: op, callback_data: `WZ_OP:${op}` }]);
        btns.push([{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${st.brokerId}` }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, '📌 **گام ۱:** نوع عملیات معامله را انتخاب کنید:', btns);
      }

      else if (data.startsWith('WZ_OP:')) {
        const op = data.split(':')[1];
        userStates[userId].wizard.opType = op;
        userStates[userId].wizard.step = 'WZ_DIR';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۲:** جهت معامله را انتخاب کنید:\n(نوع عملیات: *${op}*)`, [
          [{ text: '🟢 بستانکار (ورودی / گرفتن)', callback_data: 'WZ_DIR:بستانکار' }],
          [{ text: '🔴 بدهکار (خروجی / دادن)', callback_data: 'WZ_DIR:بدهکار' }],
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      }

      else if (data.startsWith('WZ_DIR:')) {
        const dir = data.split(':')[1];
        userStates[userId].wizard.direction = dir;
        userStates[userId].wizard.step = 'WZ_CURR';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۳:** ارز معامله را انتخاب کنید:`, [
          [{ text: 'USD (دلار)', callback_data: 'WZ_CURR:USD' }, { text: 'AFN (افغانی)', callback_data: 'WZ_CURR:AFN' }],
          [{ text: 'تومان', callback_data: 'WZ_CURR:تومان' }, { text: 'IQD (دینار)', callback_data: 'WZ_CURR:IQD' }],
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      }

      else if (data.startsWith('WZ_CURR:')) {
        const curr = data.split(':')[1];
        userStates[userId].wizard.currency = curr;
        userStates[userId].wizard.step = 'WAITING_AMT_INIT';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۴:** لطفاً **مبلغ اولیه معامله** را به عدد بفرستید:\n\n*(ارز: ${curr} | جهت: ${userStates[userId].wizard.direction})*`, [
          [{ text: '❌ انصراف', callback_data: `SELECT_BROKER:${userStates[userId].brokerId}` }]
        ]);
      }

      else if (data.startsWith('WZ_CALC:')) {
        const mode = data.split(':')[1];
        userStates[userId].wizard.calcMode = mode;
        userStates[userId].wizard.step = 'WAITING_RATE';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `🔢 لطفاً **نرخ تبدیل / صرف** را وارد کنید:\n(حالت محاسبه: *${mode === 'multiply' ? 'ضرب (×)' : 'تقسیم (÷)'}*)`, [
          [{ text: '⏭️ بدون نرخ (مبلغ نهایی = مبلغ اولیه)', callback_data: 'WZ_SKIP_RATE' }]
        ]);
      }

      else if (data === 'WZ_SKIP_RATE') {
        const wz = userStates[userId].wizard;
        wz.amountFinal = wz.amountInit;
        wz.exchangeRate = null;
        wz.step = 'SELECT_ADDR';

        // فراخوانی لیست آدرس‌های صرافی
        let addrs = [];
        try {
          let rawAddrs = userStates[userId].brokerAddresses;
          addrs = typeof rawAddrs === 'string' ? JSON.parse(rawAddrs) : (rawAddrs || []);
        } catch(e) { addrs = []; }

        let btns = addrs.map(a => [{ text: `📍 ${a}`, callback_data: `WZ_ADDR:${a}` }]);
        btns.push([{ text: '✍️ تایپ آدرس جدید', callback_data: 'WZ_TYPE_ADDR' }]);
        btns.push([{ text: '⏭️ بدون آدرس', callback_data: 'WZ_ADDR:-' }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📌 **گام ۵:** آدرس مقصد را انتخاب یا تایپ کنید:\n\n💰 مبلغ نهایی: *${formatMoney(wz.amountFinal)} ${wz.currency}*`, btns);
      }

      else if (data.startsWith('WZ_ADDR:')) {
        const addr = data.split(':')[1];
        userStates[userId].wizard.address = addr;
        userStates[userId].wizard.step = 'WAITING_DESC';

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📝 لطفاً **شرح یا توضیحات معامله** را بفرستید:\n(آدرس انتخاب شده: *${addr}*)`, [
          [{ text: '⏭️ بدون توضیحات (ثبت نهایی)', callback_data: 'WZ_FINALIZE' }]
        ]);
      }

      else if (data === 'WZ_TYPE_ADDR') {
        userStates[userId].wizard.step = 'WAITING_CUSTOM_ADDR';
        await bot.answerCallbackQuery(query.id);
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

        await bot.answerCallbackQuery(query.id, { text: 'معامله با موفقیت ثبت شد!' });
        await editTelegramMsg(
          chatId,
          msgId,
          `✅ *معامله صرافی با موفقیت ثبت گردید.*\n\n` +
          `🏛️ صرافی: *${st.brokerName}*\n` +
          `🆔 کد معامله: \`${brokerTxId}\`\n` +
          `💰 مبلغ نهایی: *${formatMoney(wz.amountFinal)} ${wz.currency}* (${wz.direction})\n` +
          `📊 مبلغ اولیه: ${formatMoney(wz.amountInit)} ${wz.exchangeRate ? `(نرخ: ${wz.exchangeRate})` : ''}\n` +
          `📍 آدرس: _${wz.address || '-'}\n` +
          `📝 شرح: _${wz.description || '-'}_`,
          [[{ text: '🏛️ بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]
        );

        delete userStates[userId].wizard;
      }

      return res.status(200).send('OK');
    }

    // ---------------- ادامه پردازش پیام‌های متنی در بخش Wizard ----------------

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const text = update.message.text.trim();
      let st = userStates[userId];

      // گام ۴: دریافت مبلغ اولیه
      if (st && st.wizard && st.wizard.step === 'WAITING_AMT_INIT') {
        const amt = parseFloat(toEnglishDigits(text));
        if (isNaN(amt) || amt <= 0) {
          await sendTelegramMsg(chatId, '⚠️ لطفاً مبلغ را به‌صورت عددی و معتبر وارد کنید:');
          return res.status(200).send('OK');
        }
        st.wizard.amountInit = amt;
        st.wizard.step = 'CHOOSE_CALC_MODE';

        await sendTelegramMsg(chatId, `💰 مبلغ اولیه: *${formatMoney(amt)} ${st.wizard.currency}*\n\nآیا این معامله دارای نرخ تبدیل / صرف است؟`, [
          [{ text: '✖️ ضرب در نرخ (*)', callback_data: 'WZ_CALC:multiply' }, { text: '➗ تقسیم بر نرخ (/)', callback_data: 'WZ_CALC:divide' }],
          [{ text: '⏭️ بدون نرخ (مبلغ نهایی = اولیه)', callback_data: 'WZ_SKIP_RATE' }]
        ]);
        return res.status(200).send('OK');
      }

      // دریافت نرخ تبدیل
      if (st && st.wizard && st.wizard.step === 'WAITING_RATE') {
        const rate = parseFloat(toEnglishDigits(text));
        if (isNaN(rate) || rate <= 0) {
          await sendTelegramMsg(chatId, '⚠️ لطفاً نرخ عددی معتبر وارد کنید:');
          return res.status(200).send('OK');
        }
        st.wizard.exchangeRate = rate;
        st.wizard.amountFinal = st.wizard.calcMode === 'multiply' ? (st.wizard.amountInit * rate) : (st.wizard.amountInit / rate);
        st.wizard.step = 'SELECT_ADDR';

        let addrs = [];
        try {
          let rawAddrs = st.brokerAddresses;
          addrs = typeof rawAddrs === 'string' ? JSON.parse(rawAddrs) : (rawAddrs || []);
        } catch(e) { addrs = []; }

        let btns = addrs.map(a => [{ text: `📍 ${a}`, callback_data: `WZ_ADDR:${a}` }]);
        btns.push([{ text: '✍️ تایپ آدرس جدید', callback_data: 'WZ_TYPE_ADDR' }]);
        btns.push([{ text: '⏭️ بدون آدرس', callback_data: 'WZ_ADDR:-' }]);

        await sendTelegramMsg(chatId, `✅ نرخ اعمال شد.\n💵 مبلغ نهایی: *${formatMoney(st.wizard.amountFinal)} ${st.wizard.currency}*\n\n📌 آدرس مقصد را انتخاب یا تایپ کنید:`, btns);
        return res.status(200).send('OK');
      }

      // دریافت آدرس دستی تایپ‌شده
      if (st && st.wizard && st.wizard.step === 'WAITING_CUSTOM_ADDR') {
        st.wizard.address = text;
        st.wizard.step = 'WAITING_DESC';
        await sendTelegramMsg(chatId, `📍 آدرس: *${text}*\n\n📝 لطفاً شرح / توضیحات معامله را تایپ کنید:`, [
          [{ text: '⏭️ بدون توضیحات (ثبت نهایی)', callback_data: 'WZ_FINALIZE' }]
        ]);
        return res.status(200).send('OK');
      }

      // دریافت توضیحات و ثبت نهایی معامله
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

        await sendTelegramMsg(
          chatId,
          `✅ *معامله صرافی با موفقیت ثبت گردید.*\n\n` +
          `🏛️ صرافی: *${st.brokerName}*\n` +
          `🆔 کد معامله: \`${brokerTxId}\`\n` +
          `💰 مبلغ نهایی: *${formatMoney(wz.amountFinal)} ${wz.currency}* (${wz.direction})\n` +
          `📊 مبلغ اولیه: ${formatMoney(wz.amountInit)} ${wz.exchangeRate ? `(نرخ: ${wz.exchangeRate})` : ''}\n` +
          `📍 آدرس: _${wz.address || '-'}\n` +
          `📝 شرح: _${text}_`,
          [[{ text: '🏛️ بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]]
        );

        delete userStates[userId].wizard;
        return res.status(200).send('OK');
      }
    }
// ---------------- بخش مدیریت ادمین‌ها و گزارشات پیشرفته ----------------

      // ویرایش یا حذف تراکنش‌های صرافی از طریق دکمه‌های شیشه‌ای
      else if (data.startsWith('VIEW_BROKER_TX:')) {
        const bTxId = data.split(':')[1];
        const { data: tx } = await supabase.from('broker_transactions').select('*').eq('broker_tx_id', bTxId).single();
        if (!tx) return res.status(200).send('OK');

        let detailText = `🔍 *جزئیات معامله صرافی:* \`${toEnglishDigits(bTxId)}\`\n\n` +
          `💰 مبلغ نهایی: *${formatMoney(tx.amount_final || tx.amount_initial)} ${tx.currency}*\n` +
          `🔄 جهت: *${tx.direction}*\n` +
          `📋 نوع عملیات: *${tx.operation_type}*\n` +
          `📅 تاریخ: \`${toEnglishDigits(tx.date)}\`\n` +
          `📍 آدرس مقصد: _${tx.address_dashboard || '-'}_ \n` +
          `📝 شرح: _${tx.description || '-'}_`;

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, detailText, [
          [{ text: '🗑️ حذف این معامله', callback_data: `DELETE_BROKER_TX:${bTxId}` }],
          [{ text: '🔙 بازگشت به لیست معاملات', callback_data: 'NAV_BROKERS' }]
        ]);
      }

      else if (data.startsWith('DELETE_BROKER_TX:')) {
        const bTxId = data.split(':')[1];
        await supabase.from('broker_transactions').delete().eq('broker_tx_id', bTxId);
        
        await bot.answerCallbackQuery(query.id, { text: 'مورد با موفقیت حذف شد.' });
        await editTelegramMsg(chatId, msgId, '✅ *معامله صرافی با موفقیت از سیستم حذف گردید.*', [
          [{ text: '🏠 منوی اصلی', callback_data: 'NAV_MAIN' }]
        ]);
      }

      // مشاهده لیست تراکنش‌های صرافی در پنل
      else if (data === 'BROKER_VIEW_TXS') {
        const st = userStates[userId];
        if (!st || !st.brokerId) return res.status(200).send('OK');

        const { data: bTxs } = await supabase.from('broker_transactions').select('*').eq('broker_id', st.brokerId);
        if (!bTxs || bTxs.length === 0) {
          await bot.answerCallbackQuery(query.id, { text: 'تراکنشی یافت نشد.', show_alert: true });
          return res.status(200).send('OK');
        }

        let txBtns = bTxs.slice(-10).reverse().map(t => {
          let symbol = t.direction === 'بستانکار' ? '🟢' : '🔴';
          return [{
            text: `${symbol} ${formatMoney(t.amount_final || t.amount_initial)} ${t.currency} - ${t.operation_type}`,
            callback_data: `VIEW_BROKER_TX:${t.broker_tx_id}`
          }];
        });
        txBtns.push([{ text: '🔙 بازگشت به پنل صرافی', callback_data: `SELECT_BROKER:${st.brokerId}` }]);

        await bot.answerCallbackQuery(query.id);
        await editTelegramMsg(chatId, msgId, `📜 *لیست ۱۰ معامله اخیر صرافی:*`, txBtns);
      }
