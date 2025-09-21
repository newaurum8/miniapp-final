const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const redis = require('redis');

const app = express();
const port = process.env.PORT || 3000;

// --- Database & Redis Connections ---
const pgPool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_gFvZxTR7qdw1@ep-round-sound-agieqqp0-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require'
});

const redisClient = redis.createClient({
    url: 'redis://default:E9fz2YXROF1SIldpK4oCkQp9Q1w2wO59@redis-14272.c293.eu-central-1-1.ec2.redns.redis-cloud.com:14272'
});

redisClient.on('error', err => console.error('Redis Client Error', err));

// --- Global Constants & Middleware ---
const ADMIN_SECRET = 'Aurum';
const MINI_APP_SECRET_KEY = "a4B!z$9pLw@cK#vG*sF7qE&rT2uY";
const CASE_PRICE = 100;

// *** CRUCIAL CORS CONFIGURATION ***
// This setup is more robust and explicitly allows Telegram's web environment.
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests from Telegram, Render, and for local development (null origin)
    const allowedOrigins = [
        'https://web.telegram.org',
        'https://mmmmmm-mf64.onrender.com'
    ];
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST'],
  credentials: true
};
app.use(cors(corsOptions));

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

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
            return next();
        } else {
            console.warn("Invalid signature received");
            return res.status(403).json({ detail: "Invalid signature" });
        }
    } catch (error) {
        console.error("Signature verification failed:", error);
        return res.status(403).json({ detail: "Invalid signature" });
    }
};

// --- Static Files & Admin Routes ---
app.use(express.static(__dirname));
const checkAdminSecret = (req, res, next) => {
    if (req.query.secret === ADMIN_SECRET) {
        next();
    } else {
        res.status(403).send('Доступ запрещен');
    }
};
app.get('/admin', checkAdminSecret, (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));

// ### Transactional Balance Change Utility ###
async function changeBalance(client, userId, delta) {
    const userResult = await client.query("SELECT balance_uah FROM users WHERE user_id = $1 FOR UPDATE", [userId]);
    if (userResult.rows.length === 0) {
        throw new Error("Пользователь не найден.");
    }
    const currentBalance = parseFloat(userResult.rows[0].balance_uah);
    const newBalance = currentBalance + delta;
    if (newBalance < 0) {
        throw new Error("Недостаточно средств на балансе.");
    }
    await client.query("UPDATE users SET balance_uah = $1 WHERE user_id = $2", [newBalance, userId]);
    return newBalance;
}

// --- API Endpoints for Mini App ---

// Get/Create User (On App Load)
app.post('/api/user/get-or-create', async (req, res) => {
    const { telegram_id, username } = req.body;
    if (!telegram_id) {
        return res.status(400).json({ error: "telegram_id is required" });
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
        console.error('Error in /api/user/get-or-create:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Get User Inventory
app.get('/api/user/inventory', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
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

// Open Case Endpoint
app.post('/api/case/open', checkSignature, async (req, res) => {
    const { user_id, quantity } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];
    const processedKey = `idempotency:${idempotencyKey}`;

    if (!user_id || !quantity || quantity <= 0) {
        return res.status(400).json({ detail: 'Invalid data' });
    }
    if (await redisClient.get(processedKey)) {
         return res.status(200).json({ detail: "Request already processed" });
    }

    const client = await pgPool.connect();
    try {
        await client.query('BEGIN');
        const totalCost = CASE_PRICE * quantity;
        const newBalance = await changeBalance(client, user_id, -totalCost);

        const caseItemsResult = await client.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        if (caseItemsResult.rows.length === 0) throw new Error('Case is empty');
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
        console.error(`Error opening case for user ${user_id}:`, err);
        res.status(400).json({ detail: err.message });
    } finally {
        client.release();
    }
});

// Sell Items Endpoint
app.post('/api/inventory/sell', checkSignature, async (req, res) => {
    const { user_id, uniqueIds } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'];
    const processedKey = `idempotency:${idempotencyKey}`;
    
    if (!user_id || !uniqueIds || !Array.isArray(uniqueIds) || uniqueIds.length === 0) {
        return res.status(400).json({ detail: 'Invalid data' });
    }
    if (await redisClient.get(processedKey)) {
        const profile = await pgPool.query("SELECT balance_uah FROM users WHERE user_id = $1", [user_id]);
        const currentBalance = profile.rows.length > 0 ? parseFloat(profile.rows[0].balance_uah) : 0;
        return res.json({ success: true, message: "Request already processed", newBalance: currentBalance });
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
            throw new Error('One or more items not found or do not belong to you.');
        }

        const totalValue = itemsToSell.rows.reduce((sum, item) => sum + item.value, 0);
        await client.query(
            "DELETE FROM user_inventory WHERE id = ANY($1::int[]) AND user_id = $2",
            [uniqueIds, user_id]
        );
        const newBalance = await changeBalance(client, user_id, totalValue);

        await client.query('COMMIT');
        await redisClient.set(processedKey, '1', { EX: 86400 });
        
        res.json({ success: true, newBalance });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error selling items for user ${user_id}:`, err);
        res.status(400).json({ detail: err.message });
    } finally {
        client.release();
    }
});

// Generic API endpoints (no changes)
app.get('/api/case/items_full', async (req, res) => {
    try {
        const { rows } = await pgPool.query('SELECT i.id, i.name, i."imageSrc", i.value FROM items i JOIN case_items ci ON i.id = ci.item_id WHERE ci.case_id = 1');
        res.json(rows.length > 0 ? rows : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
app.get('/api/game_settings', async (req, res) => {
    try {
        const { rows } = await pgPool.query("SELECT key, value FROM game_settings");
        const settings = rows.reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fallback for any other route - serve the main app. This helps prevent the <!DOCTYPE html> error.
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.status(404).json({error: "Endpoint not found"});
  }
});

// --- Start Server ---
async function startServer() {
    await redisClient.connect();
    app.listen(port, () => {
        console.log(`Server successfully started on port ${port}`);
    });
}

startServer();
