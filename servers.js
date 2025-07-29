const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- ОТДАЧА СТАТИЧЕСКИХ ФАЙЛОВ ---
// Этот блок должен быть до защиты, чтобы CSS и JS админки загружались
app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));


// --- ЗАЩИТА АДМИН-ПАНЕЛИ ---
const ADMIN_SECRET = 'Aurum'; // <-- ЗАМЕНИТЕ ЭТО НА ВАШ СОБСТВЕННЫЙ УНИКАЛЬНЫЙ КЛЮЧ

const checkAdminSecret = (req, res, next) => {
    // Ключ может передаваться как в query (?secret=KEY), так и в теле запроса
    const secret = req.query.secret || req.body.secret;
    if (secret === ADMIN_SECRET) {
        next(); // Ключ верный, продолжаем
    } else {
        res.status(403).send('Доступ запрещен'); // Ключ неверный, блокируем
    }
};

// Применяем защиту только к API-маршрутам админки
app.use('/api/admin', checkAdminSecret);


// --- ОСНОВНЫЕ МАРШРУТЫ ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Защищаем HTML-страницу админки напрямую
app.get('/admin', checkAdminSecret, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});


// Подключение к БД (с учетом Render Disk)
const dataDir = process.env.RENDER_DISK_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Ошибка при подключении к БД:", err.message);
    } else {
        console.log(`Успешное подключение к базе данных: ${dbPath}`);
        initializeDb();
    }
});

function initializeDb() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            telegram_id INTEGER UNIQUE,
            username TEXT,
            balance INTEGER NOT NULL DEFAULT 1000
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            imageSrc TEXT,
            value INTEGER NOT NULL
        )`, (err) => {
            if (!err) {
                const items = [
                    { id: 1, name: 'Cigar', imageSrc: 'images/item.png', value: 3170 },
                    { id: 2, name: 'Bear', imageSrc: 'images/item1.png', value: 440 },
                    { id: 3, name: 'Sigmaboy', imageSrc: 'images/case.png', value: 50 },
                    { id: 4, name: 'Lemon', imageSrc: 'images/slot_lemon.png', value: 100 },
                    { id: 5, name: 'Cherry', imageSrc: 'images/slot_cherry.png', value: 200 },
                    { id: 6, name: 'Seven', imageSrc: 'images/slot_7.png', value: 777 }
                ];
                const stmt = db.prepare("INSERT OR IGNORE INTO items (id, name, imageSrc, value) VALUES (?, ?, ?, ?)");
                items.forEach(item => stmt.run(item.id, item.name, item.imageSrc, item.value));
                stmt.finalize();
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS case_items (
            case_id INTEGER,
            item_id INTEGER,
            PRIMARY KEY (case_id, item_id),
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS game_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, (err) => {
            if (!err) {
                const settings = [
                    { key: 'miner_enabled', value: 'true' },
                    { key: 'tower_enabled', value: 'true' },
                    { key: 'slots_enabled', value: 'true' },
                    { key: 'coinflip_enabled', value: 'true' },
                    { key: 'rps_enabled', value: 'true' },
                    { key: 'upgrade_enabled', value: 'true' }
                ];
                const stmt = db.prepare("INSERT OR IGNORE INTO game_settings (key, value) VALUES (?, ?)");
                settings.forEach(s => stmt.run(s.key, s.value));
                stmt.finalize();
            }
        });

        // --- ТАБЛИЦЫ ДЛЯ КОНКУРСА ---
        db.run(`CREATE TABLE IF NOT EXISTS contests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            ticket_price INTEGER NOT NULL,
            end_time INTEGER NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            winner_id INTEGER,
            FOREIGN KEY (item_id) REFERENCES items(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contest_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            telegram_id INTEGER NOT NULL,
            FOREIGN KEY (contest_id) REFERENCES contests(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
    });
}

