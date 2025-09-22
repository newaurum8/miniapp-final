const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

// Используем переменную окружения для строки подключения
const connectionString = 'postgresql://neondb_owner:npg_xoO8NXpDn1fy@ep-hidden-sound-a23oyr8a-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

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

// --- КОНФИГУРАЦИЯ ---
const ADMIN_SECRET = 'Aurum';
// !!! ИЗМЕНЕНИЕ: Установлен ваш публичный URL-адрес Python-сервера !!!
const BOT_API_URL = 'http://server4644.server-vps.com:8000/api/v1/balance/change'; 
const MINI_APP_SECRET_KEY = "a4B!z$9pLw@cK#vG*sF7qE&rT2uY"; // ВАЖНО: Должен совпадать с ключом в config.py

// --- Хелпер для отправки запросов к API бота ---
async function changeBalanceInBot(telegramId, delta, reason) {
    const idempotencyKey = uuidv4();
    const body = JSON.stringify({
        user_id: telegramId, // Отправляем telegram_id
        delta: delta,
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
                     throw new Error(result.detail || `Ошибка API бота: ${response.status}`);
                }
                 console.warn(`Попытка ${attempt} не удалась. Статус: ${response.status}. Ответ:`, result);
                 if (attempt === 3) throw new Error(`Ошибка API бота после 3 попыток: ${result.detail || response.status}`);
                 await new Promise(res => setTimeout(res, 1000 * attempt));
                 continue;
            }

            return result;
        } catch (error) {
             console.error(`Попытка ${attempt} провалилась с сетевой ошибкой:`, error);
             if (attempt === 3) throw new Error("Не удалось связаться с сервером бота после нескольких попыток.");
             await new Promise(res => setTimeout(res, 1000 * attempt));
        }
    }
}


// --- ОТДАЧА СТАТИЧЕСКИХ ФАЙЛОВ ---
app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// --- ЗАЩИТА АДМИН-ПАНЕЛИ ---
const checkAdminSecret = (req, res, next) => {
    const secret = req.query.secret || req.body.secret;
    if (secret === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).send('Доступ запрещен');
    }
};

