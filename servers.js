const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


// --- ВІДДАЧА СТАТИЧНИХ ФАЙЛІВ ---
// Цей блок тепер знаходиться ДО захисту
app.use(express.static(__dirname));
app.use('/admin', express.static(path.join(__dirname, 'admin')));


// --- ЗАХИСТ АДМІН-ПАНЕЛІ ---
const ADMIN_SECRET = 'Aurum'; // <-- ЗАМІНІТЬ ЦЕ НА ВАШ ВЛАСНИЙ СЕКРЕТНИЙ КЛЮЧ

const checkAdminSecret = (req, res, next) => {
    const { secret } = req.query;
    if (secret === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).send('Доступ заборонено');
    }
};

// Захищаємо тільки API-маршрути адмінки
app.use('/api/admin', checkAdminSecret);


// --- ОСНОВНІ МАРШРУТИ ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Захищаємо HTML-сторінку адмінки напряму
app.get('/admin', checkAdminSecret, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});


// Підключення до БД
const dataDir = process.env.RENDER_DISK_MOUNT_PATH || __dirname;
const dbPath = path.join(dataDir, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Помилка при підключенні до БД:", err.message);
    } else {
        console.log(`Успішне підключення до бази даних: ${dbPath}`);
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
    });
}

// --- API Маршрути (клієнтські) ---
app.post('/api/user/get-or-create', (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id є обов'язковим" });
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

app.get('/api/admin/case/items_full', (req, res) => {
    const sql = `SELECT i.id, i.name, i.imageSrc, i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length > 0) {
            res.json(rows);
        } else {
            db.all("SELECT * FROM items ORDER BY value DESC", [], (err, allItems) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(allItems);
            });
        }
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


// --- API Маршрути (адмінські) ---
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
        return res.status(400).json({ error: 'Неправильний формат налаштувань' });
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

app.listen(port, () => {
    console.log(`Сервер успішно запущен на порту ${port}`);
    console.log(`Основний додаток: http://localhost:${port}`);
    console.log(`Адмін-панель: http://localhost:${port}/admin?secret=${ADMIN_SECRET}`);
});
