const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// ВАЖЛИВО: Переконайтеся, що ця змінна середовища встановлена на Render.
// Я повернув ваш оригінальний рядок підключення для надійності.
const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_xoO8NXpDn1fy@ep-hidden-sound-a23oyr8a-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

if (!connectionString) {
    console.error('Помилка: Змінна середовища DATABASE_URL не встановлена!');
    process.exit(1);
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

app.use(cors());
app.use(express.json());

// --- КОНФІГУРАЦІЯ ---
const ADMIN_SECRET = 'Aurum'; // Ваш секретний ключ для адмін-панелі
// URL вашого Python-сервера (бота)
const BOT_API_URL = 'http://91.239.235.200:8000/api/v1/balance/change';
// Секретний ключ для підпису запитів до API бота (має бути таким самим, як у webhook_handler.py)
const MINI_APP_SECRET_KEY = "a4B!z$9pLw@cK#vG*sF7qE&rT2uY";

// --- Хелпер для безпечних запитів до API бота ---
async function changeBalanceInBot(telegramId, delta, reason) {
    const idempotencyKey = uuidv4();
    const body = JSON.stringify({
        user_id: parseInt(telegramId, 10), // Переконуємось, що telegram_id - це число
        delta: parseFloat(delta),
        reason: reason
    });

    const signature = crypto
        .createHmac('sha256', MINI_APP_SECRET_KEY)
        .update(body)
        .digest('hex');

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(BOT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': idempotencyKey,
                    'X-Signature': signature
                },
                body: body,
                timeout: 7000
            });

            const result = await response.json();

            if (!response.ok) {
                if (response.status >= 400 && response.status < 500) {
                    throw new Error(result.detail || `Помилка API бота: ${response.status}`);
                }
                console.warn(`Спроба ${attempt} не вдалася. Статус: ${response.status}. Відповідь:`, result);
                if (attempt === 3) throw new Error(`Помилка API бота після 3 спроб: ${result.detail || response.status}`);
                await new Promise(res => setTimeout(res, 1000 * attempt));
                continue;
            }
            return result;
        } catch (error) {
            console.error(`Спроба ${attempt} провалилася з мережевою помилкою:`, error);
            if (attempt === 3) throw new Error("Не вдалося зв'язатися з сервером бота після кількох спроб.");
            // Немає `await` перед рекурсивним викликом, це помилка. Потрібно просто чекати.
             await new Promise(res => setTimeout(res, 1000 * attempt));
        }
    }
}

// --- Статичні файли та захист адмінки ---
app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

const checkAdminSecret = (req, res, next) => {
    const secret = req.query.secret || req.body.secret;
    if (secret === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).send('Доступ заборонено');
    }
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', checkAdminSecret, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// --- API Маршрути ---

// Аутентифікація/реєстрація користувача
app.post('/api/user/get-or-create', async (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id є обов'язковим" });
    }
    try {
        // Працюємо зі схемою бота: user_id це telegram_id, balance це balance_uah
        const query = "SELECT user_id, username, balance_uah FROM users WHERE user_id = $1";
        let userResult = await pool.query(query, [telegram_id]);
        
        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            res.json({
                id: user.user_id, // Для сумісності з фронтендом, id = user_id
                telegram_id: user.user_id,
                username: user.username,
                balance: parseFloat(user.balance_uah)
            });
        } else {
            // Якщо користувача немає, створюємо його, як це робить бот
            const insertQuery = "INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING RETURNING user_id, username, balance_uah";
            await pool.query(insertQuery, [telegram_id, username]);
            
            // Повторно запитуємо дані, щоб отримати баланс за замовчуванням
            let finalUserResult = await pool.query(query, [telegram_id]);
            const user = finalUserResult.rows[0];
            res.status(201).json({
                id: user.user_id,
                telegram_id: user.user_id,
                username: user.username,
                balance: parseFloat(user.balance_uah)
            });
        }
    } catch (err) {
        console.error("Помилка в get-or-create:", err);
        res.status(500).json({ error: err.message });
    }
});