// --- API Маршруты (клиентские - без защиты) ---
app.post('/api/user/get-or-create', (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id является обязательным" });
    }
    db.get("SELECT * FROM users WHERE telegram_id = ?", [telegram_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            res.json(row);
        } else {
            const initialBalance = 1000;
            db.run("INSERT INTO users (telegram_id, username, balance) VALUES (?, ?, ?)", [telegram_id, username, initialBalance], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                db.get("SELECT * FROM users WHERE id = ?", [this.lastID], (err, newUser) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.status(201).json(newUser);
                });
            });
        }
    });
});

app.get('/api/case/items', (req, res) => {
    const sql = `SELECT i.id, i.name, i.imageSrc, i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get('/api/game_settings', (req, res) => {
    db.all("SELECT key, value FROM game_settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = rows.reduce((acc, row) => {
            acc[row.key] = row.value;
            return acc;
        }, {});
        res.json(settings);
    });
});

// (Клиент) Получение актуального конкурса
app.get('/api/contest/current', (req, res) => {
    const now = Date.now();
    const sql = `
        SELECT c.id, c.end_time, c.ticket_price, c.winner_id, i.name AS item_name, i.imageSrc AS item_imageSrc
        FROM contests c
        JOIN items i ON c.item_id = i.id
        WHERE c.is_active = TRUE AND c.end_time > ?
        ORDER BY c.id DESC LIMIT 1
    `;
    db.get(sql, [now], async (err, contest) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contest) return res.json(null);

        try {
            const ticketCount = await new Promise((resolve, reject) => {
                db.get("SELECT COUNT(*) AS count, COUNT(DISTINCT user_id) as participants FROM user_tickets WHERE contest_id = ?", [contest.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            const { telegram_id } = req.query;
            let userTickets = 0;
            if (telegram_id) {
                const userTicketCount = await new Promise((resolve, reject) => {
                    db.get("SELECT COUNT(*) AS count FROM user_tickets WHERE contest_id = ? AND telegram_id = ?", [contest.id, telegram_id], (err, row) => {
                        if (err) reject(err);
                        else resolve(row.count);
                    });
                });
                userTickets = userTicketCount;
            }

            res.json({ ...contest, ...ticketCount, userTickets });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
});


// (Клиент) Покупка билета
app.post('/api/contest/buy-ticket', (req, res) => {
    const { contest_id, telegram_id, quantity } = req.body;
    if (!contest_id || !telegram_id || !quantity || quantity < 1) {
        return res.status(400).json({ error: 'Неверные данные для покупки билета' });
    }

    db.get("SELECT * FROM contests WHERE id = ? AND is_active = TRUE", [contest_id], (err, contest) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contest || contest.end_time <= Date.now()) {
            return res.status(400).json({ error: 'Конкурс неактивен или завершен' });
        }

        db.get("SELECT id, balance FROM users WHERE telegram_id = ?", [telegram_id], (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

            const totalCost = contest.ticket_price * quantity;
            if (user.balance < totalCost) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }

            const newBalance = user.balance - totalCost;
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, user.id]);
                const stmt = db.prepare("INSERT INTO user_tickets (contest_id, user_id, telegram_id) VALUES (?, ?, ?)");
                for (let i = 0; i < quantity; i++) {
                    stmt.run(contest_id, user.id, telegram_id);
                }
                stmt.finalize(err => {
                    if (err) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: "Ошибка при добавлении билета" });
                    }
                    db.run("COMMIT", (commitErr) => {
                        if (commitErr) return res.status(500).json({ "error": `Commit error: ${commitErr.message}` });
                        res.json({ success: true, newBalance });
                    });
                });
            });
        });
    });
});

// --- API Маршруты (админские - защищенные) ---
app.get('/api/admin/users', (req, res) => {
    db.all("SELECT id, telegram_id, username, balance FROM users ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/admin/user/balance', (req, res) => {
    const { userId, newBalance } = req.body;
    db.run(`UPDATE users SET balance = ? WHERE id = ?`, [newBalance, userId], function(err) {
        if (err) return res.status(500).json({ "error": err.message });
        res.json({ success: true, changes: this.changes });
    });
});

app.get('/api/admin/items', (req, res) => {
    db.all("SELECT * FROM items ORDER BY value DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/admin/case/items', (req, res) => {
    const caseId = 1;
    db.all(`SELECT item_id FROM case_items WHERE case_id = ?`, [caseId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.item_id));
    });
});

app.post('/api/admin/case/items', (req, res) => {
    const { itemIds } = req.body;
    const caseId = 1;
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(`DELETE FROM case_items WHERE case_id = ?`, [caseId], (err) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ "error": err.message });
            }
        });
        if (itemIds && itemIds.length > 0) {
            const stmt = db.prepare(`INSERT INTO case_items (case_id, item_id) VALUES (?, ?)`);
            itemIds.forEach(itemId => {
                stmt.run(caseId, itemId, (err) => {
                    if (err) console.error("Error inserting item:", err);
                });
            });
            stmt.finalize((err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ "error": `Finalize error: ${err.message}` });
                }
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) return res.status(500).json({ "error": `Commit error: ${commitErr.message}` });
                    res.json({ success: true });
                });
            });
        } else {
            db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ "error": err.message });
                res.json({ success: true });
            });
        }
    });
});

app.post('/api/admin/game_settings', (req, res) => {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ error: 'Неправильный формат настроек' });
    }
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("UPDATE game_settings SET value = ? WHERE key = ?");
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(value.toString(), key);
        }
        stmt.finalize((err) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: `Finalize error: ${err.message}` });
            }
            db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                    return res.status(500).json({ error: `Commit error: ${commitErr.message}` });
                }
                res.json({ success: true });
            });
        });
    });
});

// (Админка) Создание нового конкурса
app.post('/api/admin/contest/create', (req, res) => {
    const { item_id, ticket_price, duration_hours } = req.body;
    if (!item_id || !ticket_price || !duration_hours) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const endTime = Date.now() + duration_hours * 60 * 60 * 1000;

    db.serialize(() => {
        // Завершаем все активные конкурсы
        db.run("UPDATE contests SET is_active = FALSE WHERE is_active = TRUE", (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            // Создаем новый конкурс
            const stmt = db.prepare("INSERT INTO contests (item_id, ticket_price, end_time) VALUES (?, ?, ?)");
            stmt.run(item_id, ticket_price, endTime, function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.status(201).json({ success: true, contestId: this.lastID });
            });
            stmt.finalize();
        });
    });
});

// (Админка) Розыгрыш приза
app.post('/api/admin/contest/draw/:id', (req, res) => {
    const contestId = req.params.id;

    db.get("SELECT * FROM contests WHERE id = ? AND is_active = TRUE", [contestId], (err, contest) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contest) return res.status(404).json({ error: 'Активный конкурс не найден' });

        db.all("SELECT DISTINCT user_id, telegram_id FROM user_tickets WHERE contest_id = ?", [contestId], (err, participants) => {
            if (err) return res.status(500).json({ error: err.message });
            if (participants.length === 0) {
                db.run("UPDATE contests SET is_active = FALSE WHERE id = ?", [contestId]);
                return res.json({ message: 'В конкурсе не было участников, конкурс завершен.' });
            }

            const winner = participants[Math.floor(Math.random() * participants.length)];
            
            db.get("SELECT value FROM items WHERE id = ?", [contest.item_id], (err, item) => {
                 if(err) { 
                     console.error("Ошибка получения стоимости предмета:", err);
                     return res.status(500).json({ error: "Ошибка получения стоимости предмета" });
                 }
                 
                 db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [item.value, winner.user_id], function(err) {
                    if (err) {
                         console.error("Ошибка начисления приза:", err);
                         return res.status(500).json({ error: "Ошибка начисления приза" });
                    }
                    db.run("UPDATE contests SET is_active = FALSE, winner_id = ? WHERE id = ?", [winner.user_id, contestId], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ success: true, winner_telegram_id: winner.telegram_id });
                    });
                 });
            });
        });
    });
});


app.listen(port, () => {
    console.log(`Сервер успешно запущен на порту ${port}`);
    console.log(`Основной додаток: http://localhost:${port}`);
    console.log(`Админ-панель: http://localhost:${port}/admin?secret=${ADMIN_SECRET}`);
});
