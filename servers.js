const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// Використовуємо ваш рядок підключення напряму
const connectionString = 'postgresql://neondb_owner:npg_gFvZxTR7qdw1@ep-round-sound-agieqqp0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

if (!connectionString) {
    console.error('Помилка: Рядок підключення до бази даних відсутній!');
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
const ADMIN_SECRET = 'Aurum';
const BOT_API_URL = 'http://91.239.235.200:8000/api/v1/balance/change';
const MINI_APP_SECRET_KEY = "a4B!z$9pLw@cK#vG*sF7qE&rT2uY";

// --- Хелпер для безпечних запитів до API бота ---
async function changeBalanceInBot(telegramId, delta, reason) {
    const idempotencyKey = uuidv4();
    const body = JSON.stringify({
        user_id: parseInt(telegramId, 10),
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
                throw new Error(result.detail || `Помилка API бота: ${response.status}`);
            }
            return result;
        } catch (error) {
            console.error(`Спроба ${attempt} провалилася:`, error.message);
            if (attempt === 3) throw new Error("Не вдалося зв'язатися з сервером бота.");
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

app.post('/api/user/get-or-create', async (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id є обов'язковим" });
    }
    try {
        const query = "SELECT user_id, username, balance_uah FROM users WHERE user_id = $1";
        let userResult = await pool.query(query, [telegram_id]);
        
        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            res.json({
                id: user.user_id,
                telegram_id: user.user_id,
                username: user.username,
                balance: parseFloat(user.balance_uah)
            });
        } else {
            const insertQuery = "INSERT INTO users (user_id, username) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING";
            await pool.query(insertQuery, [telegram_id, username]);
            
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

app.get('/api/user/inventory', async (req, res) => {
    const { user_id } = req.query;
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

app.post('/api/user/inventory/sell', async (req, res) => {
    const { user_id, unique_id } = req.body;
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

app.post('/api/user/inventory/sell-multiple', async (req, res) => {
    const { user_id, unique_ids } = req.body;
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

app.post('/api/case/open', async (req, res) => {
    const { user_id, quantity } = req.body;
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
        const sql = `SELECT i.id, i.name, i."imageSrc", i.value FROM items i LEFT JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1 OR (SELECT COUNT(*) FROM case_items) = 0`;
        const { rows } = await pool.query(sql);
        res.json(rows.length > 0 ? rows : (await pool.query('SELECT id, name, "imageSrc", value FROM items ORDER BY value DESC')).rows);
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

app.get('/api/contest/current', async (req, res) => {
    const now = Date.now();
    const { telegram_id } = req.query;
    const sql = `
        SELECT c.id, c.end_time, c.ticket_price, c.winner_id, i.name AS "itemName", i."imageSrc" AS "itemImageSrc"
        FROM contests c JOIN items i ON c.item_id = i.id
        WHERE c.is_active = TRUE AND c.end_time > $1 ORDER BY c.id DESC LIMIT 1
    `;
    try {
        const contestResult = await pool.query(sql, [now]);
        if (contestResult.rows.length === 0) return res.json(null);
        
        const contest = contestResult.rows[0];
        const ticketCountResult = await pool.query("SELECT COUNT(*) AS count, COUNT(DISTINCT user_id) as participants FROM user_tickets WHERE contest_id = $1", [contest.id]);
        
        let userTickets = 0;
        if (telegram_id) {
            const userTicketsResult = await pool.query("SELECT COUNT(*) FROM user_tickets WHERE contest_id = $1 AND user_id = $2", [contest.id, telegram_id]);
            userTickets = Number(userTicketsResult.rows[0].count);
        }
        res.json({ ...contest, ...ticketCountResult.rows[0], userTickets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ### ВИПРАВЛЕНИЙ МАРШРУТ ПОКУПКИ КВИТКА ###
app.post('/api/contest/buy-ticket', async (req, res) => {
    // user_id з фронтенду - це telegram_id
    const { user_id, quantity } = req.body; 
    if (!user_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Неверные данные для покупки билета' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const contestResult = await client.query("SELECT * FROM contests WHERE is_active = TRUE ORDER BY id DESC LIMIT 1");
        if (contestResult.rows.length === 0 || contestResult.rows[0].end_time <= Date.now()) {
            throw new Error('Конкурс неактивен или завершен');
        }
        const contest = contestResult.rows[0];
        const totalCost = contest.ticket_price * quantity;
        
        // Викликаємо API бота з правильним telegram_id
        const botResponse = await changeBalanceInBot(user_id, -totalCost, `buy_ticket_x${quantity}_contest_${contest.id}`);

        for (let i = 0; i < quantity; i++) {
            // Вставляємо в таблицю user_id (telegram_id) та telegram_id
            await client.query("INSERT INTO user_tickets (contest_id, user_id, telegram_id) VALUES ($1, $2, $3)", [contest.id, user_id, user_id]);
        }
        await client.query('COMMIT');
        res.json({ success: true, newBalance: botResponse.new_balance });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Помилка при покупці квитка:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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

app.post('/api/admin/contest/create', async (req, res) => {
    const { item_id, ticket_price, duration_hours } = req.body;
    if (!item_id || !ticket_price || !duration_hours) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }
    const endTime = Date.now() + duration_hours * 60 * 60 * 1000;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("UPDATE contests SET is_active = FALSE WHERE is_active = TRUE");
        const result = await client.query(
            "INSERT INTO contests (item_id, ticket_price, end_time) VALUES ($1, $2, $3) RETURNING id",
            [item_id, ticket_price, endTime]
        );
        await client.query('COMMIT');
        res.status(201).json({ success: true, contestId: result.rows[0].id });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/admin/contest/draw/:id', async (req, res) => {
    const contestId = req.params.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const contestResult = await client.query("SELECT * FROM contests WHERE id = $1 AND is_active = TRUE", [contestId]);
        if (contestResult.rows.length === 0) {
            throw new Error('Активный конкурс не найден');
        }
        const contest = contestResult.rows[0];
        const participantsResult = await client.query("SELECT DISTINCT user_id FROM user_tickets WHERE contest_id = $1", [contestId]);
        if (participantsResult.rows.length === 0) {
            await client.query("UPDATE contests SET is_active = FALSE WHERE id = $1", [contestId]);
            await client.query('COMMIT');
            return res.json({ message: 'В конкурсе не было участников, конкурс завершен.' });
        }
        const participants = participantsResult.rows;
        const winner = participants[Math.floor(Math.random() * participants.length)];
        await client.query("INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2)", [winner.user_id, contest.item_id]);
        await client.query("UPDATE contests SET is_active = FALSE, winner_id = $1 WHERE id = $2", [winner.user_id, contestId]);
        const winnerTelegramIdResult = await client.query("SELECT user_id FROM users WHERE user_id = $1", [winner.user_id]);
        const winnerTelegramId = winnerTelegramIdResult.rows[0].user_id;
        await client.query('COMMIT');
        res.json({ success: true, winner_telegram_id: winnerTelegramId, message: "Приз зачислен в инвентарь победителя." });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});
