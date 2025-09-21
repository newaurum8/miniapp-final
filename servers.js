const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Ваша строка подключения к базе данных NeonDB
const connectionString = 'postgresql://neondb_owner:npg_gFvZxTR7qdw1@ep-round-sound-agieqqp0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require';

if (!connectionString) {
    console.error('Ошибка: Переменная окружения DATABASE_URL не установлена!');
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

// --- ОТДАЧА СТАТИЧЕСКИХ ФАЙЛОВ ---
app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// --- ЗАЩИТА АДМИН-ПАНЕЛИ ---
const ADMIN_SECRET = 'Aurum';

const checkAdminSecret = (req, res, next) => {
    const secret = req.query.secret || req.body.secret;
    if (secret === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).send('Доступ запрещен');
    }
};

// --- ОСНОВНЫЕ МАРШРУТЫ ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', checkAdminSecret, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// --- ПРОВЕРКА ПОДКЛЮЧЕНИЯ К БД ---
async function checkDbConnection() {
    const client = await pool.connect();
    try {
        console.log('Успешное подключение к базе данных PostgreSQL');
        await client.query('SELECT 1');
    } catch (err) {
        console.error('Ошибка при подключении или проверке БД:', err);
    } finally {
        client.release();
    }
}


// --- API Маршруты (клиентские) ---