// --- ОСНОВНЫЕ МАРШРУТЫ ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', checkAdminSecret, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// --- ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ ---
async function initializeDb() {
    const client = await pool.connect();
    try {
        console.log('Успешное подключение к базе данных PostgreSQL');

        // Схема таблицы приведена в соответствие с основной БД бота
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                user_id BIGINT UNIQUE,
                username VARCHAR(255),
                chosen_currency VARCHAR(10),
                chosen_game VARCHAR(50),
                registration_date TIMESTAMPTZ DEFAULT NOW(),
                balance_uah NUMERIC(10, 2) DEFAULT 0.00
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS items (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                "imageSrc" TEXT,
                value INTEGER NOT NULL
            );
        `);

        const items = [
            { id: 1, name: 'Cigar', imageSrc: 'images/item.png', value: 3170 },
            { id: 2, name: 'Bear', imageSrc: 'images/item1.png', value: 440 },
            { id: 3, name: 'Sigmaboy', imageSrc: 'images/case.png', value: 50 },
            { id: 4, name: 'Lemon', imageSrc: 'images/slot_lemon.png', value: 100 },
            { id: 5, name: 'Cherry', imageSrc: 'images/slot_cherry.png', value: 200 },
            { id: 6, name: 'Seven', imageSrc: 'images/slot_7.png', value: 777 }
        ];

        for (const item of items) {
            await client.query(
                `INSERT INTO items (id, name, "imageSrc", value) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING;`,
                [item.id, item.name, item.imageSrc, item.value]
            );
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_inventory (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS case_items (
                case_id INTEGER,
                item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
                PRIMARY KEY (case_id, item_id)
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS game_settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        
        const settings = [
            { key: 'miner_enabled', value: 'true' },
            { key: 'tower_enabled', value: 'true' },
            { key: 'slots_enabled', value: 'true' },
            { key: 'coinflip_enabled', value: 'true' },
            { key: 'rps_enabled', value: 'true' },
            { key: 'upgrade_enabled', value: 'true' }
        ];

        for (const s of settings) {
            await client.query(
                `INSERT INTO game_settings (key, value) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING;`,
                [s.key, s.value]
            );
        }

        await client.query(`
            CREATE TABLE IF NOT EXISTS contests (
                id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL REFERENCES items(id),
                ticket_price INTEGER NOT NULL,
                end_time BIGINT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                winner_id INTEGER REFERENCES users(id)
            );
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS user_tickets (
                id SERIAL PRIMARY KEY,
                contest_id INTEGER NOT NULL REFERENCES contests(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                telegram_id BIGINT NOT NULL
            );
        `);

        console.log('База данных успешно инициализирована.');
    } catch (err) {
        console.error('Ошибка при инициализации БД:', err);
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
        // ИЗМЕНЕНИЕ: user_id теперь telegram_id
        let userResult = await pool.query("SELECT id, user_id as telegram_id, username, balance_uah FROM users WHERE user_id = $1", [telegram_id]);
        if (userResult.rows.length > 0) {
            res.json(userResult.rows[0]);
        } else {
            const initialBalance = 0; // Новый пользователь начинает с 0
            const newUserResult = await pool.query(
                "INSERT INTO users (user_id, username, balance_uah) VALUES ($1, $2, $3) RETURNING id, user_id as telegram_id, username, balance_uah",
                [telegram_id, username, initialBalance]
            );
            res.status(201).json(newUserResult.rows[0]);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ... (остальные маршруты остаются без изменений, кроме тех, что работают с балансом)

app.post('/api/user/inventory/sell', async (req, res) => {
    const { user_id, unique_id } = req.body; 
    if (!user_id || !unique_id) {
        return res.status(400).json({ error: 'Неверные данные для продажи' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const itemResult = await client.query(
            // ИЗМЕНЕНИЕ: users.user_id теперь telegram_id
            'SELECT i.value, u.user_id as telegram_id FROM user_inventory ui JOIN items i ON ui.item_id = i.id JOIN users u ON ui.user_id = u.id WHERE ui.id = $1 AND ui.user_id = $2', 
            [unique_id, user_id]
        );
        if (itemResult.rows.length === 0) throw new Error('Предмет не найден в инвентаре');
        
        const { value: itemValue, telegram_id } = itemResult.rows[0];
        
        // В API бота передается ПОЛОЖИТЕЛЬНОЕ значение, так как это "зачисление" за продажу
        const botResponse = await changeBalanceInBot(telegram_id, itemValue, `sell_item_${unique_id}`);
        
        await client.query("DELETE FROM user_inventory WHERE id = $1", [unique_id]);
        
        await client.query('COMMIT');
        
        res.json({ success: true, newBalance: botResponse.new_balance });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Ошибка при продаже предмета:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/case/open', async (req, res) => {
    const { user_id, quantity } = req.body; 
    const casePrice = 100; // Цена в той же валюте, что и баланс
    const totalCost = casePrice * (quantity || 1);

    if (!user_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Неверные данные для открытия кейса' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // ИЗМЕНЕНИЕ: users.user_id теперь telegram_id
        const userResult = await client.query("SELECT user_id as telegram_id FROM users WHERE id = $1", [user_id]);
        if (userResult.rows.length === 0) throw new Error('Пользователь не найден');
        const { telegram_id } = userResult.rows[0];

        // В API бота передается ОТРИЦАТЕЛЬНОЕ значение, так как это списание
        const botResponse = await changeBalanceInBot(telegram_id, -totalCost, `open_case_x${quantity}`);

        const caseItemsResult = await client.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        const caseItems = (caseItemsResult.rows.length > 0) ? caseItemsResult.rows : (await client.query('SELECT id, name, "imageSrc", value FROM items')).rows;
        if (caseItems.length === 0) throw new Error('В игре нет предметов');

        const wonItems = Array.from({ length: quantity }, () => caseItems[Math.floor(Math.random() * caseItems.length)]);
        
        for (const item of wonItems) {
            await client.query("INSERT INTO user_inventory (user_id, item_id) VALUES ($1, $2)", [user_id, item.id]);
        }
        
        await client.query('COMMIT');
        res.json({ success: true, newBalance: botResponse.new_balance, wonItems });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Ошибка открытия кейса:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});


app.post('/api/contest/buy-ticket', async (req, res) => {
    const { user_id, contest_id, quantity } = req.body;
    if (!contest_id || !user_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Неверные данные для покупки билета' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const contestResult = await client.query("SELECT * FROM contests WHERE id = $1 AND is_active = TRUE", [contest_id]);
        if (contestResult.rows.length === 0 || contestResult.rows[0].end_time <= Date.now()) {
            throw new Error('Конкурс неактивен или завершен');
        }
        const contest = contestResult.rows[0];

        // ИЗМЕНЕНИЕ: user_id теперь telegram_id
        const userResult = await client.query("SELECT id, user_id as telegram_id FROM users WHERE id = $1", [user_id]);
        if (userResult.rows.length === 0) throw new Error('Пользователь не найден');
        const user = userResult.rows[0];

        const totalCost = contest.ticket_price * quantity;
        
        // В API бота передается ОТРИЦАТЕЛЬНОЕ значение
        const botResponse = await changeBalanceInBot(user.telegram_id, -totalCost, `buy_ticket_x${quantity}_contest_${contest_id}`);

        for (let i = 0; i < quantity; i++) {
            await client.query("INSERT INTO user_tickets (contest_id, user_id, telegram_id) VALUES ($1, $2, $3)", [contest_id, user.id, user.telegram_id]);
        }

        await client.query('COMMIT');
        res.json({ success: true, newBalance: botResponse.new_balance });

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
        const { rows } = await pool.query("SELECT id, user_id as telegram_id, username, balance_uah as balance FROM users ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Этот маршрут теперь НЕ БУДЕТ напрямую менять баланс, а будет вызывать API бота.
app.post('/api/admin/user/balance', async (req, res) => {
    const { userId, newBalance } = req.body; // userId - это внутренний id
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query("SELECT user_id as telegram_id, balance_uah FROM users WHERE id = $1", [userId]);
        if(userResult.rows.length === 0) throw new Error("User not found");
        
        const { telegram_id, balance_uah } = userResult.rows[0];
        const delta = newBalance - parseFloat(balance_uah);

        const botResponse = await changeBalanceInBot(telegram_id, delta, `admin_update_${userId}`);
        
        // Обновляем локальную копию, но основной источник - бот
        await client.query("UPDATE users SET balance_uah = $1 WHERE id = $2", [botResponse.new_balance, userId]);
        
        await client.query('COMMIT');
        res.json({ success: true, newBalance: botResponse.new_balance });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Admin balance update error:", err);
        res.status(500).json({ "error": err.message });
    } finally {
        client.release();
    }
});


app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
    console.log(`Основной додаток: http://localhost:${port}`);
    console.log(`Админ-панель: http://localhost:${port}/admin?secret=${ADMIN_SECRET}`);
    // initializeDb(); // Инициализация больше не нужна, т.к. схема общая с ботом
});
