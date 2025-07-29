document.addEventListener('DOMContentLoaded', () => {
    // Используем относительный путь. Это позволит коду работать
    // как на вашем компьютере (localhost), так и на хостинге.
    const API_BASE_URL = ''; 
    const usersTableBody = document.querySelector('#users-table tbody');
    const caseItemsContainer = document.getElementById('case-items-container');
    const saveCaseBtn = document.getElementById('save-case-btn');

    // --- Секция 1: Управление пользователями ---

    /**
     * Загружает список пользователей с сервера и отображает их в таблице.
     */
    async function fetchUsers() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/admin/users`);
            const users = await response.json();
            renderUsers(users);
        } catch (error) {
            console.error('Ошибка при загрузке пользователей:', error);
            usersTableBody.innerHTML = '<tr><td colspan="5">Не удалось загрузить пользователей. Убедитесь, что сервер запущен.</td></tr>';
        }
    }

    /**
     * Отрисовывает таблицу пользователей на основе полученных данных.
     * @param {Array} users - Массив объектов пользователей.
     */
    function renderUsers(users) {
        usersTableBody.innerHTML = ''; // Очищаем таблицу перед заполнением
        if (users.length === 0) {
             usersTableBody.innerHTML = '<tr><td colspan="5">Пользователи еще не зарегистрированы.</td></tr>';
             return;
        }
        users.forEach(user => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${user.id}</td>
                <td>${user.telegram_id || 'N/A'}</td>
                <td>${user.username || 'N/A'}</td>
                <td><input type="number" class="balance-input" value="${user.balance}"></td>
                <td><button class="button-primary save-balance-btn" data-userid="${user.id}">Сохранить</button></td>
            `;
            usersTableBody.appendChild(row);
        });
    }

    /**
     * Отправляет на сервер запрос на обновление баланса пользователя.
     * @param {string} userId - ID пользователя.
     * @param {number} newBalance - Новый баланс.
     */
    async function updateUserBalance(userId, newBalance) {
         try {
            const response = await fetch(`${API_BASE_URL}/api/admin/user/balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, newBalance })
            });
            const result = await response.json();
            if (result.success) {
                alert(`Баланс пользователя ${userId} успешно обновлен.`);
            } else {
                 throw new Error('Сервер вернул ошибку при обновлении баланса.');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Не удалось обновить баланс. Проверьте консоль и лог сервера.');
        }
    }
    
    // Добавляем один обработчик событий на всю таблицу для эффективности
    usersTableBody.addEventListener('click', (e) => {
        // Если кликнули на кнопку "Сохранить"
        if (e.target.classList.contains('save-balance-btn')) {
            const userId = e.target.dataset.userid;
            const balanceInput = e.target.closest('tr').querySelector('.balance-input');
            const newBalance = parseInt(balanceInput.value, 10);
            if (!isNaN(newBalance) && newBalance >= 0) {
                updateUserBalance(userId, newBalance);
            } else {
                alert("Пожалуйста, введите корректное числовое значение для баланса.");
            }
        }
    });


    // --- Секция 2: Управление содержимым кейса ---

    let allPossibleItems = []; // Хранит список ВСЕХ предметов, которые есть в игре
    let currentCaseItemIds = new Set(); // Хранит ID предметов, которые СЕЙЧАС в кейсе

    /**
     * Загружает одновременно и список всех предметов, и список предметов в кейсе.
     */
    async function fetchAllDataForCases() {
        try {
            const [itemsResponse, caseItemsResponse] = await Promise.all([
                fetch(`${API_BASE_URL}/api/admin/items`),
                fetch(`${API_BASE_URL}/api/admin/case/items`)
            ]);
            allPossibleItems = await itemsResponse.json();
            const caseIds = await caseItemsResponse.json();
            currentCaseItemIds = new Set(caseIds); // Используем Set для быстрого поиска
            renderCaseItemsSelection();
        } catch (error) {
             console.error('Ошибка при загрузке данных для кейсов:', error);
        }
    }

    /**
     * Отрисовывает сетку со всеми предметами и отмечает галочками те, что уже в кейсе.
     */
    function renderCaseItemsSelection() {
        caseItemsContainer.innerHTML = '';
        allPossibleItems.forEach(item => {
            const isChecked = currentCaseItemIds.has(item.id);
            const itemElement = document.createElement('div');
            const label = document.createElement('label');
            label.className = 'item-label';
            label.title = `${item.name} (Стоимость: ${item.value})`;

            // Путь к картинке теперь относительный, чтобы работать на хостинге
            label.innerHTML = `
                <input type="checkbox" class="item-checkbox" data-itemid="${item.id}" ${isChecked ? 'checked' : ''}>
                <img src="../${item.imageSrc}" alt="${item.name}">
                <span>${item.name}</span>
            `;
            itemElement.appendChild(label);
            caseItemsContainer.appendChild(itemElement);
        });
    }

    /**
     * Собирает ID всех отмеченных предметов и отправляет на сервер для сохранения.
     */
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
                alert('Содержимое кейса успешно обновлено!');
                // Обновляем локальное состояние, чтобы при следующем открытии все было верно
                currentCaseItemIds = new Set(selectedItemIds); 
            } else {
                 throw new Error('Ошибка при сохранении кейса');
            }
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Не удалось сохранить содержимое кейса.');
        }
    }
    
    saveCaseBtn.addEventListener('click', saveCaseItems);


    // --- Инициализация ---
    // Запускаем загрузку всех данных при открытии страницы.
    function init() {
        fetchUsers();
        fetchAllDataForCases();
    }

    init();
});