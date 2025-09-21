const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
// Используйте порт, который предоставляет ваша среда выполнения (например, Render) или 3000 для локального теста
const port = process.env.PORT || 3000; 

// --- Middleware ---
// Разрешаем CORS-запросы, чтобы Mini App мог общаться с Python API
app.use(cors()); 

// --- Отдача статических файлов ---
// Эта строка говорит серверу отдавать файлы из той же директории, где он запущен
app.use(express.static(__dirname));

// Маршрут для главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Маршрут для админ-панели
app.get('/admin', (req, res) => {
    // ВАЖНО: Админ-панель больше не будет работать, так как вся логика переехала в Python.
    // Этот роут оставлен для примера, но его нужно будет переделать под запросы к Python API.
    res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// --- Запуск сервера ---
app.listen(port, () => {
    console.log(`Сервер статики Mini App запущен на порту ${port}`);
    console.log(`Он просто отдает файлы. Вся логика теперь в Python-сервере.`);
});
