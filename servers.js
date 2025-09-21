const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const redis = require('redis');

const app = express();
const port = process.env.PORT || 3000;

// --- Подключения к БД и Redis ---
const pgPool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_gFvZxTR7qdw1@ep-round-sound-agieqqp0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require'
});

const redisClient = redis.createClient({
    url: 'redis://default:E9fz2YXROF1SIldpK4oCkQp9Q1w2wO59@redis-14272.c293.eu-central-1-1.ec2.redns.redis-cloud.com:14272'
});

redisClient.on('error', err => console.error('Redis Client Error', err));

// --- Глобальные переменные и middleware ---
const ADMIN_SECRET = 'Aurum';
const MINI_APP_SECRET_KEY = "a4B!z$9pLw@cK#vG*sF7qE&rT2uY";
const CASE_PRICE = 100; // Цена за открытие одного кейса

app.use(cors());

// Middleware для чтения rawBody, необходимого для проверки подписи
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Middleware для проверки подписи HMAC SHA256
const checkSignature = (req, res, next) => {
    try {
        const signature = req.headers['x-signature'];
        const idempotencyKey = req.headers['x-idempotency-key'];
        if (!signature || !idempotencyKey) {
            return res.status(400).json({ detail: "Signature or Idempotency Key missing" });
        }
        const expectedSignature = crypto
            .createHmac('sha256', MINI_APP_SECRET_KEY)
            .update(req.rawBody)
            .digest('hex');

        if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            next();
        } else {
            console.warn("Invalid signature received");
            return res.status(403).json({ detail: "Invalid signature" });
        }
    } catch (error) {
        console.error("Signature verification failed:", error);
        return res.status(403).json({ detail: "Invalid signature" });
    }
};

// --- Отдача статических файлов ---
app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

const checkAdminSecret = (req, res, next) => {
    if (req.query.secret === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).send('Доступ запрещен');
    }
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', checkAdminSecret, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// ### Утилитарная функция для изменения баланса (транзакционная) ###
async function changeBalance(client, userId, delta, reason) {
    const userResult = await client.query("SELECT balance_uah FROM users WHERE user_id = $1 FOR UPDATE", [userId]);
    if (userResult.rows.length === 0) {
        // Если пользователя нет, создаем его с начальным балансом
        const initialBalance = 1000.00;
        await client.query(
            "INSERT INTO users (user_id, username, balance_uah) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING",
            [userId, `user_${userId}`, initialBalance]
        );
        const newUserResult = await client.query("SELECT balance_uah FROM users WHERE user_id = $1 FOR UPDATE", [userId]);
        if (newUserResult.rows.length === 0){
             throw new Error("Не удалось создать или найти пользователя после вставки.");
        }
        const currentBalance = parseFloat(newUserResult.rows[0].balance_uah);
        const newBalance = currentBalance + delta;
        if (newBalance < 0) {
            throw new Error("Недостаточно средств на балансе.");
        }
        await client.query("UPDATE users SET balance_uah = $1 WHERE user_id = $2", [newBalance, userId]);
        return newBalance;

    } else {
        const currentBalance = parseFloat(userResult.rows[0].balance_uah);
        const newBalance = currentBalance + delta;
        if (newBalance < 0) {
            throw new Error("Недостаточно средств на балансе.");
        }
        await client.query("UPDATE users SET balance_uah = $1 WHERE user_id = $2", [newBalance, userId]);
        // Здесь можно добавить логирование транзакций, если нужно
        return newBalance;
    }
}


// --- API Маршруты для Mini App ---

