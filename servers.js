const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- ОТДАЧА СТАТИЧЕСКИХ ФАЙЛОВ ---
const miniappPath = path.join(__dirname, 'miniapp');

// ЭТА СТРОКА ПОКАЖЕТ НАМ В ЛОГАХ, КАКОЙ ПУТЬ ИСПОЛЬЗУЕТСЯ
console.log(`[Server] Путь к папке miniapp: ${miniappPath}`); 

app.use(express.static(miniappPath));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// --- ДЕБАГ-МАРШРУТ НА СЛУЧАЙ ОШИБКИ ---
// Если express.static не найдет index.html, в браузере появится это сообщение
app.get('/', (req, res) => {
    res.status(404).send('Сервер работает, но файл index.html не найден в папке miniapp. Проверьте структуру репозитория на GitHub.');
});


// --- (остальной ваш код без изменений) ---

// Подключение к БД
const dbPath = './database.sqlite';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Ошибка при подключении к БД:", err.message);
    } else {
        console.log("Успешное подключение к базе данных SQLite.");
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
    });
}

// --- API Маршруты ---

app.get('/api/admin/users', (req, res) => {
    db.all("SELECT id, telegram_id, username, balance FROM users", [], (err, rows) => {
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
            for (const itemId of itemIds) {
                stmt.run(caseId, itemId);
            }
            stmt.finalize((err) => {
                if (err) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ "error": err.message });
                }
                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ "error": err.message });
                    return res.json({ success: true });
                });
            });
        } else {
             db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ "error": err.message });
                return res.json({ success: true });
            });
        }
    });
});

app.get('/api/admin/case/items_full', (req, res) => {
    const sql = `
        SELECT i.id, i.name, i.imageSrc, i.value 
        FROM items i
        JOIN case_items ci ON i.id = ci.item_id
        WHERE ci.case_id = 1
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.listen(port, () => {
    console.log(`Сервер успешно запущен на порту ${port}`);
    console.log(`Основное приложение: http://localhost:${port}`);
    console.log(`Админ-панель: http://localhost:${port}/admin`);
});