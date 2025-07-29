document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = '';
    const usersTableBody = document.querySelector('#users-table tbody');
    const caseItemsContainer = document.getElementById('case-items-container');
    const saveCaseBtn = document.getElementById('save-case-btn');
    const gameManagementContainer = document.getElementById('game-management-container');
    const saveSettingsBtn = document.getElementById('save-settings-btn');

    // --- Секція 1: Управління користувачами ---

    async function fetchUsers() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/users`);
            if (!response.ok) throw new Error(`Помилка мережі: ${response.status}`);
            const users = await response.json();
            renderUsers(users);
        } catch (error) {
            console.error('Помилка при завантаженні користувачів:', error);
            usersTableBody.innerHTML = '<tr><td colspan="5">Не вдалося завантажити користувачів. Переконайтеся, що сервер запущений.</td></tr>';
        }
    }

    function renderUsers(users) {
        usersTableBody.innerHTML = '';
        if (users.length === 0) {
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
                <td><button class="button-primary save-balance-btn" data-userid="${user.id}">Зберегти</button></td>
            `;
            usersTableBody.appendChild(row);
        });
    }

    async function updateUserBalance(userId, newBalance) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/user/balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, newBalance })
            });
            const result = await response.json();
            if (result.success) {
                alert(`Баланс користувача ${userId} успішно оновлено.`);
            } else {
                throw new Error('Сервер повернув помилку при оновленні балансу.');
            }
        } catch (error) {
            console.error('Помилка:', error);
            alert('Не вдалося оновити баланс. Перевірте консоль та лог сервера.');
        }
    }

    usersTableBody.addEventListener('click', (e) => {
        if (e.target.classList.contains('save-balance-btn')) {
            const userId = e.target.dataset.userid;
            const balanceInput = e.target.closest('tr').querySelector('.balance-input');
            const newBalance = parseInt(balanceInput.value, 10);
            if (!isNaN(newBalance) && newBalance >= 0) {
                updateUserBalance(userId, newBalance);
            } else {
                alert("Будь ласка, введіть коректне числове значення для балансу.");
            }
        }
    });

    // --- Секція 2: Управління вмістом кейсу ---

    let allPossibleItems = [];
    let initialCaseItemIds = new Set();

    async function fetchAllDataForCases() {
        try {
            const [itemsResponse, caseItemsResponse] = await Promise.all([
                fetch(`${API_BASE_URL}/api/admin/items`),
                fetch(`${API_BASE_URL}/api/admin/case/items`)
            ]);
            allPossibleItems = await itemsResponse.json();
            const caseIds = await caseItemsResponse.json();
            initialCaseItemIds = new Set(caseIds);
            renderCaseItemsSelection();
        } catch (error) {
            console.error('Помилка при завантаженні даних для кейсів:', error);
        }
    }

    function renderCaseItemsSelection() {
        caseItemsContainer.innerHTML = '';
        allPossibleItems.forEach(item => {
            const isChecked = initialCaseItemIds.has(item.id);
            const itemElement = document.createElement('div');
            const label = document.createElement('label');
            label.className = 'item-label';
            label.title = `${item.name} (Вартість: ${item.value})`;

            label.innerHTML = `
                <input type="checkbox" class="item-checkbox" data-itemid="${item.id}" ${isChecked ? 'checked' : ''}>
                <img src="../${item.imageSrc}" alt="${item.name}">
                <span>${item.name}</span>
            `;

            const checkbox = label.querySelector('.item-checkbox');
            checkbox.addEventListener('change', () => {
                const wasChecked = initialCaseItemIds.has(item.id);
                const isNowChecked = checkbox.checked;

                label.classList.remove('item-added', 'item-removed');

                if (isNowChecked && !wasChecked) {
                    label.classList.add('item-added');
                } else if (!isNowChecked && wasChecked) {
                    label.classList.add('item-removed');
                }
            });
            itemElement.appendChild(label);
            caseItemsContainer.appendChild(itemElement);
        });
    }

    async function saveCaseItems() {
        const selectedCheckboxes = caseItemsContainer.querySelectorAll('.item-checkbox:checked');
        const selectedItemIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.dataset.itemid));

        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/case/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemIds: selectedItemIds })
            });
            const result = await response.json();
            if (result.success) {
                alert('Вміст кейсу успішно оновлено!');
                initialCaseItemIds = new Set(selectedItemIds);
                document.querySelectorAll('.item-label').forEach(label => {
                    label.classList.remove('item-added', 'item-removed');
                });
            } else {
                throw new Error('Помилка при збереженні кейсу');
            }
        } catch (error) {
            console.error('Помилка:', error);
            alert('Не вдалося зберегти вміст кейсу.');
        }
    }

    saveCaseBtn.addEventListener('click', saveCaseItems);

    // --- Секція 3: Управління налаштуваннями ---

    const gameNames = {
        'miner_enabled': 'Мінер',
        'tower_enabled': 'Вежа',
        'slots_enabled': 'Слоти',
        'coinflip_enabled': 'Орел і Решка',
        'rps_enabled': 'Камінь-Ножиці-Папір',
        'upgrade_enabled': 'Апгрейди'
    };

    async function fetchSettings() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/game_settings`);
            const settings = await response.json();
            renderSettings(settings);
        } catch (error) {
            console.error('Помилка при завантаженні налаштувань:', error);
        }
    }

    function renderSettings(settings) {
        gameManagementContainer.innerHTML = '';
        for (const key in settings) {
            if (gameNames[key]) {
                const isChecked = settings[key] === 'true';
                const item = document.createElement('div');
                item.className = 'setting-item';
                item.innerHTML = `
                    <label for="${key}">${gameNames[key]}</label>
                    <input type="checkbox" id="${key}" data-key="${key}" class="toggle-switch" ${isChecked ? 'checked' : ''}>
                `;
                gameManagementContainer.appendChild(item);
            }
        }
    }

    async function saveSettings() {
        const settingsToSave = {};
        const checkboxes = gameManagementContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => {
            settingsToSave[cb.dataset.key] = cb.checked;
        });

        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/game_settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: settingsToSave })
            });
            const result = await response.json();
            if (result.success) {
                alert('Налаштування успішно збережено!');
            } else {
                throw new Error('Помилка при збереженні налаштувань.');
            }
        } catch (error) {
            console.error('Помилка:', error);
            alert('Не вдалося зберегти налаштування.');
        }
    }

    saveSettingsBtn.addEventListener('click', saveSettings);

    // --- Ініціалізація ---
    function init() {
        fetchUsers();
        fetchAllDataForCases();
        fetchSettings();
    }

    init();
});