// Получение/создание пользователя
app.post('/api/user/get-or-create', async (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id является обязательным" });
    }
    try {
        let userResult = await pgPool.query("SELECT user_id, username, balance_uah FROM users WHERE user_id = $1", [telegram_id]);
        
        const formatUser = (dbUser) => ({
            id: Number(dbUser.user_id),
            telegram_id: Number(dbUser.user_id),
            username: dbUser.username,
            balance: parseFloat(dbUser.balance_uah)
        });

        if (userResult.rows.length > 0) {
            res.json(formatUser(userResult.rows[0]));
        } else {
            const initialBalance = 1000.00;
            const newUserResult = await pgPool.query(
                "INSERT INTO users (user_id, username, balance_uah) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET username = $2 RETURNING user_id, username, balance_uah",
                [telegram_id, username || `User ${telegram_id}`, initialBalance]
            );
            res.status(201).json(formatUser(newUserResult.rows[0]));
        }
    } catch (err) {
        console.error('Ошибка в /api/user/get-or-create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Получение инвентаря
app.get('/api/user/inventory', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) {
        return res.status(400).json({ error: 'user_id является обязательным' });
    }
    try {
        const { rows } = await pgPool.query(
            'SELECT ui.id AS "uniqueId", i.id, i.name, i."imageSrc", i.value FROM user_inventory ui JOIN items i ON ui.item_id = i.id WHERE ui.user_id = $1',
            [user_id]
        );
        res.json(rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Открытие кейса
app.post('/api/case/open', checkSignature, async (req, res) => {
    const { user_id, quantity } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];
    const processedKey = `idempotency:${idempotencyKey}`;

    if (!user_id || !quantity || quantity <= 0) {
        return res.status(400).json({ detail: 'Неверные данные' });
    }

    if (await redisClient.get(processedKey)) {
         return res.status(200).json({ detail: "Запрос уже обработан" });
    }

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');

        const totalCost = CASE_PRICE * quantity;
        const newBalance = await changeBalance(client, user_id, -totalCost, `Открытие ${quantity} кейса(ов)`);

        const caseItemsResult = await client.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        if (caseItemsResult.rows.length === 0) throw new Error('Кейс пуст');
        const caseItems = caseItemsResult.rows;
        
        const wonItems = [];
        for (let i = 0; i < quantity; i++) {
            const randomItem = caseItems[Math.floor(Math.random() * caseItems.length)];
            const inserted = await client.query(
                'INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2) RETURNING id',
                [user_id, randomItem.id]
            );
            wonItems.push({ ...randomItem, uniqueId: inserted.rows[0].id });
        }

        await client.query('COMMIT');
        await redisClient.set(processedKey, '1', { EX: 86400 });

        res.json({ success: true, newBalance, wonItems });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Ошибка открытия кейса для user ${user_id}:`, err);
        res.status(500).json({ detail: err.message });
    } finally {
        client.release();
    }
});

// Продажа предметов
app.post('/api/inventory/sell', checkSignature, async (req, res) => {
    const { user_id, uniqueIds } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];
    const processedKey = `idempotency:${idempotencyKey}`;

    if (!user_id || !uniqueIds || !Array.isArray(uniqueIds) || uniqueIds.length === 0) {
        return res.status(400).json({ detail: 'Неверные данные' });
    }
     if (await redisClient.get(processedKey)) {
        const profile = await pgPool.query("SELECT balance_uah FROM users WHERE user_id = $1", [user_id]);
        const currentBalance = profile.rows.length > 0 ? parseFloat(profile.rows[0].balance_uah) : 0;
        return res.json({ success: true, message: "Запрос уже обработан", newBalance: currentBalance });
    }

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');

        const itemsToSell = await client.query(
            `SELECT ui.id, i.value FROM user_inventory ui 
             JOIN items i ON ui.item_id = i.id 
             WHERE ui.user_id = $1 AND ui.id = ANY($2::int[])`,
            [user_id, uniqueIds]
        );

        if (itemsToSell.rows.length !== uniqueIds.length) {
            throw new Error('Один или несколько предметов не найдены или не принадлежат вам.');
        }

        const totalValue = itemsToSell.rows.reduce((sum, item) => sum + item.value, 0);

        await client.query(
            "DELETE FROM user_inventory WHERE id = ANY($1::int[]) AND user_id = $2",
            [uniqueIds, user_id]
        );

        const newBalance = await changeBalance(client, user_id, totalValue, `Продажа ${uniqueIds.length} предмета(ов)`);

        await client.query('COMMIT');
        await redisClient.set(processedKey, '1', { EX: 86400 });
        
        res.json({ success: true, newBalance });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Ошибка продажи для user ${user_id}:`, err);
        res.status(500).json({ detail: err.message });
    } finally {
        client.release();
    }
});

// Покупка билетов на конкурс
app.post('/api/contest/buy-ticket', checkSignature, async (req, res) => {
    const { contest_id, telegram_id, quantity } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];
    const processedKey = `idempotency:${idempotencyKey}`;

    if (!contest_id || !telegram_id || !quantity || quantity < 1) {
        return res.status(400).json({ detail: 'Неверные данные' });
    }
    
    if (await redisClient.get(processedKey)) {
        return res.status(200).json({ detail: "Запрос уже обработан" });
    }

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');
        
        const contestResult = await client.query("SELECT ticket_price FROM contests WHERE id = $1 AND is_active = TRUE", [contest_id]);
        if(contestResult.rows.length === 0) throw new Error("Конкурс не найден или неактивен");

        const ticketPrice = contestResult.rows[0].ticket_price;
        const totalCost = ticketPrice * quantity;

        const newBalance = await changeBalance(client, telegram_id, -totalCost, `Покупка ${quantity} билета(ов)`);

        for (let i = 0; i < quantity; i++) {
            await client.query("INSERT INTO user_tickets (contest_id, user_id, telegram_id) VALUES ($1, $2, $3)", [contest_id, telegram_id, telegram_id]);
        }
        await client.query('COMMIT');
        await redisClient.set(processedKey, '1', { EX: 86400 });

        res.json({ success: true, newBalance });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Ошибка покупки билета для user ${telegram_id}:`, err);
        res.status(500).json({ detail: err.message });
    } finally {
        client.release();
    }
});


// Получение содержимого кейса
app.get('/api/case/items_full', async (req, res) => {
    try {
        const { rows } = await pgPool.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        res.json(rows.length > 0 ? rows : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Получение настроек игры
app.get('/api/game_settings', async (req, res) => {
    try {
        const { rows } = await pgPool.query("SELECT key, value FROM game_settings");
        const settings = rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Получение данных о текущем конкурсе
app.get('/api/contest/current', async (req, res) => {
    const now = Date.now();
    try {
        const contestResult = await pgPool.query(
            'SELECT c.id, c.end_time, c.ticket_price, i.name AS "itemName", i."imageSrc" AS "itemImageSrc" FROM contests c JOIN items i ON c.item_id = i.id WHERE c.is_active = TRUE AND c.end_time > $1 ORDER BY c.id DESC LIMIT 1',
            [now]
        );
        if (contestResult.rows.length === 0) return res.json(null);

        const contest = contestResult.rows[0];
        const ticketCountResult = await pgPool.query("SELECT COUNT(*) AS count, COUNT(DISTINCT user_id) as participants FROM user_tickets WHERE contest_id = $1", [contest.id]);
        const { telegram_id } = req.query;
        let userTickets = 0;
        if (telegram_id) {
            const userTicketsResult = await pgPool.query("SELECT COUNT(*) AS count FROM user_tickets WHERE contest_id = $1 AND telegram_id = $2", [contest.id, telegram_id]);
            userTickets = Number(userTicketsResult.rows[0].count);
        }

        res.json({ ...contest, ...ticketCountResult.rows[0], userTickets });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- API Маршруты (админские) ---
app.use('/api/admin', checkAdminSecret);

app.get('/api/admin/users', async (req, res) => {
    try {
        const { rows } = await pgPool.query("SELECT user_id as id, user_id as telegram_id, username, balance_uah as balance FROM users ORDER BY user_id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/user/balance', async (req, res) => {
    const { telegramId, newBalance } = req.body;
    try {
        const result = await pgPool.query(
            "UPDATE users SET balance_uah = $1 WHERE user_id = $2 RETURNING balance_uah",
            [newBalance, telegramId]
        );
        
        if (result.rowCount > 0) {
            res.json({ success: true, newBalance: parseFloat(result.rows[0].balance_uah) });
        } else {
            res.status(404).json({ success: false, error: "Пользователь не найден" });
        }
    } catch (err) {
        res.status(500).json({ "error": err.message });
    }
});

app.get('/api/admin/items', async (req, res) => {
    try {
        const { rows } = await pgPool.query('SELECT id, name, "imageSrc", value FROM items ORDER BY value DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/case/items', async (req, res) => {
    const caseId = 1;
    try {
        const { rows } = await pgPool.query("SELECT item_id FROM case_items WHERE case_id = $1", [caseId]);
        res.json(rows.map(r => r.item_id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/case/items', async (req, res) => {
    const { itemIds } = req.body;
    const caseId = 1;
    const client = await pgPool.connect();
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
    const client = await pgPool.connect();
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
    const client = await pgPool.connect();
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
    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');
        const contestResult = await client.query("SELECT * FROM contests WHERE id = $1 AND is_active = TRUE", [contestId]);
        if (contestResult.rows.length === 0) {
            throw new Error('Активный конкурс не найден');
        }
        const contest = contestResult.rows[0];

        const participantsResult = await client.query("SELECT DISTINCT user_id, telegram_id FROM user_tickets WHERE contest_id = $1", [contestId]);
        if (participantsResult.rows.length === 0) {
            await client.query("UPDATE contests SET is_active = FALSE WHERE id = $1", [contestId]);
            await client.query('COMMIT');
            return res.json({ message: 'В конкурсе не было участников, конкурс завершен.' });
        }
        const participants = participantsResult.rows;
        const winner = participants[Math.floor(Math.random() * participants.length)];

        await client.query("INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2)", [winner.user_id, contest.item_id]);
        await client.query("UPDATE contests SET is_active = FALSE, winner_id = $1 WHERE id = $2", [winner.user_id, contestId]);

        await client.query('COMMIT');
        res.json({ success: true, winner_telegram_id: winner.telegram_id, message: "Приз зачислен в инвентарь победителя." });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- Запуск сервера ---
async function startServer() {
    await redisClient.connect();
    app.listen(port, () => {
        console.log(`Сервер успешно запущен на порту ${port}`);
    });
}

startServer();
