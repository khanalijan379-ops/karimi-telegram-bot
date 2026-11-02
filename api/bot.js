import { createClient } from '@supabase/supabase-js';

// اتصال به دیتابیس با استفاده از متغیرهای امنیتی ورسل
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(200).json({ status: 'Bot is running securely via Vercel Environment Variables!' });
    }

    try {
        const update = req.body;
        if (!update || !update.message) {
            return res.status(200).json({ ok: true });
        }

        const chatId = update.message.chat.id;
        const text = update.message.text || '';
        const userEmail = process.env.MASTER_ADMIN_EMAIL;

        // منطق تفکیک‌سازی و پردازش پیام‌ها برای مالک و ادمین‌ها
        if (chatId.toString() === process.env.MASTER_ADMIN_CHATID.toString()) {
            // پردازش‌های مربوط به مدیر اصلی
            console.log("Master admin message received.");
        } else {
            // پردازش‌های مربوط به ادمین‌های همکار
            console.log(`Collaborator admin message received from chatID: ${chatId}`);
        }

        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error("Error processing webhook:", error);
        return res.status(500).json({ error: error.message });
    }
}
