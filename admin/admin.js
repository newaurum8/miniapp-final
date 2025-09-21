document.addEventListener('DOMContentLoaded', () => {
    // Используем относительный URL
    const API_BASE_URL = '';

    const params = new URLSearchParams(window.location.search);
    const ADMIN_SECRET_KEY = params.get('secret');

    if (!ADMIN_SECRET_KEY) {
        document.body.innerHTML = '<h1>Помилка: секретний ключ відсутній в URL-адресі.</h1>';
        return;
    }

    const usersTableBody = document.querySelector('#users-table tbody');
    const caseItemsContainer = document.getElementById('case-items-container');
    const saveCaseBtn = document.getElementById('save-case-btn');
    const gameManagementContainer = document.getElementById('game-management-container');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    
    const contestItemSelect = document.getElementById('contest-item-select');
    const contestTicketPriceInput = document.getElementById('contest-ticket-price');
    const contestDurationInput = document.getElementById('contest-duration');
    const createContestBtn = document.getElementById('create-contest-btn');
    const currentContestInfoDiv = document.getElementById('current-contest-info');
    const contestDetailsP = document.getElementById('contest-details');
    const drawWinnerBtn = document.getElementById('draw-winner-btn');

    let allPossibleItems = [];
    let initialCaseItemIds = new Set();
    let currentContest = null;

    async function fetchAllAdminData() {
        try {
            const usersRes = await fetch(`${API_BASE_URL}/api/admin/users?secret=${ADMIN_SECRET_KEY}`);
            if (!usersRes.ok) throw new Error(`Помилка завантаження користувачів: ${usersRes.statusText}`);
            const users = await usersRes.json();

            const itemsRes = await fetch(`${API_BASE_URL}/api/admin/items?secret=${ADMIN_SECRET_KEY}`);
            if (!itemsRes.ok) throw new Error(`Помилка завантаження предметів: ${itemsRes.statusText}`);
            const items = await itemsRes.json();

            const caseItemsRes = await fetch(`${API_BASE_URL}/api/admin/case/items?secret=${ADMIN_SECRET_KEY}`);
            if (!caseItemsRes.ok) throw new Error(`Помилка завантаження кейсів: ${caseItemsRes.statusText}`);
            const caseItems = await caseItemsRes.json();
            
            const settingsRes = await fetch(`${API_BASE_URL}/api/game_settings?secret=${ADMIN_SECRET_KEY}`);
            if (!settingsRes.ok) throw new Error(`Помилка завантаження налаштувань: ${settingsRes.statusText}`);
            const settings = await settingsRes.json();

            const contestRes = await fetch(`${API_BASE_URL}/api/contest/current?secret=${ADMIN_SECRET_KEY}`);
            if (!contestRes.ok) throw new Error(`Помилка завантаження конкурсу: ${contestRes.statusText}`);
            const contest = await contestRes.json();
            
            renderUsers(users);
            allPossibleItems = items;
            initialCaseItemIds = new Set(caseItems);
            renderCaseItemsSelection();
            renderSettings(settings);
            populateContestItemSelect(items);
            currentContest = contest;
            renderCurrentContest();

        } catch (error) {
            console.error('Помилка при завантаженні даних:', error);
            alert(`Не вдалося завантажити дані для адмін-панелі. Помилка: ${error.message}`);
        }
    }
    
    // ИЗМЕНЕННАЯ ФУНКЦИЯ
    function renderUsers(users) {
        usersTableBody.innerHTML = '';
        if (!users || users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="5">Пользователи еще не зарегистрированы.</td></tr>';
            return;
        }
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td> 
                <td>${user.telegram_id || 'N/A'}</td>
                <td>${user.username || 'N/A'}</td>
                <td><input type="number" class="balance-input" value="${parseFloat(user.balance).toFixed(2)}"></td>
                <td><button class="button-primary save-balance-btn" data-userid="${user.id}">Сохранить</button></td>
            `;
            usersTableBody.appendChild(row);
        });
    }

    // ИЗМЕНЕННАЯ ФУНКЦИЯ
    async function updateUserBalance(userId, newBalance) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/user/${userId}/balance?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newBalance: newBalance })
            });
            const result = await response.json();
            if (response.ok && result.success) {
                alert(`Баланс пользователя ${userId} успешно обновлен до ${result.newBalance}.`);
                const input = usersTableBody.querySelector(`button[data-userid="${userId}"]`).closest('tr').querySelector('.balance-input');
                if (input) input.value = parseFloat(result.newBalance).toFixed(2);
            } else {
                throw new Error(result.error || 'Сервер вернул ошибку.');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            alert(`Не удалось обновить баланс: ${error.message}`);
        }
    }

    // ИЗМЕНЕННЫЙ ОБРАБОТЧИК
    usersTableBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('save-balance-btn')) {
            const userId = e.target.dataset.userid;
            const balanceInput = e.target.closest('tr').querySelector('.balance-input');
            const newBalance = parseFloat(balanceInput.value);
            if (userId && !isNaN(newBalance) && newBalance >= 0) {
                updateUserBalance(userId, newBalance);
            } else {
                alert("Пожалуйста, введите корректное числовое значение для баланса.");
            }
        }
    });

    function renderCaseItemsSelection() {
        caseItemsContainer.innerHTML = '';
        allPossibleItems.forEach(item => {
            const isChecked = initialCaseItemIds.has(item.id);
            const label = document.createElement('label');
            label.className = 'item-label';
            label.innerHTML = `
                <input type="checkbox" data-itemid="${item.id}" ${isChecked ? 'checked' : ''}>
                <img src="../${item.imageSrc}" alt="${item.name}">
                <span>${item.name}</span>
            `;
            caseItemsContainer.appendChild(label);
        });
    }

    async function saveCaseItems() {
        const selectedItemIds = Array.from(caseItemsContainer.querySelectorAll('input:checked')).map(cb => parseInt(cb.dataset.itemid));
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/case/items?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemIds: selectedItemIds })
            });
            if (!response.ok) throw new Error('Ошибка сохранения');
            alert('Содержимое кейса обновлено!');
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Не удалось сохранить содержимое кейса.');
        }
    }
    saveCaseBtn.addEventListener('click', saveCaseItems);
    
    const gameNames = {
        'miner_enabled': 'Минер', 'tower_enabled': 'Башня', 'slots_enabled': 'Слоты',
        'coinflip_enabled': 'Орел и Решка', 'rps_enabled': 'К-Н-Б', 'upgrade_enabled': 'Апгрейды'
    };

    function renderSettings(settings) {
        gameManagementContainer.innerHTML = '';
        for (const key in settings) {
            if (gameNames[key]) {
                const item = document.createElement('div');
                item.className = 'setting-item';
                item.innerHTML = `
                    <label for="${key}">${gameNames[key]}</label>
                    <input type="checkbox" id="${key}" data-key="${key}" class="toggle-switch" ${settings[key] === 'true' ? 'checked' : ''}>
                `;
                gameManagementContainer.appendChild(item);
            }
        }
    }

    async function saveSettings() {
        const settingsToSave = {};
        gameManagementContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            settingsToSave[cb.dataset.key] = cb.checked;
        });
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/game_settings?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: settingsToSave })
            });
            if (!response.ok) throw new Error('Ошибка сохранения');
            alert('Настройки игр сохранены!');
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Не удалось сохранить настройки.');
        }
    }
    saveSettingsBtn.addEventListener('click', saveSettings);
    
    function populateContestItemSelect(items) {
        contestItemSelect.innerHTML = items.map(item => `<option value="${item.id}">${item.name} (Стоимость: ${item.value})</option>`).join('');
    }
    
    function renderCurrentContest() {
        if (currentContest) {
            const endDate = new Date(Number(currentContest.end_time)).toLocaleString();
            contestDetailsP.innerHTML = `
                <strong>Приз:</strong> ${currentContest.itemName} <br>
                <strong>Цена билета:</strong> ${currentContest.ticket_price} <br>
                <strong>Завершение:</strong> ${endDate} <br>
                <strong>Билетов куплено:</strong> ${currentContest.count} <br>
                <strong>Участников:</strong> ${currentContest.participants}
            `;
            currentContestInfoDiv.classList.remove('hidden');
        } else {
            contestDetailsP.textContent = 'Активных конкурсов нет.';
            currentContestInfoDiv.classList.add('hidden');
        }
    }

    async function createContest() {
        const contestData = {
            item_id: parseInt(contestItemSelect.value),
            ticket_price: parseInt(contestTicketPriceInput.value),
            duration_hours: parseInt(contestDurationInput.value)
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/contest/create?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(contestData)
            });
            const result = await response.json();
            if (result.success) {
                alert('Новый конкурс успешно создан!');
                fetchAllAdminData(); 
            } else {
                throw new Error(result.error || 'Ошибка создания конкурса');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            alert(`Не удалось создать конкурс: ${error.message}`);
        }
    }

    async function drawWinner() {
        if (!currentContest || !confirm('Вы уверены, что хотите завершить конкурс и определить победителя досрочно?')) {
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/contest/draw/${currentContest.id}?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST'
            });
            const result = await response.json();
            if(result.success){
                 alert(`Победитель определён! Telegram ID: ${result.winner_telegram_id}. Приз зачислен в инвентарь победителя.`);
            } else if (result.message) {
                 alert(result.message);
            }
            else {
                throw new Error(result.error || 'Ошибка при розыгрыше');
            }
            fetchAllAdminData(); 
        } catch (error) {
            console.error('Ошибка:', error);
            alert(`Ошибка: ${error.message}`);
        }
    }
    createContestBtn.addEventListener('click', createContest);
    drawWinnerBtn.addEventListener('click', drawWinner);

    fetchAllAdminData();
});
