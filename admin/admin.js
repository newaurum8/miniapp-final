document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const ADMIN_SECRET_KEY = params.get('secret');

    if (!ADMIN_SECRET_KEY) {
        document.body.innerHTML = '<h1>Помилка: секретний ключ відсутній в URL-адресі.</h1>';
        return;
    }

    const API_BASE_URL = '';

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
            const [users, items, caseItems, settings, contest] = await Promise.all([
                fetch(`${API_BASE_URL}/api/admin/users?secret=${ADMIN_SECRET_KEY}`).then(res => res.json()),
                fetch(`${API_BASE_URL}/api/admin/items?secret=${ADMIN_SECRET_KEY}`).then(res => res.json()),
                fetch(`${API_BASE_URL}/api/admin/case/items?secret=${ADMIN_SECRET_KEY}`).then(res => res.json()),
                fetch(`${API_BASE_URL}/api/game_settings?secret=${ADMIN_SECRET_KEY}`).then(res => res.json()),
                fetch(`${API_BASE_URL}/api/contest/current`).then(res => res.json())
            ]);


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
            alert('Не вдалося завантажити дані для адмін-панелі.');
        }
    }



    function renderUsers(users) {
        usersTableBody.innerHTML = '';
        if (!users || users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="5">Користувачі ще не зареєстровані.</td></tr>';
            return;
        }
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.telegram_id || 'N/A'}</td>
                <td>${user.username || 'N/A'}</td>
                <td><input type="number" class="balance-input" value="${user.balance}"></td>
                <td><button class="button-primary save-balance-btn" data-telegramid="${user.telegram_id}">Зберегти</button></td>
            `;
            usersTableBody.appendChild(row);
        });
    }
    // Оновлена функція для виклику нового API
    async function updateUserBalance(telegramId, newBalance) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/user/balance?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegramId: telegramId,
                    newBalance: newBalance
                })
            });
            const result = await response.json();
            if (response.ok && result.success) {
                alert(`Баланс користувача ${telegramId} успішно оновлено до ${result.newBalance}.`);
                // Оновлюємо значення в полі вводу, щоб воно відповідало реальному балансу
                const input = usersTableBody.querySelector(`button[data-telegramid="${telegramId}"]`).closest('tr').querySelector('.balance-input');
                if (input) {
                    input.value = result.newBalance;
                }
            } else {
                throw new Error(result.error || 'Сервер повернув помилку при оновленні балансу.');
            }
        } catch (error) {
            console.error('Помилка:', error);
            alert(`Не вдалося оновити баланс: ${error.message}`);
        }
    }
    // Оновлений обробник, що використовує data-telegramid
    usersTableBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('save-balance-btn')) {
            const telegramId = e.target.dataset.telegramid;
            const balanceInput = e.target.closest('tr').querySelector('.balance-input');
            const newBalance = parseFloat(balanceInput.value);

            if (telegramId && !isNaN(newBalance) && newBalance >= 0) {
                updateUserBalance(telegramId, newBalance);
            } else {
                alert("Будь ласка, введіть коректне числове значення для балансу.");
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
                <img src="/${item.imageSrc}" alt="${item.name}">
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
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    itemIds: selectedItemIds
                })
            });
            if (!response.ok) throw new Error('Помилка збереження');
            alert('Вміст кейсу оновлено!');
        } catch (error) {
            console.error('Помилка:', error);
            alert('Не вдалося зберегти вміст кейсу.');
        }
    }
    saveCaseBtn.addEventListener('click', saveCaseItems);


    const gameNames = {
        'miner_enabled': 'Мінер',
        'tower_enabled': 'Вежа',
        'slots_enabled': 'Слоти',
        'coinflip_enabled': 'Орел і Решка',
        'rps_enabled': 'К-Н-Б',
        'upgrade_enabled': 'Апгрейди'
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
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    settings: settingsToSave
                })
            });
            if (!response.ok) throw new Error('Помилка збереження');
            alert('Налаштування ігор збережено!');
        } catch (error) {
            console.error('Помилка:', error);
            alert('Не вдалося зберегти налаштування.');
        }
    }
    saveSettingsBtn.addEventListener('click', saveSettings);


    function populateContestItemSelect(items) {
        contestItemSelect.innerHTML = items.map(item => `<option value="${item.id}">${item.name} (Вартість: ${item.value})</option>`).join('');
    }

    function renderCurrentContest() {
        if (currentContest) {
            const endDate = new Date(Number(currentContest.end_time)).toLocaleString();
            contestDetailsP.innerHTML = `
                <strong>Приз:</strong> ${currentContest.itemName} <br>
                <strong>Ціна квитка:</strong> ${currentContest.ticket_price} <br>
                <strong>Завершення:</strong> ${endDate} <br>
                <strong>Квитків куплено:</strong> ${currentContest.count} <br>
                <strong>Учасників:</strong> ${currentContest.participants}
            `;
            currentContestInfoDiv.classList.remove('hidden');
        } else {
            contestDetailsP.textContent = 'Активних конкурсів немає.';
            currentContestInfoDiv.classList.add('hidden');
        }
    }

    async function createContest() {
        const contestData = {
            item_id: contestItemSelect.value,
            ticket_price: contestTicketPriceInput.value,
            duration_hours: contestDurationInput.value
        };

        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/contest/create?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(contestData)
            });
            const result = await response.json();
            if (result.success) {
                alert('Новий конкурс успішно створено!');
                fetchAllAdminData();
            } else {
                throw new Error(result.error || 'Помилка створення конкурсу');
            }
        } catch (error) {
            console.error('Помилка:', error);
            alert(`Не вдалося створити конкурс: ${error.message}`);
        }
    }

    async function drawWinner() {
        if (!currentContest || !confirm('Ви впевнені, що хочете завершити конкурс і визначити переможця достроково?')) {
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/contest/draw/${currentContest.id}?secret=${ADMIN_SECRET_KEY}`, {
                method: 'POST'
            });
            const result = await response.json();
            if (result.success) {
                alert(`Переможець визначений! Telegram ID: ${result.winner_telegram_id}. Приз зараховано в інвентар переможця.`);
            } else if (result.message) {
                alert(result.message);
            } else {
                throw new Error(result.error || 'Помилка під час розіграшу');
            }
            fetchAllAdminData();
        } catch (error) {
            console.error('Помилка:', error);
            alert(`Помилка: ${error.message}`);
        }
    }
    createContestBtn.addEventListener('click', createContest);
    drawWinnerBtn.addEventListener('click', drawWinner);



    fetchAllAdminData();
});