// Отримання інвентарю
app.get('/api/user/inventory', async (req, res) => {
    const { user_id } = req.query; // Тут user_id це telegram_id
    if (!user_id) {
        return res.status(400).json({ error: 'user_id є обов\'язковим' });
    }
    const sql = `
        SELECT ui.id AS "uniqueId", i.id, i.name, i."imageSrc", i.value
        FROM user_inventory ui
        JOIN items i ON ui.item_id = i.id
        WHERE ui.user_id = $1
    `;
    try {
        const { rows } = await pool.query(sql, [user_id]);
        res.json(rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Продаж одного предмета
app.post('/api/user/inventory/sell', async (req, res) => {
    const { user_id, unique_id } = req.body; // user_id це telegram_id
    if (!user_id || !unique_id) {
        return res.status(400).json({ error: 'Невірні дані для продажу' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const itemResult = await client.query(
            'SELECT i.value FROM user_inventory ui JOIN items i ON ui.item_id = i.id WHERE ui.id = $1 AND ui.user_id = $2',
            [unique_id, user_id]
        );
        if (itemResult.rows.length === 0) throw new Error('Предмет не знайдено в інвентарі');

        const { value: itemValue } = itemResult.rows[0];
        const botResponse = await changeBalanceInBot(user_id, itemValue, `sell_item_${unique_id}`);

        await client.query("DELETE FROM user_inventory WHERE id = $1", [unique_id]);
        await client.query('COMMIT');

        res.json({ success: true, newBalance: botResponse.new_balance });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Помилка при продажу предмета:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Новий маршрут для продажу кількох предметів
app.post('/api/user/inventory/sell-multiple', async (req, res) => {
    const { user_id, unique_ids } = req.body; // user_id це telegram_id
    if (!user_id || !Array.isArray(unique_ids) || unique_ids.length === 0) {
        return res.status(400).json({ error: 'Невірні дані для продажу' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const itemsResult = await client.query(
            'SELECT i.value FROM user_inventory ui JOIN items i ON ui.item_id = i.id WHERE ui.id = ANY($1::int[]) AND ui.user_id = $2',
            [unique_ids, user_id]
        );

        if (itemsResult.rows.length !== unique_ids.length) {
            throw new Error('Один або кілька предметів не знайдено в інвентарі');
        }

        const totalValue = itemsResult.rows.reduce((sum, item) => sum + item.value, 0);
        const botResponse = await changeBalanceInBot(user_id, totalValue, `sell_multiple_${unique_ids.length}_items`);

        await client.query("DELETE FROM user_inventory WHERE id = ANY($1::int[])", [unique_ids]);
        await client.query('COMMIT');

        res.json({ success: true, newBalance: botResponse.new_balance });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Помилка при пакетному продажу предметів:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// Відкриття кейсу
app.post('/api/case/open', async (req, res) => {
    const { user_id, quantity } = req.body; // user_id тут це telegram_id
    const casePrice = 100;
    const totalCost = casePrice * (quantity || 1);

    if (!user_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Неверные данные для открытия кейса' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const botResponse = await changeBalanceInBot(user_id, -totalCost, `open_case_x${quantity}`);

        const caseItemsResult = await client.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        const caseItems = caseItemsResult.rows.length > 0 ? caseItemsResult.rows : (await client.query('SELECT id, name, "imageSrc", value FROM items')).rows;
        if (caseItems.length === 0) throw new Error('В игре нет предметов');

        const wonItemsData = Array.from({ length: quantity }, () => caseItems[Math.floor(Math.random() * caseItems.length)]);
        
        const wonItemsWithUniqueIds = [];
        for (const item of wonItemsData) {
            const result = await client.query(
                "INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2) RETURNING id",
                [user_id, item.id]
            );
            wonItemsWithUniqueIds.push({ ...item, uniqueId: result.rows[0].id });
        }
        
        await client.query('COMMIT');
        res.json({ success: true, newBalance: botResponse.new_balance, wonItems: wonItemsWithUniqueIds });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Ошибка открытия кейса:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/case/items_full', async (req, res) => {
    try {
        const sql = `
            SELECT i.id, i.name, i."imageSrc", i.value
            FROM items i
            LEFT JOIN case_items ci ON i.id = ci.item_id
            WHERE ci.case_id = 1 OR (SELECT COUNT(*) FROM case_items) = 0
        `;
        const { rows } = await pool.query(sql);

        if (rows.length > 0) {
            res.json(rows);
        } else {
            const allItemsResult = await pool.query('SELECT id, name, "imageSrc", value FROM items ORDER BY value DESC');
            res.json(allItemsResult.rows);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/game_settings', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT key, value FROM game_settings");
        const settings = rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Адмінські маршрути ---
app.use('/api/admin', checkAdminSecret);

app.get('/api/admin/users', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT user_id AS telegram_id, username, balance_uah AS balance FROM users ORDER BY user_id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/user/balance', async (req, res) => {
    const { telegramId, newBalance } = req.body;
    if (telegramId === undefined || newBalance === undefined || isNaN(newBalance)) {
        return res.status(400).json({ "error": "Необхідно вказати telegramId та newBalance" });
    }

    try {
        const userResult = await pool.query("SELECT balance_uah FROM users WHERE user_id = $1", [telegramId]);
        if (userResult.rows.length === 0) {
            throw new Error('Користувач не знайдений');
        }
        const currentBalance = parseFloat(userResult.rows[0].balance_uah);
        const delta = parseFloat(newBalance) - currentBalance;

        const reason = `admin_update_by_${req.ip}`;
        const botResponse = await changeBalanceInBot(telegramId, delta, reason);

        res.json({ success: true, newBalance: botResponse.new_balance });
    } catch (err) {
        console.error("Помилка в /api/admin/user/balance:", err);
        res.status(500).json({ "error": err.message });
    }
});

app.get('/api/admin/items', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, name, "imageSrc", value FROM items ORDER BY value DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/case/items', async (req, res) => {
    const caseId = 1;
    try {
        const { rows } = await pool.query("SELECT item_id FROM case_items WHERE case_id = $1", [caseId]);
        res.json(rows.map(r => r.item_id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/case/items', async (req, res) => {
    const { itemIds } = req.body;
    const caseId = 1;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("DELETE FROM case_items WHERE case_id = $1", [caseId]);
        if (itemIds && itemIds.length > 0) {
            for (const itemId of itemIds) {
                await client.query("INSERT INTO case_items (case_id, item_id) VALUES ($1, $2)", [caseId, itemId]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ "error": err.message });
    } finally {
        client.release();
    }
});

app.post('/api/admin/game_settings', async (req, res) => {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ error: 'Неправильный формат настроек' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const [key, value] of Object.entries(settings)) {
            await client.query("UPDATE game_settings SET value = $1 WHERE key = $2", [value.toString(), key]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ "error": err.message });
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});