app.post('/api/user/get-or-create', async (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id является обязательным" });
    }
    try {
        // Используем user_id как основной ключ и balance_uah для баланса
        let userResult = await pool.query("SELECT user_id, username, balance_uah FROM users WHERE user_id = $1", [telegram_id]);
        if (userResult.rows.length > 0) {
            // Преобразуем для совместимости с фронтендом, который ожидает 'id' и 'balance'
            const user = { ...userResult.rows[0], id: userResult.rows[0].user_id, balance: parseFloat(userResult.rows[0].balance_uah) };
            res.json(user);
        } else {
            const initialBalance = 1000.00;
            const newUserResult = await pool.query(
                "INSERT INTO users (user_id, username, balance_uah) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING RETURNING user_id, username, balance_uah",
                [telegram_id, username, initialBalance]
            );
             if (newUserResult.rows.length > 0) {
                const user = { ...newUserResult.rows[0], id: newUserResult.rows[0].user_id, balance: parseFloat(newUserResult.rows[0].balance_uah) };
                res.status(201).json(user);
             } else {
                // Если пользователь уже существует, но INSERT..ON CONFLICT ничего не вернул, делаем повторный SELECT.
                let existingUserResult = await pool.query("SELECT user_id, username, balance_uah FROM users WHERE user_id = $1", [telegram_id]);
                const user = { ...existingUserResult.rows[0], id: existingUserResult.rows[0].user_id, balance: parseFloat(existingUserResult.rows[0].balance_uah) };
                res.json(user);
             }
        }
    } catch (err) {
        console.error('Ошибка в /api/user/get-or-create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/v1/balance/change', async (req, res) => {
    const { user_id, delta } = req.body; // user_id это telegram_id

    if (typeof user_id !== 'number' || typeof delta !== 'number') {
        return res.status(400).json({ detail: "Неверные параметры запроса." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query("SELECT balance_uah FROM users WHERE user_id = $1 FOR UPDATE", [user_id]);
        let currentBalance;

        if (userResult.rows.length === 0) {
            await client.query("INSERT INTO users (user_id, balance_uah) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [user_id, 1000.00]);
            const newUserBalanceResult = await client.query("SELECT balance_uah FROM users WHERE user_id = $1 FOR UPDATE", [user_id]);
            currentBalance = parseFloat(newUserBalanceResult.rows[0].balance_uah);
        } else {
            currentBalance = parseFloat(userResult.rows[0].balance_uah);
        }

        const newBalance = currentBalance + delta;

        if (newBalance < 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ detail: "Недостаточно средств на балансе." });
        }

        await client.query("UPDATE users SET balance_uah = $1 WHERE user_id = $2", [newBalance, user_id]);
        await client.query('COMMIT');
        res.json({ status: "ok", message: "Balance updated successfully", new_balance: newBalance });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`Ошибка при изменении баланса для user ${user_id}: ${e}`);
        res.status(500).json({ detail: "Internal server error" });
    } finally {
        client.release();
    }
});

app.get('/api/user/inventory', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) {
        return res.status(400).json({ error: 'user_id является обязательным' });
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
        return res.status(400).json({ error: 'Неверные данные для продажи' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const itemResult = await client.query(
            'SELECT i.value FROM user_inventory ui JOIN items i ON ui.item_id = i.id WHERE ui.id = $1 AND ui.user_id = $2',
            [unique_id, user_id]
        );
        if (itemResult.rows.length === 0) {
            throw new Error('Предмет не найден в инвентаре');
        }
        const itemValue = itemResult.rows[0].value;

        await client.query("DELETE FROM user_inventory WHERE id = $1", [unique_id]);
        await client.query("UPDATE users SET balance_uah = balance_uah + $1 WHERE user_id = $2", [itemValue, user_id]);

        await client.query('COMMIT');

        const userResult = await pool.query("SELECT balance_uah FROM users WHERE user_id = $1", [user_id]);
        res.json({ success: true, newBalance: parseFloat(userResult.rows[0].balance_uah) });

    } catch (err) {
        await client.query('ROLLBACK');
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
            JOIN case_items ci ON i.id = ci.item_id
            WHERE ci.case_id = 1
        `;
        const { rows } = await pool.query(sql);
        res.json(rows.length > 0 ? rows : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
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

        const userResult = await client.query("SELECT user_id, balance_uah FROM users WHERE user_id = $1 FOR UPDATE", [user_id]);
        if (userResult.rows.length === 0) throw new Error('Пользователь не найден');
        const user = userResult.rows[0];

        if (parseFloat(user.balance_uah) < totalCost) throw new Error('Недостаточно средств');

        const caseItemsResult = await client.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        if (caseItemsResult.rows.length === 0) throw new Error('Кейс пуст');
        const caseItems = caseItemsResult.rows;

        const newBalance = parseFloat(user.balance_uah) - totalCost;
        const wonItems = Array.from({ length: quantity }, () => caseItems[Math.floor(Math.random() * caseItems.length)]);

        await client.query("UPDATE users SET balance_uah = $1 WHERE user_id = $2", [newBalance, user.user_id]);

        for (const item of wonItems) {
            await client.query("INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2)", [user.user_id, item.id]);
        }

        await client.query('COMMIT');
        res.json({ success: true, newBalance, wonItems });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
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
    const sql = `
        SELECT c.id, c.end_time, c.ticket_price, c.winner_id, i.name AS "itemName", i."imageSrc" AS "itemImageSrc"
        FROM contests c
        JOIN items i ON c.item_id = i.id
        WHERE c.is_active = TRUE AND c.end_time > $1
        ORDER BY c.id DESC LIMIT 1
    `;
    try {
        const contestResult = await pool.query(sql, [now]);
        if (contestResult.rows.length === 0) return res.json(null);

        const contest = contestResult.rows[0];

        const ticketCountResult = await pool.query("SELECT COUNT(*) AS count, COUNT(DISTINCT user_id) as participants FROM user_tickets WHERE contest_id = $1", [contest.id]);
        const ticketCount = ticketCountResult.rows[0];

        const { telegram_id } = req.query;
        let userTickets = 0;
        if (telegram_id) {
            const userTicketsResult = await pool.query("SELECT COUNT(*) AS count FROM user_tickets WHERE contest_id = $1 AND telegram_id = $2", [contest.id, telegram_id]);
            userTickets = Number(userTicketsResult.rows[0].count);
        }

        res.json({ ...contest, ...ticketCount, userTickets });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post('/api/contest/buy-ticket', async (req, res) => {
    const { contest_id, telegram_id, quantity } = req.body;
    if (!contest_id || !telegram_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Неверные данные для покупки билета' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (let i = 0; i < quantity; i++) {
            await client.query("INSERT INTO user_tickets (contest_id, user_id, telegram_id) VALUES ($1, $2, $3)", [contest_id, telegram_id, telegram_id]);
        }

        await client.query('COMMIT');
        res.json({ success: true });

    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// --- API Маршруты (админские) ---
app.use('/api/admin', checkAdminSecret);

app.get('/api/admin/users', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT user_id as id, user_id as telegram_id, username, balance_uah as balance FROM users ORDER BY user_id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/user/balance', async (req, res) => {
    const { userId, newBalance } = req.body;
    try {
        const result = await pool.query("UPDATE users SET balance_uah = $1 WHERE user_id = $2", [newBalance, userId]);
        res.json({ success: true, changes: result.rowCount });
    } catch (err) {
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

app.listen(port, () => {
    console.log(`Сервер успешно запущен на порту ${port}`);
    checkDbConnection();
});

